// Films the Obsidian clip in a throwaway vault and profile, so a real Obsidian profile is never opened.
import { chromium, type CDPSession, type Page } from 'playwright'
import { closeSync, existsSync, openSync, realpathSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OUT, REPO } from '../setup.ts'
import { dilate } from './dilate.ts'
import { Recorder } from './recorder.ts'

declare const app: any

const K = Number(process.env.K ?? 16)
const OBSIDIAN = '/Applications/Obsidian.app/Contents/MacOS/Obsidian'
const DEMO = process.env.DEMO_DIR ?? join(tmpdir(), 'pacer-obsidian-demo')
const VAULT = join(DEMO, 'vault')
const USER_DATA = join(DEMO, 'userdata')
const FRAMES = join(OUT, 'video/obsidian')
const VAULT_ID = '9ace0b5d3e7f1a26'
const W = 1280
const H = 720
const PACE_AT = 1
const PLAY_AFTER = 0.6
const END = 9.6
const REMOTE = "(require('electron').remote ?? require('@electron/remote'))"

async function until<T>(what: string, check: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await Bun.sleep(200)
  }
}

const pngWidth = (base64: string) => Buffer.from(base64, 'base64').readUInt32BE(16)

const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: REPO, stdout: 'inherit', stderr: 'inherit' })
if (build.exitCode !== 0) throw new Error('The plugin build failed.')

await rm(DEMO, { recursive: true, force: true })
const html = await Bun.file(join(import.meta.dir, '../store/notes.html')).text()
const title = html.match(/<h1>([^<]+)<\/h1>/)![1]!
const paragraphs = [...html.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim())
const NOTE = `${title}.md`
const notes: Record<string, string> = {
  [NOTE]: paragraphs.join('\n\n'),
  'Reading list.md': [
    '- How to Read a Book by Mortimer Adler',
    '- The Shallows by Nicholas Carr',
    '- Reader, Come Home by Maryanne Wolf',
    '- Deep Work by Cal Newport',
  ].join('\n'),
  'Weekly review.md': [
    '## Done',
    '',
    '- Finished the chapter on attention',
    '- Cleared the reading inbox',
    '',
    '## Next',
    '',
    '- Try a faster pace on long articles',
    '- Sort the reading list by length',
  ].join('\n'),
  'Ideas.md': ['Read the dense chapters in the morning.', '', 'Keep a short note for every article worth a second look.'].join('\n'),
}
const pluginDir = join(VAULT, '.obsidian/plugins/pacer')
await mkdir(pluginDir, { recursive: true })
await mkdir(USER_DATA, { recursive: true })
for (const [name, text] of Object.entries(notes)) await writeFile(join(VAULT, name), `${text}\n`)
for (const name of ['main.js', 'styles.css', 'manifest.json']) await copyFile(join(REPO, name), join(pluginDir, name))
await writeFile(join(pluginDir, 'data.json'), JSON.stringify({ settings: { wpm: 300 }, places: {} }))
await writeFile(join(VAULT, '.obsidian/community-plugins.json'), JSON.stringify(['pacer']))
await writeFile(join(VAULT, '.obsidian/appearance.json'), JSON.stringify({ theme: 'moonstone' }))
// Obsidian opens every vault marked open in obsidian.json, and reads that window's bounds from <vault id>.json.
await writeFile(join(USER_DATA, 'obsidian.json'), JSON.stringify({ vaults: { [VAULT_ID]: { path: VAULT, ts: Date.now(), open: true } }, updateDisabled: true }))
await writeFile(join(USER_DATA, `${VAULT_ID}.json`), JSON.stringify({ width: W, height: H, isMaximized: false, devTools: false, zoom: 0 }))

const log = openSync(join(DEMO, 'obsidian.log'), 'w')
const proc = Bun.spawn(
  [
    OBSIDIAN,
    `--user-data-dir=${USER_DATA}`,
    '--remote-debugging-port=0',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  { stdout: log, stderr: log },
)
console.log(`Obsidian pid ${proc.pid}`)

async function quit() {
  if (proc.exitCode !== null) return
  proc.kill('SIGTERM')
  const exited = await Promise.race([proc.exited.then(() => true), Bun.sleep(15_000).then(() => false)])
  if (!exited) {
    proc.kill('SIGKILL')
    await proc.exited
  }
}

async function prepare(page: Page) {
  const ready = () => page.waitForFunction(() => (globalThis as { app?: any }).app?.workspace?.layoutReady, null, { timeout: 30_000 })
  await ready()
  const basePath = await page.evaluate(() => app.vault.adapter.basePath as string)
  if (realpathSync(basePath) !== realpathSync(VAULT)) throw new Error(`The window opened ${basePath}, not the demo vault.`)
  if (!(await page.evaluate(() => app.plugins.isEnabled() as boolean))) {
    await page.evaluate(() => localStorage.setItem(`enable-plugin-${app.appId}`, 'true'))
    await page.reload()
    await ready()
  }
  await page.waitForFunction(() => app.plugins.plugins.pacer, null, { timeout: 30_000 })
  await page.evaluate(async (note) => {
    const ws = app.workspace
    const leaf = ws.getLeaf(false)
    await leaf.setViewState({ type: 'markdown', state: { file: note, mode: 'preview' }, active: true })
    ws.iterateRootLeaves((other: unknown) => {
      if (other !== leaf) (other as { detach: () => void }).detach()
    })
    ws.rightSplit.collapse()
    ws.leftSplit.expand()
    const explorer = ws.getLeavesOfType('file-explorer')[0]
    if (explorer) ws.revealLeaf(explorer)
    ws.setActiveLeaf(leaf, { focus: true })
  }, NOTE)
  await Bun.sleep(1500)
}

const readerState = (page: Page) =>
  page.evaluate((note) => ({
    mode: document.querySelector('.pc-segmented [aria-checked="true"]')?.textContent ?? null,
    playing: document.querySelector('.pc-root button[aria-label="Pause"]') !== null,
    index: (app.plugins.plugins.pacer.store.place(note) as number | undefined) ?? 0,
  }), NOTE)

async function capture(page: Page, cdp: CDPSession) {
  // A real Retina window already captures at device pixels, so clip scale 1 gives 2560 px there and 2 would give 5120.
  const test = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
  const scale = (2 * W) / pngWidth(test.data)
  // Lets the desktop mouse pass through, so a stray pointer can't hover the sidebar or wake the reader's controls.
  const passThrough = await page.evaluate(`${REMOTE}.getCurrentWindow().setIgnoreMouseEvents(true) ?? true`).catch(() => false)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / K })
  await page.evaluate(`(${dilate.toString()})(${K})`)

  const rec = new Recorder(cdp, FRAMES, K, { width: W, height: H, scale })
  await rec.start()
  const t0 = rec.now()
  const sleepUntil = (sec: number) => Bun.sleep(Math.max(0, t0 + sec * K - rec.now()) * 1000)
  rec.mark('rest')
  await sleepUntil(PACE_AT)
  rec.mark('pace')
  const paced = await page.evaluate(() => app.commands.executeCommandById('pacer:pace-file') as boolean)
  await sleepUntil(PACE_AT + PLAY_AFTER)
  const opened = await readerState(page)
  rec.mark('play')
  await page.keyboard.press('Space')
  const atPlay = { t: rec.now(), ...(await readerState(page)) }
  await sleepUntil(END)
  const atEnd = { t: rec.now(), ...(await readerState(page)) }
  const stats = await rec.stop()

  const { marks } = (await Bun.file(join(FRAMES, 'log.json')).json()) as { marks: Record<string, number> }
  const virtual = Object.fromEntries(Object.entries(marks).map(([k, t]) => [k, +((t - marks.start!) / K).toFixed(3)]))
  const wordsPerSec = (atEnd.index - atPlay.index) / ((atEnd.t - atPlay.t) / K)
  console.log({ scale, passThrough, paced, opened, atPlay, atEnd, wordsPerSec: +wordsPerSec.toFixed(2), marks: virtual, ...stats })
}

try {
  const port = await until('the DevTools port', async () => {
    const file = join(USER_DATA, 'DevToolsActivePort')
    return existsSync(file) && (await readFile(file, 'utf8')).split('\n')[0]
  })
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = await until('the vault window', () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://obsidian.md/index.html')))
  const userData = await until('the profile path', () => page.evaluate(`${REMOTE}.app.getPath('userData')`).catch(() => null) as Promise<string | null>)
  if (realpathSync(userData) !== realpathSync(USER_DATA)) throw new Error(`Obsidian is using ${userData} as its profile, not ${USER_DATA}.`)
  await prepare(page)
  await capture(page, await page.context().newCDPSession(page))
  await browser.close()
} finally {
  await quit()
  closeSync(log)
}
