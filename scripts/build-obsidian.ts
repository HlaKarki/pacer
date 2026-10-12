import { copyFile, mkdir } from 'node:fs/promises'

const OUT = 'obsidian/dist'

await mkdir(OUT, { recursive: true })
const result = await Bun.build({
  entrypoints: ['./obsidian/main.ts'],
  outdir: OUT,
  naming: 'main.js',
  target: 'browser',
  format: 'cjs',
  // Obsidian provides these at runtime, and pdf.js comes from its loadPdfJs.
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const css = await Promise.all(['src/reader.css', 'obsidian/tokens.css'].map((path) => Bun.file(path).text()))
await Bun.write(`${OUT}/styles.css`, css.join('\n'))
await copyFile('obsidian/manifest.json', `${OUT}/manifest.json`)

for (const name of ['main.js', 'styles.css', 'manifest.json']) {
  console.log(`${OUT}/${name}  ${(Bun.file(`${OUT}/${name}`).size / 1024).toFixed(0)} kB`)
}
