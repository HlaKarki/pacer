import { parseFrequency, type FrequencyMap } from './frequency'

let pending: Promise<FrequencyMap> | null = null

export function loadFrequency(): Promise<FrequencyMap> {
  pending ??= import('../data/frequency.txt?raw').then((m) => parseFrequency(m.default))
  return pending
}
