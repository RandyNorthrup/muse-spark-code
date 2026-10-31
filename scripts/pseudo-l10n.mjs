#!/usr/bin/env node
// Writes the harness's pseudo-locale tables (test/harness/l10n/ui.pseudo.json
// and test/harness/l10n/usage.pseudo.json plus the pseudo-rtl pair, all
// git-ignored) from the English ones (PLAN.md D33 and M111 D91.20); see
// scripts/lib/harnessLang.mjs. Open the harness with `?lang=pseudo` or
// `?lang=pseudo-rtl`, or pass `--lang=` to scripts/ui-look.mjs or
// scripts/a11y.mjs, which write them themselves.
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
