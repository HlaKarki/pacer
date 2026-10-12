import raw from '../../src/data/frequency.txt' with { type: 'text' }
import { parseFrequency } from '../../src/lib/frequency'
import { WPM_STEP, type Settings } from '../../src/lib/settings'
import { chunkAt, parse, type ChunkSize, type Doc } from '../../src/lib/text'
import { msPerWord, weightPrefix } from '../../src/lib/timing'
import { chunkDelayMs, clampWpm, nextSentenceTarget, prevSentenceTarget } from '../../src/lib/transport'
import { extractArticle, HEADER_STRIP, matchParagraph, openingsAtTop, type Article } from '../article'
import { withoutHash } from '../pages'
import { ExtensionStore, PAST_END, startFrom } from '../store'
import { Follow, inView } from './follow'
import { Bar } from './bar'
import { attachClicks, attachKeys } from './keys'
import { MIN_COVERAGE, WordMap } from './map'
import { Marks, type Tone, type ToneRun } from './marks'
import { viewportStart } from './start'

export type ToggleResult =
  | { kind: 'started' }
  | { kind: 'stopped' }
  | { kind: 'busy' }
  | { kind: 'fallback'; article: Article; coverage: number }
  | { kind: 'error'; message: string }

export type StopReason = 'esc' | 'toolbar' | 'close' | 'pagehide' | 'navigate' | 'tab'

export type NoticeAction = 'openTab' | 'readOn'

export interface Notice {
  text: string
  action?: NoticeAction
}

export interface BarState {
  playing: boolean
  wpm: number
  chunk: ChunkSize
  /** From 0 at the first word to 1 at the last. */
  progress: number
  /** Reading time left, in milliseconds. */
  left: number
  notice: Notice | null
}

export interface BarActions {
  toggle(): void
  slower(): void
  faster(): void
  cycleChunk(): void
  seek(fraction: number): void
  openTab(): void
  readOn(): void
  close(): void
}

export interface BarView {
  render(state: BarState): void
  notice(text: string, action?: NoticeAction): void
  dispose(): void
}

export interface SessionOptions {
  win?: Window
  mountBar?: (actions: BarActions) => BarView
  /** Bar "Open in tab", and the action on notices that give up on the page. */
  openTab?: () => void
  /** Bar "Read on" at the end of the page. */
  readOn?: () => void
  /** The fingerprint of the Doc that Read on came from, so the same Doc again waits at its end. */
  after?: string
  /** Runs once when the session goes, however it went, so its owner can let it go. */
  ended?: () => void
}

const CHUNK_ORDER: ChunkSize[] = [1, 2, 3, 'phrase', 'sentence']
const COVERED_SKIPS = 2
const LOST: Notice = { text: 'Pacer lost its place', action: 'openTab' }
const COVERED: Notice = { text: 'Something on the page covers the text', action: 'openTab' }
const FAILED: Notice = { text: 'Pacer could not keep reading here', action: 'openTab' }
const CHANGED: Notice = { text: 'This page changed', action: 'openTab' }
const END: Notice = { text: 'End of the page', action: 'readOn' }
const NOTHING_NEW: Notice = { text: "That's the end of this page" }
const FINGERPRINT_WORDS = 50

const NO_BAR: BarView = {
  render: () => undefined,
  notice: () => undefined,
  dispose: () => undefined,
}
const nothing = () => undefined

const fingerprintOf = (doc: Doc) => [doc.words.length, ...doc.words.slice(0, FINGERPRINT_WORDS).map((w) => w.text)].join(' ')

// Frame callbacks run before the paint and hidden tabs get none, so wait for a timeout after the frame or 100 ms.
const nextFrame = (win: Window) =>
  new Promise<void>((resolve) => {
    win.requestAnimationFrame(() => setTimeout(resolve))
    setTimeout(resolve, 100)
  })

interface Run {
  tone: Tone
  start: number
  end: number
}

/** One reading of the page in place: the highlight, its pace, the scroll that follows it, and the saved place. */
export class InPageSession {
  readonly key: string
  private readonly win: Window
  private readonly options: Required<Omit<SessionOptions, 'win' | 'after'>>
  private readonly after: string | null
  private bar: BarView = NO_BAR
  private store: ExtensionStore | null = null
  private source: Article | null = null
  private doc!: Doc
  private map!: WordMap
  private marks!: Marks
  private follow!: Follow
  private prefix: Float64Array = new Float64Array(1)
  private paced = { pauses: false, smart: false }
  private unsubscribe: () => void = nothing
  private detachers: (() => void)[] = []
  private ready = false
  private disposed = false
  private isPlaying = false
  private finished = false
  private index = 0
  private from = 0
  private chunk = { start: 0, end: 0 }
  private sincePlay = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private lineAt = -1
  private coveredRun = 0
  private userScrolled = false
  private notice: Notice | null = null
  private readFrom = 0
  private runs: Run[] = []
  private runsTo = 0

  constructor(options: SessionOptions = {}) {
    this.win = options.win ?? window
    this.key = withoutHash(this.win.location.href)
    this.options = {
      mountBar: options.mountBar ?? ((actions) => Bar.mount(actions, this.win.document)),
      openTab: options.openTab ?? nothing,
      readOn: options.readOn ?? nothing,
      ended: options.ended ?? nothing,
    }
    this.after = options.after ?? null
  }

  get playing(): boolean {
    return this.isPlaying
  }

  /** The article as extracted at the start, for the reader tab. */
  get article(): Article | null {
    return this.source
  }

  /** Word count and opening words, enough to tell whether Read on found anything new. */
  get fingerprint(): string | null {
    return this.ready ? fingerprintOf(this.doc) : null
  }

  get wordMap(): WordMap | null {
    return this.ready ? this.map : null
  }

  get bySentence(): boolean {
    return this.store?.getSettings().chunk === 'sentence'
  }

  /** Throws ImportError when the page has no article. Disposes itself on every outcome but 'started'. */
  async start(): Promise<ToggleResult> {
    try {
      return await this.begin()
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  private async begin(): Promise<ToggleResult> {
    const { win } = this
    const page = win.document
    this.bar = this.options.mountBar(this.actions)
    this.bar.notice('Reading page')
    await nextFrame(win)
    const store = await ExtensionStore.load()
    this.store = store
    if (this.gone()) return this.stopped()

    const article = extractArticle(page, [])
    const doc = parse(article.text)
    await nextFrame(win)
    if (this.gone()) return this.stopped()

    const map = WordMap.build(doc, page.body ?? page.documentElement)
    const start = map.coverage < MIN_COVERAGE ? null : viewportStart(doc, map, win)
    if (!start) {
      this.dispose()
      return { kind: 'fallback', article: { ...article, startParagraph: this.fallbackParagraph(doc) }, coverage: map.coverage }
    }
    const place = await store.place(this.key)
    if (this.gone()) return this.stopped()

    this.source = article
    this.doc = doc
    this.map = map
    this.prefix = this.pace(store.getSettings())
    const again = this.after === fingerprintOf(doc)
    this.index = again ? doc.words.length - 1 : startFrom(doc, start.from, place, start.at)
    this.from = start.from
    this.resetRead(this.index)
    this.marks = Marks.mount(page)
    this.follow = Follow.attach(win, this.onUserScroll)
    this.unsubscribe = store.subscribe(this.onSettings)
    this.detachers = [attachKeys(win, this), attachClicks(page, this)]
    this.ready = true
    if (again) this.waitAtEnd()
    else this.play()
    return { kind: 'started' }
  }

  private gone(): boolean {
    return this.disposed || !chrome.runtime?.id
  }

  private stopped(): ToggleResult {
    this.dispose()
    return { kind: 'stopped' }
  }

  private fallbackParagraph(doc: Doc): number {
    const { win } = this
    if (win.scrollY <= 0) return 0
    const blocks = doc.paragraphs.map((p) => ({
      text: doc.words.slice(p.start, p.end).map((w) => w.text).join(' '),
      level: p.heading,
    }))
    return matchParagraph(blocks, openingsAtTop(win.document, win.innerHeight * HEADER_STRIP))
  }

  // The parsed map holds 74,000 words for the life of the page, so parse it per prefix and let it go.
  private pace({ pauses, smart }: Settings): Float64Array {
    this.paced = { pauses, smart }
    return weightPrefix(this.doc, { pauses, smart, freq: smart ? parseFrequency(raw) : null })
  }

  private settings(): Settings {
    return this.store!.getSettings()
  }

  private onSettings = () => {
    if (!this.ready) return
    const settings = this.settings()
    if (settings.pauses !== this.paced.pauses || settings.smart !== this.paced.smart) this.prefix = this.pace(settings)
    this.render()
  }

  private onUserScroll = () => {
    this.userScrolled = true
    if (this.isPlaying) this.pause()
  }

  private readonly actions: BarActions = {
    toggle: () => this.toggle(),
    slower: () => this.nudgeWpm(-WPM_STEP),
    faster: () => this.nudgeWpm(WPM_STEP),
    cycleChunk: () => this.cycleChunk(),
    seek: (fraction) => this.seek(fraction),
    openTab: () => this.options.openTab(),
    readOn: () => this.options.readOn(),
    close: () => void this.stop('close'),
  }

  play(): void {
    if (!this.ready || this.isPlaying) return
    if (this.finished) {
      this.finished = false
      this.index = 0
      this.resetRead(0)
    }
    if (this.userScrolled) {
      this.userScrolled = false
      const active = this.map.rangeOf(this.chunk.start, this.chunk.end)
      const start = active && inView(active) ? null : viewportStart(this.doc, this.map, this.win)
      if (start && start.from !== PAST_END) {
        this.index = start.at
        this.from = start.from
        this.resetRead(start.at)
      }
    }
    this.isPlaying = true
    this.notice = null
    this.sincePlay = 0
    this.lineAt = -1
    this.coveredRun = 0
    this.run(1)
  }

  pause(notice: Notice | null = null): void {
    if (!this.ready) return
    this.isPlaying = false
    this.clearTimer()
    this.notice = notice
    this.render()
  }

  toggle(): void {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  /** Moves to word i, or the nearest word the page shows in the direction of travel. */
  jump(i: number, dir: 1 | -1 = 1): void {
    if (!this.ready) return
    this.index = Math.min(this.doc.words.length - 1, Math.max(0, i))
    if (this.index < this.readFrom) this.resetRead(this.index)
    this.finished = false
    this.sincePlay = 0
    this.clearTimer()
    this.run(dir)
  }

  prevWord(): void {
    this.jump(this.index - 1, -1)
  }

  nextChunk(): void {
    this.jump(this.chunk.end, 1)
  }

  prevSentence(): void {
    if (this.ready) this.jump(prevSentenceTarget(this.doc, this.index, this.isPlaying), -1)
  }

  nextSentence(): void {
    if (this.ready) this.jump(nextSentenceTarget(this.doc, this.index), 1)
  }

  seek(fraction: number): void {
    if (this.ready) this.jump(Math.round(fraction * (this.doc.words.length - 1)))
  }

  setWpm(wpm: number): void {
    this.store?.updateSettings({ wpm: clampWpm(wpm) })
  }

  nudgeWpm(delta: number): void {
    if (this.store) this.setWpm(this.settings().wpm + delta)
  }

  cycleChunk(): void {
    if (!this.store) return
    const at = CHUNK_ORDER.indexOf(this.settings().chunk)
    this.store.updateSettings({ chunk: CHUNK_ORDER[(at + 1) % CHUNK_ORDER.length] })
  }

  /** Swaps in a fresh map of the page, for when the page re-rendered the text. */
  rebuildMap(): WordMap | null {
    if (!this.ready) return null
    this.map = this.map.rebuild()
    this.lineAt = -1
    this.resetRead(this.readFrom)
    return this.map
  }

  /** Saves the place against the paragraph now in view, so the next press from here resumes this word. */
  async stop(reason: StopReason): Promise<{ index: number; from: number }> {
    if (!this.ready) {
      this.dispose()
      return { index: this.index, from: this.from }
    }
    const from = viewportStart(this.doc, this.map, this.win)?.from ?? 0
    const index = this.index
    this.store!.setPlace(this.key, { index, words: this.doc.words.length, from })
    const saved = this.store!.flush()
    this.dispose()
    // The page is going away, so start the save but do not hold up the unload for it.
    if (reason !== 'pagehide') await saved
    return { index, from }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.isPlaying = false
    this.clearTimer()
    this.unsubscribe()
    for (const detach of this.detachers) detach()
    if (this.ready) {
      this.follow.dispose()
      this.marks.dispose()
    }
    this.ready = false
    this.bar.dispose()
    this.store?.dispose()
    this.options.ended()
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  private step = () => {
    this.timer = null
    if (this.isPlaying) this.run(1)
  }

  private advance = () => {
    this.timer = null
    this.sincePlay += 1
    if (this.chunk.end >= this.doc.words.length) {
      this.finish()
      return
    }
    this.index = this.chunk.end
    this.step()
  }

  private run(dir: 1 | -1) {
    try {
      if (!this.show(dir) || !this.isPlaying) return
      const { wpm, chunk } = this.settings()
      this.timer = setTimeout(this.advance, chunkDelayMs(this.prefix, this.chunk, wpm, chunk, this.sincePlay))
    } catch (error) {
      console.error(error)
      this.pause(FAILED)
    }
  }

  private finish() {
    this.finished = true
    this.pause(END)
  }

  private waitAtEnd() {
    this.run(1)
    this.finished = true
    this.pause(NOTHING_NEW)
  }

  /** The first word from i in the direction of travel that the page shows, or -1 past the last one. */
  private shownFrom(i: number, dir: 1 | -1): number {
    for (let j = i; j >= 0 && j < this.doc.words.length; j += dir) if (this.map.blockOf(j) >= 0) return j
    return dir === -1 ? this.shownFrom(i, 1) : -1
  }

  private withRects(i: number, dir: 1 | -1): number {
    const { words } = this.doc
    const para = words[i].para
    for (let j = i; j >= 0 && j < words.length && words[j].para === para; j += dir) if (this.map.hasRects(j)) return j
    return -1
  }

  /** Highlights the chunk at the index, scrolling to it on a new line, and saves the place. False when it paused instead. */
  private show(dir: 1 | -1): boolean {
    const { doc, map } = this
    const shown = this.shownFrom(this.index, dir)
    if (shown < 0) {
      this.finish()
      return false
    }
    if (!map.isLive(shown, shown + 1)) return this.remap(dir)
    const i = map.hasRects(shown) ? shown : this.withRects(shown, dir)
    if (i < 0) {
      this.pause(LOST)
      return false
    }
    const chunk = chunkAt(doc, i, this.settings().chunk, (j) => (map.sameLine(i, j) ? 0 : 1))
    if (!map.isLive(chunk.start, chunk.end)) return this.remap(dir)
    this.index = i
    this.chunk = chunk
    const range = map.rangeOf(this.chunk.start, this.chunk.end)
    if (!range) {
      this.pause(LOST)
      return false
    }
    this.marks.show(range, map.toneOf(i), this.readRuns(i))
    if (this.lineAt < 0 || !map.sameLine(this.lineAt, i)) {
      this.lineAt = i
      this.follow.toLine(range, this.checkCovered)
    }
    this.render()
    this.store!.setPlace(this.key, { index: i, words: doc.words.length, from: this.from })
    return true
  }

  /** The page replaced the text, so map it again once the throttle allows, keeping the index where it is until then. */
  private remap(dir: 1 | -1): boolean {
    if (!this.map.canRebuild()) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.run(dir)
      }, this.map.nextRebuildIn())
      return false
    }
    this.rebuildMap()
    if (this.map.coverageFrom(this.index) < MIN_COVERAGE) {
      this.pause(CHANGED)
      return false
    }
    return this.show(dir)
  }

  private checkCovered = () => {
    if (!this.isPlaying) return
    const range = this.map.rangeOf(this.chunk.start, this.chunk.end)
    if (!range || !this.map.covered(range)) {
      this.coveredRun = 0
      return
    }
    if (this.coveredRun++ >= COVERED_SKIPS) {
      this.pause(COVERED)
      return
    }
    const block = this.map.blockOf(this.chunk.start)
    for (let j = this.chunk.end; j < this.doc.words.length; j++) {
      const next = this.map.blockOf(j)
      if (next >= 0 && next !== block) {
        this.jump(j)
        return
      }
    }
    this.finish()
  }

  private resetRead(from: number) {
    this.readFrom = from
    this.runs = []
    this.runsTo = from
  }

  /** Words read since this reading started, as one range per run of blocks with the same tone. */
  private readRuns(upTo: number): ToneRun[] {
    if (upTo < this.runsTo) this.resetRead(this.readFrom)
    for (let i = this.runsTo; i < upTo; i++) {
      if (this.map.blockOf(i) < 0) continue
      const tone = this.map.toneOf(i)
      const last = this.runs.at(-1)
      if (last?.tone === tone) last.end = i + 1
      else this.runs.push({ tone, start: i, end: i + 1 })
    }
    this.runsTo = Math.max(this.runsTo, upTo)
    return this.runs.flatMap(({ tone, start, end }) => {
      const range = this.map.rangeOf(start, end)
      return range ? [{ tone, range }] : []
    })
  }

  private render() {
    if (!this.ready) return
    const { wpm, chunk } = this.settings()
    const n = this.doc.words.length
    this.bar.render({
      playing: this.isPlaying,
      wpm,
      chunk,
      progress: n > 1 ? this.index / (n - 1) : 0,
      left: (this.prefix[n] - this.prefix[this.index]) * msPerWord(wpm),
      notice: this.notice,
    })
  }
}
