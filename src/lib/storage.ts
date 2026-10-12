import { useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, type Settings } from './settings'

// This file pulls in React, so code bundled into web pages imports these from settings.ts instead.
export {
  DEFAULT_SETTINGS,
  WPM_MAX,
  WPM_MIN,
  WPM_STEP,
  type Mode,
  type Settings,
  type SettingsStore,
  type TextSize,
  type Theme,
} from './settings'

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
