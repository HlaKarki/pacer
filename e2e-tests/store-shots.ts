// Chrome Web Store screenshots from the built extension on local demo pages, framed at 1280x800 with a caption.
import { chromium, type Page, type Worker } from 'playwright'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHROME, OUT, REPO } from './setup.ts'

const EXT = join(OUT, 'ext-store')
const RAW = join(OUT, 'store-raw')
const DEST = join(REPO, 'release/store')
const DEMO = join(import.meta.dir, 'store')
const NOTES_PDF = join(OUT, 'notes.pdf')
const PORT = 5381
const ORIGIN = `http://localhost:${PORT}`
const VIEW = { width: 1120, height: 648 }
const FONT = join(REPO, 'node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2')

const SHOTS: { raw: string; caption: string; dark?: boolean }[] = [
  { raw: 'hero', caption: 'Speed read any article without leaving the page' },
  { raw: 'settings', caption: 'Move a word, a phrase or a sentence at a time' },
  { raw: 'pdf', caption: 'PDFs open in a Pacer tab next to the original' },
  { raw: 'focus', caption: 'Focus view shows the words large, with their sentence below', dark: true },
  { raw: 'dark', caption: 'Works on light and dark pages', dark: true },
]

await rm(EXT, { recursive: true, force: true })
await cp(join(REPO, 'extension/dist'), EXT, { recursive: true })
const manifest = await Bun.file(join(EXT, 'manifest.json')).json()
// The real extension relies on activeTab from the click, which a script call never grants.
manifest.host_permissions.push(`${ORIGIN}/*`)
await writeFile(join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2))
await rm(RAW, { recursive: true, force: true })
await mkdir(RAW, { recursive: true })
await mkdir(DEST, { recursive: true })

const html = (file: string) => new Response(Bun.file(join(DEMO, file)), { headers: { 'content-type': 'text/html; charset=utf-8' } })
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const path = new URL(req.url).pathname
    if (path === '/article') return html('article.html')
    if (path === '/notes') return html('notes.html')
    if (path === '/notes.pdf') return new Response(Bun.file(NOTES_PDF), { headers: { 'content-type': 'application/pdf' } })
    return new Response('not found', { status: 404 })
  },
})

const ctx = await chromium.launchPersistentContext('', {
  executablePath: CHROME,
  headless: true,
  viewport: VIEW,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const sw: Worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms
  let v = await read()
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting on ${JSON.stringify(v)}`)
    await Bun.sleep(100)
    v = await read()
  }
  return v
}

async function tabIdOf(url: string): Promise<number> {
  return until(() => sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? -1, url), (id) => id >= 0)
}

async function pace(p: Page) {
  const url = p.url()
  const tabId = await tabIdOf(url)
  await sw.evaluate(async ([id, u]) => {
    const tab = await chrome.tabs.get(id)
    await (self as unknown as { paceTab: (t: chrome.tabs.Tab) => Promise<void> }).paceTab({ ...tab, url: tab.url ?? u })
  }, [tabId, url] as const)
  return tabId
}

type Box = { x: number; y: number; w: number; h: number }
const barButtons = (tabId: number) =>
  sw.evaluate(async (id) => {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const host = document.querySelector('pacer-bar') as HTMLElement | null
        const root = host && chrome.dom.openOrClosedShadowRoot(host)
        const panel = root?.querySelector('.panel')
        if (!root || !panel || panel.hasAttribute('data-loading')) return null
        const buttons: Record<string, { x: number; y: number; w: number; h: number }> = {}
        for (const b of root.querySelectorAll('button')) {
          const r = b.getBoundingClientRect()
          buttons[b.getAttribute('aria-label') || b.textContent || ''] = { x: r.x, y: r.y, w: r.width, h: r.height }
        }
        return buttons
      },
    })
    return (frame?.result ?? null) as Record<string, Box> | null
  }, tabId)

async function clickBar(p: Page, tabId: number, label: string) {
  const buttons = await until(() => barButtons(tabId), (b) => b !== null && label in b)
  const b = buttons![label]!
  await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
}

const raw = (p: Page, name: string) => p.screenshot({ path: join(RAW, `${name}.png`) })

async function setSettings(patch: Record<string, unknown>) {
  await sw.evaluate(async (s) => {
    const { settings } = await chrome.storage.local.get('settings')
    await chrome.storage.local.set({ settings: { ...(settings as object), ...s } })
  }, patch)
}

try {
  await setSettings({ wpm: 320 })

  const maker = await ctx.newPage()
  await maker.goto(`${ORIGIN}/notes`)
  await maker.pdf({ path: NOTES_PDF, format: 'Letter', printBackground: true })
  await maker.close()

  const light = await ctx.newPage()
  await light.goto(`${ORIGIN}/article`)
  const lightId = await pace(light)
  await clickBar(light, lightId, 'Play')
  await Bun.sleep(16000)
  await raw(light, 'hero')
  await clickBar(light, lightId, 'Pause')
  await clickBar(light, lightId, 'Reading settings')
  await Bun.sleep(500)
  await raw(light, 'settings')
  await light.close()

  const dark = await ctx.newPage()
  await dark.goto(`${ORIGIN}/article?dark`)
  const darkId = await pace(dark)
  await clickBar(dark, darkId, 'Play')
  await Bun.sleep(30000)
  await raw(dark, 'dark')
  await dark.close()

  const pdf = await ctx.newPage()
  await pdf.goto(`${ORIGIN}/notes.pdf`).catch(() => {})
  const appeared = ctx.waitForEvent('page')
  await pace(pdf)
  const reader = await appeared
  await reader.waitForSelector('.pc-reader .pc-w', { timeout: 30000 })
  await reader.keyboard.press('Space')
  await Bun.sleep(24000)
  // The reader hides its controls and dims the text while playing, so both shots are taken paused.
  await reader.keyboard.press('Space')
  await Bun.sleep(900)
  await raw(reader, 'pdf')
  await reader.getByRole('radio', { name: 'Focus' }).click()
  await reader.emulateMedia({ colorScheme: 'dark' })
  await reader.keyboard.press('Space')
  await Bun.sleep(4000)
  await reader.keyboard.press('Space')
  await Bun.sleep(900)
  await raw(reader, 'focus')

  const frame = await ctx.newPage()
  await frame.setViewportSize({ width: 1280, height: 800 })
  for (const [i, shot] of SHOTS.entries()) {
    const file = join(OUT, `frame-${shot.raw}.html`)
    await writeFile(
      file,
      `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Instrument Sans'; src: url('file://${FONT}') format('woff2'); font-weight: 400 700; }
html, body { margin: 0; }
body { width: 1280px; height: 800px; overflow: hidden; position: relative; background: #2442c4; font-family: 'Instrument Sans', system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
h1 { position: absolute; top: 38px; left: 0; right: 0; margin: 0; text-align: center; color: #fff; font-size: 38px; line-height: 1.2; font-weight: 600; letter-spacing: -0.015em; }
.win { position: absolute; top: 120px; left: 80px; width: 1120px; border-radius: 14px 14px 0 0; overflow: hidden; box-shadow: 0 30px 80px rgba(8, 18, 70, 0.5); }
.strip { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 14px; background: ${shot.dark ? '#2a2d31' : '#e8eaed'}; }
.strip i { width: 12px; height: 12px; border-radius: 50%; background: ${shot.dark ? '#4a4e54' : '#c6cad0'}; }
img { display: block; width: 1120px; height: 648px; }
</style><h1>${shot.caption}</h1><div class="win"><div class="strip"><i></i><i></i><i></i></div><img src="file://${join(RAW, `${shot.raw}.png`)}"></div>`,
    )
    await frame.goto(`file://${file}`)
    await frame.evaluate(() => document.fonts.ready)
    await frame.screenshot({ path: join(DEST, `${i + 1}-${shot.raw}.png`) })
  }
  const CARDS = { tile: [440, 280], marquee: [1400, 560], og: [1200, 630] } as const
  for (const [name, [width, height]] of Object.entries(CARDS)) {
    await frame.setViewportSize({ width, height })
    await frame.goto(`file://${join(DEMO, 'cards.html')}`)
    await frame.evaluate((card) => (document.body.dataset.card = card), name)
    await frame.evaluate(() => document.fonts.ready)
    await frame.screenshot({ path: join(DEST, `${name}.png`) })
  }
  console.log(`Wrote ${SHOTS.length} screenshots and ${Object.keys(CARDS).length} cards to ${DEST}`)
} finally {
  await ctx.close()
  void server.stop()
}
