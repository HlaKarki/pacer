import { afterEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { extensionGone, watchNavigation, watchPage } from './lifecycle'

const window = new Window({ url: 'https://example.com/essay#intro' })
const document = window.document as unknown as Document
const win = window as unknown as Window
const KEY = 'https://example.com/essay'

function navigate(target: EventTarget, url: string, downloadRequest: string | null = null) {
  target.dispatchEvent(Object.assign(new Event('navigate'), { destination: { url }, downloadRequest }))
}

function commit(target: EventTarget, url: string) {
  Object.assign(target, { currentEntry: { url } })
  target.dispatchEvent(new Event('currententrychange'))
}

afterEach(() => {
  Reflect.deleteProperty(win, 'navigation')
  Reflect.deleteProperty(document, 'visibilityState')
  Reflect.deleteProperty(globalThis, 'chrome')
})

test('extensionGone is true once the runtime id is gone', () => {
  Object.assign(globalThis, { chrome: { runtime: { id: 'pacer' } } })
  expect(extensionGone()).toBe(false)
  Object.assign(globalThis, { chrome: { runtime: {} } })
  expect(extensionGone()).toBe(true)
})

describe('watchNavigation', () => {
  test('leaves when the address moves to another path or query, and not for hash changes', () => {
    const navigation = new EventTarget()
    Object.defineProperty(win, 'navigation', { value: navigation, configurable: true })
    let left = 0
    const detach = watchNavigation(win, KEY, () => left++)
    commit(navigation, `${KEY}#s1`)
    commit(navigation, KEY)
    expect(left).toBe(0)
    commit(navigation, `${KEY}?page=2`)
    commit(navigation, 'https://example.com/next')
    expect(left).toBe(2)
    detach()
    commit(navigation, 'https://example.com/other')
    expect(left).toBe(2)
  })

  test('keeps reading through mail links and downloads, which start a navigation that never leaves the page', () => {
    const navigation = new EventTarget()
    Object.defineProperty(win, 'navigation', { value: navigation, configurable: true })
    let left = 0
    const detach = watchNavigation(win, KEY, () => left++)
    navigate(navigation, 'mailto:someone@example.com')
    navigate(navigation, 'https://example.com/report.csv')
    navigate(navigation, 'https://example.com/report.pdf', 'report.pdf')
    expect(left).toBe(0)
    detach()
  })

  test('does nothing where the browser has no Navigation API', () => {
    Object.defineProperty(win, 'navigation', { value: undefined, configurable: true })
    expect(() => watchNavigation(win, KEY, () => undefined)()).not.toThrow()
  })
})

describe('watchPage', () => {
  test('reports a hidden tab and a page going away until detached', () => {
    const heard: string[] = []
    const detach = watchPage(win, { hidden: () => heard.push('hidden'), gone: () => heard.push('gone') })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event)
    win.dispatchEvent(new window.Event('pagehide') as unknown as Event)
    expect(heard).toEqual(['hidden', 'gone'])
    detach()
    document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event)
    win.dispatchEvent(new window.Event('pagehide') as unknown as Event)
    expect(heard).toEqual(['hidden', 'gone'])
  })
})
