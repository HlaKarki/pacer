// Cuts the filmed clips into the demo: each output frame is laid out in stage.html, screenshotted and piped to ffmpeg.
import { chromium } from 'playwright'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHROME, OUT, REPO } from '../setup.ts'

const FPS = 60
const CLIPS = join(OUT, 'video')
const VIEW = { w: 1536, h: 864 }
const ZOOM = VIEW.w / 1280

type Probe = { scrollY: number; now: { text: string; x: number; y: number; w: number; h: number } | null } | null
type Log = { K: number; marks: Record<string, number>; data: Record<string, unknown>; frames: { file: string; t: number; probe?: Probe }[] }
type Cam = [t: number, s: number, fx: number, fy: number]
type Seg = {
  len: number
  caption: string
  clip?: string
  from?: number
  fade?: number
  cam?: Cam[]
  keys?: [mark: string, labels: string[]][]
  click?: string
  rsvp?: boolean
  end?: boolean
}

class Clip {
  readonly t0: number
  constructor(readonly name: string, readonly log: Log) {
    this.t0 = log.frames[0]!.t
  }
  static load(name: string) {
    const file = join(CLIPS, name, 'log.json')
    return existsSync(file) ? new Clip(name, JSON.parse(readFileSync(file, 'utf8'))) : null
  }
  mark(name: string) {
    const m = this.log.marks[name]
    if (m === undefined) throw new Error(`${this.name} has no mark ${name}`)
    return (m - this.t0) / this.log.K
  }
  frame(v: number) {
    const { frames, K } = this.log
    const t = this.t0 + v * K
    let lo = 0
    let hi = frames.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (frames[mid]!.t <= t) lo = mid
      else hi = mid
    }
    const f = Math.abs(frames[hi]!.t - t) < Math.abs(frames[lo]!.t - t) ? frames[hi]! : frames[lo]!
    return { src: pathToFileURL(join(CLIPS, this.name, f.file)).href, probe: f.probe }
  }
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
const ramp = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const inOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
const out = (p: number) => 1 - (1 - p) ** 3
const back = (p: number) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2

const ALT = ['Alt', 'Shift', 'P']
const LINE = 275
const SEGS: Seg[] = [
  { len: 3.0, clip: 'cold', from: 2.0, caption: 'Speed reading, right on the page.', cam: [[0, 1.3, 640, LINE], [3, 1.42, 640, LINE]] },
  { len: 2.6, rsvp: true, fade: 0.3, caption: 'Blink, and the sentence is gone.' },
  { len: 4.0, clip: 'article', from: 0.4, fade: 0.3, caption: 'Alt+Shift+P marks your place. Space starts.', keys: [['pace', ALT], ['play', ['Space']]] },
  {
    len: 5.0, clip: 'article', from: 7.8, fade: 0.3, caption: '↑ and ↓ set the pace.', keys: [['up1', ['↑']], ['up2', ['↑']]],
    cam: [[1.3, 1, 640, 400], [2.0, 1.6, 520, 690], [3.9, 1.6, 520, 690], [4.7, 1.1, 640, LINE]],
  },
  { len: 4.0, clip: 'article', from: 18.0, fade: 0.3, caption: 'Rare words get more time. “the” gets less.', cam: [[0.1, 1.1, 640, LINE], [1.1, 1.6, 640, LINE]] },
  { len: 3.0, clip: 'article', from: 22.0, caption: 'Lost your place? Click a word.', click: 'click', cam: [[0, 1.6, 640, LINE], [0.7, 1.3, 640, LINE]] },
  {
    len: 3.5, clip: 'article', from: 25.0, caption: 'Esc stops. The next press picks up where you left off.',
    keys: [['esc1', ['Esc']], ['esc2', ['Esc']], ['pace2', ALT]], cam: [[0, 1.3, 640, LINE], [0.6, 1, 640, LINE]],
  },
  { len: 4.0, clip: 'obsidian', from: 0.5, fade: 0.3, caption: 'Also an Obsidian plugin.', keys: [['play', ['Space']]], cam: [[1.3, 1, 640, 360], [2.4, 1.45, 1100, 600]] },
  { len: 1.6, clip: 'pdf', from: 0.3, fade: 0.3, caption: 'PDFs and EPUBs too.' },
  { len: 1.6, clip: 'epub', from: 2.2, fade: 0.3, caption: 'PDFs and EPUBs too.' },
  { len: 4.0, end: true, caption: '' },
]

const clips = new Map<string, Clip>()
const segs: (Seg & { at: number })[] = []
let total = 0
for (const s of SEGS) {
  if (s.clip && !clips.has(s.clip)) {
    const c = Clip.load(s.clip)
    if (!c) {
      console.log(`skipping ${s.clip}: no clip`)
      continue
    }
    clips.set(s.clip, c)
  }
  segs.push({ ...s, at: total })
  total += s.len
}

const segAt = (t: number) => segs.findLast((s) => s.at <= t) ?? segs[0]!

function camera(seg: Seg, t: number) {
  const keys = seg.cam ?? [[0, 1, 640, 360]]
  let [, s, fx, fy] = keys[0]!
  for (let i = 1; i < keys.length; i++) {
    const [ta, ...a] = keys[i - 1]!
    const [tb, ...b] = keys[i]!
    if (t <= ta) break
    const p = inOut(ramp(t, ta, tb))
    ;[s, fx, fy] = a.map((v, j) => v + (b[j]! - v) * p) as [number, number, number]
  }
  // Zoom about the focus point, then keep the page edge from showing inside the window.
  const x = clamp(fx * ZOOM * (1 - s), VIEW.w * (1 - s), 0)
  const y = clamp(fy * ZOOM * (1 - s), VIEW.h * (1 - s), 0)
  return { s, x, y, at: (px: number, py: number) => ({ x: x + s * px * ZOOM, y: y + s * py * ZOOM }) }
}

function layer(seg: Seg & { at: number }, t: number, o: number) {
  const clip = clips.get(seg.clip!)!
  const cam = camera(seg, t - seg.at)
  const { src } = clip.frame(seg.from! + (t - seg.at))
  return { src, x: cam.x, y: cam.y, s: cam.s, o }
}

// Output time of a clip mark, through whichever segment shows that moment of the clip.
function markTimes(seg: Seg & { at: number }, mark: string) {
  const v = clips.get(seg.clip!)!.mark(mark)
  return seg.at + (v - seg.from!)
}

type KeyEvent = { start: number; end: number; presses: number[]; labels: string[] }
const keyEvents: KeyEvent[] = []
for (const seg of segs) {
  for (const [mark, labels] of seg.keys ?? []) {
    const t = markTimes(seg, mark)
    const last = keyEvents.at(-1)
    if (last && last.labels.join() === labels.join() && t - last.presses.at(-1)! < 1.0) {
      last.presses.push(t)
      last.end = t + 0.7
    } else keyEvents.push({ start: t - 0.16, end: t + 0.7, presses: [t], labels })
  }
}

const RSVP_TEXT = 'Watch someone read and their eyes seem to slide across the page. Film them up close and the slide breaks apart. The eyes hop forward a few letters at a time.'.split(' ')
const orp = (w: string) => {
  const n = w.replace(/[^\p{L}]/gu, '').length
  const i = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4
  return [w.slice(0, i), w.slice(i, i + 1), w.slice(i + 1)]
}

function stateAt(t: number) {
  const seg = segAt(t)
  const i = segs.indexOf(seg)
  const prev = segs[i - 1]
  const local = t - seg.at
  const fadeP = seg.fade && prev && local < seg.fade ? inOut(local / seg.fade) : 1

  const layers: ReturnType<typeof layer>[] = []
  let rsvp: { o: number; word: string[] | null; lid: number } | null = null
  if (fadeP < 1 && prev?.clip) layers.push(layer(prev, t, 1))
  if (seg.clip) layers.push(layer(seg, t, prev?.clip ? fadeP : 1))
  if (seg.rsvp || (prev?.rsvp && fadeP < 1)) {
    const r = seg.rsvp ? seg : prev!
    const rl = t - r.at
    const n = Math.floor((rl - 0.1) / 0.12)
    const blink = 1.25
    const lid = rl < blink ? 0 : rl < blink + 0.09 ? inOut((rl - blink) / 0.09) : rl < blink + 0.16 ? 1 : rl < blink + 0.32 ? 1 - out((rl - blink - 0.16) / 0.16) : 0
    rsvp = { o: seg.rsvp ? (prev?.clip ? fadeP : 1) : 1 - fadeP, word: n >= 0 ? orp(RSVP_TEXT[n % RSVP_TEXT.length]!) : null, lid }
  }

  const caps: ({ text: string; o: number; dy: number } | null)[] = [{ text: seg.caption, o: 1, dy: 0 }, null]
  const CAP = 0.4
  if (prev && prev.caption !== seg.caption && local < CAP) {
    const p = inOut(local / CAP)
    caps[0] = { text: seg.caption, o: p, dy: 16 * (1 - p) }
    caps[1] = { text: prev.caption, o: 1 - p, dy: -16 * p }
  }

  const keys = keyEvents
    .filter((k) => t >= k.start && t <= k.end)
    .map((k) => {
      const pin = ramp(t, k.start, k.start + 0.14)
      const pout = ramp(t, k.end - 0.2, k.end)
      return { labels: k.labels, o: pin * (1 - pout), dy: -10 * pout, scale: 0.9 + 0.1 * back(pin), down: k.presses.some((p) => t >= p - 0.02 && t <= p + 0.11) }
    })

  let cursor = null
  if (seg.click) {
    const tc = markTimes(seg, seg.click)
    const p = clips.get(seg.clip!)!.log.data[seg.click] as { x: number; y: number }
    if (t > tc - 1.05 && t < tc + 0.9) {
      const cam = camera(seg, local)
      const end = cam.at(p.x, p.y)
      const start = cam.at(p.x + 230, p.y + 170)
      const m = inOut(ramp(t, tc - 1.0, tc - 0.12))
      const arc = Math.sin(m * Math.PI) * 30
      const rp = ramp(t, tc, tc + 0.5)
      cursor = {
        x: start.x + (end.x - start.x) * m - arc * 0.4,
        y: start.y + (end.y - start.y) * m + arc,
        o: ramp(t, tc - 1.05, tc - 0.85) * (1 - ramp(t, tc + 0.6, tc + 0.9)),
        down: t >= tc - 0.05 && t <= tc + 0.08,
        ripple: rp > 0 && rp < 1 ? { r: 0.15 + 0.85 * out(rp), o: 0.85 * (1 - rp) } : null,
      }
    }
  }

  const endSeg = segs.find((s) => s.end)!
  const e = t - endSeg.at
  const win = { o: 1 - inOut(ramp(e, 0, 0.4)), dy: 0, scale: 1 - 0.04 * inOut(ramp(e, 0, 0.4)) }
  const end = {
    o: inOut(ramp(e, 0, 0.4)),
    sweep: out(ramp(e, 0.3, 0.85)),
    word: ramp(e, 0.3, 0.55),
    tag: out(ramp(e, 0.8, 1.25)),
    where: out(ramp(e, 1.0, 1.45)),
  }
  if (e >= 0 && prev) {
    const p = inOut(ramp(e, 0, 0.3))
    caps[0] = { text: prev.caption, o: 1 - p, dy: -16 * p }
    caps[1] = null
    if (prev.clip) layers.splice(0, layers.length, layer(prev, t, 1))
  }
  return { layers, rsvp, caps, keys, cursor, win, end }
}

const args = process.argv.slice(2)
const stills = args.find((a) => a.startsWith('--stills='))?.slice(9).split(',').map(Number)
const range = args.find((a) => a.startsWith('--range='))?.slice(8).split(',').map(Number) ?? [0, total]
const outFile = args.find((a) => !a.startsWith('--')) ?? join(REPO, 'release/video/pacer-demo.mp4')

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(join(import.meta.dir, 'stage.html')).href)
await page.evaluate(async () => {
  await document.fonts.load('600 54px "Instrument Sans"')
  await document.fonts.load('640 180px Literata')
  await document.fonts.ready
})
const cdp = await page.context().newCDPSession(page)
const shoot = async (t: number) => {
  await page.evaluate((s) => (window as unknown as { render: (s: unknown) => Promise<void> }).render(s), stateAt(t))
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })
  return Buffer.from(data, 'base64')
}

console.log(`total ${total.toFixed(2)} s, segments at ${segs.map((s) => `${s.at.toFixed(1)}${s.clip ? ` ${s.clip}` : s.rsvp ? ' rsvp' : ' end'}`).join(', ')}`)
if (stills) {
  const dir = join(OUT, 'video/stills')
  await mkdir(dir, { recursive: true })
  for (const t of stills) await Bun.write(join(dir, `${t.toFixed(2)}.png`), await shoot(t))
  console.log(dir)
} else {
  await mkdir(join(outFile, '..'), { recursive: true })
  const ff = Bun.spawn(
    ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart', outFile],
    { stdin: 'pipe', stderr: 'inherit' },
  )
  const [a, b] = range as [number, number]
  const count = Math.round((b - a) * FPS)
  const began = performance.now()
  for (let n = 0; n < count; n++) {
    ff.stdin.write(await shoot(a + n / FPS))
    if (n % 120 === 0) console.log(`${n}/${count} ${((performance.now() - began) / 1000).toFixed(0)} s`)
  }
  await ff.stdin.end()
  await ff.exited
  console.log(outFile)
}
await browser.close()
