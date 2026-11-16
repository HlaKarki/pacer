import { describe, expect, test } from 'bun:test'
import { cardState, checkBeats, checkMarks, checkTakes, MARKS, minLen, SEGS, TAKES } from './timeline.ts'

const HOOK = 'You can read any web page by following a highlight.'

describe('minLen', () => {
  test('is the caption reading time at 17 characters a second plus 1.5 s to watch', () => {
    expect(minLen({ caption: 'You can jump to any word by clicking it.' })).toBeCloseTo(40 / 17 + 1.5, 3)
  })

  test('counts an arrow as one character', () => {
    expect(minLen({ caption: '↑↓' })).toBeCloseTo(2 / 17 + 1.5, 3)
  })

  test('needs no time for a beat without a caption', () => {
    expect(minLen({ caption: '' })).toBe(0)
  })
})

describe('checkBeats', () => {
  test('flags a beat shorter than its caption needs', () => {
    expect(checkBeats([{ len: 3, caption: HOOK }])).toHaveLength(1)
  })

  test('passes a beat long enough to read and watch', () => {
    expect(checkBeats([{ len: 5, caption: HOOK }])).toEqual([])
  })
})

describe('checkTakes', () => {
  test('flags a beat that runs past the end of its take', () => {
    expect(checkTakes([{ len: 5.5, clip: 'epub', from: 2.0, caption: '' }], { epub: 7 })).toHaveLength(1)
  })

  test('flags a beat whose take has no length', () => {
    expect(checkTakes([{ len: 1, clip: 'nope', from: 0, caption: '' }], {})).toHaveLength(1)
  })
})

describe('checkMarks', () => {
  const beat = { len: 5, clip: 'article', from: 10, caption: '', keys: [['m', ['Space']]] as [string, string[]][] }

  test('flags a key pressed less than 0.8 s into its beat', () => {
    expect(checkMarks([beat], { article: { m: 10.5 } })).toHaveLength(1)
  })

  test('flags a key pressed less than 1.0 s before its beat ends', () => {
    expect(checkMarks([beat], { article: { m: 14.5 } })).toHaveLength(1)
  })

  test('flags a click with the same rule', () => {
    expect(checkMarks([{ len: 5, clip: 'article', from: 10, caption: '', click: 'c' }], { article: { c: 10.2 } })).toHaveLength(1)
  })

  test('flags a key with no planned time', () => {
    expect(checkMarks([beat], { article: {} })).toHaveLength(1)
  })

  test('passes a key pressed well inside its beat', () => {
    expect(checkMarks([beat], { article: { m: 12 } })).toEqual([])
  })
})

describe('the recut timeline', () => {
  test('gives every caption enough time', () => {
    expect(checkBeats(SEGS)).toEqual([])
  })

  test('keeps every beat inside its take', () => {
    expect(checkTakes(SEGS, TAKES)).toEqual([])
  })

  test('keeps every key and click inside its beat', () => {
    expect(checkMarks(SEGS, MARKS)).toEqual([])
  })

  test('opens the three chapters with cards in order', () => {
    expect(SEGS.flatMap((s) => (s.card ? [s.card] : []))).toEqual(['On any web page', 'In Obsidian', 'PDFs and EPUBs'])
  })

  test('runs 57 s', () => {
    expect(SEGS.reduce((sum, s) => sum + s.len, 0)).toBeCloseTo(57, 6)
  })
})

describe('cardState', () => {
  test('fades the card in over 0.3 s', () => {
    expect(cardState(0).o).toBe(0)
    expect(cardState(0.3).o).toBe(1)
  })

  test('holds the card, then fades it out by 1.5 s', () => {
    expect(cardState(1.2).o).toBe(1)
    expect(cardState(1.5).o).toBe(0)
  })

  test('leaves the last 0.5 s empty', () => {
    expect(cardState(1.8).o).toBe(0)
  })

  test('sweeps the marker from 0.2 s to 0.7 s', () => {
    expect(cardState(0.2).sweep).toBe(0)
    expect(cardState(0.7).sweep).toBe(1)
  })

  test('shows the title from 0.2 s to 0.45 s', () => {
    expect(cardState(0.2).word).toBe(0)
    expect(cardState(0.45).word).toBe(1)
  })
})
