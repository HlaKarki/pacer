import type { Article } from './article'
import { rememberSource } from './back'
import { putDoc, type DocRecord } from './docs'
import type { Extracted } from './extract'
import type { InPage, OpenTabMessage } from './inpage/toggle'

interface Probe {
  contentType: string
  url: string
}

class PaceError extends Error {
  name = 'PaceError'
}

// Scripting results cross a message channel with a size cap, so large PDFs come back in pieces.
const CHUNK_BYTES = 8 * 1024 * 1024
const READER = chrome.runtime.getURL('reader.html')
const PICKER_PAGES = /^(chrome:\/\/(newtab|new-tab-page)\/?|about:blank)$/
const PRESS_GAP_MS = 300
const DEFAULT_TITLE = chrome.runtime.getManifest().action?.default_title ?? 'Pace this page'
const lastPress = new Map<number, number>()

async function run<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  ...args: Args
): Promise<Awaited<Result>> {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
  if (!frame || frame.result === undefined) throw new Error('The script returned nothing.')
  return frame.result as Awaited<Result>
}

const probeTab = (tabId: number) => run(tabId, (): Probe => ({ contentType: document.contentType, url: location.href }))

/** The tab fetches its own PDF, so it goes out with the site's cookies and usually comes from the cache. */
async function grabPdf(tabId: number): Promise<ArrayBuffer> {
  const fetched = await run(tabId, async () => {
    try {
      const response = await fetch(location.href)
      if (!response.ok) return { ok: false, size: 0 }
      const bytes = new Uint8Array(await response.arrayBuffer())
      Object.assign(globalThis, { __pacerPdf: bytes })
      return { ok: true, size: bytes.length }
    } catch {
      return { ok: false, size: 0 }
    }
  })
  if (!fetched.ok) throw new PaceError('Pacer could not download this PDF again. Reload it and try once more.')
  try {
    const out = new Uint8Array(fetched.size)
    for (let start = 0; start < fetched.size; start += CHUNK_BYTES) {
      const base64 = await run(
        tabId,
        (from: number, to: number) => {
          const bytes = (globalThis as unknown as { __pacerPdf: Uint8Array<ArrayBuffer> }).__pacerPdf.subarray(from, to)
          return new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1))
            reader.readAsDataURL(new Blob([bytes]))
          })
        },
        start,
        start + CHUNK_BYTES,
      )
      const piece = await (await fetch(`data:application/octet-stream;base64,${base64}`)).arrayBuffer()
      out.set(new Uint8Array(piece), start)
    }
    return out.buffer
  } finally {
    await run(tabId, () => delete (globalThis as { __pacerPdf?: unknown }).__pacerPdf).catch(() => {})
  }
}

async function readFileUrl(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url).catch(() => null)
  if (!response?.ok) throw new PaceError('Pacer could not open this file. It may have been moved or deleted.')
  return response.arrayBuffer()
}

async function grabArticle(tabId: number): Promise<Extracted> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['extract.js'] })
  return run(tabId, () => (globalThis as unknown as { __pacerExtract: () => Extracted }).__pacerExtract())
}

async function recordFor(tab: chrome.tabs.Tab, tabId: number, read?: Article): Promise<DocRecord> {
  const url = tab.url ?? ''
  const base = { id: crypto.randomUUID(), src: url, title: tab.title || null, at: Date.now() }
  if (read) return { ...base, kind: 'article', title: read.title ?? base.title, text: read.text, startParagraph: read.startParagraph }
  const isFile = url.startsWith('file:')
  if (isFile && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    return { ...base, kind: /\.pdf(#|$)/i.test(url) ? 'pdf' : 'article', error: { message: '', fileAccess: true } }
  }
  const probe = await probeTab(tabId)
  const src = probe.url
  if (probe.contentType === 'application/pdf') {
    try {
      const bytes = isFile ? await readFileUrl(src) : await grabPdf(tabId)
      return { ...base, src, kind: 'pdf', bytes }
    } catch (error) {
      if (!(error instanceof PaceError)) throw error
      return { ...base, src, kind: 'pdf', error: { message: error.message } }
    }
  }
  const article = await grabArticle(tabId)
  if (!article.ok) return { ...base, src, kind: 'article', error: { message: article.message } }
  const { title, text, startParagraph } = article
  return { ...base, src, kind: 'article', title: title ?? base.title, text, startParagraph }
}

async function refuse(tabId: number) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: '!' }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#b4321f' }),
    chrome.action.setTitle({ tabId, title: "Pacer can't read this page" }),
  ])
}

async function clearRefusal(tabId: number) {
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: '' }),
    chrome.action.setTitle({ tabId, title: DEFAULT_TITLE }),
  ]).catch(() => {})
}

/** Holding the shortcut repeats the press, so presses right after the last one are dropped. */
function pressedRecently(tabId: number): boolean {
  const now = Date.now()
  const last = lastPress.get(tabId)
  lastPress.set(tabId, now)
  return last !== undefined && now - last < PRESS_GAP_MS
}

/** PDFs and local files Pacer may not read go to the reader tab, and every other page is read in place. */
async function routeOf(tab: chrome.tabs.Tab, tabId: number): Promise<'tab' | 'page'> {
  if (tab.url?.startsWith('file:') && !(await chrome.extension.isAllowedFileSchemeAccess())) return 'tab'
  const probe = await probeTab(tabId)
  return probe.contentType === 'application/pdf' ? 'tab' : 'page'
}

/** A new document or a reloaded extension has no copy of the page script yet, so that is when the styles go in too. */
async function ensureInPage(tabId: number) {
  const loaded = await run(tabId, () => typeof (globalThis as { __pacerInPage?: unknown }).__pacerInPage !== 'undefined')
  if (loaded) return
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['inpage.css'] })
  await chrome.scripting.executeScript({ target: { tabId }, files: ['inpage.js'] })
}

async function startInPage(tab: chrome.tabs.Tab, tabId: number) {
  await ensureInPage(tabId)
  const result = await run(tabId, () => (globalThis as unknown as { __pacerInPage: InPage }).__pacerInPage.toggle())
  if (result.kind === 'started') await clearRefusal(tabId)
  else if (result.kind === 'fallback') await openReaderTab(tab, tabId, result.article)
  // The page has shown its own message already, so the badge only marks the button.
  else if (result.kind === 'error') await refuse(tabId)
}

/** With the article the page already read, the tab skips reading the page again. */
async function openReaderTab(tab: chrome.tabs.Tab, tabId: number, article?: Article): Promise<boolean> {
  try {
    const record = await recordFor(tab, tabId, article)
    await putDoc(record)
    await rememberSource(record.id, { tabId, src: record.src })
    await chrome.tabs.create({
      url: `${READER}?doc=${record.id}`,
      windowId: tab.windowId,
      index: tab.index + 1,
      openerTabId: tabId,
    })
  } catch (error) {
    console.warn('Pacer could not read the tab.', error)
    await refuse(tabId)
    return false
  }
  await clearRefusal(tabId)
  return true
}

function isOpenTab(message: unknown): message is OpenTabMessage {
  const { type, article } = (message ?? {}) as Partial<OpenTabMessage>
  return (
    type === 'pacer:open-tab' &&
    typeof article?.text === 'string' &&
    (article.title === null || typeof article.title === 'string') &&
    Number.isInteger(article.startParagraph)
  )
}

function onMessage(message: unknown, sender: chrome.runtime.MessageSender, reply: (response: { ok: boolean }) => void) {
  const tab = sender.tab
  if (!isOpenTab(message) || tab?.id === undefined) return
  const { title, text, startParagraph } = message.article
  void openReaderTab({ ...tab, url: sender.url ?? tab.url }, tab.id, { title, text, startParagraph }).then((ok) => reply({ ok }))
  // Chrome closes the reply channel when the listener returns, unless it returns true.
  return true
}

async function paceTab(tab: chrome.tabs.Tab) {
  const tabId = tab.id
  if (tabId === undefined || tab.url?.startsWith(READER)) return
  if (PICKER_PAGES.test(tab.url ?? '')) {
    await chrome.tabs.update(tabId, { url: READER })
    return
  }
  if (pressedRecently(tabId)) return
  try {
    if ((await routeOf(tab, tabId)) === 'page') {
      await startInPage(tab, tabId)
      return
    }
  } catch (error) {
    // Chrome refuses scripts on its own pages and the Web Store, so those end up here.
    console.warn('Pacer could not read the tab.', error)
    await refuse(tabId)
    return
  }
  await openReaderTab(tab, tabId)
}

chrome.action.onClicked.addListener((tab) => void paceTab(tab))
chrome.runtime.onMessage.addListener(onMessage)

// Nothing can press the toolbar button in an automated browser, so the e2e run calls this instead.
Object.assign(globalThis, { paceTab })
