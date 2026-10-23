#!/usr/bin/env node
// M110os2 OS6: the SPDX SBOM writer.
// node scripts/os-sbom.mjs --manifest FILE --image FILE --out FILE
// Reads mkosi's JSON package manifest, hashes the raw image it names,
// and writes the SPDX 2.3 document. Exits 0 on a written SBOM, 2 on a
// usage or input error.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseManifest, sha256File, spdxDocument } from './lib/osSbom.mjs'

function usage() {
  console.log(
    [
      'usage: os-sbom.mjs --manifest FILE --image FILE --out FILE',
      'exit 0: the SBOM is written',
      'exit 2: usage or input error',
    ].join('\n'),
  )
}

const VALUE_FLAGS = new Set(['--manifest', '--image', '--out'])

function args() {
  const values = {}
  const flags = process.argv.slice(2)
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--help') return { help: true }
    if (flag === undefined || !VALUE_FLAGS.has(flag)) {
      return { error: `unknown flag: ${flag ?? '(missing)'}` }
    }
    const value = flags[index + 1]
    if (value === undefined || value.startsWith('--')) return { error: `missing value: ${flag}` }
    values[flag.slice(2)] = value
    index += 1
  }
  return { values }
}

const parsed = args()
if ('help' in parsed) {
  usage()
  process.exit(0)
}
if ('error' in parsed) {
  console.error(`os-sbom: ${parsed.error}`)
  process.exit(2)
}
const options = parsed.values
for (const flag of ['manifest', 'image', 'out']) {
  if (options[flag] !== undefined && options[flag] !== '') continue
  console.error(`os-sbom: pass --${flag} FILE`)
  process.exit(2)
}
for (const flag of ['manifest', 'image']) {
  if (existsSync(options[flag])) continue
  console.error(`os-sbom: ${flag} not found: ${options[flag]}`)
  process.exit(2)
}
let text
try {
  text = readFileSync(options.manifest, 'utf8')
} catch {
  console.error(`os-sbom: manifest not readable: ${options.manifest}`)
  process.exit(2)
}
const manifest = parseManifest(text)
if (!manifest.ok) {
  console.error(`os-sbom: ${manifest.error}: ${options.manifest}`)
  process.exit(2)
}
let digest
try {
  digest = await sha256File(options.image)
} catch {
  console.error(`os-sbom: image not readable: ${options.image}`)
  process.exit(2)
}
// SPDX timestamps carry whole seconds, never milliseconds.
const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const document = spdxDocument(manifest.manifest, digest, created)
try {
  writeFileSync(options.out, `${JSON.stringify(document, null, 2)}\n`)
} catch {
  console.error(`os-sbom: output not writable: ${options.out}`)
  process.exit(2)
}
console.log(
  `os-sbom: wrote ${options.out} with ${String(manifest.manifest.packages.length)} packages`,
)
