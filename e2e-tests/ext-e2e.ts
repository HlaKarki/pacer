// Headless Chrome for Testing with the built Pacer extension, on the routes that open the reader tab. inpage-e2e.ts covers pages read in place.
// paceTab is called from the service worker because nothing can press the toolbar button in an automated browser.
import { chromium, type Page, type Worker } from 'playwright'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHROME, OUT, REPO, fixtures } from './setup.ts'

const FIXTURES = await fixtures()

const EXT = join(OUT, 'ext-test')
const SHOTS = join(OUT, 'shots/ext')
const PORT = 5321
const ORIGIN = `http://localhost:${PORT}`

await rm(EXT, { recursive: true, force: true })
await cp(join(REPO, 'extension/dist'), EXT, { recursive: true })
const manifest = await Bun.file(join(EXT, 'manifest.json')).json()
// The real extension relies on activeTab from the click, which a script call never grants.
manifest.host_permissions.push(`${ORIGIN}/*`)
await writeFile(join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2))
await rm(SHOTS, { recursive: true, force: true })
await mkdir(SHOTS, { recursive: true })

const para = (n: number) =>
  `<p>Paragraph ${n} opens with its number and then keeps going for a while, so that the reader view parser treats it as body text worth keeping, and so the page is long enough to scroll through.</p>`
const ARTICLE = `<!doctype html><html><head><title>How Eyes Read | The Reading Blog</title>
<style>body{font:18px/1.6 Georgia;max-width:40rem;margin:0 auto;padding:0 16px} header{position:sticky;top:0;background:#fff;padding:12px 0}</style></head>
<body><header><a href="/">The Reading Blog</a> <nav><a href="/a">About</a> <a href="/b">Archive</a></nav></header>
<article><h1>How Eyes Read</h1>${Array.from({ length: 45 }, (_, i) => (i % 10 === 9 ? `<h2>Part ${(i + 1) / 10}</h2>` : '') + para(i + 1)).join('')}</article>
<footer><p>Copyright 2026 The Reading Blog.</p></footer></body></html>`
const PLAIN = Array.from(
  { length: 4 },
  (_, i) => `Note ${i + 1} is a plain text paragraph that runs across a couple of lines\nin the file, and it ends here.`,
).join('\n\n')

let flakyHits = 0
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const path = new URL(req.url).pathname
    const pdf = () => new Response(Bun.file(join(FIXTURES, 'attention.pdf')), { headers: { 'content-type': 'application/pdf' } })
    if (path === '/paper.pdf') return pdf()
    if (path === '/flaky.pdf') return ++flakyHits === 1 ? pdf() : new Response('gone', { status: 500 })
    if (path === '/article') return new Response(ARTICLE, { headers: { 'content-type': 'text/html' } })
    if (path === '/empty') return new Response('<html><head><title>Sign in</title></head><body><p>Sign in to continue.</p></body></html>', { headers: { 'content-type': 'text/html' } })
    if (path === '/notes.txt') return new Response(PLAIN, { headers: { 'content-type': 'text/plain' } })
    return new Response('not found', { status: 404 })
  },
})

const results: { name: string; ok: boolean; detail?: unknown }[] = []
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

const ctx = await chromium.launchPersistentContext('', {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
let [sw] = ctx.serviceWorkers()
sw ??= await ctx.waitForEvent('serviceworker')
const extId = sw.url().split('/')[2]
const READER = `chrome-extension://${extId}/reader.html`
const pageErrors: string[] = []

function watch(page: Page) {
  page.on('console', (m) => {
    if (m.type() === 'error' && page.url().startsWith('chrome-extension://')) pageErrors.push(`${page.url()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => pageErrors.push(`${page.url()}: ${e.message}`))
  return page
}

const newPage = async () => watch(await ctx.newPage())

async function tabIdOf(worker: Worker, url: string): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const id = await worker.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url)
    if (id !== undefined) return id
    await Bun.sleep(100)
  }
  throw new Error(`no tab for ${url}`)
}

const tabIds = () => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id!))

// The click's activeTab grant is what reveals a tab's URL, so tabs the test can't see get it filled in.
async function pace(page: Page, url = page.url(), knownId?: number) {
  const tabId = knownId ?? (await tabIdOf(sw, url))
  await sw.evaluate(async ([id, u]) => {
    const tab = await chrome.tabs.get(id)
    await (self as unknown as { paceTab: (t: chrome.tabs.Tab) => Promise<void> }).paceTab({ ...tab, url: tab.url ?? u })
  }, [tabId, url] as const)
  return tabId
}

// Pacer opens next to the source tab, so the reader is the page that appears after the press.
async function paceInto(source: Page, url = source.url(), knownId?: number) {
  const appeared = ctx.waitForEvent('page')
  const sourceId = await pace(source, url, knownId)
  const reader = watch(await appeared)
  return { reader, sourceId }
}

const tabInfo = (id: number) =>
  sw.evaluate(async (i) => {
    const t = await chrome.tabs.get(i).catch(() => null)
    return t && { active: t.active, index: t.index, url: t.url, opener: t.openerTabId }
  }, id)
const readerTabId = (reader: Page) => reader.evaluate(async () => (await chrome.tabs.getCurrent())!.id!)
async function exitTo(reader: Page) {
  const closed = reader.waitForEvent('close', { timeout: 10000 })
  await reader.keyboard.press('Escape')
  await closed
}

async function openUnseen(url: string): Promise<{ page: Page; id: number }> {
  const before = new Set(await tabIds())
  const page = await newPage()
  await page.goto(url).catch(() => {})
  const id = (await tabIds()).find((t) => !before.has(t))!
  return { page, id }
}

const readerReady = (page: Page) => page.waitForSelector('.pc-reader .pc-w', { timeout: 30000 })
const current = (page: Page) =>
  page.evaluate(() => {
    const span = document.querySelector<HTMLElement>('.pc-w:not(.pc-is-read)')
    return { index: Number(span?.dataset.i), para: span?.closest('p, h2, h3')?.textContent?.slice(0, 40) ?? null }
  })
const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, name), fullPage: true })

try {
  const pdf = await newPage()
  await pdf.goto(`${ORIGIN}/paper.pdf`).catch(() => {})
  await pdf.waitForTimeout(1200)
  const { reader: pdfReader, sourceId: pdfId } = await paceInto(pdf, `${ORIGIN}/paper.pdf`)
  await readerReady(pdfReader)
  check('PDF opens the reader in a new tab', pdfReader.url().startsWith(`${READER}?doc=`), pdfReader.url())
  const pdfReaderTab = await tabInfo(await readerTabId(pdfReader))
  const pdfTab = await tabInfo(pdfId)
  check('The reader tab sits right of the source and is active', pdfReaderTab?.active === true && pdfReaderTab.index === pdfTab!.index + 1 && pdfReaderTab.opener === pdfId, { pdfReaderTab, pdfTab })
  check('The PDF tab stays where it was', pdf.url() === `${ORIGIN}/paper.pdf` && pdfTab?.active === false, pdfTab)
  check('PDF reader titles the tab from the PDF, not the file name', (await pdfReader.title()) !== 'paper.pdf', await pdfReader.title())
  check('PDF exit button says PDF', (await pdfReader.locator('.pc-reader-top .pc-btn-quiet').textContent()) === 'PDF')
  const pdfStart = await current(pdfReader)
  check('PDF without a page hash starts at the top', pdfStart.index === 0, pdfStart)
  await shot(pdfReader, 'desktop-pdf-reader.png')

  const bar = pdfReader.locator('.pc-progress')
  const box = (await bar.boundingBox())!
  await pdfReader.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
  await pdfReader.waitForTimeout(300)
  const pdfMid = await current(pdfReader)
  await exitTo(pdfReader)
  await pdf.waitForURL(/paper\.pdf#page=\d+$/, { timeout: 10000 })
  const page = Number(/#page=(\d+)/.exec(pdf.url())![1])
  check('Esc closes the reader and turns the PDF tab to the page reached', page > 1 && page <= 15, { url: pdf.url(), at: pdfMid })
  check('Esc switches back to the PDF tab', (await tabInfo(pdfId))?.active === true)
  check('The PDF tab is the same tab, not a reload elsewhere', ctx.pages().includes(pdf) && !ctx.pages().includes(pdfReader))
  await pdf.waitForTimeout(800)
  await pdf.screenshot({ path: join(SHOTS, 'desktop-pdf-source-after-exit.png') })

  const { reader: pdfAgain } = await paceInto(pdf)
  await readerReady(pdfAgain)
  await pdfAgain.waitForTimeout(300)
  const pdfResumed = await current(pdfAgain)
  check('Pacing the PDF again resumes the saved word', pdfResumed.index === pdfMid.index, { before: pdfMid, after: pdfResumed })
  const saved = await sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], `place:${ORIGIN}/paper.pdf`)
  check('The place is saved under the URL without its hash', (saved as { index: number })?.index === pdfMid.index, saved)

  const flaky = await newPage()
  await flaky.goto(`${ORIGIN}/flaky.pdf`).catch(() => {})
  await flaky.waitForTimeout(1200)
  const { reader: flakyReader } = await paceInto(flaky, `${ORIGIN}/flaky.pdf`)
  await flakyReader.waitForSelector('.pc-page-lead')
  check('A failed PDF download says to reload', (await flakyReader.locator('.pc-page-lead').textContent())!.startsWith('Pacer could not download this PDF again'))
  await flakyReader.close()

  // Chrome's own pages refuse scripts, so the button shows a badge instead.
  const { page: settingsTab, id: refusedId } = await openUnseen('chrome://version')
  await pace(settingsTab, 'chrome://version/', refusedId)
  const badge = await sw.evaluate(async (tabId) => ({
    text: await chrome.action.getBadgeText({ tabId }),
    title: await chrome.action.getTitle({ tabId }),
  }), refusedId)
  check('A refused page gets the ! badge and title', badge.text === '!' && badge.title === "Pacer can't read this page", badge)
  await settingsTab.goto(`${ORIGIN}/article`)
  await settingsTab.waitForTimeout(300)
  const cleared = await sw.evaluate(async (tabId) => ({
    text: await chrome.action.getBadgeText({ tabId }),
    title: await chrome.action.getTitle({ tabId }),
  }), refusedId)
  check('The badge clears when the tab navigates', cleared.text === '' && cleared.title === 'Pace this page', cleared)

  const { page: blank, id: blankId } = await openUnseen('about:blank')
  const pagesBefore = ctx.pages().length
  await pace(blank, 'about:blank', blankId)
  await blank.waitForSelector('.pc-page-lead')
  check('A blank tab turns into the picker in place', blank.url() === READER && ctx.pages().length === pagesBefore, blank.url())
  check('The picker names the shortcut', (await blank.locator('.pc-page-note').textContent())!.includes('P'), await blank.locator('.pc-page-note').textContent())
  await shot(blank, 'desktop-picker.png')
  await blank.locator('input[type=file]').setInputFiles(join(FIXTURES, 'alice.epub'))
  await readerReady(blank)
  check('An EPUB opens from the picker', (await blank.title()).includes('Alice'), await blank.title())
  check('Picked files exit to Files', (await blank.locator('.pc-reader-top .pc-btn-quiet').textContent()) === 'Files')
  await blank.keyboard.press('Escape')
  await blank.waitForSelector('.pc-page-lead')
  check('Esc from a picked file returns to the picker', (await blank.title()) === 'Pacer')

  const fileUrl = `file://${join(FIXTURES, 'attention.pdf')}`
  const local = await newPage()
  await local.goto(fileUrl).catch(() => {})
  await local.waitForTimeout(1200)
  const { reader: localReader } = await paceInto(local, fileUrl)
  await readerReady(localReader)
  check('A local PDF opens in the reader', localReader.url().startsWith(`${READER}?doc=`))
  const lbox = (await localReader.locator('.pc-progress').boundingBox())!
  await localReader.mouse.click(lbox.x + lbox.width * 0.3, lbox.y + lbox.height / 2)
  await localReader.waitForTimeout(200)
  await exitTo(localReader)
  await local.waitForURL(/attention\.pdf#page=\d+$/, { timeout: 10000 })
  check('Esc turns the local PDF tab to the page reached', /#page=\d+$/.test(local.url()), local.url())

  // These screens only show for stored records, so the test writes the records straight into the cache.
  const direct = await newPage()
  await direct.goto(READER)
  await direct.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pacer', 1)
        open.onsuccess = () => {
          const tx = open.result.transaction('docs', 'readwrite')
          tx.objectStore('docs').put({ id: 'no-access', kind: 'pdf', src: 'file:///Users/me/book.pdf', title: null, error: { message: '', fileAccess: true }, at: Date.now() })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await direct.goto(`${READER}?doc=no-access`)
  await direct.waitForSelector('.pc-page-lead')
  check('File access off explains the toggle', (await direct.locator('.pc-page-lead').textContent())!.includes('local files'))
  check('File access screen offers settings and the picker', (await direct.getByRole('button', { name: 'Open Pacer’s settings' }).count()) === 1 && (await direct.getByRole('button', { name: 'Choose the file' }).count()) === 1)
  check('A Pacer tab without a source hides Go back', (await direct.getByRole('button', { name: 'Go back' }).count()) === 0)
  await shot(direct, 'desktop-file-access.png')
  await direct.goto(`${READER}?doc=gone`)
  await direct.waitForSelector('.pc-page-lead')
  check('A pruned record says to press Pacer again', (await direct.locator('.pc-page-lead').textContent()) === 'This document is no longer cached. Go back and press Pacer again.')

  const before = await sw.evaluate(async () => ((await chrome.storage.local.get('settings')).settings as { wpm?: number } | undefined)?.wpm ?? 300)
  await pdfAgain.bringToFront()
  await pdfAgain.keyboard.press('ArrowUp')
  await pdfAgain.waitForTimeout(300)
  const after = await sw.evaluate(async () => ((await chrome.storage.local.get('settings')).settings as { wpm?: number } | undefined)?.wpm)
  check('Changing speed saves it for every tab', after === before + 25, { before, after })
  await blank.locator('input[type=file]').setInputFiles(join(FIXTURES, 'alice.epub'))
  await readerReady(blank)
  check('Another open Pacer tab picks up the new speed', (await blank.locator('.pc-wpm-value strong').textContent()) === String(after))
  check('No errors on Pacer pages', pageErrors.length === 0, pageErrors.slice(0, 5))
} catch (error) {
  check('run finished', false, String((error as Error)?.stack ?? error))
} finally {
  await writeFile(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2))
  await ctx.close()
  server.stop()
}
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
