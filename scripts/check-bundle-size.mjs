#!/usr/bin/env node
// Bundle-size gate. The budgets below are the record (PLAN.md section 2, D6,
// mirrors them) and change only with a CHANGELOG entry. Exits 1 when any production artifact exceeds
// its budget or is missing.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { DEFERRED_WEBVIEW_SURFACES, webviewStartupOutputs } from './lib/webviewBundles.mjs'

const BYTES_PER_KIB = 1024
// M99: bound the generated notes independently of their ZIP compression.
const WHATS_NEW_CONTENT_BUDGET_KIB = 40

/**
 * @type {ReadonlyArray<{ path: string; budgetKiB: number }>}
 */
const BUDGETS = [
  { path: 'dist/extension.js', budgetKiB: 600 },
  // ACTDIET: first chat surface; 216.0 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/conversation.js', budgetKiB: 250 },
  // M94: provider, engine and ledger on first Tab use (PLAN.md D6).
  { path: 'dist/tab.js', budgetKiB: 75 },
  // The Model API backend, loaded when it first starts (M57). Revisited on
  // purpose after M77, M78 and M82 (2026-10-02): 402.8 KiB measured, plus 15%,
  // rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/modelApi.js', budgetKiB: 475 },
  // M95 integration: measured 93.0, 50.1 and 404.7 KiB respectively.
  // New bundles use measured + 15%, rounded up to 25 KiB (D6/D74).
  { path: 'dist/providers.js', budgetKiB: 125 },
  { path: 'dist/modelsPanel.js', budgetKiB: 75 },
  { path: 'dist/webview/models.js', budgetKiB: 475 },
  // The review (M70): git's material, the review turn's text, the Plan-mode
  // hold and edit review, loaded the first time one is used: 40.6 KiB when
  // split out, plus room (PLAN.md D6).
  { path: 'dist/review.js', budgetKiB: 50 },
  // M78b: first board/best-of-N action, 61.0 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/sessionBoard.js', budgetKiB: 75 },
  // M78b: paid Auto review after consent, 55.2 KiB with the same rule.
  { path: 'dist/reviewer.js', budgetKiB: 75 },
  // M91 lane W: the imported hooks' adapters (lane P's contracts and engine),
  // loaded the first time a session holding one runs a hook: 64.9 KiB when
  // split out (2026-10-04). 85.7 KiB once the imported records' reader moved
  // in from dist/modelApi.js (2026-10-05), 65.4 KiB with main's shared
  // dist/validation.js; plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/foreignHooks.js', budgetKiB: 100 },
  // M91: the hook and MCP-form runtime (lane E's spark-hooks.json reader and
  // dispatcher, lane H's typed handlers, lane M's form checks), moved out of
  // dist/modelApi.js and loaded on first use: 67.1 KiB when split out
  // (2026-10-05), 41.7 KiB once main's shared dist/validation.js carried its
  // zod/mini, plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/hookRuntime.js', budgetKiB: 50 },
  // M91b: the Amp and OpenCode plugin host (its child's source, the host and
  // the event mapping), loaded on the first plugin hook: 51.6 KiB when split
  // out (2026-10-05), 33.8 KiB on 0.13.0's shared dist/validation.js; plus
  // 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/pluginHooks.js', budgetKiB: 50 },
  // The plan reader, the panel's Markdown parser, loaded on the first plan
  // action (M79): 114.7 KiB when split out, 139.0 KiB with the brief's writer.
  { path: 'dist/planMarkdown.js', budgetKiB: 150 },
  // M72: real checkpoint store/legacy reader, 187.0 KiB when split out.
  // Measured size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/checkpointStore.js', budgetKiB: 225 },
  // M83: the import from other agents (the scan, the converters, the file
  // access, the flow and smol-toml), loaded on the first import: 100.0 KiB
  // when split out. Measured size plus 15%, rounded up to 25 KiB (PLAN.md D6).
  // M91 lane I's readers for every agent's hooks: 108.1 KiB with main's shared
  // dist/validation.js (2026-10-05), within the unchanged budget.
  { path: 'dist/agentImport.js', budgetKiB: 125 },
  // M81: the browser check's pipe, run and processes, required on the first
  // check: 37.8 KiB when split out (zod/mini 14.8 of it). Measured size
  // plus 15%, rounded up to 25 KiB (PLAN.md D6). 44.5 KiB after the RV81
  // fixes; 49.8 KiB with A1's proxy, canaries and lifetimes (design spec v4
  // §9.1 held it at 50; the runtime store went to its own bundle below).
  // 50.5 KiB after A1's first review round (per-phase canary fixtures, the
  // upstream head bound), with no module off the check's path to split out:
  // 25 × ceil(1.15 × 50.5 / 25) = 75 KiB.
  { path: 'dist/browserCheck.js', budgetKiB: 75 },
  // M81 A1: the browser check's runtime acquisition (pin, download, bounded
  // ZIP extraction, hashing, publication), loaded only to prepare a runtime:
  // 37.2 KiB when split out. Measured size plus 15%, rounded up to 25 KiB.
  { path: 'dist/browserRuntime.js', budgetKiB: 50 },
  // M71: the conversations' Git adapter and, since 2026-10-03, the window's
  // git and pull request features moved out of activation: 127.4 KiB
  // measured; plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/conversationGit.js', budgetKiB: 150 },
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
  // M91 E: both-backend hooks, 45.4 KiB + 15%, rounded up to 25 KiB.
  { path: 'dist/extensionHooks.js', budgetKiB: 75 },
  // The report dialog (M93): the builder, its second scrub, the export paths
  // and the handler, loaded on the first open. 63.6 KiB when split out (its
  // own zod), plus 15%, rounded up to 25 KiB (PLAN.md D6).
  { path: 'dist/report.js', budgetKiB: 75 },
  // The flight recorder's journal (M93), loaded just after activation or at
  // the first failure: 51.3 KiB when split out (the journal, its policy and
  // the shared protocol it validates against), plus 15%, rounded up to 25 KiB
  // (PLAN.md D6).
  { path: 'dist/recorder.js', budgetKiB: 75 },
  // What's New (M99, PLAN.md D79), loaded on the first page or notice: the
  // page's renderer, its content schema (zod's mini parser) and its tab.
  // 34.8 KiB when split out, plus 15%, rounded up to 25 KiB.
  { path: 'dist/whatsNew.js', budgetKiB: 50 },
  { path: 'dist/whatsNew.json', budgetKiB: WHATS_NEW_CONTENT_BUDGET_KIB },
  // Shared English fallback; TRAIN14 restores the original cap after the
  // lossless packed fallback and ACTDIET region split (PLAN.md D6).
  // M98: first eligible approval, measured 77.7 KiB + 15%, rounded to 25 KiB.
  // Every existing budget is unchanged (PLAN.md D6).
  { path: 'dist/judge.js', budgetKiB: 100 },
  // Shared English fallback; existing host budgets stay unchanged. Measured
  // 104.9 KiB (2026-10-04); plus 15%, rounded up to 25 KiB.
  { path: 'dist/uiText.js', budgetKiB: 125 },
  { path: 'dist/uiTextRuntime.js', budgetKiB: 25 },
  { path: 'dist/uiTextHooks.js', budgetKiB: 25 },
  { path: 'dist/uiTextSurfaces.js', budgetKiB: 25 },
  // TRAIN13B: used Node mini-parser API, 39.5 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/validation.js', budgetKiB: 50 },
  // Shared existing Node boundary schemas: 41.3 KB plus 15%, rounded to 25 KiB.
  { path: 'dist/wire.js', budgetKiB: 50 },
  { path: 'dist/searchWorker.js', budgetKiB: 50 },
  // M101: pure raster worker, 58.7 KiB + 15%, rounded to 25 KiB.
  { path: 'dist/imageResizeWorker.js', budgetKiB: 75 },
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

// Optional surfaces have their own measured + 15%, rounded-up budget.
const DEFERRED_SURFACE_BUDGET_KIB = 25
const webviewMeta = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8'))
const deferredBudgets = Object.entries(webviewMeta.outputs)
  .filter(([, output]) =>
    DEFERRED_WEBVIEW_SURFACES.some(
      (name) => output.entryPoint === `src/webview/components/${name}.tsx`,
    ),
  )
  .map(([path]) => ({ path, budgetKiB: DEFERRED_SURFACE_BUDGET_KIB }))

let hasFailure = false
for (const { path, budgetKiB } of [...BUDGETS, ...deferredBudgets]) {
  if (!existsSync(path)) {
    hasFailure = true
    console.log(`MISS ${path}: not built (budget ${budgetKiB} KiB)`)
    continue
  }
  const files =
    path === 'dist/webview/main.js'
      ? webviewStartupOutputs(JSON.parse(readFileSync('dist/meta/webview.json', 'utf8')))
      : [path]
  const sizeKiB = files.reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
  const status = sizeKiB <= budgetKiB ? 'ok  ' : 'OVER'
  if (sizeKiB > budgetKiB) {
    hasFailure = true
  }
  const label = path === 'dist/webview/main.js' ? `${path} + static imports` : path
  console.log(`${status} ${label}: ${sizeKiB.toFixed(1)} KiB (budget ${budgetKiB} KiB)`)
}

// TRAIN13B: optional UI chunks, 38.6 KiB + 15%, rounded to 25 KiB.
const WEBVIEW_DEFERRED_BUDGET_KIB = 50
const webview = JSON.parse(readFileSync('dist/meta/webview.json', 'utf8'))
const eager = new Set(webviewStartupOutputs(webview))
const deferredKiB =
  Object.keys(webview.outputs)
    .filter((file) => file.endsWith('.js') && !eager.has(file))
    .reduce((sum, file) => sum + statSync(file).size, 0) / BYTES_PER_KIB
if (deferredKiB > WEBVIEW_DEFERRED_BUDGET_KIB) hasFailure = true
console.log(
  `${deferredKiB <= WEBVIEW_DEFERRED_BUDGET_KIB ? 'ok  ' : 'OVER'} dist/webview deferred JS: ${deferredKiB.toFixed(1)} KiB (budget ${WEBVIEW_DEFERRED_BUDGET_KIB} KiB)`,
)

if (hasFailure) {
  console.error('bundle size budget exceeded or a bundle is missing; see PLAN.md section 2 (D6)')
  process.exit(1)
}
