/** The message is shown to the reader as is, so write it as interface copy. */
export class ImportError extends Error {
  name = 'ImportError'
}

export interface Imported {
  title: string | null
  text: string
  /** The 1-based page of each paragraph, for PDFs. */
  pages?: number[]
}
