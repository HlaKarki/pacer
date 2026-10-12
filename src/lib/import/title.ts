import type { Imported } from './errors'

function firstHeading(text: string): string | null {
  const head = text.split(/\n\s*\n/, 12).find((p) => /^#{1,2} /.test(p))
  return head ? head.replace(/^#{1,2} /, '').trim() : null
}

export const withTitle = (result: Imported, fallback: string | null): Imported => ({
  ...result,
  title: result.title ?? firstHeading(result.text) ?? fallback,
})
