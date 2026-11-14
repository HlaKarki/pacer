import { Component, MarkdownRenderer, loadPdfJs, type App, type TFile } from 'obsidian'
import { extractEpub } from '../src/lib/import/epub'
import { ImportError } from '../src/lib/import/errors'
import { blocksToText } from '../src/lib/import/html'
import { extractPdf } from '../src/lib/import/pdf'
import { frequency } from './frequency'
import {
  blocksFromSections,
  linkDefinitions,
  prepareSection,
  SKIPPED_SECTIONS,
  stripFrontmatter,
  type RenderedSection,
} from './note'

export interface Source {
  title: string
  text: string
  /** Source line of each paragraph, or null when the note's sections are unknown. */
  paragraphLines: number[] | null
}

export const PACEABLE = new Set(['md', 'pdf', 'epub'])

const EMBED_WAIT_MS = 1000

export async function loadSource(app: App, file: TFile, onProgress: (message: string) => void): Promise<Source> {
  if (file.extension === 'md') return noteSource(app, file)
  if (file.extension === 'pdf') {
    onProgress('Opening PDF')
    const data = await app.vault.readBinary(file)
    const freq = frequency()
    const imported = await extractPdf(data, onProgress, (w) => freq.has(w), () => loadPdfJs())
    return { title: imported.title ?? file.basename, text: imported.text, paragraphLines: null }
  }
  if (file.extension === 'epub') {
    onProgress('Opening EPUB')
    const imported = await extractEpub(await app.vault.readBinary(file), onProgress)
    return { title: imported.title ?? file.basename, text: imported.text, paragraphLines: null }
  }
  throw new ImportError(`Pacer cannot open .${file.extension} files.`)
}

interface Part {
  type: string
  line: number
  markdown: string
  itemLines: number[]
}

function notePartsFrom(app: App, file: TFile, markdown: string): Part[] | null {
  const cache = app.metadataCache.getFileCache(file)
  const sections = cache?.sections
  // The cache can trail a fresh edit, and then its offsets cut the note in the wrong places.
  if (!sections?.length || sections[sections.length - 1].position.end.offset > markdown.length) return null
  const items = cache?.listItems ?? []
  return sections
    .filter((s) => !SKIPPED_SECTIONS.has(s.type))
    .map((s) => {
      const { start, end } = s.position
      return {
        type: s.type,
        line: start.line,
        markdown: markdown.slice(start.offset, end.offset),
        itemLines: items
          .map((item) => item.position.start.line)
          .filter((line) => line >= start.line && line <= end.line),
      }
    })
}

/** Renders the note the way reading view does, so callouts, embeds and other plugins' output read as they look. */
async function noteSource(app: App, file: TFile): Promise<Source> {
  const markdown = await app.vault.cachedRead(file)
  const parts = notePartsFrom(app, file, markdown)
  const definitions = linkDefinitions(markdown)
  const component = new Component()
  component.load()
  try {
    const rendered: RenderedSection[] = []
    for (const part of parts ?? [{ type: 'note', line: 0, markdown: stripFrontmatter(markdown), itemLines: [] }]) {
      const el = createDiv()
      try {
        await MarkdownRenderer.render(app, prepareSection(part.markdown, definitions), el, file.path, component)
      } catch (error) {
        console.warn(`Pacer skipped a section of ${file.path} that failed to render.`, error)
        continue
      }
      rendered.push({ type: part.type, line: part.line, el, itemLines: part.itemLines })
    }
    await embedsLoaded(rendered.map((r) => r.el))
    const { blocks, lines } = blocksFromSections(rendered)
    return { title: file.basename, text: blocksToText(blocks), paragraphLines: parts ? lines : null }
  } finally {
    component.unload()
  }
}

// Embedded notes can fill in after render resolves, so wait briefly for their text.
async function embedsLoaded(els: Element[]) {
  const pending = () =>
    els.some((el) =>
      [...el.querySelectorAll('.markdown-embed')].some((embed) => !embed.querySelector('.markdown-embed-content *')),
    )
  const until = performance.now() + EMBED_WAIT_MS
  while (pending() && performance.now() < until) {
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
}
