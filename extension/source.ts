import { extractEpub } from '../src/lib/import/epub'
import { ImportError, type Imported } from '../src/lib/import/errors'
import { extractPdf, type PdfJs } from '../src/lib/import/pdf'
import { withTitle } from '../src/lib/import/title'
import { getDoc } from './docs'
import { frequency } from './frequency'
import { nameFromUrl, pageFromUrl, paragraphOnPage, withoutHash } from './pages'

export interface Opened {
  title: string
  text: string
  /** Where leaving goes back to, or null for a file picked from disk. */
  src: string | null
  /** The 1-based page of each paragraph, for PDFs that came from a tab. */
  pages: number[] | null
  startParagraph: number
  /** Saved places are kept under this. */
  key: string
}

/** Chrome keeps local files from extensions until the reader turns on file access. */
export class FileAccessError extends Error {
  name = 'FileAccessError'
}

export const PICKABLE = '.pdf,.epub,application/pdf,application/epub+zip'

async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.mjs')
  return pdfjs
}

function readPdf(data: ArrayBuffer, onProgress: (message: string) => void): Promise<Imported> {
  onProgress('Opening PDF')
  const freq = frequency()
  return extractPdf(data, onProgress, (w) => freq.has(w), loadPdfJs)
}

export async function openDoc(id: string, onProgress: (message: string) => void): Promise<Opened> {
  const record = await getDoc(id)
  if (!record) throw new ImportError('This document is no longer cached. Go back and press Pacer again.')
  if (record.error?.fileAccess) throw new FileAccessError()
  if (record.error) throw new ImportError(record.error.message)

  const base = { src: record.src, key: withoutHash(record.src) }
  if (record.kind === 'article') {
    const title = record.title ?? nameFromUrl(record.src) ?? 'Untitled'
    return { ...base, title, text: record.text ?? '', pages: null, startParagraph: record.startParagraph ?? 0 }
  }
  const title = nameFromUrl(record.src) ?? record.title ?? 'Untitled'
  // Chrome titles a PDF tab with its file name, so the PDF's own title or first heading reads better.
  const imported = withTitle(await readPdf(record.bytes ?? new ArrayBuffer(0), onProgress), title)
  const pages = imported.pages ?? null
  const page = pageFromUrl(record.src)
  return {
    ...base,
    title: imported.title ?? title,
    text: imported.text,
    pages,
    startParagraph: pages && page ? paragraphOnPage(pages, page) : 0,
  }
}

export async function openFile(file: File, onProgress: (message: string) => void): Promise<Opened> {
  const name = file.name.toLowerCase()
  let imported: Imported
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    imported = await readPdf(await file.arrayBuffer(), onProgress)
  } else if (name.endsWith('.epub') || file.type === 'application/epub+zip') {
    onProgress('Opening EPUB')
    imported = await extractEpub(await file.arrayBuffer(), onProgress)
  } else {
    throw new ImportError('Pacer opens PDF and EPUB files here.')
  }
  const fallback = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled'
  const { title, text } = withTitle(imported, fallback)
  return { title: title ?? fallback, text, src: null, pages: null, startParagraph: 0, key: `picked:${file.name}:${file.size}` }
}
