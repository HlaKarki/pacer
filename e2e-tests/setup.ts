import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const REPO = process.env.PACER_DIR ?? join(import.meta.dir, '..')
export const OUT = join(import.meta.dir, 'out')

const MAC_CHROME = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'

// Extensions only load in full Chrome for Testing, and any cached build runs these tests, so fall back to the newest one on disk.
function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME
  const own = chromium.executablePath()
  if (existsSync(own)) return own
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)) : []
  builds.sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
  for (const build of builds) {
    const path = join(cache, build, MAC_CHROME)
    if (existsSync(path)) return path
  }
  throw new Error('No Chrome for Testing found. Run `bunx playwright install chromium` or set CHROME.')
}

export const CHROME = findChrome()

const FIXTURE_URLS: Record<string, string> = {
  'alice.epub': 'https://www.gutenberg.org/ebooks/11.epub3.images',
  'attention.pdf': 'https://arxiv.org/pdf/1706.03762v7',
}

export async function fixtures(): Promise<string> {
  const dir = join(import.meta.dir, 'fixtures')
  await mkdir(dir, { recursive: true })
  for (const [name, url] of Object.entries(FIXTURE_URLS)) {
    const path = join(dir, name)
    if (existsSync(path)) continue
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Fixture ${name} failed to download: ${res.status} from ${url}`)
    await Bun.write(path, res)
  }
  return dir
}
