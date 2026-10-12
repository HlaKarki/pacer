import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { FrequencyMap } from '../lib/frequency'
import type { SettingsStore } from '../lib/storage'
import type { Doc } from '../lib/text'
import { weightPrefix } from '../lib/timing'
import { Reader } from './Reader'

interface ReaderScreenProps {
  doc: Doc
  title: string
  initialIndex: number
  store: SettingsStore
  freq: FrequencyMap | null
  keyTarget: EventTarget
  exitLabel: string | null
  onIndex: (index: number) => void
  onExit: () => void
  showTheme?: boolean
}

export function ReaderScreen({
  doc,
  title,
  initialIndex,
  store,
  freq,
  keyTarget,
  exitLabel,
  onIndex,
  onExit,
  showTheme = false,
}: ReaderScreenProps) {
  const settings = useSyncExternalStore(store.subscribe, store.getSettings)
  const [index, setIndexState] = useState(initialIndex)
  const prefix = useMemo(
    () => weightPrefix(doc, { pauses: settings.pauses, smart: settings.smart, freq }),
    [doc, settings.pauses, settings.smart, freq],
  )
  const setIndex = useCallback(
    (i: number) => {
      setIndexState(i)
      onIndex(i)
    },
    [onIndex],
  )
  return (
    <Reader
      doc={doc}
      title={title}
      prefix={prefix}
      index={index}
      setIndex={setIndex}
      settings={settings}
      update={store.updateSettings}
      onExit={exitLabel ? onExit : undefined}
      exitLabel={exitLabel ?? undefined}
      keyTarget={keyTarget}
      showTheme={showTheme}
    />
  )
}
