#!/usr/bin/env node
// M110os OS5: the add-on manifest check.
// node os/addons/check-addon.mjs --manifest <addon.json> [--tree <dir>]
// Exits 0 when the manifest is sound (and the tree matches it), 1 when
// the tree mismatches, 2 on a usage, manifest or input error.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateManifest, validateTree } from './lib/checkAddon.mjs'

function usage() {
  console.log(
    [
      'usage: check-addon.mjs --manifest <addon.json> [--tree <dir>]',
      'exit 0: the manifest is sound (and the tree matches it)',
      'exit 1: the tree mismatches the manifest',
      'exit 2: usage, manifest or input error',
    ].join('\n'),
  )
}

function args() {
  const values = {}
  const flags = process.argv.slice(2)
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--help') return { help: true }
    if (flag !== '--manifest' && flag !== '--tree') {
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
  console.error(`check-addon: ${parsed.error}`)
  process.exit(2)
}
const { manifest, tree } = parsed.values
if (manifest === undefined) {
  console.error('check-addon: pass --manifest <addon.json>')
  process.exit(2)
}
let text
try {
  text = readFileSync(manifest, 'utf8')
} catch {
  console.error(`check-addon: manifest not readable: ${manifest}`)
  process.exit(2)
}
let data
try {
  data = JSON.parse(text)
} catch {
  console.error(`check-addon: manifest is not JSON: ${manifest}`)
  process.exit(2)
}
const manifestDir = path.dirname(path.resolve(manifest))
const checked = validateManifest(data, manifestDir)
if (!checked.ok) {
  for (const error of checked.errors) console.error(`check-addon: ${error}`)
  process.exit(2)
}
if (tree === undefined) {
  console.log(`check-addon: ${data.name} manifest is sound`)
  process.exit(0)
}
const matched = validateTree(data, path.resolve(tree))
if (!matched.ok) {
  for (const error of matched.errors) console.error(`check-addon: ${error}`)
  process.exit(1)
}
console.log(`check-addon: ${data.name} matches its tree`)
