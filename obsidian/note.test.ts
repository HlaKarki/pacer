import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { blocksToText } from '../src/lib/import/html'
import { parse } from '../src/lib/text'
import {
  blocksFromSections,
  lineAtWord,
  linkDefinitions,
  paragraphAtLine,
  prepareSection,
  startIndex,
  stripFrontmatter,
  type RenderedSection,
} from './note'
import { PacerStore, type PluginData } from './places'

const window = new Window()
globalThis.Node = window.Node as unknown as typeof Node
const document = window.document as unknown as Document

type Child = Node | string

// Built with DOM calls, since Obsidian nests divs inside paragraphs and an HTML parser would split them.
function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value)
  for (const child of children) el.append(typeof child === 'string' ? document.createTextNode(child) : child)
  return el
}

const section = (el: Element, line = 0, type = 'paragraph', itemLines: number[] = []): RenderedSection => ({
  type,
  line,
  el: h('div', {}, el),
  itemLines,
})

const texts = (...els: Element[]) => blocksFromSections(els.map((el) => section(el))).blocks.map((b) => b.text)

describe('Obsidian markup', () => {
  test('reads a callout title and its body', () => {
    const callout = h(
      'div',
      { class: 'callout', 'data-callout': 'tip' },
      h('div', { class: 'callout-title' }, h('div', { class: 'callout-icon' }, h('svg')), h('div', { class: 'callout-title-inner' }, 'Remember this')),
      h('div', { class: 'callout-content' }, h('p', {}, 'Callout body text.')),
    )
    expect(texts(callout)).toEqual(['Remember this', 'Callout body text.'])
  })

  test('reads tasks without their checkboxes and keeps nested items apart', () => {
    const list = h(
      'ul',
      { class: 'contains-task-list' },
      h('li', { class: 'task-list-item', 'data-task': ' ' }, h('input', { type: 'checkbox' }), 'Buy milk'),
      h(
        'li',
        { class: 'task-list-item is-checked', 'data-task': 'x' },
        h('input', { type: 'checkbox', checked: '' }),
        'Call Sam',
        h('ul', {}, h('li', {}, 'Ask about Friday')),
      ),
    )
    const { blocks, lines } = blocksFromSections([section(list, 4, 'list', [4, 5, 6])])
    expect(blocks.map((b) => b.text)).toEqual(['Buy milk', 'Call Sam', 'Ask about Friday'])
    expect(lines).toEqual([4, 5, 6])
  })

  test('reads an embedded note as its own paragraphs and drops its title', () => {
    const embed = h(
      'span',
      { class: 'internal-embed markdown-embed inline-embed is-loaded', src: 'Other' },
      h('div', { class: 'embed-title markdown-embed-title' }, 'Other'),
      h(
        'div',
        { class: 'markdown-embed-content' },
        h('div', { class: 'markdown-preview-view' }, h('div', {}, h('p', {}, 'Embedded first.')), h('div', {}, h('p', {}, 'Embedded second.'))),
      ),
      h('div', { class: 'markdown-embed-link' }, h('svg')),
    )
    expect(texts(h('p', {}, 'Intro line.', embed))).toEqual(['Intro line.', 'Embedded first.', 'Embedded second.'])
  })

  test('skips image and file embeds, code, math and footnote markers', () => {
    const paragraph = h(
      'p',
      {},
      'Text',
      h('sup', { class: 'footnote-ref' }, h('a', { href: '#fn-1' }, '[1]')),
      ' with ',
      h('span', { class: 'math math-inline' }, 'x^2'),
      ' math.',
    )
    const image = h('p', {}, h('span', { class: 'internal-embed image-embed is-loaded', src: 'pic.png' }, h('img', { src: 'pic.png' })))
    const pdf = h('p', {}, h('span', { class: 'internal-embed pdf-embed', src: 'paper.pdf' }, 'Page 1 text'))
    const code = h('pre', {}, h('code', {}, 'const x = 1'))
    expect(texts(paragraph, image, pdf, code)).toEqual(['Text with math.'])
  })

  test('drops link-only lists and tag lines but keeps links inside prose', () => {
    const moc = h('ul', {}, h('li', {}, h('a', { class: 'internal-link', href: 'A' }, 'A')), h('li', {}, h('a', { class: 'internal-link', href: 'B' }, 'B')))
    const tags = h('p', {}, h('a', { class: 'tag', href: '#reading' }, '#reading'), ' ', h('a', { class: 'tag', href: '#book' }, '#book'))
    const prose = h('ul', {}, h('li', {}, h('a', { class: 'internal-link', href: 'Atomic Habits' }, 'Atomic Habits'), ' taught me habit stacking'))
    expect(texts(moc, tags, prose)).toEqual(['Atomic Habits taught me habit stacking'])
  })

  test('reads tables cell by cell and keeps heading levels', () => {
    const heading = h('h2', { 'data-heading': 'Plan' }, 'Plan')
    const table = h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Day'), h('th', {}, 'Task'))),
      h('tbody', {}, h('tr', {}, h('td', {}, 'Monday'), h('td', {}, 'Read chapter one'))),
    )
    const { blocks } = blocksFromSections([section(heading, 0, 'heading'), section(table, 2, 'table')])
    expect(blocksToText(blocks)).toBe('## Plan\n\nDay\n\nTask\n\nMonday\n\nRead chapter one')
  })

  test('keeps a paragraph that starts with a tag as body text', () => {
    const p = h('p', {}, h('a', { class: 'tag', href: '#idea' }, '#idea'), ' worth reading twice')
    const doc = parse(blocksToText(blocksFromSections([section(p)]).blocks))
    expect(doc.paragraphs[0].heading).toBe(0)
    expect(doc.words[0].text).toBe('#idea')
  })
})

describe('paragraph lines', () => {
  const sections = [
    section(h('h1', {}, 'Trip notes'), 0, 'heading'),
    section(h('p', {}, 'We left early and the roads were empty.'), 2, 'paragraph'),
    section(h('ul', {}, h('li', {}, 'Pack the tent'), h('li', {}, 'Check the weather')), 4, 'list', [4, 5]),
    section(h('p', {}, 'The second day was slower.'), 7, 'paragraph'),
  ]
  const { blocks, lines } = blocksFromSections(sections)
  const doc = parse(blocksToText(blocks))

  test('gives every parsed paragraph a source line', () => {
    expect(doc.paragraphs).toHaveLength(lines.length)
    expect(lines).toEqual([0, 2, 4, 5, 7])
  })

  test('falls back to the section line when list items and blocks do not pair up', () => {
    const loose = section(h('ul', {}, h('li', {}, h('p', {}, 'First thought.'), h('p', {}, 'Second thought.'))), 9, 'list', [9])
    expect(blocksFromSections([loose]).lines).toEqual([9, 9])
  })

  test('maps a line to the paragraph it falls in', () => {
    expect(paragraphAtLine(lines, 0)).toBe(0)
    expect(paragraphAtLine(lines, 3)).toBe(1)
    expect(paragraphAtLine(lines, 6)).toBe(3)
    expect(paragraphAtLine(lines, 40)).toBe(4)
  })

  test('starts at the first paragraph of a section that shares one line', () => {
    const table = [0, 2, 2, 2, 7]
    expect(paragraphAtLine(table, 2)).toBe(1)
    expect(paragraphAtLine(table, 5)).toBe(1)
    expect(paragraphAtLine(table, 7)).toBe(4)
  })

  test('maps a word back to its source line', () => {
    expect(lineAtWord(doc, lines, doc.paragraphs[3].start + 1)).toBe(5)
  })
})

describe('start rule', () => {
  const doc = parse('# Title\n\nOne two three.\n\nFour five six.')
  const lines = [0, 2, 4]

  test('the cursor line wins over the saved place', () => {
    expect(startIndex(doc, lines, 4, 1)).toBe(doc.paragraphs[2].start)
  })

  test('the saved place applies when there is no cursor', () => {
    expect(startIndex(doc, lines, null, 3)).toBe(3)
  })

  test('a saved place past the end of an edited note is ignored', () => {
    expect(startIndex(doc, lines, null, 99)).toBe(0)
  })

  test('a cursor without known lines falls back to the saved place', () => {
    expect(startIndex(doc, null, 4, 2)).toBe(2)
  })
})

describe('section markdown', () => {
  test('removes footnote markers but keeps definitions', () => {
    expect(prepareSection('A claim.[^1] More.[^note]', '')).toBe('A claim. More.')
    expect(prepareSection('[^1]: The source.', '')).toBe('[^1]: The source.')
  })

  test('carries link definitions into every section', () => {
    const defs = linkDefinitions('See [the docs][docs].\n\n[docs]: https://example.com\n[^1]: Not a link.')
    expect(defs).toBe('[docs]: https://example.com')
    expect(prepareSection('See [the docs][docs].', defs)).toBe('See [the docs][docs].\n\n[docs]: https://example.com')
  })

  test('strips frontmatter', () => {
    expect(stripFrontmatter('---\ntags: [a]\n---\nBody text.')).toBe('Body text.')
    expect(stripFrontmatter('No frontmatter.\n---\n')).toBe('No frontmatter.\n---\n')
  })
})

describe('PacerStore', () => {
  const store = (saved: unknown = {}) => {
    const writes: PluginData[] = []
    const s = new PacerStore(saved, async (data) => {
      writes.push(structuredClone(data))
    })
    return { s, writes }
  }

  test('shares one settings object and notifies every tab', () => {
    const { s } = store({ settings: { wpm: 420 } })
    let calls = 0
    s.subscribe(() => calls++)
    expect(s.getSettings().wpm).toBe(420)
    const before = s.getSettings()
    s.updateSettings({ mode: 'focus' })
    expect(calls).toBe(1)
    expect(s.getSettings()).not.toBe(before)
    expect(s.getSettings()).toMatchObject({ wpm: 420, mode: 'focus', chunk: 1 })
  })

  test('moves places with a renamed folder and drops them with a deleted one', async () => {
    const { s, writes } = store({ places: { 'Books/a.md': 10, 'Books/sub/b.md': 20, 'Other.md': 5 } })
    s.move('Books', 'Library')
    s.drop('Other.md')
    await s.flush()
    expect(writes.at(-1)?.places).toEqual({ 'Library/a.md': 10, 'Library/sub/b.md': 20 })
  })

  test('batches writes and survives a failed save', async () => {
    const failing = new PacerStore({}, async () => {
      throw new Error('disk full')
    })
    failing.setPlace('a.md', 3)
    const warn = console.warn
    const warnings: unknown[] = []
    console.warn = (...args: unknown[]) => warnings.push(args)
    await failing.flush()
    console.warn = warn
    expect(warnings).toHaveLength(1)
    expect(failing.place('a.md')).toBe(3)
  })

  test('writes nothing when nothing changed', async () => {
    const { s, writes } = store({ places: { 'a.md': 3 } })
    s.setPlace('a.md', 3)
    await s.flush()
    expect(writes).toHaveLength(0)
  })
})
