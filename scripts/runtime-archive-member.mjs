#!/usr/bin/env node
// Prints one member of a packed runtime archive: `dist/runtime.bundles.json.br`
// in a VSIX, written by scripts/lib/packageArchive.mjs. In the package,
// `dist/<member>` is only a loader that reads its code from this archive, so
// the release reads `voiceLinux.js` this way to check the helper pins each
// VSIX really carries (.github/workflows/release.yml).
//
//   node scripts/runtime-archive-member.mjs <runtime.bundles.json.br> <member>

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { brotliDecompressSync } from 'node:zlib'

const args = process.argv.slice(2)
if (args.length !== 2) {
  console.error('usage: node scripts/runtime-archive-member.mjs <runtime.bundles.json.br> <member>')
  process.exit(2)
}
const [file, member] = args
const archive = JSON.parse(brotliDecompressSync(readFileSync(file)).toString('utf8'))
if (archive?.version !== 1 || typeof archive.bundles !== 'object' || archive.bundles === null) {
  console.error(`${file} is not a version 1 runtime archive`)
  process.exit(1)
}
const source = Object.hasOwn(archive.bundles, member) ? archive.bundles[member] : undefined
if (typeof source !== 'string') {
  console.error(`${file} has no ${member}`)
  process.exit(1)
}
process.stdout.write(source)
