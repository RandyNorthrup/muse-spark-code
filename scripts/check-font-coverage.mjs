#!/usr/bin/env node
// The font-coverage gate (M111, D91.20): shapes every UI string with
// HarfBuzz against every image font and fails a missing glyph. A Linux
// gate for desktop CI and local runs; without fontconfig, hb-shape or the
// image's fonts it fails closed (exit 2), naming what is missing.
//
//   node scripts/check-font-coverage.mjs [--root <dir>]

import process from 'node:process'
import { checkFontCoverage } from './lib/fontCoverage.mjs'

const args = process.argv.slice(2)
let repoRoot = process.cwd()
if (args.length === 2 && args[0] === '--root') {
  repoRoot = args[1]
} else if (args.length > 0) {
  console.log('usage: check-font-coverage.mjs [--root <dir>]')
  process.exitCode = 2
}
if (process.exitCode === undefined) {
  try {
    const result = await checkFontCoverage(repoRoot)
    process.stdout.write(result.output)
    process.exitCode = result.code
  } catch (error) {
    process.stdout.write(`font coverage: ${error.message}\n`)
    process.exitCode = 2
  }
}
