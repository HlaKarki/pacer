import { Readability } from '@mozilla/readability'
import { ImportError } from '../src/lib/import/errors'
import { blocksFromHtml, blocksToText, clean, type Block } from '../src/lib/import/html'
import { countWords } from '../src/lib/text'

export interface Article {
  title: string | null
  text: string
  /** Paragraph of the text where reading starts. */
  startParagraph: number
}

const MIN_WORDS = 30
const OPENING_WORDS = 8
const MAX_OPENINGS = 12
const CANDIDATES = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, figcaption'

/** Sticky headers usually cover about this share of the window top, so text under it does not count as in view. */
export const HEADER_STRIP = 0.15

/** The first few words, without case or punctuation, so a page paragraph and its extracted block compare equal. */
export const opening = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').slice(0, OPENING_WORDS).join(' ')

const SIDEBARS = 'nav, aside, [role=navigation], [role=complementary]'

function pinnedTest(doc: Document): (el: Element) => boolean {
  const cache = new Map<Element, boolean>()
  const pinned = (el: Element | null): boolean => {
    if (!el || el === doc.body || el === doc.documentElement) return false
    let hit = cache.get(el)
    if (hit === undefined) {
      const position = doc.defaultView?.getComputedStyle(el).position
      hit = position === 'sticky' || position === 'fixed' || pinned(el.parentElement)
      cache.set(el, hit)
    }
    return hit
  }
  return pinned
}

/** Openings of the text blocks in view, skipping the strip above `below` that a sticky header usually covers. */
export function openingsAtTop(doc: Document, below: number): string[] {
  const out: string[] = []
  const pinned = pinnedTest(doc)
  for (const el of doc.body?.querySelectorAll(CANDIDATES) ?? []) {
    const rect = el.getBoundingClientRect()
    if (rect.height === 0 || rect.bottom <= below) continue
    // A sticky contents list stays in view wherever the reader is, so it would win every time.
    if (el.closest(SIDEBARS) || pinned(el)) continue
    const key = opening(el.textContent ?? '')
    if (key) out.push(key)
    if (out.length >= MAX_OPENINGS) break
  }
  return out
}

/** Scrolls the first block with this opening to just under the header strip. Says whether the page is left scrolled, or null when no block matches. */
export function revealOpening(doc: Document, win: Window, key: string, below: number): boolean | null {
  if (!key) return null
  for (const el of doc.body?.querySelectorAll(CANDIDATES) ?? []) {
    if (opening(el.textContent ?? '') !== key) continue
    win.scrollTo({ top: el.getBoundingClientRect().top + win.scrollY - below, behavior: 'instant' })
    return win.scrollY > 0
  }
  return null
}

/** The first block that one of the openings starts, trying them in order since the top of the window can hold a sidebar. */
export function matchParagraph(blocks: Block[], openings: string[]): number {
  const keys = blocks.map((b) => opening(b.text))
  for (const key of openings) {
    const at = keys.indexOf(key)
    if (at !== -1) return at
  }
  return 0
}

/** Sites append their name to the page title, so a title that starts with the page's heading becomes that heading. */
export function siteless(title: string, heading: string): string {
  return heading && heading !== title && title.toLowerCase().startsWith(heading.toLowerCase()) ? heading : title
}

/** Reads the page's article the way Reader View would, without touching the live page. */
export function extractArticle(doc: Document, openings: string[] = []): Article {
  if (doc.contentType === 'text/plain') {
    const text = doc.body?.textContent ?? ''
    if (countWords(text) < MIN_WORDS) throw new ImportError('Pacer found no article text on this page.')
    return { title: null, text, startParagraph: 0 }
  }

  const article = new Readability<Element>(doc.cloneNode(true) as Document, {
    serializer: (node) => node as Element,
  }).parse()
  let blocks = blocksFromHtml(article?.content ?? doc.body, { skipLinkLists: true })
  const title = siteless(clean(article?.title || doc.title), clean(doc.querySelector('h1')?.textContent ?? '')) || null
  // Readability drops a heading that repeats the title, so put the title back as the first heading.
  if (title && opening(blocks[0]?.text ?? '') !== opening(title)) blocks = [{ text: title, level: 1 }, ...blocks]

  const text = blocksToText(blocks)
  if (countWords(text) < MIN_WORDS) throw new ImportError('Pacer found no article text on this page.')
  return { title, text, startParagraph: matchParagraph(blocks, openings) }
}
