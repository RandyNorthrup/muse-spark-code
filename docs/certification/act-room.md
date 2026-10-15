# ACTROOM — activation budget back under lane K's 3 KiB

Lane on `fix/act-room` (worktree `ACTROOM`, from `5de505843`), 2026-10-14, on
the linuxlt rig. Input: `modelsActivationBudget` red at +3,301 B over the
immutable pre-K baseline (allowance 3,072 B) after the panel-focus fix
(+589 B since `06847350f`). No budget, baseline fixture, test or size cap
was changed or weakened; no model calls.

## Result

| Measure                                    | Before     | After                      |
| ------------------------------------------ | ---------- | -------------------------- |
| `modelsActivationBudget` current bytes     | 564,653    | 563,594                    |
| Growth over the pre-K baseline (561,352 B) | +3,301     | +2,242                     |
| Room below the 3,072 B allowance           | −229 (red) | +830                       |
| `dist/extension.js` (`npm run build`)      | 551.4 KiB  | 550.4 KiB (budget 600 KiB) |
| `dist/rulesFile.js` (new, budget 25 KiB)   | —          | 6.6 KiB                    |

Test lines (`npx vitest run test/unit/modelsActivationBudget.test.ts`):

- Before: `Activation baseline=561352 current=564653 growth=3301`
- After: `Activation baseline=561352 current=563594 growth=2242`

## Method and module table

Method: esbuild metafiles of `src/extension.ts` built exactly as the budget
test builds it (`HOST_PLUGINS` plus the test's externals), for this head and
for `06847350f` (a scratch worktree; removed after). Bytes are
`bytesInOutput` in the activation bundle.

`06847350f` → head, the focus growth (+589 B, matching the test):

| Module                             | Base   | Head   | Δ    | Movable?                                                   |
| ---------------------------------- | ------ | ------ | ---- | ---------------------------------------------------------- |
| src/extension.ts                   | 68,352 | 68,625 | +273 | Partly (the toggle fallback; the open-file tracking stays) |
| src/host/views/webviewSetup.ts     | 2,143  | 2,308  | +165 | Partly (the gate branch; the reveal stamp stays)           |
| src/host/views/focusGate.ts        | 0      | 95     | +95  | Yes, in principle                                          |
| src/shared/constants.ts            | 36,053 | 36,064 | +11  | No (one constant)                                          |
| src/host/views/chatPanel.ts        | 1,043  | 1,065  | +22  | No (surface wiring)                                        |
| src/host/views/ChatViewProvider.ts | 1,038  | 1,061  | +23  | No (surface wiring)                                        |
| src/shared/protocol.ts             | —      | —      | 0    | Not in the activation bundle (externalized wire)           |
| src/host/commands/focusInput.ts    | 180    | 180    | 0    | Yes, in principle                                          |

Key finding: moving the focus on-demand code to its own lazy bundle does
NOT pay. Prototyped (since reverted): entry + hand-rolled loader + two call
sites. Result: growth 3,301 → 3,294 (−7 B). The loader, two bundle-path
computations and the degraded-mode fallbacks cost ~580 B against ~590 B
removed. The focus code stays where it is, behaviour byte-identical.

## Root fix

The next on-demand body instead: the Create AGENTS.md command
(`src/host/commands/createRulesFile.ts`, 892 B), the rules template
(`src/core/context/rulesTemplate.ts`, 461 B, imported only by that command)
and their redaction leave activation for `dist/rulesFile.js`, required the
first time that command runs:

- `src/host/commands/rulesFileEntry.ts` → `dist/rulesFile.js` (installs the
  caller's table, then creates the file — the lazy-factory rule).
- `src/host/commands/rulesFileBundle.ts`: the checked loader; only types
  cross into activation. A missing or damaged bundle refuses the command
  (`throw new Error(RULES_FILE_BUNDLE_FILE)` — the file name as the
  technical detail after the existing `actionFailed` sentence, so no new
  user string and no translation round) and the next run tries again.
- Plumbing: build entry, 25 KiB budget (6.6 KiB measured × 1.15, up to
  25 KiB), split guard pinning all three files to the new bundle, lazy
  registry row, host-globals, `.vscodeignore`, notices, knip entry,
  `REPORT_PACKAGE_FRAME_PATHS`, changelog entry.

Removed from activation: createRulesFile 892, rulesTemplate 461 (plus their
exclusive redaction share); added the loader and one call site (net −1,059 B
on the test's measure).

## Tests (linuxlt rig, repository default timeout, no `--testTimeout`)

| Suite                                                            | Result                                            |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| modelsActivationBudget, rulesFileBundle (new, 6 tests), manifest | 47/47                                             |
| questionAttentionOwnership, ApprovalDock, composerFocusOwnership | 27/27                                             |
| focusGate, lazyBundleFiles, bundleDiet                           | 20/20                                             |
| vsixPackaging, integrationPackaging                              | 97/97                                             |
| packagedBundles                                                  | 8/8                                               |
| `vitest related` over the moved modules                          | 7/7                                               |
| packed product `test/e2e/execStdio.e2e.test.ts`                  | 46/46                                             |
| `npm run typecheck` (all projects)                               | exit 0                                            |
| eslint `--max-warnings=0` on changed files                       | exit 0                                            |
| prettier `--check` on changed files                              | exit 0                                            |
| `npm run deadcode` (knip)                                        | exit 0                                            |
| `npm run cycles`                                                 | exit 0                                            |
| `npm run duplication` (jscpd, 0 clones)                          | exit 0                                            |
| `npm run check:host-api` (0 problems)                            | exit 0                                            |
| `node scripts/check-l10n.mjs` (0 problems; no new keys)          | exit 0                                            |
| `npm run security:audit`                                         | exit 0 (2 advisories, 1 exception — pre-existing) |
| `npm run build` (size, split, registry, globals, notices)        | exit 0                                            |

RUN IN A REAL HOST: `test/integration/extension.test.ts` on VS Code stable
1.142.0 under xvfb (`--label stable`, dev build): `creates AGENTS.md in the
workspace root and opens it (D15)` and `Focus Input from a file brings the
chat panel forward (panel-focus)` — 2 passing. The D15 case drives the real
`dist/rulesFile.js` through the real command (file created with the header,
opened, keyboard held); the panel-focus case proves the untouched focus path
in the same host.
NOT RUN HERE: `test/integration/questions.test.ts` and the `minimum` label —
same reason as before; CI runs the full matrix.
NOT RUN: `npm run security:sast` — semgrep cannot start here:
`OSError: [Errno 30] Read-only file system:
'/home/randy/.cache/semgrep_version'` (exit 2, environmental).

## Drills

1. Loader shape: `isRulesFileBundle` weakened to a key-presence check →
   `rulesFileBundle.test.ts` failed (`expected { createRulesFile: 42 } to be
undefined`). Restored byte-exact (SHA-256 `9a0cebd7…` verified), 6/6 pass.
2. Activation guard: a direct `createRulesFile(deps)` call in `extension.ts`
   (value import back into activation) → budget growth 2,242 → 3,587, test
   red. Restored byte-exact (`git diff` empty), test green. (An unused import
   alone shakes out at +36 B and stays green — the call is the violation.)
3. The split guard's negative direction was verified by code and by drill 2
   through the budget test; it reads the production metafiles, so a planted
   source violation fires it only after a rebuild, which the box did not fit
   a second time.

## For the lead

- No activation budget proposal: growth is +2,242 B against the pre-K
  baseline, 830 B under the allowance (needs ≥150 B of room).
- The Focus Input toggle, the focus gate and the panel-focus rule are
  untouched; their tests all pass unmodified.
- Real-life scenario for the moved command: run `Muse Spark: Create
AGENTS.md` in a trusted workspace folder → `muse init` runs when the CLI
  is present (else the template is written), AGENTS.md opens; with no folder
  open a warning shows; a missing `dist/rulesFile.js` refuses the run with
  the bundle's file name and the next run retries.
- Scratch worktree `$TMPDIR/actbase` (at `06847350f` with a node_modules
  symlink) was removed; `temp/actroom-*.mjs` probe scripts and gate logs
  remain in the worktree's gitignored `temp/`.
