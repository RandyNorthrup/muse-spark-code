#!/usr/bin/env node
// Bundle-size gate. The budgets below are the record (PLAN.md section 2, D6,
// mirrors them) and change only with a CHANGELOG entry. Exits 1 when any production artifact exceeds
// its budget or is missing.

import { existsSync, statSync } from 'node:fs'

const BYTES_PER_KIB = 1024
// M99: bound the generated notes independently of their ZIP compression.
const WHATS_NEW_CONTENT_BUDGET_KIB = 40

/**
 * @type {ReadonlyArray<{ path: string; budgetKiB: number }>}
 */
const BUDGETS = [
  { path: 'dist/extension.js', budgetKiB: 600 },
  // The Model API backend, loaded when it first starts (M57). Revisited on
  // purpose after M77, M78 and M82 (2026-10-02): 402.8 KiB measured, plus 15%,
  // rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/modelApi.js', budgetKiB: 475 },
  // The review (M70): git's material, the review turn's text, the Plan-mode
  // hold and edit review, loaded the first time one is used: 40.6 KiB when
  // split out, plus room (PLAN.md D6).
  { path: 'dist/review.js', budgetKiB: 50 },
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
  // M89: the bundled skills installer for Muse Code (the copy, the links and
  // zod's parser for the vendor record and the mark), loaded on first use:
  // 22.6 KiB when split out. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/bundledSkills.js', budgetKiB: 50 },
  // Code intelligence's `ide` answers (M67), loaded on the first call, and
  // voice's drivers (M9, M35), loaded on the first recording: split out on
  // 2026-10-03 at 80.3 and 34.5 KiB. Measured size plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/codeIntel.js', budgetKiB: 100 },
  { path: 'dist/voice.js', budgetKiB: 50 },
  // The window's web fetch (M69), loaded on the first fetch: each hop's
  // checks and pins, the pinned transport, the decoders and the failures'
  // words. 46.7 KiB when split out on 2026-10-04, plus 15%, rounded up to
  // 25 KiB (PLAN.md D6).
  { path: 'dist/webFetch.js', budgetKiB: 75 },
  // The Auto reviewer on Muse Code (M90), loaded on the first review: its
  // side session, queue and approvals with M78's reviewer core. 45.4 KiB when
  // split out, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/museCodeReviewer.js', budgetKiB: 75 },
  // What's New (M99, PLAN.md D79), loaded on the first page or notice: the
  // page's renderer, its content schema (zod's mini parser) and its tab.
  // 34.8 KiB when split out, plus 15%, rounded up to 25 KiB.
  { path: 'dist/whatsNew.js', budgetKiB: 50 },
  { path: 'dist/whatsNew.json', budgetKiB: WHATS_NEW_CONTENT_BUDGET_KIB },
  // Shared English fallback; existing host budgets stay unchanged. Measured
  // 104.9 KiB (2026-10-04); plus 15%, rounded up to 25 KiB.
  { path: 'dist/uiText.js', budgetKiB: 125 },
  { path: 'dist/searchWorker.js', budgetKiB: 50 },
  // Web fetch's page converter (M69), on a worker started for each page:
  // 201.2 KiB when split out (parse5 122.7 of it), plus room.
  { path: 'dist/pageWorker.js', budgetKiB: 300 },
  { path: 'dist/webview/main.js', budgetKiB: 900 },
  // What's New's page script (M99): it only passes clicks back to the host.
  // 0.7 KiB when made, plus 15%, rounded up to 25 KiB.
  { path: 'dist/webview/whatsNew.js', budgetKiB: 25 },
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
