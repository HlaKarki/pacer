import { escapeBody } from '../text'

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol',
  'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])
const SKIP = new Set(['script', 'style', 'head', 'title', 'math', 'svg', 'nav', 'rt', 'rp', 'template', 'noscript'])
const OPS_NS = 'http://www.idpf.org/2007/ops'

/** A paragraph of text, or a heading when level is 1 to 6. */
export interface Block {
  text: string
  level: number
}

export interface HtmlOptions {
  /** Drops an element and everything inside it. */
  skip?: (el: Element) => boolean
  /** Treats an inline element as a block, like an embedded note inside a paragraph. */
  block?: (el: Element) => boolean
  /** EPUBs print their contents as link lists, but in a note a list of links is content. */
  skipLinkLists?: boolean
}

export const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
const nameOf = (el: Element) => el.localName.toLowerCase()

export function epubType(el: Element): string {
  return el.getAttributeNS(OPS_NS, 'type') ?? el.getAttribute('epub:type') ?? ''
}

function skipped(el: Element, options: HtmlOptions): boolean {
  if (SKIP.has(nameOf(el)) || el.hasAttribute('hidden')) return true
  if (options.skip?.(el)) return true
  // Project Gutenberg wraps its license and catalog header in these.
  if (el.classList.contains('pg-boilerplate')) return true
  if (/\b(noteref|footnote|endnote|rearnote|pagebreak)\b/.test(epubType(el))) return true
  // Footnote markers like <sup><a>12</a></sup> would be read aloud as stray numbers.
  return nameOf(el) === 'sup' && el.querySelector('a') !== null && /^\[?\d+\]?$/.test(clean(el.textContent ?? ''))
}

const isBlock = (el: Element, options: HtmlOptions) => BLOCK.has(nameOf(el)) || (options.block?.(el) ?? false)

function textOf(node: Node, options: HtmlOptions): string {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return (node as CharacterData).data
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  if (skipped(el, options)) return ''
  if (nameOf(el) === 'br') return ' '
  let out = ''
  for (const child of el.childNodes) out += textOf(child, options)
  return out
}

const internalLinks = (el: Element) =>
  [...el.getElementsByTagNameNS('*', 'a')].filter((a) => {
    const href = a.getAttribute('href')
    return href !== null && !/^[a-z][a-z\d+.-]*:/i.test(href)
  })

/** A printed table of contents: every row is a short internal link. */
function isLinkList(el: Element): boolean {
  const name = nameOf(el)
  if (name === 'p') {
    const links = internalLinks(el)
    return links.length > 0 && clean(links.map((a) => a.textContent).join(' ')) === clean(el.textContent ?? '')
  }
  if (name !== 'table' && name !== 'ul' && name !== 'ol') return false
  const rows = [...el.getElementsByTagNameNS('*', name === 'table' ? 'tr' : 'li')]
  return (
    rows.length >= 2 &&
    rows.every((row) => internalLinks(row).length > 0 && clean(row.textContent ?? '').split(' ').length <= 15)
  )
}

const CONTENTS_HEADING = /^(table of )?contents$/i

const dropped = (el: Element, options: HtmlOptions) =>
  skipped(el, options) || ((options.skipLinkLists ?? true) && isLinkList(el))

/** True when the element or one of its ancestors produces no blocks. */
export function droppedFrom(el: Element, options: HtmlOptions = {}): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (dropped(node, options)) return true
  }
  return false
}

function collect(el: Element, out: Block[], options: HtmlOptions) {
  if (dropped(el, options)) return
  const heading = /^h([1-6])$/.exec(nameOf(el))
  if (heading) {
    const text = clean(textOf(el, options))
    if (text && !CONTENTS_HEADING.test(text)) out.push({ text, level: Number(heading[1]) })
    return
  }
  const hasBlockChild = [...el.children].some((c) => isBlock(c, options) && !skipped(c, options))
  if (!hasBlockChild) {
    const text = clean(textOf(el, options))
    if (text) out.push({ text, level: 0 })
    return
  }
  let inline = ''
  const flush = () => {
    const text = clean(inline)
    if (text) out.push({ text, level: 0 })
    inline = ''
  }
  for (const child of el.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && isBlock(child as Element, options)) {
      flush()
      collect(child as Element, out, options)
    } else {
      inline += textOf(child, options)
    }
  }
  flush()
}

export function blocksFromHtml(root: Element, options: HtmlOptions = {}): Block[] {
  const out: Block[] = []
  collect(root, out, options)
  return out
}

/** One paragraph per block, so paragraph k of the parsed text is block k. */
export function blocksToText(blocks: Block[]): string {
  return blocks.map((b) => (b.level ? `${'#'.repeat(b.level)} ${b.text}` : escapeBody(b.text))).join('\n\n')
}
