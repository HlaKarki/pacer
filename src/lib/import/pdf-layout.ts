import { escapeBody } from '../text'

/** A run of text from pdf.js, in PDF user space where y grows upward. */
export interface PdfItem {
  str: string
  x: number
  y: number
  width: number
  size: number
  eol: boolean
}

export interface PdfLine {
  text: string
  x: number
  y: number
  right: number
  size: number
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const clean = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim()

/** Groups items into visual lines, keeping pdf.js content order so columns stay in reading order. */
export function linesFromItems(items: PdfItem[]): PdfLine[] {
  const lines: PdfLine[] = []
  let line: PdfLine | null = null
  const flush = () => {
    if (line) {
      line.text = clean(line.text)
      if (line.text) lines.push(line)
    }
    line = null
  }
  for (const item of items) {
    if (line && Math.abs(item.y - line.y) > Math.max(line.size, item.size) * 0.5) flush()
    if (item.str.trim()) {
      if (!line) {
        line = { text: item.str, x: item.x, y: item.y, right: item.x + item.width, size: item.size }
      } else {
        const gap = item.x - line.right
        const spaced = /\s$/.test(line.text) || /^\s/.test(item.str)
        const apart = gap > item.size * 0.15 || gap < -item.size
        line.text += (!spaced && apart ? ' ' : '') + item.str
        line.right = Math.max(line.right, item.x + item.width)
        line.size = Math.max(line.size, item.size)
      }
    } else if (line && item.str) {
      line.text += ' '
    }
    if (item.eol) flush()
  }
  flush()
  return lines
}

const PAGE_NUMBER = /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s+of\s+\d{1,4})?$|^[-–—]\s*\d{1,4}\s*[-–—]$/i

/** Drops running headers, footers and page numbers: edge lines that repeat across pages. */
export function stripRunningHeads(pages: PdfLine[][]): PdfLine[][] {
  const key = (text: string) => text.toLowerCase().replace(/\d+/g, '#')
  const edgesOf = (page: PdfLine[]) => {
    const byHeight = [...page].sort((a, b) => b.y - a.y)
    return new Set([...byHeight.slice(0, 2), ...byHeight.slice(-2)])
  }
  const edges = pages.map(edgesOf)
  const seen = new Map<string, number>()
  edges.forEach((set) => {
    for (const k of new Set([...set].map((l) => key(l.text)))) seen.set(k, (seen.get(k) ?? 0) + 1)
  })
  const threshold = pages.length >= 3 ? Math.max(2, Math.ceil(pages.length * 0.3)) : Infinity
  return pages.map((page, i) =>
    page.filter((line) => {
      if (!edges[i].has(line) || line.text.split(' ').length > 10) return true
      if (PAGE_NUMBER.test(line.text)) return false
      return (seen.get(key(line.text)) ?? 0) < threshold
    }),
  )
}

// A line-end hyphen stays only when both halves are words and the joined form is not, as in "well-known".
export function joinLines(a: string, b: string, isWord?: (w: string) => boolean): string {
  const hyphen = a.match(/(\p{L}+)-$/u)
  const tail = b.match(/^(\p{Ll}+)/u)
  if (!hyphen || !tail) return `${a} ${b}`
  const head = hyphen[1].toLowerCase()
  const keep = isWord && !isWord(head + tail[1]) && isWord(head) && isWord(tail[1])
  return keep ? a + b : a.slice(0, -1) + b
}

const ENDS_SENTENCE = /[.!?:…]["'”’)\]]*$/
const NUMBERED_HEADING = /^(?:\d{1,2}(?:\.\d{1,2})*\.?|[A-Z]\.(?:\d{1,2}\.?)*)\s+\p{Lu}[^.!?;,]*$/u

/** `pages` holds the 1-based page each paragraph starts on, so paragraph k of the text is on page pages[k]. */
export function paragraphsFromPages(
  pages: PdfLine[][],
  isWord?: (w: string) => boolean,
): { text: string; pages: number[] } {
  const all = pages.flatMap((lines, page) => lines.map((line) => ({ ...line, page })))
  if (!all.length) return { text: '', pages: [] }

  const weightedSizes = all.flatMap((l) => new Array<number>(Math.min(20, Math.ceil(l.text.length / 10))).fill(l.size))
  const body = median(weightedSizes)
  const gaps: number[] = []
  for (let i = 1; i < all.length; i++) {
    const [a, b] = [all[i - 1], all[i]]
    const dy = a.y - b.y
    if (a.page === b.page && dy > 0 && dy < body * 3 && Math.abs(a.size - body) < 0.5) gaps.push(dy)
  }
  const lineGap = median(gaps) || body * 1.2

  const columnRight = (line: (typeof all)[number]) =>
    Math.max(
      ...pages[line.page].filter((l) => Math.abs(l.x - line.x) < body * 8).map((l) => l.right),
    )
  const isHeading = (l: (typeof all)[number]) =>
    l.size >= body * 1.2 && l.text.split(' ').length <= 15

  const out: string[] = []
  const outPages: number[] = []
  let paragraph = ''
  let paragraphPage = 0
  let lineCount = 0
  let heading: { text: string; size: number; page: number } | null = null
  const flushParagraph = () => {
    if (paragraph) {
      const numbered =
        lineCount === 1 && paragraph.split(' ').length <= 10 && NUMBERED_HEADING.test(paragraph)
      out.push(numbered ? `### ${paragraph}` : escapeBody(paragraph))
      outPages.push(paragraphPage + 1)
    }
    paragraph = ''
    lineCount = 0
  }
  const flushHeading = () => {
    if (heading) {
      const words = heading.text.split(' ').length
      // Large lines that run on and end in a full stop are a notice or a pull quote, so they read as body text.
      const prose = words > 20 || (words > 8 && ENDS_SENTENCE.test(heading.text))
      out.push(prose ? escapeBody(heading.text) : `${heading.size >= body * 1.6 ? '#' : '##'} ${heading.text}`)
      outPages.push(heading.page + 1)
    }
    heading = null
  }

  all.forEach((line, i) => {
    const prev = all[i - 1]
    if (isHeading(line)) {
      flushParagraph()
      const continues = heading && heading.page === line.page && Math.abs(heading.size - line.size) < 0.5
      if (heading && continues) heading.text += ` ${line.text}`
      else {
        flushHeading()
        heading = { text: line.text, size: line.size, page: line.page }
      }
      return
    }
    flushHeading()
    if (!paragraph || !prev) {
      paragraph = line.text
      paragraphPage = line.page
      lineCount = 1
      return
    }
    const dy = prev.y - line.y
    const dx = line.x - prev.x
    const blankLine = prev.page === line.page && dy > lineGap * 1.45
    const indented = dx > body * 0.8 && dx < body * 6
    const short = prev.right < columnRight(prev) - body * 3
    const shortEnd = short && ENDS_SENTENCE.test(prev.text)
    const afterTitle = short && lineCount === 1 && NUMBERED_HEADING.test(prev.text)
    if (blankLine || indented || shortEnd || afterTitle) {
      flushParagraph()
      paragraph = line.text
      paragraphPage = line.page
      lineCount = 1
    } else {
      paragraph = joinLines(paragraph, line.text, isWord)
      lineCount += 1
    }
  })
  flushParagraph()
  flushHeading()
  // Chapter titles are unique, so a large label that repeats belongs to a figure and stays out of the contents.
  const counts = new Map<string, number>()
  for (const p of out) if (/^##? /.test(p)) counts.set(p, (counts.get(p) ?? 0) + 1)
  const text = out.map((p) => ((counts.get(p) ?? 0) > 1 ? p.replace(/^##? /, '### ') : p)).join('\n\n')
  return { text, pages: outPages }
}
