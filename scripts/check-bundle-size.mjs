#!/usr/bin/env node
// Bundle-size gate. The budgets below are the record (PLAN.md section 2, D6,
// mirrors them) and change only with a CHANGELOG entry. Exits 1 when any production artifact exceeds
// its budget.

import { statSync } from 'node:fs'

const BYTES_PER_KIB = 1024

/**
 * @type {ReadonlyArray<{ path: string; budgetKiB: number }>}
 */
const BUDGETS = [
  { path: 'dist/extension.js', budgetKiB: 600 },
  { path: 'dist/searchWorker.js', budgetKiB: 50 },
  { path: 'dist/webview/main.js', budgetKiB: 900 },
  // The ACP agent (M63, PLAN.md D62): the engine without the webview, plus
  // the ACP SDK and the classic zod it imports (445 of 718 KiB when set).
  { path: 'dist/acp.js', budgetKiB: 800 },
]

let hasFailure = false
for (const { path, budgetKiB } of BUDGETS) {
  const sizeKiB = statSync(path).size / BYTES_PER_KIB
  const status = sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'
  if (sizeKiB > budgetKiB) {
    hasFailure = true
  }
  console.log(`${status} ${path}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
}

if (hasFailure) {
  console.error('bundle size budget exceeded; see PLAN.md section 2 (D6)')
  process.exit(1)
}
