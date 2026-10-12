import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { Window } from 'happy-dom'
import { Follow, inView } from './follow'

const window = new Window()
globalThis.Node = window.Node as unknown as typeof Node
const document = window.document as unknown as Document
const win = window as unknown as Window
const RangeProto = window.Range.prototype as unknown as Range
const root = document.documentElement
const HEIGHT = 800

// happy-dom has no layout, so a block's page top comes from data-top and its scroll box's scrollTop.
const rect = (top: number) => ({ top, bottom: top + 20, height: 20, left: 0, right: 100, width: 100 }) as DOMRect
const topOf = (node: Node) => {
  const block = (node.parentElement as HTMLElement).closest<HTMLElement>('[data-top]')!
  const box = block.closest<HTMLElement>('#scroller')
  const offset = box ? 100 - box.scrollTop : -root.scrollTop
  return Number(block.dataset.top) + offset
}

let frames = new Map<number, FrameRequestCallback>()
let frameId = 0
const runFrame = (time: number) => {
  const due = [...frames.values()]
  frames = new Map()
  for (const callback of due) callback(time)
}
let reduced = false

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: HEIGHT, configurable: true })
  Object.defineProperty(root, 'scrollHeight', { value: 10000, configurable: true })
  Object.defineProperty(root, 'clientHeight', { value: HEIGHT, configurable: true })
  Object.defineProperty(root, 'clientWidth', { value: 1000, configurable: true })
  root.scrollTop = 0
  win.requestAnimationFrame = (callback) => {
    frames.set(++frameId, callback)
    return frameId
  }
  win.cancelAnimationFrame = (id) => void frames.delete(id)
  win.matchMedia = () => ({ matches: reduced }) as MediaQueryList
  RangeProto.getClientRects = function (this: Range) {
    return [rect(topOf(this.startContainer))] as unknown as DOMRectList
  }
})

afterEach(() => {
  frames = new Map()
  reduced = false
  delete (RangeProto as Partial<Range>).getClientRects
})

function lineAt(top: number, inner = '') {
  document.body.innerHTML = inner || `<p data-top="${top}">The active line</p>`
  const range = document.createRange()
  range.selectNodeContents(document.querySelector('p')!.firstChild!)
  return range
}

describe('Follow.toLine', () => {
  test('glides the line to 36% of the window and then reports it settled', () => {
    const now = spyOn(performance, 'now').mockReturnValue(1000)
    const follow = Follow.attach(win, () => {})
    let settled = 0
    follow.toLine(lineAt(1000), () => settled++)
    const seen: number[] = []
    for (const t of [1000, 1100, 1200, 1300]) {
      runFrame(t)
      seen.push(root.scrollTop)
    }
    expect(seen.at(-1)).toBeCloseTo(1000 - HEIGHT * 0.36, 6)
    expect(seen[1]).toBeGreaterThan(seen[0])
    expect(seen[1]).toBeLessThan(seen.at(-1)!)
    expect(settled).toBe(0)
    runFrame(1316)
    expect(settled).toBe(1)
    follow.dispose()
    now.mockRestore()
  })

  test('jumps when the line is more than a window and a half away', () => {
    const follow = Follow.attach(win, () => {})
    let settled = 0
    follow.toLine(lineAt(5000), () => settled++)
    expect(root.scrollTop).toBeCloseTo(5000 - HEIGHT * 0.36, 6)
    runFrame(0)
    expect(settled).toBe(1)
    follow.dispose()
  })

  test('jumps when the reader asked for less motion', () => {
    reduced = true
    const follow = Follow.attach(win, () => {})
    follow.toLine(lineAt(600), () => {})
    expect(root.scrollTop).toBeCloseTo(600 - HEIGHT * 0.36, 6)
    follow.dispose()
  })

  test('stops gliding when something else scrolls the page', () => {
    const now = spyOn(performance, 'now').mockReturnValue(0)
    const follow = Follow.attach(win, () => {})
    let settled = 0
    follow.toLine(lineAt(1000), () => settled++)
    runFrame(100)
    root.scrollTop = 50
    for (const t of [200, 300, 400]) runFrame(t)
    expect(root.scrollTop).toBe(50)
    expect(settled).toBe(0)
    follow.dispose()
    now.mockRestore()
  })

  test('scrolls the inner scroll box that holds the line and leaves the window alone', () => {
    reduced = true
    const range = lineAt(0, `<div id="scroller" style="overflow-y: auto"><p data-top="900">The active line</p></div>`)
    const box = document.getElementById('scroller')!
    Object.defineProperty(box, 'scrollHeight', { value: 4000 })
    Object.defineProperty(box, 'clientHeight', { value: 600 })
    box.getBoundingClientRect = () => rect(100)
    const follow = Follow.attach(win, () => {})
    follow.toLine(range, () => {})
    expect(box.scrollTop).toBeCloseTo(900 - 600 * 0.36, 6)
    expect(root.scrollTop).toBe(0)
    follow.dispose()
  })

  test('does not scroll past the end of the page', () => {
    reduced = true
    Object.defineProperty(root, 'scrollHeight', { value: 1200, configurable: true })
    const follow = Follow.attach(win, () => {})
    follow.toLine(lineAt(1100), () => {})
    expect(root.scrollTop).toBe(1200 - HEIGHT)
    follow.dispose()
  })
})

describe('Follow user scrolls', () => {
  test('reports wheel, touch, scrollbar presses and scroll keys but not zooms, typing or Pacer’s own bar', () => {
    document.body.innerHTML = '<p>Text</p><input><pacer-bar><button>Play</button></pacer-bar>'
    let scrolls = 0
    const follow = Follow.attach(win, () => scrolls++)
    const p = document.querySelector('p')!
    const fire = (target: Element, event: Event) => target.dispatchEvent(event)
    fire(p, new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    // happy-dom drops ctrlKey from the WheelEvent init, so set it on the event.
    const zoom = new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 })
    Object.defineProperty(zoom, 'ctrlKey', { value: true })
    fire(p, zoom as unknown as Event)
    fire(document.querySelector('pacer-bar button')!, new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    expect(scrolls).toBe(1)
    fire(p, new window.TouchEvent('touchmove', { bubbles: true }) as unknown as Event)
    fire(p, new window.KeyboardEvent('keydown', { bubbles: true, key: 'PageDown' }) as unknown as Event)
    fire(document.querySelector('input')!, new window.KeyboardEvent('keydown', { bubbles: true, key: 'End' }) as unknown as Event)
    fire(p, new window.KeyboardEvent('keydown', { bubbles: true, key: 'a' }) as unknown as Event)
    expect(scrolls).toBe(3)
    fire(p, new window.PointerEvent('pointerdown', { bubbles: true, clientX: 1005 }) as unknown as Event)
    fire(p, new window.PointerEvent('pointerdown', { bubbles: true, clientX: 10 }) as unknown as Event)
    expect(scrolls).toBe(4)
    follow.dispose()
    fire(p, new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    expect(scrolls).toBe(4)
  })

  test('reports a scroll from a link or the page that takes the line off screen, but not a nudge or its own scrolling', () => {
    reduced = true
    let scrolls = 0
    const follow = Follow.attach(win, () => scrolls++)
    const scrolled = () => document.dispatchEvent(new window.Event('scroll', { bubbles: true }) as unknown as Event)
    follow.toLine(lineAt(1000), () => {})
    scrolled()
    root.scrollTop += 120
    scrolled()
    expect(scrolls).toBe(0)
    root.scrollTop = 3000
    scrolled()
    expect(scrolls).toBe(1)
    document.querySelector('p')!.dispatchEvent(new window.Event('scroll') as unknown as Event)
    expect(scrolls).toBe(1)
    follow.dispose()
  })

  test('stops its own glide when the reader scrolls', () => {
    const now = spyOn(performance, 'now').mockReturnValue(0)
    const follow = Follow.attach(win, () => {})
    let settled = 0
    follow.toLine(lineAt(1000), () => settled++)
    runFrame(100)
    const at = root.scrollTop
    document.querySelector('p')!.dispatchEvent(new window.WheelEvent('wheel', { bubbles: true, deltaY: 40 }) as unknown as Event)
    for (const t of [200, 300, 400]) runFrame(t)
    expect(root.scrollTop).toBe(at)
    expect(settled).toBe(0)
    follow.dispose()
    now.mockRestore()
  })
})

describe('inView', () => {
  test('tells a line in the window from one scrolled away', () => {
    expect(inView(lineAt(400))).toBe(true)
    root.scrollTop = 2000
    expect(inView(lineAt(400))).toBe(false)
    expect(inView(lineAt(2790))).toBe(true)
    expect(inView(lineAt(2900))).toBe(false)
  })
})
