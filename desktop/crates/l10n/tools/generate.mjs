#!/usr/bin/env node
// Muse Desktop (M111, D91.20) lane IN: writes the desktop's generated
// language tables from the extension's fifteen UI tables (or, with --check,
// fails naming the stale file). `check:l10n` runs the check on every gate.
//
//   node desktop/crates/l10n/tools/generate.mjs [--check]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { generateAll } from './tables.mjs'

const checkOnly = process.argv.slice(2)
if (checkOnly.length > 1 || (checkOnly.length === 1 && checkOnly[0] !== '--check')) {
  console.error('usage: generate.mjs [--check]')
  process.exitCode = 2
} else {
  const outputs = await generateAll(process.cwd())
  let isStale = false
  for (const { file, text } of outputs) {
    if (checkOnly.length === 1) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== text) {
        console.log(`Stale generated table: ${path.relative(process.cwd(), file)}`)
        isStale = true
      }
    } else {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, text)
      console.log(`wrote ${path.relative(process.cwd(), file)}`)
    }
  }
  if (isStale) {
    console.log('run npm run desktop:l10n to regenerate')
    process.exitCode = 1
  }
}
