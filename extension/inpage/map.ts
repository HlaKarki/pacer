import { sourcedBlocksFromHtml, type HtmlOptions, type SourcedBlock } from '../../src/lib/import/html'
import type { Doc } from '../../src/lib/text'
import { toneOf, type Tone } from './marks'

/** Below this share of mapped words, the reader tab reads the page better than the page itself. */
export const MIN_COVERAGE = 0.85

const GRAM = 3
const LOOK = 24
const REBUILD_MS = 1000
const OWN_HOST = /^pacer-/

/** Each word's token index on the page, or -1. Word triples found once in both lists anchor the match, and the words between anchors match forward, then backward. */
export function alignWords(words: string[], tokens: string[]): Int32Array {
  const n = words.length
  const map = new Int32Array(n).fill(-1)
  const key = (list: string[], i: number) => `${list[i]}\u0001${list[i + 1]}\u0001${list[i + 2]}`
  const counts = (list: string[]) => {
    const out = new Map<string, number>()
    for (let i = 0; i + GRAM <= list.length; i++) out.set(key(list, i), (out.get(key(list, i)) ?? 0) + 1)
    return out
  }
  const wordCounts = counts(words)
  const tokenCounts = counts(tokens)
  const tokenAt = new Map<string, number>()
  for (let j = 0; j + GRAM <= tokens.length; j++) {
    if (tokenCounts.get(key(tokens, j)) === 1) tokenAt.set(key(tokens, j), j)
  }
  const pairs: [number, number][] = []
  for (let i = 0; i + GRAM <= n; i++) {
    const j = wordCounts.get(key(words, i)) === 1 ? tokenAt.get(key(words, i)) : undefined
    if (j !== undefined) pairs.push([i, j])
  }

  let last = -1
  for (const [i, j] of longestChain(pairs)) {
    for (let d = 0; d < GRAM; d++) {
      if (map[i + d] !== -1) continue
      if (j + d <= last) continue
      map[i + d] = j + d
      last = j + d
    }
  }

  let lo = 0
  let next = 0
  for (let i = 0; i < n; i++) {
    if (map[i] !== -1) {
      lo = map[i] + 1
      continue
    }
    while (next < n && (next <= i || map[next] === -1)) next++
    const hi = Math.min(next < n ? map[next] : tokens.length, lo + LOOK)
    for (let j = lo; j < hi; j++) {
      if (tokens[j] === words[i]) {
        map[i] = j
        lo = j + 1
        break
      }
    }
  }

  let hi = tokens.length
  let prev = n - 1
  for (let i = n - 1; i >= 0; i--) {
    if (map[i] !== -1) {
      hi = map[i]
      continue
    }
    while (prev >= 0 && (prev >= i || map[prev] === -1)) prev--
    const floor = Math.max(prev >= 0 ? map[prev] + 1 : 0, hi - LOOK)
    for (let j = hi - 1; j >= floor; j--) {
      if (tokens[j] === words[i]) {
        map[i] = j
        hi = j
        break
      }
    }
  }
  return map
}

/** The longest run of pairs whose token indices increase, for pairs already in word order. */
function longestChain(pairs: [number, number][]): [number, number][] {
  const tails: number[] = []
  const back = new Int32Array(pairs.length).fill(-1)
  pairs.forEach(([, j], k) => {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pairs[tails[mid]][1] < j) lo = mid + 1
      else hi = mid
    }
    back[k] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = k
  })
  const chain: [number, number][] = []
  for (let k = tails.at(-1) ?? -1; k !== -1; k = back[k]) chain.push(pairs[k])
  return chain.reverse()
}

const styleOf = (el: Element) => el.ownerDocument.defaultView?.getComputedStyle(el) ?? null

function hiddenOnPage(el: Element): boolean {
  const style = styleOf(el)
  if (!style || style.display === 'contents') return false
  if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return true
  const clips = [style.overflow, style.clip, style.clipPath].some((value) => value && !/^(visible|auto|none)$/.test(value))
  if (!clips) return false
  // Screen-reader-only text sits in a clipped box of a pixel or so, so it is in the page but never on screen.
  const rect = el.getBoundingClientRect()
  return rect.width <= 2 || rect.height <= 2
}

/** Page words the Doc lacks cost nothing, so link lists stay in, and only text the reader cannot see is left out. */
export function liveHtml(): HtmlOptions {
  const hidden = new Map<Element, boolean>()
  return {
    skipLinkLists: false,
    skip: (el) => {
      let hide = hidden.get(el)
      if (hide === undefined) {
        hide = hiddenOnPage(el)
        hidden.set(el, hide)
      }
      return hide
    },
  }
}

export const isScroller = (el: Element) => {
  const style = styleOf(el)
  return (style?.overflowY === 'auto' || style?.overflowY === 'scroll') && el.scrollHeight > el.clientHeight
}

/** Drops blocks that a "read more" box or similar clips away completely. A block clipped only in part stays. */
export function dropClipped(blocks: SourcedBlock[]): SourcedBlock[] {
  const clips = new Map<Element, boolean>()
  const clipping = (el: Element) => {
    let hit = clips.get(el)
    if (hit === undefined) {
      const style = styleOf(el)
      hit = [style?.overflowX, style?.overflowY].some((o) => o === 'hidden' || o === 'clip')
      clips.set(el, hit)
    }
    return hit
  }
  return blocks.filter(({ pieces }) => {
    const first = pieces[0]?.node
    const last = pieces.at(-1)?.node
    if (!first || !last) return true
    const range = first.ownerDocument.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.length)
    const box = range.getBoundingClientRect()
    const body = first.ownerDocument.body
    for (let el = first.parentElement; el && el !== body; el = el.parentElement) {
      // Text past the edge of a scroll box can still be scrolled to, so clipping above that box does not hide it.
      if (isScroller(el)) break
      if (!clipping(el)) continue
      const edge = el.getBoundingClientRect()
      if (box.top >= edge.bottom - 1 || box.bottom <= edge.top + 1 || box.left >= edge.right - 1 || box.right <= edge.left + 1) {
        return false
      }
    }
    return true
  })
}

interface Tokens {
  texts: string[]
  block: number[]
  start: number[]
  end: number[]
}

export function liveTokens(blocks: SourcedBlock[]): Tokens {
  const out: Tokens = { texts: [], block: [], start: [], end: [] }
  blocks.forEach(({ raw }, k) => {
    for (const match of raw.matchAll(/\S+/g)) {
      out.texts.push(match[0])
      out.block.push(k)
      out.start.push(match.index)
      out.end.push(match.index + match[0].length)
    }
  })
  return out
}

/** Breadcrumbs and menus often repeat the title above the article, so a Doc that opens with a heading takes the nearest page heading with exactly those words. */
function placeOpeningHeading(doc: Doc, map: Int32Array, tokens: Tokens, blocks: SourcedBlock[]): void {
  const opening = doc.paragraphs[0]
  if (!opening?.heading) return
  const { start, end } = opening
  const n = end - start
  let next = end
  while (next < map.length && map[next] === -1) next++
  const limit = next < map.length ? map[next] : tokens.texts.length
  for (let j = limit - n; j >= 0; j--) {
    const k = tokens.block[j]
    if (!blocks[k].level || tokens.block[j - 1] === k || tokens.block[j + n] === k) continue
    let d = 0
    while (d < n && tokens.block[j + d] === k && tokens.texts[j + d] === doc.words[start + d].text) d++
    if (d < n) continue
    for (d = 0; d < n; d++) map[start + d] = j + d
    return
  }
}

function pieceAt(pieces: SourcedBlock['pieces'], at: number): number {
  let lo = 0
  let hi = pieces.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (pieces[mid].at <= at) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Keeps a text node and offset pair for each word, because thousands of live Ranges slow every DOM change on the page. */
interface Layout {
  doc: Doc
  root: Element
  nodes: Text[]
  /** First and last node of each block, in pairs. */
  blockNodes: Int32Array
  /** The block each word was found in, or -1. */
  wordBlock: Int32Array
  startNode: Int32Array
  startOffset: Int32Array
  endNode: Int32Array
  endOffset: Int32Array
}

export class WordMap {
  readonly coverage: number
  private readonly builtAt = performance.now()
  private readonly doc: Doc
  private readonly root: Element
  private readonly nodes: Text[]
  private readonly blockNodes: Int32Array
  private readonly wordBlock: Int32Array
  private readonly startNode: Int32Array
  private readonly startOffset: Int32Array
  private readonly endNode: Int32Array
  private readonly endOffset: Int32Array
  private firstWordOfNode: Int32Array | null = null
  private nodeIndex: Map<Node, number> | null = null
  private blockEls: (Element | null)[] = []
  private blockTones: Tone[] = []
  private mappedEls: Set<Element> | null = null

  private constructor(layout: Layout) {
    this.doc = layout.doc
    this.root = layout.root
    this.nodes = layout.nodes
    this.blockNodes = layout.blockNodes
    this.wordBlock = layout.wordBlock
    this.startNode = layout.startNode
    this.startOffset = layout.startOffset
    this.endNode = layout.endNode
    this.endOffset = layout.endOffset
    let mapped = 0
    for (const block of this.wordBlock) if (block >= 0) mapped++
    this.coverage = this.wordBlock.length ? mapped / this.wordBlock.length : 0
  }

  static build(doc: Doc, root: Element): WordMap {
    const blocks = dropClipped(sourcedBlocksFromHtml(root, liveHtml()))
    const tokens = liveTokens(blocks)
    const map = alignWords(
      doc.words.map((w) => w.text),
      tokens.texts,
    )
    placeOpeningHeading(doc, map, tokens, blocks)
    const nodes: Text[] = []
    const base = new Int32Array(blocks.length)
    const blockNodes = new Int32Array(blocks.length * 2)
    blocks.forEach(({ pieces }, k) => {
      base[k] = nodes.length
      blockNodes[k * 2] = nodes.length
      for (const { node } of pieces) nodes.push(node)
      blockNodes[k * 2 + 1] = nodes.length - 1
    })
    const n = doc.words.length
    const layout: Layout = {
      doc,
      root,
      nodes,
      blockNodes,
      wordBlock: new Int32Array(n).fill(-1),
      startNode: new Int32Array(n),
      startOffset: new Int32Array(n),
      endNode: new Int32Array(n),
      endOffset: new Int32Array(n),
    }
    for (let i = 0; i < n; i++) {
      const t = map[i]
      if (t < 0) continue
      const k = tokens.block[t]
      const { pieces } = blocks[k]
      const first = pieceAt(pieces, tokens.start[t])
      const last = pieceAt(pieces, tokens.end[t] - 1)
      layout.wordBlock[i] = k
      layout.startNode[i] = base[k] + first
      layout.startOffset[i] = tokens.start[t] - pieces[first].at
      layout.endNode[i] = base[k] + last
      layout.endOffset[i] = tokens.end[t] - pieces[last].at
    }
    return new WordMap(layout)
  }

  /** Only unread words count, so rows a virtual list unmounted behind the reader do not lower it. */
  coverageFrom(index: number): number {
    const n = this.wordBlock.length
    if (index >= n) return 1
    let mapped = 0
    for (let i = Math.max(0, index); i < n; i++) if (this.wordBlock[i] >= 0) mapped++
    return mapped / (n - Math.max(0, index))
  }

  /** The block a word was found in, or -1 when the page does not show it. */
  blockOf(i: number): number {
    return this.wordBlock[i] ?? -1
  }

  private live(i: number): boolean {
    const a = this.nodes[this.startNode[i]]
    const b = this.nodes[this.endNode[i]]
    const o0 = this.startOffset[i]
    const o1 = this.endOffset[i]
    if (!a.isConnected || !b.isConnected || o0 > a.length || o1 > b.length) return false
    const text = this.doc.words[i].text
    if (a === b) return a.data.slice(o0, o1) === text
    return text.startsWith(a.data.slice(o0)) && text.endsWith(b.data.slice(0, o1))
  }

  /** False once the page has replaced or edited the text behind one of these words. */
  isLive(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (this.blockOf(i) >= 0 && !this.live(i)) return false
    return true
  }

  /** From the first to the last shown word in [start, end), or null when none is shown or the page changed. */
  rangeOf(start: number, end: number): Range | null {
    let a = Math.max(0, start)
    let b = Math.min(end, this.wordBlock.length) - 1
    while (a <= b && this.wordBlock[a] < 0) a++
    while (b >= a && this.wordBlock[b] < 0) b--
    if (a > b || !this.live(a) || !this.live(b)) return null
    const range = this.root.ownerDocument.createRange()
    range.setStart(this.nodes[this.startNode[a]], this.startOffset[a])
    range.setEnd(this.nodes[this.endNode[b]], this.endOffset[b])
    return range
  }

  private firstRect(i: number): DOMRect | null {
    return this.rangeOf(i, i + 1)?.getClientRects()[0] ?? null
  }

  hasRects(i: number): boolean {
    return this.blockOf(i) >= 0 && this.firstRect(i) !== null
  }

  sameLine(i: number, j: number): boolean {
    const a = this.firstRect(i)
    const b = this.firstRect(j)
    return a !== null && b !== null && Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2
  }

  /** The shown word at a caret position, or -1. */
  wordAt(node: Node, offset: number): number {
    if (!this.nodeIndex || !this.firstWordOfNode) {
      this.nodeIndex = new Map(this.nodes.map((text, k) => [text, k]))
      this.firstWordOfNode = new Int32Array(this.nodes.length).fill(-1)
      for (let i = 0; i < this.wordBlock.length; i++) {
        if (this.wordBlock[i] < 0) continue
        for (let k = this.startNode[i]; k <= this.endNode[i]; k++) {
          if (this.firstWordOfNode[k] === -1) this.firstWordOfNode[k] = i
        }
      }
    }
    const k = this.nodeIndex.get(node)
    if (k === undefined) return -1
    for (let i = this.firstWordOfNode[k]; i >= 0 && i < this.wordBlock.length; i++) {
      if (this.wordBlock[i] < 0) continue
      if (this.startNode[i] > k) break
      const afterStart = this.startNode[i] < k || this.startOffset[i] <= offset
      const beforeEnd = this.endNode[i] > k || offset <= this.endOffset[i]
      if (afterStart && beforeEnd) return i
    }
    return -1
  }

  private blockElement(block: number): Element | null {
    if (this.blockEls[block] === undefined) {
      const first = this.nodes[this.blockNodes[block * 2]]
      const last = this.nodes[this.blockNodes[block * 2 + 1]]
      let el = first?.parentElement ?? null
      while (el && last && !el.contains(last)) el = el.parentElement
      this.blockEls[block] = el
    }
    return this.blockEls[block]
  }

  /** The tone of the block a word was found in, or 'light' when the page does not show it. */
  toneOf(i: number): Tone {
    const block = this.blockOf(i)
    if (block < 0) return 'light'
    if (this.blockTones[block] === undefined) {
      const el = this.blockElement(block)
      this.blockTones[block] = el ? toneOf(el) : 'light'
    }
    return this.blockTones[block]
  }

  /** True when the node sits in a block that had shown words, so a click there that missed is worth a fresh map. */
  owns(node: Node): boolean {
    if (!this.mappedEls) {
      this.mappedEls = new Set()
      for (let i = 0; i < this.wordBlock.length; i++) {
        const el = this.wordBlock[i] >= 0 ? this.blockElement(this.wordBlock[i]) : null
        if (el) this.mappedEls.add(el)
      }
    }
    for (let el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement; el; el = el.parentElement) {
      if (this.mappedEls.has(el)) return true
    }
    return false
  }

  /** True when something sits over the line's middle or the middle is off screen, ignoring Pacer's own bar and toast. */
  covered(range: Range): boolean {
    const rect = range.getClientRects()[0]
    const doc = this.root.ownerDocument
    const win = doc.defaultView
    if (!rect || !win) return false
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    if (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) return true
    const top = doc.elementsFromPoint(x, y).find((el) => !OWN_HOST.test(el.localName))
    return !top?.contains(range.startContainer)
  }

  canRebuild(): boolean {
    return this.nextRebuildIn() === 0
  }

  nextRebuildIn(): number {
    return Math.max(0, this.builtAt + REBUILD_MS - performance.now())
  }

  rebuild(): WordMap {
    return WordMap.build(this.doc, this.root)
  }
}
