import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { chunkAt, escapeBody, parse, SECTION_WORDS, sectionAt, sentenceStart } from './text'
import { orpIndex, rampFactor, weightPrefix, wordCost } from './timing'
import { parseFrequency, UNKNOWN_ZIPF, zipfOf } from './frequency'

const freq = parseFrequency(readFileSync(new URL('../data/frequency.txt', import.meta.url), 'utf8'))

describe('parse', () => {
  test('an escaped hash stays body text', () => {
    const doc = parse(`${escapeBody('# layers 16')}\n\n# Real heading`)
    expect(doc.paragraphs.map((p) => p.heading)).toEqual([0, 1])
    expect(doc.words[0].text).toBe('#')
  })

  test('blank lines split paragraphs and single newlines join wrapped lines', () => {
    const doc = parse('One two\nthree.\n\nFour five.')
    expect(doc.paragraphs).toEqual([
      { start: 0, end: 3, heading: 0 },
      { start: 3, end: 5, heading: 0 },
    ])
    expect(doc.words.map((w) => w.text)).toEqual(['One', 'two', 'three.', 'Four', 'five.'])
  })

  test('single newlines split paragraphs when the text has no blank lines', () => {
    expect(parse('First line.\nSecond line.').paragraphs).toHaveLength(2)
  })

  test('marks clause, sentence and paragraph pauses', () => {
    const doc = parse('Well, it works. Really?\n\nYes')
    expect(doc.words.map((w) => w.pause)).toEqual([
      'clause',
      'none',
      'sentence',
      'paragraph',
      'paragraph',
    ])
  })

  test('abbreviations and initials do not end a sentence', () => {
    const doc = parse('Dr. J. Smith met Mr. Jones, e.g. today.')
    expect(doc.sentences).toHaveLength(1)
  })

  test('closing quotes still end a sentence', () => {
    const doc = parse('He said “stop.” Then left.')
    expect(doc.words[2].pause).toBe('sentence')
    expect(doc.sentences).toHaveLength(2)
  })

  test('sentenceStart finds the first word of the sentence', () => {
    const doc = parse('A b c. D e f.')
    expect(sentenceStart(doc, 4)).toBe(3)
    expect(sentenceStart(doc, 1)).toBe(0)
  })

  test('empty input yields an empty doc', () => {
    expect(parse('  \n\n ').words).toHaveLength(0)
  })

  test('markdown headings are read as words and open chapters', () => {
    const doc = parse('Preface text.\n\n# Chapter One\n\nBody.\n\n### Aside\n\nMore.')
    expect(doc.words.map((w) => w.text)).toEqual(['Preface', 'text.', 'Chapter', 'One', 'Body.', 'Aside', 'More.'])
    expect(doc.paragraphs.map((p) => p.heading)).toEqual([0, 1, 0, 3, 0])
    expect(doc.sections.map((s) => s.title)).toEqual([null, 'Chapter One'])
  })

  test('long chapters split into windows that keep the chapter title', () => {
    const para = Array.from({ length: 1000 }, () => 'word').join(' ')
    const doc = parse(`# Long\n\n${Array.from({ length: 6 }, () => para).join('\n\n')}`)
    expect(doc.sections.length).toBe(2)
    expect(doc.sections[1]).toMatchObject({ title: 'Long', opensChapter: false })
    expect(doc.sections[0].end - doc.sections[0].start).toBeGreaterThanOrEqual(SECTION_WORDS)
    expect(sectionAt(doc, doc.sections[1].start + 5)).toBe(doc.sections[1])
    expect(sectionAt(doc, 0)).toBe(doc.sections[0])
  })
})

describe('chunkAt', () => {
  const doc = parse('one two three, four five six seven.\n\neight nine')

  test('groups up to size words', () => {
    expect(chunkAt(doc, 0, 2)).toEqual({ start: 0, end: 2 })
  })

  test('stops after a pause', () => {
    expect(chunkAt(doc, 1, 3)).toEqual({ start: 1, end: 3 })
  })

  test('never crosses a paragraph', () => {
    expect(chunkAt(doc, 6, 3)).toEqual({ start: 6, end: 7 })
  })

  test('respects line breaks when a line map is given', () => {
    const lineOf = (i: number) => (i < 5 ? 0 : 1)
    expect(chunkAt(doc, 4, 3, lineOf)).toEqual({ start: 4, end: 5 })
  })

  test('phrase mode attaches function words to the word they lead into', () => {
    const text = 'the eye holds still for roughly a quarter of a second'
    const phrases = []
    const d = parse(text)
    for (let i = 0; i < d.words.length; ) {
      const c = chunkAt(d, i, 'phrase')
      phrases.push(d.words.slice(c.start, c.end).map((w) => w.text).join(' '))
      i = c.end
    }
    expect(phrases).toEqual(['the eye', 'holds', 'still', 'for roughly', 'a quarter', 'of a second'])
  })

  test('phrase mode stops at long words', () => {
    const d = parse('the incomprehensibility was')
    expect(chunkAt(d, 0, 'phrase')).toEqual({ start: 0, end: 1 })
  })
})

describe('frequency', () => {
  test('common words score high and rare words low', () => {
    expect(zipfOf('the', freq)).toBeGreaterThan(7)
    expect(zipfOf('comprehension', freq)).toBeLessThan(4)
    expect(zipfOf('saccade', freq)).toBe(UNKNOWN_ZIPF)
  })

  test('lookups ignore case, punctuation and contraction tails', () => {
    expect(zipfOf('“The,', freq)).toBe(zipfOf('the', freq))
    expect(zipfOf("don't", freq)).toBeGreaterThan(6)
  })

  test('compounds take their rarest part', () => {
    expect(zipfOf('well-saccade', freq)).toBe(UNKNOWN_ZIPF)
  })
})

describe('timing', () => {
  const flat = { pauses: false, smart: false, freq: null }
  const smart = { pauses: false, smart: true, freq }

  test('pauses add weight only when enabled', () => {
    const doc = parse('end.')
    expect(weightPrefix(doc, flat)[1]).toBe(1)
    expect(weightPrefix(doc, { ...flat, pauses: true })[1]).toBeGreaterThan(2)
  })

  test('rare and long words cost more than common short ones', () => {
    expect(wordCost('regressions', freq)).toBeGreaterThan(1.4)
    expect(wordCost('the', freq)).toBeLessThan(0.7)
    expect(wordCost('reading', freq)).toBeGreaterThan(wordCost('the', freq))
  })

  test('smart weights average to one word per word, so wpm stays honest', () => {
    const doc = parse('The eye holds still for roughly a quarter of a second, called a fixation.')
    const prefix = weightPrefix(doc, smart)
    expect(prefix[doc.words.length]).toBeCloseTo(doc.words.length, 6)
  })

  test('flat pacing gives every word the same weight', () => {
    const prefix = weightPrefix(parse('a b c'), flat)
    expect(prefix[3]).toBe(3)
  })

  test('ramp starts slow and settles at 1', () => {
    expect(rampFactor(0)).toBeGreaterThan(1.5)
    expect(rampFactor(6)).toBe(1)
  })

  test('ORP skips leading punctuation', () => {
    expect(orpIndex('reading')).toBe(2)
    expect(orpIndex('“reading')).toBe(3)
    expect(orpIndex('a')).toBe(0)
  })
})
