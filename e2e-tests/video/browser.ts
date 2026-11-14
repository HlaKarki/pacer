// Chrome with a test copy of the built extension, the demo pages and the web app, all on slowed clocks.
import { chromium, type BrowserContext, type Page, type Worker } from 'playwright'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHROME, OUT, REPO } from '../setup.ts'
import { dilate } from './dilate.ts'

export const VIEW = { width: 1280, height: 720 }
const DEMO = join(import.meta.dir, '../store')
const EXT = join(OUT, 'ext-video')
const NOTES_PDF = join(OUT, 'video-notes.pdf')
const PAGES_PORT = 5391
const APP_PORT = 5392
export const PAGES = `http://localhost:${PAGES_PORT}`
export const APP = `http://localhost:${APP_PORT}`

export type Pacer = Awaited<ReturnType<typeof openBrowser>>

export async function openBrowser(K: number) {
  const shim = `(${dilate.toString()})(${K})`
  await rm(EXT, { recursive: true, force: true })
  await cp(join(REPO, 'extension/dist'), EXT, { recursive: true })
  const manifest = await Bun.file(join(EXT, 'manifest.json')).json()
  // The real extension relies on activeTab from the click, which a script call never grants.
  manifest.host_permissions.push(`${PAGES}/*`)
  await writeFile(join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2))
  // The extension's CSP blocks eval, so the clock shim ships as a file: injected into the page's isolated world, and loaded first by the reader tab.
  await writeFile(join(EXT, 'dilate.js'), shim)
  const readerHtml = await readFile(join(EXT, 'reader.html'), 'utf8')
  await writeFile(join(EXT, 'reader.html'), readerHtml.replace('<script type="module"', '<script src="dilate.js"></script>\n    <script type="module"'))

  const html = (file: string) => new Response(Bun.file(join(DEMO, file)), { headers: { 'content-type': 'text/html; charset=utf-8' } })
  const pages = Bun.serve({
    port: PAGES_PORT,
    fetch(req) {
      const path = new URL(req.url).pathname
      if (path === '/article') return html('article.html')
      if (path === '/notes') return html('notes.html')
      if (path === '/notes.pdf') return new Response(Bun.file(NOTES_PDF), { headers: { 'content-type': 'application/pdf' } })
      return new Response('not found', { status: 404 })
    },
  })
  const dist = join(REPO, 'dist')
  const app = Bun.serve({
    port: APP_PORT,
    async fetch(req) {
      const path = new URL(req.url).pathname
      const file = Bun.file(join(dist, path === '/' ? 'index.html' : path))
      return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(dist, 'index.html')))
    },
  })

  const ctx: BrowserContext = await chromium.launchPersistentContext('', {
    executablePath: CHROME,
    headless: true,
    viewport: VIEW,
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  })
  const sw: Worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))

  async function setSettings(patch: Record<string, unknown>) {
    await sw.evaluate(async (s) => {
      const { settings } = await chrome.storage.local.get('settings')
      await chrome.storage.local.set({ settings: { ...(settings as object), ...s } })
    }, patch)
  }

  async function makeNotesPdf() {
    await mkdir(OUT, { recursive: true })
    const maker = await ctx.newPage()
    await maker.goto(`${PAGES}/notes`)
    await maker.pdf({ path: NOTES_PDF, format: 'Letter', printBackground: true })
    await maker.close()
  }

  async function tabIdOf(url: string): Promise<number> {
    for (let i = 0; i < 80; i++) {
      const id = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? -1, url)
      if (id >= 0) return id
      await Bun.sleep(100)
    }
    throw new Error(`no tab for ${url}`)
  }

  // Slows CSS animations on a page to match the slowed clocks, and returns the CDP session for capture.
  async function slowCss(page: Page) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Animation.enable')
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / K })
    return cdp
  }

  async function dilateTab(tabId: number) {
    await sw.evaluate(async (id) => void (await chrome.scripting.executeScript({ target: { tabId: id }, files: ['dilate.js'] })), tabId)
  }

  async function pace(tabId: number) {
    await sw.evaluate(async (id) => {
      const tab = await chrome.tabs.get(id)
      await (self as unknown as { paceTab: (t: chrome.tabs.Tab) => Promise<void> }).paceTab(tab)
    }, tabId)
  }

  async function close() {
    await ctx.close()
    void pages.stop()
    void app.stop()
  }

  return { ctx, sw, shim, setSettings, makeNotesPdf, tabIdOf, slowCss, dilateTab, pace, close }
}

// The current word and the scroll position, read from the page's highlight registry.
export function readState(page: Page) {
  return page.evaluate(() => {
    let now: { text: string; x: number; y: number; w: number; h: number } | null = null
    for (const [name, h] of CSS.highlights) {
      if (!name.startsWith('pacer-now')) continue
      for (const r of h) {
        if (!(r instanceof Range) || r.collapsed) continue
        const b = r.getBoundingClientRect()
        now = { text: r.toString(), x: b.x, y: b.y, w: b.width, h: b.height }
      }
    }
    return { scrollY: window.scrollY, now }
  })
}
