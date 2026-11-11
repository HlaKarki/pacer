// Read-only smoke on live pages with the built extension: coverage, start paragraph and bar placement.
import { chromium, type Page, type Worker } from 'playwright'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHROME, OUT, REPO } from './setup.ts'

const EXT = join(OUT, 'ext-inpage-smoke')
const SHOTS = join(OUT, 'shots/smoke')

interface Case {
  name: string
  url: string
  at: number[]
  hla?: boolean
}
const CASES: Case[] = [
  { name: 'wiki-speed-reading', url: 'https://en.wikipedia.org/wiki/Speed_reading', at: [0] },
  { name: 'wiki-ww2', url: 'https://en.wikipedia.org/wiki/World_War_II', at: [0.4] },
  { name: 'mdn-highlight-api', url: 'https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API', at: [0] },
  { name: 'acx', url: 'https://www.astralcodexten.com/p/your-book-review-we-present-television', at: [0] },
  { name: 'hla-spendoff', url: 'https://hla.dev/builds/spendoff', at: [0, 0.4, 0.7], hla: true },
]
const ONLY = process.env.ONLY?.split(',')

await rm(EXT, { recursive: true, force: true })
await cp(join(REPO, 'extension/dist'), EXT, { recursive: true })
const manifest = await Bun.file(join(EXT, 'manifest.json')).json()
// The real extension relies on activeTab from the click, which a script call never grants.
manifest.host_permissions.push(...new Set(CASES.map((c) => `${new URL(c.url).origin}/*`)))
await writeFile(join(EXT, 'manifest.json'), JSON.stringify(manifest, null, 2))
const pacerImports: Bun.BunPlugin = {
  name: 'pacer-dir',
  setup: (b) => {
    b.onResolve({ filter: /^@pacer\// }, (a) => ({ path: `${join(REPO, a.path.slice('@pacer/'.length))}.ts` }))
  },
}
const probe = await Bun.build({ entrypoints: [join(import.meta.dir, 'smoke-probe.ts')], outdir: EXT, target: 'browser', format: 'iife', naming: 'probe.js', plugins: [pacerImports] })
if (!probe.success) throw new AggregateError(probe.logs, 'probe build failed')
await rm(SHOTS, { recursive: true, force: true })
await mkdir(SHOTS, { recursive: true })

const ctx = await chromium.launchPersistentContext('', {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const sw: Worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'))
const errors: string[] = []

async function tabIdOf(url: string): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const id = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url?.split('#')[0] === u)?.id, url.split('#')[0])
    if (id !== undefined) return id
    await Bun.sleep(100)
  }
  throw new Error(`no tab for ${url}`)
}

type Probe = {
  ms: number
  words: number
  coverage: number
  paragraphs: number
  unmapped: string[]
  weak: string[]
  start: { from: number; at: number } | null
  startWord: string | null
  startBlock: string | null
}
const runProbe = (tabId: number) =>
  sw.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['probe.js'] })
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => (globalThis as unknown as { __pacerProbe: () => unknown }).__pacerProbe(),
    })
    return frame?.result as unknown
  }, tabId) as Promise<Probe>

const pace = (tabId: number, url: string) =>
  sw.evaluate(
    async ([id, u]) => {
      const tab = await chrome.tabs.get(id)
      await (self as unknown as { paceTab: (t: chrome.tabs.Tab) => Promise<void> }).paceTab({ ...tab, url: tab.url ?? u })
    },
    [tabId, url] as const,
  )

const barBox = (tabId: number) =>
  sw.evaluate(async (id) => {
    const [frame] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => {
        const host = document.querySelector('pacer-bar') as HTMLElement | null
        const root = host && chrome.dom.openOrClosedShadowRoot(host)
        const panel = root?.querySelector('.panel')
        if (!panel) return null
        const r = panel.getBoundingClientRect()
        return {
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          notice: panel.hasAttribute('data-notice') ? root!.querySelector('.notice')!.textContent : null,
          playing: root!.querySelector('.play')!.getAttribute('aria-label') === 'Pause',
        }
      },
    })
    return (frame?.result ?? null) as unknown
  }, tabId) as Promise<{ x: number; y: number; w: number; h: number; notice: string | null; playing: boolean } | null>

const BLOCK = 'p, li, h1, h2, h3, h4, blockquote, pre, figcaption, dd, dt'
// Main world reads Pacer's highlight from the shared registry and lists the page's own blocks independently of Pacer.
const where = (p: Page) =>
  p.evaluate((sel) => {
    const pinned = (el: Element) => {
      for (let e: Element | null = el; e; e = e.parentElement) if (/fixed|sticky/.test(getComputedStyle(e).position)) return true
      return false
    }
    const furniture = 'nav, aside, footer, [role=navigation], [role=contentinfo]'
    const siteHeader = (e: Element) => {
      const h = e.closest('header, [role=banner]')
      return !!h && !h.querySelector('h1') && !h.closest('article')
    }
    const blocks = [...(document.querySelector("main") ?? document.body).querySelectorAll(sel)].filter((e) => {
      if (e.querySelector(sel)) return false
      const r = e.getBoundingClientRect()
      return r.height > 0 && (e.textContent ?? '').trim().length > 0 && !e.closest(furniture) && !siteHeader(e) && !pinned(e)
    })
    const strip = innerHeight * 0.15
    const firstVisible = blocks.findIndex((e) => e.getBoundingClientRect().bottom > strip)
    const range = ['pacer-now-light', 'pacer-now-dark']
      .flatMap((n) => [...((CSS.highlights.get(n) as unknown as Set<Range>) ?? [])])
      .find((r) => !r.collapsed)
    const startEl = range?.startContainer.parentElement?.closest(sel) ?? null
    let start = startEl ? blocks.indexOf(startEl) : -1
    if (startEl && start < 0) start = blocks.findIndex((b) => b.contains(startEl) || startEl.contains(b))
    const text = (e: Element | undefined) => e?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60) ?? null
    const fixed = [...document.querySelectorAll('body *')]
      .filter((e) => e.localName !== 'pacer-bar' && /fixed|sticky/.test(getComputedStyle(e).position))
      .map((e) => {
        const r = e.getBoundingClientRect()
        return { sel: `${e.localName}${e.id ? `#${e.id}` : ''}${[...e.classList].slice(0, 2).map((c) => `.${c}`).join('')}`, x: r.x, y: r.y, w: r.width, h: r.height }
      })
      .filter((b) => b.w > 0 && b.h > 0 && b.x < innerWidth && b.y < innerHeight && b.x + b.w > 0 && b.y + b.h > 0)
    return {
      scrollY,
      firstVisible: { index: firstVisible, text: text(blocks[firstVisible]) },
      start: { index: start, word: range?.toString() ?? null, text: startEl ? text(startEl) : null },
      fixed,
    }
  }, BLOCK)

const ARMED = 'Press Space or Play to start'
// Pacer may hand the highlight a fresh range per chunk, so keep a clone of the start to compare against later.
const markStart = (p: Page) =>
  p.evaluate(() => {
    const r = ['pacer-now-light', 'pacer-now-dark', 'pacer-now-warm'].flatMap((n) => [...((CSS.highlights.get(n) as unknown as Set<Range>) ?? [])]).find((r) => !r.collapsed)
    ;(window as unknown as { pacerMark?: Range }).pacerMark = r?.cloneRange()
    return !!r
  })
const movedPastMark = (p: Page) =>
  p.evaluate(() => {
    const r = ['pacer-now-light', 'pacer-now-dark', 'pacer-now-warm'].flatMap((n) => [...((CSS.highlights.get(n) as unknown as Set<Range>) ?? [])]).find((r) => !r.collapsed)
    const mark = (window as unknown as { pacerMark?: Range }).pacerMark
    return { moved: !!r && !!mark && r.compareBoundaryPoints(Range.START_TO_START, mark) > 0, word: r?.toString() ?? null }
  })
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 3000) => {
  const end = Date.now() + ms
  let v = await read()
  while (!ok(v) && Date.now() < end) {
    await Bun.sleep(50)
    v = await read()
  }
  return v
}

const intersects = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const results: Record<string, unknown>[] = []
const verdicts: { name: string; ok: boolean }[] = []
const verdict = (name: string, ok: boolean, detail?: unknown) => {
  verdicts.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

for (const c of CASES) {
  if (ONLY && !ONLY.some((o) => c.name.includes(o))) continue
  for (const f of c.at) {
    const label = `${c.name}@${Math.round(f * 100)}%`
    console.log(`\n# ${label}`)
    const p = await ctx.newPage()
    p.on('pageerror', (e) => /pacer/i.test(e.message) && errors.push(`${label}: ${e.message}`))
    p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && /pacer/i.test(m.text()) && errors.push(`${label}: ${m.text()}`))
    try {
      await p.goto(c.url, { waitUntil: 'load', timeout: 60000 })
      await p.waitForTimeout(1500)
      if (f > 0) {
        await p.evaluate((f) => scrollTo({ top: (document.scrollingElement!.scrollHeight - innerHeight) * f, behavior: 'instant' }), f)
        await p.waitForTimeout(600)
      }
      const id = await tabIdOf(p.url())
      const before = await where(p)
      const probe = await runProbe(id)
      const pagesBefore = ctx.pages().length
      const t0 = Date.now()
      await pace(id, p.url())
      let at = await where(p)
      for (let i = 0; i < 100 && at.start.index < 0 && !at.start.word; i++) {
        await Bun.sleep(50)
        at = await where(p)
      }
      const startMs = Date.now() - t0
      await p.waitForTimeout(400)
      const bar = await barBox(id)
      const armedScroll = await p.evaluate(() => scrollY)
      const inPlace = ctx.pages().length === pagesBefore
      const gap = at.start.index - before.firstVisible.index
      const overlaps = bar ? at.fixed.filter((b) => intersects(b, bar)) : []
      await p.screenshot({ path: join(SHOTS, `${c.name}-${Math.round(f * 100)}.png`) })
      const row = { label, url: c.url, inPlace, startMs, probe, at: { scrollBefore: before.scrollY, scrollAfter: at.scrollY, firstVisible: before.firstVisible, start: at.start, gap }, bar, overlaps }
      results.push(row)
      console.log(JSON.stringify({ ...row, at: { ...row.at }, probe: { ...probe, unmapped: probe.unmapped.slice(0, 5), weak: probe.weak.slice(0, 5) } }))
      verdict(`${label}: reads in place`, inPlace && !!bar, { startMs, notice: bar?.notice })
      verdict(`${label}: coverage >= 95%`, probe.coverage >= 0.95, { coverage: +(probe.coverage * 100).toFixed(2), words: probe.words })
      verdict(`${label}: start within one paragraph of the first visible`, at.start.index >= 0 && Math.abs(gap) <= 1, row.at)
      verdict(`${label}: the press arms with the hint and leaves the page where it was`, bar?.notice === ARMED && !bar.playing && armedScroll === before.scrollY, { notice: bar?.notice, playing: bar?.playing, scrollBefore: before.scrollY, armedScroll })
      await markStart(p)
      await p.keyboard.press('Space')
      const started = await until(() => barBox(id), (b) => b?.playing === true, 1500)
      await p.waitForTimeout(1200)
      const after = await movedPastMark(p)
      verdict(`${label}: Space starts and the highlight moves on`, started?.playing === true && started.notice === null && after.moved, { playing: started?.playing, notice: started?.notice, from: at.start.word, to: after.word })
      if (c.hla) {
        verdict(`${label}: every extracted block maps`, probe.unmapped.length === 0 && probe.weak.length === 0, { paragraphs: probe.paragraphs, unmapped: probe.unmapped, weak: probe.weak })
        verdict(`${label}: start matches the first visible paragraph`, gap === 0, { gap })
        verdict(`${label}: the bar overlaps no fixed nav or contents list`, overlaps.length === 0, { bar, fixed: at.fixed })
      }
    } catch (error) {
      verdict(`${label}: finished`, false, String((error as Error)?.stack ?? error).slice(0, 500))
    }
    await p.close()
  }
}
verdict('No Pacer errors or warnings on the pages', errors.length === 0, errors)
await writeFile(join(SHOTS, 'results.json'), JSON.stringify({ results, verdicts, errors }, null, 2))
console.log(`\n${verdicts.filter((v) => v.ok).length}/${verdicts.length} passed`)
await ctx.close()
