import { rememberSource } from './back'
import { putDoc, type DocRecord } from './docs'
import type { Extracted } from './extract'

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

async function recordFor(tab: chrome.tabs.Tab, tabId: number): Promise<DocRecord> {
  const url = tab.url ?? ''
  const base = { id: crypto.randomUUID(), src: url, title: tab.title || null, at: Date.now() }
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

async function paceTab(tab: chrome.tabs.Tab) {
  const tabId = tab.id
  if (tabId === undefined || tab.url?.startsWith(READER)) return
  if (PICKER_PAGES.test(tab.url ?? '')) {
    await chrome.tabs.update(tabId, { url: READER })
    return
  }
  let record: DocRecord
  try {
    record = await recordFor(tab, tabId)
    await putDoc(record)
    await rememberSource(record.id, { tabId, src: record.src })
  } catch (error) {
    // Chrome refuses scripts on its own pages and the Web Store, so those end up here.
    console.warn('Pacer could not read the tab.', error)
    await refuse(tabId)
    return
  }
  await chrome.tabs.create({
    url: `${READER}?doc=${record.id}`,
    windowId: tab.windowId,
    index: tab.index + 1,
    openerTabId: tabId,
  })
}

chrome.action.onClicked.addListener((tab) => void paceTab(tab))

// Nothing can press the toolbar button in an automated browser, so the e2e run calls this instead.
Object.assign(globalThis, { paceTab })
