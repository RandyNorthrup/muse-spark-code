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
  // The Model API backend, loaded when it first starts (M57). Revisited on
  // purpose after M77, M78 and M82 (2026-10-02): 402.8 KiB measured, plus 15%,
  // rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/modelApi.js', budgetKiB: 475 },
  // M78b: first board/best-of-N action, 61.0 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/sessionBoard.js', budgetKiB: 75 },
  // M78b: paid Auto review after consent, 55.2 KiB with the same rule.
  { path: 'dist/reviewer.js', budgetKiB: 75 },
  // The plan reader, the panel's Markdown parser, loaded on the first plan
  // action (M79): 114.7 KiB when split out, 139.0 KiB with the brief's writer.
  { path: 'dist/planMarkdown.js', budgetKiB: 150 },
  // M72: real checkpoint store/legacy reader, 187.0 KiB when split out.
  // Measured size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/checkpointStore.js', budgetKiB: 225 },
  // M83: the import from other agents (the scan, the converters, the file
  // access, the flow and smol-toml), loaded on the first import: 100.0 KiB
  // when split out. Measured size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/agentImport.js', budgetKiB: 125 },
  // Code intelligence's `ide` answers (M67), loaded on the first call, and
  // voice's drivers (M9, M35), loaded on the first recording: split out on
  // 2026-10-03 at 80.3 and 34.5 KiB. Measured size plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/codeIntel.js', budgetKiB: 100 },
  { path: 'dist/voice.js', budgetKiB: 50 },
  // Shared English fallback; existing host budgets stay unchanged.
  { path: 'dist/uiText.js', budgetKiB: 100 },
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
