import { ImportError } from '../../src/lib/import/errors'
import { Toast } from './bar'
import { InPageSession, type SessionOptions, type StopReason, type ToggleResult } from './session'

/** What the toolbar press calls in the page. */
export interface InPage {
  toggle(): Promise<ToggleResult>
}

export interface Session {
  start(): Promise<ToggleResult>
  stop(reason: StopReason): Promise<{ index: number; from: number }>
}

const UNREADABLE = 'Pacer could not read this page.'

/** Takes away bars, toasts and highlights a copy of Pacer from before an extension reload left behind. */
export function removeForeign(doc: Document): void {
  for (const host of doc.querySelectorAll('pacer-bar, pacer-toast')) host.remove()
  for (const name of [...CSS.highlights.keys()]) if (name.startsWith('pacer-')) CSS.highlights.delete(name)
}

export function createInPage(
  win: Window,
  makeSession: (options: SessionOptions) => Session = (options) => new InPageSession(options),
): InPage {
  let session: Session | null = null
  let starting = false

  async function begin(): Promise<ToggleResult> {
    removeForeign(win.document)
    const next = makeSession({
      win,
      ended: () => {
        if (session === next) session = null
      },
    })
    session = next
    return next.start()
  }

  return {
    async toggle() {
      if (starting) return { kind: 'busy' }
      Toast.dismiss()
      if (session) {
        await session.stop('toolbar')
        return { kind: 'stopped' }
      }
      starting = true
      try {
        return await begin()
      } catch (error) {
        session = null
        if (!(error instanceof ImportError)) console.error(error)
        const message = error instanceof ImportError ? error.message : UNREADABLE
        Toast.show(message, win.document)
        return { kind: 'error', message }
      } finally {
        starting = false
      }
    },
  }
}
