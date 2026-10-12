import { describe, expect, test } from 'bun:test'
import { WPM_MAX, WPM_MIN } from './storage'
import { parse } from './text'
import { chunkMs, rampFactor, weightPrefix } from './timing'
import { chunkDelayMs, clampWpm, nextSentenceTarget, prevSentenceTarget } from './transport'

const doc = parse('One two three four. Five six seven eight. Nine ten.')
const flat = weightPrefix(doc, { pauses: false, smart: false, freq: null })

test('clampWpm keeps the pace inside the slider range', () => {
  expect(clampWpm(WPM_MIN - 25)).toBe(WPM_MIN)
  expect(clampWpm(WPM_MAX + 25)).toBe(WPM_MAX)
  expect(clampWpm(425)).toBe(425)
})

describe('chunkDelayMs', () => {
  const chunk = { start: 0, end: 2 }

  test('ramps word chunks up after play', () => {
    expect(chunkDelayMs(flat, chunk, 300, 2, 0)).toBeCloseTo(chunkMs(flat, chunk, 300) * rampFactor(0), 6)
    expect(chunkDelayMs(flat, chunk, 300, 'phrase', 6)).toBe(chunkMs(flat, chunk, 300))
  })

  test('holds a sentence chunk for its plain duration from the first one', () => {
    const sentence = { start: 0, end: 4 }
    expect(chunkDelayMs(flat, sentence, 300, 'sentence', 0)).toBe(chunkMs(flat, sentence, 300))
  })
})

describe('prevSentenceTarget', () => {
  test('restarts the sentence once the reader is past its first word', () => {
    expect(prevSentenceTarget(doc, 6, false)).toBe(4)
  })

  test('goes back a sentence from the first word', () => {
    expect(prevSentenceTarget(doc, 4, false)).toBe(0)
  })

  test('gives a playing reader a grace of three words', () => {
    expect(prevSentenceTarget(doc, 6, true)).toBe(0)
    expect(prevSentenceTarget(doc, 7, true)).toBe(4)
  })

  test('stays at the start of the text', () => {
    expect(prevSentenceTarget(doc, 0, false)).toBe(0)
  })
})

describe('nextSentenceTarget', () => {
  test('moves to the first word of the next sentence', () => {
    expect(nextSentenceTarget(doc, 1)).toBe(4)
    expect(nextSentenceTarget(doc, 4)).toBe(8)
  })

  test('stops on the last word in the last sentence', () => {
    expect(nextSentenceTarget(doc, 8)).toBe(9)
  })
})
