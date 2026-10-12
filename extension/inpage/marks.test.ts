import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { parse } from '../../src/lib/text'
import { WordMap } from './map'
import { lightness, Marks, oklab, toneOf, type ToneRun } from './marks'

const window = new Window()
globalThis.Node = window.Node as unknown as typeof Node
const document = window.document as unknown as Document

// happy-dom has no Custom Highlight API, so the tests stand in a registry and a Set-based Highlight.
class FakeHighlight extends Set<Range> {
  priority = 0
  constructor(...ranges: Range[]) {
    super(ranges)
  }
}
let registry: Map<string, FakeHighlight>
beforeEach(() => {
  registry = new Map()
  Object.assign(globalThis, { CSS: { highlights: registry }, Highlight: FakeHighlight })
})
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'CSS')
  Reflect.deleteProperty(globalThis, 'Highlight')
})

describe('lightness', () => {
  test('reads the colour formats Chrome computes', () => {
    expect(lightness('rgb(255, 255, 255)')).toBeCloseTo(1, 6)
    expect(lightness('rgb(0, 0, 0)')).toBe(0)
    expect(lightness('rgba(32, 33, 34, 0.9)')).toBeCloseTo(0.13, 2)
    expect(lightness('rgb(240 240 240 / 50%)')).toBeCloseTo(240 / 255, 6)
    expect(lightness('oklch(0.92 0.01 250)')).toBeCloseTo(0.92, 6)
    expect(lightness('oklab(40% 0.1 0.1)')).toBeCloseTo(0.4, 6)
    expect(lightness('lab(30 10 -20)')).toBeCloseTo(0.3, 6)
    expect(lightness('color(srgb 1 1 1)')).toBeCloseTo(1, 6)
  })

  test('gives up on formats it does not know', () => {
    expect(lightness('white')).toBeNull()
    expect(lightness('rgb(none none none)')).toBeNull()
    expect(lightness('')).toBeNull()
  })
})

describe('oklab', () => {
  test('reads the colour formats Chrome computes with their alpha', () => {
    const white = oklab('rgb(255, 255, 255)')!
    expect(white.l).toBeCloseTo(1, 4)
    expect(white.a).toBeCloseTo(0, 4)
    expect(white.alpha).toBe(1)
    expect(oklab('rgba(0, 0, 0, 0)')!.alpha).toBe(0)
    expect(oklab('rgb(255 241 168 / 50%)')!.alpha).toBe(0.5)
    expect(oklab('color(srgb 1 1 1)')!.l).toBeCloseTo(1, 4)
    expect(oklab('oklab(0.9 0.01 0.1 / 0.2)')).toEqual({ l: 0.9, a: 0.01, b: 0.1, alpha: 0.2 })
    const yellow = oklab('oklch(0.97 0.07 90)')!
    expect(yellow.a).toBeCloseTo(0, 6)
    expect(yellow.b).toBeCloseTo(0.07, 6)
    expect(oklab('oklch(0.9 0 none)')).toEqual({ l: 0.9, a: 0, b: 0, alpha: 1 })
  })

  test('gives up on formats it does not know', () => {
    expect(oklab('white')).toBeNull()
    expect(oklab('lab(90 0 40)')).toBeNull()
    expect(oklab('color(display-p3 1 1 0)')).toBeNull()
  })
})

describe('toneOf', () => {
  test('calls light text dark-toned and dark or unknown text light-toned', () => {
    document.body.innerHTML = `<p id="a" style="color: rgb(230, 237, 243)">x</p><p id="b" style="color: rgb(32, 33, 34)">x</p><p id="c" style="color: white">x</p>`
    const tone = (id: string) => toneOf(document.getElementById(id)!)
    expect([tone('a'), tone('b'), tone('c')]).toEqual(['dark', 'light', 'light'])
  })

  test('calls dark text on a background close to the highlight yellow warm-toned', () => {
    const backgrounds = {
      callout: 'rgb(255, 241, 168)',
      amber: 'rgb(253, 230, 138)',
      warning: 'rgb(255, 228, 181)',
      white: 'rgb(255, 255, 255)',
      sepia: 'rgb(251, 240, 217)',
      cream: 'rgb(244, 241, 234)',
      gray: 'rgb(246, 248, 250)',
      blue: 'rgb(232, 240, 254)',
    }
    document.body.innerHTML = Object.entries(backgrounds)
      .map(([id, bg]) => `<div style="background-color: ${bg}"><p id="${id}" style="color: rgb(32, 33, 34)">x</p></div>`)
      .join('')
    const tones = Object.keys(backgrounds).map((id) => toneOf(document.getElementById(id)!))
    expect(tones).toEqual(['warm', 'warm', 'warm', 'light', 'light', 'light', 'light', 'light'])
  })

  test('stacks see-through backgrounds over the page before comparing', () => {
    document.body.innerHTML = `<div style="background-color: rgba(251, 225, 122, 0.9)"><p id="strong" style="color: rgb(32, 33, 34)">x</p></div><div style="background-color: rgba(251, 225, 122, 0.1)"><p id="faint" style="color: rgb(32, 33, 34)">x</p></div><div style="background-color: rgb(32, 33, 34)"><p id="dark" style="color: rgb(230, 237, 243); background-color: rgba(251, 225, 122, 0.2)">x</p></div>`
    const tone = (id: string) => toneOf(document.getElementById(id)!)
    expect([tone('strong'), tone('faint'), tone('dark')]).toEqual(['warm', 'light', 'dark'])
  })

  test('gives each block of the page its own tone and keeps it', () => {
    const doc = parse('Prose comes first.\n\nconst x = 1')
    document.body.innerHTML = `<p style="color: rgb(32, 33, 34)">Prose comes first.</p><pre style="color: rgb(230, 237, 243)">const x = 1</pre>`
    const map = WordMap.build(doc, document.body as unknown as Element)
    expect(doc.words.map((_, i) => map.toneOf(i))).toEqual(['light', 'light', 'light', 'dark', 'dark', 'dark', 'dark'])
    ;(document.querySelector('pre') as unknown as HTMLElement).style.color = 'rgb(0, 0, 0)'
    expect(map.toneOf(3)).toBe('dark')
  })
})

describe('Marks', () => {
  const text = () => {
    document.body.innerHTML = '<p>Your eyes jump across the page.</p><pre>dark code here</pre>'
    return [document.querySelector('p')!.firstChild!, document.querySelector('pre')!.firstChild!] as unknown as Text[]
  }
  const span = (node: Text, start: number, end: number) => {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    return range
  }
  const shown = (name: string) => [...(registry.get(name) ?? [])].filter((r) => !r.collapsed).map(String)

  test('owns six highlights with the current chunk above the read text', () => {
    Marks.mount(document)
    expect([...registry.keys()].sort()).toEqual(['pacer-now-dark', 'pacer-now-light', 'pacer-now-warm', 'pacer-read-dark', 'pacer-read-light', 'pacer-read-warm'])
    expect(registry.get('pacer-now-light')!.priority).toBeGreaterThan(registry.get('pacer-read-light')!.priority)
  })

  test('moves one range per tone in place as the chunk moves', () => {
    const [prose, code] = text()
    const marks = Marks.mount(document)
    const owned = [...registry.get('pacer-now-light')!][0]
    marks.show(span(prose, 0, 4), 'light', [])
    expect(shown('pacer-now-light')).toEqual(['Your'])
    marks.show(span(prose, 5, 9), 'light', [])
    expect([...registry.get('pacer-now-light')!]).toEqual([owned])
    expect(shown('pacer-now-light')).toEqual(['eyes'])
    marks.show(span(code, 0, 4), 'dark', [])
    expect(shown('pacer-now-light')).toEqual([])
    expect(shown('pacer-now-dark')).toEqual(['dark'])
    marks.show(null, 'light', [])
    expect([...shown('pacer-now-light'), ...shown('pacer-now-dark')]).toEqual([])
  })

  test('dims read text in one range per run of the same tone', () => {
    const [prose, code] = text()
    const marks = Marks.mount(document)
    const runs: ToneRun[] = [
      { tone: 'light', range: span(prose, 0, 14) },
      { tone: 'dark', range: span(code, 0, 4) },
    ]
    marks.show(span(code, 5, 9), 'dark', runs)
    expect(shown('pacer-read-light')).toEqual(['Your eyes jump'])
    expect(shown('pacer-read-dark')).toEqual(['dark'])
    const owned = [...registry.get('pacer-read-light')!][0]
    marks.show(span(code, 10, 14), 'dark', [{ tone: 'light', range: span(prose, 0, 31) }])
    expect([...registry.get('pacer-read-light')!]).toEqual([owned])
    expect(shown('pacer-read-light')).toEqual(['Your eyes jump across the page.'])
    expect(registry.get('pacer-read-dark')!.size).toBe(0)
  })

  test('puts its highlights back when the page clears the registry', () => {
    const [prose] = text()
    const marks = Marks.mount(document)
    registry.clear()
    marks.show(span(prose, 0, 4), 'light', [])
    expect(registry.size).toBe(6)
    expect(shown('pacer-now-light')).toEqual(['Your'])
  })

  test('leaves names a newer copy took over when it goes', () => {
    const old = Marks.mount(document)
    const fresh = Marks.mount(document)
    const theirs = registry.get('pacer-now-light')
    old.dispose()
    expect(registry.get('pacer-now-light')).toBe(theirs)
    fresh.dispose()
    expect(registry.size).toBe(0)
  })

  test('has a style for every highlight it owns', () => {
    Marks.mount(document)
    const css = readFileSync(new URL('../inpage.css', import.meta.url), 'utf8')
    for (const name of registry.keys()) expect(css).toContain(`::highlight(${name})`)
  })
})
