import { afterAll, beforeAll, beforeEach, describe, expect, mock, setSystemTime, spyOn, test } from 'bun:test'
import type { DocRecord } from './docs'
import type { ToggleResult } from './inpage/session'

// The service worker's chrome APIs run each script's function right here, so the page is this global scope.
const scope = globalThis as unknown as Record<string, unknown>

let records: DocRecord[]
let created: chrome.tabs.CreateProperties[]
let badges: Record<number, { text: string; title: string }>
let injected: string[]
let toggles: number
let toggleResult: ToggleResult
let refuseScripts: boolean
let fileAccess: boolean
let page: { contentType: string; href: string }
let storeFails: boolean
let onMessage: (message: unknown, sender: chrome.runtime.MessageSender, reply: (response: unknown) => void) => unknown

mock.module('./docs', () => ({
  putDoc: async (record: DocRecord) => {
    if (storeFails) throw new Error('QuotaExceededError')
    records.push(record)
  },
}))

const fakeChrome = {
  runtime: {
    getURL: (path: string) => `chrome-extension://pacer/${path}`,
    getManifest: () => ({ action: { default_title: 'Pace this page' } }),
    onMessage: { addListener: (listener: typeof onMessage) => void (onMessage = listener) },
  },
  action: {
    onClicked: { addListener: () => undefined },
    setBadgeText: async ({ tabId, text }: { tabId: number; text: string }) => void ((badges[tabId] ??= { text: '', title: '' }).text = text),
    setBadgeBackgroundColor: async () => undefined,
    setTitle: async ({ tabId, title }: { tabId: number; title: string }) => void ((badges[tabId] ??= { text: '', title: '' }).title = title),
  },
  extension: { isAllowedFileSchemeAccess: async () => fileAccess },
  scripting: {
    insertCSS: async ({ files }: { files: string[] }) => void injected.push(...files),
    executeScript: async ({ func, args, files }: { func?: (...a: unknown[]) => unknown; args?: unknown[]; files?: string[] }) => {
      if (refuseScripts) throw new Error('Cannot access contents of the page.')
      if (files) {
        injected.push(...files)
        if (files.includes('inpage.js')) {
          scope.__pacerInPage = {
            toggle: async () => {
              toggles++
              return toggleResult
            },
          }
        }
        if (files.includes('extract.js')) {
          scope.__pacerExtract = () => ({ ok: true, title: 'How Eyes Read', text: 'Words to read.', startParagraph: 2 })
        }
        return [{}]
      }
      return [{ result: await func!(...(args ?? [])) }]
    },
  },
  tabs: {
    create: async (properties: chrome.tabs.CreateProperties) => void created.push(properties),
    update: async () => undefined,
  },
  storage: { session: { set: async () => undefined } },
}

let paceTab: (tab: chrome.tabs.Tab) => Promise<void>
let now = 1_000_000
const later = (ms = 1000) => setSystemTime((now += ms))
const tabOf = (id: number, url = 'https://example.com/essay') => ({ id, url, index: 3, windowId: 1, title: 'Essay' }) as chrome.tabs.Tab

beforeAll(async () => {
  Object.assign(globalThis, { chrome: fakeChrome })
  await import('./background')
  paceTab = scope.paceTab as typeof paceTab
})

afterAll(() => {
  setSystemTime()
  for (const name of ['chrome', 'paceTab', 'document', 'location', '__pacerInPage', '__pacerExtract']) Reflect.deleteProperty(globalThis, name)
})

beforeEach(() => {
  records = []
  created = []
  badges = {}
  injected = []
  toggles = 0
  toggleResult = { kind: 'started' }
  refuseScripts = false
  fileAccess = true
  storeFails = false
  page = { contentType: 'text/html', href: 'https://example.com/essay' }
  Object.assign(globalThis, { document: page, location: page })
  Reflect.deleteProperty(globalThis, '__pacerInPage')
  later()
})

describe('paceTab', () => {
  test('reads an HTML page in place, injecting the page script and styles once', async () => {
    badges[1] = { text: '!', title: "Pacer can't read this page" }
    await paceTab(tabOf(1))
    expect(injected).toEqual(['inpage.css', 'inpage.js'])
    expect(toggles).toBe(1)
    expect(created).toEqual([])
    expect(badges[1]).toEqual({ text: '', title: 'Pace this page' })
    later()
    await paceTab(tabOf(1))
    expect(injected).toEqual(['inpage.css', 'inpage.js'])
    expect(toggles).toBe(2)
  })

  test('drops a second press that comes right after the first', async () => {
    await paceTab(tabOf(2))
    later(120)
    await paceTab(tabOf(2))
    later(120)
    await paceTab(tabOf(2))
    expect(toggles).toBe(1)
    later(400)
    await paceTab(tabOf(2))
    expect(toggles).toBe(2)
  })

  test('opens the reader tab for a PDF', async () => {
    page.contentType = 'application/pdf'
    const offline = spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('gone', { status: 404 }))
    await paceTab(tabOf(3, 'https://example.com/paper.pdf'))
    offline.mockRestore()
    expect(injected).toEqual([])
    expect(records[0]?.kind).toBe('pdf')
    expect(created[0]).toMatchObject({ index: 4, openerTabId: 3 })
  })

  test('reads plain text and XHTML in place, and opens the reader tab for XML, SVG and JSON', async () => {
    const routes: Record<string, string[]> = {
      'text/plain': ['inpage.css', 'inpage.js'],
      'application/xhtml+xml': ['inpage.css', 'inpage.js'],
      'application/xml': ['extract.js'],
      'image/svg+xml': ['extract.js'],
      'application/json': ['extract.js'],
    }
    for (const [k, [contentType, files]] of Object.entries(routes).entries()) {
      page.contentType = contentType
      injected = []
      created = []
      Reflect.deleteProperty(globalThis, '__pacerInPage')
      await paceTab(tabOf(20 + k))
      expect([contentType, injected]).toEqual([contentType, files])
      expect([contentType, created.length]).toEqual([contentType, files.includes('extract.js') ? 1 : 0])
    }
  })

  test('marks the button when the page script answers nothing', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    toggleResult = null as unknown as ToggleResult
    await paceTab(tabOf(30))
    expect(badges[30]?.text).toBe('!')
    expect(String(warn.mock.calls[0]?.[1])).toContain('The script returned nothing.')
    warn.mockRestore()
  })

  test('opens the reader tab for a local file Pacer may not read', async () => {
    fileAccess = false
    await paceTab(tabOf(4, 'file:///Users/me/notes.html'))
    expect(injected).toEqual([])
    expect(records[0]?.error).toEqual({ message: '', fileAccess: true })
    expect(created.length).toBe(1)
  })

  test('opens the reader tab with what the page read when the page cannot be mapped', async () => {
    toggleResult = { kind: 'fallback', article: { title: null, text: 'Words the page showed.', startParagraph: 4 }, coverage: 0.4 }
    await paceTab(tabOf(5))
    expect(injected).toEqual(['inpage.css', 'inpage.js'])
    expect(created[0]).toMatchObject({ index: 4, openerTabId: 5 })
    expect(records[0]).toMatchObject({ kind: 'article', src: 'https://example.com/essay', title: 'Essay', text: 'Words the page showed.', startParagraph: 4 })
  })

  test('marks the button when the page has no article', async () => {
    toggleResult = { kind: 'error', message: 'Pacer found no article text on this page.' }
    await paceTab(tabOf(6))
    expect(created).toEqual([])
    expect(badges[6]).toEqual({ text: '!', title: "Pacer can't read this page" })
  })

  test('marks the button on pages Chrome keeps scripts out of', async () => {
    const quiet = spyOn(console, 'warn').mockImplementation(() => undefined)
    refuseScripts = true
    await paceTab(tabOf(7, 'https://chromewebstore.google.com/'))
    expect(badges[7]?.text).toBe('!')
    quiet.mockRestore()
  })
})

describe('open-tab message', () => {
  const article = { title: 'How Eyes Read', text: 'Words to read.', startParagraph: 7 }
  const send = async (message: unknown, sender: chrome.runtime.MessageSender) => {
    let reply: unknown
    const kept = onMessage(message, sender, (response) => (reply = response))
    for (let k = 0; k < 20 && reply === undefined; k++) await Promise.resolve()
    return { kept, reply }
  }

  test('opens the reader next to the page at the paragraph the bar stopped on', async () => {
    const sender = { tab: tabOf(8, 'https://example.com/old'), url: 'https://example.com/essay#part-2' }
    const { kept, reply } = await send({ type: 'pacer:open-tab', article }, sender)
    expect(kept).toBe(true)
    expect(reply).toEqual({ ok: true })
    expect(injected).toEqual([])
    expect(records[0]).toMatchObject({ kind: 'article', src: 'https://example.com/essay#part-2', ...article })
    expect(created[0]).toMatchObject({ url: `chrome-extension://pacer/reader.html?doc=${records[0].id}`, index: 4, openerTabId: 8 })
  })

  test('reads the page itself when the bar asks before the page was read', async () => {
    const { reply } = await send({ type: 'pacer:open-tab', article: null }, { tab: tabOf(11), url: 'https://example.com/essay' })
    expect(reply).toEqual({ ok: true })
    expect(injected).toEqual(['extract.js'])
    expect(records[0]).toMatchObject({ kind: 'article', title: 'How Eyes Read', text: 'Words to read.', startParagraph: 2 })
    expect(created[0]).toMatchObject({ index: 4, openerTabId: 11 })
  })

  test('ignores messages of another shape or from outside a tab', async () => {
    for (const message of [null, 'pacer:open-tab', { type: 'pacer:open-tab' }, { type: 'other', article }, { type: 'pacer:open-tab', article: { ...article, startParagraph: '7' } }]) {
      expect(onMessage(message, { tab: tabOf(9) }, () => undefined)).toBeUndefined()
    }
    expect(onMessage({ type: 'pacer:open-tab', article }, {}, () => undefined)).toBeUndefined()
    expect(records).toEqual([])
    expect(created).toEqual([])
  })

  test('answers not ok and marks the button when the record cannot be kept', async () => {
    const quiet = spyOn(console, 'warn').mockImplementation(() => undefined)
    storeFails = true
    const { reply } = await send({ type: 'pacer:open-tab', article }, { tab: tabOf(10), url: 'https://example.com/essay' })
    expect(reply).toEqual({ ok: false })
    expect(created).toEqual([])
    expect(badges[10]?.text).toBe('!')
    quiet.mockRestore()
  })
})
