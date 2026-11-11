// Bundled into the smoke extension copy and run in Pacer's isolated world, so it builds the same Doc and WordMap a press would.
import { extractArticle } from '@pacer/extension/article'
import { WordMap } from '@pacer/extension/inpage/map'
import { viewportStart } from '@pacer/extension/inpage/start'
import { parse } from '@pacer/src/lib/text'

const BLOCK = 'p, li, h1, h2, h3, h4, blockquote, pre, figcaption, dd, dt, td, th'

Object.assign(globalThis, {
  __pacerProbe: () => {
    const t0 = performance.now()
    const article = extractArticle(document, [])
    const doc = parse(article.text)
    const map = WordMap.build(doc, document.body)
    const start = viewportStart(doc, map, window)
    const ms = performance.now() - t0
    const paras = doc.paragraphs.map(({ start: s, end }) => {
      let mapped = 0
      for (let i = s; i < end; i++) if (map.blockOf(i) >= 0) mapped++
      return { mapped, words: end - s, text: doc.words.slice(s, Math.min(end, s + 8)).map((w) => w.text).join(' ') }
    })
    const at = start?.at ?? -1
    const el = at >= 0 ? map.rangeOf(at, at + 1)?.startContainer.parentElement?.closest(BLOCK) : null
    return {
      ms: Math.round(ms),
      words: doc.words.length,
      coverage: map.coverage,
      paragraphs: paras.length,
      unmapped: paras.filter((p) => p.mapped === 0).map((p) => p.text),
      weak: paras.filter((p) => p.mapped > 0 && p.mapped / p.words < 0.9).map((p) => `${p.mapped}/${p.words} ${p.text}`),
      start,
      startWord: at >= 0 ? doc.words[at].text : null,
      startBlock: el?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 60) ?? null,
      head: doc.words.slice(0, 14).map((w, i) => {
        const r = map.rangeOf(i, i + 1)
        const b = r?.startContainer.parentElement?.closest(`${BLOCK}, header, nav`)
        return `${w.text} -> ${r ? `${b?.localName}:${b?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 30)}` : '-'}`
      }),
    }
  },
})
