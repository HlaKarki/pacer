import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { Window } from 'happy-dom'
import { parse } from '../../src/lib/text'
import { MIN_COVERAGE, WordMap } from './map'
import { InPageSession, type BarActions, type BarState, type LineBox, type SessionOptions, type ToggleResult } from './session'

const window = new Window({ url: 'https://example.com/essay#intro' })
globalThis.Node = window.Node as unknown as typeof Node
const document = window.document as unknown as Document
const win = window as unknown as Window
const RangeProto = window.Range.prototype as unknown as Range
const root = document.documentElement
const HEIGHT = 800
const LINE = 20
const CHARS_PER_LINE = 60
const KEY = 'place:https://example.com/essay'

const para = (n: number) =>
  `Paragraph ${n} opens with its number, and then it keeps going long enough that a reader-view parser treats it as body text worth keeping in the article.`
const PARAGRAPHS = 12
const topOfPara = (n: number) => 100 + (n - 1) * 200

// happy-dom has no layout, so each block carries its page top in data-top and wraps every 60 characters.
const hiddenParas = new Set<number>()
const lineTop = (node: Node, offset: number) => {
  const block = (node.parentElement as HTMLElement).closest<HTMLElement>('[data-top]')
  return Number(block?.dataset.top ?? 0) + Math.floor(offset / CHARS_PER_LINE) * LINE - root.scrollTop
}
const paraOf = (node: Node) => Number((node.parentElement as HTMLElement).closest<HTMLElement>('[data-para]')?.dataset.para ?? -1)
const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100 }) as DOMRect

class FakeHighlight extends Set<Range> {
  priority = 0
  constructor(...ranges: Range[]) {
    super(ranges)
  }
}

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
let data: Record<string, unknown>
let writes: Record<string, unknown>[]
let listeners: Set<Listener>
let registry: Map<string, FakeHighlight>
let frames: FrameRequestCallback[]
let covering: (y: number) => boolean

function page(extra = '') {
  document.title = 'How Eyes Read'
  const paras = Array.from({ length: PARAGRAPHS }, (_, k) => {
    const n = k + 1
    return `<p data-top="${topOfPara(n)}" data-para="${n}">${para(n)}</p>`
  }).join('')
  document.body.innerHTML = `<article><h1 data-top="0">How Eyes Read</h1>${paras}</article><div id="wall"></div>${extra}`
}

beforeEach(() => {
  data = {}
  writes = []
  listeners = new Set()
  registry = new Map()
  frames = []
  covering = () => false
  hiddenParas.clear()
  Object.assign(globalThis, {
    chrome: {
      runtime: { id: 'pacer' },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: data[key] }),
          set: async (entries: Record<string, unknown>) => {
            writes.push(entries)
            Object.assign(data, entries)
          },
        },
        onChanged: {
          addListener: (listener: Listener) => listeners.add(listener),
          removeListener: (listener: Listener) => listeners.delete(listener),
        },
      },
    },
    CSS: { highlights: registry },
    Highlight: FakeHighlight,
  })
  Object.defineProperty(window, 'innerHeight', { value: HEIGHT, configurable: true })
  Object.defineProperty(root, 'scrollHeight', { value: 10000, configurable: true })
  Object.defineProperty(root, 'clientHeight', { value: HEIGHT, configurable: true })
  root.scrollTop = 0
  win.requestAnimationFrame = (callback) => frames.push(callback)
  win.cancelAnimationFrame = () => {}
  win.matchMedia = () => ({ matches: true }) as MediaQueryList
  document.elementsFromPoint = (_x, y) => [covering(y) ? document.getElementById('wall')! : document.body]
  RangeProto.getClientRects = function (this: Range) {
    if (hiddenParas.has(paraOf(this.startContainer))) return [] as unknown as DOMRectList
    const top = lineTop(this.startContainer, this.startOffset)
    return [rect(top, top + LINE)] as unknown as DOMRectList
  }
  RangeProto.getBoundingClientRect = function (this: Range) {
    return rect(lineTop(this.startContainer, this.startOffset), lineTop(this.endContainer, Math.max(0, this.endOffset - 1)) + LINE)
  }
  jest.useFakeTimers()
})

// Sessions listen on the shared window, so one a test left running would take the next test's keys.
const sessions: InPageSession[] = []

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose()
  jest.useRealTimers()
  for (const name of ['getClientRects', 'getBoundingClientRect'] as const) delete (RangeProto as Partial<Range>)[name]
  for (const name of ['chrome', 'CSS', 'Highlight']) Reflect.deleteProperty(globalThis, name)
})

const flush = async () => {
  for (let k = 0; k < 30; k++) await Promise.resolve()
}
const runFrames = () => {
  const due = frames
  frames = []
  for (const callback of due) callback(0)
}
const advance = async (ms: number) => {
  jest.advanceTimersByTime(ms)
  await flush()
}

function fakeBar() {
  const bar = { states: [] as BarState[], notices: [] as string[], lines: [] as (LineBox | null)[], disposed: false, actions: null as BarActions | null }
  const mountBar = (actions: BarActions) => {
    bar.actions = actions
    return {
      render: (state: BarState) => void bar.states.push(state),
      notice: (text: string) => void bar.notices.push(text),
      keepClear: (line: LineBox | null) => void bar.lines.push(line),
      dispose: () => void (bar.disposed = true),
    }
  }
  return { bar, mountBar }
}

async function begin(options: SessionOptions = {}) {
  const { bar, mountBar } = fakeBar()
  let ended = 0
  const session = new InPageSession({ win, mountBar, ended: () => ended++, ...options })
  sessions.push(session)
  let result: ToggleResult | undefined
  let failure: unknown
  session.start().then(
    (r) => (result = r),
    (e) => (failure = e),
  )
  for (let k = 0; k < 20 && !result && !failure; k++) await advance(100)
  if (failure) throw failure
  return { session, result: result!, bar, ended: () => ended }
}

const PLAY: SessionOptions = { autoplay: true }
const ARMED = { text: 'Press Space or Play to start' }

const SR_ONLY = ' <span style="overflow: hidden; width: 1px; height: 1px">Skip to content.</span>'

const nowRange = () => [...(registry.get('pacer-now-light') ?? [])].find((r) => !r.collapsed)
const nowText = () => String(nowRange() ?? '')
const nowPara = () => paraOf(nowRange()!.startContainer)
const readText = () => [...(registry.get('pacer-read-light') ?? [])].map(String).join('|')
const lastState = (bar: { states: BarState[] }) => bar.states.at(-1)!
const docOf = (session: InPageSession) => parse(session.article!.text)

describe('InPageSession', () => {
  test('arms at the paragraph in view without scrolling, and the first Play glides its line to the band', async () => {
    page()
    root.scrollTop = 1000
    const { session, result, bar } = await begin()
    expect(result).toEqual({ kind: 'started' })
    expect(bar.notices).toEqual(['Reading page'])
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 6])
    expect(root.scrollTop).toBe(1000)
    expect(lastState(bar)).toMatchObject({ playing: false, wpm: 300, chunk: 1, notice: ARMED })
    expect(session.playing).toBe(false)
    const n = docOf(session).words.length
    expect(data[KEY]).toBeUndefined()
    await advance(1000)
    expect(data[KEY]).toEqual({ index: Math.round(lastState(bar).progress * (n - 1)), words: n, from: 6 })
    expect(nowText()).toBe('Paragraph')
    session.play()
    expect(root.scrollTop).toBeCloseTo(topOfPara(6) - HEIGHT * 0.36, 6)
    expect(lastState(bar)).toMatchObject({ playing: true, notice: null })
    expect(session.playing).toBe(true)
    session.dispose()
  })

  test('scrolls an armed start into view only when it is off screen', async () => {
    page()
    root.scrollTop = 1000
    const first = await begin()
    const doc = docOf(first.session)
    const { from } = await first.session.stop('esc')
    data[KEY] = { index: doc.paragraphs[10].start, words: doc.words.length, from }
    const { session, bar } = await begin()
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 10])
    expect(root.scrollTop).toBeCloseTo(topOfPara(10) - HEIGHT * 0.36, 6)
    expect(lastState(bar)).toMatchObject({ playing: false, notice: ARMED })
    session.dispose()
  })

  test('starts an armed reading on Space, on Play and at a clicked word, and arrows move it without starting', async () => {
    page()
    root.scrollTop = 1000
    const space = await begin()
    space.session.nextChunk()
    expect([nowText(), space.session.playing, lastState(space.bar).notice]).toEqual(['6', false, ARMED])
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }) as unknown as Event)
    expect([space.session.playing, lastState(space.bar).notice]).toEqual([true, null])
    space.session.dispose()

    const play = await begin()
    play.bar.actions!.toggle()
    expect([play.session.playing, lastState(play.bar).notice]).toEqual([true, null])
    play.session.dispose()

    const click = await begin()
    const target = document.querySelector('[data-para="7"]')!.firstChild!
    document.caretPositionFromPoint = () => ({ offsetNode: target, offset: 0 }) as CaretPosition
    const word = document.createRange()
    word.setStart(target, 0)
    const { left, top } = word.getClientRects()[0]
    document.querySelector('[data-para="7"]')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, button: 0, clientX: left + 1, clientY: top + 1 }) as unknown as Event)
    expect([nowText(), nowPara(), click.session.playing]).toEqual(['Paragraph', 7, true])
    expect(lastState(click.bar).notice).toBeNull()
    click.session.dispose()
  })

  test('plays on the press with Start on press, and on Read on', async () => {
    page()
    data.settings = { autoStart: true }
    const pressed = await begin()
    expect([pressed.session.playing, lastState(pressed.bar).notice]).toEqual([true, null])
    pressed.session.dispose()
    data.settings = { autoStart: false }
    const readOn = await begin(PLAY)
    expect([readOn.session.playing, lastState(readOn.bar).notice]).toEqual([true, null])
    readOn.session.dispose()
  })

  test('paces on through the paragraph, dims what it read and saves the place while playing', async () => {
    page()
    root.scrollTop = 1000
    const { session } = await begin(PLAY)
    const start = docOf(session).paragraphs[6].start
    await advance(1500)
    expect(nowPara()).toBe(6)
    expect(nowText()).not.toBe('Paragraph')
    expect(para(6).startsWith(`${readText()} ${nowText()}`)).toBe(true)
    const saved = data[KEY] as { index: number; from: number }
    expect(saved.from).toBe(6)
    expect(saved.index).toBeGreaterThan(start)
    session.dispose()
  })

  test('never highlights words the page hides', async () => {
    page()
    document.querySelector('[data-para="1"]')!.insertAdjacentHTML('beforeend', SR_ONLY)
    const { session, bar } = await begin(PLAY)
    await advance(12000)
    const doc = docOf(session)
    const n = doc.words.length
    const shown = new Set(bar.states.map((state) => Math.round(state.progress * (n - 1))))
    const end = doc.paragraphs[1].end
    const hidden = [end - 3, end - 2, end - 1]
    expect(hidden.map((i) => doc.words[i].text)).toEqual(['Skip', 'to', 'content.'])
    expect(hidden.filter((i) => shown.has(i))).toEqual([])
    expect(shown.has(end - 4)).toBe(true)
    expect(shown.has(end)).toBe(true)
    session.dispose()
  })

  test('hands the article to the reader tab when the page shows too little of it', async () => {
    page()
    for (const p of document.querySelectorAll('article p')) (p as HTMLElement).style.cssText = 'opacity: 0'
    const { result, bar, ended } = await begin()
    expect(result.kind).toBe('fallback')
    if (result.kind !== 'fallback') return
    expect(WordMap.build(parse(result.article.text), document.body as unknown as Element).coverage).toBeLessThan(MIN_COVERAGE)
    expect(result.article.title).toBe('How Eyes Read')
    expect(result.article.startParagraph).toBe(0)
    expect(result.article.text).toContain('Paragraph 12 opens')
    expect(bar.disposed).toBe(true)
    expect(registry.size).toBe(0)
    expect(listeners.size).toBe(0)
    expect(ended()).toBe(1)
  })

  test('stops quietly when the extension goes away while it starts', async () => {
    page()
    ;(globalThis as unknown as { chrome: { runtime: object } }).chrome.runtime = {}
    const { result, bar } = await begin()
    expect(result).toEqual({ kind: 'stopped' })
    expect(bar.disposed).toBe(true)
    expect(listeners.size).toBe(0)
  })

  test('skips two covered blocks and then pauses with the tab on offer', async () => {
    page()
    root.scrollTop = 1000
    covering = () => true
    const { session, bar } = await begin(PLAY)
    runFrames()
    expect(nowPara()).toBe(7)
    runFrames()
    expect(nowPara()).toBe(8)
    expect(session.playing).toBe(true)
    runFrames()
    expect(session.playing).toBe(false)
    expect(lastState(bar).notice).toEqual({ text: 'Something on the page covers the text', action: 'openTab' })
  })

  test('pauses at once and keeps its place when a dialog opens over the text', async () => {
    page()
    root.scrollTop = 1000
    document.getElementById('wall')!.setAttribute('role', 'dialog')
    covering = () => true
    const { session, bar } = await begin(PLAY)
    runFrames()
    expect(nowPara()).toBe(6)
    expect(nowText()).toBe('Paragraph')
    expect(session.playing).toBe(false)
    expect(lastState(bar).notice).toEqual({ text: 'Something on the page covers the text', action: 'openTab' })
  })

  test('pauses with the tab on offer instead of saying the page ended when nothing after a covered line is mapped', async () => {
    page()
    const { session, bar } = await begin(PLAY)
    covering = () => true
    session.jump(docOf(session).paragraphs[12].start)
    runFrames()
    expect(session.playing).toBe(false)
    expect(lastState(bar).notice).toEqual({ text: 'Something on the page covers the text', action: 'openTab' })
  })

  test('reads on after one covered caption', async () => {
    page()
    root.scrollTop = 1000
    covering = () => nowPara() === 6
    const { session } = await begin(PLAY)
    runFrames()
    expect(nowPara()).toBe(7)
    runFrames()
    expect(nowPara()).toBe(7)
    expect(session.playing).toBe(true)
    session.dispose()
  })

  test('pauses when the next paragraph has no box on screen', async () => {
    page()
    root.scrollTop = 1000
    const { session, bar } = await begin(PLAY)
    hiddenParas.add(7)
    session.jump(docOf(session).paragraphs[7].start)
    expect(session.playing).toBe(false)
    expect(lastState(bar).notice).toEqual({ text: 'Pacer lost its place', action: 'openTab' })
    session.dispose()
  })

  test('holds its place while the page re-renders twice and carries on from the next word', async () => {
    page()
    root.scrollTop = 1000
    const { session, bar } = await begin(PLAY)
    const rerender = async () => {
      const map = session.wordMap
      const end = nowRange()!.endOffset
      const article = document.querySelector('article')!
      article.replaceWith(article.cloneNode(true))
      const at = Date.now()
      for (let k = 0; k < 40 && session.wordMap === map; k++) await advance(50)
      expect(session.wordMap).not.toBe(map)
      expect(nowRange()!.startContainer.isConnected).toBe(true)
      expect(nowPara()).toBe(6)
      expect(nowRange()!.startOffset - end).toBeWithin(0, 2)
      return Date.now() - at
    }
    await advance(300)
    await rerender()
    expect(await rerender()).toBeGreaterThanOrEqual(1000)
    expect(session.playing).toBe(true)
    expect(lastState(bar).notice).toBeNull()
    session.dispose()
  })

  test('pauses with the tab on offer when the re-rendered page shows little of the article', async () => {
    page()
    root.scrollTop = 1000
    const { session, bar } = await begin(PLAY)
    document.querySelector('article')!.innerHTML = `<p data-top="100">${para(1)}</p>`
    await advance(1500)
    expect(session.playing).toBe(false)
    expect(lastState(bar).notice).toEqual({ text: 'This page changed', action: 'openTab' })
    session.dispose()
  })

  test('stops with the place saved against the paragraph in view and resumes that word next time', async () => {
    page()
    root.scrollTop = 1000
    const first = await begin(PLAY)
    await advance(1500)
    const word = nowText()
    const offset = nowRange()!.startOffset
    const writesBefore = writes.length
    const { index, from } = await first.session.stop('esc')
    expect(data[KEY]).toEqual({ index, words: docOf(first.session).words.length, from })
    expect(writes.length).toBe(writesBefore + 1)
    expect(registry.size).toBe(0)
    expect(listeners.size).toBe(0)
    expect(first.bar.disposed).toBe(true)
    expect(first.ended()).toBe(1)
    const states = first.bar.states.length
    await advance(3000)
    expect(first.bar.states.length).toBe(states)

    const second = await begin()
    expect([nowText(), nowRange()!.startOffset, nowPara()]).toEqual([word, offset, 6])
    second.session.dispose()
  })

  test('stops with the place saved when the page goes to another path, and not for a hash change', async () => {
    page()
    root.scrollTop = 1000
    const navigation = new EventTarget()
    Object.defineProperty(win, 'navigation', { value: navigation, configurable: true })
    const navigate = (url: string) => {
      Object.assign(navigation, { currentEntry: { url } })
      navigation.dispatchEvent(new Event('currententrychange'))
    }
    const { session, bar, ended } = await begin(PLAY)
    navigate('https://example.com/essay#s1')
    expect(session.playing).toBe(true)
    const writesBefore = writes.length
    navigate('https://example.com/next')
    await flush()
    expect(ended()).toBe(1)
    expect(bar.disposed).toBe(true)
    expect(registry.size).toBe(0)
    expect(writes.length).toBe(writesBefore + 1)
    expect(writes.at(-1)).toHaveProperty([KEY])
    Reflect.deleteProperty(win, 'navigation')
  })

  test('pauses and saves the place when the tab is hidden, and stops when the page unloads', async () => {
    page()
    root.scrollTop = 1000
    const { session, ended } = await begin(PLAY)
    await advance(1500)
    session.nextChunk()
    const writesBefore = writes.length
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event)
    await flush()
    expect(session.playing).toBe(false)
    expect(writes.length).toBe(writesBefore + 1)
    Reflect.deleteProperty(document, 'visibilityState')
    win.dispatchEvent(new window.Event('pagehide') as unknown as Event)
    await flush()
    expect(ended()).toBe(1)
    expect(registry.size).toBe(0)
  })

  test('leaves without saving on its next tick once the extension has reloaded', async () => {
    page()
    root.scrollTop = 1000
    const { bar, ended } = await begin(PLAY)
    const writesBefore = writes.length
    ;(globalThis as unknown as { chrome: { runtime: { id?: string } } }).chrome.runtime.id = undefined
    await advance(1000)
    expect(ended()).toBe(1)
    expect(bar.disposed).toBe(true)
    expect(registry.size).toBe(0)
    await advance(3000)
    expect(writes.length).toBe(writesBefore)
  })

  test('keeps the saved paragraph in step with the page while playing, so a press after an extension reload resumes the word', async () => {
    page()
    root.scrollTop = 1000
    const first = await begin(PLAY)
    for (let k = 0; k < 200 && nowPara() < 8; k++) {
      await advance(100)
      runFrames()
    }
    await advance(1500)
    runFrames()
    expect(nowPara()).toBe(8)
    const runtime = (globalThis as unknown as { chrome: { runtime: { id?: string } } }).chrome.runtime
    runtime.id = undefined
    await advance(1000)
    expect(first.ended()).toBe(1)
    runtime.id = 'pacer'
    const saved = data[KEY] as { index: number; from: number }
    const second = await begin()
    const n = docOf(second.session).words.length
    expect(Math.round(lastState(second.bar).progress * (n - 1))).toBe(saved.index)
    second.session.dispose()
  })

  test('saves the paragraph in view when the tab is hidden after the page scrolled on', async () => {
    page()
    root.scrollTop = 1000
    const { session } = await begin(PLAY)
    for (let k = 0; k < 200 && nowPara() < 8; k++) await advance(100)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event)
    await flush()
    Reflect.deleteProperty(document, 'visibilityState')
    expect((data[KEY] as { from: number }).from).toBe(7)
    session.dispose()
  })

  test('pauses on a wheel and picks up at the paragraph in view once the line has left the screen', async () => {
    page()
    root.scrollTop = 1000
    const { session } = await begin(PLAY)
    document.querySelector('[data-para="6"]')!.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    expect(session.playing).toBe(false)
    root.scrollTop = 1600
    session.play()
    expect(nowText()).toBe('Paragraph')
    expect(nowPara()).toBe(9)
    await advance(1000)
    expect((data[KEY] as { from: number }).from).toBe(9)
    session.dispose()
  })

  test('leaves page text the article skips, like a sidebar between paragraphs, out of the read dimming', async () => {
    page()
    document.querySelector('[data-para="2"]')!.insertAdjacentHTML(
      'beforebegin',
      '<aside class="sidebar" data-top="250"><p>Subscribe today and get every new essay in your inbox, along with our weekly reading list.</p></aside>',
    )
    const promo = document.querySelector('aside p')!.firstChild!
    const { session } = await begin(PLAY)
    for (let k = 0; k < 40 && nowPara() < 3; k++) await advance(500)
    expect(nowPara()).toBe(3)
    expect(readText()).toContain('Paragraph 2')
    expect([...registry.get('pacer-read-light')!].some((range) => range.intersectsNode(promo))).toBe(false)
    session.dispose()
  })

  test('pauses when a contents link scrolls the page away and picks up at the paragraph in view', async () => {
    page()
    root.scrollTop = 1000
    const { session } = await begin(PLAY)
    await advance(500)
    root.scrollTop = 1600
    document.dispatchEvent(new window.Event('scroll', { bubbles: true }) as unknown as Event)
    expect(session.playing).toBe(false)
    await advance(1000)
    expect(root.scrollTop).toBe(1600)
    session.play()
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 9])
    session.dispose()
  })

  test('saves the paragraph in view as the place when the reader scrolled the line away and stopped', async () => {
    page()
    root.scrollTop = 1000
    const first = await begin(PLAY)
    document.querySelector('[data-para="6"]')!.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    root.scrollTop = 1600
    expect((await first.session.stop('esc')).from).toBe(9)
    const second = await begin()
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 9])
    second.session.dispose()
  })

  test('picks up at the paragraph in view when the page re-rendered while paused and the reader scrolled', async () => {
    page()
    root.scrollTop = 1000
    const { session } = await begin(PLAY)
    document.querySelector('[data-para="6"]')!.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    const article = document.querySelector('article')!
    article.replaceWith(article.cloneNode(true))
    root.scrollTop = 1600
    session.play()
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 9])
    session.dispose()
  })

  test('saves the paragraph in view and resumes the same word when the page re-rendered while paused', async () => {
    page()
    root.scrollTop = 1000
    const first = await begin(PLAY)
    await advance(1500)
    first.session.pause()
    const word = [nowText(), nowRange()!.startOffset]
    const article = document.querySelector('article')!
    article.replaceWith(article.cloneNode(true))
    expect((await first.session.stop('esc')).from).toBe(5)
    const second = await begin()
    expect([nowText(), nowRange()!.startOffset, nowPara()]).toEqual([...word, 6])
    second.session.dispose()
  })

  test('carries on from the same word when the line is still on screen after a wheel', async () => {
    page()
    root.scrollTop = 1000
    const { session } = await begin(PLAY)
    await advance(1000)
    const word = nowText()
    document.querySelector('[data-para="6"]')!.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    root.scrollTop += 100
    session.play()
    expect(nowText()).toBe(word)
    expect(nowPara()).toBe(6)
    session.dispose()
  })

  test('pauses at the end with Read on, and play starts over from the top', async () => {
    page()
    const { session, bar } = await begin(PLAY)
    session.seek(1)
    expect(nowText()).toBe('article.')
    await advance(2000)
    expect(session.playing).toBe(false)
    expect(lastState(bar).notice).toEqual({ text: 'End of the page', action: 'readOn' })
    session.play()
    expect(nowText()).toBe('How')
    session.dispose()
  })

  test('Read on waits at the end when the page has nothing new, and reads from the band when it grew', async () => {
    page()
    const first = await begin(PLAY)
    const fingerprint = first.session.fingerprint!
    first.session.seek(1)
    await advance(2000)
    await first.session.stop('close')
    const same = await begin({ after: fingerprint, autoplay: true })
    expect(same.session.playing).toBe(false)
    expect(nowText()).toBe('article.')
    expect(lastState(same.bar).notice).toEqual({ text: "That's the end of this page" })
    expect(lastState(same.bar).progress).toBe(1)
    same.session.play()
    expect(nowText()).toBe('How')
    await same.session.stop('close')

    document.querySelector('article')!.insertAdjacentHTML('beforeend', `<p data-top="${topOfPara(13)}" data-para="13">${para(13)}</p>`)
    root.scrollTop = 1000
    const grown = await begin({ after: fingerprint, autoplay: true })
    expect(grown.session.playing).toBe(true)
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 6])
    grown.session.dispose()
  })

  test('moves by word and sentence, skipping hidden words on the way back', async () => {
    page()
    document.querySelector('[data-para="1"]')!.insertAdjacentHTML('beforeend', SR_ONLY)
    const { session } = await begin(PLAY)
    session.pause()
    const doc = docOf(session)
    const after = doc.paragraphs[2].start
    session.jump(after)
    session.prevWord()
    expect(nowText()).toBe('article.')
    session.nextChunk()
    expect(nowText()).toBe('Paragraph')
    expect(nowPara()).toBe(2)
    session.nextSentence()
    expect(nowPara()).toBe(3)
    session.dispose()
  })

  test('steps back onto the first shown word when the page shows none of the words before it', async () => {
    page()
    document.querySelector('h1')!.remove()
    const { session, bar } = await begin(PLAY)
    session.pause()
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 1])
    session.prevWord()
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 1])
    expect(lastState(bar).notice).toBeNull()
    session.dispose()
  })

  test('dims only what it reads after jumping back to before where this reading started', async () => {
    page()
    root.scrollTop = 1000
    const { session } = await begin(PLAY)
    await advance(1000)
    expect(readText()).not.toBe('')
    session.jump(docOf(session).paragraphs[3].start)
    await advance(1000)
    expect(nowPara()).toBe(3)
    expect(para(3).startsWith(`${readText()} ${nowText()}`)).toBe(true)
    session.dispose()
  })

  test('maps the page again when the page replaced the end of the next chunk', async () => {
    data.settings = { chunk: 'sentence' }
    page()
    root.scrollTop = 1000
    const { session, bar } = await begin(PLAY)
    session.pause()
    ;(document.querySelector('[data-para="7"]')!.firstChild as Text).splitText('Paragraph 7 '.length)
    const map = session.wordMap
    await advance(1000)
    session.jump(docOf(session).paragraphs[7].start)
    expect(session.wordMap).not.toBe(map)
    expect(nowText()).toBe(para(7))
    expect(lastState(bar).notice).toBeNull()
    session.dispose()
  })

  test('scrolls only when the reading moves on to a new line', async () => {
    page()
    root.scrollTop = 1000
    let scrolls = 0
    const scrollTo = root.scrollTo.bind(root)
    root.scrollTo = ((options: ScrollToOptions) => {
      scrolls++
      scrollTo(options)
    }) as typeof root.scrollTo
    const { session } = await begin(PLAY)
    expect(scrolls).toBe(1)
    await advance(1000)
    expect(nowText()).not.toBe('Paragraph')
    expect(nowPara()).toBe(6)
    expect(scrolls).toBe(1)
    session.dispose()
    Reflect.deleteProperty(root, 'scrollTo')
  })

  test('takes the reading keys and clicks only while it reads', async () => {
    page()
    const heard: string[] = []
    const onPage = (e: Event) => void heard.push((e as KeyboardEvent).key)
    document.addEventListener('keydown', onPage)
    const { session } = await begin(PLAY)
    const space = () => document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }) as unknown as Event)
    space()
    expect(session.playing).toBe(false)
    const target = document.querySelector('[data-para="3"]')!.firstChild!
    document.caretPositionFromPoint = () => ({ offsetNode: target, offset: 0 }) as CaretPosition
    const word = document.createRange()
    word.setStart(target, 0)
    const { left, top } = word.getClientRects()[0]
    const click = new window.MouseEvent('click', { bubbles: true, button: 0, clientX: left + 1, clientY: top + 1 })
    document.querySelector('[data-para="3"]')!.dispatchEvent(click as unknown as Event)
    expect([nowText(), nowPara()]).toEqual(['Paragraph', 3])
    await session.stop('esc')
    space()
    expect(heard).toEqual([' '])
    document.removeEventListener('keydown', onPage)
  })

  test('tells the bar where the reading line settled, so the bar can keep clear of it', async () => {
    page()
    Object.defineProperty(root, 'scrollHeight', { value: 2400, configurable: true })
    root.scrollTop = 1600
    const { session, bar } = await begin(PLAY)
    session.pause()
    session.jump(docOf(session).paragraphs[PARAGRAPHS].start)
    runFrames()
    const line = nowRange()!.getBoundingClientRect()
    expect(nowPara()).toBe(PARAGRAPHS)
    expect(bar.lines.at(-1)).toEqual({ top: line.top, bottom: line.bottom })
    expect(line.top).toBeGreaterThan(HEIGHT * 0.5)
    session.dispose()
  })

  test('redraws the highlight at the new chunk size while paused', async () => {
    page()
    root.scrollTop = 1000
    const { session, bar } = await begin(PLAY)
    session.pause()
    expect(nowText()).toBe('Paragraph')
    bar.actions!.cycleChunk()
    expect(nowText()).toBe('Paragraph 6')
    expect(session.playing).toBe(false)
    await advance(2000)
    expect(nowText()).toBe('Paragraph 6')
    session.dispose()
  })

  test('changes speed and chunk size through the shared settings', async () => {
    page()
    const { session, bar } = await begin()
    bar.actions!.faster()
    bar.actions!.cycleChunk()
    await flush()
    expect(data.settings).toEqual({ wpm: 325, chunk: 2 })
    session.setWpm(5000)
    expect((data.settings as { wpm: number }).wpm).toBe(1200)
    session.dispose()
  })
})
