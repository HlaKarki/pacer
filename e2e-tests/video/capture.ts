// Films the browser clips for the demo on slowed clocks. Marks log, in real seconds, when each key or click went in, so the edit can draw it.
import type { Page } from 'playwright'
import { join } from 'node:path'
import { fixtures, OUT } from '../setup.ts'
import { APP, openBrowser, PAGES, readState, type Pacer } from './browser.ts'
import { Recorder } from './recorder.ts'
import { MARKS, TAKES } from './timeline.ts'

const K = Number(process.env.K ?? 20)
const DIR = join(OUT, 'video')
const ALICE = join(import.meta.dir, '../fixtures/alice.epub')
const A = MARKS.article

async function film(b: Pacer, page: Page, name: string, seconds: number, script: (at: (v: number) => Promise<void>, rec: Recorder) => Promise<void>, probe = true) {
  const cdp = await b.slowCss(page)
  const rec = new Recorder(cdp, join(DIR, name), K, undefined, { fps: 60, probe: probe ? () => readState(page) : undefined })
  await rec.start()
  const t0 = rec.now()
  const at = (v: number) => Bun.sleep(Math.max(0, (t0 + v * K - rec.now()) * 1000))
  await script(at, rec)
  await at(seconds)
  const stats = await rec.stop()
  console.log(name, stats)
}

const press = async (page: Page, rec: Recorder, key: string, name: string) => {
  rec.mark(name)
  await page.keyboard.press(key)
}

// Centre of one word inside the paragraph that starts with the given text, in viewport pixels.
const wordAt = (page: Page, para: string, word: string) =>
  page.evaluate(([para, word]) => {
    const p = [...document.querySelectorAll('p')].find((el) => el.textContent!.startsWith(para!))!
    const text = p.firstChild as Text
    const i = text.data.indexOf(word!)
    const r = document.createRange()
    r.setStart(text, i)
    r.setEnd(text, i + word!.length)
    const b = r.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }, [para, word])

async function article() {
  const b = await openBrowser(K)
  await b.setSettings({ wpm: 300, autoStart: false })
  const page = await b.ctx.newPage()
  await page.goto(`${PAGES}/article`)
  await page.evaluate(() => document.fonts.ready)
  const tab = await b.tabIdOf(page.url())
  await b.dilateTab(tab)
  await film(b, page, 'article', TAKES.article, async (at, rec) => {
    await at(A.pace)
    rec.mark('pace')
    await b.pace(tab)
    await at(A.play)
    await press(page, rec, 'Space', 'play')
    await at(A.up1)
    await press(page, rec, 'ArrowUp', 'up1')
    await at(A.up2)
    await press(page, rec, 'ArrowUp', 'up2')
    await at(A.click)
    const p = await wordAt(page, 'A saccade is fast.', 'saccade')
    rec.mark('click', p)
    await page.mouse.click(p.x, p.y)
    await at(A.esc1)
    await press(page, rec, 'Escape', 'esc1')
    await at(A.esc2)
    await press(page, rec, 'Escape', 'esc2')
    await at(A.pace2)
    rec.mark('pace2')
    await b.pace(tab)
  })
  await b.close()
}

async function cold() {
  const b = await openBrowser(K)
  await b.setSettings({ wpm: 320, autoStart: true })
  const page = await b.ctx.newPage()
  await page.goto(`${PAGES}/article`)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2')].find((el) => el.textContent === 'The slips back')!
    window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 90)
  })
  const tab = await b.tabIdOf(page.url())
  await b.dilateTab(tab)
  await film(b, page, 'cold', TAKES.cold, async (at, rec) => {
    await at(MARKS.cold.pace)
    rec.mark('pace')
    await b.pace(tab)
  })
  await b.close()
}

async function pdf() {
  const b = await openBrowser(K)
  await b.makeNotesPdf()
  await b.setSettings({ wpm: 300, autoStart: false })
  const source = await b.ctx.newPage()
  await source.goto(`${PAGES}/notes.pdf`).catch(() => {})
  const tab = await b.tabIdOf(`${PAGES}/notes.pdf`)
  const appeared = b.ctx.waitForEvent('page')
  await b.pace(tab)
  const reader = await appeared
  await reader.waitForSelector('.pc-reader .pc-w', { timeout: 30000 })
  await reader.evaluate(() => document.fonts.ready)
  await film(b, reader, 'pdf', TAKES.pdf, async (at, rec) => {
    await at(MARKS.pdf.play)
    await press(reader, rec, 'Space', 'play')
  }, false)
  await b.close()
}

async function epub() {
  await fixtures()
  const b = await openBrowser(K)
  const page = await b.ctx.newPage()
  await page.addInitScript(b.shim)
  await page.goto(APP)
  await page.evaluate(() => document.fonts.ready)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file' }).click()
  await (await chooser).setFiles(ALICE)
  await page.getByRole('button', { name: 'Start reading' }).click({ timeout: 30000 })
  await page.waitForSelector('.pc-w', { timeout: 30000 })
  await page.getByRole('button', { name: 'Contents' }).click()
  await page.getByRole('dialog', { name: 'Contents' }).getByRole('button', { name: /Down the Rabbit/ }).click()
  await Bun.sleep(500 * K)
  await film(b, page, 'epub', TAKES.epub, async (at, rec) => {
    await at(MARKS.epub.play)
    await press(page, rec, 'Space', 'play')
  }, false)
  await b.close()
}

const shots: Record<string, () => Promise<void>> = { article, cold, pdf, epub }
for (const name of process.argv.slice(2)) await shots[name]!()
