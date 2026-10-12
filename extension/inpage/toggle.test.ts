import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { ImportError } from '../../src/lib/import/errors'
import type { Article } from '../article'
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
let sent: unknown[]
let reply: () => Promise<unknown>

const ARTICLE: Article = { title: 'How Eyes Read', text: 'Words to read.', startParagraph: 0 }

function fakeSession(options: SessionOptions): Fake {
  let settle: (result: ToggleResult | Error) => void = () => undefined
  const fake: Fake = {
    options,
    stops: [],
    article: ARTICLE,
    fingerprint: `fingerprint ${made.length}`,
    start: () =>
      new Promise((resolve, reject) => {
        settle = (result) => (result instanceof Error ? reject(result) : resolve(result))
      }),
    stop: async (reason) => {
      fake.stops.push(reason)
      options.ended?.()
      return { index: 40, from: 3 }
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
  sent = []
  reply = async () => ({ ok: true })
  const sendMessage = (message: unknown) => {
    sent.push(message)
    return reply()
  }
  Object.assign(globalThis, { CSS: { highlights: registry }, chrome: { runtime: { sendMessage } } })
})

afterEach(() => {
  Toast.dismiss()
  document.documentElement.querySelectorAll('pacer-bar, pacer-toast').forEach((host) => host.remove())
  for (const name of ['CSS', 'chrome']) Reflect.deleteProperty(globalThis, name)
})

async function started(page: ReturnType<typeof createInPage>) {
  const pressed = page.toggle()
  await tick()
  made.at(-1)!.finish({ kind: 'started' })
  await pressed
  return made.at(-1)!
}

const toasts = () => document.documentElement.querySelectorAll('pacer-toast').length

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

  test('answers with the error when the page cannot hold a toast either', async () => {
    const quiet = spyOn(console, 'error').mockImplementation(() => undefined)
    const show = spyOn(Toast, 'show').mockImplementation(() => {
      throw new Error("Failed to execute 'attachShadow' on 'Element'")
    })
    const page = createInPage(win, fakeSession)
    const pressed = page.toggle()
    await tick()
    made[0].finish(new TypeError('boom'))
    expect(await pressed).toEqual({ kind: 'error', message: 'Pacer could not read this page.' })
    show.mockRestore()
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

describe('Open in tab', () => {
  test('stops the session and asks for a tab at the paragraph it stopped on', async () => {
    const session = await started(createInPage(win, fakeSession))
    session.options.openTab!()
    await tick()
    expect(session.stops).toEqual(['tab'])
    expect(sent).toEqual([{ type: 'pacer:open-tab', article: { ...ARTICLE, startParagraph: 3 } }])
    expect(toasts()).toBe(0)
  })

  test('asks the service worker to read the page itself when the bar is pressed before the page is read', async () => {
    const page = createInPage(win, (options) => Object.assign(fakeSession(options), { article: null }))
    const pressed = page.toggle()
    await tick()
    made[0].options.openTab!()
    await tick()
    made[0].finish({ kind: 'stopped' })
    await pressed
    expect(made[0].stops).toEqual(['tab'])
    expect(sent).toEqual([{ type: 'pacer:open-tab', article: null }])
    expect(toasts()).toBe(0)
  })

  test('says so in a toast when no tab opens', async () => {
    const page = createInPage(win, fakeSession)
    reply = async () => ({ ok: false })
    ;(await started(page)).options.openTab!()
    await tick()
    expect(toasts()).toBe(1)
    Toast.dismiss()
    reply = async () => Promise.reject(new Error('Extension context invalidated.'))
    ;(await started(page)).options.openTab!()
    await tick()
    expect(toasts()).toBe(1)
  })

  test('does nothing for a session the page has let go', async () => {
    const page = createInPage(win, fakeSession)
    const old = await started(page)
    await page.toggle()
    old.options.openTab!()
    await tick()
    expect(old.stops).toEqual(['toolbar'])
    expect(sent).toEqual([])
  })
})

describe('Read on', () => {
  test('stops the finished session and starts again, telling the new one what it finished', async () => {
    const page = createInPage(win, fakeSession)
    const first = await started(page)
    first.options.readOn!()
    await tick()
    expect(first.stops).toEqual(['close'])
    expect(made.length).toBe(2)
    expect(made[1].options.after).toBe('fingerprint 0')
    expect(await page.toggle()).toEqual({ kind: 'busy' })
    made[1].finish({ kind: 'started' })
    await tick()
    expect(await page.toggle()).toEqual({ kind: 'stopped' })
    expect(made[1].stops).toEqual(['toolbar'])
  })

  test('asks for a tab when the page it reads on to cannot be mapped', async () => {
    const page = createInPage(win, fakeSession)
    ;(await started(page)).options.readOn!()
    await tick()
    const grown = { ...ARTICLE, text: 'Words to read and more.', startParagraph: 5 }
    made[1].finish({ kind: 'fallback', article: grown, coverage: 0.5 })
    await tick()
    expect(sent).toEqual([{ type: 'pacer:open-tab', article: grown }])
  })
})

test('removeForeign leaves the page’s own highlights', () => {
  registry.set('pacer-now-dark', {}).set('search-hit', {})
  removeForeign(document)
  expect([...registry.keys()]).toEqual(['search-hit'])
})
