import { withoutHash, withPage } from './pages'

/** The tab and URL Pacer was pressed on. */
export interface Source {
  tabId: number
  src: string
}

// Tab ids restart with the browser, so sources live in session storage and a restored Pacer tab has none.
const keyOf = (docId: string) => `source:${docId}`

const isSource = (value: unknown): value is Source =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Source).tabId === 'number' &&
  typeof (value as Source).src === 'string'

export async function rememberSource(docId: string, source: Source) {
  await chrome.storage.session.set({ [keyOf(docId)]: source })
}

export async function sourceOf(docId: string): Promise<Source | null> {
  const stored = (await chrome.storage.session.get(keyOf(docId)))[keyOf(docId)]
  if (!isSource(stored)) return null
  return (await chrome.tabs.get(stored.tabId).then(() => true, () => false)) ? stored : null
}

/** False once the tab has moved on to another page, which is also when Chrome stops letting Pacer script it. */
async function stillOn({ tabId, src }: Source): Promise<boolean> {
  try {
    const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: () => location.href })
    return withoutHash(String(frame?.result)) === withoutHash(src)
  } catch {
    return false
  }
}

export async function showPdfPage(source: Source, page: number): Promise<boolean> {
  if (!(await stillOn(source))) return false
  try {
    await chrome.scripting.executeScript({
      target: { tabId: source.tabId },
      // Chrome's PDF viewer ignores a hash-only change, so reload it at the new hash.
      func: (url: string) => {
        location.replace(url)
        location.reload()
      },
      args: [withPage(source.src, page)],
    })
    return true
  } catch {
    return false
  }
}

/** Scrolls the source page to the paragraph. Says whether the page is left scrolled, or null when it did not move. */
export async function revealParagraph(source: Source, text: string): Promise<boolean | null> {
  if (!(await stillOn(source))) return null
  try {
    const target = { tabId: source.tabId }
    await chrome.scripting.executeScript({ target, files: ['extract.js'] })
    const [frame] = await chrome.scripting.executeScript({
      target,
      func: (t: string) => (window as unknown as { __pacerReveal: (t: string) => boolean | null }).__pacerReveal(t),
      args: [text],
    })
    return frame?.result ?? null
  } catch {
    return null
  }
}

/** Switches to the source tab and closes this one. False when the source tab is gone. */
export async function switchTo(source: Source): Promise<boolean> {
  try {
    await chrome.tabs.update(source.tabId, { active: true })
  } catch {
    return false
  }
  const self = await chrome.tabs.getCurrent()
  if (self?.id !== undefined) await chrome.tabs.remove(self.id)
  return true
}
