const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: bun run version <x.y.z>')
  process.exit(1)
}

// Regex keeps each file's own formatting, since the extension manifest is hand-wrapped.
for (const path of ['package.json', 'manifest.json', 'extension/manifest.json']) {
  const text = await Bun.file(path).text()
  if (!/"version": "[^"]*"/.test(text)) throw new Error(`${path} has no version field`)
  await Bun.write(path, text.replace(/"version": "[^"]*"/, `"version": "${version}"`))
}

const { minAppVersion } = await Bun.file('manifest.json').json()
const versions = (await Bun.file('versions.json').exists()) ? await Bun.file('versions.json').json() : {}
versions[version] = minAppVersion
await Bun.write('versions.json', JSON.stringify(versions, null, 2) + '\n')

console.log(`Set version ${version} in package.json, manifest.json, extension/manifest.json and versions.json`)
