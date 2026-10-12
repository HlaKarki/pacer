import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../src/lib/settings'
import type { Doc } from '../src/lib/text'

export interface Place {
  index: number
  /** Word count when saved, so a page that changed since starts over. */
  words: number
  /** The paragraph this reading started from, so scrolling somewhere new starts there instead. */
  from: number
}

const SAVE_DELAY_MS = 1000
const placeKey = (key: string) => `place:${key}`
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isPlace = (value: unknown): value is Place =>
  isObject(value) && typeof value.index === 'number' && typeof value.words === 'number' && typeof value.from === 'number'

/** `from` for a press below the article, where only comments or a footer are in view. */
export const PAST_END = -1

/** A saved place wins unless reading now starts from a different paragraph than it did then. Otherwise reading starts at `at`. */
export function startFrom(
  doc: Doc,
  from: number,
  saved: Place | undefined,
  at = doc.paragraphs[from]?.start ?? 0,
): number {
  const last = Math.max(0, doc.words.length - 1)
  // Below the article no paragraph is in view to start from, so any saved place for this page is the better guess.
  const resumes = saved?.from === from || from === PAST_END
  if (saved && saved.words === doc.words.length && resumes) return Math.min(saved.index, last)
  return Math.min(at, last)
}

/** Settings and reading places in chrome.storage.local, shared by every Pacer tab. */
export class ExtensionStore implements SettingsStore {
  private saved: Partial<Settings> = {}
  private snapshot: Settings = DEFAULT_SETTINGS
  private listeners = new Set<() => void>()
  private pending = new Map<string, Place>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private unlisten: (() => void) | null = null

  static async load(): Promise<ExtensionStore> {
    const store = new ExtensionStore()
    const { settings } = await chrome.storage.local.get('settings')
    store.apply(isObject(settings) ? settings : {})
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const change = changes.settings
      if (area === 'local' && change) store.apply(isObject(change.newValue) ? change.newValue : {})
    }
    chrome.storage.onChanged.addListener(onChanged)
    store.unlisten = () => chrome.storage.onChanged.removeListener(onChanged)
    return store
  }

  /** A page can start and stop many readings, so each one releases its settings listener here. */
  dispose() {
    this.unlisten?.()
    this.unlisten = null
  }

  getSettings = (): Settings => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  updateSettings = (patch: Partial<Settings>) => {
    this.apply({ ...this.saved, ...patch })
    chrome.storage.local.set({ settings: this.saved }).catch((error) => {
      console.warn('Pacer could not save its settings.', error)
    })
  }

  async place(key: string): Promise<Place | undefined> {
    const name = placeKey(key)
    const stored = (await chrome.storage.local.get(name))[name]
    return isPlace(stored) ? stored : undefined
  }

  setPlace(key: string, place: Place) {
    this.pending.set(key, place)
    // Playing moves the place several times a second, so a timer that restarted on every move would never fire.
    this.timer ??= setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }

  async flush(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    // A copy of Pacer left on a page by an extension reload has lost its storage, so it drops the places.
    if (!this.pending.size || !chrome.runtime?.id) {
      this.pending.clear()
      return
    }
    const entries = Object.fromEntries([...this.pending].map(([key, place]) => [placeKey(key), place]))
    this.pending.clear()
    try {
      await chrome.storage.local.set(entries)
    } catch (error) {
      // Losing a reading place is not worth interrupting the reader for.
      console.warn('Pacer could not save its reading place.', error)
    }
  }

  private apply(saved: Partial<Settings>) {
    this.saved = saved
    this.snapshot = { ...DEFAULT_SETTINGS, ...saved }
    for (const listener of this.listeners) listener()
  }
}
