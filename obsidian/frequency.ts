import raw from '../src/data/frequency.txt' with { type: 'text' }
import { parseFrequency, type FrequencyMap } from '../src/lib/frequency'

let parsed: FrequencyMap | null = null

/** Parsing 74,000 words takes a moment, so it waits for the first file Pacer opens. */
export function frequency(): FrequencyMap {
  parsed ??= parseFrequency(raw)
  return parsed
}
