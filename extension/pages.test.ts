import { describe, expect, test } from 'bun:test'
import { nameFromUrl, pageFromUrl, paragraphOnPage, withPage, withoutHash } from './pages'

describe('page hashes', () => {
  test('reads the page from a hash', () => {
    expect(pageFromUrl('https://x.org/a.pdf#page=12')).toBe(12)
    expect(pageFromUrl('https://x.org/a.pdf#zoom=80&page=3')).toBe(3)
  })

  test('ignores missing and zero pages', () => {
    expect(pageFromUrl('https://x.org/a.pdf')).toBeNull()
    expect(pageFromUrl('https://x.org/a.pdf#page=0')).toBeNull()
    expect(pageFromUrl('https://x.org/a.pdf?page=4')).toBeNull()
  })

  test('replaces any old hash', () => {
    expect(withPage('https://x.org/a.pdf#page=2', 9)).toBe('https://x.org/a.pdf#page=9')
    expect(withoutHash('https://x.org/a?b=1#c')).toBe('https://x.org/a?b=1')
  })
})

describe('paragraphOnPage', () => {
  const pages = [1, 1, 2, 4, 4]

  test('finds the first paragraph on the page', () => {
    expect(paragraphOnPage(pages, 1)).toBe(0)
    expect(paragraphOnPage(pages, 2)).toBe(2)
    expect(paragraphOnPage(pages, 4)).toBe(3)
  })

  test('moves on to the next page with text', () => {
    expect(paragraphOnPage(pages, 3)).toBe(3)
  })

  test('stays on the last paragraph past the end', () => {
    expect(paragraphOnPage(pages, 9)).toBe(4)
    expect(paragraphOnPage([], 2)).toBe(0)
  })
})

test('nameFromUrl turns a file name into a title', () => {
  expect(nameFromUrl('https://x.org/papers/attention_is-all.pdf')).toBe('attention is all')
  expect(nameFromUrl('file:///Users/me/My%20Book.pdf')).toBe('My Book')
  expect(nameFromUrl('https://x.org/')).toBeNull()
})
