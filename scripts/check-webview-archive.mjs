#!/usr/bin/env node
// The packaged webview assertion (VSIXWEB A): the shipped .vsix carries the
// solid archive with every file each panel's HTML needs, and no loose
// webview member beside it. The stage check in scripts/package-vsix.mjs
// already proves every emitted script joined the archive; this proves the
// artifact kept the archive and dropped the loose files.
import { execFileSync } from 'node:child_process'
import { assertArchiveMembers } from './lib/solidTextArchive.mjs'
import { isEntryPoint } from './lib/entryPoint.mjs'

// One entry per document a panel builds: the chat and tasks (main),
// Models & Agents (models), usage, What's New and reporting.
const REQUIRED_MEMBERS = [
  'main.js',
  'main.css',
  'models.js',
  'models.css',
  'usage.js',
  'usage.css',
  'whatsNew.js',
  'whatsNew.css',
  'reportingPage.js',
  'reportingPage.css',
]
const LOOSE_PREFIX = 'extension/dist/webview/'
const ARCHIVE_ENTRY = 'extension/dist/webview.json.br'

function listed(vsix) {
  return execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8' }).split('\n')
}

function main() {
  const vsix = process.argv[2]
  if (vsix === undefined) throw new Error('Usage: node scripts/check-webview-archive.mjs <vsix>')
  const entries = listed(vsix)
  const loose = entries.filter((entry) => entry.startsWith(LOOSE_PREFIX) && entry !== LOOSE_PREFIX)
  if (loose.length > 0)
    throw new Error(`Loose webview members ship in ${vsix}: ${loose.slice(0, 5).join(', ')}`)
  if (!entries.includes(ARCHIVE_ENTRY)) throw new Error(`Webview archive missing in ${vsix}`)
  const packed = execFileSync('unzip', ['-p', vsix, ARCHIVE_ENTRY], { maxBuffer: 16 * 1024 * 1024 })
  const members = assertArchiveMembers(packed, REQUIRED_MEMBERS, 4_000_000, 1, true)
  console.log(`webview archive: ${String(members)} members, every panel file present in ${vsix}`)
}

if (isEntryPoint(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
