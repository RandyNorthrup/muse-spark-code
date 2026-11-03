# RSCH-PERF certification — performance research + ACP startup fix (2026-11-02)

Lane `RSCH-PERF`, worktree `/home/randy/lanes/RSCH-PERF`, branch
`rec/rsch-perf`, on rig `linuxlt` (x86-64, Node v24.21.0, npm
11.19.0). Base `72d8d5003` (rv/int9). No model calls, no sign-in,
no paid calls; hands-on checks of installed CLIs ran with no
credentials (opencode under a throwaway HOME). Nothing pushed,
rebased or tagged.

## What landed

1. `docs/research/performance-2026-11-02.md`: measured cold start,
   RSS, bundles, prefix bytes, disk use; rival comparison (pi,
   gemini, codex, opencode, claude, muse); three papers with
   methods; ranked actions with lane briefs; NOT-to-do list.
2. The ACP startup fix (commit `f6a452642`): six leaf symbols out
   of the engine-externalised modules (`transport.ts`,
   `providerRefusal.ts`) into `modelApiError.ts`,
   `src/core/timeouts.ts`, `src/core/redact.ts`, so `dist/acp.js`
   requires no `dist/modelApi.js`. CPU user+sys medians of 5 on
   the same loaded rig: `--version` 0.80 s → 0.63 s (−21%),
   `--help` 0.80 s → 0.67 s (−16%); `--help` peak RSS
   113.6 MB → 107.3 MB. No budget raised. CHANGELOG entry under
   `[Unreleased]` → Fixed.

## Red/green drills (each broken on purpose, then restored byte-exact)

Drill A — the split gate fires on the new file. Removed the
`modelApiError.ts` row from `ACTIVATION_ALLOWED` in
`scripts/check-bundle-split.mjs`:
`node scripts/check-bundle-split.mjs` exited **1** naming
`src/core/backends/modelapi/modelApiError.ts is on neither list`.
Restored: exit **0**. `git diff` after restore: empty.

Drill B — the moved guard's tests fire. Replaced
`isModelApiError`'s body in `modelApiError.ts` with
`return false`: `npx vitest run test/unit/tabRequest.test.ts`
exited **1** (1 failed: "tells a ModelApiError apart by name and
fields, not instanceof", 14 passed). Restored: exit **0**
(15 passed). `git diff` after restore: empty.

Drill C — the startup property itself. Pointed `src/runtime/main.ts`
back at `abortableSleep` from `transport.ts` and rebuilt
(`node scripts/build.mjs --production`, exit 0):
`grep -o 'require("./modelApi.js")' dist/acp.js` counted **1**
(red: the drag returns). Restored the import and rebuilt: count
**0** (green). `git diff` after restore: empty.

## Suites

- Directly affected, all green: `providerRefusals` (58 tests with
  `modelApiFailureRetryable` + `tabRequest`),
  `providerRetryLimits` + `execCountBound` +
  `modelapiMalformedInputs` (44), `providerFiles` (15).
- `npx vitest related src/core/backends/modelapi/transport.ts
--run`: 103 files / 958 tests passed; 5 failed in 3 files
  (`mediaConvert`, `privateRootLease`, `teamProcessWorkers`).
  The same 3 files on the untouched base (scratch worktree at
  `72d8d5003`) fail the same 5: sandbox ownership refuses the
  private-root cases and 60 s timeouts under load 13 take the
  team-worker cases. Measured, not assumed: no new failure.
- Repository timeouts throughout; no `--testTimeout`.

## Gates (final tree; exit codes)

- `npm run typecheck`: 0
- `eslint --max-warnings 0` on all 27 touched files: 0
- `prettier --check` on touched files: 0 (one file fixed with
  `--write` before commit)
- `node scripts/check-l10n.mjs`: 0 (no sentences added)
- `npm run check:reference`: 0 (no commands/settings changed)
- `npm run check:host-api`: 0
- `npm run check:plan`: 0
- `npm run check:roadmap`: 0 (after `roadmap:generate`)
- `npm run check:catches`: 0 (no `try/catch` touched; counts unchanged)
- `npm run duplication`: 0 clones
- `npm run cycles`: 0
- `npm run deadcode`: 0
- `npm run build` (production + desktop): 0; size gate 0, split gate 0

## Real use

`node dist/acp.js --version` / `--help` before and after (the
fix's own surface); `report`/`scan-secrets`/`legal` entry paths
unchanged. Full packed-product and real-life runs stay with the
lead: this lane makes no claim they prove.
