/** Zipf frequency by lowercase word: about 7 for "the", 3 for "comprehension", under 2 for rare words. */
export type FrequencyMap = Map<string, number>

/** Words missing from the list are rarer than anything in it, which keeps count >= 2. */
export const UNKNOWN_ZIPF = 1.4
const NUMBER_ZIPF = 3

export function parseFrequency(raw: string): FrequencyMap {
  const map: FrequencyMap = new Map()
  for (const line of raw.split('\n')) {
    const [bucket, ...words] = line.split(' ')
    if (!bucket) continue
    const zipf = Number(bucket) / 10
    for (const word of words) map.set(word, zipf)
  }
  return map
}

let pending: Promise<FrequencyMap> | null = null

export function loadFrequency(): Promise<FrequencyMap> {
  pending ??= import('../data/frequency.txt?raw').then((m) => parseFrequency(m.default))
  return pending
}

function lookup(freq: FrequencyMap, part: string): number {
  // SUBTLEX splits contractions at the apostrophe, so "don't" is counted under "don".
  const head = part.split(/['’]/)[0]
  return freq.get(head) ?? UNKNOWN_ZIPF
}

export function zipfOf(token: string, freq: FrequencyMap): number {
  const core = token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  if (!core) return NUMBER_ZIPF
  if (/^[\d.,:%/-]+$/.test(core)) return NUMBER_ZIPF
  const parts = core.split(/[-–—/]/).filter(Boolean)
  // A compound is as hard as its rarest part.
  return Math.min(...parts.map((p) => lookup(freq, p)))
}
