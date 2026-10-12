import type { ChunkSize } from './text'

export type Mode = 'flow' | 'focus'
export type Theme = 'system' | 'light' | 'dark'
export type TextSize = 's' | 'm' | 'l'

export interface Settings {
  wpm: number
  chunk: ChunkSize
  pauses: boolean
  smart: boolean
  mode: Mode
  theme: Theme
  size: TextSize
}

/** Settings kept outside the page, so every reader the host opens shares them. */
export interface SettingsStore {
  getSettings: () => Settings
  subscribe: (listener: () => void) => () => void
  updateSettings: (patch: Partial<Settings>) => void
}

export const DEFAULT_SETTINGS: Settings = {
  wpm: 300,
  chunk: 1,
  pauses: true,
  smart: true,
  mode: 'flow',
  theme: 'system',
  size: 'm',
}

export const WPM_MIN = 100
export const WPM_MAX = 1200
export const WPM_STEP = 25
