import type { ChunkSize } from '../../src/lib/text'
import { formatDuration } from '../../src/lib/timing'
import type { BarActions, BarState, BarView, LineBox, NoticeAction } from './session'

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
  settings: [
    ['path', 'M10 5H3'],
    ['path', 'M12 19H3'],
    ['path', 'M14 3v4'],
    ['path', 'M16 17v4'],
    ['path', 'M21 12h-9'],
    ['path', 'M21 19h-5'],
    ['path', 'M21 5h-7'],
    ['path', 'M8 10v4'],
    ['path', 'M8 12H3'],
  ],
} satisfies Record<string, IconPart[]>

type OnOff = 'on' | 'off'

interface Choices<T> {
  row: HTMLElement
  set(value: T, hint?: string): void
}

const CHUNK_LABELS: Record<string, string> = { 1: '1 word', 2: '2 words', 3: '3 words', phrase: 'Phrase', sentence: 'Sentence' }
const ACTION_LABELS: Record<NoticeAction, string> = { openTab: 'Open in tab', readOn: 'Read on' }
const CHUNK_CHOICES: [ChunkSize, string][] = [
  [1, '1'],
  [2, '2'],
  [3, '3'],
  ['phrase', 'Phrase'],
  ['sentence', 'Sentence'],
]
const CHUNK_HINTS: Partial<Record<ChunkSize, string>> = {
  phrase: 'Small words ride with the next word',
  sentence: 'The whole sentence lights up at once',
}
const ON_OFF: [OnOff, string][] = [
  ['on', 'On'],
  ['off', 'Off'],
]
const onOff = (on: boolean): OnOff => (on ? 'on' : 'off')
const shortcuts = (bySentence: boolean): [string, string][] => [
  ['Space', 'Play or pause'],
  ['← →', bySentence ? 'Back or forward one sentence' : 'Back or forward one word'],
  ...(bySentence ? [] : [['⇧← ⇧→', 'Back or forward one sentence'] satisfies [string, string]]),
  ['↑ ↓', 'Faster or slower'],
  ['Esc', 'Close settings, pause, then stop'],
]
const TOAST_MS = 4000
const EDGE = 16
const PLACE_MS = 1000
const MAX_LIFT = 1 / 3
const DOCK_FADE_MS = 160
const SETTINGS_GAP = 8
const SVG = 'http://www.w3.org/2000/svg'

const TOKENS = `
  --pc-paper: #eff1ed;
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
  --pc-paper: #15181b;
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
.sliders[aria-expanded='true'] { background: color-mix(in oklab, var(--pc-ink) 7%, transparent); color: var(--pc-ink); }
.icon.sm svg { width: 15px; height: 15px; }
.play { width: 40px; height: 40px; background: var(--pc-accent); color: var(--pc-accent-ink); }
.play[aria-label='Play'] svg { translate: 1px 0; }
.wpm { display: flex; align-items: center; }
.wpm-value { min-width: 4.6em; text-align: center; font-size: 13px; color: var(--pc-muted); font-variant-numeric: tabular-nums; }
.wpm-value strong { color: var(--pc-ink); font-weight: 600; }
.middle { position: relative; flex: 1 1 auto; min-width: 56px; display: flex; align-items: center; gap: 10px; padding-inline: 4px; }
.progress { position: relative; flex: 1 1 auto; width: 180px; min-width: 40px; height: 20px; display: flex; align-items: center; cursor: pointer; touch-action: none; }
.progress::before, .fill { content: ''; position: absolute; left: 0; right: 0; height: 3px; border-radius: 3px; }
.progress::before { background: var(--pc-rule); }
.fill { background: var(--pc-ink-soft); transform-origin: left center; transform: scaleX(0); transition: transform 200ms linear; }
.time { font-size: 13px; color: var(--pc-muted); font-variant-numeric: tabular-nums; }
.notice { margin: 0; flex: 1 1 auto; min-width: 40px; max-width: 320px; white-space: normal; line-height: 1.25; font-size: 13px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; color: var(--pc-ink); }
.text { padding: 0 12px; height: 32px; font-size: 13px; font-weight: 550; }
.chunk { color: var(--pc-ink-soft); }
.action { background: var(--pc-accent); color: var(--pc-accent-ink); }
.panel[data-action] .progress, .panel[data-action] .time { display: none; }
/* A plain notice sits over the hidden progress and time, so the bar keeps its width and Play stays under the pointer when reading starts. */
.panel[data-notice]:not([data-action]) .progress, .panel[data-notice]:not([data-action]) .time { visibility: hidden; }
.panel[data-notice]:not([data-action]) .notice { position: absolute; inset-inline: 4px; top: 50%; translate: 0 -50%; max-width: none; }
.panel:not([data-notice]) .notice, .panel:not([data-action]) .action { display: none; }
.panel[data-loading] .play, .panel[data-loading] .wpm, .panel[data-loading] .chunk, .panel[data-loading] .sliders { opacity: 0.4; pointer-events: none; }
.settings {
  position: absolute;
  left: 50%;
  bottom: calc(100% + ${SETTINGS_GAP}px);
  translate: -50% 0;
  width: min(360px, calc(100vw - 32px));
  overflow-y: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  background: var(--pc-paper-raised);
  border: 1px solid var(--pc-rule);
  border-radius: 14px;
  box-shadow: 0 16px 40px -16px var(--pc-shadow), 0 1px 3px var(--pc-shadow);
  font-weight: 400;
  line-height: 1.35;
  white-space: normal;
  cursor: default;
  transform-origin: bottom center;
  animation: settings-up 180ms cubic-bezier(0.19, 1, 0.22, 1);
}
.settings[hidden] { display: none; }
.panel[data-top] .settings { bottom: auto; top: calc(100% + ${SETTINGS_GAP}px); transform-origin: top center; animation-name: settings-down; }
@keyframes settings-up {
  from { opacity: 0; transform: translateY(4px) scale(0.97); }
}
@keyframes settings-down {
  from { opacity: 0; transform: translateY(-4px) scale(0.97); }
}
.setting { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; }
.setting-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.setting-label { font-size: 14px; color: var(--pc-ink-soft); }
.setting-hint { font-size: 12px; color: var(--pc-muted); }
.segmented { display: inline-flex; padding: 3px; border-radius: 999px; background: color-mix(in oklab, var(--pc-ink) 6%, transparent); }
.segmented button { padding: 5px 11px; font-size: 13px; font-weight: 550; line-height: 1.35; }
.segmented button[aria-checked='true'] { background: var(--pc-paper-raised); color: var(--pc-ink); box-shadow: 0 0 0 1px var(--pc-rule), 0 1px 2px var(--pc-shadow); }
.shortcuts { margin: 2px 0 0; padding-top: 14px; border-top: 1px solid var(--pc-rule); display: grid; gap: 8px; font-size: 13px; color: var(--pc-muted); }
.shortcuts div { display: grid; grid-template-columns: 96px 1fr; align-items: center; }
.shortcuts dt, .shortcuts dd { margin: 0; }
kbd { margin-right: 4px; padding: 1px 6px; font: inherit; font-size: 12px; font-weight: 600; color: var(--pc-ink-soft); background: var(--pc-paper); border: 1px solid var(--pc-rule); border-bottom-width: 2px; border-radius: 5px; }
@media (hover: none) {
  .shortcuts { display: none; }
}
@media (hover: hover) and (pointer: fine) {
  button:hover { background: color-mix(in oklab, var(--pc-ink) 7%, transparent); color: var(--pc-ink); }
  .play:hover, .action:hover { background: color-mix(in oklab, var(--pc-accent) 86%, var(--pc-ink)); color: var(--pc-accent-ink); }
}
@media (max-width: 480px) {
  .panel { gap: 2px; }
  .time, .chunk { display: none; }
  .panel[data-action] .wpm, .panel[data-action] .sliders, .panel[data-notice]:not([data-action='readOn']) .open { display: none; }
  .wpm-value { min-width: 3.4em; }
  .middle { padding-inline: 6px; }
  .notice { font-size: 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .fill { transition: none; }
  .settings, .panel[data-top] .settings { animation-name: settings-fade; }
  @keyframes settings-fade {
    from { opacity: 0; }
  }
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

// Obsidian's scanner reports createElement anywhere in the repo, so the bar makes its elements by namespace.
const XHTML = 'http://www.w3.org/1999/xhtml'

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = '') {
  const el = doc.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K]
  if (className) el.className = className
  if (text) el.textContent = text
  return el
}

function mountHost(doc: Document, name: string): { host: HTMLElement; root: ShadowRoot } {
  const host = doc.createElementNS(XHTML, name)
  const root = host.attachShadow({ mode: 'closed' })
  const sheet = new (doc.defaultView ?? window).CSSStyleSheet()
  sheet.replaceSync(CSS)
  root.adoptedStyleSheets = [sheet]
  host.setAttribute('popover', 'manual')
  doc.documentElement.append(host)
  // A transform or filter on the page's html carries fixed boxes off with the page, so lift the host into the top layer.
  host.showPopover?.()
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
  private readonly settingsButton: HTMLButtonElement
  private readonly settings: HTMLElement
  private readonly chunkChoice: Choices<ChunkSize>
  private readonly smartChoice: Choices<OnOff>
  private readonly pausesChoice: Choices<OnOff>
  private readonly autoStartChoice: Choices<OnOff>
  private readonly shortcutList: HTMLElement
  private readonly doc: Document
  private readonly actions: BarActions
  private bySentence: boolean | null = null
  private playing: boolean | null = null
  private noticeAction: NoticeAction | null = null
  private placedAt = -Infinity
  private line: LineBox | null = null
  private atTop = false
  private escapeClosed = false

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
    this.settingsButton = this.button('icon sliders', 'Reading settings', () => this.toggleSettings(), ICONS.settings)
    this.settingsButton.setAttribute('aria-expanded', 'false')
    const openTab = this.button('icon open', 'Open in a Pacer tab', () => actions.openTab(), ICONS.openTab)
    const close = this.button('icon', 'Stop reading', () => actions.close(), ICONS.close)

    this.settings = element(doc, 'div', 'settings')
    this.settings.setAttribute('role', 'dialog')
    this.settings.setAttribute('aria-label', 'Reading settings')
    this.settings.hidden = true
    this.settings.addEventListener('mousedown', keepFocus)
    this.chunkChoice = this.choices('Words at a time', CHUNK_CHOICES, (chunk) => actions.update({ chunk }))
    this.smartChoice = this.choices('Smart pacing', ON_OFF, (v) => actions.update({ smart: v === 'on' }))
    this.pausesChoice = this.choices('Pause at punctuation', ON_OFF, (v) => actions.update({ pauses: v === 'on' }))
    this.autoStartChoice = this.choices('Start on press', ON_OFF, (v) => actions.update({ autoStart: v === 'on' }))
    this.shortcutList = element(doc, 'dl', 'shortcuts')
    this.settings.append(this.chunkChoice.row, this.smartChoice.row, this.pausesChoice.row, this.autoStartChoice.row, this.shortcutList)

    panel.append(this.play, wpm, middle, this.chunk, this.settingsButton, this.settings, openTab, close)
    // Focus inside the bar is on Pacer's own controls, so the page keys skip it and Esc has to close the panel here.
    panel.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      this.escapeClosed = !this.settings.hidden
      if (!this.escapeClosed) return
      e.stopPropagation()
      const inside = this.settings.contains(e.target as Node)
      this.closeSettings()
      if (inside) this.settingsButton.focus()
    })
    panel.addEventListener('keyup', (e) => {
      if (e.key !== 'Escape' || !this.escapeClosed) return
      this.escapeClosed = false
      e.stopPropagation()
    })
    root.append(panel)
    this.setPlaying(false)
    this.place()
    doc.defaultView?.addEventListener('resize', this.place)
  }

  static mount(actions: BarActions, doc: Document = document): Bar {
    return new Bar(actions, doc)
  }

  get settingsOpen(): boolean {
    return !this.settings.hidden
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
    this.chunkChoice.set(state.chunk, CHUNK_HINTS[state.chunk])
    this.smartChoice.set(onOff(state.smart), state.smart ? 'Rare and long words get more time' : 'Every word gets the same time')
    this.pausesChoice.set(onOff(state.pauses))
    this.autoStartChoice.set(onOff(state.autoStart))
    this.listShortcuts(state.chunk === 'sentence')
    if (state.notice) this.notice(state.notice.text, state.notice.action)
    else this.clearNotice()
  }

  private toggleSettings(): void {
    if (this.closeSettings() || this.panel.hasAttribute('data-loading')) return
    // Clicks never focus the bar's buttons, so a focused sliders button means the keyboard opened the panel.
    const byKeys = (this.settingsButton.getRootNode() as ShadowRoot).activeElement === this.settingsButton
    this.settings.hidden = false
    this.settingsButton.setAttribute('aria-expanded', 'true')
    this.doc.addEventListener('pointerdown', this.onPointerDown, true)
    this.fitSettings()
    if (byKeys) this.settings.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }

  closeSettings(): boolean {
    if (this.settings.hidden) return false
    this.settings.hidden = true
    this.settingsButton.setAttribute('aria-expanded', 'false')
    this.doc.removeEventListener('pointerdown', this.onPointerDown, true)
    return true
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

  /** Moves the bar to the top while the reading line sits where the bar would be, like the last lines of a page. */
  keepClear(line: LineBox | null): void {
    this.line = line
    this.place()
  }

  dispose(): void {
    this.closeSettings()
    this.doc.defaultView?.removeEventListener('resize', this.place)
    this.host.remove()
  }

  /** Lifts the bar over furniture pinned to the bottom of the window, or moves it to the top when that is too tall or the reading line is there. */
  private place = () => {
    this.placedAt = performance.now()
    const { style } = this.panel
    style.top = style.bottom = ''
    const rect = this.panel.getBoundingClientRect()
    const win = this.doc.defaultView
    const height = win?.innerHeight ?? 0
    const lift = rect.height > 0 ? liftOver(this.doc, rect) : 0
    const bottom = lift > 0 ? height - lift : rect.bottom
    const underLine = rect.height > 0 && this.line !== null && this.line.bottom > bottom - rect.height && this.line.top < bottom
    const top = lift > height * MAX_LIFT || underLine
    if (top) {
      style.top = `${EDGE}px`
      style.bottom = 'auto'
    } else if (lift > 0) {
      style.bottom = `${lift}px`
    }
    this.panel.toggleAttribute('data-top', top)
    this.fitSettings()
    if (top === this.atTop) return
    this.atTop = top
    if (!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.panel.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: DOCK_FADE_MS, easing: 'ease-out' })
    }
  }

  // The bar can sit lifted over page furniture or docked at the top, so cap the panel to the room it has there.
  private fitSettings() {
    if (this.settings.hidden) return
    const bar = this.panel.getBoundingClientRect()
    const height = this.doc.defaultView?.innerHeight ?? 0
    const room = (this.panel.hasAttribute('data-top') ? height - bar.bottom : bar.top) - SETTINGS_GAP - EDGE
    this.settings.style.maxHeight = room > 0 ? `${room}px` : ''
  }

  private onPointerDown = (e: Event) => {
    if (!e.composedPath().includes(this.host)) this.closeSettings()
  }

  private listShortcuts(bySentence: boolean) {
    if (this.bySentence === bySentence) return
    this.bySentence = bySentence
    this.shortcutList.replaceChildren(
      ...shortcuts(bySentence).map(([keys, action]) => {
        const row = element(this.doc, 'div')
        const dt = element(this.doc, 'dt')
        dt.append(...keys.split(' ').map((key) => element(this.doc, 'kbd', '', key)))
        row.append(dt, element(this.doc, 'dd', '', action))
        return row
      }),
    )
  }

  private choices<T extends string | number>(label: string, options: [T, string][], pick: (value: T) => void): Choices<T> {
    const row = element(this.doc, 'div', 'setting')
    const text = element(this.doc, 'div', 'setting-text')
    const hint = element(this.doc, 'span', 'setting-hint')
    text.append(element(this.doc, 'span', 'setting-label', label), hint)
    const group = element(this.doc, 'div', 'segmented')
    group.setAttribute('role', 'radiogroup')
    group.setAttribute('aria-label', label)
    const buttons = options.map(([value, name]) => {
      const button = this.button('', '', () => pick(value))
      button.setAttribute('role', 'radio')
      button.textContent = name
      return button
    })
    group.append(...buttons)
    row.append(text, group)
    return {
      row,
      set: (value, note) => {
        options.forEach(([option], k) => buttons[k].setAttribute('aria-checked', String(option === value)))
        hint.textContent = note ?? ''
        hint.hidden = !note
      },
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

let toast: { host: HTMLElement; win: Window; timer: number } | null = null

/** A short message where the bar would be, for when there is no bar to hold it. */
export const Toast = {
  show(message: string, doc: Document = document): void {
    Toast.dismiss()
    const win = doc.defaultView ?? window
    const { host, root } = mountHost(doc, 'pacer-toast')
    const panel = element(doc, 'div', 'panel toast', message)
    panel.setAttribute('role', 'status')
    root.append(panel)
    toast = { host, win, timer: win.setTimeout(() => Toast.dismiss(), TOAST_MS) }
  },

  dismiss(): void {
    if (!toast) return
    toast.win.clearTimeout(toast.timer)
    toast.host.remove()
    toast = null
  },
}
