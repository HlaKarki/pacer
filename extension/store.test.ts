import { describe, expect, test } from 'bun:test'
import { parse } from '../src/lib/text'
import { startFrom } from './store'

const doc = parse('One two three.\n\nFour five six.\n\nSeven eight nine.')

describe('startFrom', () => {
  test('starts at the hinted paragraph without a saved place', () => {
    expect(startFrom(doc, 0, undefined)).toBe(0)
    expect(startFrom(doc, 2, undefined)).toBe(6)
  })

  test('resumes a saved place when reading starts from the same paragraph', () => {
    expect(startFrom(doc, 1, { index: 5, words: 9, from: 1 })).toBe(5)
  })

  test('follows the new paragraph when the reader scrolled or paged elsewhere', () => {
    expect(startFrom(doc, 2, { index: 5, words: 9, from: 1 })).toBe(6)
  })

  test('starts over when the document changed since the place was saved', () => {
    expect(startFrom(doc, 0, { index: 5, words: 12, from: 0 })).toBe(0)
  })

  test('keeps a stale index inside the document', () => {
    expect(startFrom(doc, 0, { index: 40, words: 9, from: 0 })).toBe(8)
    expect(startFrom(doc, 7, undefined)).toBe(0)
  })
})
