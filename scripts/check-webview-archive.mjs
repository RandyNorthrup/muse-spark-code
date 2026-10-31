#!/usr/bin/env node
// The packaged webview assertion (VSIXWEB A): the shipped .vsix carries the
// solid archive with every file each panel's HTML needs, and no loose
// webview member beside it. The stage check in scripts/package-vsix.mjs
// already proves every emitted script joined the archive; this proves the
// artifact kept the archive and dropped the loose files.
import { readZip } from '@vscode/vsce/out/zip.js'
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

// The .vsix is read with the packager's own ZIP reader, so no `unzip` program
// has to be on PATH (a Windows shell outside Git Bash has none). The reader
// names every entry in lower case and reads only the one the filter accepts.
async function readVsix(vsix) {
  const entries = []
  const read = await readZip(vsix, (name) => {
    entries.push(name)
    return name === ARCHIVE_ENTRY
  })
  return { entries, packed: read.get(ARCHIVE_ENTRY) }
}

async function main() {
  const vsix = process.argv[2]
  if (vsix === undefined) throw new Error('Usage: node scripts/check-webview-archive.mjs <vsix>')
  const { entries, packed } = await readVsix(vsix)
  const loose = entries.filter((entry) => entry.startsWith(LOOSE_PREFIX) && entry !== LOOSE_PREFIX)
  if (loose.length > 0)
    throw new Error(`Loose webview members ship in ${vsix}: ${loose.slice(0, 5).join(', ')}`)
  if (packed === undefined) throw new Error(`Webview archive missing in ${vsix}`)
  const members = assertArchiveMembers(packed, REQUIRED_MEMBERS, 4_000_000, 1, true)
  console.log(`webview archive: ${String(members)} members, every panel file present in ${vsix}`)
}

if (isEntryPoint(import.meta.url)) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
