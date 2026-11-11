// Headless Chrome for Testing with the built Pacer extension, in-page lane plus the reader-tab lane.
// paceTab is called from the service worker because nothing can press the toolbar button in an automated browser.
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHROME, OUT, REPO, fixtures } from './setup.ts'

const FIXTURES = await fixtures()

const EXT = join(OUT, 'ext-inpage-e2e')
const SHOTS = join(OUT, 'shots/inpage')
const PORT = 5361
const CDP_PORT = 9411
const ORIGIN = `http://localhost:${PORT}`

const { parseFrequency } = await import(join(REPO, 'src/lib/frequency.ts'))
const { parse } = await import(join(REPO, 'src/lib/text.ts'))
const { msPerWord, weightPrefix } = await import(join(REPO, 'src/lib/timing.ts'))

await rm(EXT, { recursive: true, force: true })
await cp(join(REPO, 'extension/dist'), EXT, { recursive: true })
const manifest = await Bun.file(join(EXT, 'manifest.json')).json()
// The real extension relies on activeTab from the click, which a script call never grants.
manifest.host_permissions.push(`${ORIGIN}/*`)
await writeFile(join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2))
await rm(SHOTS, { recursive: true, force: true })
await mkdir(SHOTS, { recursive: true })

const BASE_CSS = 'body{font:18px/1.6 Georgia;max-width:40rem;margin:0 auto;padding:0 16px}'
const para = (n: number) =>
  `<p>Paragraph ${n} opens with its number and then keeps going for a while, so that the reader view parser treats it as body text worth keeping, and so the page is long enough to scroll through.</p>`
const paras = (n: number, from = 1) => Array.from({ length: n }, (_, i) => para(i + from)).join('')
const page = (title: string, body: string, css = '', script = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${BASE_CSS}${css}</style></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`

const ARTICLE = `<!doctype html><html><head><title>How Eyes Read | The Reading Blog</title>
<style>body{font:18px/1.6 Georgia;max-width:40rem;margin:0 auto;padding:0 16px} header{position:sticky;top:0;background:#fff;padding:12px 0}</style></head>
<body><header><a href="/">The Reading Blog</a> <nav><a href="/a">About</a> <a href="/b">Archive</a></nav></header>
<article><h1>How Eyes Read</h1>${Array.from({ length: 45 }, (_, i) => (i % 10 === 9 ? `<h2>Part ${(i + 1) / 10}</h2>` : '') + para(i + 1)).join('')}</article>
<footer><p>Copyright 2026 The Reading Blog.</p></footer></body></html>`
const PLAIN = Array.from(
  { length: 4 },
  (_, i) => `Note ${i + 1} is a plain text paragraph that runs across a couple of lines\nin the file, and it ends here.`,
).join('\n\n')

const words = 'the quick reader glides across every line while the eye keeps its place and nothing flashes away from view so meaning stays whole'.split(' ')
const cpara = (n: number, rich = true) => {
  const w = Array.from({ length: 30 }, (_, i) => words[(n * 7 + i) % words.length])
  w[0] = `Paragraph${n}`
  if (rich) {
    w[5] = `<a href="/x${n}">${w[5]} ${w[6]}</a>`
    w[6] = ''
    w[12] = `<em>${w[12]}</em>`
    w[20] = `<a href="/y${n}">${w[20]}</a>`
  }
  return `<p>${w.filter(Boolean).join(' ')} end${n}.</p>`
}
const carticle = (n: number, from = 1, rich = true) => Array.from({ length: n }, (_, i) => cpara(i + from, rich)).join('')

const TOC_SECTIONS = 8
const TOC = page(
  'Sticky Contents',
  `<div class="wrap"><aside><nav><p>Contents</p><ul>${Array.from({ length: TOC_SECTIONS }, (_, s) => `<li><a href="#s${s}">Section ${s + 1} heading</a></li>`).join('')}</ul></nav></aside>
  <article><h1>Sticky Contents</h1>${Array.from({ length: TOC_SECTIONS }, (_, s) => `<h2 id="s${s}">Section ${s + 1} heading</h2>${paras(6, s * 6 + 1)}`).join('')}</article></div>`,
  'body{max-width:none;padding:0}.wrap{display:grid;grid-template-columns:240px minmax(0,40rem);gap:32px;max-width:72rem;margin:0 auto;padding:0 16px}aside{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;font:14px/1.5 system-ui}',
)
const TITLE = page('Totally Different Window Title', `<article><h1>How Eyes Read</h1>${paras(12)}</article>`)
const KEYS = page(
  'Keys',
  `<article><h1>Keys</h1>${carticle(12)}
  <p><input id="field" value=""></p><div id="open"></div><div id="closed"></div>
  <div id="rb" role="button" tabindex="0">Toggle details</div>
  <details id="det"><summary id="sum">More</summary><p>Hidden detail text here.</p></details>
  <div role="tablist" id="tabs"><button role="tab" id="t1">One</button><button role="tab" id="t2">Two</button></div>
  ${carticle(10, 13)}</article>`,
  '',
  `window.log = []
  document.addEventListener('keydown', (e) => log.push('doc-keydown:' + e.key))
  document.addEventListener('keyup', (e) => log.push('doc-keyup:' + e.key))
  const o = document.getElementById('open').attachShadow({ mode: 'open' })
  o.innerHTML = '<textarea id="ta"></textarea><div id="ce" contenteditable="true">edit me</div>'
  const c = document.getElementById('closed').attachShadow({ mode: 'closed' })
  c.innerHTML = '<textarea id="cta"></textarea>'
  window.closedTa = c.getElementById('cta')
  document.getElementById('rb').addEventListener('keydown', (e) => { if (e.key === ' ') log.push('rb-activated') })
  document.getElementById('tabs').addEventListener('keydown', (e) => log.push('tablist:' + e.key))`,
)
const HIDDEN = page(
  'Hidden Words',
  `<article><h1>Hidden Words</h1>${carticle(6)}
  <p>Before the photo <span class="sr-only">Advertisement. Continue reading the main story below this line.</span> after the photo the story goes on for quite a few words more.</p>
  ${carticle(4, 7)}<div class="truncated">${carticle(20, 11)}</div><div class="fade">Subscribe to keep reading</div></article>`,
  '.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.truncated{max-height:240px;overflow:hidden}',
)
const OVERLAY = page(
  'Overlay Article',
  `<article><h1>Overlay Article</h1>${carticle(60)}</article>
  <div id="wall" style="position:fixed;inset:0;background:rgba(255,255,255,.97);z-index:10;display:grid;place-items:center"><div><h2>You have reached your limit</h2><p>Subscribe for one dollar a week.</p></div></div>`,
  'html,body{overflow:hidden}',
)
const CAPTION = page(
  'Caption Article',
  `<article><h1>Caption Article</h1>${carticle(3)}
  <figure style="position:relative;margin:0"><figcaption>A caption the photo sits on top of, which nobody can read.</figcaption>
  <div style="position:absolute;inset:0;background:#7a8a99"></div></figure>${carticle(8, 4)}</article>`,
)
const VIRTUAL = page('Virtual Thread', `<h1>Virtual Thread</h1><div id="list" style="position:relative"></div>`, '', `
  const N = 300, H = 140, rows = new Map()
  const list = document.getElementById('list'); list.style.height = N * H + 'px'
  const text = ${JSON.stringify(Array.from({ length: 300 }, (_, i) => cpara(i + 1, false)))}
  function render() {
    const top = scrollY - list.offsetTop, from = Math.max(0, Math.floor(top / H) - 3), to = Math.min(N, Math.ceil((top + innerHeight) / H) + 3)
    for (const [k, d] of rows) if (k < from || k >= to) { d.remove(); rows.delete(k) }
    for (let k = from; k < to; k++) if (!rows.has(k)) { const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;right:0;top:' + k * H + 'px'; d.innerHTML = '<article>' + text[k] + '</article>'; list.append(d); rows.set(k, d) }
  }
  addEventListener('scroll', render, { passive: true }); render()`)
const CALM = page('Calm Article', `<article><h1>Calm Article</h1>${carticle(200)}</article>`)
const SPA = page('SPA One', `<article id="a"><h1>SPA One</h1>${carticle(40)}</article>`, '', `
  window.go = () => { history.pushState({}, '', '/spa/two'); document.title = 'SPA Two'; document.getElementById('a').innerHTML = '<h1>SPA Two</h1>' + ${JSON.stringify(carticle(40, 500))} }`)
const SCROLLSPY = page(
  'Docs Page',
  `<article><h1>Docs Page</h1>${Array.from({ length: 8 }, (_, s) => `<h2 id="s${s}">Section ${s}</h2>${carticle(3, s * 3 + 1)}`).join('')}</article>`,
  '',
  `const hs = [...document.querySelectorAll('h2')]
  addEventListener('scroll', () => { const h = hs.filter((x) => x.getBoundingClientRect().top < 120).at(-1); const want = h ? '#' + h.id : ''; if (location.hash !== want) history.replaceState(null, '', location.pathname + want) }, { passive: true })`,
)
const STRICT = `<!doctype html><html><head><meta charset="utf-8"><title>Strict Page</title><link rel="stylesheet" href="/strict.css"></head>
<body><article><h1>Strict Page</h1>${paras(20)}</article></body></html>`
const STRICT_CSS = `${BASE_CSS} *{font-family:"Comic Sans MS",cursive !important;color:#203040 !important} button{background:red !important}`
const SCROLLER = page(
  'Inner Scroller',
  `<div id="scroller"><article><h1>Inner Scroller</h1>${paras(30)}</article></div>`,
  'html,body{height:100%;margin:0;overflow:hidden;max-width:none;padding:0;background:#15181b;color:#d8dcdf}#scroller{height:100vh;overflow:auto}article{max-width:40rem;margin:0 auto;padding:0 16px}',
)
const RERENDER = page('Rerender', `<article><h1>Rerender</h1>${paras(30)}</article>`, '', `
  window.rerender = () => { const a = document.querySelector('article'); a.replaceWith(a.cloneNode(true)) }`)
const CANVAS = page(
  'Painted Article',
  `<canvas id="c" width="760" height="900"></canvas><article class="painted"><h1>Painted Article</h1>${paras(12)}</article>`,
  '.painted{visibility:hidden;position:absolute;top:0}',
  `const g = document.getElementById('c').getContext('2d'); g.font = '18px Georgia'; [...document.querySelectorAll('.painted p')].slice(0, 30).forEach((p, i) => g.fillText(p.textContent.slice(0, 80), 10, 30 + i * 28))`,
)
const HLA = page(
  'Spendoff — hla.dev',
  `<div class="topbar"></div>
  <nav class="leftnav"><a href="/">Home</a><a href="/builds">Builds</a><a href="/writing">Writing</a><a href="/about">About</a></nav>
  <nav class="contents"><p>Contents</p><ol>${['Problem', 'Approach', 'Build', 'Launch', 'Lessons'].map((s, i) => `<li><a href="#h${i}">${s}</a></li>`).join('')}</ol></nav>
  <main><aside class="summary"><p>Spendoff turns a shared budget into a weekly game between friends, built solo for iOS.</p></aside>
  <article><h1>Spendoff</h1>${['Problem', 'Approach', 'Build', 'Launch', 'Lessons'].map((s, i) => `<h2 id="h${i}">${s}</h2>${paras(4, i * 4 + 1)}`).join('')}</article></main>`,
  'body{max-width:none;margin:0;padding:0;font:17px/1.65 system-ui;background:#fbfaf7;color:#1d1d1b}.topbar{position:fixed;top:0;left:0;right:0;height:2px;background:#e4572e;z-index:5}.leftnav{position:fixed;left:16px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:12px;font-size:14px}.contents{position:fixed;right:24px;top:120px;width:200px;font-size:13px}main{max-width:40rem;margin:0 auto;padding:64px 16px}aside.summary{border:1px solid #ddd;padding:16px;border-radius:8px;margin-bottom:32px}',
)
const EMPTY = '<html><head><title>Sign in</title></head><body><p>Sign in to continue.</p></body></html>'
const END = page('End Page', `<article><h1>End Page</h1>${paras(14)}</article>`, 'body{padding-bottom:0}article p:last-child{margin-bottom:0}')
const LINKS = page(
  'Links Page',
  `<article><h1>Links Page</h1>${para(1)}<p>Write to <a id="mail" href="mailto:someone@example.com">the author</a> or grab <a id="dl" href="/report.csv">the data file</a> to check the numbers yourself before reading on.</p>${paras(12, 2)}</article>`,
)
const CALLOUT = page(
  'Callout Page',
  `<article><h1>Callout Page</h1>${para(1)}<div class="warn"><p id="warn">Warning callout text sits on a pale yellow background like the cautions on many docs sites.</p></div>
  <div class="tw"><p id="tw">Caution callout text uses a Tailwind yellow written in oklch, which Chrome keeps in oklch.</p></div>
  <div class="sepia"><p id="sepia">Sepia block text sits on a reading background and keeps the yellow highlight.</p></div>${paras(10, 2)}</article>`,
  '.warn{background:#fff1a8;padding:4px 16px}.tw{background:oklch(0.973 0.071 103.193);padding:4px 16px}.sepia{background:#fbf0d9;padding:4px 16px}',
)
// Every word is rare, long and punctuated, so smart pacing with pauses runs about 1.7 times as long as even pacing here.
const RARE = 'quixotic ephemeral labyrinthine serendipitous perspicacious mellifluous obstreperous sesquipedalian pusillanimous antediluvian grandiloquent phantasmagorical recalcitrant obfuscation circumlocution idiosyncratic'.split(' ')
const MARKS = [',', ';', '.', ':', ',', '.']
const PACING = page(
  'Pacing Page',
  `<article><h1>Pacing Page</h1>${Array.from({ length: 45 }, (_, k) => `<p>Paragraph ${k + 1}, ${Array.from({ length: 24 }, (_, i) => RARE[((k + 1) * 5 + i) % RARE.length] + MARKS[i % MARKS.length]).join(' ')}</p>`).join('')}</article>`,
)
const TRANSFORM = page('Transform Page', `<article><h1>Transform Page</h1>${paras(20)}</article>`, 'html{transform:translateZ(0)}')

let flakyHits = 0
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const path = new URL(req.url).pathname
    const html = (s: string, headers: Record<string, string> = {}) => new Response(s, { headers: { 'content-type': 'text/html', ...headers } })
    const pdf = () => new Response(Bun.file(join(FIXTURES, 'attention.pdf')), { headers: { 'content-type': 'application/pdf' } })
    if (path === '/paper.pdf') return pdf()
    if (path === '/flaky.pdf') return ++flakyHits === 1 ? pdf() : new Response('gone', { status: 500 })
    if (path === '/article') return html(ARTICLE)
    if (path === '/empty') return html(EMPTY)
    if (path === '/notes.txt') return new Response(PLAIN, { headers: { 'content-type': 'text/plain' } })
    if (path === '/toc') return html(TOC)
    if (path === '/title') return html(TITLE)
    if (path === '/keys') return html(KEYS)
    if (path === '/hidden') return html(HIDDEN)
    if (path === '/overlay') return html(OVERLAY)
    if (path === '/caption') return html(CAPTION)
    if (path === '/virtual') return html(VIRTUAL)
    if (path === '/calm') return html(CALM)
    if (path.startsWith('/spa')) return html(SPA)
    if (path === '/scrollspy') return html(SCROLLSPY)
    if (path === '/strict') return html(STRICT, { 'content-security-policy': "default-src 'self'" })
    if (path === '/strict.css') return new Response(STRICT_CSS, { headers: { 'content-type': 'text/css' } })
    if (path === '/scroller') return html(SCROLLER)
    if (path === '/rerender') return html(RERENDER)
    if (path === '/canvas') return html(CANVAS)
    if (path === '/hla') return html(HLA)
    if (path === '/end') return html(END)
    if (path === '/links') return html(LINKS)
    if (path === '/report.csv') return new Response('a,b\n1,2\n', { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' } })
    if (path === '/callout') return html(CALLOUT)
    if (path === '/transform') return html(TRANSFORM)
    if (path === '/pacing') return html(PACING)
    return new Response('not found', { status: 404 })
  },
})

const results: { name: string; ok: boolean; detail?: unknown }[] = []
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}
const notes: string[] = []
const ONLY = process.env.ONLY?.split(',')
async function section(name: string, run: () => Promise<void>) {
  if (ONLY && !ONLY.some((o) => name.includes(o))) return
  console.log(`\n# ${name}`)
  try {
    await run()
  } catch (error) {
    check(`${name}: finished`, false, String((error as Error)?.stack ?? error).slice(0, 600))
  }
}

const ctx: BrowserContext = await chromium.launchPersistentContext('', {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--remote-debugging-port=${CDP_PORT}`, '--enable-unsafe-extension-debugging'],
})
let sw: Worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
const extId = sw.url().split('/')[2]
const READER = `chrome-extension://${extId}/reader.html`
const pageErrors: string[] = []

function watch(p: Page) {
  p.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error' && p.url().startsWith('chrome-extension://')) pageErrors.push(`${p.url()}: ${text}`)
    else if ((m.type() === 'error' || m.type() === 'warning') && /pacer/i.test(text)) pageErrors.push(`${p.url()}: ${text}`)
  })
  p.on('pageerror', (e) => pageErrors.push(`${p.url()}: ${e.message}`))
  return p
}
const newPage = async () => watch(await ctx.newPage())
async function open(path: string) {
  const p = await newPage()
  await p.goto(path.startsWith('http') || path.startsWith('file') ? path : `${ORIGIN}${path}`).catch(() => {})
  return p
}

async function tabIdOf(url: string): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const id = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id, url)
    if (id !== undefined) return id
    await Bun.sleep(100)
  }
  throw new Error(`no tab for ${url}`)
}
const tabIds = () => sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id!))

// The click's activeTab grant is what reveals a tab's URL, so tabs the test can't see get it filled in.
async function pace(p: Page, url = p.url(), knownId?: number) {
  const tabId = knownId ?? (await tabIdOf(url))
  await sw.evaluate(async ([id, u]) => {
    const tab = await chrome.tabs.get(id)
    await (self as unknown as { paceTab: (t: chrome.tabs.Tab) => Promise<void> }).paceTab({ ...tab, url: tab.url ?? u })
  }, [tabId, url] as const)
  return tabId
}
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
const topOpening = (p: Page) =>
  p.evaluate(() => {
    const below = innerHeight * 0.15
    const el = [...document.querySelectorAll('p, h2')].find((e) => e.getBoundingClientRect().bottom > below)
    return el?.textContent?.slice(0, 40) ?? null
  })
async function exitTo(reader: Page) {
  const closed = reader.waitForEvent('close', { timeout: 10000 })
  await reader.keyboard.press('Escape')
  await closed
}
async function openUnseen(url: string): Promise<{ page: Page; id: number }> {
  const before = new Set(await tabIds())
  const p = await newPage()
  await p.goto(url).catch(() => {})
  const id = (await tabIds()).find((t) => !before.has(t))!
  return { page: p, id }
}
const readerReady = (p: Page) => p.waitForSelector('.pc-reader .pc-w', { timeout: 30000 })
const current = (p: Page) =>
  p.evaluate(() => {
    const span = document.querySelector<HTMLElement>('.pc-w:not(.pc-is-read)')
    return { index: Number(span?.dataset.i), text: span?.textContent ?? null, para: span?.closest('p, h1, h2, h3')?.textContent?.slice(0, 40) ?? null }
  })
const shot = (p: Page, name: string, fullPage = true) => p.screenshot({ path: join(SHOTS, name), fullPage })

async function setSettings(patch: Record<string, unknown>) {
  await sw.evaluate(async (s) => {
    const { settings } = await chrome.storage.local.get('settings')
    await chrome.storage.local.set({ settings: { ...(settings as object), ...s } })
  }, patch)
}
const getSettings = () => sw.evaluate(async () => ((await chrome.storage.local.get('settings')).settings ?? {}) as { wpm?: number; chunk?: unknown })
const placeOf = (url: string) =>
  sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k] as { index: number; words: number; from: number } | undefined, `place:${url.replace(/#.*$/, '')}`)
const badgeOf = (tabId: number) =>
  sw.evaluate(async (id) => ({ text: await chrome.action.getBadgeText({ tabId: id }), title: await chrome.action.getTitle({ tabId: id }) }), tabId)

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 3000, step = 50): Promise<T> {
  const end = Date.now() + ms
  let v = await read()
  while (!ok(v) && Date.now() < end) {
    await Bun.sleep(step)
    v = await read()
  }
  return v
}

interface Now {
  text: string
  token: number
  top: number
  bottom: number
  connected: boolean
  block: string | null
  blockOrdinal: number
  names: string[]
  dark: boolean
  tone: string
  offset: number
}
// The main world shares the page's highlight registry, so it sees Pacer's ranges without reaching into the isolated world.
const now = (p: Page, root = 'article') =>
  p.evaluate((rootSel): Now | null => {
    const names = [...CSS.highlights.keys()].filter((n) => n.startsWith('pacer-'))
    const ranges = ['pacer-now-light', 'pacer-now-dark', 'pacer-now-warm'].flatMap((n) =>
      [...((CSS.highlights.get(n) as unknown as Set<Range>) ?? [])].filter((r) => !r.collapsed).map((r) => ({ r, dark: n.endsWith('dark'), tone: n.slice('pacer-now-'.length) })),
    )
    const hit = ranges[0]
    if (!hit) return null
    const r = hit.r
    const rect = r.getClientRects()[0]
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let token = 0
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n === r.startContainer) {
        token += (n.textContent!.slice(0, r.startOffset).match(/\S+/g) ?? []).length
        break
      }
      if (n.parentElement?.closest('script, style')) continue
      token += (n.textContent!.match(/\S+/g) ?? []).length
    }
    const BLOCK = 'p, h1, h2, h3, li, figcaption, blockquote, pre'
    const block = r.startContainer.parentElement?.closest(BLOCK) ?? null
    const scope = document.querySelector(rootSel) ?? document.body
    const all = [...scope.querySelectorAll(BLOCK)]
    return {
      text: r.toString(),
      token,
      top: rect?.top ?? -1,
      bottom: rect?.bottom ?? -1,
      connected: r.startContainer.isConnected,
      block: block?.textContent?.trim().slice(0, 48) ?? null,
      blockOrdinal: block ? all.indexOf(block) : -1,
      names,
      dark: hit.dark,
      tone: hit.tone,
      offset: (() => {
        if (!block) return -1
        const before = document.createRange()
        before.setStart(block, 0)
        before.setEnd(r.startContainer, r.startOffset)
        return (before.toString().match(/\S+/g) ?? []).length
      })(),
    }
  }, root)
// First block whose bottom clears the strip a sticky header usually covers, skipping fixed and sticky furniture.
const firstVisible = (p: Page, root = 'article') =>
  p.evaluate((rootSel) => {
    const scope = document.querySelector(rootSel) ?? document.body
    const all = [...scope.querySelectorAll('p, h1, h2, h3, li')]
    const pinned = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) if (/fixed|sticky/.test(getComputedStyle(e).position)) return true
      return false
    }
    const k = all.findIndex((e) => !pinned(e) && e.closest('nav, aside') === null && e.getBoundingClientRect().bottom > innerHeight * 0.15 && e.getBoundingClientRect().top < innerHeight)
    return { ordinal: k, text: all[k]?.textContent?.trim().slice(0, 48) ?? null }
  }, root)
const paraNumber = (s: string | null | undefined) => Number(/Paragraph\s?(\d+)/.exec(s ?? '')?.[1] ?? NaN)

interface Box { x: number; y: number; w: number; h: number }
interface BarInfo {
  panel: Box
  loading: boolean
  notice: string | null
  action: string | null
  playing: boolean
  wpm: string
  chunk: string
  time: string
  timeShown: boolean
  chunkShown: boolean
  wpmShown: boolean
  noticeClipped: boolean
  font: string
  bg: string
  progress: number
  buttons: Record<string, Box>
  inner: number
  width: number
}
const bar = (tabId: number) =>
  sw.evaluate(async (id) => {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const host = document.querySelector('pacer-bar') as HTMLElement | null
        const root = host && chrome.dom.openOrClosedShadowRoot(host)
        if (!root) return null
        const box = (el: Element) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        }
        const panel = root.querySelector('.panel')!
        const shown = (sel: string) => {
          const el = root.querySelector(sel)
          return !!el && getComputedStyle(el).display !== 'none'
        }
        const buttons: Record<string, { x: number; y: number; w: number; h: number }> = {}
        for (const b of root.querySelectorAll('button')) buttons[b.getAttribute('aria-label') || b.textContent || ''] = box(b)
        const play = root.querySelector('.play')!
        return {
          panel: box(panel),
          loading: panel.hasAttribute('data-loading'),
          notice: panel.hasAttribute('data-notice') ? root.querySelector('.notice')!.textContent : null,
          action: panel.hasAttribute('data-action') ? root.querySelector('.action')!.textContent : null,
          playing: play.getAttribute('aria-label') === 'Pause',
          wpm: root.querySelector('.wpm-value')!.textContent ?? '',
          chunk: root.querySelector('.chunk')!.textContent ?? '',
          time: root.querySelector('.time')!.textContent ?? '',
          timeShown: shown('.time'),
          chunkShown: shown('.chunk'),
          wpmShown: shown('.wpm'),
          noticeClipped: (() => {
            const n = root.querySelector('.notice')!
            return n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1
          })(),
          font: getComputedStyle(play).fontFamily,
          bg: getComputedStyle(panel).backgroundColor,
          progress: Number(root.querySelector('.progress')!.getAttribute('aria-valuenow')),
          buttons,
          inner: innerHeight,
          width: innerWidth,
        }
      },
    })
    return (frame?.result ?? null) as unknown
  }, tabId) as Promise<BarInfo | null>
const toastText = (tabId: number) =>
  sw.evaluate(async (id) => {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const host = document.querySelector('pacer-toast') as HTMLElement | null
        const root = host && chrome.dom.openOrClosedShadowRoot(host)
        return root ? root.textContent : null
      },
    })
    return (frame?.result ?? null) as string | null
  }, tabId)
async function clickBar(p: Page, tabId: number, label: string) {
  const info = await bar(tabId)
  const key = info && Object.keys(info.buttons).find((k) => k.startsWith(label))
  if (!info || !key) throw new Error(`no bar button ${label}: ${JSON.stringify(info && Object.keys(info.buttons))}`)
  const b = info.buttons[key]
  await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
}
const barFocus = (tabId: number, label?: string) =>
  sw.evaluate(
    async ([id, label]) => {
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId: id },
        args: [label ?? null],
        func: (label: string | null) => {
          const host = document.querySelector('pacer-bar') as HTMLElement | null
          const root = host && chrome.dom.openOrClosedShadowRoot(host)
          if (!root) return null
          if (label) root.querySelector<HTMLElement>(`button[aria-label^="${label}"]`)?.focus()
          const el = root.activeElement
          if (!el) return null
          const group = el.closest('[role=radiogroup]')?.getAttribute('aria-label')
          return `${group ? `${group}: ` : ''}${el.getAttribute('aria-label') || el.textContent}${el.getAttribute('aria-checked') === 'true' ? ' (checked)' : ''}`
        },
      })
      return (frame?.result ?? null) as string | null
    },
    [tabId, label] as const,
  )
const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const scrollToPara = (p: Page, n: number, offset = 140) =>
  p.evaluate(
    ([n, offset]) => {
      const el = [...document.querySelectorAll('p')].find((e) => new RegExp(`^Paragraph\\s?${n}\\b`).test(e.textContent!))!
      window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset)
    },
    [n, offset] as const,
  )
const scrollToFraction = (p: Page, f: number) =>
  p.evaluate((f) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), f)
const scrollStill = async (p: Page) => {
  let lastY = -1
  await until(async () => {
    const y = await p.evaluate(() => scrollY)
    const still = y === lastY
    lastY = y
    await p.waitForTimeout(150)
    return still
  }, (still) => still, 3000)
}

const wordCentre = (p: Page, n: number, word: string) =>
  p.evaluate(
    ([n, word]) => {
      const el = [...document.querySelectorAll('p')].find((e) => new RegExp(`^Paragraph\\s?${n}\\b`).test(e.textContent!))!
      const node = el.firstChild as Text
      const at = node.data.indexOf(word)
      const r = document.createRange()
      r.setStart(node, at)
      r.setEnd(node, at + word.length)
      const b = r.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    },
    [n, word] as const,
  )
const blurAll = (p: Page) => p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
const pressGap = () => Bun.sleep(350)

// The toolbar press arms the bar and waits for Space, Play or a click on a word.
const ARMED = 'Press Space or Play to start'
const armedBar = (id: number) => until(() => bar(id), (b) => b !== null && !b.loading && b.notice === ARMED && !b.playing, 4000)
async function startWithSpace(p: Page, id: number) {
  await armedBar(id)
  await p.keyboard.press('Space')
  return until(() => bar(id), (b) => b?.notice !== ARMED, 1500)
}

interface SettingsInfo {
  open: boolean
  settled: boolean
  expanded: string | null
  box: Box
  bg: string
  checked: Record<string, string | null>
  hints: string[]
  keys: string[]
  radios: Record<string, Box>
}
const settingsOf = (tabId: number) =>
  sw.evaluate(async (id) => {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const host = document.querySelector('pacer-bar') as HTMLElement | null
        const root = host && chrome.dom.openOrClosedShadowRoot(host)
        const panel = root?.querySelector<HTMLElement>('.settings')
        if (!root || !panel) return null
        const box = (el: Element) => {
          const r = el.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        }
        const checked: Record<string, string | null> = {}
        const radios: Record<string, { x: number; y: number; w: number; h: number }> = {}
        for (const group of root.querySelectorAll('[role=radiogroup]')) {
          const name = group.getAttribute('aria-label')!
          checked[name] = group.querySelector('[aria-checked=true]')?.textContent ?? null
          for (const radio of group.querySelectorAll('[role=radio]')) radios[`${name}:${radio.textContent}`] = box(radio)
        }
        return {
          open: !panel.hidden,
          settled: panel.getAnimations().every((a) => a.playState === 'finished'),
          expanded: root.querySelector('button[aria-label="Reading settings"]')!.getAttribute('aria-expanded'),
          box: box(panel),
          bg: getComputedStyle(panel).backgroundColor,
          checked,
          hints: [...root.querySelectorAll<HTMLElement>('.setting-hint')].filter((h) => !h.hidden).map((h) => h.textContent ?? ''),
          keys: [...root.querySelectorAll('.shortcuts dd')].map((d) => d.textContent ?? ''),
          radios,
        }
      },
    })
    return (frame?.result ?? null) as unknown
  }, tabId) as Promise<SettingsInfo | null>
const settingsOpen = (id: number, open = true) => until(() => settingsOf(id), (s) => s?.open === open && s.settled, 1500)
async function clickSetting(p: Page, id: number, group: string, label: string) {
  const s = await settingsOf(id)
  const b = s?.radios[`${group}:${label}`]
  if (!b) throw new Error(`no setting ${group}: ${label}`)
  await p.mouse.click(b.x + b.w / 2, b.y + b.h / 2)
}
const isDark = (color: string) => (color.match(/\d+/g) ?? []).slice(0, 3).reduce((sum, c) => sum + Number(c), 0) < 200
const within = (inner: Box, width: number, height: number, gutter = 0) =>
  inner.x >= gutter - 0.5 && inner.y >= 0 && inner.x + inner.w <= width - gutter + 0.5 && inner.y + inner.h <= height

// Measures the highlight's pace over 2 s against the pacing the given settings call for.
async function measurePace(p: Page, wpm: number, settings: { smart: boolean; pauses: boolean }) {
  const edge = async () => {
    const from = await now(p)
    for (const until = performance.now() + 3000; performance.now() < until; ) {
      const v = await now(p)
      if (v && from && v.token !== from.token) return { v, at: performance.now() }
    }
    throw new Error('the highlight did not move')
  }
  const start = await edge()
  await p.waitForTimeout(2000)
  const end = await edge()
  const blocks = await p.evaluate(() => [...document.querySelectorAll('article p, article h1, article h2, article h3, article li')].map((e) => e.textContent!.trim()))
  const doc = parse(blocks.join('\n\n'))
  const freq = parseFrequency(await Bun.file(join(REPO, 'src/data/frequency.txt')).text())
  const wordOf = (n: Now) => doc.paragraphs[n.blockOrdinal].start + n.offset
  const [i, j] = [wordOf(start.v), wordOf(end.v)]
  const expect = (s: { smart: boolean; pauses: boolean }) => {
    const prefix = weightPrefix(doc, { ...s, freq: s.smart ? freq : null })
    return (prefix[j] - prefix[i]) * msPerWord(wpm)
  }
  return {
    words: j - i,
    expectedMs: Math.round(expect(settings)),
    otherMs: Math.round(expect({ smart: !settings.smart, pauses: !settings.pauses })),
    elapsedMs: Math.round(end.at - start.at),
    from: doc.words[i]?.text,
    to: doc.words[j]?.text,
  }
}

// The two pacings differ by over a third on /pacing, so a session that ignored the settings would land nearer the other one.
const pacedRight = (m: { expectedMs: number; otherMs: number; elapsedMs: number }) =>
  Math.abs(m.otherMs - m.expectedMs) >= m.expectedMs * 0.35 &&
  Math.abs(m.elapsedMs - m.expectedMs) <= m.expectedMs * 0.15 &&
  Math.abs(m.elapsedMs - m.expectedMs) < Math.abs(m.elapsedMs - m.otherMs)

let pdfAgain: Page | null = null
let openedReader: Page | null = null
let direct: Page | null = null

try {
  await section('Reader tab: PDF', async () => {
    const pdf = await open('/paper.pdf')
    await pdf.waitForTimeout(1200)
    const { reader: pdfReader, sourceId: pdfId } = await paceInto(pdf, `${ORIGIN}/paper.pdf`)
    await readerReady(pdfReader)
    check('PDF opens the reader in a new tab', pdfReader.url().startsWith(`${READER}?doc=`), pdfReader.url())
    const pdfReaderTab = await tabInfo(await readerTabId(pdfReader))
    const pdfTab = await tabInfo(pdfId)
    check('The reader tab sits right of the source and is active', pdfReaderTab?.active === true && pdfReaderTab.index === pdfTab!.index + 1 && pdfReaderTab.opener === pdfId, { pdfReaderTab, pdfTab })
    check('PDF exit button says PDF', (await pdfReader.locator('.pc-reader-top .pc-btn-quiet').textContent()) === 'PDF')
    check('PDF without a page hash starts at the top', (await current(pdfReader)).index === 0)
    await shot(pdfReader, 'desktop-pdf-reader.png')
    const pbar = pdfReader.locator('.pc-progress')
    const box = (await pbar.boundingBox())!
    await pdfReader.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2)
    await pdfReader.waitForTimeout(300)
    const pdfMid = await current(pdfReader)
    await exitTo(pdfReader)
    await pdf.waitForURL(/paper\.pdf#page=\d+$/, { timeout: 10000 })
    const pg = Number(/#page=(\d+)/.exec(pdf.url())![1])
    check('Esc closes the reader and turns the PDF tab to the page reached', pg > 1 && pg <= 15, { url: pdf.url() })
    check('Esc switches back to the PDF tab', (await tabInfo(pdfId))?.active === true)
    await pdf.waitForTimeout(800)
    const { reader } = await paceInto(pdf)
    await readerReady(reader)
    await reader.waitForTimeout(300)
    check('Pacing the PDF again resumes the saved word', (await current(reader)).index === pdfMid.index)
    pdfAgain = reader
  })

  await section('In-page: press on /article at paragraph 20', async () => {
    await setSettings({ wpm: 300, chunk: 1, smart: true, pauses: true, autoStart: false })
    const article = await open('/article')
    await scrollToPara(article, 20)
    await article.waitForTimeout(200)
    const elements = await article.evaluate(() => document.querySelectorAll('*').length)
    const scrollBefore = await article.evaluate(() => scrollY)
    const pagesBefore = ctx.pages().length
    const t0 = Date.now()
    const id = await pace(article)
    const startMs = Date.now() - t0
    const first = await until(() => now(article), (v) => v !== null)
    check('Press reads the HTML page in place, with no new tab', ctx.pages().length === pagesBefore, { pages: ctx.pages().length, startMs })
    check('A pacer-bar host is on the page', (await article.locator('pacer-bar').count()) === 1)
    check('The highlight starts on the first word of Paragraph 20', first?.text === 'Paragraph' && paraNumber(first.block) === 20, first)
    const after = await article.evaluate(() => document.querySelectorAll('*').length)
    check('The page gains only the bar host', after === elements + 1, { elements, after })
    await until(() => bar(id), (b) => b !== null && !b.loading)
    await article.waitForTimeout(300)
    const info = await bar(id)
    check('The bar sits bottom centre, 16 px above the window edge', !!info && Math.abs(info.panel.y + info.panel.h - (info.inner - 16)) <= 1 && Math.abs(info.panel.x + info.panel.w / 2 - info.width / 2) <= 1, info?.panel)
    const held = (await now(article))!
    const scrollArmed = await article.evaluate(() => scrollY)
    check('The press arms the bar paused with "Press Space or Play to start"', info?.playing === false && info.notice === ARMED && info.action === null, info && { playing: info.playing, notice: info.notice })
    check('While armed the highlight waits and the page stays where it was', held.token === first?.token && scrollArmed === scrollBefore, { scrollBefore, scrollArmed, first: first?.token, held: held.token })
    await shot(article, 'desktop-inpage-armed.png', false)
    await article.keyboard.press('Space')
    const started = await until(() => bar(id), (b) => b?.playing === true, 1500)
    check('Space starts the armed reading and clears the hint', started?.playing === true && started.notice === null, started && { playing: started.playing, notice: started.notice })
    await article.waitForTimeout(250)
    const playingBar = await bar(id)
    check('The bar keeps its width and Play stays put when reading starts', !!info && !!playingBar && Math.abs(playingBar.panel.w - info.panel.w) <= 2 && Math.abs(playingBar.buttons['Pause'].x - info.buttons['Play'].x) <= 2, { armed: info?.panel.w, playing: playingBar?.panel.w, armedPlay: info?.buttons['Play']?.x, playingPause: playingBar?.buttons['Pause']?.x })
    await article.waitForTimeout(700)
    const glided = (await now(article))!
    check('The first Play glides the line to 36% of the window', Math.abs(glided.top - 900 * 0.36) <= (glided.bottom - glided.top) * 1.5 && paraNumber(glided.block) === 20, { top: glided.top, block: glided.block })
    await shot(article, 'desktop-inpage-article.png', false)
    await article.keyboard.press('Escape')
    await article.waitForTimeout(150)
    await article.close()
  })

  await section('In-page: Play button and Start on press', async () => {
    await setSettings({ wpm: 300, chunk: 1, autoStart: false })
    const p = await open('/article?play-button')
    await scrollToPara(p, 8)
    const id = await pace(p)
    await armedBar(id)
    await clickBar(p, id, 'Play')
    const played = await until(() => bar(id), (b) => b?.playing === true, 1500)
    check('The bar’s Play button starts an armed reading', played?.playing === true && played.notice === null, played && { playing: played.playing, notice: played.notice })
    await pressGap()
    await pace(p)
    await until(() => bar(id), (b) => b === null, 1500)
    await setSettings({ autoStart: true })
    await pressGap()
    await pace(p)
    const auto = await until(() => bar(id), (b) => b !== null && !b.loading, 4000)
    const a = await until(() => now(p), (v) => v !== null)
    await p.waitForTimeout(1000)
    const b = await now(p)
    check('With Start on press on, the press plays at once', auto?.playing === true && auto.notice === null && !!a && !!b && b.token > a.token, auto && { playing: auto.playing, notice: auto.notice, from: a?.token, to: b?.token })
    await setSettings({ autoStart: false })
    await p.close()
  })

  await section('In-page: settings panel', async () => {
    await setSettings({ wpm: 300, chunk: 1, smart: true, pauses: true, autoStart: false })
    const pacing = await open('/pacing?settings')
    await scrollToPara(pacing, 6)
    const pacingId = await pace(pacing)
    await armedBar(pacingId)
    const other = await open('/article?other')
    await scrollToPara(other, 6)
    const otherId = await pace(other)
    await armedBar(otherId)
    const p = await open('/article?settings')
    await scrollToPara(p, 12)
    const id = await pace(p)
    const armed = (await armedBar(id))!
    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id)
    await p.waitForTimeout(300)
    const opened = (await settingsOf(id))!
    const centre = (b: Box) => b.x + b.w / 2
    check('The sliders button opens the panel above the bar, centred on it', opened.open && opened.expanded === 'true' && opened.box.y + opened.box.h <= armed.panel.y && Math.abs(centre(opened.box) - centre(armed.panel)) <= 1 && opened.box.w === 360, { panel: opened.box, bar: armed.panel })
    check('The panel shows the current values 1, On, On, Off', Object.entries({ 'Words at a time': '1', 'Smart pacing': 'On', 'Pause at punctuation': 'On', 'Start on press': 'Off' }).every(([k, v]) => opened.checked[k] === v) && Object.keys(opened.checked).length === 4, opened.checked)
    check('The panel lists the shortcuts with Esc closing settings first', opened.hints.includes('Rare and long words get more time') && opened.keys.includes('Close settings, pause, then stop'), { hints: opened.hints, keys: opened.keys })
    await shot(p, 'desktop-inpage-settings.png', false)
    await clickBar(p, id, 'Reading settings')
    const shut = await settingsOpen(id, false)
    check('The sliders button closes the panel again', shut?.open === false && shut.expanded === 'false')
    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id)
    await p.mouse.click(40, 300)
    const outside = await settingsOpen(id, false)
    const stillArmed = await bar(id)
    check('A click outside the bar closes the panel and the reading stays armed', outside?.open === false && stillArmed?.notice === ARMED && !stillArmed.playing, { open: outside?.open, notice: stillArmed?.notice })
    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id)
    const heldArmed = (await now(p))!
    const word = await wordCentre(p, paraNumber(heldArmed.block) + 1, 'number')
    await p.mouse.click(word.x, word.y)
    const dismissed = await settingsOpen(id, false)
    await p.waitForTimeout(300)
    const [afterWord, nowAfter] = [await bar(id), await now(p)]
    check('A click on a word that closes the panel only closes it, and the reading stays armed where it was', dismissed?.open === false && afterWord?.notice === ARMED && !afterWord.playing && nowAfter?.token === heldArmed.token, { open: dismissed?.open, notice: afterWord?.notice, playing: afterWord?.playing, held: heldArmed.text, now: nowAfter?.text })
    await p.mouse.move(700, 300)
    await p.mouse.wheel(0, 2500)
    await p.waitForTimeout(500)
    const away = await p.evaluate(() => scrollY)
    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id)
    await clickSetting(p, id, 'Words at a time', '2')
    await until(() => now(p), (v) => v?.text.trim().split(/\s+/).length === 2, 1500)
    await clickSetting(p, id, 'Words at a time', '1')
    await until(getSettings, (v) => v.chunk === 1, 1500)
    await p.waitForTimeout(400)
    const [stayed, armedAway] = [await p.evaluate(() => scrollY), await bar(id)]
    check('A Words change while armed leaves the page where the reader scrolled it', away > 1500 && stayed === away && armedAway?.notice === ARMED, { away, stayed, notice: armedAway?.notice })
    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id, false)

    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id)
    await p.keyboard.press('Space')
    const playing = await until(() => bar(id), (b) => b?.playing === true, 1500)
    const closedOnPlay = await settingsOpen(id, false)
    await clickBar(p, id, 'Reading settings')
    const reopened = await settingsOpen(id)
    await p.keyboard.press('Escape')
    const escOnce = await settingsOpen(id, false)
    const afterEsc = await bar(id)
    await p.keyboard.press('Escape')
    const paused = await until(() => bar(id), (b) => b?.playing === false, 1000)
    check('Space with the panel open closes it and plays, and with the panel opened while playing Esc closes it, keeps playing, then pauses', playing?.playing === true && closedOnPlay?.open === false && reopened?.open === true && escOnce?.open === false && afterEsc?.playing === true && paused?.playing === false, { playing: playing?.playing, closedOnPlay: closedOnPlay?.open, reopened: reopened?.open, open: escOnce?.open, afterEsc: afterEsc?.playing, paused: paused?.playing })

    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id)
    await clickSetting(p, id, 'Words at a time', '2')
    const two = await until(getSettings, (v) => v.chunk === 2, 1500)
    const pair = await until(() => now(p), (v) => v?.text.trim().split(/\s+/).length === 2, 1500)
    const otherBar = await until(() => bar(otherId), (b) => b?.chunk === '2 words', 1500)
    let readerChunk: string | null = null
    if (pdfAgain) {
      const toggle = pdfAgain.locator('button[aria-label="Reading settings"]')
      await toggle.click()
      readerChunk = await pdfAgain.locator('[role=radiogroup][aria-label="Words at a time"] [aria-checked=true]').textContent({ timeout: 2000 })
      await toggle.click()
    }
    check('Words 2 saves to storage, lights two words, and reaches another page’s bar and the reader tab', two.chunk === 2 && !!pair && otherBar?.chunk === '2 words' && (pdfAgain === null || readerChunk === '2'), { chunk: two.chunk, now: pair?.text, other: otherBar?.chunk, reader: readerChunk })

    await clickSetting(p, id, 'Smart pacing', 'Off')
    await clickSetting(p, id, 'Pause at punctuation', 'Off')
    const plain = (await until(getSettings, (v) => (v as { smart?: boolean }).smart === false && (v as { pauses?: boolean }).pauses === false, 1500)) as { smart?: boolean; pauses?: boolean }
    const plainPanel = await settingsOf(id)
    check('Smart pacing and Pause at punctuation Off save to storage and swap the hint', plain.smart === false && plain.pauses === false && !!plainPanel?.hints.includes('Every word gets the same time'), { smart: plain.smart, pauses: plain.pauses, hints: plainPanel?.hints })
    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id, false)
    await setSettings({ wpm: 600, chunk: 1 })
    await pacing.bringToFront()
    await pacing.keyboard.press('Space')
    await until(() => bar(pacingId), (b) => b?.playing === true, 1500)
    await pacing.waitForTimeout(1000)
    const paced = await measurePace(pacing, 600, { smart: false, pauses: false })
    check('A page already armed when both go Off plays at the even pacing, within 15% and nearer it than the smart pacing with pauses', pacedRight(paced), paced)
    await pacing.close()
    await p.bringToFront()

    await clickBar(p, id, 'Reading settings')
    await settingsOpen(id)
    await clickSetting(p, id, 'Start on press', 'On')
    const auto = (await until(getSettings, (v) => (v as { autoStart?: boolean }).autoStart === true, 1500)) as { autoStart?: boolean }
    await p.keyboard.press('Escape')
    await settingsOpen(id, false)
    await p.keyboard.press('Escape')
    const gone = await until(() => bar(id), (b) => b === null, 1500)
    await pressGap()
    await pace(p)
    const playsAtOnce = await until(() => bar(id), (b) => b !== null && !b.loading && b.playing, 4000)
    check('Start on press On saves, Esc Esc stops, and the next press plays at once', auto.autoStart === true && gone === null && playsAtOnce?.playing === true && playsAtOnce.notice === null, { autoStart: auto.autoStart, stopped: gone === null, playing: playsAtOnce?.playing, notice: playsAtOnce?.notice })
    await setSettings({ wpm: 300, chunk: 1, smart: true, pauses: true, autoStart: false })
    await p.close()
    await other.close()

    const short = await open('/article?short')
    await short.setViewportSize({ width: 1280, height: 720 })
    await scrollToPara(short, 10)
    const shortId = await pace(short)
    await armedBar(shortId)
    await clickBar(short, shortId, 'Reading settings')
    const shortOpen = (await settingsOpen(shortId))!
    await short.keyboard.press('Space')
    await until(() => bar(shortId), (b) => b?.playing === true, 1500)
    await short.waitForTimeout(700)
    const [shortLine, shortAfter] = [(await now(short))!, (await settingsOf(shortId))!]
    const lineBox = { x: 0, y: shortLine.top, w: 1280, h: shortLine.bottom - shortLine.top }
    check('At 1280x720 the reading line never plays under the settings panel', !(shortAfter.open && intersects(lineBox, shortAfter.box)), { open: shortAfter.open, panel: shortOpen.box, line: [shortLine.top, shortLine.bottom] })
    await short.close()
  })

  await section('In-page: play 3 s at 600 wpm', async () => {
    await setSettings({ wpm: 600, chunk: 1 })
    const p = await open('/article?play')
    await scrollToPara(p, 5)
    await p.evaluate(() => {
      ;(window as unknown as { longTasks: number[] }).longTasks = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) (window as unknown as { longTasks: number[] }).longTasks.push(Math.round(e.duration))
      }).observe({ type: 'longtask', buffered: false })
    })
    const playId = await pace(p)
    await startWithSpace(p, playId)
    const a = (await until(() => now(p), (v) => v !== null))!
    await p.waitForTimeout(1300)
    const placeEarly = await placeOf(p.url())
    const tops: number[] = []
    const lineHeight = a.bottom - a.top
    for (let k = 0; k < 8; k++) {
      await p.waitForTimeout(250)
      const v = await now(p)
      if (v) tops.push(Math.round(v.top))
    }
    const b = (await now(p))!
    const placeLate = await placeOf(p.url())
    const band = 900 * 0.36
    const offBand = tops.filter((t) => Math.abs(t - band) > lineHeight * 1.5)
    check('Play advances at least 20 words in 3 s at 600 wpm', b.token - a.token >= 20, { from: a.token, to: b.token })
    check('The active line stays within about a line of 36% of the window', offBand.length <= 1, { band, lineHeight, tops })
    check('The place in storage changes during play', !!placeEarly && !!placeLate && placeLate.index > placeEarly.index, { placeEarly, placeLate })
    const longTasks = await p.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks)
    check('No task over 50 ms while playing', longTasks.length === 0, longTasks)
    await p.close()

    await setSettings({ wpm: 600, chunk: 1, smart: true, pauses: true })
    const pacing = await open('/pacing?play')
    await scrollToPara(pacing, 5)
    const pacingId = await pace(pacing)
    await startWithSpace(pacing, pacingId)
    await pacing.waitForTimeout(1000)
    const paced = await measurePace(pacing, 600, { smart: true, pauses: true })
    check('Play keeps to the smart pacing with pauses over 2 s at 600 wpm, within 15% and nearer it than even pacing', pacedRight(paced), paced)
    await pacing.close()
  })

  await section('In-page: sticky contents at 40% and 70%', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    for (const f of [0.4, 0.7]) {
      const p = await open(`/toc?at=${f}`)
      await scrollToFraction(p, f)
      await p.waitForTimeout(200)
      const visible = await firstVisible(p)
      const id = await tabIdOf(p.url())
      const extracted = await sw.evaluate(async (tabId) => {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] })
        const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis as unknown as { __pacerExtract: () => unknown }).__pacerExtract() })
        return frame?.result as { ok: boolean; text: string; startParagraph: number }
      }, id)
      await pace(p, p.url(), id)
      const n = (await until(() => now(p), (v) => v !== null))!
      const ordinalGap = Math.abs(n.blockOrdinal - visible.ordinal)
      check(`TOC at ${f * 100}%: start is within one paragraph of the first visible one`, ordinalGap <= 1, { visible, start: n.block })
      const tabPara = extracted.text.split('\n\n')[extracted.startParagraph]?.replace(/^#+ /, '') ?? ''
      check(`TOC at ${f * 100}%: the reader-tab route picks the same paragraph`, tabPara.slice(0, 30) === (n.block ?? '').slice(0, 30), { tabPara: tabPara.slice(0, 40), inPage: n.block })
      await p.close()
    }
    const toc = await open('/toc?armed')
    const tocId = await pace(toc)
    const armedAt = (await until(() => now(toc), (v) => v !== null))!
    await armedBar(tocId)
    await toc.click('a[href="#s5"]')
    await toc.waitForTimeout(300)
    const linked = await toc.evaluate(() => scrollY)
    const inView = await firstVisible(toc)
    await toc.keyboard.press('Space')
    await until(() => bar(tocId), (b) => b?.playing === true, 1500)
    await toc.waitForTimeout(600)
    const [fromLink, scrolled] = [(await now(toc))!, await toc.evaluate(() => scrollY)]
    check('Space after a contents link scrolled an armed page starts at the section in view, not back at the old start', Math.abs(fromLink.blockOrdinal - inView.ordinal) <= 1 && fromLink.blockOrdinal !== armedAt.blockOrdinal && scrolled > linked - 900, { armed: armedAt.block, visible: inView.text, started: fromLink.block, linked, scrolled })
    await toc.close()
  })

  await section('In-page: title not shown on the page', async () => {
    const p = await open('/title')
    const pagesBefore = ctx.pages().length
    await pace(p)
    const n = await until(() => now(p), (v) => v !== null)
    check('A page whose title is not on screen starts at its h1, in place', n?.text === 'How' && ctx.pages().length === pagesBefore, n)
    await p.close()
  })

  await section('In-page: keys', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const p = await open('/keys')
    const id = await pace(p)
    await until(() => now(p), (v) => v !== null)
    await p.waitForTimeout(300)
    const log = () => p.evaluate(() => (window as unknown as { log: string[] }).log.splice(0))
    await log()
    await armedBar(id)
    await p.keyboard.press('Space')
    const begun = await until(() => bar(id), (b) => b?.playing === true, 1000)
    await p.keyboard.press('Space')
    const paused = await until(() => bar(id), (b) => b?.playing === false, 1000)
    await p.keyboard.press('Space')
    const played = await until(() => bar(id), (b) => b?.playing === true, 1000)
    check('Space starts, pauses and plays', begun?.playing === true && paused?.playing === false && played?.playing === true)
    await p.keyboard.press('Space')
    await p.waitForTimeout(150)
    const t = (await now(p))!
    await p.keyboard.press('ArrowRight')
    await p.waitForTimeout(100)
    const right = (await now(p))!
    await p.keyboard.press('ArrowLeft')
    await p.waitForTimeout(100)
    const left = (await now(p))!
    check('→ moves one chunk on and ← one word back', right.token === t.token + 1 && left.token === t.token, { t: t.token, right: right.token, left: left.token })
    await p.keyboard.press('Shift+ArrowRight')
    await p.waitForTimeout(100)
    const sentence = (await now(p))!
    check('Shift+→ moves to the next sentence', /^Paragraph\d+$/.test(sentence.text) && sentence.blockOrdinal === t.blockOrdinal + 1, { from: t.block, to: sentence.block })
    const wpmBefore = (await getSettings()).wpm ?? 300
    await p.keyboard.press('ArrowUp')
    await p.waitForTimeout(400)
    const wpmAfter = (await getSettings()).wpm
    check('↑ saves wpm + 25', wpmAfter === wpmBefore + 25, { wpmBefore, wpmAfter })
    if (pdfAgain) {
      await pdfAgain.waitForTimeout(200)
      check('An open reader tab shows the new speed', (await pdfAgain.locator('.pc-wpm-value strong').textContent()) === String(wpmAfter))
    }
    const heard = await log()
    check('Page key handlers do not hear handled keys', !heard.some((e) => /^doc-key(down|up):( |Arrow)/.test(e)), heard)

    const at = (await now(p))!.token
    await p.focus('#field')
    await p.keyboard.type(' x')
    await p.keyboard.press('ArrowLeft')
    await p.keyboard.press('ArrowRight')
    const field = await p.inputValue('#field')
    await p.evaluate(() => (document.getElementById('open')!.shadowRoot!.getElementById('ta') as HTMLTextAreaElement).focus())
    await p.keyboard.type(' y')
    await p.keyboard.press('ArrowLeft')
    const ta = await p.evaluate(() => (document.getElementById('open')!.shadowRoot!.getElementById('ta') as HTMLTextAreaElement).value)
    await p.evaluate(() => {
      const ce = document.getElementById('open')!.shadowRoot!.getElementById('ce') as HTMLElement
      ce.focus()
      getSelection()!.collapse(ce.firstChild!, ce.textContent!.length)
    })
    await p.keyboard.type(' z')
    const ce = await p.evaluate(() => document.getElementById('open')!.shadowRoot!.getElementById('ce')!.textContent)
    await p.evaluate(() => (window as unknown as { closedTa: HTMLTextAreaElement }).closedTa.focus())
    await p.keyboard.type(' w')
    await p.keyboard.press('ArrowRight')
    const cta = await p.evaluate(() => (window as unknown as { closedTa: HTMLTextAreaElement }).closedTa.value)
    const stillAt = (await now(p))!.token
    check('Typing in a field, open-shadow textarea and editor, and closed-shadow textarea reaches them', field === ' x' && ta === ' y' && ce === 'edit me z' && cta === ' w', { field, ta, ce, cta })
    check('Typing there leaves the reading place alone', stillAt === at, { at, stillAt })
    await log()
    await p.focus('#rb')
    await p.keyboard.press('Space')
    await p.focus('#sum')
    await p.keyboard.press('Space')
    await p.focus('#t1')
    await p.keyboard.press('ArrowRight')
    const widgetLog = await log()
    const detailsOpen = await p.evaluate(() => (document.getElementById('det') as HTMLDetailsElement).open)
    check('Space on role=button and summary, and → in a tablist reach the page', widgetLog.includes('rb-activated') && detailsOpen && widgetLog.includes('tablist:ArrowRight'), { widgetLog, detailsOpen })
    await blurAll(p)
    await p.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<dialog id="dlg" open><p>Cookie settings</p></dialog>'))
    await log()
    await p.keyboard.press('Escape')
    const dialogLog = await log()
    check('With a dialog open, Esc reaches the page and Pacer stays', dialogLog.includes('doc-keydown:Escape') && (await bar(id)) !== null, dialogLog)
    await p.evaluate(() => document.getElementById('dlg')!.remove())
    await p.keyboard.press('Escape')
    await p.waitForTimeout(200)
    check('Esc while paused stops', (await bar(id)) === null && (await now(p)) === null)
    await log()
    await p.keyboard.press('Space')
    const afterStop = await log()
    check('Keys reach the page again after stop', afterStop.includes('doc-keydown: '), afterStop)
    await p.close()
  })

  await section('In-page: pointer', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const p = await open('/article?pointer')
    await scrollToPara(p, 10)
    const id = await pace(p)
    await until(() => now(p), (v) => v !== null)
    await armedBar(id)
    const start = (await now(p))!
    const target = await p.evaluate((n) => {
      const el = [...document.querySelectorAll('p')].find((e) => e.textContent!.startsWith(`Paragraph ${n} `))!
      const node = el.firstChild as Text
      const at = node.data.indexOf('number')
      const r = document.createRange()
      r.setStart(node, at)
      r.setEnd(node, at + 6)
      const b = r.getBoundingClientRect()
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }, paraNumber(start.block) + 1)
    await p.mouse.click(target.x, target.y)
    const clicked = (await until(() => now(p), (v) => v?.text === 'number', 1000, 10))!
    const startedAt = await until(() => bar(id), (b) => b?.playing === true, 1000)
    check('Clicking a word while armed starts reading at that word', clicked.text === 'number' && paraNumber(clicked.block) === paraNumber(start.block) + 1 && startedAt?.playing === true && startedAt.notice === null, { clicked: clicked.text, block: clicked.block, playing: startedAt?.playing })
    await p.keyboard.press('Space')
    await until(() => bar(id), (b) => b?.playing === false, 1000)
    const held = (await now(p))!
    const info = (await bar(id))!
    await p.mouse.click(info.panel.x + 4, info.panel.y + info.panel.h / 2)
    await p.waitForTimeout(150)
    check('A click on the bar edge leaves the place alone', (await now(p))!.token === held.token)
    const pausedAt = paraNumber(held.block) + 1
    await scrollStill(p)
    const pausedTarget = await wordCentre(p, pausedAt, 'number')
    await p.mouse.click(pausedTarget.x, pausedTarget.y)
    const movedTo = await until(() => now(p), (v) => v?.text === 'number' && paraNumber(v.block) === pausedAt, 1000, 10)
    await p.waitForTimeout(300)
    const stillPaused = await bar(id)
    check('Clicking a word while paused moves there without starting', movedTo?.text === 'number' && paraNumber(movedTo.block) === pausedAt && stillPaused?.playing === false, { now: movedTo?.text, block: movedTo?.block, playing: stillPaused?.playing })
    await p.keyboard.press('Space')
    await p.waitForTimeout(400)
    await p.mouse.move(700, 400)
    await p.mouse.wheel(0, 300)
    const wheeled = await until(() => bar(id), (b) => b?.playing === false, 1000)
    check('A wheel pauses', wheeled?.playing === false)
    await p.evaluate(() => window.scrollBy(0, 2400))
    await p.waitForTimeout(200)
    const visible = await firstVisible(p)
    await p.keyboard.press('Space')
    await p.waitForTimeout(150)
    const reanchored = (await now(p))!
    check('Play after scrolling the line away starts at the paragraph in view', Math.abs(reanchored.blockOrdinal - visible.ordinal) <= 1, { visible, reanchored: reanchored.block })
    await p.close()
  })

  await section('In-page: stop and resume', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const p = await open('/article?stop')
    await scrollToPara(p, 12)
    const id = await pace(p)
    await until(() => now(p), (v) => v !== null)
    await startWithSpace(p, id)
    await p.waitForTimeout(1000)
    await p.keyboard.press('Escape')
    const paused = await until(() => bar(id), (b) => b?.playing === false, 1000)
    const word = (await now(p))!
    const scrollBefore = await p.evaluate(() => scrollY)
    await p.keyboard.press('Escape')
    await p.waitForTimeout(200)
    const scrollAfter = await p.evaluate(() => scrollY)
    const place = await placeOf(p.url())
    check('The first Esc pauses and the second stops, clearing bar and highlights', paused?.playing === false && (await bar(id)) === null && (await p.evaluate(() => [...CSS.highlights.keys()].length)) === 0)
    check('The stop leaves the scroll where it was', scrollAfter === scrollBefore, { scrollBefore, scrollAfter })
    check('The place is saved', !!place && place.index > 0, place)
    await pressGap()
    await pace(p)
    const resumed = await until(() => now(p), (v) => v !== null)
    const resumedBar = await armedBar(id)
    check('Pressing again resumes the same word, armed', resumed?.token === word.token && resumedBar?.notice === ARMED, { before: word.token, after: resumed?.token, notice: resumedBar?.notice })
    await pressGap()
    await pace(p)
    await p.waitForTimeout(150)
    check('A second toolbar press while active stops', (await bar(id)) === null)
    await pressGap()
    const pagesBefore = ctx.pages().length
    // Timers in the service worker can fire late, so the second press goes out on the next microtask, as a key repeat would.
    const gap = await sw.evaluate(async (tabId) => {
      const tab = await chrome.tabs.get(tabId)
      const go = (self as unknown as { paceTab: (t: chrome.tabs.Tab) => Promise<void> }).paceTab
      const t0 = Date.now()
      let second = 0
      await Promise.all([go(tab), Promise.resolve().then(() => {
        second = Date.now() - t0
        return go(tab)
      })])
      return second
    }, id)
    const single = await until(() => now(p), (v) => v !== null, 2000)
    const bars = await p.locator('pacer-bar').count()
    const doubled = await bar(id)
    check('Two presses within 300 ms start one armed session', bars === 1 && single !== null && doubled?.playing === false && doubled.notice === ARMED, { gap, bars, now: single?.text, notice: doubled?.notice, pages: ctx.pages().length - pagesBefore })
    await p.close()
  })

  await section('In-page: Open in tab parity and exit sync', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const article = await open('/article')
    await scrollToPara(article, 20)
    await article.waitForTimeout(200)
    const id = await pace(article)
    await until(() => now(article), (v) => v !== null)
    await startWithSpace(article, id)
    await article.waitForTimeout(800)
    await article.keyboard.press('Space')
    await article.waitForTimeout(150)
    const inPage = (await now(article))!
    const appeared = ctx.waitForEvent('page')
    await clickBar(article, id, 'Open in a Pacer tab')
    const reader = watch(await appeared)
    await readerReady(reader)
    await reader.waitForTimeout(300)
    const place = await placeOf(article.url())
    const at = await current(reader)
    check('Open in tab opens the reader at the same word index', !!place && at.index === place.index && at.text?.replace(/\W/g, '') === inPage.text.replace(/\W/g, ''), { place, at, inPage: inPage.text })
    const readerTab = await tabInfo(await readerTabId(reader))
    const articleTab = await tabInfo(id)
    check('The reader tab opens right of the page', readerTab?.index === articleTab!.index + 1 && readerTab?.opener === id, { readerTab, articleTab })
    check('The in-page session is gone once the tab opens', (await bar(id)) === null && (await now(article)) === null)
    check('Article title drops the site name', (await reader.title()) === 'How Eyes Read', await reader.title())
    const text = await reader.locator('.pc-flow-content').textContent()
    check('Article leaves out the header and footer', !text!.includes('Copyright') && !text!.includes('Archive'))
    await shot(reader, 'desktop-article-reader.png')
    for (let i = 0; i < 3; i++) await reader.keyboard.press('Shift+ArrowRight')
    await reader.waitForTimeout(200)
    const mid = await current(reader)
    await exitTo(reader)
    check('Esc switches back to the article tab', (await tabInfo(id))?.active === true)
    await article.waitForTimeout(300)
    const atTop = await topOpening(article)
    check('The article is scrolled to the paragraph reached', atTop !== null && atTop === mid.para?.slice(0, atTop.length), { atTop, mid })
    await pressGap()
    await pace(article)
    const again = await until(() => now(article), (v) => v !== null)
    check('Pressing in-page after the tab starts in the paragraph reached', paraNumber(again?.block) === paraNumber(mid.para), { again: again?.block, mid: mid.para })
    await article.keyboard.press('Space')
    await article.keyboard.press('Escape')
    await article.close()

    const alone = await open('/article?alone')
    const aloneId = await pace(alone)
    await until(() => now(alone), (v) => v !== null)
    const appeared2 = ctx.waitForEvent('page')
    await clickBar(alone, aloneId, 'Open in a Pacer tab')
    const orphan = watch(await appeared2)
    await readerReady(orphan)
    for (let i = 0; i < 4; i++) await orphan.keyboard.press('ArrowRight')
    await orphan.waitForTimeout(200)
    const orphanMid = await current(orphan)
    await alone.close()
    for (let i = 0; i < 40 && (await tabInfo(aloneId)); i++) await Bun.sleep(50)
    await orphan.keyboard.press('Escape')
    await orphan.waitForURL(`${ORIGIN}/article?alone`, { timeout: 10000 })
    check('With the source tab closed, Esc loads the page in the Pacer tab', orphan.url() === `${ORIGIN}/article?alone`)
    await orphan.waitForTimeout(300)
    await pace(orphan)
    const resumed = await until(() => now(orphan), (v) => v !== null)
    check('That page then reads in place from the paragraph reached', paraNumber(resumed?.block) === paraNumber(orphanMid.para), { resumed: resumed?.block, orphanMid })
    openedReader = orphan
  })

  await section('In-page: plain text', async () => {
    const notes = await open('/notes.txt')
    const id = await pace(notes)
    const n = await until(() => now(notes), (v) => v !== null)
    check('A plain text file reads in place', n?.text === 'Note', n)
    await notes.keyboard.press('Space')
    const appeared = ctx.waitForEvent('page')
    await clickBar(notes, id, 'Open in a Pacer tab')
    const reader = watch(await appeared)
    await readerReady(reader)
    check('Plain text keeps its paragraphs in the tab', (await reader.locator('.pc-flow-content p').count()) === 4)
    await reader.close()
    await notes.close()
  })

  await section('Errors and badge', async () => {
    const empty = await open('/empty')
    const pagesBefore = ctx.pages().length
    const id = await pace(empty)
    const toast = await until(() => toastText(id), (t) => t !== null, 1500)
    check('A page without an article shows the toast, with no tab', toast === 'Pacer found no article text on this page.' && ctx.pages().length === pagesBefore, toast)
    const badge = await badgeOf(id)
    check('…and marks the button', badge.text === '!' && badge.title === "Pacer can't read this page", badge)
    // The toast rises in over 180 ms, so a shot taken at once catches it transparent.
    await empty.waitForTimeout(400)
    await shot(empty, 'desktop-inpage-toast.png', false)
    await empty.evaluate((html) => {
      history.pushState({}, '', '/empty?now-an-article')
      document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML
    }, ARTICLE)
    await pressGap()
    await pace(empty, `${ORIGIN}/empty?now-an-article`, id)
    await until(() => now(empty), (v) => v !== null)
    const cleared = await badgeOf(id)
    check('After a pushState, a good in-page start clears the badge', cleared.text === '' && cleared.title === 'Pace this page', cleared)
    await empty.close()

    const flaky = await open('/flaky.pdf')
    await flaky.waitForTimeout(1200)
    const { reader: flakyReader, sourceId: flakyId } = await paceInto(flaky, `${ORIGIN}/flaky.pdf`)
    await flakyReader.waitForSelector('.pc-page-lead')
    check('A failed PDF download says to reload', (await flakyReader.locator('.pc-page-lead').textContent())!.startsWith('Pacer could not download this PDF again'))
    await flakyReader.getByRole('button', { name: 'Go back' }).waitFor()
    await shot(flakyReader, 'desktop-error.png')
    const closed = flakyReader.waitForEvent('close')
    await flakyReader.getByRole('button', { name: 'Go back' }).click()
    await closed
    check('Go back closes Pacer and switches to the page', (await tabInfo(flakyId))?.active === true)
    await flaky.close()

    const { page: version, id: refusedId } = await openUnseen('chrome://version')
    await pace(version, 'chrome://version/', refusedId)
    const refused = await badgeOf(refusedId)
    check('A refused page gets the ! badge and title', refused.text === '!' && refused.title === "Pacer can't read this page", refused)
    await version.goto(`${ORIGIN}/article?after-refusal`)
    await version.waitForTimeout(300)
    const navCleared = await badgeOf(refusedId)
    check('The badge clears when the tab navigates', navCleared.text === '' && navCleared.title === 'Pace this page', navCleared)
    await version.close()
  })

  await section('Fallback: canvas and hidden text', async () => {
    const canvas = await open('/canvas')
    const { reader, sourceId } = await paceInto(canvas)
    await readerReady(reader)
    check('A canvas-painted page with hidden text opens the reader tab', reader.url().startsWith(`${READER}?doc=`) && (await reader.locator('.pc-flow-content').textContent())!.includes('Paragraph 3 '))
    check('…and leaves no bar on the page', (await bar(sourceId)) === null)
    await reader.close()
    await canvas.close()

    const hidden = await open('/hidden')
    const opened = await paceInto(hidden)
    await readerReady(opened.reader)
    const text = (await opened.reader.locator('.pc-flow-content').textContent())!
    check('/hidden maps too little and opens the reader tab with the clipped text', text.includes('Paragraph25') && text.includes('Advertisement'), text.slice(0, 80))
    await opened.reader.close()
    await hidden.close()
  })

  await section('Covered text', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const overlay = await open('/overlay')
    const id = await pace(overlay)
    await startWithSpace(overlay, id)
    const info = await until(() => bar(id), (b) => b?.notice != null && b.notice !== ARMED, 4000)
    check('A wall over the article pauses with the cover notice and Open in tab', info?.notice === 'Something on the page covers the text' && info.action === 'Open in tab' && !info.playing, info && { notice: info.notice, action: info.action })
    await shot(overlay, 'desktop-inpage-covered.png', false)
    await overlay.close()

    await setSettings({ wpm: 1200 })
    const cap = await open('/caption')
    const capId = await pace(cap)
    await until(() => now(cap), (v) => v !== null)
    await startWithSpace(cap, capId)
    const passed = await until(() => now(cap), (v) => paraNumber(v?.block) >= 5, 20000, 100)
    const capBar = await bar(capId)
    check('A caption under a positioned box is skipped without pausing', paraNumber(passed?.block) >= 5 && capBar?.playing === true && capBar.notice === null, { at: passed?.block, notice: capBar?.notice })
    await cap.close()
  })

  await section('Re-render', async () => {
    await setSettings({ wpm: 600, chunk: 1 })
    const p = await open('/rerender')
    const rerenderId = await pace(p)
    await until(() => now(p), (v) => v !== null)
    await startWithSpace(p, rerenderId)
    await p.waitForTimeout(1200)
    const before = (await now(p))!
    const t0 = Date.now()
    await p.evaluate(() => (window as unknown as { rerender: () => void }).rerender())
    await p.waitForTimeout(450)
    await p.evaluate(() => (window as unknown as { rerender: () => void }).rerender())
    const tLast = Date.now()
    const back = await until(() => now(p), (v) => v !== null && v.connected, 2500, 25)
    const tBack = Date.now()
    const budget = ((tBack - t0) * 600) / 60000
    check('The highlight is back within about 1 s of the last replacement', !!back && tBack - tLast <= 1250, { ms: tBack - tLast })
    check('The index moves no more than one chunk past the time budget', !!back && back.token - before.token <= Math.ceil(budget) + 1, { moved: back && back.token - before.token, budget: +budget.toFixed(1) })
    const info = await bar(await tabIdOf(p.url()))
    check('No notice after the re-render', info?.notice === null && info.playing, info?.notice)
    await p.close()
  })

  await section('Navigation', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const spa = await open('/spa')
    const id = await pace(spa)
    await until(() => now(spa), (v) => v !== null)
    await spa.keyboard.press('Space')
    await spa.evaluate(() => (window as unknown as { go: () => void }).go())
    await spa.waitForTimeout(300)
    check('pushState to another path removes the bar and highlights', (await bar(id)) === null && (await now(spa)) === null)
    await spa.close()

    await setSettings({ wpm: 1200 })
    const spy = await open('/scrollspy')
    const spyId = await pace(spy)
    await until(() => now(spy), (v) => v !== null)
    await startWithSpace(spy, spyId)
    await spy.waitForTimeout(4500)
    const hash = await spy.evaluate(() => location.hash)
    const info = await bar(spyId)
    check('A scrollspy rewriting the hash during play keeps the session', hash !== '' && info !== null && info.playing && (await now(spy)) !== null, { hash, playing: info?.playing })
    await spy.close()
  })

  await section('Virtual list and Read on', async () => {
    await setSettings({ wpm: 1200, chunk: 1 })
    const v = await open('/virtual')
    const id = await pace(v)
    const first = await until(() => now(v), (n) => n !== null)
    await startWithSpace(v, id)
    const progressBox = await sw.evaluate(async (tabId) => {
      const [frame] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const root = chrome.dom.openOrClosedShadowRoot(document.querySelector('pacer-bar') as HTMLElement)!
          const r = root.querySelector('.progress')!.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        },
      })
      return frame?.result as { x: number; y: number; w: number; h: number }
    }, id)
    await v.mouse.click(progressBox.x + progressBox.w * 0.8, progressBox.y + progressBox.h / 2)
    const ended = await until(() => bar(id), (b) => b?.notice != null, 20000, 200)
    const lastRow = await now(v)
    check('Rows unmounting behind the reader never pause it with "This page changed"', ended?.notice === 'End of the page' && ended.action === 'Read on', { notice: ended?.notice, first: first?.block })
    await clickBar(v, id, 'Read on')
    const again = await until(() => now(v), (n) => n !== null, 3000)
    await v.waitForTimeout(300)
    const after = await bar(id)
    check('Read on plays at once from the band with the rows rendered since', !!again && after?.playing === true && after.progress < 100 && paraNumber(again.block) >= paraNumber(lastRow?.block) - 8, { again: again?.block, lastRow: lastRow?.block, progress: after?.progress })
    await v.close()
  })

  await section('Hidden tab', async () => {
    await setSettings({ wpm: 300 })
    const p = await open('/article?hidden')
    const id = await pace(p)
    await until(() => now(p), (n) => n !== null)
    await startWithSpace(p, id)
    const other = await newPage()
    await other.bringToFront()
    await p.waitForTimeout(300)
    const state = await p.evaluate(() => document.visibilityState)
    const info = await bar(id)
    if (state === 'hidden') check('Switching tabs pauses', info?.playing === false, info?.playing)
    else notes.push(`Headless kept visibilityState '${state}' after bringToFront, so the unit test covers the hidden-tab pause.`)
    await other.close()
    await p.close()
  })

  await section('Hostile pages', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const strict = await open('/strict')
    const id = await pace(strict)
    const n = await until(() => now(strict), (v) => v !== null)
    const info = await until(() => bar(id), (b) => b !== null && !b.loading)
    check('A strict-CSP page still gets the highlight and a styled bar', n?.text === 'Strict' && !!info && info.bg !== 'rgba(0, 0, 0, 0)' && info.panel.h >= 40, { now: n?.text, bg: info?.bg, h: info?.panel.h })
    check('Page CSS with !important does not reach the bar', !!info && !/comic/i.test(info.font), info?.font)
    await strict.keyboard.press('Space')
    await strict.waitForTimeout(200)
    await shot(strict, 'desktop-inpage-strict.png', false)
    await strict.close()

    const sc = await open('/scroller')
    await sc.emulateMedia({ colorScheme: 'dark' })
    await sc.evaluate(() => (document.getElementById('scroller')!.scrollTop = 1200))
    await sc.waitForTimeout(100)
    const visible = await firstVisible(sc)
    await setSettings({ wpm: 900 })
    const scId = await pace(sc)
    const first = (await until(() => now(sc), (v) => v !== null))!
    const darkArmed = await armedBar(scId)
    check('The armed bar turns dark with its hint on a dark page', !!darkArmed && isDark(darkArmed.bg) && darkArmed.notice === ARMED, darkArmed && { bg: darkArmed.bg, notice: darkArmed.notice })
    await sc.waitForTimeout(300)
    await shot(sc, 'desktop-inpage-armed-dark.png', false)
    await startWithSpace(sc, scId)
    await sc.waitForTimeout(600)
    const startTop = await sc.evaluate(() => document.getElementById('scroller')!.scrollTop)
    await sc.waitForTimeout(3000)
    const scrolled = await sc.evaluate(() => ({ window: scrollY, startTop: document.getElementById('scroller')!.scrollTop, div: document.getElementById('scroller')!.scrollTop }))
    scrolled.startTop = startTop
    const dark = await now(sc)
    check('An inner scroller starts at its paragraph in view', Math.abs(first.blockOrdinal - visible.ordinal) <= 1, { visible, first: first.block })
    check('An inner scroller scrolls its div, not the window', scrolled.window === 0 && scrolled.div > scrolled.startTop, scrolled)
    check('Light text on a dark page gets the dark highlight', dark?.dark === true, dark?.names)
    await sc.keyboard.press('Space')
    await sc.waitForTimeout(200)
    await shot(sc, 'desktop-inpage-dark.png', false)
    await clickBar(sc, scId, 'Reading settings')
    const darkSettings = await settingsOpen(scId)
    await sc.waitForTimeout(300)
    check('The settings panel turns dark with the bar on a dark page', !!darkSettings?.open && isDark(darkSettings.bg), darkSettings && { open: darkSettings.open, bg: darkSettings.bg })
    await shot(sc, 'desktop-inpage-settings-dark.png', false)
    await sc.close()
  })

  await section('hla.dev-like page', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    for (const f of [0, 0.4, 0.7]) {
      const p = await open(`/hla?at=${f}`)
      await scrollToFraction(p, f)
      await p.waitForTimeout(200)
      const visible = await firstVisible(p, 'main')
      const id = await pace(p)
      const n = (await until(() => now(p, 'main'), (v) => v !== null))!
      const info = (await until(() => bar(id), (b) => b !== null && !b.loading))!
      const navs = await p.evaluate(() =>
        ['.leftnav', '.contents'].map((s) => {
          const r = document.querySelector(s)!.getBoundingClientRect()
          return { x: r.x, y: r.y, w: r.width, h: r.height }
        }),
      )
      check(`hla at ${f * 100}%: start matches the first visible paragraph`, n.blockOrdinal === visible.ordinal, { visible, start: n.block })
      check(`hla at ${f * 100}%: the bar overlaps neither nav`, !navs.some((b) => intersects(b, info.panel)), { bar: info.panel, navs })
      if (f === 0.4) await p.waitForTimeout(300).then(() => shot(p, 'desktop-inpage-hla.png', false))
      await p.close()
    }
    const linked = await open('/hla?link')
    // hla.dev scrolls its contents links with a script, which leaves focus on the link.
    await linked.evaluate(() =>
      document.querySelectorAll<HTMLAnchorElement>('.contents a').forEach((a) =>
        a.addEventListener('click', (e) => {
          e.preventDefault()
          document.querySelector(a.hash)!.scrollIntoView()
        }),
      ),
    )
    await linked.click('.contents a[href="#h2"]')
    await linked.waitForTimeout(300)
    const focused = await linked.evaluate(() => document.activeElement?.getAttribute('href') ?? document.activeElement?.localName)
    const linkedId = await pace(linked)
    await armedBar(linkedId)
    const before = await linked.evaluate(() => scrollY)
    await linked.keyboard.press('Space')
    const spaced = await until(() => bar(linkedId), (b) => b?.playing === true, 1500)
    await linked.waitForTimeout(400)
    const after = await linked.evaluate(() => scrollY)
    check('Space starts an armed reading while a clicked contents link holds focus', focused === '#h2' && spaced?.playing === true && spaced.notice === null && Math.abs(after - before) < 450, { focused, playing: spaced?.playing, notice: spaced?.notice, before, after })
    await linked.close()
  })

  await section('Keyboard focus', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const NO_SPACE = 'Press Play to start'
    const tabbed = await open('/hla?tab')
    const tabbedId = await pace(tabbed)
    await armedBar(tabbedId)
    await tabbed.keyboard.press('Tab')
    const tabFocus = await tabbed.evaluate(() => ({ tag: document.activeElement?.localName, visible: document.activeElement?.matches(':focus-visible') ?? false }))
    const tabHint = (await bar(tabbedId))?.notice
    const before = await tabbed.evaluate(() => scrollY)
    await tabbed.keyboard.press('Space')
    const tabSpaced = await until(() => bar(tabbedId), (b) => b?.playing === true, 1500)
    check('Space starts an armed reading from a link the keyboard focused, and the hint offers Space there', tabFocus.tag === 'a' && tabFocus.visible && tabHint === ARMED && tabSpaced?.playing === true, { tabFocus, tabHint, playing: tabSpaced?.playing, before })
    await tabbed.close()

    const field = await open('/hla?field')
    await field.evaluate(() => {
      const input = document.createElement('input')
      input.id = 'q'
      input.style.cssText = 'position: fixed; top: 8px; left: 8px'
      document.body.append(input)
    })
    const fieldId = await pace(field)
    await armedBar(fieldId)
    await field.focus('#q')
    const noSpace = await until(() => bar(fieldId), (b) => b?.notice === NO_SPACE, 1500)
    await field.keyboard.press('Space')
    const typed = await field.inputValue('#q')
    await blurAll(field)
    const back = await until(() => bar(fieldId), (b) => b?.notice === ARMED, 1500)
    check('The armed hint offers only Play while a field has focus, and Space again once focus leaves it', noSpace?.notice === NO_SPACE && noSpace.playing === false && typed === ' ' && back?.notice === ARMED && back.playing === false, { noSpace: noSpace?.notice, typed, back: back?.notice })

    const opened = await barFocus(fieldId, 'Reading settings')
    const inBar = await until(() => bar(fieldId), (b) => b?.notice === NO_SPACE, 1500)
    await field.keyboard.press('Enter')
    const keyed = await settingsOpen(fieldId)
    const choice = await barFocus(fieldId)
    check('Opening the settings panel from the keyboard focuses the checked words-at-a-time choice', !!keyed?.open && choice === 'Words at a time: 1 (checked)', { opened, open: keyed?.open, choice })
    check('The armed hint offers only Play while focus sits on Pacer’s own bar', inBar?.notice === NO_SPACE, inBar?.notice)
    await field.waitForTimeout(300)
    await shot(field, 'desktop-inpage-settings-keyboard.png', false)
    await field.keyboard.press('Escape')
    const closedTo = await barFocus(fieldId)
    const shut = await settingsOpen(fieldId, false)
    check('Esc from a focused choice closes the panel and hands focus back to the sliders button', shut?.open === false && closedTo === 'Reading settings', { open: shut?.open, closedTo })
    await field.close()
  })

  await section('Low-severity fixes', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const links = await open('/links')
    const linksId = await pace(links)
    await until(() => now(links), (v) => v !== null)
    await links.waitForTimeout(400)
    const download = links.waitForEvent('download', { timeout: 3000 }).then(() => true).catch(() => false)
    await links.click('#dl')
    await links.waitForTimeout(1200)
    check('A download link keeps the session', (await download) && (await bar(linksId)) !== null && (await now(links)) !== null, { download: await download })
    await links.click('#mail')
    await links.waitForTimeout(1200)
    check('A mailto link keeps the session', links.url().endsWith('/links') && (await bar(linksId)) !== null && (await now(links)) !== null, links.url())
    await links.close()

    await setSettings({ wpm: 900, chunk: 1 })
    const end = await open('/end')
    await end.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await end.waitForTimeout(300)
    const endId = await pace(end)
    await until(() => now(end), (v) => v !== null)
    await armedBar(endId)
    const last = end.locator('article p').last()
    const lastBox = (await last.boundingBox())!
    await end.mouse.click(lastBox.x + 30, lastBox.y + 10)
    await end.waitForTimeout(400)
    let under: unknown = null
    let docked = false
    for (let k = 0; k < 60; k++) {
      const [n, info] = [await now(end), await bar(endId)]
      if (!n || !info) break
      if (info.panel.y < info.inner / 2) docked = true
      if (n.bottom > info.panel.y && n.top < info.panel.y + info.panel.h) {
        under = { line: [n.top, n.bottom], panel: info.panel, text: n.text }
        break
      }
      if (docked && k % 20 === 5) await shot(end, 'desktop-inpage-end-docked.png', false)
      await end.waitForTimeout(60)
    }
    check('The last lines of a page are never read under the bar', under === null && docked, { under, docked })
    const dockedBar = (await bar(endId))!
    if (dockedBar.playing) await end.keyboard.press('Space')
    await clickBar(end, endId, 'Reading settings')
    const below = await settingsOpen(endId)
    const topBar = (await bar(endId))!
    check('With the bar docked at the top the settings panel opens below it, inside the window', !!below?.open && topBar.panel.y < topBar.inner / 2 && below.box.y >= topBar.panel.y + topBar.panel.h && within(below.box, topBar.width, topBar.inner), { panel: below?.box, bar: topBar.panel })
    await shot(end, 'desktop-inpage-settings-docked.png', false)
    await end.close()

    await setSettings({ wpm: 300, chunk: 1 })
    const callout = await open('/callout')
    const calloutId = await pace(callout)
    await until(() => now(callout), (v) => v !== null)
    await startWithSpace(callout, calloutId)
    await callout.keyboard.press('Space')
    await until(() => bar(calloutId), (b) => b?.playing === false, 1000)
    const toneAt = async (id: string) => {
      const box = (await callout.locator(`#${id}`).boundingBox())!
      await callout.mouse.click(box.x + 4, box.y + 10)
      const v = await until(() => now(callout), (v) => v !== null && v.block?.startsWith(id === 'warn' ? 'Warning' : id === 'tw' ? 'Caution' : 'Sepia') === true)
      return v?.tone
    }
    const tones = { warn: await toneAt('warn'), tw: await toneAt('tw'), sepia: await toneAt('sepia') }
    check('Callouts close to the highlight yellow get the warm highlight, a sepia page keeps the yellow', tones.warn === 'warm' && tones.tw === 'warm' && tones.sepia === 'light', tones)
    await toneAt('warn')
    await callout.waitForTimeout(200)
    await shot(callout, 'desktop-inpage-callout.png', false)
    await callout.close()

    const tf = await open('/transform')
    await tf.evaluate(() => window.scrollTo(0, 800))
    await tf.waitForTimeout(200)
    const tfId = await pace(tf)
    await until(() => now(tf), (v) => v !== null)
    const tfBar = (await until(() => bar(tfId), (b) => b !== null && !b.loading))!
    await tf.waitForTimeout(300)
    const placed = (await bar(tfId))!
    const popover = await tf.evaluate(() => ['pacer-bar'].map((n) => document.querySelector(n)?.matches(':popover-open')))
    check('With a transform on html the bar sits on screen at the bottom', placed.panel.y > 0 && Math.abs(placed.panel.y + placed.panel.h - (placed.inner - 16)) <= 1, { panel: placed.panel, inner: placed.inner, popover })
    const wasPlaying = placed.playing
    await tf.keyboard.press('Space')
    await tf.waitForTimeout(200)
    const toggled = (await bar(tfId))!.playing !== wasPlaying
    await tf.keyboard.press('Space')
    await until(() => bar(tfId), (b) => b?.playing === false, 1000)
    // Play scrolls the page under the pointer, so the click point is read only once the scroll has stopped.
    let lastY = -1
    await until(async () => {
      const y = await tf.evaluate(() => scrollY)
      const still = y === lastY
      lastY = y
      await tf.waitForTimeout(150)
      return still
    }, (still) => still, 3000)
    const target = await wordCentre(tf, 7, 'Paragraph')
    await tf.mouse.click(target.x, target.y)
    const jumped = await until(() => now(tf), (v) => paraNumber(v?.block) === 7)
    check('Space and clicks still reach Pacer while its bar sits in the top layer', toggled && paraNumber(jumped?.block) === 7, { toggled, block: jumped?.block, tfBar: tfBar.panel })
    await shot(tf, 'desktop-inpage-transform.png', false)
    await clickBar(tf, tfId, 'Reading settings')
    const tfSettings = await settingsOpen(tfId)
    const tfNow = (await bar(tfId))!
    check('With a transform on html the settings panel opens on screen above the bar', !!tfSettings?.open && tfSettings.box.y + tfSettings.box.h <= tfNow.panel.y && within(tfSettings.box, tfNow.width, tfNow.inner), { panel: tfSettings?.box, bar: tfNow.panel })
    await tf.close()
  })

  await section('Right-click menu', async () => {
    await setSettings({ wpm: 300, chunk: 1, autoStart: false })
    const menu = (tabId: number, url: string, item: string, selectionText?: string) =>
      sw.evaluate(
        async ([id, u, menuItemId, text]) => {
          const tab = await chrome.tabs.get(id)
          const onMenu = (self as unknown as { onMenu: (i: object, t: chrome.tabs.Tab) => Promise<void> }).onMenu
          await onMenu({ menuItemId, selectionText: text ?? undefined, editable: false, pageUrl: u }, { ...tab, url: tab.url ?? u })
        },
        [tabId, url, item, selectionText ?? null] as const,
      )
    // Selects one word in a numbered paragraph the way a double-click would, and returns what Chrome would hand the menu.
    const selectWord = (p: Page, paragraph: number, word: number, scroll = true) =>
      p.evaluate(
        ([n, w, s]) => {
          const el = [...document.querySelectorAll('article p')].find((e) => e.textContent!.startsWith(`Paragraph ${n} `))!
          if (s) el.scrollIntoView({ block: 'center' })
          const node = el.firstChild as Text
          const at = [...node.data.matchAll(/\S+/g)][w]
          const range = document.createRange()
          range.setStart(node, at.index!)
          range.setEnd(node, at.index! + at[0].length)
          getSelection()!.removeAllRanges()
          getSelection()!.addRange(range)
          return getSelection()!.toString()
        },
        [paragraph, word, scroll] as const,
      )
    const selected = (p: Page) => p.evaluate(() => getSelection()?.toString() ?? '')

    const duplicate = await sw.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const errors: string[] = []
          for (const id of ['pace-page', 'pace-selection'])
            chrome.contextMenus.create({ id, title: id, contexts: ['page'] }, () => {
              errors.push(chrome.runtime.lastError?.message ?? '')
              if (errors.length === 2) resolve(errors)
            })
        }),
    )
    check('Install adds both menu items', duplicate.every((e) => /duplicate/i.test(e)), duplicate)

    const p = await open('/hla?menu')
    const url = p.url()
    const id = await tabIdOf(url)
    const picked = await selectWord(p, 9, 4)
    await menu(id, url, 'pace-selection', picked)
    const armed = await armedBar(id)
    const at = await until(() => now(p), (v) => v !== null)
    check('Read from here arms the bar on the selected word', armed?.notice === ARMED && paraNumber(at?.block) === 9 && at?.offset === 4 && at.text.trim() === picked, { notice: armed?.notice, block: at?.block, offset: at?.offset, text: at?.text, picked })
    check('Read from here clears the page selection so the highlight shows', (await selected(p)) === '', await selected(p))
    await shot(p, 'desktop-inpage-menu-armed.png', false)

    await p.keyboard.press('Space')
    await until(() => bar(id), (b) => b?.playing === true, 1500)
    await pressGap()
    const jump = await selectWord(p, 17, 2, false)
    await menu(id, url, 'pace-selection', jump)
    const moved = await until(() => now(p), (v) => paraNumber(v?.block) === 17, 2000)
    const stillPlaying = await bar(id)
    check('Read from here during a reading jumps to the selection and keeps playing', paraNumber(moved?.block) === 17 && (moved?.offset ?? -1) >= 2 && moved!.offset <= 4 && stillPlaying?.playing === true, { block: moved?.block, offset: moved?.offset, playing: stillPlaying?.playing })

    await pressGap()
    await menu(id, url, 'pace-page')
    await p.waitForTimeout(400)
    const kept = await bar(id)
    check('Read with Pacer during a reading leaves it playing', kept?.playing === true && (await p.locator('pacer-bar').count()) === 1, { playing: kept?.playing })

    await pressGap()
    const scrolled = await selectWord(p, 5, 3)
    const paused = await until(() => bar(id), (b) => b?.playing === false, 1500)
    await menu(id, url, 'pace-selection', scrolled)
    const back = await until(() => now(p), (v) => paraNumber(v?.block) === 5, 2000)
    const stillPaused = await bar(id)
    check('Read from here after scrolling away, which pauses, moves there and stays paused', paused?.playing === false && paraNumber(back?.block) === 5 && back?.offset === 3 && stillPaused?.playing === false, { block: back?.block, offset: back?.offset, playing: stillPaused?.playing })
    await p.close()

    const fresh = await open('/hla?menu-text')
    const freshUrl = fresh.url()
    const freshId = await tabIdOf(freshUrl)
    await menu(freshId, freshUrl, 'pace-selection', 'Paragraph 15 opens with')
    await armedBar(freshId)
    const byText = await until(() => now(fresh), (v) => v !== null)
    check('Read from here finds the selected text when the live selection is gone', paraNumber(byText?.block) === 15 && byText?.offset === 0, { block: byText?.block, offset: byText?.offset })
    await pressGap()
    await menu(freshId, freshUrl, 'pace-page')
    await fresh.waitForTimeout(200)
    check('Read with Pacer on an armed bar keeps it armed', (await bar(freshId))?.notice === ARMED)
    await fresh.close()

    const pdf = await open('/paper.pdf?menu')
    await pdf.waitForTimeout(1200)
    const pdfUrl = `${ORIGIN}/paper.pdf?menu`
    const pdfId = await tabIdOf(pdfUrl)
    const appeared = ctx.waitForEvent('page')
    await menu(pdfId, pdfUrl, 'pace-selection', 'We call our particular attention "Scaled Dot-\nProduct Attention"')
    const reader = watch(await appeared)
    await readerReady(reader)
    const start = await current(reader)
    check('Read from here on a PDF opens the reader tab at the selected text', start.index > 0 && (start.para ?? '').includes('We call our particular attention') && start.text === 'We', start)
    await shot(reader, 'desktop-pdf-menu-start.png', false)
    await reader.close()
    await pdf.close()
  })

  await section('Memory', async () => {
    const p = await open('/calm')
    await p.waitForTimeout(800)
    const s = await ctx.newCDPSession(p)
    const heap = async () => {
      await s.send('HeapProfiler.collectGarbage')
      await s.send('HeapProfiler.collectGarbage')
      return (await s.send('Runtime.getHeapUsage')).usedSize / 1048576
    }
    const base = await heap()
    await pace(p)
    await until(() => now(p), (v) => v !== null)
    await p.waitForTimeout(1200)
    await pressGap()
    await pace(p)
    await p.waitForTimeout(500)
    const after = await heap()
    check('Retained heap after a start and stop on /calm is at most 2.5 MB', after - base <= 2.5, { baseMB: +base.toFixed(2), afterMB: +after.toFixed(2), retainedMB: +(after - base).toFixed(2) })
    await p.close()
  })

  await section('Mobile width', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const p = await open('/article?mobile')
    await p.setViewportSize({ width: 390, height: 844 })
    await scrollToPara(p, 8, 80)
    const scrollBefore = await p.evaluate(() => scrollY)
    const id = await pace(p)
    const first = await until(() => now(p), (v) => v !== null)
    const info = (await armedBar(id))!
    check('At 390 px the press arms the bar with the hint and leaves the page where it was', info.notice === ARMED && !info.playing && paraNumber(first?.block) === 8 && (await p.evaluate(() => scrollY)) === scrollBefore, { notice: info.notice, block: first?.block })
    check('At 390 px the bar hides time left and the chunk label and fits the window', !info.timeShown && !info.chunkShown && info.panel.x >= 0 && info.panel.x + info.panel.w <= 390, { panel: info.panel, time: info.timeShown, chunk: info.chunkShown })
    check('At 390 px the armed bar keeps the speed control and shows the whole hint', info.wpmShown && !info.noticeClipped, { wpm: info.wpmShown, clipped: info.noticeClipped })
    await p.waitForTimeout(300)
    await shot(p, 'mobile-inpage-armed.png', false)
    await p.screenshot({ path: join(SHOTS, 'mobile-inpage-bar.png'), clip: { x: 0, y: Math.max(0, info.panel.y - 24), width: 390, height: info.panel.h + 48 } })
    await clickBar(p, id, 'Reading settings')
    const mobileSettings = await settingsOpen(id)
    await p.waitForTimeout(300)
    check('At 390 px the settings panel fits with 16 px gutters above the bar', !!mobileSettings?.open && within(mobileSettings.box, 390, 844, 16) && mobileSettings.box.y + mobileSettings.box.h <= info.panel.y, mobileSettings?.box)
    await shot(p, 'mobile-inpage-settings.png', false)
    await p.keyboard.press('Space')
    await until(() => bar(id), (b) => b?.playing === true, 1500)
    await p.waitForTimeout(600)
    await shot(p, 'mobile-inpage-article.png', false)
    await p.close()

    const covered = await open('/overlay?mobile')
    await covered.setViewportSize({ width: 390, height: 844 })
    const coveredId = await pace(covered)
    await startWithSpace(covered, coveredId)
    const noticed = (await until(() => bar(coveredId), (b) => b?.notice != null && b.notice !== ARMED, 4000))!
    check('At 390 px the cover notice and its action fit the bar', noticed.panel.x >= 0 && noticed.panel.x + noticed.panel.w <= 390, noticed.panel)
    await covered.screenshot({ path: join(SHOTS, 'mobile-inpage-covered-bar.png'), clip: { x: 0, y: Math.max(0, noticed.panel.y - 24), width: 390, height: noticed.panel.h + 48 } })
    await covered.close()

    const dark = await open('/scroller?mobile')
    await dark.setViewportSize({ width: 390, height: 844 })
    await dark.emulateMedia({ colorScheme: 'dark' })
    const darkId = await pace(dark)
    const darkArmed = (await armedBar(darkId))!
    check('At 390 px the armed bar turns dark and fits on a dark page', !!darkArmed && isDark(darkArmed.bg) && darkArmed.panel.x >= 0 && darkArmed.panel.x + darkArmed.panel.w <= 390 && !darkArmed.noticeClipped, darkArmed && { bg: darkArmed.bg, panel: darkArmed.panel })
    await dark.waitForTimeout(300)
    await shot(dark, 'mobile-inpage-armed-dark.png', false)
    await clickBar(dark, darkId, 'Reading settings')
    const darkSettings = await settingsOpen(darkId)
    await dark.waitForTimeout(300)
    check('At 390 px the settings panel turns dark and fits above the bar', !!darkSettings?.open && isDark(darkSettings.bg) && within(darkSettings.box, 390, 844, 16) && darkSettings.box.y + darkSettings.box.h <= darkArmed.panel.y, darkSettings && { bg: darkSettings.bg, box: darkSettings.box })
    await shot(dark, 'mobile-inpage-settings-dark.png', false)
    await dark.close()
  })

  await section('Reader tab: picker, files and settings', async () => {
    const { page: b, id: blankId } = await openUnseen('about:blank')
    const pagesBefore = ctx.pages().length
    await pace(b, 'about:blank', blankId)
    await b.waitForSelector('.pc-page-lead')
    check('A blank tab turns into the picker in place', b.url() === READER && ctx.pages().length === pagesBefore, b.url())
    await shot(b, 'desktop-picker.png')
    await b.locator('input[type=file]').setInputFiles(join(FIXTURES, 'alice.epub'))
    await readerReady(b)
    check('An EPUB opens from the picker', (await b.title()).includes('Alice'), await b.title())
    await b.keyboard.press('Escape')
    await b.waitForSelector('.pc-page-lead')
    check('Esc from a picked file returns to the picker', (await b.title()) === 'Pacer')

    const fileUrl = `file://${join(FIXTURES, 'attention.pdf')}`
    const local = await open(fileUrl)
    await local.waitForTimeout(1200)
    const { reader: localReader } = await paceInto(local, fileUrl)
    await readerReady(localReader)
    check('A local PDF opens in the reader', localReader.url().startsWith(`${READER}?doc=`))
    await localReader.close()
    await local.close()

    const d = await newPage()
    direct = d
    await d.goto(READER)
    await d.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('pacer', 1)
          req.onsuccess = () => {
            const tx = req.result.transaction('docs', 'readwrite')
            tx.objectStore('docs').put({ id: 'no-access', kind: 'pdf', src: 'file:///Users/me/book.pdf', title: null, error: { message: '', fileAccess: true }, at: Date.now() })
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    await d.goto(`${READER}?doc=no-access`)
    await d.waitForSelector('.pc-page-lead')
    check('File access off explains the toggle', (await d.locator('.pc-page-lead').textContent())!.includes('local files'))
    await shot(d, 'desktop-file-access.png')
    await d.goto(`${READER}?doc=gone`)
    await d.waitForSelector('.pc-page-lead')
    check('A pruned record says to press Pacer again', (await d.locator('.pc-page-lead').textContent()) === 'This document is no longer cached. Go back and press Pacer again.')

    if (pdfAgain) {
      await sw.evaluate(async () => {
        const { settings } = await chrome.storage.local.get('settings')
        await chrome.storage.local.set({ settings: { ...(settings as object), theme: 'dark' } })
      })
      await pdfAgain.waitForTimeout(300)
      await shot(pdfAgain, 'desktop-dark-pdf-reader.png')
      await setSettings({ theme: 'system' })
      for (const [p, name] of [[pdfAgain, 'pdf-reader'], [b, 'picker']] as const) {
        await p.setViewportSize({ width: 390, height: 844 })
        await p.waitForTimeout(400)
        await shot(p, `mobile-${name}.png`)
      }
    }
  })

  await section('Extension reload mid-play', async () => {
    await setSettings({ wpm: 300, chunk: 1 })
    const p = await open('/calm?reload')
    const firstId = await pace(p)
    await until(() => now(p), (v) => v !== null)
    await startWithSpace(p, firstId)
    await p.waitForTimeout(500)
    const remote = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`)
    const cdp = await remote.newBrowserCDPSession()
    const old = sw
    await cdp.send('Extensions.loadUnpacked' as never, { path: EXT } as never)
    let fresh: Worker | undefined
    for (let i = 0; i < 40 && !fresh; i++) {
      await Bun.sleep(200)
      fresh = ctx.serviceWorkers().find((w) => w !== old && w.url().includes(extId))
    }
    if (!fresh) throw new Error('no new service worker after reload')
    sw = fresh
    const gone = await until(() => p.evaluate(() => ({ bar: !!document.querySelector('pacer-bar'), names: [...CSS.highlights.keys()].length })), (v) => !v.bar && v.names === 0, 2000)
    check('The old copy stops on its next tick and clears its bar and highlights', !gone.bar && gone.names === 0, gone)
    await pressGap()
    const id = await pace(p)
    const n = await until(() => now(p), (v) => v !== null)
    check('A new press works after the reload', n !== null && (await p.locator('pacer-bar').count()) === 1)
    await armedBar(id)
    await p.keyboard.press('Space')
    const info = await until(() => bar(id), (b) => b?.playing === true, 1000)
    check('Space reaches the new copy', info?.playing === true)
    await remote.close().catch(() => {})
    await p.close()
  })

  check('No errors on Pacer pages or from Pacer on pages', pageErrors.length === 0, pageErrors.slice(0, 8))
} catch (error) {
  check('run finished', false, String((error as Error)?.stack ?? error))
} finally {
  await writeFile(join(SHOTS, 'results.json'), JSON.stringify({ results, notes }, null, 2))
  await ctx.close().catch(() => {})
  server.stop()
}
void openedReader
void direct
const failed = results.filter((r) => !r.ok)
for (const n of notes) console.log(`NOTE  ${n}`)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
