import { afterEach, beforeEach, describe, expect, jest, spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { Bar, Toast } from './bar'
import type { BarActions, BarState } from './session'

const window = new Window({ url: 'https://example.com/essay' })
const document = window.document as unknown as Document
const HostProto = window.HTMLElement.prototype as unknown as HTMLElement
const attachShadow = HostProto.attachShadow

let roots: ShadowRoot[]
let calls: string[]

const actions: BarActions = {
  toggle: () => void calls.push('toggle'),
  slower: () => void calls.push('slower'),
  faster: () => void calls.push('faster'),
  cycleChunk: () => void calls.push('cycleChunk'),
  seek: (fraction) => void calls.push(`seek:${fraction}`),
  openTab: () => void calls.push('openTab'),
  readOn: () => void calls.push('readOn'),
  close: () => void calls.push('close'),
}

const STATE: BarState = { playing: true, wpm: 325, chunk: 'phrase', progress: 0.25, left: 4 * 60_000, notice: null }

beforeEach(() => {
  roots = []
  calls = []
  HostProto.attachShadow = function (this: HTMLElement, init: ShadowRootInit) {
    const root = attachShadow.call(this, init)
    roots.push(root)
    return root
  }
})

afterEach(() => {
  HostProto.attachShadow = attachShadow
  Toast.dismiss()
  document.documentElement.querySelectorAll('pacer-bar, pacer-toast').forEach((host) => host.remove())
})

const inBar = <T extends Element = HTMLElement>(selector: string) => roots[0].querySelector<T>(selector)!
const button = (label: string) => roots[0].querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)!

describe('Bar', () => {
  test('mounts one closed host at the end of the page with its own styles', () => {
    const bar = Bar.mount(actions, document)
    const hosts = document.documentElement.querySelectorAll('pacer-bar')
    expect(hosts.length).toBe(1)
    expect(document.documentElement.lastElementChild).toBe(hosts[0])
    expect(hosts[0].shadowRoot).toBeNull()
    expect(roots[0].mode).toBe('closed')
    const css = [...roots[0].adoptedStyleSheets[0].cssRules].map((rule) => rule.cssText).join('\n')
    expect(css).toContain(':host')
    expect(css).toContain('all: initial !important')
    bar.dispose()
    expect(document.documentElement.querySelector('pacer-bar')).toBeNull()
  })

  test('waits for the first state with its controls dimmed', () => {
    const bar = Bar.mount(actions, document)
    bar.notice('Reading page')
    expect(inBar('.panel').hasAttribute('data-loading')).toBe(true)
    expect(inBar('.notice').textContent).toBe('Reading page')
    bar.render(STATE)
    expect(inBar('.panel').hasAttribute('data-loading')).toBe(false)
    expect(inBar('.panel').hasAttribute('data-notice')).toBe(false)
  })

  test('rises above furniture fixed to the bottom of the window, goes to the top past a third of it, and comes back down', () => {
    const now = spyOn(performance, 'now').mockReturnValue(10_000)
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    document.body.innerHTML = '<div id="cookie" style="position: fixed; bottom: 0"><button>Accept all</button></div><p>Text</p>'
    const banner = document.getElementById('cookie')!
    const box = (top: number, bottom: number, left = 0, right = 1440) => ({ top, bottom, left, right, height: bottom - top, width: right - left }) as DOMRect
    let bannerTop = 788
    banner.getBoundingClientRect = () => box(bannerTop, 900)
    let under: Element[] = [banner.querySelector('button')!]
    document.elementsFromPoint = () => [document.querySelector('pacer-bar')!, ...under, document.body]
    const bar = Bar.mount(actions, document)
    const panel = inBar('.panel')
    panel.getBoundingClientRect = () => box(830, 884, 424, 1016)
    const placed = () => [panel.style.top, panel.style.bottom]
    now.mockReturnValue(11_000)
    bar.render(STATE)
    expect(placed()).toEqual(['', '128px'])
    bannerTop = 500
    now.mockReturnValue(11_500)
    bar.render(STATE)
    expect(placed()).toEqual(['', '128px'])
    now.mockReturnValue(12_000)
    bar.render(STATE)
    expect(placed()).toEqual(['16px', 'auto'])
    under = [document.querySelector('p')!]
    now.mockReturnValue(13_000)
    bar.render(STATE)
    expect(placed()).toEqual(['', ''])
    now.mockRestore()
  })

  test('shows speed, chunk, time left and position', () => {
    const bar = Bar.mount(actions, document)
    bar.render(STATE)
    expect(inBar('.wpm-value').textContent).toBe('325 wpm')
    expect(inBar('.chunk').textContent).toBe('Phrase')
    expect(inBar('.time').textContent).toBe('4 min left')
    expect(inBar('.progress').getAttribute('aria-valuenow')).toBe('25')
    expect(inBar<HTMLElement>('.fill').style.transform).toBe('scaleX(0.25)')
    expect(button('Pause')).toBeTruthy()
    bar.render({ ...STATE, playing: false, chunk: 1 })
    expect(button('Play')).toBeTruthy()
    expect(inBar('.chunk').textContent).toBe('1 word')
  })

  test('sends each control to its action and keeps focus on the page', () => {
    const bar = Bar.mount(actions, document)
    bar.render(STATE)
    for (const label of ['Pause', 'Slower', 'Faster', 'Words at a time', 'Open in a Pacer tab', 'Stop reading']) button(label).click()
    expect(calls).toEqual(['toggle', 'slower', 'faster', 'cycleChunk', 'openTab', 'close'])
    const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true })
    button('Slower').dispatchEvent(down as unknown as Event)
    expect(down.defaultPrevented).toBe(true)
  })

  test('seeks to where the progress line is pressed', () => {
    const bar = Bar.mount(actions, document)
    bar.render(STATE)
    const progress = inBar('.progress')
    progress.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 20 }) as DOMRect
    progress.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 150, bubbles: true }) as unknown as Event)
    expect(calls).toEqual(['seek:0.25'])
  })

  test('shows a notice with its action in place of the position, until a state without one', () => {
    const bar = Bar.mount(actions, document)
    bar.render({ ...STATE, playing: false, notice: { text: 'End of the page', action: 'readOn' } })
    expect(inBar('.panel').hasAttribute('data-notice')).toBe(true)
    expect(inBar('.notice').textContent).toBe('End of the page')
    expect(inBar('.action').textContent).toBe('Read on')
    inBar<HTMLButtonElement>('.action').click()
    bar.render({ ...STATE, notice: { text: 'Pacer lost its place', action: 'openTab' } })
    expect(inBar('.action').textContent).toBe('Open in tab')
    inBar<HTMLButtonElement>('.action').click()
    expect(calls).toEqual(['readOn', 'openTab'])
    bar.render(STATE)
    expect(inBar('.panel').hasAttribute('data-notice')).toBe(false)
    expect(inBar('.panel').hasAttribute('data-action')).toBe(false)
  })
})

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  test('shows one message and takes it away after four seconds', () => {
    Toast.show('Pacer found no article text on this page.', document)
    Toast.show('Pacer could not open its tab', document)
    const hosts = document.documentElement.querySelectorAll('pacer-toast')
    expect(hosts.length).toBe(1)
    expect(roots.at(-1)!.textContent).toBe('Pacer could not open its tab')
    expect(roots.at(-1)!.querySelector('button')).toBeNull()
    jest.advanceTimersByTime(3999)
    expect(document.documentElement.querySelector('pacer-toast')).not.toBeNull()
    jest.advanceTimersByTime(1)
    expect(document.documentElement.querySelector('pacer-toast')).toBeNull()
  })
})
