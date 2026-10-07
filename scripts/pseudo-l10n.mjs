#!/usr/bin/env node
// Writes the harness's pseudo-locale tables
// (test/harness/l10n/ui.pseudo.json and test/harness/l10n/usage.pseudo.json,
// git-ignored) from the English ones (PLAN.md D33); see scripts/lib/harnessLang.mjs.
// Open the harness with `?lang=pseudo`, or pass `--lang=pseudo` to
// scripts/harness-shots.mjs or scripts/a11y.mjs, which write them themselves.
//
//   node scripts/pseudo-l10n.mjs

import path from 'node:path'
import process from 'node:process'
import { writePseudoTable } from './lib/harnessLang.mjs'

const repoRoot = process.cwd()
const files = await writePseudoTable(repoRoot)
for (const file of files) {
  console.log(`pseudo table: ${path.relative(repoRoot, file)}`)
}
