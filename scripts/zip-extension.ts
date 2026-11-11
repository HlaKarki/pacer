import { readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { zipSync, type Zippable } from 'fflate'

const DIST = 'extension/dist'
const { version } = await Bun.file('extension/manifest.json').json()

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])))
  return nested.flat()
}

// A fixed mtime and sorted entries keep the zip byte-identical across builds.
const mtime = new Date('2026-01-01T00:00:00Z')
const tree: Zippable = {}
for (const path of (await files(DIST)).sort()) {
  if (path.endsWith('.DS_Store')) continue
  tree[relative(DIST, path)] = [new Uint8Array(await Bun.file(path).arrayBuffer()), { mtime }]
}

const out = `release/pacer-chrome-${version}.zip`
await Bun.write(out, zipSync(tree, { level: 9 }))
console.log(`${out}  ${(Bun.file(out).size / 1024 / 1024).toFixed(1)} MB, ${Object.keys(tree).length} files`)
