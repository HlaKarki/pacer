// Real-time run of the article session that logs scroll and the current word, for planning the capture.
import { openBrowser, readState, PAGES } from './browser.ts'
const b = await openBrowser(1)
await b.setSettings({ wpm: 300, autoStart: false })
const page = await b.ctx.newPage()
await page.goto(`${PAGES}/article`)
const tabId = await b.tabIdOf(page.url())
const t0 = performance.now()
const at = (s: number) => Bun.sleep(Math.max(0, t0 + s * 1000 - performance.now()))
const ups = (process.env.UPS ?? '').split(',').filter(Boolean).map(Number)
const rows: string[] = []
let last = ''
const logger = (async () => {
  while (performance.now() - t0 < Number(process.env.SECS ?? 40) * 1000) {
    const s = await readState(page)
    const key = `${s.scrollY}|${s.now?.text}`
    if (key !== last) rows.push(`${((performance.now() - t0) / 1000).toFixed(2)} y=${s.scrollY} ${s.now ? `"${s.now.text}" @${Math.round(s.now.x)},${Math.round(s.now.y)}` : '-'}`)
    last = key
    await Bun.sleep(20)
  }
})()
await at(1); await b.pace(tabId)
await at(2); await page.keyboard.press('Space')
for (const u of ups) { await at(u); await page.keyboard.press('ArrowUp') }
await logger
console.log(rows.join('\n'))
await b.close()
