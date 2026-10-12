import { sentenceStart, type ChunkSize, type Doc } from './text'
import { chunkMs, rampFactor } from './timing'
import { WPM_MAX, WPM_MIN } from './storage'

export const clampWpm = (wpm: number) => Math.min(WPM_MAX, Math.max(WPM_MIN, wpm))

/** How long a chunk stays highlighted. Sentence chunks skip the ramp, since one sentence already holds the eye long enough. */
export function chunkDelayMs(
  prefix: Float64Array,
  chunk: { start: number; end: number },
  wpm: number,
  size: ChunkSize,
  sincePlay: number,
): number {
  return chunkMs(prefix, chunk, wpm) * (size === 'sentence' ? 1 : rampFactor(sincePlay))
}

/** Like a music player, the first press restarts the sentence and a second press goes back one. */
export function prevSentenceTarget(doc: Doc, index: number, playing: boolean): number {
  const start = sentenceStart(doc, index)
  const grace = playing ? 3 : 1
  return index - start >= grace ? start : sentenceStart(doc, Math.max(0, start - 1))
}

export function nextSentenceTarget(doc: Doc, index: number): number {
  const next = doc.sentences[doc.words[index].sent + 1]
  return next ? next.start : doc.words.length - 1
}
