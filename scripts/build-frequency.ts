import entries from 'subtlex-word-frequencies'

// Zipf = log10(occurrences per million words) + 3, the scale psycholinguists use for word frequency.
const counts = new Map<string, number>()
let total = 0
for (const { word, count } of entries as { word: string; count: number }[]) {
  total += count
  const key = word.toLowerCase()
  if (/^[a-z][a-z'-]*$/.test(key)) counts.set(key, (counts.get(key) ?? 0) + count)
}

const buckets = new Map<number, string[]>()
for (const [word, count] of counts) {
  if (count < 2) continue
  const zipf = Math.log10((count / total) * 1e6) + 3
  const bucket = Math.round(zipf * 10)
  buckets.set(bucket, [...(buckets.get(bucket) ?? []), word])
}

const lines = [...buckets.entries()]
  .sort((a, b) => b[0] - a[0])
  .map(([bucket, words]) => `${bucket} ${words.join(' ')}`)

await Bun.write(new URL('../src/data/frequency.txt', import.meta.url), lines.join('\n') + '\n')
console.log(`${counts.size} words, ${lines.length} buckets`)
