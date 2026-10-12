import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test'
import { parse } from '../src/lib/text'
import { ExtensionStore, startFrom } from './store'

const doc = parse('One two three.\n\nFour five six.\n\nSeven eight nine.')

describe('startFrom', () => {
  test('starts at the hinted paragraph without a saved place', () => {
    expect(startFrom(doc, 0, undefined)).toBe(0)
    expect(startFrom(doc, 2, undefined)).toBe(6)
  })

  test('resumes a saved place when reading starts from the same paragraph', () => {
    expect(startFrom(doc, 1, { index: 5, words: 9, from: 1 })).toBe(5)
  })

  test('follows the new paragraph when the reader scrolled or paged elsewhere', () => {
    expect(startFrom(doc, 2, { index: 5, words: 9, from: 1 })).toBe(6)
  })

  test('starts over when the document changed since the place was saved', () => {
    expect(startFrom(doc, 0, { index: 5, words: 12, from: 0 })).toBe(0)
  })

  test('keeps a stale index inside the document', () => {
    expect(startFrom(doc, 0, { index: 40, words: 9, from: 0 })).toBe(8)
    expect(startFrom(doc, 7, undefined)).toBe(0)
  })

  test('starts at the given word instead of the paragraph start', () => {
    expect(startFrom(doc, 1, undefined, 4)).toBe(4)
    expect(startFrom(doc, 1, { index: 5, words: 9, from: 2 }, 4)).toBe(4)
    expect(startFrom(doc, 1, { index: 5, words: 9, from: 1 }, 4)).toBe(5)
    expect(startFrom(doc, 1, undefined, 40)).toBe(8)
  })
})

describe('ExtensionStore', () => {
  type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void
  let data: Record<string, unknown>
  let writes: Record<string, unknown>[]
  let listeners: Set<Listener>

  beforeEach(() => {
    data = {}
    writes = []
    listeners = new Set()
    Object.assign(globalThis, {
      chrome: {
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
    })
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  const place = (index: number) => ({ index, words: 900, from: 0 })

  test('saves the place at least once a second while it keeps moving', async () => {
    const store = await ExtensionStore.load()
    for (let i = 0; i < 25; i++) {
      store.setPlace('https://example.com/a', place(i))
      jest.advanceTimersByTime(100)
      await Promise.resolve()
    }
    expect(writes.map((w) => (w['place:https://example.com/a'] as { index: number }).index)).toEqual([9, 19])
  })

  test('saves only the latest place for each page', async () => {
    const store = await ExtensionStore.load()
    store.setPlace('a', place(1))
    store.setPlace('a', place(2))
    store.setPlace('b', place(7))
    jest.advanceTimersByTime(1000)
    await Promise.resolve()
    expect(writes).toEqual([{ 'place:a': place(2), 'place:b': place(7) }])
  })

  test('flush writes at once and cancels the pending save', async () => {
    const store = await ExtensionStore.load()
    store.setPlace('a', place(3))
    await store.flush()
    jest.advanceTimersByTime(2000)
    expect(writes).toEqual([{ 'place:a': place(3) }])
    expect(await store.place('a')).toEqual(place(3))
  })

  test('follows settings changed in another tab until disposed', async () => {
    const store = await ExtensionStore.load()
    const send = (wpm: number) => {
      for (const listener of listeners) listener({ settings: { newValue: { wpm } } }, 'local')
    }
    send(450)
    expect(store.getSettings().wpm).toBe(450)
    store.dispose()
    expect(listeners.size).toBe(0)
    send(500)
    expect(store.getSettings().wpm).toBe(450)
  })
})
