import { withoutHash } from '../pages'

/** True in a copy of Pacer left on the page by an extension reload, where storage and messages no longer work. */
export const extensionGone = (): boolean => !globalThis.chrome?.runtime?.id

/** Calls leave when the page heads for another address. Hash changes and same-path replaces, like a scrollspy rewriting #s1, keep reading. */
export function watchNavigation(win: Window, key: string, leave: () => void): () => void {
  const navigation = win.navigation
  if (!navigation) return () => undefined
  const onNavigate = (e: NavigateEvent) => {
    if (e.downloadRequest === null && withoutHash(e.destination.url) !== key) leave()
  }
  navigation.addEventListener('navigate', onNavigate)
  return () => navigation.removeEventListener('navigate', onNavigate)
}

export interface PageWatch {
  /** The tab went to the background. */
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
