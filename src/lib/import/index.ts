import { loadFrequency } from '../frequency-web'
import { ImportError, type Imported } from './errors'
import type { PdfJs } from './pdf'
import { withTitle } from './title'

export { ImportError, type Imported }

export const ACCEPT = '.pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown'

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()

async function loadPdfjsDist(): Promise<PdfJs> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export async function importFile(
  file: File,
  onProgress: (message: string) => void,
): Promise<Imported> {
  const name = file.name.toLowerCase()
  const fallbackTitle = baseName(file.name) || null

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    onProgress('Opening PDF')
    const [{ extractPdf }, freq, data] = await Promise.all([
      import('./pdf'),
      loadFrequency(),
      file.arrayBuffer(),
    ])
    return withTitle(await extractPdf(data, onProgress, (w) => freq.has(w), loadPdfjsDist), fallbackTitle)
  }

  if (name.endsWith('.epub') || file.type === 'application/epub+zip') {
    onProgress('Opening EPUB')
    const [{ extractEpub }, data] = await Promise.all([import('./epub'), file.arrayBuffer()])
    return withTitle(await extractEpub(data, onProgress), fallbackTitle)
  }

  if (/\.(txt|md|markdown)$/.test(name) || file.type.startsWith('text/')) {
    return withTitle({ title: null, text: await file.text() }, fallbackTitle)
  }

  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : 'this kind of'
  throw new ImportError(`Pacer cannot open ${ext} files. Try a PDF, EPUB or plain text file.`)
}
