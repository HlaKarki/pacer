import { blocksFromHtml, type Block, type HtmlOptions } from '../src/lib/import/html'
import type { Doc } from '../src/lib/text'

export const SKIPPED_SECTIONS = new Set(['yaml', 'code', 'math', 'comment', 'footnoteDefinition', 'thematicBreak'])

const NOT_PROSE = [
  'pre', 'button', 'img', 'audio', 'video', 'iframe', 'canvas',
  '.math', '.mermaid', '.frontmatter', '.metadata-container',
  '.footnotes', '.footnote-ref', '.footnote-backref',
  '.markdown-embed-title', '.embed-title', '.markdown-embed-link',
].join(', ')

/** Map-of-content lists and tag lines hold only links, so there is nothing to read. */
function isLinkOnly(el: Element): boolean {
  if (!el.matches('p, ul, ol')) return false
  const links = [...el.querySelectorAll('a')]
  const squash = (text: string | null) => (text ?? '').replace(/\s+/g, '')
  return links.length > 0 && squash(links.map((a) => a.textContent).join('')) === squash(el.textContent)
}

export const NOTE_HTML: HtmlOptions = {
  skip: (el) =>
    el.matches(NOT_PROSE) ||
    (el.classList.contains('internal-embed') && !el.classList.contains('markdown-embed')) ||
    isLinkOnly(el),
  // Obsidian renders an embedded note as a span inside a paragraph, so its blocks would merge into one.
  block: (el) => el.classList.contains('markdown-embed'),
  skipLinkLists: false,
}

export interface RenderedSection {
  type: string
  line: number
  el: Element
  /** Start lines of the list items inside a list section, in document order. */
  itemLines: number[]
}

export function blocksFromSections(sections: RenderedSection[]): { blocks: Block[]; lines: number[] } {
  const blocks: Block[] = []
  const lines: number[] = []
  for (const section of sections) {
    const found = blocksFromHtml(section.el, NOTE_HTML)
    // Loose list items hold several paragraphs, and then items and blocks no longer pair up.
    const exact = section.type === 'list' && section.itemLines.length === found.length
    found.forEach((block, k) => {
      blocks.push(block)
      lines.push(exact ? section.itemLines[k] : section.line)
    })
  }
  return { blocks, lines }
}

/** A table or callout gives several paragraphs one source line, so start at the first of them. */
export function paragraphAtLine(paragraphLines: number[], line: number): number {
  let found = 0
  for (let k = 0; k < paragraphLines.length && paragraphLines[k] <= line; k++) {
    if (paragraphLines[k] !== paragraphLines[found]) found = k
  }
  return found
}

export function lineAtWord(doc: Doc, paragraphLines: number[], index: number): number {
  return paragraphLines[doc.words[index]?.para ?? 0] ?? 0
}

/** The cursor wins over the saved place, which wins over the top of the text. */
export function startIndex(
  doc: Doc,
  paragraphLines: number[] | null,
  cursorLine: number | null,
  saved: number | undefined,
): number {
  if (cursorLine !== null && paragraphLines) {
    return doc.paragraphs[paragraphAtLine(paragraphLines, cursorLine)]?.start ?? 0
  }
  if (saved !== undefined && saved >= 0 && saved < doc.words.length) return saved
  return 0
}

/** A section slice loses the rest of the note, so drop its footnote markers and carry the link definitions in. */
export function prepareSection(markdown: string, linkDefinitions: string): string {
  const body = markdown.replace(/\[\^[^\]\s]+\](?!:)/g, '')
  return linkDefinitions ? `${body}\n\n${linkDefinitions}` : body
}

export function linkDefinitions(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => /^ {0,3}\[[^\]^][^\]]*\]:\s*\S/.test(line))
    .join('\n')
}

export const stripFrontmatter = (markdown: string) =>
  markdown.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
