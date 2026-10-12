import { WPM_STEP } from '../../src/lib/settings'
import { extensionGone } from './lifecycle'
import type { WordMap } from './map'
import type { StopReason } from './session'

const OWN_HOST = /^pacer-/
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role=textbox]'
const ROLES = 'button link tab slider listbox menu menuitem tree grid combobox radio checkbox switch option spinbutton'
const INTERACTIVE = [
  'a[href]',
  'button',
  'summary',
  'video',
  'audio',
  '[tabindex]:not([tabindex="-1"])',
  ...ROLES.split(' ').map((role) => `[role=${role}]`),
].join(', ')
const CLICKABLE = `${INTERACTIVE}, ${EDITABLE}, label`
const MODAL = 'dialog[open], [aria-modal="true"], :popover-open'

/** What the reading keys drive. */
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
  abandon(): void
}

/** What a click on the page drives. */
export interface ClickTarget {
  readonly wordMap: WordMap | null
  jump(i: number): void
  rebuildMap(): WordMap | null
}

const fromPacer = (e: Event) => e.composedPath().some((node) => OWN_HOST.test((node as Element).localName ?? ''))

const isElement = (node: unknown): node is Element => (node as Node | null)?.nodeType === 1

const editable = (el: Element) => el.matches(EDITABLE) || (el as HTMLElement).isContentEditable === true

/** True when focus is on the page or its text, so Space and the arrows belong to Pacer there. */
export function isReadingFocus(el: Element | null): boolean {
  if (!el) return true
  const doc = el.ownerDocument
  if (el === doc.body || el === doc.documentElement) return true
  return !editable(el) && !el.matches(INTERACTIVE)
}

function shadowOf(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot
  return typeof chrome === 'undefined' ? null : (chrome.dom?.openOrClosedShadowRoot?.(el as HTMLElement) ?? null)
}

/** The element that really has focus, inside open and closed shadow roots, which events from outside only see as the host. */
export function deepFocus(e: Event, doc: Document): Element | null {
  const first = e.composedPath()[0]
  let el = isElement(first) ? first : doc.activeElement
  while (el) {
    const inner = shadowOf(el)?.activeElement
    if (!inner || inner === el) break
    el = inner
  }
  return el
}

const modalOpen = (doc: Document) => [...doc.querySelectorAll(MODAL)].some((el) => el.checkVisibility())

/** Space, the arrows and Esc while Pacer reads the page. Keys it handles never reach the page, and the rest pass through. */
export function attachKeys(win: Window, session: KeyTarget): () => void {
  const doc = win.document
  const handled = new Set<string>()

  const actionFor = (e: KeyboardEvent): (() => void) | null => {
    const focus = deepFocus(e, doc)
    if (e.key === 'Escape') {
      if (modalOpen(doc) || (focus && editable(focus))) return null
      return () => (session.playing ? session.pause() : void session.stop('esc'))
    }
    if (!isReadingFocus(focus)) return null
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
      session.abandon()
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

  win.addEventListener('keydown', onKeyDown, true)
  win.addEventListener('keyup', onKeyUp, true)
  return () => {
    win.removeEventListener('keydown', onKeyDown, true)
    win.removeEventListener('keyup', onKeyUp, true)
  }
}

/** A click on a word jumps there. Clicks on controls, Pacer's bar and text being selected are left alone. */
export function attachClicks(doc: Document, session: ClickTarget): () => void {
  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || fromPacer(e)) return
    if (isElement(e.target) && e.target.closest(CLICKABLE)) return
    if (doc.getSelection()?.isCollapsed === false) return
    const map = session.wordMap
    const caret = map ? doc.caretPositionFromPoint?.(e.clientX, e.clientY) : null
    if (!map || !caret) return
    const { offsetNode, offset } = caret
    let i = map.wordAt(offsetNode, offset)
    // The page may have re-rendered this text, so one fresh map is worth trying when the click landed in it.
    if (i < 0 && map.owns(offsetNode) && map.canRebuild()) i = session.rebuildMap()?.wordAt(offsetNode, offset) ?? -1
    if (i >= 0) session.jump(i)
  }
  doc.addEventListener('click', onClick)
  return () => doc.removeEventListener('click', onClick)
}
