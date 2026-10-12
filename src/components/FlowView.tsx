import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Doc, Section } from '../lib/text'

interface FlowViewProps {
  doc: Doc
  section: Section
  chunk: { start: number; end: number }
  playing: boolean
  glideMs: number
  onJump: (index: number) => void
  onLayout: (lines: Int32Array, offset: number) => void
  onUserScroll: () => void
}

// Fraction of the viewport height where the active line rests.
const BAND = 0.36

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const Paragraphs = memo(function Paragraphs({ doc, start, end }: { doc: Doc; start: number; end: number }) {
  return doc.paragraphs
    .filter((p) => p.start >= start && p.end <= end)
    .map((p) => {
      const words = doc.words.slice(p.start, p.end).map((w, j) => {
        const i = p.start + j
        return (
          <Fragment key={i}>
            <span className="pc-w" data-i={i}>
              {w.text}
            </span>
            {i < p.end - 1 ? ' ' : null}
          </Fragment>
        )
      })
      if (p.heading === 0) return <p key={p.start}>{words}</p>
      const Heading = p.heading <= 2 ? 'h2' : 'h3'
      return (
        <Heading key={p.start} className="pc-flow-heading">
          {words}
        </Heading>
      )
    })
})

export function FlowView({
  doc,
  section,
  chunk,
  playing,
  glideMs,
  onJump,
  onLayout,
  onUserScroll,
}: FlowViewProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const spans = useRef<HTMLElement[]>([])
  const lines = useRef<Int32Array>(new Int32Array(0))
  const markedLine = useRef(-1)
  const readUpTo = useRef(0)
  const scroll = useRef({ frame: 0, line: -1 })
  const activeStart = useRef(0)
  const offset = section.start

  const scrollToLine = useCallback((span: HTMLElement, animate: boolean) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const lineHeight = parseFloat(getComputedStyle(span.parentElement!).lineHeight)
    const lineTop = span.offsetTop - (lineHeight - span.offsetHeight) / 2
    const target = Math.max(0, lineTop - viewport.clientHeight * BAND)
    cancelAnimationFrame(scroll.current.frame)
    const from = viewport.scrollTop
    const distance = target - from
    if (!animate || prefersReducedMotion() || Math.abs(distance) > viewport.clientHeight * 1.5) {
      viewport.scrollTop = target
      return
    }
    const duration = 280
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration)
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      viewport.scrollTop = from + distance * eased
      if (t < 1) scroll.current.frame = requestAnimationFrame(step)
    }
    scroll.current.frame = requestAnimationFrame(step)
  }, [])

  const measure = useCallback(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    const stage = stageRef.current
    if (!content || !viewport || !stage) return
    spans.current = Array.from(content.querySelectorAll<HTMLElement>('.pc-w'))
    const map = new Int32Array(spans.current.length)
    let line = -1
    let lastTop = -Infinity
    spans.current.forEach((span, i) => {
      const top = span.offsetTop
      if (Math.abs(top - lastTop) > 2) {
        line += 1
        lastTop = top
      }
      map[i] = line
    })
    lines.current = map
    const firstP = content.querySelector('p')
    const lineHeight = firstP ? parseFloat(getComputedStyle(firstP).lineHeight) : 32
    const bandY = Math.round(viewport.clientHeight * BAND)
    stage.style.setProperty('--pc-band-y', `${bandY}px`)
    stage.style.setProperty('--pc-pad-below', `${viewport.clientHeight - bandY}px`)
    stage.style.setProperty('--pc-line-h', `${Math.round(lineHeight)}px`)
    readUpTo.current = 0
    spans.current.forEach((s) => s.classList.remove('pc-is-read'))
    markedLine.current = -1
    scroll.current.line = -1
    onLayout(map, offset)
  }, [onLayout, offset])

  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(() => measure())
    if (contentRef.current) observer.observe(contentRef.current)
    if (viewportRef.current) observer.observe(viewportRef.current)
    document.fonts?.ready.then(() => measure())
    return () => observer.disconnect()
  }, [measure, doc, section.end])

  useLayoutEffect(() => {
    const marker = markerRef.current
    const start = chunk.start - offset
    const first = spans.current[start]
    const last = spans.current[chunk.end - 1 - offset]
    activeStart.current = start
    if (!marker || !first || !last) return

    const line = lines.current[start]
    const glide = playing && line === markedLine.current && !prefersReducedMotion()
    const padX = 4
    const padY = 2
    const x = first.offsetLeft - padX
    const y = first.offsetTop - padY
    const width = last.offsetLeft + last.offsetWidth - first.offsetLeft + padX * 2
    const height = first.offsetHeight + padY * 2
    marker.style.transition = glide
      ? `transform ${glideMs}ms var(--pc-ease-glide), width ${glideMs}ms var(--pc-ease-glide)`
      : 'none'
    marker.style.transform = `translate3d(${x}px, ${y}px, 0)`
    marker.style.width = `${width}px`
    marker.style.height = `${height}px`
    markedLine.current = line

    // Toggle only the words whose read state changed, since long texts have tens of thousands of spans.
    const from = Math.min(readUpTo.current, start)
    const to = Math.max(readUpTo.current, start)
    for (let i = from; i < to; i++) spans.current[i]?.classList.toggle('pc-is-read', i < start)
    readUpTo.current = start

    if (line !== scroll.current.line) {
      scroll.current.line = line
      scrollToLine(first, true)
    }
  }, [chunk, offset, playing, glideMs, scrollToLine])

  // Pressing play after scrolling away brings the active line back into the band.
  useEffect(() => {
    const first = spans.current[activeStart.current]
    if (playing && first) scrollToLine(first, true)
  }, [playing, scrollToLine])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handler = () => onUserScroll()
    viewport.addEventListener('wheel', handler, { passive: true })
    viewport.addEventListener('touchmove', handler, { passive: true })
    return () => {
      viewport.removeEventListener('wheel', handler)
      viewport.removeEventListener('touchmove', handler)
    }
  }, [onUserScroll])

  return (
    <div className="pc-flow-stage" ref={stageRef} data-playing={playing || undefined}>
      <div className="pc-flow-viewport" ref={viewportRef}>
        <div
          className="pc-flow-content"
          ref={contentRef}
          onClick={(e) => {
            const target = (e.target as HTMLElement).closest<HTMLElement>('.pc-w')
            if (target?.dataset.i) onJump(Number(target.dataset.i))
          }}
        >
          <div className="pc-marker" ref={markerRef} aria-hidden />
          <Paragraphs doc={doc} start={section.start} end={section.end} />
        </div>
      </div>
      <div className="pc-flow-fade pc-flow-fade-above" aria-hidden />
      <div className="pc-flow-fade pc-flow-fade-below" aria-hidden />
    </div>
  )
}
