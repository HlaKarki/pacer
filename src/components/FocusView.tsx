import type { Doc } from '../lib/text'
import { orpIndex } from '../lib/timing'

interface FocusViewProps {
  doc: Doc
  chunk: { start: number; end: number }
  onJump: (index: number) => void
}

// Very long sentences get a window around the current word, so the context stays short enough to take in at a glance.
const CONTEXT_RADIUS = 24

function splitAtPivot(text: string, single: boolean) {
  let pivot = single ? orpIndex(text) : Math.floor(text.length * 0.35)
  while (pivot < text.length - 1 && text[pivot] === ' ') pivot += 1
  return [text.slice(0, pivot), text[pivot] ?? '', text.slice(pivot + 1)]
}

export function FocusView({ doc, chunk, onJump }: FocusViewProps) {
  const { words, sentences } = doc
  const text = words
    .slice(chunk.start, chunk.end)
    .map((w) => w.text)
    .join(' ')
  const [left, pivot, right] = splitAtPivot(text, chunk.end - chunk.start === 1)

  const sent = words[chunk.start]?.sent ?? 0
  const current = sentences[sent]
  const previous = sentences[sent - 1]
  const from = Math.max(current.start, chunk.start - CONTEXT_RADIUS)
  const to = Math.min(current.end, chunk.end + CONTEXT_RADIUS)

  const renderRange = (start: number, end: number) =>
    words.slice(start, end).map((w, j) => {
      const i = start + j
      const state = i < chunk.start ? 'pc-is-read' : i < chunk.end ? 'pc-is-now' : ''
      return (
        <span key={i}>
          <button type="button" className={`pc-cw ${state}`} onClick={() => onJump(i)} tabIndex={-1}>
            {w.text}
          </button>{' '}
        </span>
      )
    })

  return (
    <div className="pc-focus">
      <div className="pc-focus-reticle">
        <div className="pc-focus-word" aria-live="off">
          <span className="pc-focus-left">{left}</span>
          <span className="pc-focus-pivot">{pivot}</span>
          <span className="pc-focus-right">{right}</span>
        </div>
      </div>

      <div className="pc-focus-context">
        {previous && words[previous.start].para === words[current.start].para ? (
          <p className="pc-focus-prev">
            {previous.end - previous.start > CONTEXT_RADIUS ? <span className="pc-cw-gap">… </span> : null}
            {renderRange(Math.max(previous.start, previous.end - CONTEXT_RADIUS), previous.end)}
          </p>
        ) : null}
        <p className="pc-focus-current">
          {from > current.start ? <span className="pc-cw-gap">… </span> : null}
          {renderRange(from, to)}
          {to < current.end ? <span className="pc-cw-gap">…</span> : null}
        </p>
      </div>
    </div>
  )
}
