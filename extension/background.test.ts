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

mock.module('./docs', () => ({
  putDoc: async (record: DocRecord) => void records.push(record),
}))

const fakeChrome = {
  runtime: {
    getURL: (path: string) => `chrome-extension://pacer/${path}`,
    getManifest: () => ({ action: { default_title: 'Pace this page' } }),
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

  test('opens the reader tab for a local file Pacer may not read', async () => {
    fileAccess = false
    await paceTab(tabOf(4, 'file:///Users/me/notes.html'))
    expect(injected).toEqual([])
    expect(records[0]?.error).toEqual({ message: '', fileAccess: true })
    expect(created.length).toBe(1)
  })

  test('opens the reader tab when the page cannot be mapped', async () => {
    toggleResult = { kind: 'fallback', article: { title: 'How Eyes Read', text: 'Words to read.', startParagraph: 2 }, coverage: 0.4 }
    await paceTab(tabOf(5))
    expect(created.length).toBe(1)
    expect(records[0]).toMatchObject({ kind: 'article', title: 'How Eyes Read', text: 'Words to read.', startParagraph: 2 })
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
