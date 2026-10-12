import { describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { parse } from '../src/lib/text'
import { extractArticle, matchParagraph, opening, revealOpening, siteless } from './article'

const window = new Window()
globalThis.Node = window.Node as unknown as typeof Node

function page(body: string, title = 'How Eyes Read', contentType = 'text/html'): Document {
  const doc = new window.DOMParser().parseFromString(
    `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`,
    contentType as DOMParserSupportedType,
  ) as unknown as Document
  return doc
}

const para = (n: number) =>
  `<p>Paragraph ${n} opens with its number, and then it keeps going long enough that a reader-view parser treats it as body text worth keeping in the article.</p>`

const ARTICLE = `
  <nav><ul><li><a href="/">Home</a></li><li><a href="/about">About</a></li></ul></nav>
  <header><a href="/">The Reading Blog</a></header>
  <article>
    <h1>How Eyes Read</h1>
    ${[1, 2, 3].map(para).join('')}
    <h2>Fixations</h2>
    ${[4, 5, 6].map(para).join('')}
  </article>
  <footer><p>Copyright 2026 The Reading Blog. All rights reserved.</p></footer>`

describe('extractArticle', () => {
  test('keeps the article and drops the site chrome', () => {
    const { title, text } = extractArticle(page(ARTICLE))
    expect(title).toBe('How Eyes Read')
    const paragraphs = text.split('\n\n')
    expect(paragraphs[0]).toBe('# How Eyes Read')
    expect(paragraphs).toContain('## Fixations')
    expect(text).toContain('Paragraph 6 opens')
    expect(text).not.toContain('Copyright')
    expect(text).not.toContain('Home')
  })

  test('drops the site name from a short title', () => {
    expect(extractArticle(page(ARTICLE, 'How Eyes Read | The Reading Blog')).title).toBe('How Eyes Read')
  })

  test('starts at the paragraph that was at the top of the window', () => {
    const { text, startParagraph } = extractArticle(page(ARTICLE), [opening(para(5).slice(3))])
    const doc = parse(text)
    const first = doc.paragraphs[startParagraph]
    expect(doc.words[first.start].text).toBe('Paragraph')
    expect(doc.words[first.start + 1].text).toBe('5')
  })

  test('leaves the page itself untouched', () => {
    const doc = page(ARTICLE)
    const before = doc.body.innerHTML
    extractArticle(doc)
    expect(doc.body.innerHTML).toBe(before)
  })

  test('refuses a page with almost no text', () => {
    expect(() => extractArticle(page('<p>Sign in to continue.</p>'))).toThrow('Pacer found no article text on this page.')
  })

  test('reads a plain text file as written, blank lines and all', () => {
    const raw = 'First paragraph of the notes runs on for a while, long enough to be a real paragraph.\n\nSecond paragraph keeps going so the file clears the minimum length Pacer asks of a page.'
    const doc = page(`<pre>${raw}</pre>`)
    Object.defineProperty(doc, 'contentType', { value: 'text/plain' })
    const { text, startParagraph } = extractArticle(doc)
    expect(text).toBe(raw)
    expect(startParagraph).toBe(0)
  })
})

test('siteless keeps titles that do not start with the heading', () => {
  expect(siteless('How Eyes Read - Blog', 'How eyes read')).toBe('How eyes read')
  expect(siteless('How Eyes Read', 'The Reading Blog')).toBe('How Eyes Read')
  expect(siteless('How Eyes Read', '')).toBe('How Eyes Read')
})

describe('matchParagraph', () => {
  const blocks = [
    { text: 'How Eyes Read', level: 1 },
    { text: 'Your eyes do not glide across a page, they jump.', level: 0 },
    { text: 'Fixations', level: 2 },
    { text: 'Skilled readers make fewer fixations per line.', level: 0 },
  ]

  test('ignores case and punctuation', () => {
    expect(matchParagraph(blocks, [opening('“Skilled readers” make FEWER fixations, per line')])).toBe(3)
  })

  test('skips openings that match nothing, like a sidebar', () => {
    expect(matchParagraph(blocks, [opening('Subscribe to our newsletter'), opening('Fixations')])).toBe(2)
  })

  test('starts at the top when nothing matches', () => {
    expect(matchParagraph(blocks, [opening('Related posts')])).toBe(0)
    expect(matchParagraph(blocks, [])).toBe(0)
  })
})

describe('revealOpening', () => {
  function scroller() {
    const doc = page(ARTICLE)
    const top = new Map([...doc.querySelectorAll('p')].map((p, i) => [p, 400 + i * 200]))
    for (const [p, y] of top) p.getBoundingClientRect = () => ({ top: y - win.scrollY }) as DOMRect
    const win = {
      scrollY: 0,
      scrollTo({ top }: ScrollToOptions) {
        win.scrollY = Math.max(0, top ?? 0)
      },
    }
    return { doc, win: win as unknown as Window & { scrollY: number } }
  }

  test('scrolls the matching paragraph to just under the header strip', () => {
    const { doc, win } = scroller()
    const text = doc.querySelectorAll('p')[3]!.textContent!
    expect(revealOpening(doc, win, opening(text), 100)).toBe(true)
    expect(win.scrollY).toBe(400 + 3 * 200 - 100)
  })

  test('reports an unscrolled page when the paragraph sits near the top', () => {
    const { doc, win } = scroller()
    expect(revealOpening(doc, win, opening(doc.querySelector('p')!.textContent!), 500)).toBe(false)
  })

  test('leaves the page alone when nothing matches', () => {
    const { doc, win } = scroller()
    expect(revealOpening(doc, win, opening('Nothing on this page starts like this'), 100)).toBeNull()
    expect(revealOpening(doc, win, '', 100)).toBeNull()
    expect(win.scrollY).toBe(0)
  })
})
