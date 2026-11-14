import type { BunPlugin } from 'bun'

// Obsidian's directory scan runs `build` and expects main.js and styles.css beside manifest.json at the repo root.
const OUT = '.'

// React DOM 19 contains createElement('script'), which Obsidian's directory scan rejects as an error, so the plugin bundles Preact instead.
const PREACT: Record<string, string> = {
  react: 'preact/compat',
  'react-dom': 'preact/compat',
  'react-dom/client': 'preact/compat/client',
  'react/jsx-runtime': 'preact/compat/jsx-runtime',
  'react/jsx-dev-runtime': 'preact/compat/jsx-dev-runtime',
}
const preact: BunPlugin = {
  name: 'preact',
  setup(build) {
    build.onResolve({ filter: /^react(-dom)?(\/[a-z-]+)?$/ }, ({ path }) =>
      PREACT[path] ? { path: Bun.resolveSync(PREACT[path], process.cwd()) } : undefined,
    )
  },
}

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
  plugins: [preact],
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const css = await Promise.all(['src/reader.css', 'obsidian/tokens.css'].map((path) => Bun.file(path).text()))
await Bun.write(`${OUT}/styles.css`, css.join('\n'))

for (const name of ['main.js', 'styles.css']) {
  console.log(`${name}  ${(Bun.file(name).size / 1024).toFixed(0)} kB`)
}
