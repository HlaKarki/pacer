import { loadFrequency } from '../frequency'
import { ImportError, type Imported } from './errors'

export { ImportError, type Imported }

export const ACCEPT = '.pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown'

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()

function firstHeading(text: string): string | null {
  const head = text.split(/\n\s*\n/, 12).find((p) => /^#{1,2} /.test(p))
  return head ? head.replace(/^#{1,2} /, '').trim() : null
}

const withTitle = (result: Imported, fallback: string | null): Imported => ({
  ...result,
  title: result.title ?? firstHeading(result.text) ?? fallback,
})

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
    return withTitle(await extractPdf(data, onProgress, (w) => freq.has(w)), fallbackTitle)
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
