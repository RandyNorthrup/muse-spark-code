#!/usr/bin/env node
// Bundle-size gate. The budgets below are the record (PLAN.md section 2, D6,
// mirrors them) and change only with a CHANGELOG entry. Exits 1 when any production artifact exceeds
// its budget or is missing.

import { existsSync, statSync } from 'node:fs'

const BYTES_PER_KIB = 1024

/**
 * @type {ReadonlyArray<{ path: string; budgetKiB: number }>}
 */
const BUDGETS = [
  { path: 'dist/extension.js', budgetKiB: 600 },
  // The Model API backend, loaded when it first starts (M57): 295.6 KiB when
  // split out, plus about a third for the Model API work already planned.
  { path: 'dist/modelApi.js', budgetKiB: 400 },
  // The plan reader, the panel's Markdown parser, loaded on the first plan
  // action (M79): 114.7 KiB when split out, 139.0 KiB with the brief's writer.
  { path: 'dist/planMarkdown.js', budgetKiB: 150 },
  { path: 'dist/searchWorker.js', budgetKiB: 50 },
  // Web fetch's page converter (M69), on a worker started for each page:
  // 201.2 KiB when split out (parse5 122.7 of it), plus room.
  { path: 'dist/pageWorker.js', budgetKiB: 300 },
  { path: 'dist/webview/main.js', budgetKiB: 900 },
  // The ACP agent (M63, PLAN.md D62), a process of its own installed once,
  // never loaded by VS Code: the engine without the webview or the Model API
  // backend (dist/modelApi.js, M57), plus the ACP SDK and the classic zod it
  // imports (445.2 of 713.2 KiB when set, 257.6 of them zod's locales). The
  // measured size plus about 15 %, rounded up to 50 KiB (D6 amendment).
  { path: 'dist/acp.js', budgetKiB: 850 },
]

let hasFailure = false
for (const { path, budgetKiB } of BUDGETS) {
  if (!existsSync(path)) {
    hasFailure = true
    console.log(`MISS ${path}: not built (budget ${budgetKiB} KiB)`)
    continue
  }
  const sizeKiB = statSync(path).size / BYTES_PER_KIB
  const status = sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'
  if (sizeKiB > budgetKiB) {
    hasFailure = true
  }
  console.log(`${status} ${path}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
}

if (hasFailure) {
  console.error('bundle size budget exceeded or a bundle is missing; see PLAN.md section 2 (D6)')
  process.exit(1)
}
