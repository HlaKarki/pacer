import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import { Reader } from '../src/components/Reader'
import type { Doc } from '../src/lib/text'
import { weightPrefix } from '../src/lib/timing'
import { frequency } from './frequency'
import type { PacerStore } from './places'

interface ReaderScreenProps {
  doc: Doc
  title: string
  initialIndex: number
  store: PacerStore
  keyTarget: HTMLElement
  exitLabel: string | null
  onIndex: (index: number) => void
  onExit: () => void
}

export function ReaderScreen({ doc, title, initialIndex, store, keyTarget, exitLabel, onIndex, onExit }: ReaderScreenProps) {
  const settings = useSyncExternalStore(store.subscribe, store.getSettings)
  const [index, setIndexState] = useState(initialIndex)
  const freq = useMemo(() => frequency(), [])
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
      showTheme={false}
    />
  )
}
