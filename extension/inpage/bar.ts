import { formatDuration } from '../../src/lib/timing'
import type { BarActions, BarState, BarView, NoticeAction } from './session'

type IconPart = ['path', string] | ['rect', number, number, number, number]

// The page bundle cannot carry React, so Lucide's shapes are drawn here by hand.
const ICONS = {
  play: [['path', 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z']],
  pause: [
    ['rect', 14, 3, 5, 18],
    ['rect', 5, 3, 5, 18],
  ],
  minus: [['path', 'M5 12h14']],
  plus: [
    ['path', 'M5 12h14'],
    ['path', 'M12 5v14'],
  ],
  openTab: [
    ['path', 'M15 3h6v6'],
    ['path', 'M10 14 21 3'],
    ['path', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  ],
  close: [
    ['path', 'M18 6 6 18'],
    ['path', 'm6 6 12 12'],
  ],
} satisfies Record<string, IconPart[]>

const CHUNK_LABELS: Record<string, string> = { 1: '1 word', 2: '2 words', 3: '3 words', phrase: 'Phrase', sentence: 'Sentence' }
const ACTION_LABELS: Record<NoticeAction, string> = { openTab: 'Open in tab', readOn: 'Read on' }
const TOAST_MS = 4000
const EDGE = 16
const PLACE_MS = 1000
const MAX_LIFT = 1 / 3
const SVG = 'http://www.w3.org/2000/svg'

const TOKENS = `
  --pc-paper-raised: #f8f9f6;
  --pc-ink: #1b2126;
  --pc-ink-soft: #485159;
  --pc-muted: #78818a;
  --pc-rule: #d5dad4;
  --pc-accent: #2442c4;
  --pc-accent-ink: #ffffff;
  --pc-shadow: rgba(24, 34, 44, 0.16);
  color-scheme: light;`

const DARK_TOKENS = `
  --pc-paper-raised: #1c2024;
  --pc-ink: #e2e5e7;
  --pc-ink-soft: #b3b9bf;
  --pc-muted: #7d868e;
  --pc-rule: #2b3036;
  --pc-accent: #8ea3ff;
  --pc-accent-ink: #0d1330;
  --pc-shadow: rgba(0, 0, 0, 0.5);
  color-scheme: dark;`

// Page rules that match the host beat normal shadow rules, so the reset is !important.
const CSS = `
:host { all: initial !important; }
.panel {${TOKENS}
  position: fixed;
  left: 50%;
  bottom: 16px;
  z-index: 2147483647;
  translate: -50% 0;
  box-sizing: border-box;
  width: max-content;
  max-width: calc(100vw - 32px);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 6px;
  background: var(--pc-paper-raised);
  color: var(--pc-ink);
  border: 1px solid var(--pc-rule);
  border-radius: 999px;
  box-shadow: 0 16px 40px -16px var(--pc-shadow), 0 1px 3px var(--pc-shadow);
  font: 500 14px/1.2 'Instrument Sans Variable', system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  white-space: nowrap;
  animation: rise 180ms cubic-bezier(0.19, 1, 0.22, 1);
}
@media (prefers-color-scheme: dark) {
  .panel {${DARK_TOKENS}
  }
}
@keyframes rise {
  from { opacity: 0; translate: -50% 8px; }
}
@media (prefers-reduced-motion: reduce) {
  .panel { animation: none; }
}
.toast { padding: 12px 18px; white-space: normal; text-align: center; max-width: min(420px, calc(100vw - 32px)); }
*, *::before, *::after { box-sizing: border-box; }
button {
  all: unset;
  box-sizing: border-box;
  display: inline-grid;
  place-items: center;
  flex: none;
  cursor: pointer;
  border-radius: 999px;
  color: var(--pc-ink-soft);
  transition: background-color 150ms ease, transform 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
button:focus-visible { outline: 2px solid var(--pc-accent); outline-offset: 2px; }
button:active { transform: scale(0.94); }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.icon { width: 34px; height: 34px; }
.icon.sm svg { width: 15px; height: 15px; }
.play { width: 40px; height: 40px; background: var(--pc-accent); color: var(--pc-accent-ink); }
.play[aria-label='Play'] svg { translate: 1px 0; }
.wpm { display: flex; align-items: center; }
.wpm-value { min-width: 4.6em; text-align: center; font-size: 13px; color: var(--pc-muted); font-variant-numeric: tabular-nums; }
.wpm-value strong { color: var(--pc-ink); font-weight: 600; }
.middle { flex: 1 1 auto; min-width: 56px; display: flex; align-items: center; gap: 10px; padding-inline: 4px; }
.progress { position: relative; flex: 1 1 auto; width: 180px; min-width: 40px; height: 20px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
.progress::before, .fill { content: ''; position: absolute; left: 0; right: 0; height: 3px; border-radius: 3px; }
.progress::before { background: var(--pc-rule); }
.fill { background: var(--pc-ink-soft); transform-origin: left center; transform: scaleX(0); transition: transform 200ms linear; }
.time { font-size: 13px; color: var(--pc-muted); font-variant-numeric: tabular-nums; }
.notice { margin: 0; flex: 1 1 auto; min-width: 40px; max-width: 320px; white-space: normal; line-height: 1.25; font-size: 13px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--pc-ink); }
.text { padding: 0 12px; height: 32px; font-size: 13px; font-weight: 550; }
.chunk { color: var(--pc-ink-soft); }
.action { background: var(--pc-accent); color: var(--pc-accent-ink); }
.panel[data-notice] .progress, .panel[data-notice] .time { display: none; }
.panel:not([data-notice]) .notice, .panel:not([data-action]) .action { display: none; }
.panel[data-loading] .play, .panel[data-loading] .wpm, .panel[data-loading] .chunk { opacity: 0.4; pointer-events: none; }
@media (hover: hover) and (pointer: fine) {
  button:hover { background: color-mix(in oklab, var(--pc-ink) 7%, transparent); color: var(--pc-ink); }
  .play:hover, .action:hover { background: color-mix(in oklab, var(--pc-accent) 86%, var(--pc-ink)); color: var(--pc-accent-ink); }
}
@media (max-width: 480px) {
  .panel { gap: 2px; }
  .time, .chunk { display: none; }
  .panel[data-notice] .wpm, .panel[data-action='openTab'] .open { display: none; }
  .wpm-value { min-width: 3.4em; }
  .middle { padding-inline: 6px; }
}
@media (prefers-reduced-motion: reduce) {
  .fill { transition: none; }
}
`

function icon(doc: Document, parts: IconPart[]): SVGSVGElement {
  const svg = doc.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  for (const part of parts) {
    const el = doc.createElementNS(SVG, part[0])
    if (part[0] === 'path') el.setAttribute('d', part[1])
    else {
      const [, x, y, width, height] = part
      for (const [name, value] of Object.entries({ x, y, width, height, rx: 1 })) el.setAttribute(name, String(value))
    }
    svg.append(el)
  }
  return svg
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = '') {
  const el = doc.createElement(tag)
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

/** A closed shadow root on a fresh host at the end of the page, styled only by Pacer. */
function mountHost(doc: Document, name: string): { host: HTMLElement; root: ShadowRoot } {
  const host = doc.createElement(name)
  const root = host.attachShadow({ mode: 'closed' })
  const sheet = new (doc.defaultView ?? window).CSSStyleSheet()
  sheet.replaceSync(CSS)
  root.adoptedStyleSheets = [sheet]
  doc.documentElement.append(host)
  return { host, root }
}

// A click would focus the bar's button and Space would then press it, so keep focus on the page.
const keepFocus = (e: Event) => e.preventDefault()

/** The page box pinned to the window that holds el, like a cookie banner or a sticky footer. */
function pinnedBox(el: Element): Element | null {
  const win = el.ownerDocument.defaultView
  for (let box: Element | null = el; box && box !== el.ownerDocument.body; box = box.parentElement) {
    const style = win?.getComputedStyle(box)
    if (style?.position === 'fixed' || (style?.position === 'sticky' && style.bottom !== 'auto')) return box
  }
  return null
}

/** How far up the bar must sit to clear page furniture pinned under it, or 0 when nothing is there. */
function liftOver(doc: Document, panel: DOMRect): number {
  const height = doc.defaultView?.innerHeight ?? 0
  const bottom = height - EDGE
  let lift = 0
  for (const x of [panel.left + 8, (panel.left + panel.right) / 2, panel.right - 8]) {
    for (const y of [bottom - panel.height + 4, bottom - panel.height / 2, bottom - 4]) {
      const under = doc.elementsFromPoint(x, y).find((el) => !el.localName.startsWith('pacer-'))
      const box = under ? pinnedBox(under)?.getBoundingClientRect() : undefined
      // A box over half the window is a modal or a side nav, which the bar cannot get out from under.
      if (box && box.height < height / 2) lift = Math.max(lift, height - box.top + EDGE)
    }
  }
  return lift
}

/** The floating controls for reading in place, at the bottom centre of the window. */
export class Bar implements BarView {
  private readonly host: HTMLElement
  private readonly panel: HTMLElement
  private readonly play: HTMLButtonElement
  private readonly wpm: HTMLElement
  private readonly progress: HTMLElement
  private readonly fill: HTMLElement
  private readonly time: HTMLElement
  private readonly chunk: HTMLButtonElement
  private readonly noticeText: HTMLElement
  private readonly action: HTMLButtonElement
  private readonly doc: Document
  private readonly actions: BarActions
  private playing: boolean | null = null
  private noticeAction: NoticeAction | null = null
  private placedAt = -Infinity

  private constructor(actions: BarActions, doc: Document) {
    this.doc = doc
    this.actions = actions
    const { host, root } = mountHost(doc, 'pacer-bar')
    this.host = host
    const panel = element(doc, 'div', 'panel')
    panel.setAttribute('role', 'toolbar')
    panel.setAttribute('aria-label', 'Pacer')
    panel.dataset.loading = ''
    this.panel = panel

    this.play = this.button('play', 'Play', () => actions.toggle())
    const slower = this.button('icon sm', 'Slower', () => actions.slower(), ICONS.minus)
    const faster = this.button('icon sm', 'Faster', () => actions.faster(), ICONS.plus)
    this.wpm = element(doc, 'span', 'wpm-value')
    const wpm = element(doc, 'div', 'wpm')
    wpm.append(slower, this.wpm, faster)

    this.progress = element(doc, 'div', 'progress')
    this.progress.setAttribute('role', 'slider')
    this.progress.setAttribute('aria-label', 'Position')
    this.progress.setAttribute('aria-valuemin', '0')
    this.progress.setAttribute('aria-valuemax', '100')
    this.fill = element(doc, 'div', 'fill')
    this.progress.append(this.fill)
    this.progress.addEventListener('mousedown', keepFocus)
    this.progress.addEventListener('pointerdown', (e) => {
      const box = this.progress.getBoundingClientRect()
      if (box.width > 0) actions.seek(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)))
    })
    this.time = element(doc, 'span', 'time')
    this.noticeText = element(doc, 'p', 'notice')
    this.noticeText.setAttribute('aria-live', 'polite')
    this.action = this.button('text action', '', () => this.runNoticeAction())
    const middle = element(doc, 'div', 'middle')
    middle.append(this.progress, this.time, this.noticeText, this.action)

    this.chunk = this.button('text chunk', 'Words at a time', () => actions.cycleChunk())
    const openTab = this.button('icon open', 'Open in a Pacer tab', () => actions.openTab(), ICONS.openTab)
    const close = this.button('icon', 'Stop reading', () => actions.close(), ICONS.close)
    panel.append(this.play, wpm, middle, this.chunk, openTab, close)
    root.append(panel)
    this.setPlaying(false)
    this.place()
    doc.defaultView?.addEventListener('resize', this.place)
  }

  static mount(actions: BarActions, doc: Document = document): Bar {
    return new Bar(actions, doc)
  }

  render(state: BarState): void {
    // Cookie banners and the like come and go after the page loads, so look again now and then.
    if (performance.now() - this.placedAt >= PLACE_MS) this.place()
    delete this.panel.dataset.loading
    this.setPlaying(state.playing)
    this.wpm.replaceChildren(element(this.doc, 'strong', '', String(state.wpm)), ' wpm')
    const percent = Math.round(state.progress * 100)
    this.fill.style.transform = `scaleX(${state.progress})`
    this.progress.setAttribute('aria-valuenow', String(percent))
    this.time.textContent = `${formatDuration(state.left)} left`
    this.chunk.textContent = CHUNK_LABELS[String(state.chunk)] ?? String(state.chunk)
    this.chunk.setAttribute('aria-label', `Words at a time: ${this.chunk.textContent}`)
    if (state.notice) this.notice(state.notice.text, state.notice.action)
    else this.clearNotice()
  }

  notice(text: string, action?: NoticeAction): void {
    this.panel.dataset.notice = ''
    this.noticeText.textContent = text
    this.noticeAction = action ?? null
    if (action) {
      this.panel.dataset.action = action
      this.action.textContent = ACTION_LABELS[action]
    } else {
      delete this.panel.dataset.action
    }
  }

  dispose(): void {
    this.doc.defaultView?.removeEventListener('resize', this.place)
    this.host.remove()
  }

  /** Lifts the bar over furniture pinned to the bottom of the window, or moves it to the top when that is too tall. */
  private place = () => {
    this.placedAt = performance.now()
    const { style } = this.panel
    style.top = style.bottom = ''
    const rect = this.panel.getBoundingClientRect()
    const height = this.doc.defaultView?.innerHeight ?? 0
    const lift = rect.height > 0 ? liftOver(this.doc, rect) : 0
    if (lift > height * MAX_LIFT) {
      style.top = `${EDGE}px`
      style.bottom = 'auto'
    } else if (lift > 0) {
      style.bottom = `${lift}px`
    }
  }

  private clearNotice() {
    delete this.panel.dataset.notice
    delete this.panel.dataset.action
    this.noticeAction = null
  }

  private runNoticeAction() {
    if (this.noticeAction) this.actions[this.noticeAction]()
  }

  private setPlaying(playing: boolean) {
    if (this.playing === playing) return
    this.playing = playing
    this.play.setAttribute('aria-label', playing ? 'Pause' : 'Play')
    this.play.replaceChildren(icon(this.doc, playing ? ICONS.pause : ICONS.play))
  }

  private button(className: string, label: string, onClick: () => void, parts?: IconPart[]): HTMLButtonElement {
    const button = element(this.doc, 'button', className)
    button.type = 'button'
    if (label) {
      button.setAttribute('aria-label', label)
      button.title = label
    }
    if (parts) button.append(icon(this.doc, parts))
    button.addEventListener('mousedown', keepFocus)
    button.addEventListener('click', onClick)
    return button
  }
}

let toast: { host: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null

/** A short message where the bar would be, for when there is no bar to hold it. */
export const Toast = {
  show(message: string, doc: Document = document): void {
    Toast.dismiss()
    const { host, root } = mountHost(doc, 'pacer-toast')
    const panel = element(doc, 'div', 'panel toast', message)
    panel.setAttribute('role', 'status')
    root.append(panel)
    toast = { host, timer: setTimeout(Toast.dismiss, TOAST_MS) }
  },

  dismiss(): void {
    if (!toast) return
    clearTimeout(toast.timer)
    toast.host.remove()
    toast = null
  },
}
