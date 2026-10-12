import { WPM_STEP } from '../../src/lib/settings'
import { extensionGone } from './lifecycle'
import { EDITABLE, fromPacer } from './dom'
import type { WordMap } from './map'
import type { StopReason } from './session'

const ROLES = 'button link tab slider listbox menu menuitem tree grid combobox radio checkbox switch option spinbutton'
const CONTROLS = ['a[href]', 'button', 'summary', 'video', 'audio', ...ROLES.split(' ').map((role) => `[role=${role}]`)].join(', ')
const FOCUSABLE = '[tabindex]:not([tabindex="-1"])'
const CLICKABLE = `${CONTROLS}, ${EDITABLE}, label`
const OVERLAY = 'dialog[open], [aria-modal="true"], :popover-open, [role=dialog], [role=alertdialog], [role=menu], [role=listbox]'
const MODAL = 'dialog:modal, [aria-modal="true"]'
const MENU = ':popover-open, [role=menu], [role=listbox]'

export interface KeyTarget {
  readonly playing: boolean
  readonly bySentence: boolean
  toggle(): void
  pause(): void
  stop(reason: StopReason): unknown
  prevWord(): void
  nextChunk(): void
  prevSentence(): void
  nextSentence(): void
  nudgeWpm(delta: number): void
  dispose(): void
}

export interface ClickTarget {
  readonly wordMap: WordMap | null
  /** True when the page replaced the text the reading is on. */
  readonly mapStale: boolean
  jump(i: number): void
  rebuildMap(): WordMap | null
}

const isElement = (node: unknown): node is Element => (node as Node | null)?.nodeType === 1

const editable = (el: Element) => el.matches(EDITABLE) || (el as HTMLElement).isContentEditable === true

/** True when focus is on the page or its text, so Space and the arrows belong to Pacer there. A box a click focused counts as text. */
export function isReadingFocus(el: Element | null, clicked = false): boolean {
  if (!el) return true
  const doc = el.ownerDocument
  if (el === doc.body || el === doc.documentElement) return true
  if (editable(el) || el.matches(CONTROLS)) return false
  // GitHub makes the whole README focusable, so only a box the keyboard focused keeps the keys from Pacer.
  return clicked || !el.matches(FOCUSABLE)
}

function shadowOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot
  return typeof chrome === 'undefined' ? null : (chrome.dom?.openOrClosedShadowRoot?.(el as HTMLElement) ?? null)
}

/** The element that really has focus, inside open and closed shadow roots, which events from outside only see as the host. */
export function deepFocus(e: Event, doc: Document): Element | null {
  const first = e.composedPath()[0]
  return focusWithin(isElement(first) ? first : doc.activeElement)
}

function focusWithin(el: Element | null): Element | null {
  while (el) {
    const inner = shadowOf(el)?.activeElement
    if (!inner || inner === el) break
    el = inner
  }
  return el
}

const shown = (doc: Document, selector: string) => [...doc.querySelectorAll(selector)].some((el) => el.checkVisibility())

// Wikipedia keeps some aria-expanded buttons open for good, so only focus inside an open control counts.
const inOpenControl = (el: Element | null) => el?.closest('[aria-expanded="true"]') != null

/** Space, the arrows and Esc while Pacer reads the page. Keys it handles never reach the page, and the rest pass through. */
export function attachKeys(win: Window, session: KeyTarget): () => void {
  const doc = win.document
  const handled = new Set<string>()
  const byClick = (el: Element | null) => (el && !el.matches(':focus-visible') ? el : null)
  let clicked = byClick(doc.activeElement)

  const actionFor = (e: KeyboardEvent): (() => void) | null => {
    const focus = deepFocus(e, doc)
    if (!isReadingFocus(focus, focus === clicked) || focus?.closest(OVERLAY) || shown(doc, MODAL)) return null
    if (e.key === 'Escape') {
      if (shown(doc, OVERLAY) || inOpenControl(focus)) return null
      return () => (session.playing ? session.pause() : void session.stop('esc'))
    }
    switch (e.key) {
      case ' ':
        // A held Space would flicker between play and pause, so only the first press counts.
        return e.repeat ? () => undefined : () => session.toggle()
      case 'ArrowLeft':
        return e.shiftKey || e.altKey || session.bySentence ? () => session.prevSentence() : () => session.prevWord()
      case 'ArrowRight':
        return e.shiftKey || e.altKey ? () => session.nextSentence() : () => session.nextChunk()
      case 'ArrowUp':
        return () => session.nudgeWpm(WPM_STEP)
      case 'ArrowDown':
        return () => session.nudgeWpm(-WPM_STEP)
    }
    return null
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // A copy left by an extension reload lets the key through, so the page or the fresh copy gets it.
    if (extensionGone()) {
      session.dispose()
      return
    }
    if (e.isComposing || e.metaKey || e.ctrlKey || fromPacer(e)) return
    const action = actionFor(e)
    if (!action) return
    e.preventDefault()
    e.stopImmediatePropagation()
    handled.add(e.code)
    action()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (!handled.delete(e.code)) return
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  // Chrome marks any focus as focus-visible once a key goes down, so tell a click's focus from a Tab's as it lands.
  const onFocus = (e: FocusEvent) => {
    clicked = byClick(isElement(e.target) ? e.target : null)
  }

  win.addEventListener('keydown', onKeyDown, true)
  win.addEventListener('keyup', onKeyUp, true)
  win.addEventListener('focusin', onFocus, true)
  return () => {
    win.removeEventListener('keydown', onKeyDown, true)
    win.removeEventListener('keyup', onKeyUp, true)
    win.removeEventListener('focusin', onFocus, true)
  }
}

const onWord = (map: WordMap, i: number, x: number, y: number) =>
  [...(map.rangeOf(i, i + 1)?.getClientRects() ?? [])].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)

/** A click on a word jumps there. Clicks on controls, Pacer's bar, text being selected and clicks that close a page menu are left alone. */
export function attachClicks(doc: Document, session: ClickTarget): () => void {
  let closing = false
  // The page closes its menus on the way to the click, so look at what was open as the pointer went down.
  const onPointerDown = () => {
    const focus = focusWithin(doc.activeElement)
    closing = focus?.closest(OVERLAY) != null || inOpenControl(focus) || shown(doc, MODAL) || shown(doc, MENU)
  }
  const onClick = (e: MouseEvent) => {
    const closed = closing
    closing = false
    if (closed || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || fromPacer(e)) return
    if (isElement(e.target) && e.target.closest(CLICKABLE)) return
    if (doc.getSelection()?.isCollapsed === false) return
    let map = session.wordMap
    const caret = map ? doc.caretPositionFromPoint?.(e.clientX, e.clientY) : null
    if (!map || !caret) return
    const { offsetNode, offset } = caret
    let i = map.wordAt(offsetNode, offset)
    // The page may have re-rendered this text, so one fresh map is worth trying when the click landed in it.
    if (i < 0 && (map.owns(offsetNode) || session.mapStale) && map.canRebuild()) {
      map = session.rebuildMap()
      i = map?.wordAt(offsetNode, offset) ?? -1
    }
    if (map && i >= 0 && onWord(map, i, e.clientX, e.clientY)) session.jump(i)
  }
  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('click', onClick)
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('click', onClick)
  }
}
