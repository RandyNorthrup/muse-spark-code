# M113 C-M113-5a — Keybindings report kind (editors)

Lane CM1135A, 2026-10-11, rig kubuntu, worktree `/home/randy/lanes/CM1135A`
(branch `c/m113-5a`). Part A of the lead split: the keybindings kind only;
the fleet kind waits for lane CM1135B. Base `c/m113-2` a0b69a03b plus the
accepted `c/m113-1` snap/5369f3df7 (merge bd1b2b7c0; the one session.ts
hunk keeps c/m113-2's limits unit mapping with c/m113-1's total-order
tie-breaks, the same resolution as lane c/m113-4a).

## Scope (D93.4, phase a)

`/report keybindings` lists every binding in effect for the editors: the
editor's (from `package.json` and the feature catalogue's panel table), the
panel's, and ACP's commands, with conflicts flagged. Desktop and TUI
bindings are phase c (M111a, M110a0's lane T) and stay out.

## Implementation

- `src/core/reporting/sources/keybindings.ts` (new): the `keybindings`
  source port. The installed manifest is the only host-varying input,
  validated by a zod schema (commands and keybindings shapes with text
  caps); panel gestures come from `referenceKeyboardActions()` and ACP's
  static local commands from `ACP_COMMAND_NAMES`, pinned to `/help`'s
  `referenceAcp` list. Bindings for built-in commands (the manifest rebinds
  `editor.action.inlineSuggest.trigger`) are listed, not refused; shape
  validation is the corruption guard. Section labels stay identifier keys;
  no display text is read at module load or in the source.
- `src/core/reporting/collect/keybindings.ts` (new): pure mapping to the
  `keybindings` and `conflicts` facets. Editor bindings expand to one row
  per platform (linux/macos/windows, mac/win fall back to the base chord);
  scope carries platform and the binding's `when`. A conflict is two editor
  bindings for the same platform chord whose `when` clauses are equal (both
  empty counts); different `when` clauses are shadowing by design, and other
  platforms never collide. Both facets emit uncapped with no omissions; the
  collector's forward caps rows for display.
- `src/runtime/reporting/engine.ts`: only the kind table's keybindings
  line — bound when the context carries a manifest reader, `unavailable`
  otherwise — plus the additive `ReportingContext.keybindings` field.
- `src/runtime/reporting/reportInputs*.ts`: `keybindingsManifestReader`
  (missing/invalid/failed keep their local codes), exported through the
  entry and loader check. VS Code (`reportPanelEntry.ts`) and the CLI/ACP
  (`main.ts`) pass their own install's `package.json`, read at generation
  time inside the read, so all three hosts report the same numbers.
- Labels: new `shortcut`/`command` column headers in `REPORT_LABEL_KEYS`,
  `en.ts` and all 14 `l10n/ui.*.json` tables (`check:l10n`: 0 problems).

## Validation (repository timeouts, `--maxWorkers=3`, kubuntu)

`test/unit/keybindingsReportSource.test.ts`, 9 tests:

- Real-manifest: every declared binding on all three platforms, per-platform
  chord spot checks, panel and ACP rows, schema-valid sections, and the
  shipped defaults conflict-free (a new default clash fails on purpose).
- Built-in targets listed; empty/misshapen manifests refused as unavailable.
- Conflicts: same chord same when flags (one row per platform, case
  insensitive); different `when` or platform does not.
- Order-independence and deduplication of facts; ACP table pinned to
  `/help`'s list; real sections through the shared forward with row caps
  and `--full`; reader missing/invalid codes mapped by the source port;
  engine generates the kind bound and leaves it unbound without input.

Final run: 9 passed. `tsc --noEmit`, ESLint zero warnings on touched
files, Prettier clean, `check:l10n` 0 problems, `check:reference` current.

Pre-existing build-gate failure (not this lane): `npm run build` exits 1
on `OVER dist/usagePanel.js: 75.1 KiB (budget 75 KiB)`. Rebuilt with this
lane's two label keys reverted: `dist/usagePanel.js` is byte-identical
(76,938 bytes) and still over, and the bundle contains neither new string,
so this lane contributes 0 bytes to it. This lane's own budgets hold:
`dist/reporting.js` 156.4 KiB (budget 175), `dist/reportInputs.js`
68.9 KiB (budget 100).

## Guard-fire receipts

Formal drill on the committed files: `panel: [...]` replaced with
`panel: []` in `sources/keybindings.ts` → the two real-manifest tests fail
(2 failed / 7 passed); restored byte-exact (`git checkout`), SHA-256
matches, 9 passed. Authentic earlier failures during development (same
suite): the built-in-command refusal (fixed by listing), the per-platform
conflict count (fixed test expectation), and the synchronous reader throw
(fixed test harness).

| File                                        | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/reporting/sources/keybindings.ts` | `218536613240f76754c110b3530f2ee353ff1178e2141743bf4a925302c0627a` |
| `src/core/reporting/collect/keybindings.ts` | `ebdf0143013c2ab0296cf5d15fbbe6004f5f38e9817136d55758422ffce6af13` |
| `test/unit/keybindingsReportSource.test.ts` | `77866b3308b3226d335afd69939a9771826996abae6e6d3317d6ab2851d111c8` |

`jscpd` reports 0 clones: the engine cases share one local runner (also
safe on Windows through `path.join`), and the read-context helper is named
and keyed distinctly from neighbouring suites.

## Recorded (not changed)

- Desktop and TUI bindings wait for phase c (M111a, M110a0's lane T).
- Installed skills add dynamic ACP commands per session; only the static
  locals are listed, as `/help` does.
- User `keybindings.json` customizations are not merged; D93.4 phase a
  sources are `package.json` and the feature catalogue.
- The fleet kind (controller sessions, subagents, best-of-N, schedules,
  tasks, M96 team, M100/M110a rows) waits for lane CM1135B.
