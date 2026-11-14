import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { chunkAt, sectionAt, type Doc } from '../lib/text'
import { chunkMs, formatDuration, msPerWord } from '../lib/timing'
import { WPM_STEP, type Settings } from '../lib/storage'
import { chunkDelayMs, clampWpm, nextSentenceTarget, prevSentenceTarget } from '../lib/transport'
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
  /** Without it there is no back button and Esc only pauses. */
  onExit?: () => void
  exitLabel?: string
  /** Where key presses are heard, so a host with several panes can keep keys inside its own. */
  keyTarget?: EventTarget
  showTheme?: boolean
}

// Keeps a button from taking focus on click, so Space keeps meaning play/pause.
const noFocus = (e: React.MouseEvent) => e.preventDefault()

export function Reader({
  doc,
  title,
  prefix,
  index,
  setIndex,
  settings,
  update,
  onExit,
  exitLabel = 'Text',
  keyTarget = window,
  showTheme = true,
}: ReaderProps) {
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
  const bySentence = settings.chunk === 'sentence'
  const duration = chunkMs(prefix, chunk, settings.wpm)
  const glideMs = Math.round(Math.min(140, Math.max(60, duration * 0.45)))
  const remaining = (prefix[total] - prefix[index]) * msPerWord(settings.wpm)

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => {
      sincePlay.current += 1
      if (chunk.end >= total) setPlaying(false)
      else setIndex(chunk.end)
    }, chunkDelayMs(prefix, chunk, settings.wpm, settings.chunk, sincePlay.current))
    return () => window.clearTimeout(timer)
  }, [playing, chunk, prefix, settings.wpm, settings.chunk, total, setIndex])

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

  const prevSentence = useCallback(() => jump(prevSentenceTarget(doc, index, playing)), [doc, index, playing, jump])

  const nextSentence = useCallback(() => jump(nextSentenceTarget(doc, index)), [doc, index, jump])

  const setWpm = useCallback((wpm: number) => update({ wpm: clampWpm(wpm) }), [update])

  // Preact runs plain effects a frame late, so a second fast key press would hit the old listener; layout effects run before the next event.
  useLayoutEffect(() => {
    const onKey = (event: Event) => {
      const e = event as KeyboardEvent
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
          if (e.shiftKey || e.altKey || bySentence) prevSentence()
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
          else onExit?.()
          break
      }
    }
    keyTarget.addEventListener('keydown', onKey)
    return () => keyTarget.removeEventListener('keydown', onKey)
  }, [keyTarget, toggle, prevSentence, nextSentence, jump, setWpm, update, onExit, index, chunk.end, settings, panel, playing, bySentence])

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
    <div className="pc-reader" data-idle={idle || undefined} data-size={settings.size}>
      <header className="pc-reader-bar pc-reader-top">
        {onExit ? (
          <button type="button" className="pc-btn pc-btn-quiet" onMouseDown={noFocus} onClick={onExit}>
            <ArrowLeft size={16} aria-hidden />
            <span>{exitLabel}</span>
          </button>
        ) : (
          <span />
        )}

        <div className="pc-segmented" role="radiogroup" aria-label="Reading mode">
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

        <div className="pc-top-actions">
          {chapters.length > 1 ? (
            <div className="pc-popover-anchor">
              <button
                type="button"
                className="pc-icon-btn"
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
          <div className="pc-popover-anchor">
            <button
              type="button"
              className="pc-icon-btn"
              aria-label="Reading settings"
              aria-expanded={panel === 'settings'}
              onMouseDown={noFocus}
              onClick={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
            >
              <SlidersHorizontal size={18} aria-hidden />
            </button>
            {panel === 'settings' ? (
              <SettingsPanel
                settings={settings}
                update={update}
                canExit={onExit !== undefined}
                showTheme={showTheme}
                onClose={() => setPanel(null)}
              />
            ) : null}
          </div>
        </div>
      </header>

      <main className="pc-reader-body">
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
          <FocusView doc={doc} chunk={chunk} bySentence={bySentence} onJump={jump} />
        )}
      </main>

      <footer className="pc-reader-bar pc-reader-bottom">
        <div
          className="pc-progress"
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
          <div className="pc-progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>

        <div className="pc-transport">
          <div className="pc-wpm">
            <button
              type="button"
              className="pc-icon-btn pc-icon-btn-sm"
              aria-label="Slower"
              onMouseDown={noFocus}
              onClick={() => setWpm(settings.wpm - WPM_STEP)}
            >
              <Minus size={15} aria-hidden />
            </button>
            <span className="pc-wpm-value">
              <strong>{settings.wpm}</strong> wpm
            </span>
            <button
              type="button"
              className="pc-icon-btn pc-icon-btn-sm"
              aria-label="Faster"
              onMouseDown={noFocus}
              onClick={() => setWpm(settings.wpm + WPM_STEP)}
            >
              <Plus size={15} aria-hidden />
            </button>
          </div>

          <div className="pc-transport-main">
            <button
              type="button"
              className="pc-icon-btn"
              aria-label="Previous sentence"
              onMouseDown={noFocus}
              onClick={prevSentence}
            >
              <SkipBack size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="pc-play-btn"
              aria-label={playing ? 'Pause' : 'Play'}
              onMouseDown={noFocus}
              onClick={toggle}
            >
              {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
            </button>
            <button
              type="button"
              className="pc-icon-btn"
              aria-label="Next sentence"
              onMouseDown={noFocus}
              onClick={nextSentence}
            >
              <SkipForward size={18} aria-hidden />
            </button>
          </div>

          <p className="pc-time-left">{formatDuration(remaining)} left</p>
        </div>
      </footer>
    </div>
  )
}
