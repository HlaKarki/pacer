import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { parse, sentenceStart } from '../../src/lib/text'
import { PAST_END, startFrom } from '../store'
import { WordMap } from './map'
import { selectedWord, viewportStart } from './start'

const window = new Window()
globalThis.Node = window.Node as unknown as typeof Node
globalThis.NodeFilter = window.NodeFilter as unknown as typeof NodeFilter
const document = window.document as unknown as Document
const RangeProto = window.Range.prototype as unknown as Range
const win = window as unknown as Window

const LINE = 20
const CHARS_PER_LINE = 60
const HEIGHT = 800

// happy-dom has no layout, so each block carries its page top in data-top and wraps every 60 characters.
let scrolled = 0
const lineTop = (node: Node, offset: number) => {
  const block = (node.parentElement as HTMLElement).closest<HTMLElement>('[data-top]')
  return Number(block?.dataset.top ?? 0) + Math.floor(offset / CHARS_PER_LINE) * LINE - scrolled
}
const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 0, right: 600, width: 600 }) as DOMRect

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: HEIGHT, configurable: true })
  Object.defineProperty(window, 'scrollY', { get: () => scrolled, configurable: true })
  RangeProto.getClientRects = function (this: Range) {
    const top = lineTop(this.startContainer, this.startOffset)
    return [rect(top, top + LINE)] as unknown as DOMRectList
  }
  RangeProto.getBoundingClientRect = function (this: Range) {
    return rect(lineTop(this.startContainer, this.startOffset), lineTop(this.endContainer, this.endOffset - 1) + LINE)
  }
})

afterEach(() => {
  scrolled = 0
  delete (RangeProto as Partial<Range>).getClientRects
  delete (RangeProto as Partial<Range>).getBoundingClientRect
})

const para = (n: number) => `Paragraph ${n} opens with its number and then keeps going.`
const tops = (count: number, gap = 200) => Array.from({ length: count }, (_, n) => n * gap)

function setup(text: string, html: string) {
  const doc = parse(text)
  document.body.innerHTML = html
  return { doc, map: WordMap.build(doc, document.body as unknown as Element) }
}

function paragraphs(count: number) {
  return setup(
    tops(count).map((_, n) => para(n)).join('\n\n'),
    tops(count).map((top, n) => `<p data-top="${top}">${para(n)}</p>`).join(''),
  )
}

describe('viewportStart', () => {
  test('starts an unscrolled page at the heading the page shows when its title is not shown', () => {
    const { doc, map } = setup(
      `# Window Title Only\n\n# How Eyes Read\n\n${para(1)}`,
      `<h1 data-top="0">How Eyes Read</h1><p data-top="60">${para(1)}</p>`,
    )
    expect(viewportStart(doc, map, win)).toEqual({ from: 0, at: 3 })
  })

  test('starts a scrolled page at the first paragraph that ends below the header strip', () => {
    const { doc, map } = paragraphs(10)
    scrolled = 1000
    expect(viewportStart(doc, map, win)).toEqual({ from: 6, at: doc.paragraphs[6].start })
  })

  test('starts at the paragraph after a code block that fills the window', () => {
    const { doc, map } = setup(
      [para(0), para(1), para(2)].join('\n\n'),
      `<p data-top="0">${para(0)}</p><p data-top="200">${para(1)}</p><pre>const x = 1</pre><p data-top="2400">${para(2)}</p>`,
    )
    scrolled = 1300
    expect(viewportStart(doc, map, win)).toEqual({ from: 2, at: doc.paragraphs[2].start })
  })

  test('says a press below the article is past the end and offers the top', () => {
    const { doc, map } = paragraphs(4)
    scrolled = 5000
    const start = viewportStart(doc, map, win)
    expect(start).toEqual({ from: PAST_END, at: 0 })
    expect(startFrom(doc, start!.from, { index: 30, words: doc.words.length, from: 2 }, start!.at)).toBe(30)
    expect(startFrom(doc, start!.from, undefined, start!.at)).toBe(0)
  })

  test('starts a long paragraph that began far above the window at the sentence in view', () => {
    const sentences = Array.from({ length: 80 }, (_, s) => `Sentence ${s} has exactly ten short words in it here.`)
    const body = sentences.join(' ')
    const { doc, map } = setup(`# Long Essay\n\n${body}`, `<h1 data-top="0">Long Essay</h1><p data-top="40">${body}</p>`)
    scrolled = 1000
    const strip = HEIGHT * 0.15
    let offset = 0
    let firstInView = -1
    body.split(' ').forEach((word, k) => {
      const bottom = 40 + Math.floor(offset / CHARS_PER_LINE) * LINE - scrolled + LINE
      if (firstInView === -1 && bottom > strip) firstInView = 2 + k
      offset += word.length + 1
    })
    const start = viewportStart(doc, map, win)
    expect(start?.from).toBe(1)
    expect(start?.at).toBe(sentenceStart(doc, firstInView))
    expect(start!.at).toBeGreaterThan(doc.paragraphs[1].start)
  })

  test('moves past paragraphs the page mostly hides', () => {
    const { doc, map } = setup(
      [para(0), para(1), para(2)].join('\n\n'),
      `<p data-top="0">Paragraph 0 opens</p><p data-top="200">${para(1)}</p><p data-top="400">${para(2)}</p>`,
    )
    expect(viewportStart(doc, map, win)).toEqual({ from: 0, at: doc.paragraphs[1].start })
  })

  test('gives up when no paragraph near the start is shown', () => {
    const { doc, map } = setup(
      tops(8).map((_, n) => para(n)).join('\n\n'),
      `<p data-top="1400">${para(7)}</p>`,
    )
    expect(viewportStart(doc, map, win)).toBeNull()
  })

  test('reads the scroll of an inner scroll box', () => {
    const { doc, map } = setup(
      tops(10).map((_, n) => para(n)).join('\n\n'),
      `<div id="scroller" style="overflow-y: auto">${tops(10).map((top, n) => `<p data-top="${top}">${para(n)}</p>`).join('')}</div>`,
    )
    const scroller = document.getElementById('scroller')!
    Object.defineProperty(scroller, 'scrollHeight', { value: 2000 })
    Object.defineProperty(scroller, 'clientHeight', { value: HEIGHT })
    scrolled = 1000
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    Object.defineProperty(scroller, 'scrollTop', { value: 1000 })
    expect(viewportStart(doc, map, win)?.from).toBe(6)
  })
})

describe('selectedWord', () => {
  const select = (startNode: Node, startOffset: number, endNode: Node, endOffset: number) => {
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
  }
  const twice = () =>
    setup('The same words here.\n\nThe same words here.', '<article><p data-top="0">The same words here.</p><p data-top="200">The same words here.</p></article>')

  afterEach(() => document.getSelection()?.removeAllRanges())

  test('starts where the live selection starts, even when the same text comes earlier', () => {
    const { doc, map } = twice()
    const second = document.querySelectorAll('p')[1].firstChild!
    select(second, 4, second, 14)
    expect(selectedWord(document, map, doc, 'same words')).toBe(5)
  })

  test('starts at the block a selection begins on when it starts between blocks', () => {
    const { doc, map } = twice()
    const article = document.querySelector('article')!
    select(article, 1, article, 2)
    expect(selectedWord(document, map, doc, 'The same words here.')).toBe(4)
  })

  test('walks past a heading Pacer skips to the first word it maps', () => {
    const { doc, map } = setup(para(1), `<h2 data-top="0">Share this</h2><p data-top="60">${para(1)}</p>`)
    select(document.querySelector('h2')!.firstChild!, 0, document.querySelector('p')!.firstChild!, 9)
    expect(selectedWord(document, map, doc, 'Share this Paragraph')).toBe(0)
  })

  test('finds the selected text in the article when the page has no live selection', () => {
    const { doc, map } = twice()
    expect(selectedWord(document, map, doc, 'words here')).toBe(2)
    expect(selectedWord(document, map, doc, 'not on this page')).toBe(-1)
  })
})
