import { findText, sentenceStart, type Doc } from '../../src/lib/text'
import { HEADER_STRIP } from '../article'
import { PAST_END } from '../store'
import { isScroller, type WordMap } from './map'

const LOOK_AHEAD = 5
const SELECTION_NODES = 200
const MIN_SHOWN = 0.5

export interface ViewportStart {
  /** The paragraph in view when the page is scrolled, 0 when it is not, or PAST_END. */
  from: number
  at: number
}

/** The scroll box holding the node, or null when the window scrolls it. */
export function scrollerOf(node: Node): Element | null {
  const body = node.ownerDocument?.body
  for (let el = node.parentElement; el && el !== body; el = el.parentElement) if (isScroller(el)) return el
  return null
}

interface Visible {
  para: number
  word: number
  /** Top of the paragraph, in window coordinates. */
  top: number
}

/** The first paragraph that ends below the header strip. It may lie below the window, so a code block or image filling the view resolves to the paragraph after it. */
function firstVisible(doc: Doc, map: WordMap, strip: number): Visible | null {
  for (const [para, { start, end }] of doc.paragraphs.entries()) {
    const rect = map.rangeOf(start, end)?.getBoundingClientRect()
    if (!rect || rect.height === 0 || rect.bottom <= strip) continue
    for (let i = start; i < end; i++) {
      const word = map.blockOf(i) >= 0 ? map.rangeOf(i, i + 1)?.getClientRects()[0] : undefined
      if (word && word.bottom > strip) return { para, word: i, top: rect.top }
    }
  }
  return null
}

/** Where reading starts for the page as it is scrolled now, or null when no paragraph near there is mostly shown. */
export function viewportStart(doc: Doc, map: WordMap, win: Window): ViewportStart | null {
  const { paragraphs, words } = doc
  const firstShown = (start: number, end: number) => {
    for (let i = start; i < end; i++) if (map.blockOf(i) >= 0) return i
    return -1
  }

  const first = firstShown(0, words.length)
  const node = first >= 0 ? map.rangeOf(first, first + 1)?.startContainer : undefined
  const scroller = node ? scrollerOf(node) : null
  const scrolled = (scroller ? scroller.scrollTop : win.scrollY) > 0
  const strip = win.innerHeight * HEADER_STRIP
  const visible = scrolled ? firstVisible(doc, map, strip) : null
  const from = scrolled ? (visible?.para ?? PAST_END) : 0

  const base = Math.max(0, from)
  for (let p = base; p < Math.min(paragraphs.length, base + LOOK_AHEAD + 1); p++) {
    const { start, end } = paragraphs[p]
    let shown = 0
    for (let i = start; i < end; i++) if (map.blockOf(i) >= 0) shown++
    if (shown / Math.max(1, end - start) < MIN_SHOWN) continue
    // A long paragraph that began far above the window would start reading off screen, so start at the sentence in view.
    if (visible && p === visible.para && visible.top < strip - win.innerHeight) {
      return { from, at: firstShown(sentenceStart(doc, visible.word), visible.word + 1) }
    }
    return { from, at: firstShown(start, end) }
  }
  return null
}

/** The first selected word on the page: where the live selection starts, else where its text appears in the article, else -1. */
export function selectedWord(page: Document, map: WordMap, doc: Doc, text: string): number {
  const selection = page.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  if (range && !range.collapsed) {
    // A selection can start in a heading Pacer skips or in the space between blocks, so walk on to the first word it maps.
    const { startContainer, startOffset } = range
    const from = startContainer.nodeType === Node.TEXT_NODE ? startContainer : (startContainer.childNodes[startOffset] ?? startContainer)
    const walker = page.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
    walker.currentNode = from
    let node: Node | null = from.nodeType === Node.TEXT_NODE ? from : walker.nextNode()
    for (let seen = 0; node && seen < SELECTION_NODES && range.intersectsNode(node); seen++) {
      const i = map.wordAt(node, node === startContainer ? startOffset : 0)
      if (i >= 0) return i
      node = walker.nextNode()
    }
  }
  return findText(doc, text)
}
