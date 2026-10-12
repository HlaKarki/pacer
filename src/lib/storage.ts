import { useEffect, useState } from 'react'
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

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private windows and blocked storage throw, and the reader works without persistence.
  }
}

export function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => read(key, fallback))
  useEffect(() => write(key, value), [key, value])
  return [value, setValue] as const
}

export function useSettings() {
  const [stored, setStored] = usePersisted<Partial<Settings>>('pacer:settings', {})
  const settings: Settings = { ...DEFAULT_SETTINGS, ...stored }
  const update = (patch: Partial<Settings>) => setStored((s) => ({ ...s, ...patch }))
  return [settings, update] as const
}
