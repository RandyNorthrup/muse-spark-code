#!/usr/bin/env node
// Renders the SVG brand assets to PNG with headless Chrome, the same browser
// the harness screenshots use: the Marketplace icon (the Marketplace rejects
// SVG for `icon`), the README banner and the GitHub social preview. Not a
// gate: run it when an SVG changes and commit the PNGs.
//
//   node scripts/render-images.mjs                 every asset
//   node scripts/render-images.mjs icon banner     a subset
//   CHROME_PATH=/path/to/chrome node scripts/render-images.mjs

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { findChrome } from './lib/chrome.mjs'

const ASSETS = {
  icon: { source: 'media/marketplace-icon.svg', target: 'media/icon.png', width: 128, height: 128 },
  banner: {
    source: 'media/banner.svg',
    target: 'media/readme/banner.png',
    width: 1280,
    height: 400,
  },
  social: {
    source: 'media/social-preview.svg',
    target: 'media/social-preview.png',
    width: 1280,
    height: 640,
  },
}

const execFileAsync = promisify(execFile)

async function render(chrome, work, name, asset) {
  const svg = await readFile(asset.source, 'utf8')
  // A page exactly the asset's size, the SVG filling it edge to edge.
  const page = path.join(work, `${name}.html`)
  const size = `width:${String(asset.width)}px;height:${String(asset.height)}px`
  await writeFile(
    page,
    `<!doctype html><html><head><style>html,body{margin:0;${size};overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`,
  )
  const target = path.resolve(asset.target)
  await mkdir(path.dirname(target), { recursive: true })
  await execFileAsync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--default-background-color=00000000',
    `--user-data-dir=${path.join(work, `profile-${name}`)}`,
    `--window-size=${String(asset.width)},${String(asset.height)}`,
    `--screenshot=${target}`,
    `file://${page}`,
  ])
  console.log(`rendered ${asset.source} -> ${asset.target}`)
}

async function main() {
  const requested = process.argv.slice(2)
  const unknown = requested.filter((name) => !Object.hasOwn(ASSETS, name))
  if (unknown.length > 0) {
    console.error(
      `render-images: unknown asset(s) ${unknown.join(', ')}; known: ${Object.keys(ASSETS).join(', ')}`,
    )
    process.exit(1)
  }
  const names = requested.length > 0 ? requested : Object.keys(ASSETS)
  const chrome = findChrome()
  if (chrome === undefined) {
    console.error('render-images: no Chrome found; set CHROME_PATH')
    process.exit(1)
  }
  const work = await mkdtemp(path.join(tmpdir(), 'muse-images-'))
  try {
    for (const name of names) {
      await render(chrome, work, name, ASSETS[name])
    }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

await main()
