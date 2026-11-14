import { withoutHash } from '../pages'

/** True in a copy of Pacer left on the page by an extension reload, where storage and messages no longer work. */
export const extensionGone = (): boolean => typeof chrome === 'undefined' || !chrome.runtime?.id

/** Calls leave when the page moves to another address in place. Hash changes and same-path replaces, like a scrollspy rewriting #s1, keep reading. */
export function watchNavigation(win: Window, key: string, leave: () => void): () => void {
  const navigation = win.navigation
  if (!navigation) return () => undefined
  // Mail links and downloads start a navigation that never leaves the page, so act only once the address has changed.
  const onEntryChange = () => {
    const url = navigation.currentEntry?.url
    if (url && withoutHash(url) !== key) leave()
  }
  navigation.addEventListener('currententrychange', onEntryChange)
  return () => navigation.removeEventListener('currententrychange', onEntryChange)
}

export interface PageWatch {
  hidden(): void
  /** The page is unloading or going into the back-forward cache. */
  gone(): void
}

export function watchPage(win: Window, on: PageWatch): () => void {
  const doc = win.document
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') on.hidden()
  }
  const onPageHide = () => on.gone()
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('pagehide', onPageHide)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('pagehide', onPageHide)
  }
}
