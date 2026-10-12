import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { ImportError } from '../../src/lib/import/errors'
import { Toast } from './bar'
import type { SessionOptions, StopReason, ToggleResult } from './session'
import { createInPage, removeForeign, type Session } from './toggle'

const window = new Window({ url: 'https://example.com/essay' })
const document = window.document as unknown as Document
const win = window as unknown as Window

interface Fake extends Session {
  options: SessionOptions
  stops: StopReason[]
  finish(result: ToggleResult | Error): void
}

let made: Fake[]
let registry: Map<string, unknown>

function fakeSession(options: SessionOptions): Fake {
  let settle: (result: ToggleResult | Error) => void = () => undefined
  const fake: Fake = {
    options,
    stops: [],
    start: () =>
      new Promise((resolve, reject) => {
        settle = (result) => (result instanceof Error ? reject(result) : resolve(result))
      }),
    stop: async (reason) => {
      fake.stops.push(reason)
      options.ended?.()
      return { index: 0, from: 0 }
    },
    finish: (result) => settle(result),
  }
  made.push(fake)
  return fake
}

const tick = async () => {
  for (let k = 0; k < 5; k++) await Promise.resolve()
}

beforeEach(() => {
  made = []
  registry = new Map()
  Object.assign(globalThis, { CSS: { highlights: registry } })
})

afterEach(() => {
  Toast.dismiss()
  document.documentElement.querySelectorAll('pacer-bar, pacer-toast').forEach((host) => host.remove())
  Reflect.deleteProperty(globalThis, 'CSS')
})

describe('createInPage', () => {
  test('starts a session on the page and stops it on the next press', async () => {
    const page = createInPage(win, fakeSession)
    const started = page.toggle()
    await tick()
    expect(made.length).toBe(1)
    expect(made[0].options.win).toBe(win)
    made[0].finish({ kind: 'started' })
    expect(await started).toEqual({ kind: 'started' })
    expect(await page.toggle()).toEqual({ kind: 'stopped' })
    expect(made[0].stops).toEqual(['toolbar'])
    const again = page.toggle()
    await tick()
    expect(made.length).toBe(2)
    made[1].finish({ kind: 'started' })
    expect(await again).toEqual({ kind: 'started' })
  })

  test('answers busy while a start is under way', async () => {
    const page = createInPage(win, fakeSession)
    const first = page.toggle()
    await tick()
    expect(await page.toggle()).toEqual({ kind: 'busy' })
    expect(made.length).toBe(1)
    made[0].finish({ kind: 'started' })
    await first
  })

  test('lets a session go once it ends on its own', async () => {
    const page = createInPage(win, fakeSession)
    const first = page.toggle()
    await tick()
    made[0].finish({ kind: 'started' })
    await first
    made[0].options.ended?.()
    const second = page.toggle()
    await tick()
    expect(made.length).toBe(2)
    expect(made[0].stops).toEqual([])
    made[1].finish({ kind: 'started' })
    await second
  })

  test('shows the reason in a toast when the page has no article', async () => {
    const page = createInPage(win, fakeSession)
    const pressed = page.toggle()
    await tick()
    made[0].finish(new ImportError('Pacer found no article text on this page.'))
    expect(await pressed).toEqual({ kind: 'error', message: 'Pacer found no article text on this page.' })
    expect(document.documentElement.querySelectorAll('pacer-toast').length).toBe(1)
    const next = page.toggle()
    await tick()
    expect(document.documentElement.querySelector('pacer-toast')).toBeNull()
    made[1].finish({ kind: 'started' })
    await next
  })

  test('says it could not read the page when something else breaks', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined)
    const page = createInPage(win, fakeSession)
    const pressed = page.toggle()
    await tick()
    made[0].finish(new TypeError('boom'))
    expect(await pressed).toEqual({ kind: 'error', message: 'Pacer could not read this page.' })
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })

  test('clears what a copy from before an extension reload left on the page', async () => {
    document.documentElement.append(document.createElement('pacer-bar'), document.createElement('pacer-toast'))
    registry.set('pacer-now-light', {}).set('pacer-read-dark', {}).set('site-search', {})
    const page = createInPage(win, fakeSession)
    const pressed = page.toggle()
    await tick()
    expect(document.documentElement.querySelectorAll('pacer-bar, pacer-toast').length).toBe(0)
    expect([...registry.keys()]).toEqual(['site-search'])
    made[0].finish({ kind: 'started' })
    await pressed
  })
})

test('removeForeign leaves the page’s own highlights', () => {
  registry.set('pacer-now-dark', {}).set('search-hit', {})
  removeForeign(document)
  expect([...registry.keys()]).toEqual(['search-hit'])
})
