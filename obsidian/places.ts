import { DEFAULT_SETTINGS, type Settings } from '../src/lib/storage'

export interface PluginData {
  settings: Partial<Settings>
  /** Word index where reading stopped, by vault path. */
  places: Record<string, number>
}

const SAVE_DELAY_MS = 1000

function normalize(saved: unknown): PluginData {
  const data = (saved ?? {}) as Partial<PluginData>
  return {
    settings: typeof data.settings === 'object' && data.settings ? data.settings : {},
    places: typeof data.places === 'object' && data.places ? data.places : {},
  }
}

/** Settings and reading places for every Pacer tab, written to the plugin's data.json. */
export class PacerStore {
  private data: PluginData
  private snapshot: Settings
  private timer: number | null = null
  private listeners = new Set<() => void>()
  private save: (data: PluginData) => Promise<void>
  private readonly win: Window

  constructor(saved: unknown, save: (data: PluginData) => Promise<void>, win: Window) {
    this.save = save
    this.win = win
    this.data = normalize(saved)
    this.snapshot = { ...DEFAULT_SETTINGS, ...this.data.settings }
  }

  getSettings = (): Settings => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  updateSettings = (patch: Partial<Settings>) => {
    this.data.settings = { ...this.data.settings, ...patch }
    this.snapshot = { ...DEFAULT_SETTINGS, ...this.data.settings }
    for (const listener of this.listeners) listener()
    this.schedule()
  }

  place(path: string): number | undefined {
    return this.data.places[path]
  }

  setPlace(path: string, index: number) {
    if (this.data.places[path] === index) return
    this.data.places[path] = index
    this.schedule()
  }

  /** A folder rename moves every place under it. */
  move(from: string, to: string) {
    if (from === to) return
    let changed = false
    for (const path of Object.keys(this.data.places)) {
      const inside = path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : null
      if (inside === null) continue
      this.data.places[inside] = this.data.places[path]
      delete this.data.places[path]
      changed = true
    }
    if (changed) this.schedule()
  }

  drop(path: string) {
    let changed = false
    for (const key of Object.keys(this.data.places)) {
      if (key === path || key.startsWith(`${path}/`)) {
        delete this.data.places[key]
        changed = true
      }
    }
    if (changed) this.schedule()
  }

  async flush(): Promise<void> {
    if (this.timer === null) return
    this.win.clearTimeout(this.timer)
    this.timer = null
    try {
      await this.save(this.data)
    } catch (error) {
      // Losing a reading place is not worth interrupting the reader for.
      console.warn('Pacer could not save its reading places.', error)
    }
  }

  private schedule() {
    if (this.timer !== null) this.win.clearTimeout(this.timer)
    this.timer = this.win.setTimeout(() => void this.flush(), SAVE_DELAY_MS)
  }
}
