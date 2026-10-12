import { EDITABLE, fromPacer } from './dom'
import { scrollerOf } from './start'

/** Fraction of the viewport height where the active line rests. */
const BAND = 0.36
const GLIDE_MS = 280
const JUMP_VIEWPORTS = 1.5
const SIDE_MARGIN = 16
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End'])

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

interface Viewport {
  el: Element
  /** Top of the visible area, in window coordinates. */
  top: number
  height: number
}

function viewportOf(node: Node): Viewport {
  const doc = node.ownerDocument!
  const scroller = scrollerOf(node)
  if (scroller) return { el: scroller, top: scroller.getBoundingClientRect().top + scroller.clientTop, height: scroller.clientHeight }
  return { el: doc.scrollingElement ?? doc.documentElement, top: 0, height: doc.defaultView?.innerHeight ?? 0 }
}

/** True when part of the range's first line shows in its scroll box and in the window. */
export function inView(range: Range): boolean {
  const rect = range.getClientRects()[0]
  if (!rect) return false
  const view = viewportOf(range.startContainer)
  const bottom = Math.min(view.top + view.height, range.startContainer.ownerDocument?.defaultView?.innerHeight ?? 0)
  return rect.bottom > Math.max(0, view.top) && rect.top < bottom
}

/** The nearest box that scrolls the node sideways, like a code block with long lines. */
function sideScrollerOf(node: Node): Element | null {
  const body = node.ownerDocument?.body
  for (let el = node.parentElement; el && el !== body; el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth) continue
    const x = el.ownerDocument.defaultView?.getComputedStyle(el).overflowX
    if (x === 'auto' || x === 'scroll') return el
  }
  return null
}


function onScrollbar(e: PointerEvent): boolean {
  const el = e.target as Element | null
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false
  if (e.clientX >= el.ownerDocument.documentElement.clientWidth) return true
  const box = el.getBoundingClientRect()
  return el.scrollHeight > el.clientHeight && e.clientX >= box.left + el.clientLeft + el.clientWidth
}

/** Keeps the active line in the band and tells Pacer's own scrolling from the reader's. */
export class Follow {
  private frame = 0
  private expected = 0
  private el: Element | null = null
  private line: Range | null = null
  private readonly win: Window
  private readonly detach: () => void

  private constructor(win: Window, onUserScroll: () => void) {
    this.win = win
    const user = (e: Event) => {
      if (fromPacer(e)) return
      this.cancel()
      onUserScroll()
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) user(e)
    }
    const onPointer = (e: PointerEvent) => {
      if (onScrollbar(e)) user(e)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as Element | null)?.closest?.(EDITABLE)) return
      user(e)
    }
    // Contents links, find in page and page scripts scroll without a wheel or a key, so watch the scroll itself.
    const onScroll = (e: Event) => {
      const el = e.target === win.document ? win.document.scrollingElement : e.target
      if (!this.el || el !== this.el || Math.abs(this.el.scrollTop - this.expected) <= 1) return
      // Scroll anchoring nudges the page as images load above, so only a scroll that takes the line off screen counts.
      if (this.line && inView(this.line)) this.expected = this.el.scrollTop
      else user(e)
    }
    const options = { capture: true, passive: true }
    win.addEventListener('scroll', onScroll, options)
    win.addEventListener('wheel', onWheel, options)
    win.addEventListener('touchmove', user, options)
    win.addEventListener('pointerdown', onPointer, options)
    win.addEventListener('keydown', onKey, options)
    this.detach = () => {
      win.removeEventListener('scroll', onScroll, options)
      win.removeEventListener('wheel', onWheel, options)
      win.removeEventListener('touchmove', user, options)
      win.removeEventListener('pointerdown', onPointer, options)
      win.removeEventListener('keydown', onKey, options)
    }
  }

  static attach(win: Window, onUserScroll: () => void): Follow {
    return new Follow(win, onUserScroll)
  }

  /** Scrolls the range's first line to the band, then calls onSettled once the page has reacted to the scroll. */
  toLine(range: Range, onSettled: () => void): void {
    this.cancel()
    const rect = range.getClientRects()[0]
    if (!rect) return
    const { el, top, height } = viewportOf(range.startContainer)
    this.el = el
    this.line = range
    const from = el.scrollTop
    const target = Math.max(0, Math.min(from + rect.top - top - height * BAND, el.scrollHeight - el.clientHeight))
    const distance = target - from
    const reduced = this.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    this.expected = from
    if (Math.abs(distance) < 1 || reduced || Math.abs(distance) > height * JUMP_VIEWPORTS) {
      this.scroll(el, target)
      this.frame = this.win.requestAnimationFrame(() => this.settle(el, onSettled))
      return
    }
    const t0 = performance.now()
    const step = (now: number) => {
      if (this.movedByOthers(el)) return
      const t = Math.min(1, Math.max(0, (now - t0) / GLIDE_MS))
      this.scroll(el, from + distance * ease(t))
      this.frame = this.win.requestAnimationFrame(t < 1 ? step : () => this.settle(el, onSettled))
    }
    this.frame = this.win.requestAnimationFrame(step)
  }

  /** Watches the range's line without moving the page, so a scroll that takes it off screen counts as the reader's. */
  watch(range: Range): void {
    this.cancel()
    this.el = viewportOf(range.startContainer).el
    this.line = range
    this.expected = this.el.scrollTop
  }

  /** Scrolls a sideways scroll box so the chunk shows inside it, back to the start for a new line. */
  alongLine(range: Range): void {
    const el = sideScrollerOf(range.startContainer)
    if (!el) return
    const rect = range.getBoundingClientRect()
    const left = el.getBoundingClientRect().left + el.clientLeft
    const right = left + el.clientWidth
    if (rect.left >= left && rect.right <= right) return
    const shift = rect.left < left || rect.width > el.clientWidth ? rect.left - left - SIDE_MARGIN : rect.right - right + SIDE_MARGIN
    el.scrollTo({ left: Math.max(0, el.scrollLeft + shift), behavior: 'instant' })
  }

  cancel(): void {
    if (this.frame) this.win.cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  dispose(): void {
    this.cancel()
    this.detach()
  }

  private scroll(el: Element, top: number) {
    // Page CSS can set scroll-behavior: smooth, which would turn every frame into its own animation, so force instant.
    el.scrollTo({ top, behavior: 'instant' })
    this.expected = el.scrollTop
  }

  private movedByOthers(el: Element): boolean {
    const moved = Math.abs(el.scrollTop - this.expected) > 1
    if (moved) this.frame = 0
    return moved
  }

  private settle(el: Element, onSettled: () => void) {
    this.frame = 0
    if (!this.movedByOthers(el)) onSettled()
  }
}
