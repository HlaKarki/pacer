import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { parse } from '../../src/lib/text'
import { alignWords, WordMap } from './map'

const window = new Window()
globalThis.Node = window.Node as unknown as typeof Node
const document = window.document as unknown as Document
const RangeProto = window.Range.prototype as unknown as Range

const split = (text: string) => text.split(' ')
const pairs = (map: Int32Array) => [...map]

describe('alignWords', () => {
  test('matches the same words one to one', () => {
    const words = split('the eye jumps from word to word')
    expect(pairs(alignWords(words, words))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  test('skips page words the article does not have', () => {
    const words = split('Fixations last about a quarter of a second')
    const tokens = split('Menu Search Fixations last about a quarter [edit] of a second Share')
    expect(pairs(alignWords(words, tokens))).toEqual([2, 3, 4, 5, 6, 8, 9, 10])
  })

  test('leaves article words the page does not show unmapped', () => {
    const words = split('Readers skip short words like the and of while long words hold the eye')
    const tokens = split('Readers skip short words while long words hold the eye')
    expect(pairs(alignWords(words, tokens))).toEqual([0, 1, 2, 3, -1, -1, -1, -1, 4, 5, 6, 7, 8, 9])
  })

  test('leaves a glued word unmapped and keeps its neighbours', () => {
    const words = split('the essay ended in 2023If you read it twice it changes')
    const tokens = split('the essay ended in 2023 If you read it twice it changes')
    expect(pairs(alignWords(words, tokens))).toEqual([0, 1, 2, 3, -1, 6, 7, 8, 9, 10, 11])
  })

  test('keeps repeated phrases in order', () => {
    const words = split('to be or not to be or not to be that is the question')
    const tokens = split('Hamlet to be or not to be or not to be that is the question')
    expect(pairs(alignWords(words, tokens))).toEqual(words.map((_, i) => i + 1))
  })

  test('finds a title that sits far below the start of the page', () => {
    const nav = Array.from({ length: 40 }, (_, i) => `link${i}`)
    const body = split('Your eyes do not glide across a page, they jump.')
    const words = [...split('How Eyes Read'), ...body]
    const tokens = [...nav, ...split('How Eyes Read'), ...body, ...split('Related: How Eyes Read')]
    expect(pairs(alignWords(words, tokens))).toEqual(words.map((_, i) => 40 + i))
  })

  test('never maps two words to one token or out of order', () => {
    const words = split('a b a b a b c a b c')
    const tokens = split('b a b c a c a b a b c')
    const map = pairs(alignWords(words, tokens)).filter((j) => j >= 0)
    expect(map).toEqual([...map].sort((x, y) => x - y))
    expect(new Set(map).size).toBe(map.length)
  })
})

function page(html: string) {
  document.body.innerHTML = html
  return document.body
}

const ARTICLE_TEXT = '# How Eyes Read\n\nYour eyes do not glide across a page, they jump.'
const ARTICLE = `<nav>Home About</nav><article><h1>How Eyes Read</h1>
  <p>Your eyes <em>do not</em> glide across a page, they jump.</p></article>`

describe('WordMap', () => {
  afterEach(() => {
    for (const name of ['getClientRects', 'getBoundingClientRect'] as const) delete (RangeProto as Partial<Range>)[name]
  })

  test('finds every word on the page', () => {
    const doc = parse(ARTICLE_TEXT)
    const map = WordMap.build(doc, page(ARTICLE))
    expect(map.coverage).toBe(1)
    doc.words.forEach((word, i) => expect(map.rangeOf(i, i + 1)?.toString()).toBe(word.text))
    expect(map.rangeOf(3, 7)?.toString()).toBe('Your eyes do not')
  })

  test('puts the title on the page heading, not a breadcrumb or an intro that repeats it', () => {
    const doc = parse('# CSS Custom Highlight API\n\n## Concepts and usage\n\nStyling text ranges on a webpage can be very useful.')
    const map = WordMap.build(
      doc,
      page(`<div class="breadcrumbs"><ol><li>Web</li><li>CSS Custom Highlight API</li></ol></div>
        <header><h1>CSS Custom Highlight API</h1><p>Baseline 2025</p></header>
        <p>The CSS Custom Highlight API provides a mechanism.</p>
        <article><h2>Concepts and usage</h2><p>Styling text ranges on a webpage can be very useful.</p></article>`),
    )
    const title = map.rangeOf(0, 4)
    expect([title?.toString(), title?.startContainer.parentElement?.localName]).toEqual(['CSS Custom Highlight API', 'h1'])
    expect(map.rangeOf(4, 5)?.startContainer.parentElement?.localName).toBe('h2')
  })

  test('leaves out text the reader cannot see', () => {
    const doc = parse('Before the photo Advertisement. Continue reading after the photo the story goes on.')
    const map = WordMap.build(
      doc,
      page(`<p>Before the photo <span style="display: none">Advertisement. Continue reading</span> after the photo the story goes on.</p>`),
    )
    expect(doc.words.map((_, i) => map.blockOf(i) >= 0)).toEqual([true, true, true, false, false, false, true, true, true, true, true, true, true])
    expect(map.coverage).toBeCloseTo(10 / 13, 6)
    expect(map.coverageFrom(6)).toBe(1)
    expect(map.rangeOf(2, 7)?.toString()).toBe('photo Advertisement. Continue reading after')
  })

  test('leaves out screen-reader-only text clipped to a pixel', () => {
    const doc = parse('Story text here. Skip to content. More story text.')
    const map = WordMap.build(
      doc,
      page(`<p>Story text here. <span style="overflow: hidden; width: 1px; height: 1px">Skip to content.</span> More story text.</p>`),
    )
    expect([3, 4, 5].map((i) => map.blockOf(i))).toEqual([-1, -1, -1])
    expect(map.blockOf(6)).toBe(0)
  })

  test('notices when the page replaces the text', () => {
    const doc = parse(ARTICLE_TEXT)
    const root = page(ARTICLE)
    const map = WordMap.build(doc, root)
    expect(map.isLive(0, doc.words.length)).toBe(true)
    root.querySelector('em')!.textContent = 'do not'
    expect(map.isLive(0, 3)).toBe(true)
    expect(map.isLive(3, 7)).toBe(false)
    expect(map.rangeOf(5, 6)).toBeNull()
    root.querySelector('h1')!.firstChild!.textContent = 'How Eyes Work'
    expect(map.isLive(0, 3)).toBe(false)
  })

  test('finds the word at a caret position', () => {
    const doc = parse(ARTICLE_TEXT)
    const root = page(ARTICLE)
    const map = WordMap.build(doc, root)
    const em = root.querySelector('em')!.firstChild!
    expect(map.wordAt(em, 0)).toBe(5)
    expect(map.wordAt(em, 4)).toBe(6)
    const tail = root.querySelector('p')!.lastChild!
    expect(map.wordAt(tail, ' glide'.length)).toBe(7)
    expect(map.wordAt(root.querySelector('nav')!.firstChild!, 1)).toBe(-1)
  })

  test('owns text in a block it mapped and nothing else', () => {
    const doc = parse(ARTICLE_TEXT)
    const root = page(`${ARTICLE}<aside><p>Related posts you might like</p></aside>`)
    const map = WordMap.build(doc, root)
    const p = root.querySelector('article p')!
    expect(map.owns(p.firstChild!)).toBe(true)
    p.firstChild!.textContent = 'Your eyes '
    expect(map.owns(p.firstChild!)).toBe(true)
    expect(map.owns(root.querySelector('aside p')!.firstChild!)).toBe(false)
  })

  test('tells words on the same line from words on the next', () => {
    const doc = parse(ARTICLE_TEXT)
    const map = WordMap.build(doc, page(ARTICLE))
    RangeProto.getClientRects = function (this: Range) {
      const top = this.startContainer.parentElement?.localName === 'em' ? 40 : 10
      return [{ top, height: 20, bottom: top + 20, left: 0, right: 10, width: 10 }] as unknown as DOMRectList
    }
    expect(map.sameLine(3, 4)).toBe(true)
    expect(map.sameLine(4, 5)).toBe(false)
    expect(map.hasRects(3)).toBe(true)
  })

  test('says the line is covered when another element sits on it or it is off screen', () => {
    const doc = parse(ARTICLE_TEXT)
    const root = page(`${ARTICLE}<div id="wall"></div><pacer-bar></pacer-bar>`)
    const map = WordMap.build(doc, root)
    let top = 300
    RangeProto.getClientRects = () => [{ top, height: 20, left: 100, width: 50 }] as unknown as DOMRectList
    let stack: Element[] = []
    document.elementsFromPoint = () => stack
    const range = map.rangeOf(3, 4)!
    const p = root.querySelector('article p')!
    stack = [root.querySelector('pacer-bar')!, p, root]
    expect(map.covered(range)).toBe(false)
    stack = [root.querySelector('#wall')!, p, root]
    expect(map.covered(range)).toBe(true)
    top = window.innerHeight + 40
    stack = [p]
    expect(map.covered(range)).toBe(true)
  })

  test('says the line is covered when only Pacer or nothing at all sits at its middle', () => {
    const doc = parse(ARTICLE_TEXT)
    const root = page(`${ARTICLE}<pacer-bar></pacer-bar>`)
    const map = WordMap.build(doc, root)
    RangeProto.getClientRects = () => [{ top: 300, height: 20, left: 100, width: 50 }] as unknown as DOMRectList
    let stack: Element[] = []
    document.elementsFromPoint = () => stack
    const range = map.rangeOf(3, 4)!
    expect(map.covered(range)).toBe(true)
    stack = [root.querySelector('pacer-bar')!]
    expect(map.covered(range)).toBe(true)
  })

  test('rebuilds at most once a second', () => {
    const now = spyOn(performance, 'now').mockReturnValue(5000)
    const map = WordMap.build(parse(ARTICLE_TEXT), page(ARTICLE))
    now.mockReturnValue(5400)
    expect(map.canRebuild()).toBe(false)
    expect(map.nextRebuildIn()).toBe(600)
    now.mockReturnValue(6000)
    expect(map.canRebuild()).toBe(true)
    const next = map.rebuild()
    expect(next.coverage).toBe(1)
    expect(next.canRebuild()).toBe(false)
    now.mockRestore()
  })
})

describe('dropping clipped blocks', () => {
  afterEach(() => {
    delete (RangeProto as Partial<Range>).getBoundingClientRect
  })

  const text = 'First paragraph shows. Second paragraph is cut in half. Third paragraph is hidden.'
  const paragraphs = `<p data-top="0">First paragraph shows.</p><p data-top="200">Second paragraph is cut in half.</p><p data-top="400">Third paragraph is hidden.</p>`
  const placeRanges = () => {
    RangeProto.getBoundingClientRect = function (this: Range) {
      const top = Number((this.startContainer.parentElement as HTMLElement).dataset.top)
      return { top, bottom: top + 80, left: 0, right: 600, width: 600, height: 80 } as DOMRect
    }
  }
  const shownWords = (root: Element) => {
    const doc = parse(text)
    const map = WordMap.build(doc, root)
    return doc.words.map((w, i) => (map.blockOf(i) >= 0 ? w.text : '_')).join(' ')
  }

  test('drops a paragraph a "read more" box cuts off and keeps one it only trims', () => {
    // happy-dom does not expand the overflow shorthand, so the test sets the longhands Chrome would report.
    const root = page(`<div class="truncated" style="overflow-x: hidden; overflow-y: hidden">${paragraphs}</div>`)
    root.querySelector('.truncated')!.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 600 }) as DOMRect
    placeRanges()
    expect(shownWords(root)).toBe('First paragraph shows. Second paragraph is cut in half. _ _ _ _')
  })

  test('keeps text below the fold of an inner scroll box that an app shell clips', () => {
    const root = page(`<div id="app" style="overflow-x: hidden; overflow-y: hidden"><div id="scroller" style="overflow-y: auto">${paragraphs}</div></div>`)
    root.querySelector('#app')!.getBoundingClientRect = () => ({ top: 0, bottom: 240, left: 0, right: 600 }) as DOMRect
    const scroller = root.querySelector('#scroller')!
    Object.defineProperty(scroller, 'scrollHeight', { value: 480 })
    Object.defineProperty(scroller, 'clientHeight', { value: 240 })
    placeRanges()
    expect(shownWords(root)).toBe(text)
  })
})
