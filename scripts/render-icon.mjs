#!/usr/bin/env node
// Renders media/marketplace-icon.svg to media/icon.png (128×128, the size the
// Marketplace expects; it rejects SVG for `icon`) with headless Chrome, the
// same browser the harness screenshots use. Not a gate: run it when the SVG
// changes and commit the PNG.
//
//   node scripts/render-icon.mjs
//   CHROME_PATH=/path/to/chrome node scripts/render-icon.mjs

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { findChrome } from './lib/chrome.mjs'

const SOURCE = 'media/marketplace-icon.svg'
const TARGET = 'media/icon.png'
const SIZE = 128

const execFileAsync = promisify(execFile)

async function main() {
  const chrome = findChrome()
  if (chrome === undefined) {
    console.error('render-icon: no Chrome found; set CHROME_PATH')
    process.exit(1)
  }
  const svg = await readFile(SOURCE, 'utf8')
  const work = await mkdtemp(path.join(tmpdir(), 'muse-icon-'))
  try {
    // A page exactly the icon's size, the SVG filling it edge to edge.
    const page = path.join(work, 'icon.html')
    await writeFile(
      page,
      `<!doctype html><html><head><style>html,body{margin:0;width:${String(SIZE)}px;height:${String(SIZE)}px;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`,
    )
    const target = path.resolve(TARGET)
    await execFileAsync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--default-background-color=00000000',
      `--user-data-dir=${path.join(work, 'profile')}`,
      `--window-size=${String(SIZE)},${String(SIZE)}`,
      `--screenshot=${target}`,
      `file://${page}`,
    ])
    console.log(`rendered ${SOURCE} -> ${TARGET}`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

await main()
