import { describe, expect, test } from 'bun:test'
import {
  joinLines,
  linesFromItems,
  paragraphsFromPages,
  stripRunningHeads,
  type PdfItem,
  type PdfLine,
} from './pdf-layout'

const item = (str: string, x: number, y: number, eol = false, size = 10): PdfItem => ({
  str,
  x,
  y,
  width: str.length * size * 0.5,
  size,
  eol,
})

const line = (text: string, y: number, x = 72, size = 10, right = 520): PdfLine => ({
  text,
  x,
  y,
  right,
  size,
})

describe('linesFromItems', () => {
  test('joins runs on one baseline and splits on end of line', () => {
    const lines = linesFromItems([
      item('Hello', 72, 700),
      item(' ', 97, 700),
      item('world', 100, 700, true),
      item('Next', 72, 686, true),
    ])
    expect(lines.map((l) => l.text)).toEqual(['Hello world', 'Next'])
  })

  test('adds a space when runs are visibly apart', () => {
    const lines = linesFromItems([item('Hello', 72, 700), item('world', 110, 700, true)])
    expect(lines[0].text).toBe('Hello world')
  })

  test('starts a new line when the baseline moves', () => {
    const lines = linesFromItems([item('Top', 72, 700), item('Lower', 72, 680)])
    expect(lines.map((l) => l.text)).toEqual(['Top', 'Lower'])
  })

  test('expands ligatures', () => {
    expect(linesFromItems([item('ﬁrst', 72, 700, true)])[0].text).toBe('first')
  })
})

describe('stripRunningHeads', () => {
  test('drops repeated headers and page numbers but keeps body lines', () => {
    const pages = [1, 2, 3, 4].map((n) => [
      line('A Study of Reading', 760),
      line(`Body text on page ${n} keeps going across the whole width of the column.`, 700),
      line(`More body on page ${n} that also runs the full measure of the text block.`, 686),
      line(String(n), 40),
    ])
    const stripped = stripRunningHeads(pages)
    expect(stripped.map((p) => p.map((l) => l.text))).toEqual(
      [1, 2, 3, 4].map((n) => [
        `Body text on page ${n} keeps going across the whole width of the column.`,
        `More body on page ${n} that also runs the full measure of the text block.`,
      ]),
    )
  })

  test('keeps everything in very short documents', () => {
    const pages = [[line('Title', 760), line('Body.', 700)]]
    expect(stripRunningHeads(pages)[0]).toHaveLength(2)
  })
})

describe('joinLines', () => {
  const words = new Set(['comprehension', 'well', 'known'])
  const isWord = (w: string) => words.has(w)

  test('removes a soft line-end hyphen', () => {
    expect(joinLines('reading compre-', 'hension matters', isWord)).toBe('reading comprehension matters')
  })

  test('keeps a real compound hyphen', () => {
    expect(joinLines('a well-', 'known effect', isWord)).toBe('a well-known effect')
  })

  test('joins unknown splits, since most line-end hyphens are soft', () => {
    expect(joinLines('the sacca-', 'dic movement', isWord)).toBe('the saccadic movement')
  })

  test('keeps the hyphen before a capital', () => {
    expect(joinLines('pre-', 'Columbian art', isWord)).toBe('pre- Columbian art')
  })
})

describe('paragraphsFromPages', () => {
  test('breaks paragraphs on indents and short sentence-ending lines', () => {
    const page = [
      line('Your eyes do not glide across a page. They jump, and each', 700),
      line('jump is called a saccade.', 686, 72, 10, 240),
      line('Skilled readers make fewer fixations per line, and they', 672, 90),
      line('rarely land on short words.', 658),
    ]
    expect(paragraphsFromPages([page])).toBe(
      'Your eyes do not glide across a page. They jump, and each jump is called a saccade.\n\n' +
        'Skilled readers make fewer fixations per line, and they rarely land on short words.',
    )
  })

  test('breaks on a blank-line gap', () => {
    const page = [
      line('First paragraph runs across the full width of the column', 700),
      line('and ends here', 686),
      line('Second paragraph starts after a gap and runs on across', 650),
    ]
    expect(paragraphsFromPages([page]).split('\n\n')).toHaveLength(2)
  })

  test('continues a paragraph across a page break', () => {
    const pages = [
      [line('The paragraph runs to the bottom of the page and keeps', 60)],
      [line('going on the next page without a break.', 760)],
    ]
    expect(paragraphsFromPages(pages)).toBe(
      'The paragraph runs to the bottom of the page and keeps going on the next page without a break.',
    )
  })

  test('turns large text into headings and merges multi-line titles', () => {
    const page = [
      line('Chapter One', 740, 72, 20),
      line('The Beginning', 716, 72, 20),
      ...Array.from({ length: 6 }, (_, i) =>
        line(`Body line ${i} with enough words to count as text here`, 680 - i * 14),
      ),
    ]
    const [heading] = paragraphsFromPages([page]).split('\n\n')
    expect(heading).toBe('# Chapter One The Beginning')
  })

  test('reads a large notice that ends in a full stop as body text', () => {
    const page = [
      line('Permission is granted to reproduce the tables and figures', 740, 72, 12),
      line('in this paper for scholarly works.', 726, 72, 12),
      ...Array.from({ length: 6 }, (_, i) =>
        line(`Body line ${i} with enough words to count as text here`, 680 - i * 14),
      ),
    ]
    const [first] = paragraphsFromPages([page]).split('\n\n')
    expect(first).toBe('Permission is granted to reproduce the tables and figures in this paper for scholarly works.')
  })

  test('turns a one-line numbered title into a subheading', () => {
    const page = [
      line('3.2 Scaled Attention', 700, 72, 10, 200),
      line('An attention function maps a query and a set of pairs', 672),
      line('to an output.', 658, 72, 10, 160),
    ]
    expect(paragraphsFromPages([page]).split('\n\n')[0]).toBe('### 3.2 Scaled Attention')
  })

  test('escapes body text that starts with a hash', () => {
    const page = [line('# layers 1+2n 2n 2n', 700, 72, 10, 200)]
    expect(paragraphsFromPages([page])).toBe('\\# layers 1+2n 2n 2n')
  })
})
