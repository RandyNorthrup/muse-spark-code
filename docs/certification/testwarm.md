# TESTWARM — Deferred surface test warm-up (2026-10-06)

Windows 11 rig, `C:/lanes/TESTWARM`, branch `fix/test-warm-deferred`, base
`582af047`. Node 24.21.0, Vitest 5.0.2. No production source, dependency,
timeout, gate, hook, setting or public API changed. No merge, push, network,
credential read or live/paid model call.

`test/unit/helpers/warmDeferredSurfaces.ts` imports all 23 deferred surface
modules, including nested Agent map/usage content, questions, reports, workflow
rows, elicitation and row menus, plus the code fence's lazy highlighting module.
The 17 behavior suites below call it from `beforeAll`. Existing rendered menu
warm-up remains after the imports, preserving synchronous behavior assertions.

`warmDeferredSurfaces.test.ts` parses every webview TSX file with TypeScript,
finds `deferred()` calls (including generic calls), and collects the owning
file's literal dynamic imports, including the shared question loader. It adds
the code fence's imports and compares that set with the helper's actual import
expressions. Windows separators are normalized to `/`; duplicate/missing/extra
helper imports fail equality. Loading/failure tests retain their controlled
cold imports and are never warmed by the new helper.

## Cold Windows verification

One baseline and three final cold rounds, with at most three files per command:

```powershell
npx.cmd vitest run test/unit/App.test.tsx test/unit/Transcript.test.tsx test/unit/questionApp.test.tsx --maxWorkers=3 --config temp/testwarm/vitest.config.mjs --configLoader runner
```

The scratch config merges the unchanged repository config and only relocates
Vite's `cacheDir` and Vitest's `fsModuleCachePath` to
`C:/lanes/TESTWARM/temp/testwarm/cache/` and `fs-cache/`. Both cache directories
are absent or removed before each batch, with resolved path containment checked.
The runner config loader avoids writing a bundled config under the shared
`node_modules`. Filesystem module caching remains at its default, off. Each
command starts a new Vitest process; Windows file isolation/serialization stays
as configured. No `--testTimeout`, hook timeout, `findBy` timeout or retry override
was used: tests 5 seconds, hooks 10 seconds, UI queries 1 second.

Each name below is `test/unit/<name>.test.tsx`. Durations are Vitest's whole-batch
seconds, including setup/import/environment; the baseline also passed. Rig load
varies, so these receipts do not establish a general throughput improvement.

| Complete files                                    | Assertions per round | Before | Cold 1 | Cold 2 | Cold 3 |
| ------------------------------------------------- | -------------------: | -----: | -----: | -----: | -----: |
| App, Transcript, questionApp                      |                  228 |  74.63 |  33.01 |  33.07 |  35.82 |
| toolRows, rowMenus, WorkflowRun                   |                   63 |  12.20 |  12.48 |  11.61 |  11.68 |
| handoffDialog, planActions, reviewUi              |                   35 |  19.14 |  18.40 |  18.77 |  19.36 |
| secretPromptDialog, store, QuoteMenu              |                   12 |  11.48 |  11.44 |  13.45 |  11.60 |
| ReferencePage, reportProblemDialog, attentionDock |                   60 |  20.80 |  20.84 |  20.94 |  19.94 |
| MarkdownView, renderCost                          |                    9 |   7.73 |   8.15 |   7.90 |   7.95 |

All 18 final behavior batches exit 0: **407 assertions per round, 1,221 passes**,
zero failures/skips. Existing jsdom canvas warnings also appeared in the baseline.
Raw logs and the scratch runners remain in gitignored `temp/testwarm/`.

The untouched `AppLazy.test.tsx` and `DeferredSurface.test.tsx`, with the new
`warmDeferredSurfaces.test.ts`, pass three additional cold batches: 16 assertions
each, **10.01 / 9.46 / 9.57 seconds**. The guard therefore has three final cold
passes. Untouched `CodeBlockLazy.test.tsx`, `deferredQuestionUi.test.tsx` and
`deferredQuestionFailure.test.tsx` pass all three assertions in **7.57 seconds**.
These retain first-use, held-import, failure, dismissal, draft and retry coverage.

Scoped ESLint caught style errors in the new guard (path import style,
condition order, loop iterable, relative URL, array sorting and comparator
scope). They were corrected without suppression. The final guard then passes
three fresh standalone cold runs: **1.27 / 1.20 / 1.20 seconds**, one assertion
each. Behavior-suite files were unchanged after their three final rounds.

## Deliberate failure

Append a new `deferred()` surface importing `./components/Modal` to
`src/webview/App.tsx` without changing the helper. The guard exits 1 and its
diff identifies the missing `components/Modal` import (1.25 seconds). Restore
the original bytes: SHA-256 before and after both
`4c781064942146e2db28d2c8f03492aedf7c62016dff4af95f0bf688ac691c1d`.
The restored guard exits 0 (1.22 seconds), followed by the final cold runs above.
Drill log/hash receipts: `temp/testwarm/drift-red.log`, `drift-restored.log`,
`drift.json`. The deliberate source change is absent from the final diff.

Repeat the same mutation after the guard's style corrections: exit 1,
**1.27 seconds**, with the same exact before/after SHA-256. The three standalone
green runs above follow this final restore. Final drill receipts:
`temp/testwarm/drift-final-red.log`, `drift-final.json`, `guard-final-*.log`.

## Static and build checks

All commands run directly on this Windows rig, one compiler/linter/build at a
time. Final logs are in `temp/testwarm/`; the corrected guard's lint, unit
compiler, Knip and duplication checks were rerun after its last code change.

| Command                                              | Result                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                              | All five projects pass; final unit project rechecked.                                     |
| `npx.cmd eslint --max-warnings=0 <changed TS files>` | 19 files, zero warnings/errors.                                                           |
| `npx.cmd prettier --check <changed files>`           | Pass after final documentation formatting.                                                |
| `npm.cmd run deadcode`                               | Plain Knip passes; two existing configuration hints.                                      |
| `npx.cmd jscpd`                                      | 1,234 files, zero clones.                                                                 |
| `npm.cmd run check:l10n`                             | 14 tables, 169 manifest strings, 629 source files; zero problems.                         |
| `npm.cmd run check:host-api`                         | 332 VS Code APIs, 32 adapter files, 25 Node built-ins, 61 theme variables; zero problems. |
| `npm.cmd run check:reference`                        | 53 features, 46 commands, 60 settings, 26 slash, 122 CLI; current.                        |
| `npm.cmd run build`                                  | Production, bundle sizes/splits, host globals and 83 package notices pass.                |

Unchanged caps: extension **441.6 / 600 KiB**, Model API **447.3 / 475 KiB**,
ACP **823.6 / 850 KiB**, chat startup **733.1 / 900 KiB**, original deferred
aggregate **32.1 / 50 KiB**. No new escape hatch, command or setting.

Before commit, `.husky/_/pre-commit` exists and `core.hooksPath` resolves to
`.husky/_`; the existing lint-staged and gitleaks hooks run without overrides.
Shared lane rules prohibit aggregate `npm run quality` and full-suite runs;
PLAN §7 records that delegation. Integrated full quality/coverage and hosted
cross-platform confirmation remain with the lead. No unresolved lane finding.
