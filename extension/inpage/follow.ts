import { scrollerOf } from './start'

/** Fraction of the viewport height where the active line rests. */
const BAND = 0.36
const GLIDE_MS = 280
const JUMP_VIEWPORTS = 1.5
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End'])
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const OWN_HOST = /^pacer-/

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

const fromPacer = (e: Event) => e.composedPath().some((node) => OWN_HOST.test((node as Element).localName ?? ''))

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
    const options = { capture: true, passive: true }
    win.addEventListener('wheel', onWheel, options)
    win.addEventListener('touchmove', user, options)
    win.addEventListener('pointerdown', onPointer, options)
    win.addEventListener('keydown', onKey, options)
    this.detach = () => {
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
