import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const vault = process.argv[2]
if (!vault) {
  console.error('Usage: bun run install:obsidian <path to vault>')
  process.exit(1)
}
if (!(await stat(join(vault, '.obsidian')).catch(() => null))?.isDirectory()) {
  console.error(`${vault} has no .obsidian folder, so it is not an Obsidian vault.`)
  process.exit(1)
}

const target = join(vault, '.obsidian', 'plugins', 'pacer')
await mkdir(target, { recursive: true })
for (const name of ['main.js', 'styles.css', 'manifest.json']) {
  await copyFile(name, join(target, name))
}
console.log(`Installed Pacer into ${target}. Enable it under Settings → Community plugins.`)
