import { useEffect, useRef } from 'react'
import type { Section } from '../lib/text'
import { useDismiss } from '../lib/useDismiss'

interface ContentsPanelProps {
  title: string | null
  chapters: Section[]
  current: Section
  onPick: (start: number) => void
  onClose: () => void
}

export function ContentsPanel({ title, chapters, current, onPick, onClose }: ContentsPanelProps) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)

  const active = chapters.findLastIndex((c) => c.start <= current.start)

  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <div className="popover contents" ref={ref} role="dialog" aria-label="Contents">
      {title ? <p className="contents-title">{title}</p> : null}
      <ol className="contents-list">
        {chapters.map((chapter, i) => (
          <li key={chapter.start}>
            <button
              type="button"
              aria-current={i === active}
              onClick={() => onPick(chapter.start)}
            >
              {chapter.title}
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
