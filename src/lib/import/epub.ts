import { strFromU8, unzipSync } from 'fflate'
import { escapeBody } from '../text'
import { ImportError, type Imported } from './errors'

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol',
  'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])
const SKIP = new Set(['script', 'style', 'head', 'title', 'math', 'svg', 'nav', 'rt', 'rp', 'template', 'noscript'])
const OPS_NS = 'http://www.idpf.org/2007/ops'

const clean = (text: string) => text.replace(/\s+/g, ' ').trim()
const nameOf = (el: Element) => el.localName.toLowerCase()

function epubType(el: Element): string {
  return el.getAttributeNS(OPS_NS, 'type') ?? el.getAttribute('epub:type') ?? ''
}

function skipped(el: Element): boolean {
  if (SKIP.has(nameOf(el)) || el.hasAttribute('hidden')) return true
  // Project Gutenberg wraps its license and catalog header in these.
  if (el.classList.contains('pg-boilerplate')) return true
  if (/\b(noteref|footnote|endnote|rearnote|pagebreak)\b/.test(epubType(el))) return true
  // Footnote markers like <sup><a>12</a></sup> would be read aloud as stray numbers.
  return nameOf(el) === 'sup' && el.querySelector('a') !== null && /^\[?\d+\]?$/.test(clean(el.textContent ?? ''))
}

function textOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
    return (node as CharacterData).data
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  if (skipped(el)) return ''
  if (nameOf(el) === 'br') return ' '
  let out = ''
  for (const child of el.childNodes) out += textOf(child)
  return out
}

/** A paragraph of text, or a heading when level is 1 to 6. */
interface Block {
  text: string
  level: number
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

function droppedFrom(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (skipped(node) || isLinkList(node)) return true
  }
  return false
}

function collectBlocks(el: Element, out: Block[]) {
  if (skipped(el) || isLinkList(el)) return
  const heading = /^h([1-6])$/.exec(nameOf(el))
  if (heading) {
    const text = clean(textOf(el))
    if (text && !CONTENTS_HEADING.test(text)) out.push({ text, level: Number(heading[1]) })
    return
  }
  const hasBlockChild = [...el.children].some((c) => BLOCK.has(nameOf(c)) && !skipped(c))
  if (!hasBlockChild) {
    const text = clean(textOf(el))
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
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK.has(nameOf(child as Element))) {
      flush()
      collectBlocks(child as Element, out)
    } else {
      inline += textOf(child)
    }
  }
  flush()
}

function resolvePath(base: string, href: string): string {
  const parts = (base + decodeURIComponent(href.split('#')[0])).split('/')
  const stack: string[] = []
  for (const part of parts) {
    if (part === '..') stack.pop()
    else if (part && part !== '.') stack.push(part)
  }
  return stack.join('/')
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')

function parseXml(source: string): Document {
  return new DOMParser().parseFromString(source, 'application/xml')
}

function parseChapter(source: string): Element {
  let doc = new DOMParser().parseFromString(source, 'application/xhtml+xml')
  if (doc.getElementsByTagName('parsererror').length) {
    doc = new DOMParser().parseFromString(source, 'text/html')
  }
  return doc.getElementsByTagNameNS('*', 'body')[0] ?? doc.documentElement
}

/** Chapter labels by spine path, from the EPUB 3 nav document or the EPUB 2 NCX. */
function tocLabels(opf: Document, manifest: Map<string, { href: string; type: string; props: string }>, read: (p: string) => string | null) {
  const labels = new Map<string, { text: string; fragment: string | null }>()
  const add = (base: string, href: string | null, label: string | null | undefined) => {
    const path = href ? resolvePath(base, href) : ''
    const text = clean(label ?? '')
    if (path && text) {
      const fragment = href?.includes('#') ? decodeURIComponent(href.slice(href.indexOf('#') + 1)) : null
      if (!labels.has(path)) labels.set(path, { text, fragment })
      all.add(labelKey(text))
    }
  }
  const all = new Set<string>()
  const result = { byPath: labels, all }
  const nav = [...manifest.values()].find((m) => /\bnav\b/.test(m.props))
  const navSource = nav ? read(nav.href) : null
  if (nav && navSource) {
    const doc = new DOMParser().parseFromString(navSource, 'application/xhtml+xml')
    const tocNav = [...doc.getElementsByTagNameNS('*', 'nav')].find((n) => epubType(n).includes('toc'))
    for (const a of tocNav?.getElementsByTagNameNS('*', 'a') ?? []) {
      add(dirOf(nav.href), a.getAttribute('href'), a.textContent)
    }
    return result
  }
  const ncxId = opf.getElementsByTagNameNS('*', 'spine')[0]?.getAttribute('toc')
  const ncx = ncxId ? manifest.get(ncxId) : undefined
  const ncxSource = ncx ? read(ncx.href) : null
  if (ncx && ncxSource) {
    for (const point of parseXml(ncxSource).getElementsByTagNameNS('*', 'navPoint')) {
      const label = point.getElementsByTagNameNS('*', 'text')[0]?.textContent
      const src = point.getElementsByTagNameNS('*', 'content')[0]?.getAttribute('src') ?? null
      add(dirOf(ncx.href), src, label)
    }
  }
  return result
}

const labelKey = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export async function extractEpub(
  data: ArrayBuffer,
  onProgress: (message: string) => void,
): Promise<Imported> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(data))
  } catch {
    throw new ImportError('This file could not be opened as an EPUB.')
  }
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : null)

  const container = read('META-INF/container.xml')
  const opfPath = container
    ? parseXml(container).getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path')
    : null
  const opfSource = opfPath ? read(opfPath) : null
  if (!opfPath || !opfSource) throw new ImportError('This EPUB is missing its table of contents file.')

  const opf = parseXml(opfSource)
  const base = dirOf(opfPath)
  const title = clean(opf.getElementsByTagNameNS('*', 'title')[0]?.textContent ?? '') || null

  const manifest = new Map<string, { href: string; type: string; props: string }>()
  for (const item of opf.getElementsByTagNameNS('*', 'item')) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (!id || !href) continue
    manifest.set(id, {
      href: resolvePath(base, href),
      type: item.getAttribute('media-type') ?? '',
      props: item.getAttribute('properties') ?? '',
    })
  }
  const spine = [...opf.getElementsByTagNameNS('*', 'itemref')]
    .filter((ref) => ref.getAttribute('linear') !== 'no')
    .map((ref) => manifest.get(ref.getAttribute('idref') ?? ''))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  // Font obfuscation also lists files here, so only encrypted chapters mean DRM.
  const encryption = read('META-INF/encryption.xml')
  if (encryption) {
    const encrypted = new Set(
      [...parseXml(encryption).getElementsByTagNameNS('*', 'CipherReference')].map((c) =>
        resolvePath('', c.getAttribute('URI') ?? ''),
      ),
    )
    if (spine.some((item) => encrypted.has(item.href))) {
      throw new ImportError('This EPUB is DRM-protected, so its text cannot be read.')
    }
  }

  const toc = tocLabels(opf, manifest, read)
  const parts = spine.map((item, k) => {
    onProgress(`Reading part ${k + 1} of ${spine.length}`)
    const source = read(item.href)
    const root = source ? parseChapter(source) : null
    const blocks: Block[] = []
    if (root) collectBlocks(root, blocks)
    return { href: item.href, root, blocks }
  })

  const inToc = (b: Block) => b.level > 0 && toc.all.has(labelKey(b.text))
  const matched = new Set(parts.flatMap((p) => p.blocks.filter(inToc).map((b) => labelKey(b.text))))
  // When most TOC entries name a heading, the TOC is the better judge of what a chapter is.
  const trustToc = toc.all.size >= 2 && matched.size >= toc.all.size / 2
  const paragraphs: string[] = []
  for (const { href, root, blocks } of parts) {
    if (trustToc) {
      for (const b of blocks) {
        if (inToc(b)) b.level = 1
        else if (b.level === 1 || b.level === 2) b.level = 3
      }
    }
    const entry = toc.byPath.get(href)
    const target = entry?.fragment ? root?.ownerDocument.getElementById(entry.fragment) : root
    const label = target && !droppedFrom(target) ? entry?.text : undefined
    // Many books style chapter titles as plain paragraphs, so promote the one matching the TOC.
    if (label && blocks.length && !blocks.slice(0, 3).some((b) => b.level === 1 || b.level === 2)) {
      const match = blocks.slice(0, 3).findIndex((b) => labelKey(b.text) === labelKey(label))
      if (match >= 0) blocks[match].level = 1
      else blocks.unshift({ text: label, level: 1 })
    }
    for (const b of blocks) paragraphs.push(b.level ? `${'#'.repeat(b.level)} ${b.text}` : escapeBody(b.text))
  }

  const text = paragraphs.join('\n\n')
  if (!text.trim()) throw new ImportError('This EPUB has no readable text.')
  return { title, text }
}
