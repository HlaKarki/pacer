import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { ImportError, type Imported } from './errors'
import { linesFromItems, paragraphsFromPages, stripRunningHeads, type PdfLine } from './pdf-layout'

// Margin stamps like arXiv IDs and labels inside figures are set at an angle.
const isHorizontal = (t: number[]) => t[0] > 0 && Math.abs(t[1]) <= t[0] * 0.05

// Authoring tools often leave their own file name or a placeholder in the Title field.
const JUNK_TITLE = /^(untitled|microsoft word\b|.*\.(docx?|pdf|tex|indd|pages)$)/i

export type PdfJs = typeof import('pdfjs-dist')

/** Callers pass their pdf.js loader, so a host that ships its own copy can reuse it. */
export async function extractPdf(
  data: ArrayBuffer,
  onProgress: (message: string) => void,
  isWord: (w: string) => boolean,
  loadPdf: () => Promise<PdfJs>,
): Promise<Imported> {
  const pdfjs = await loadPdf()
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  let doc
  try {
    doc = await task.promise
  } catch (error) {
    const name = (error as Error)?.name
    if (name === 'PasswordException') {
      throw new ImportError('This PDF is password-protected. Remove the password and try again.')
    }
    throw new ImportError('This file could not be opened as a PDF.')
  }

  try {
    const pages: PdfLine[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress(`Reading page ${n} of ${doc.numPages}`)
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const items = content.items
        .filter((item): item is TextItem => 'str' in item && isHorizontal(item.transform))
        .map((item) => ({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          size: item.height || Math.hypot(item.transform[2], item.transform[3]),
          eol: item.hasEOL,
        }))
      pages.push(linesFromItems(items))
      page.cleanup()
    }

    const text = paragraphsFromPages(stripRunningHeads(pages), isWord)
    if (text.replace(/\s/g, '').length < doc.numPages * 20) {
      throw new ImportError(
        'This PDF has no selectable text. It is probably scanned pages, which Pacer cannot read yet.',
      )
    }
    const meta = await doc.getMetadata().catch(() => null)
    const metaTitle = (meta?.info as { Title?: string } | undefined)?.Title?.trim()
    const title = metaTitle && !JUNK_TITLE.test(metaTitle) ? metaTitle : null
    return { title, text }
  } finally {
    await task.destroy()
  }
}
