import type { Doc, Pause } from './text'
import { zipfOf, type FrequencyMap } from './frequency'

const PAUSE_WEIGHT: Record<Pause, number> = {
  none: 0,
  clause: 0.5,
  sentence: 1.0,
  paragraph: 1.6,
}

export interface PaceOptions {
  pauses: boolean
  smart: boolean
  freq: FrequencyMap | null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Eye-tracking studies find fixations grow with word length and rarity, so both scale how long a word holds the highlighter.
export function wordCost(text: string, freq: FrequencyMap | null): number {
  const letters = text.replace(/[^\p{L}\p{N}]/gu, '').length
  const lengthFactor = clamp(1 + 0.035 * (letters - 5), 0.88, 1.35)
  const freqFactor = freq ? clamp(1 + 0.11 * (4.5 - zipfOf(text, freq)), 0.6, 1.5) : 1
  return lengthFactor * freqFactor
}

export function msPerWord(wpm: number): number {
  return 60000 / wpm
}

// Smart costs are divided by the document mean so the average word still takes 60000 / wpm ms.
export function weightPrefix(doc: Doc, { pauses, smart, freq }: PaceOptions): Float64Array {
  const n = doc.words.length
  const costs = new Float64Array(n)
  const seen = new Map<string, number>()
  let sum = 0
  for (let i = 0; i < n; i++) {
    const text = doc.words[i].text
    let cost = smart ? seen.get(text) : 1
    if (cost === undefined) {
      cost = wordCost(text, freq)
      seen.set(text, cost)
    }
    costs[i] = cost
    sum += cost
  }
  const mean = n ? sum / n : 1
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const pause = pauses ? PAUSE_WEIGHT[doc.words[i].pause] : 0
    prefix[i + 1] = prefix[i] + costs[i] / mean + pause
  }
  return prefix
}

export function chunkMs(
  prefix: Float64Array,
  chunk: { start: number; end: number },
  wpm: number,
): number {
  return (prefix[chunk.end] - prefix[chunk.start]) * msPerWord(wpm)
}

/** Slow the first few chunks after play so the eye can catch up. */
export function rampFactor(chunksSincePlay: number): number {
  const RAMP = 6
  if (chunksSincePlay >= RAMP) return 1
  return 1 + 0.6 * (1 - chunksSincePlay / RAMP)
}

/** Optimal recognition point: the letter the eye should land on. */
export function orpIndex(word: string): number {
  const lead = word.match(/^[^\p{L}\p{N}]*/u)?.[0].length ?? 0
  const n = word.replace(/[^\p{L}\p{N}]/gu, '').length
  const offset = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4
  return Math.min(word.length - 1, lead + offset)
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.round(totalSeconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min`
}
