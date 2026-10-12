import { ImportError } from '../src/lib/import/errors'
import { extractArticle, openingsAtTop } from './article'

export type Extracted =
  | { ok: true; title: string | null; text: string; startParagraph: number }
  | { ok: false; message: string }

// The service worker injects this file and then calls the global, since scripting results must be plain data.
Object.assign(globalThis, {
  __pacerExtract: (): Extracted => {
    try {
      // An unscrolled page starts at the title, even when the first lines below it are in view.
      const openings = window.scrollY > 0 ? openingsAtTop(document, window.innerHeight * 0.15) : []
      return { ok: true, ...extractArticle(document, openings) }
    } catch (error) {
      if (error instanceof ImportError) return { ok: false, message: error.message }
      console.error(error)
      return { ok: false, message: 'Pacer could not read this page.' }
    }
  },
})
