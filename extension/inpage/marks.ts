/** 'dark' for light text on a dark background and 'warm' for a background close to the highlight yellow, each with its own highlight colours. */
export type Tone = 'light' | 'dark' | 'warm'

export interface ToneRun {
  tone: Tone
  range: Range
}

const TONES: Tone[] = ['light', 'dark', 'warm']
const NOW_PRIORITY = 2
const READ_PRIORITY = 1

const nowName = (tone: Tone) => `pacer-now-${tone}`
const readName = (tone: Tone) => `pacer-read-${tone}`

/** OKLab distance under which a background is too close to the light highlight #fbe17a for it to show. */
const WARM_DISTANCE = 0.095

const number = (part: string, scale: number) => (part.endsWith('%') ? parseFloat(part) / 100 : parseFloat(part) / scale)

/** Lightness from 0 to 1 of a computed CSS colour, or null when the format is unknown. */
export function lightness(color: string): number | null {
  const match = /^([a-z]+)\((.*)\)$/.exec(color.trim().toLowerCase())
  if (!match) return null
  const [, fn, body] = match
  const parts = body.replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean)
  const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
  let value: number
  if (fn === 'rgb' || fn === 'rgba') value = luma(number(parts[0], 255), number(parts[1], 255), number(parts[2], 255))
  else if (fn === 'color') value = luma(number(parts[1], 1), number(parts[2], 1), number(parts[3], 1))
  else if (fn === 'oklch' || fn === 'oklab') value = number(parts[0], 1)
  else if (fn === 'lch' || fn === 'lab') value = number(parts[0], 100)
  else return null
  return Number.isFinite(value) ? value : null
}

interface Lab {
  l: number
  a: number
  b: number
  alpha: number
}

const channel = (part: string | undefined, scale: number) => (part === undefined ? 1 : part === 'none' ? 0 : number(part, scale))

function fromSrgb(r: number, g: number, b: number, alpha: number): Lab {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha,
  }
}

/** A computed CSS colour in OKLab with its alpha, or null for formats other than rgb, sRGB color(), oklab and oklch. */
export function oklab(color: string): Lab | null {
  const match = /^([a-z]+)\((.*)\)$/.exec(color.trim().toLowerCase())
  if (!match) return null
  const [, fn, body] = match
  const parts = body.replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean)
  let lab: Lab | null = null
  if (fn === 'rgb' || fn === 'rgba') lab = fromSrgb(channel(parts[0], 255), channel(parts[1], 255), channel(parts[2], 255), channel(parts[3], 1))
  else if (fn === 'color' && parts[0] === 'srgb') lab = fromSrgb(channel(parts[1], 1), channel(parts[2], 1), channel(parts[3], 1), channel(parts[4], 1))
  else if (fn === 'oklab') lab = { l: channel(parts[0], 1), a: channel(parts[1], 1), b: channel(parts[2], 1), alpha: channel(parts[3], 1) }
  else if (fn === 'oklch') {
    const [c, h] = [channel(parts[1], 1), (channel(parts[2], 1) * Math.PI) / 180]
    lab = { l: channel(parts[0], 1), a: c * Math.cos(h), b: c * Math.sin(h), alpha: channel(parts[3], 1) }
  }
  return lab && [lab.l, lab.a, lab.b, lab.alpha].every(Number.isFinite) ? lab : null
}

const WHITE = fromSrgb(1, 1, 1, 1)
const HIGHLIGHT = fromSrgb(251 / 255, 225 / 255, 122 / 255, 1)

/** The colour behind an element, stacking see-through backgrounds of it and its ancestors over a white page. */
function backgroundOf(el: Element): Lab {
  const win = el.ownerDocument.defaultView
  const layers: Lab[] = []
  for (let node: Element | null = el; node; node = node.parentElement) {
    const color = oklab(win?.getComputedStyle(node).backgroundColor ?? '')
    if (!color || color.alpha <= 0) continue
    layers.push(color)
    if (color.alpha >= 1) break
  }
  return layers.reduceRight((under, top) => {
    const k = Math.min(1, top.alpha)
    return { l: under.l + (top.l - under.l) * k, a: under.a + (top.a - under.a) * k, b: under.b + (top.b - under.b) * k, alpha: 1 }
  }, WHITE)
}

const distance = (x: Lab, y: Lab) => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)

/** The tone of the text inside an element, read from its text colour and the colour behind it. Unknown colours count as dark text on a light page. */
export function toneOf(el: Element): Tone {
  const color = el.ownerDocument.defaultView?.getComputedStyle(el).color ?? ''
  if ((lightness(color) ?? 0) > 0.5) return 'dark'
  return distance(backgroundOf(el), HIGHLIGHT) < WARM_DISTANCE ? 'warm' : 'light'
}

export class Marks {
  private readonly now = new Map<Tone, { highlight: Highlight; range: Range }>()
  private readonly read = new Map<Tone, { highlight: Highlight; ranges: Range[] }>()

  private constructor(doc: Document) {
    for (const tone of TONES) {
      const range = doc.createRange()
      const now = new Highlight(range)
      now.priority = NOW_PRIORITY
      this.now.set(tone, { highlight: now, range })
      const read = new Highlight()
      read.priority = READ_PRIORITY
      this.read.set(tone, { highlight: read, ranges: [] })
    }
    this.register()
  }

  static mount(doc: Document = document): Marks {
    return new Marks(doc)
  }

  private *owned(): Generator<[string, Highlight]> {
    for (const tone of TONES) {
      yield [nowName(tone), this.now.get(tone)!.highlight]
      yield [readName(tone), this.read.get(tone)!.highlight]
    }
  }

  // The page can see and clear the shared registry, so every show puts missing names back.
  private register() {
    for (const [name, highlight] of this.owned()) if (CSS.highlights.get(name) !== highlight) CSS.highlights.set(name, highlight)
  }

  show(now: Range | null, nowTone: Tone, read: ToneRun[]): void {
    for (const tone of TONES) {
      const { range } = this.now.get(tone)!
      if (now && tone === nowTone) {
        range.setStart(now.startContainer, now.startOffset)
        range.setEnd(now.endContainer, now.endOffset)
      } else {
        range.collapse(true)
      }

      const runs = read.filter((run) => run.tone === tone)
      const { highlight, ranges } = this.read.get(tone)!
      runs.forEach((run, k) => {
        let owned = ranges[k]
        if (!owned) {
          owned = run.range.cloneRange()
          ranges.push(owned)
          highlight.add(owned)
          return
        }
        owned.setStart(run.range.startContainer, run.range.startOffset)
        owned.setEnd(run.range.endContainer, run.range.endOffset)
      })
      for (const extra of ranges.splice(runs.length)) highlight.delete(extra)
    }
    this.register()
  }

  dispose(): void {
    for (const [name, highlight] of this.owned()) if (CSS.highlights.get(name) === highlight) CSS.highlights.delete(name)
  }
}
