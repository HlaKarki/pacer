import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  TableOfContents,
} from 'lucide-react'
import { chunkAt, sectionAt, sentenceStart, type Doc } from '../lib/text'
import { chunkMs, formatDuration, msPerWord, rampFactor } from '../lib/timing'
import { WPM_MAX, WPM_MIN, WPM_STEP, type Settings } from '../lib/storage'
import { FlowView } from './FlowView'
import { FocusView } from './FocusView'
import { SettingsPanel } from './SettingsPanel'
import { ContentsPanel } from './ContentsPanel'

interface ReaderProps {
  doc: Doc
  title: string | null
  prefix: Float64Array
  index: number
  setIndex: (index: number) => void
  settings: Settings
  update: (patch: Partial<Settings>) => void
  onEdit: () => void
}

const clampWpm = (wpm: number) => Math.min(WPM_MAX, Math.max(WPM_MIN, wpm))

// Keeps a button from taking focus on click, so Space keeps meaning play/pause.
const noFocus = (e: React.MouseEvent) => e.preventDefault()

export function Reader({ doc, title, prefix, index, setIndex, settings, update, onEdit }: ReaderProps) {
  const [playing, setPlaying] = useState(false)
  const [layout, setLayout] = useState<{ lines: Int32Array; offset: number } | null>(null)
  const [panel, setPanel] = useState<'settings' | 'contents' | null>(null)
  const [idle, setIdle] = useState(false)
  const sincePlay = useRef(0)
  const total = doc.words.length

  const section = sectionAt(doc, index)
  const chapters = useMemo(() => doc.sections.filter((s) => s.opensChapter), [doc])
  const onLayout = useCallback(
    (lines: Int32Array, offset: number) => setLayout({ lines, offset }),
    [],
  )
  const lineOf = useMemo(() => {
    if (settings.mode !== 'flow' || !layout) return undefined
    const { lines, offset } = layout
    // Words outside the measured window each get their own line, so chunks stay single words until it is measured.
    return (i: number) => lines[i - offset] ?? -1 - i
  }, [settings.mode, layout])
  const chunk = useMemo(
    () => chunkAt(doc, index, settings.chunk, lineOf),
    [doc, index, settings.chunk, lineOf],
  )
  const duration = chunkMs(prefix, chunk, settings.wpm)
  const glideMs = Math.round(Math.min(140, Math.max(60, duration * 0.45)))
  const remaining = (prefix[total] - prefix[index]) * msPerWord(settings.wpm)

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      sincePlay.current += 1
      if (chunk.end >= total) setPlaying(false)
      else setIndex(chunk.end)
    }, duration * rampFactor(sincePlay.current))
    return () => window.clearTimeout(timer)
  }, [playing, chunk, duration, total, setIndex])

  const play = useCallback(() => {
    if (chunk.end >= total) setIndex(0)
    sincePlay.current = 0
    setPlaying(true)
  }, [chunk.end, total, setIndex])

  const toggle = useCallback(() => (playing ? setPlaying(false) : play()), [playing, play])

  const jump = useCallback(
    (i: number) => {
      sincePlay.current = 0
      setIndex(Math.min(total - 1, Math.max(0, i)))
    },
    [total, setIndex],
  )

  const prevSentence = useCallback(() => {
    const start = sentenceStart(doc, index)
    // Like a music player, the first press restarts the sentence and a second press goes back one.
    const grace = playing ? 3 : 1
    if (index - start >= grace) jump(start)
    else jump(sentenceStart(doc, Math.max(0, start - 1)))
  }, [doc, index, playing, jump])

  const nextSentence = useCallback(() => {
    const next = doc.sentences[doc.words[index].sent + 1]
    jump(next ? next.start : total - 1)
  }, [doc, index, total, jump])

  const setWpm = useCallback((wpm: number) => update({ wpm: clampWpm(wpm) }), [update])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, select')) return
      if (e.metaKey || e.ctrlKey) return
      const onButton = target.closest('button') !== null
      switch (e.key) {
        case ' ':
        case 'k':
          if (onButton && e.key === ' ') return
          e.preventDefault()
          toggle()
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (e.shiftKey || e.altKey) prevSentence()
          else jump(index - 1)
          break
        case 'ArrowRight':
          e.preventDefault()
          if (e.shiftKey || e.altKey) nextSentence()
          else jump(chunk.end)
          break
        case 'ArrowUp':
          e.preventDefault()
          setWpm(settings.wpm + WPM_STEP)
          break
        case 'ArrowDown':
          e.preventDefault()
          setWpm(settings.wpm - WPM_STEP)
          break
        case 'f':
          update({ mode: settings.mode === 'flow' ? 'focus' : 'flow' })
          break
        case 'Escape':
          if (panel) setPanel(null)
          else if (playing) setPlaying(false)
          else onEdit()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, prevSentence, nextSentence, jump, setWpm, update, onEdit, index, chunk.end, settings, panel, playing])

  useEffect(() => {
    if (!playing || !window.matchMedia('(hover: hover)').matches) return
    let timer = window.setTimeout(() => setIdle(true), 1800)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 1800)
    }
    window.addEventListener('pointermove', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      setIdle(false)
    }
  }, [playing])

  const pause = useCallback(() => setPlaying(false), [])
  const progress = total > 1 ? index / (total - 1) : 0

  return (
    <div className="reader" data-idle={idle || undefined} data-size={settings.size}>
      <header className="reader-bar reader-top">
        <button type="button" className="btn btn-quiet" onMouseDown={noFocus} onClick={onEdit}>
          <ArrowLeft size={16} aria-hidden />
          <span>Text</span>
        </button>

        <div className="segmented" role="radiogroup" aria-label="Reading mode">
          {(['flow', 'focus'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.mode === mode}
              onMouseDown={noFocus}
              onClick={() => update({ mode })}
            >
              {mode === 'flow' ? 'Flow' : 'Focus'}
            </button>
          ))}
        </div>

        <div className="top-actions">
          {chapters.length > 1 ? (
            <div className="popover-anchor">
              <button
                type="button"
                className="icon-btn"
                aria-label="Contents"
                aria-expanded={panel === 'contents'}
                onMouseDown={noFocus}
                onClick={() => setPanel((p) => (p === 'contents' ? null : 'contents'))}
              >
                <TableOfContents size={18} aria-hidden />
              </button>
              {panel === 'contents' ? (
                <ContentsPanel
                  title={title}
                  chapters={chapters}
                  current={section}
                  onPick={(start) => {
                    jump(start)
                    setPanel(null)
                  }}
                  onClose={() => setPanel(null)}
                />
              ) : null}
            </div>
          ) : null}
          <div className="popover-anchor">
            <button
              type="button"
              className="icon-btn"
              aria-label="Reading settings"
              aria-expanded={panel === 'settings'}
              onMouseDown={noFocus}
              onClick={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
            >
              <SlidersHorizontal size={18} aria-hidden />
            </button>
            {panel === 'settings' ? (
              <SettingsPanel settings={settings} update={update} onClose={() => setPanel(null)} />
            ) : null}
          </div>
        </div>
      </header>

      <main className="reader-body">
        {settings.mode === 'flow' ? (
          <FlowView
            doc={doc}
            section={section}
            chunk={chunk}
            playing={playing}
            glideMs={glideMs}
            onJump={jump}
            onLayout={onLayout}
            onUserScroll={pause}
          />
        ) : (
          <FocusView doc={doc} chunk={chunk} onJump={jump} />
        )}
      </main>

      <footer className="reader-bar reader-bottom">
        <div
          className="progress"
          role="slider"
          aria-label="Position"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            jump(Math.round(((e.clientX - rect.left) / rect.width) * (total - 1)))
          }}
        >
          <div className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className="transport">
          <div className="wpm">
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label="Slower"
              onMouseDown={noFocus}
              onClick={() => setWpm(settings.wpm - WPM_STEP)}
            >
              <Minus size={15} aria-hidden />
            </button>
            <span className="wpm-value">
              <strong>{settings.wpm}</strong> wpm
            </span>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label="Faster"
              onMouseDown={noFocus}
              onClick={() => setWpm(settings.wpm + WPM_STEP)}
            >
              <Plus size={15} aria-hidden />
            </button>
          </div>

          <div className="transport-main">
            <button
              type="button"
              className="icon-btn"
              aria-label="Previous sentence"
              onMouseDown={noFocus}
              onClick={prevSentence}
            >
              <SkipBack size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="play-btn"
              aria-label={playing ? 'Pause' : 'Play'}
              onMouseDown={noFocus}
              onClick={toggle}
            >
              {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next sentence"
              onMouseDown={noFocus}
              onClick={nextSentence}
            >
              <SkipForward size={18} aria-hidden />
            </button>
          </div>

          <p className="time-left">{formatDuration(remaining)} left</p>
        </div>
      </footer>
    </div>
  )
}
