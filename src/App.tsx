import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Editor } from './components/Editor'
import { Reader } from './components/Reader'
import { loadFrequency, type FrequencyMap } from './lib/frequency'
import { parse } from './lib/text'
import { usePersisted, useSettings } from './lib/storage'
import { weightPrefix } from './lib/timing'

interface Place {
  length: number
  index: number
}

export default function App() {
  const [text, setText] = usePersisted('pacer:text', '')
  const [title, setTitle] = usePersisted<string | null>('pacer:title', null)
  const [place, setPlace] = usePersisted<Place>('pacer:place', { length: 0, index: 0 })
  const [settings, update] = useSettings()
  const [screen, setScreen] = useState<'edit' | 'read'>(() => (text.trim() ? 'read' : 'edit'))
  const [freq, setFreq] = useState<FrequencyMap | null>(null)

  useEffect(() => {
    loadFrequency().then(setFreq, () => setFreq(null))
  }, [])

  // Parsing a whole book on every keystroke would make typing lag, so it trails the textarea.
  const deferredText = useDeferredValue(text)
  const doc = useMemo(() => parse(deferredText), [deferredText])
  const prefix = useMemo(
    () => weightPrefix(doc, { pauses: settings.pauses, smart: settings.smart, freq }),
    [doc, settings.pauses, settings.smart, freq],
  )
  // A saved place only applies to the text it was saved against.
  const index =
    place.length === text.length ? Math.min(place.index, Math.max(0, doc.words.length - 1)) : 0

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  const setIndex = useCallback(
    (i: number) => setPlace({ length: text.length, index: i }),
    [setPlace, text.length],
  )

  if (screen === 'edit' || doc.words.length === 0) {
    return (
      <Editor
        text={text}
        title={title}
        onChange={(next) => {
          setText(next)
          if (!next.trim()) setTitle(null)
        }}
        onImport={(imported) => {
          setText(imported.text)
          setTitle(imported.title)
        }}
        wpm={settings.wpm}
        prefix={prefix}
        progress={doc.words.length ? index / doc.words.length : 0}
        onStart={(fromStart) => {
          if (fromStart) setIndex(0)
          setScreen('read')
        }}
      />
    )
  }

  return (
    <Reader
      doc={doc}
      title={title}
      prefix={prefix}
      index={index}
      setIndex={setIndex}
      settings={settings}
      update={update}
      onEdit={() => setScreen('edit')}
    />
  )
}
