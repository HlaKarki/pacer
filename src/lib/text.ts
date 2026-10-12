export type Pause = 'none' | 'clause' | 'sentence' | 'paragraph'

export interface Word {
  text: string
  para: number
  sent: number
  pause: Pause
}

export interface Paragraph {
  start: number
  end: number
  /** Heading level from a leading `#`, `##`… marker, or 0 for body text. */
  heading: number
}

export interface Section {
  start: number
  end: number
  title: string | null
  /** False when a long chapter was split only to keep the page light. */
  opensChapter: boolean
}

export interface Doc {
  words: Word[]
  paragraphs: Paragraph[]
  sentences: { start: number; end: number }[]
  sections: Section[]
}

export type ChunkSize = 1 | 2 | 3 | 'phrase' | 'sentence'

/** Flow mode renders one section at a time, so a whole book never sits in the DOM at once. */
export const SECTION_WORDS = 4000

const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'sr.', 'jr.', 'st.', 'vs.', 'etc.',
  'e.g.', 'i.e.', 'fig.', 'no.', 'vol.', 'approx.', 'inc.', 'ltd.', 'co.',
])

/** Closed-class words that lean on the word after them, so "of the eye" reads as one phrase. */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'as', 'into',
  'onto', 'about', 'between', 'through', 'over', 'under', 'after', 'before', 'during',
  'without', 'within', 'across', 'against', 'among', 'around', 'toward', 'towards', 'upon',
  'and', 'or', 'but', 'nor', 'if', 'than', 'because', 'while', 'when', 'where', 'whether',
  'this', 'these', 'those', 'its', 'his', 'her', 'their', 'our', 'my', 'your',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'is', 'are', 'was', 'were', 'be', 'been',
  'am', 'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'must', 'shall', 'not', 'no', 'very', 'so', 'too', 'more',
  'most', 'such', 'each', 'every', 'some', 'any', 'all', 'both', 'few', 'many', 'much',
])

const PHRASE_MAX_WORDS = 3
const PHRASE_MAX_LETTERS = 16

const TRAILING_CLOSERS = /["'”’)\]}»]+$/

function pauseOf(token: string): Pause {
  const bare = token.replace(TRAILING_CLOSERS, '')
  if (/[.!?…]$/.test(bare)) {
    if (ABBREVIATIONS.has(bare.toLowerCase())) return 'none'
    // Single capital initials like "J." are usually names, so they do not end a sentence.
    if (/^[A-Z]\.$/.test(bare)) return 'none'
    return 'sentence'
  }
  if (/[,;:—–]$/.test(bare) || /^[—–]$/.test(token)) return 'clause'
  return 'none'
}

function splitParagraphs(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  // PDFs hard-wrap lines and mark paragraphs with blank lines, but web copy uses one newline per paragraph, so blank lines decide the rule.
  const separator = /\n\s*\n/.test(text) ? /\n\s*\n+/ : /\n+/
  return text
    .split(separator)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function buildSections(paragraphs: Paragraph[], words: Word[]): Section[] {
  const sections: Section[] = []
  for (const p of paragraphs) {
    const last = sections.at(-1)
    const opensChapter = p.heading > 0 && p.heading <= 2
    if (!last || opensChapter || last.end - last.start >= SECTION_WORDS) {
      const title = opensChapter
        ? words.slice(p.start, p.end).map((w) => w.text).join(' ')
        : (last?.title ?? null)
      sections.push({ start: p.start, end: p.end, title, opensChapter })
    } else {
      last.end = p.end
    }
  }
  return sections
}

export function parse(raw: string): Doc {
  const words: Word[] = []
  const paragraphs: Paragraph[] = []
  const sentences: Doc['sentences'] = []
  let sent = 0
  let sentStart = 0

  splitParagraphs(raw).forEach((rawParagraph, para) => {
    const marker = rawParagraph.match(/^(#{1,6})\s+(?=\S)/)
    const paragraph = marker
      ? rawParagraph.slice(marker[0].length)
      : rawParagraph.replace(/^\\(?=#)/, '')
    const start = words.length
    const tokens = paragraph.split(' ')
    tokens.forEach((text, i) => {
      const isLast = i === tokens.length - 1
      const pause = isLast ? 'paragraph' : pauseOf(text)
      words.push({ text, para, sent, pause })
      if (pause === 'sentence' || pause === 'paragraph') {
        sentences.push({ start: sentStart, end: words.length })
        sent += 1
        sentStart = words.length
      }
    })
    paragraphs.push({ start, end: words.length, heading: marker ? marker[1].length : 0 })
  })

  return { words, paragraphs, sentences, sections: buildSections(paragraphs, words) }
}

/** Imported body text that starts with `#` must not turn into a heading. */
export function escapeBody(paragraph: string): string {
  return paragraph.startsWith('#') ? `\\${paragraph}` : paragraph
}

export function countWords(raw: string): number {
  const trimmed = raw.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

const bareWord = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/** A chunk never crosses a pause or a paragraph, and with `lineOf` it never wraps onto a second line. A sentence chunk runs to the end of its sentence. */
export function chunkAt(
  doc: Doc,
  start: number,
  size: ChunkSize,
  lineOf?: (i: number) => number,
): { start: number; end: number } {
  const { words } = doc
  if (size === 'sentence') {
    const sentence = doc.sentences[words[start]?.sent ?? -1]
    return { start, end: sentence ? sentence.end : Math.min(start + 1, words.length) }
  }
  const phrase = size === 'phrase'
  const limit = phrase ? PHRASE_MAX_WORDS : size
  let letters = words[start] ? bareWord(words[start].text).length : 0
  let end = start + 1
  while (end < words.length && end - start < limit) {
    const prev = words[end - 1]
    const next = words[end]
    if (prev.pause !== 'none') break
    if (next.para !== prev.para) break
    if (lineOf && lineOf(end) !== lineOf(start)) break
    if (phrase) {
      if (!FUNCTION_WORDS.has(bareWord(prev.text))) break
      letters += bareWord(next.text).length
      if (letters > PHRASE_MAX_LETTERS) break
    }
    end += 1
  }
  return { start, end: Math.min(end, words.length) }
}

export function sentenceStart(doc: Doc, i: number): number {
  return doc.sentences[doc.words[i]?.sent ?? 0]?.start ?? 0
}

export function sectionAt(doc: Doc, i: number): Section {
  const { sections } = doc
  let lo = 0
  let hi = sections.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (sections[mid].start <= i) lo = mid
    else hi = mid - 1
  }
  return sections[lo]
}

const FIND_CHARS = 80

const lettersOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/** The word where the text first appears, or -1. A PDF viewer's selection breaks lines and hyphens where the parsed text does not, so only letters and digits are compared. */
export function findText(doc: Doc, text: string): number {
  const key = lettersOf(text).slice(0, FIND_CHARS)
  if (!key) return -1
  const starts = new Int32Array(doc.words.length)
  const parts: string[] = []
  let length = 0
  doc.words.forEach((word, i) => {
    starts[i] = length
    const letters = lettersOf(word.text)
    parts.push(letters)
    length += letters.length
  })
  const at = parts.join('').indexOf(key)
  if (at < 0) return -1
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}
