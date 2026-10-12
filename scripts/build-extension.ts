import { cp, mkdir, rm } from 'node:fs/promises'

const OUT = 'extension/dist'
// Bun inlines every font subset into bundled CSS, so the font CSS and files are copied as is and load per subset.
const FONTS = [
  { css: '@fontsource-variable/literata/opsz.css', name: 'literata' },
  { css: '@fontsource-variable/instrument-sans/index.css', name: 'instrument-sans' },
]

async function build(config: Bun.BuildConfig) {
  const result = await Bun.build({
    outdir: OUT,
    target: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
    ...config,
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

await build({ entrypoints: ['./extension/background.ts'], format: 'esm', naming: '[name].[ext]' })
// Injected with scripting.executeScript, which runs classic scripts only.
await build({ entrypoints: ['./extension/extract.ts'], format: 'iife', naming: '[name].[ext]' })
await build({
  entrypoints: ['./extension/reader.tsx', './extension/reader.css'],
  format: 'esm',
  splitting: true,
  naming: { entry: '[name].[ext]', chunk: 'chunks/[name]-[hash].[ext]', asset: 'assets/[name]-[hash].[ext]' },
})

await Promise.all([
  cp('extension/manifest.json', `${OUT}/manifest.json`),
  cp('extension/reader.html', `${OUT}/reader.html`),
  cp('extension/icons', `${OUT}/icons`, { recursive: true }),
  cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', `${OUT}/pdf.worker.min.mjs`),
  ...FONTS.flatMap(({ css, name }) => {
    const dir = `node_modules/${css.slice(0, css.lastIndexOf('/'))}`
    return [cp(`node_modules/${css}`, `${OUT}/fonts/${name}.css`), cp(`${dir}/files`, `${OUT}/fonts/files`, { recursive: true })]
  }),
])

for (const name of ['background.js', 'extract.js', 'reader.js', 'reader.css', 'pdf.worker.min.mjs']) {
  console.log(`${OUT}/${name}  ${(Bun.file(`${OUT}/${name}`).size / 1024).toFixed(0)} kB`)
}
