/** Places are saved per document, and the hash only says where the viewer was scrolled. */
export const withoutHash = (url: string) => url.replace(/#.*$/, '')

/** The page from a `#page=N` hash, which Chrome's PDF viewer opens at. */
export function pageFromUrl(url: string): number | null {
  const match = /#(?:.*&)?page=(\d+)/.exec(url)
  const page = match ? Number(match[1]) : NaN
  return page >= 1 ? page : null
}

export const withPage = (url: string, page: number) => `${withoutHash(url)}#page=${page}`

/** The first paragraph that starts on the page, or on the next page with text when that one has none. */
export function paragraphOnPage(pages: number[], page: number): number {
  const at = pages.findIndex((p) => p >= page)
  return at === -1 ? Math.max(0, pages.length - 1) : at
}

export function nameFromUrl(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '')
    return last.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || null
  } catch {
    return null
  }
}
