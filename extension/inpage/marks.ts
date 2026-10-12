/** 'dark' for light text on a dark background, which needs its own highlight colours. */
export type Tone = 'light' | 'dark'

export interface ToneRun {
  tone: Tone
  range: Range
}

const TONES: Tone[] = ['light', 'dark']
const NOW_PRIORITY = 2
const READ_PRIORITY = 1

const nowName = (tone: Tone) => `pacer-now-${tone}`
const readName = (tone: Tone) => `pacer-read-${tone}`

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

/** The tone of the text inside an element, read from its text colour. Unknown colours count as dark text on a light page. */
export function toneOf(el: Element): Tone {
  const color = el.ownerDocument.defaultView?.getComputedStyle(el).color ?? ''
  return (lightness(color) ?? 0) > 0.5 ? 'dark' : 'light'
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
