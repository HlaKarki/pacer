import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { blocksFromHtml, sourcedBlocksFromHtml, type HtmlOptions, type SourcedBlock } from './html'

const window = new Window()
globalThis.Node = window.Node as unknown as typeof Node

const body = (html: string) => {
  const doc = new window.DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html')
  return doc.body as unknown as Element
}

const FIXTURES: { name: string; html: string; options?: HtmlOptions }[] = [
  {
    name: 'an article with nested blocks and inline runs',
    html: `<article><h1>How  Eyes
      Read</h1><p>Your eyes <em>do not</em> glide,<br>they jump.</p>
      <div>Loose text before <p>a nested paragraph</p> and loose text after</div>
      <blockquote><p>Quoted line one.</p>Trailing quote text</blockquote>
      <ul><li>First <a href="https://example.com">item</a></li><li>Second item</li></ul></article>`,
  },
  {
    name: 'footnotes, hidden text and a contents heading',
    html: `<h2>Contents</h2>
      <p>Words with a note<sup><a href="#n1">12</a></sup> and a <sup>2</sup> exponent.</p>
      <p hidden>Never shown.</p><script>var x = 1</script><nav>Home About</nav>
      <p>Visible <span hidden>secret</span>end.</p>`,
  },
  {
    name: 'skip and block options',
    html: `<div class="note">Kept <span class="drop">dropped</span> text <span class="aside">an inline note</span> after the note.</div>`,
    options: {
      skip: (el) => el.classList.contains('drop'),
      block: (el) => el.classList.contains('aside'),
      skipLinkLists: false,
    },
  },
  {
    name: 'link lists kept when asked',
    html: `<ul><li><a href="#a">Chapter one</a></li><li><a href="#b">Chapter two</a></li></ul><p>Body.</p>`,
    options: { skipLinkLists: false },
  },
  {
    name: 'a table and a code block',
    html: `<table><tr><th>Name</th><td>Pacer  reader</td></tr></table><pre>const  x =
  1</pre>`,
  },
]

const EXPECTED = [
  [
    { text: 'How Eyes Read', level: 1 },
    { text: 'Your eyes do not glide, they jump.', level: 0 },
    { text: 'Loose text before', level: 0 },
    { text: 'a nested paragraph', level: 0 },
    { text: 'and loose text after', level: 0 },
    { text: 'Quoted line one.', level: 0 },
    { text: 'Trailing quote text', level: 0 },
    { text: 'First item', level: 0 },
    { text: 'Second item', level: 0 },
  ],
  [
    { text: 'Words with a note and a 2 exponent.', level: 0 },
    { text: 'Visible end.', level: 0 },
  ],
  [
    { text: 'Kept text', level: 0 },
    { text: 'an inline note', level: 0 },
    { text: 'after the note.', level: 0 },
  ],
  [
    { text: 'Chapter one', level: 0 },
    { text: 'Chapter two', level: 0 },
    { text: 'Body.', level: 0 },
  ],
  [
    { text: 'Name', level: 0 },
    { text: 'Pacer reader', level: 0 },
    { text: 'const x = 1', level: 0 },
  ],
]

describe('blocksFromHtml', () => {
  FIXTURES.forEach(({ name, html, options }, k) => {
    test(name, () => {
      expect(blocksFromHtml(body(html), options)).toEqual(EXPECTED[k])
    })
  })
})

function fromNodes(block: SourcedBlock, start: number, end: number): string {
  let out = ''
  for (const [k, { node, at }] of block.pieces.entries()) {
    const stop = block.pieces[k + 1]?.at ?? block.raw.length
    const from = Math.max(start, at)
    const to = Math.min(end, stop, at + node.data.length)
    if (from < to) out += node.data.slice(from - at, to - at)
  }
  return out
}

describe('sourcedBlocksFromHtml', () => {
  FIXTURES.forEach(({ name, html, options }, k) => {
    test(`gives the pinned blocks: ${name}`, () => {
      const sourced = sourcedBlocksFromHtml(body(html), options)
      expect(sourced.map(({ text, level }) => ({ text, level }))).toEqual(EXPECTED[k])
    })

    test(`slices every token back out of its text nodes: ${name}`, () => {
      for (const block of sourcedBlocksFromHtml(body(html), options)) {
        for (const match of block.raw.matchAll(/\S+/g)) {
          expect(fromNodes(block, match.index, match.index + match[0].length)).toBe(match[0])
        }
      }
    })
  })

  test('points at the live text nodes', () => {
    const root = body('<p>Your eyes <em>do not</em> glide.</p>')
    const [block] = sourcedBlocksFromHtml(root)
    const em = root.querySelector('em')!
    expect(block.pieces.map((p) => p.node.data)).toEqual(['Your eyes ', 'do not', ' glide.'])
    expect(block.pieces[1]).toEqual({ node: em.firstChild as Text, at: 10 })
  })
})
