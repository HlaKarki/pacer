import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import type { WordMap } from './map'
import { attachClicks, attachKeys, deepFocus, isReadingFocus, type ClickTarget, type KeyTarget } from './keys'

const window = new Window({ url: 'https://example.com/essay' })
const document = window.document as unknown as Document
const win = window as unknown as Window
const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!

let calls: string[]
let session: KeyTarget & { playing: boolean; bySentence: boolean }
let pageHeard: string[]
let detach: () => void

const record = (name: string) => () => void calls.push(name)
const onPage = (e: Event) => void pageHeard.push(`${e.type}:${(e as KeyboardEvent).key}`)

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  const code = key === ' ' ? 'Space' : key
  const options = { key, code, bubbles: true, composed: true, cancelable: true, ...init }
  const down = new window.KeyboardEvent('keydown', options) as unknown as KeyboardEvent
  target.dispatchEvent(down)
  target.dispatchEvent(new window.KeyboardEvent('keyup', options) as unknown as Event)
  return down
}

beforeEach(() => {
  document.body.innerHTML = `<article><p id="text">Some words to read on the page.</p>
    <input id="field"><div id="editor" contenteditable="true"><span id="inside">typed</span></div>
    <div id="rb" role="button" tabindex="0">Toggle</div><div role="tablist"><button id="tab" role="tab">One</button></div>
    <details><summary id="sum">More</summary></details><div id="focusable" tabindex="-1">Skip target</div>
    <div id="host"></div></article>`
  calls = []
  pageHeard = []
  session = {
    playing: true,
    bySentence: false,
    toggle: record('toggle'),
    pause: record('pause'),
    stop: (reason) => void calls.push(`stop:${reason}`),
    prevWord: record('prevWord'),
    nextChunk: record('nextChunk'),
    prevSentence: record('prevSentence'),
    nextSentence: record('nextSentence'),
    nudgeWpm: (delta) => void calls.push(`wpm:${delta}`),
    dispose: record('dispose'),
  }
  Object.assign(globalThis, { chrome: { runtime: { id: 'pacer' } } })
  document.addEventListener('keydown', onPage)
  document.addEventListener('keyup', onPage)
  detach = attachKeys(win, session)
})

afterEach(() => {
  detach()
  document.removeEventListener('keydown', onPage)
  document.removeEventListener('keyup', onPage)
  Reflect.deleteProperty(globalThis, 'chrome')
})

describe('isReadingFocus', () => {
  test('counts the page and plain text as reading', () => {
    for (const el of [document.body, document.documentElement, $('#text'), $('#focusable'), null]) {
      expect(isReadingFocus(el)).toBe(true)
    }
  })

  test('leaves fields, editors and widgets alone', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<textarea id="ta"></textarea><select id="sel"></select><div id="tb" role="textbox"></div><a id="lnk" href="/x">x</a><video id="vid"></video><div id="sl" role="slider"></div><span id="t0" tabindex="0">x</span>',
    )
    for (const id of ['field', 'ta', 'sel', 'editor', 'inside', 'tb', 'lnk', 'rb', 'tab', 'sum', 'vid', 'sl', 't0']) {
      expect([id, isReadingFocus($(`#${id}`))]).toEqual([id, false])
    }
  })

  test('counts a focusable wrapper around the text as reading when a click focused it', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="wrap" tabindex="0"><p>README text</p></div>')
    expect(isReadingFocus($('#wrap'), true)).toBe(true)
    expect(isReadingFocus($('#wrap'))).toBe(false)
    expect(isReadingFocus($('#rb'), true)).toBe(false)
  })
})

describe('deepFocus', () => {
  const eventFrom = (first: unknown) => ({ composedPath: () => (first ? [first] : []) }) as unknown as Event

  test('walks into an open shadow root', () => {
    const host = $('#host')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<textarea></textarea>'
    Object.defineProperty(root, 'activeElement', { value: root.querySelector('textarea'), configurable: true })
    expect(deepFocus(eventFrom(host), document)?.localName).toBe('textarea')
  })

  test('walks into a closed shadow root through chrome.dom', () => {
    const host = $('#host')
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = '<div contenteditable="true"></div>'
    Object.defineProperty(root, 'activeElement', { value: root.firstElementChild, configurable: true })
    Object.assign(globalThis, { chrome: { runtime: { id: 'pacer' }, dom: { openOrClosedShadowRoot: (el: Element) => (el === host ? root : null) } } })
    expect(deepFocus(eventFrom(host), document)?.getAttribute('contenteditable')).toBe('true')
  })

  test('falls back to the active element when the event starts outside the page', () => {
    expect(deepFocus(eventFrom(win), document)).toBe(document.activeElement)
  })
})

describe('attachKeys', () => {
  test('handles the reading keys on the page and hides them from page handlers', () => {
    press(document.body, ' ')
    press(document.body, 'ArrowRight')
    press(document.body, 'ArrowRight', { shiftKey: true })
    press(document.body, 'ArrowLeft')
    press(document.body, 'ArrowLeft', { altKey: true })
    press(document.body, 'ArrowUp')
    press(document.body, 'ArrowDown')
    expect(calls).toEqual(['toggle', 'nextChunk', 'nextSentence', 'prevWord', 'prevSentence', 'wpm:25', 'wpm:-25'])
    expect(pageHeard).toEqual([])
  })

  test('takes the keys after a click on a focusable wrapper, and leaves them to it after a Tab', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="wrap" tabindex="0"><p>README text</p></div>')
    $('#wrap').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true, composed: true }) as unknown as Event)
    press($('#wrap'), ' ')
    $('#wrap').focus()
    press($('#wrap'), 'ArrowDown')
    expect(calls).toEqual(['toggle'])
    expect(pageHeard).toEqual(['keydown:ArrowDown', 'keyup:ArrowDown'])
  })

  test('moves back by sentence in sentence chunks', () => {
    session.bySentence = true
    press($('#text'), 'ArrowLeft')
    expect(calls).toEqual(['prevSentence'])
  })

  test('marks handled keys so the browser does not scroll', () => {
    expect(press(document.body, ' ').defaultPrevented).toBe(true)
    expect(press(document.body, 'PageDown').defaultPrevented).toBe(false)
  })

  test('ignores a held Space after the first press', () => {
    const held = press(document.body, ' ', { repeat: true })
    expect(held.defaultPrevented).toBe(true)
    expect(calls).toEqual([])
  })

  test('leaves keys to fields, widgets and summaries', () => {
    for (const id of ['field', 'editor', 'inside', 'rb', 'tab', 'sum']) {
      press($(`#${id}`), ' ')
      press($(`#${id}`), 'ArrowRight')
    }
    expect(calls).toEqual([])
    expect(pageHeard.filter((heard) => heard.startsWith('keydown')).length).toBe(12)
  })

  test('leaves keys typed in a closed shadow root to it', () => {
    const host = $('#host')
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = '<textarea></textarea>'
    Object.defineProperty(root, 'activeElement', { value: root.firstElementChild, configurable: true })
    Object.assign(globalThis, { chrome: { runtime: { id: 'pacer' }, dom: { openOrClosedShadowRoot: (el: Element) => (el === host ? root : null) } } })
    const fromHost = new window.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, composed: true, cancelable: true })
    Object.defineProperty(fromHost, 'composedPath', { value: () => [host, document.body, document.documentElement, document, window] })
    host.dispatchEvent(fromHost as unknown as Event)
    expect(calls).toEqual([])
    expect(pageHeard).toEqual(['keydown: '])
  })

  test('Esc pauses first, then stops', () => {
    press(document.body, 'Escape')
    session.playing = false
    press(document.body, 'Escape')
    expect(calls).toEqual(['pause', 'stop:esc'])
    expect(pageHeard).toEqual([])
  })

  test('leaves Esc to an open dialog and to fields', () => {
    document.body.insertAdjacentHTML('beforeend', '<dialog open><p>Are you sure?</p></dialog>')
    press(document.body, 'Escape')
    $('dialog').remove()
    press($('#field'), 'Escape')
    expect(calls).toEqual([])
    expect(pageHeard).toEqual(['keydown:Escape', 'keyup:Escape', 'keydown:Escape', 'keyup:Escape'])
  })

  test('leaves Esc to open menus and lightboxes, and to the control that opened one', () => {
    const escape = (target: Element) => press(target, 'Escape')
    document.body.insertAdjacentHTML('beforeend', '<div id="lightbox" role="dialog"><img alt="Photo"></div>')
    escape(document.body)
    $('#lightbox').remove()
    document.body.insertAdjacentHTML('beforeend', '<ul id="menu" role="menu"><li role="menuitem">One</li></ul>')
    escape(document.body)
    $('#menu').remove()
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="opener" aria-expanded="true">HTML</button><div aria-expanded="true"><div id="item" tabindex="-1">Item</div></div>',
    )
    escape($('#opener'))
    escape($('#item'))
    expect(calls).toEqual([])
    expect(pageHeard.filter((heard) => heard === 'keydown:Escape').length).toBe(4)
  })

  test('leaves shortcuts, IME input and keys from Pacer’s own bar alone', () => {
    press(document.body, ' ', { metaKey: true })
    press(document.body, 'ArrowRight', { ctrlKey: true })
    press(document.body, ' ', { isComposing: true })
    const bar = document.createElement('pacer-bar')
    document.documentElement.append(bar)
    press(bar, ' ')
    bar.remove()
    expect(calls).toEqual([])
    expect(pageHeard.length).toBe(8)
  })

  test('lets go and passes the key on once the extension has reloaded', () => {
    Object.assign(globalThis, { chrome: { runtime: {} } })
    const down = press(document.body, ' ')
    expect(down.defaultPrevented).toBe(false)
    expect(calls).toEqual(['dispose'])
    expect(pageHeard).toEqual(['keydown: ', 'keyup: '])
  })

  test('hands every key back to the page once detached', () => {
    detach()
    press(document.body, ' ')
    expect(calls).toEqual([])
    expect(pageHeard).toEqual(['keydown: ', 'keyup: '])
    detach = attachKeys(win, session)
  })
})

describe('attachClicks', () => {
  let jumps: number[]
  let rebuilds: number
  let owns: boolean
  let words: Map<Node, number>
  let map: WordMap
  let stop: () => void
  let rebuilt: () => void

  const caretOn = (node: Node, offset = 0) => {
    document.caretPositionFromPoint = () => ({ offsetNode: node, offset }) as CaretPosition
  }
  const click = (target: EventTarget, init: MouseEventInit = {}) =>
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true, button: 0, ...init }) as unknown as Event)

  beforeEach(() => {
    jumps = []
    rebuilds = 0
    owns = true
    rebuilt = () => undefined
    const text = $('#text').firstChild!
    words = new Map([[text, 3]])
    const fake = (canRebuild: boolean) =>
      ({ wordAt: (node: Node) => words.get(node) ?? -1, owns: () => owns, canRebuild: () => canRebuild }) as unknown as WordMap
    map = fake(true)
    const target: ClickTarget = {
      get wordMap() {
        return map
      },
      jump: (i) => void jumps.push(i),
      rebuildMap: () => {
        rebuilds++
        rebuilt()
        map = fake(false)
        return map
      },
    }
    caretOn(text)
    stop = attachClicks(document, target)
  })

  afterEach(() => stop())

  test('jumps to the clicked word', () => {
    click($('#text'))
    expect(jumps).toEqual([3])
  })

  test('jumps to a word inside a focusable wrapper', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="wrap" tabindex="0"><p id="readme">README text</p></div>')
    const text = $('#readme').firstChild!
    words.set(text, 7)
    caretOn(text)
    click($('#readme'))
    expect(jumps).toEqual([7])
  })

  test('ignores clicks on links, controls, Pacer’s bar, selections and modified clicks', () => {
    $('#text').insertAdjacentHTML('beforeend', ' <a id="lnk" href="/x">a link</a>')
    click($('#lnk'))
    click($('#field'))
    click($('#text'), { shiftKey: true })
    const bar = document.createElement('pacer-bar')
    bar.append(document.createElement('button'))
    document.documentElement.append(bar)
    click(bar.firstChild!)
    bar.remove()
    const range = document.createRange()
    range.selectNodeContents($('#text'))
    document.getSelection()!.addRange(range)
    click($('#text'))
    document.getSelection()!.removeAllRanges()
    expect(jumps).toEqual([])
    expect(rebuilds).toBe(0)
  })

  test('maps the page again once when a click in a mapped block misses', () => {
    const fresh = document.createTextNode(' new text')
    const other = document.createTextNode(' more')
    $('#text').append(fresh, other)
    caretOn(fresh)
    rebuilt = () => words.set(fresh, 9)
    click($('#text'))
    expect([rebuilds, jumps]).toEqual([1, [9]])
    caretOn(other)
    click($('#text'))
    expect([rebuilds, jumps]).toEqual([1, [9]])
  })

  test('does not map again for a click outside the article', () => {
    owns = false
    const elsewhere = document.createTextNode('footer')
    document.body.append(elsewhere)
    caretOn(elsewhere)
    click(document.body)
    expect([rebuilds, jumps]).toEqual([0, []])
  })
})
