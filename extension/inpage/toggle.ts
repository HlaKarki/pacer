import { ImportError } from '../../src/lib/import/errors'
import type { Article } from '../article'
import { Toast } from './bar'
import { InPageSession, type SessionOptions, type StopReason, type ToggleResult } from './session'

/** What the toolbar press calls in the page. */
export interface InPage {
  toggle(): Promise<ToggleResult>
}

/** The bar asks the service worker for a reader tab with what the page read. */
export interface OpenTabMessage {
  type: 'pacer:open-tab'
  article: Article
}

export interface Session {
  readonly article: Article | null
  readonly fingerprint: string | null
  start(): Promise<ToggleResult>
  stop(reason: StopReason): Promise<{ index: number; from: number }>
}

const UNREADABLE = 'Pacer could not read this page.'
const NO_TAB = 'Pacer could not open its tab'

/** Takes away bars, toasts and highlights a copy of Pacer from before an extension reload left behind. */
export function removeForeign(doc: Document): void {
  for (const host of doc.querySelectorAll('pacer-bar, pacer-toast')) host.remove()
  for (const name of [...CSS.highlights.keys()]) if (name.startsWith('pacer-')) CSS.highlights.delete(name)
}

async function askForTab(article: Article): Promise<boolean> {
  const message: OpenTabMessage = { type: 'pacer:open-tab', article }
  try {
    const reply = (await chrome.runtime.sendMessage(message)) as { ok?: boolean } | undefined
    return reply?.ok === true
  } catch {
    return false
  }
}

export function createInPage(
  win: Window,
  makeSession: (options: SessionOptions) => Session = (options) => new InPageSession(options),
): InPage {
  let session: Session | null = null
  let starting = false

  async function openTab(current: Session) {
    if (session !== current) return
    const article = current.article
    const { from } = await current.stop('tab')
    if (article && !(await askForTab({ ...article, startParagraph: from }))) Toast.show(NO_TAB, win.document)
  }

  async function readOn(current: Session) {
    if (session !== current || starting) return
    const result = await start(current)
    if (result.kind === 'fallback' && !(await askForTab(result.article))) Toast.show(NO_TAB, win.document)
  }

  function begin(after?: string): Promise<ToggleResult> {
    removeForeign(win.document)
    const next = makeSession({
      win,
      after,
      openTab: () => void openTab(next),
      readOn: () => void readOn(next),
      ended: () => {
        if (session === next) session = null
      },
    })
    session = next
    return next.start()
  }

  async function start(previous?: Session): Promise<ToggleResult> {
    starting = true
    try {
      // A stopped session has no fingerprint, so take it before the stop.
      const after = previous?.fingerprint ?? undefined
      await previous?.stop('close')
      return await begin(after)
    } catch (error) {
      session = null
      if (!(error instanceof ImportError)) console.error(error)
      const message = error instanceof ImportError ? error.message : UNREADABLE
      try {
        Toast.show(message, win.document)
      } catch (failure) {
        // XML and SVG documents refuse shadow roots, so the service worker gets the error without a toast.
        console.error(failure)
      }
      return { kind: 'error', message }
    } finally {
      starting = false
    }
  }

  return {
    async toggle() {
      if (starting) return { kind: 'busy' }
      Toast.dismiss()
      if (session) {
        await session.stop('toolbar')
        return { kind: 'stopped' }
      }
      return start()
    },
  }
}
