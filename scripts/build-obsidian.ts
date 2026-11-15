import { build } from 'esbuild'

// Obsidian's directory scan runs `build` and expects main.js and styles.css beside manifest.json at the repo root.
const OUT = '.'

// React DOM 19 contains createElement('script'), which Obsidian's directory scan rejects as an error, so the plugin bundles Preact instead.
// Subpaths follow, so react/jsx-runtime becomes preact/compat/jsx-runtime and react-dom/client becomes preact/compat/client.
const PREACT = { react: 'preact/compat', 'react-dom': 'preact/compat' }

// The scan rebuilds main.js with whatever Bun its machine has, and Bun's bundler output changes between versions, so a pinned esbuild bundles the plugin.
await build({
  entryPoints: ['obsidian/main.ts'],
  outfile: `${OUT}/main.js`,
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  // The root tsconfig only holds project references, so esbuild finds no jsx setting there and would emit React.createElement.
  jsx: 'automatic',
  // Obsidian provides these at runtime, and pdf.js comes from its loadPdfJs.
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: PREACT,
  minify: true,
  logLevel: 'warning',
})

const css = await Promise.all(['src/reader.css', 'obsidian/tokens.css'].map((path) => Bun.file(path).text()))
await Bun.write(`${OUT}/styles.css`, css.join('\n'))

for (const name of ['main.js', 'styles.css']) {
  console.log(`${name}  ${(Bun.file(name).size / 1024).toFixed(0)} kB`)
}
