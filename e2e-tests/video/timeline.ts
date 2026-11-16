// Tests load this file, so it must not import Playwright.

export const READ_CPS = 17
export const WATCH = 1.5
const LEAD = 0.8
const TAIL = 1.0

export type Cam = [t: number, s: number, fx: number, fy: number]
export type Seg = {
  len: number
  caption: string
  clip?: string
  from?: number
  fade?: number
  cam?: Cam[]
  keys?: [mark: string, labels: string[]][]
  click?: string
  rsvp?: boolean
  card?: string
  end?: boolean
}

export const TAKES: Record<string, number> = { cold: 8, article: 26, pdf: 9, epub: 7, obsidian: 10 }

export const MARKS: Record<string, Record<string, number>> = {
  article: { pace: 1.2, play: 2.4, up1: 8.5, up2: 9.3, click: 15.2, esc1: 20.0, esc2: 20.7, pace2: 22.5 },
  cold: { pace: 0.3 },
  obsidian: { pace: 1.8, play: 2.6 },
  pdf: { play: 0.6 },
  epub: { play: 0.6 },
}

const ALT = ['Alt', 'Shift', 'P']
const LINE = 275

export const SEGS: Seg[] = [
  { len: 5.0, clip: 'cold', from: 2.0, caption: 'You can read any web page by following a highlight.', cam: [[0, 1.3, 640, LINE], [4.5, 1.42, 640, LINE]] },
  { len: 5.0, rsvp: true, fade: 0.3, caption: 'In one-word-at-a-time apps, you miss words when you blink.' },
  { len: 2.0, card: 'On any web page', caption: '' },
  { len: 5.5, clip: 'article', from: 0.0, fade: 0.3, caption: 'You can start with Alt+Shift+P, then play with Space.', keys: [['pace', ALT], ['play', ['Space']]] },
  {
    len: 5.5, clip: 'article', from: 7.0, fade: 0.3, caption: 'You can speed up or slow down with ↑ and ↓.', keys: [['up1', ['↑']], ['up2', ['↑']]],
    cam: [[0.8, 1, 640, 400], [1.5, 1.6, 520, 690], [4.2, 1.6, 520, 690], [5.0, 1.1, 640, LINE]],
  },
  { len: 4.5, clip: 'article', from: 14.0, fade: 0.3, caption: 'You can jump to any word by clicking it.', click: 'click', cam: [[0, 1.1, 640, LINE], [0.6, 1.3, 640, LINE]] },
  {
    len: 6.0, clip: 'article', from: 18.5, caption: 'You can stop with Esc and resume from the same word later.',
    keys: [['esc1', ['Esc']], ['esc2', ['Esc']], ['pace2', ALT]], cam: [[0, 1.3, 640, LINE], [0.6, 1, 640, LINE]],
  },
  { len: 2.0, card: 'In Obsidian', caption: '' },
  { len: 6.5, clip: 'obsidian', from: 0.3, fade: 0.3, caption: 'You can read your Obsidian notes the same way.', keys: [['play', ['Space']]], cam: [[2.5, 1, 640, 360], [3.6, 1.45, 1100, 600]] },
  { len: 2.0, card: 'PDFs and EPUBs', caption: '' },
  { len: 4.5, clip: 'pdf', from: 0.3, fade: 0.3, caption: 'You can read PDFs in Pacer’s reader.' },
  { len: 4.0, clip: 'epub', from: 2.0, fade: 0.3, caption: 'You can read EPUBs there too.' },
  { len: 4.5, end: true, caption: '' },
]

export const minLen = (seg: Pick<Seg, 'caption'>) => (seg.caption ? [...seg.caption].length / READ_CPS + WATCH : 0)

const name = (i: number, seg: Seg) => `beat ${i + 1} (${seg.clip ?? seg.card ?? (seg.rsvp ? 'rsvp' : 'end')})`

export function checkBeats(segs: Seg[]): string[] {
  return segs.flatMap((seg, i) => {
    const need = minLen(seg)
    return seg.len + 1e-9 < need ? [`${name(i, seg)} runs ${seg.len} s but its caption needs ${need.toFixed(2)} s`] : []
  })
}

export function checkTakes(segs: Seg[], takes: Record<string, number>): string[] {
  return segs.flatMap((seg, i) => {
    if (!seg.clip) return []
    const take = takes[seg.clip]
    if (take === undefined) return [`${name(i, seg)} uses a take with no length`]
    const end = (seg.from ?? 0) + seg.len
    return end > take + 1e-9 ? [`${name(i, seg)} needs ${end} s of a ${take} s take`] : []
  })
}

export function checkMarks(segs: Seg[], marks: Record<string, Record<string, number>>): string[] {
  return segs.flatMap((seg, i) => {
    if (!seg.clip) return []
    const names = [...(seg.keys ?? []).map(([m]) => m), ...(seg.click ? [seg.click] : [])]
    return names.flatMap((m) => {
      const at = marks[seg.clip!]?.[m]
      if (at === undefined) return [`${name(i, seg)} uses mark ${m}, which has no planned time`]
      const v = at - (seg.from ?? 0)
      if (v < LEAD) return [`${name(i, seg)} has ${m} ${v.toFixed(2)} s in, before the ${LEAD} s lead-in ends`]
      if (v > seg.len - TAIL) return [`${name(i, seg)} has ${m} ${(seg.len - v).toFixed(2)} s before the end, under ${TAIL} s`]
      return []
    })
  })
}
