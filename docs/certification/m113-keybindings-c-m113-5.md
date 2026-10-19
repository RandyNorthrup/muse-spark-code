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
  static local commands from `ACP_COMMAND_FACTS`: the 18 names
  `refreshCommands` (`src/acp/agent.ts`) announces, each with the port
  that gates it (absent means always announced; `/resources resume` and
  `/usage resources` are argument forms, not commands). Bindings for built-in commands (the manifest rebinds
  `editor.action.inlineSuggest.trigger`) are listed, not refused; shape
  validation is the corruption guard. Section labels stay identifier keys;
  no display text is read at module load or in the source.
- `src/core/reporting/collect/keybindings.ts` (new): pure mapping to the
  `keybindings` and `conflicts` facets. Editor bindings expand to one row
  per platform (linux/macos/windows, each falling back to the base chord);
  scope carries platform and the binding's `when`. A conflict is two editor
  bindings sharing a platform chord and `when` clause (both empty counts):
  the row names the shared clause in its scope, different `when` clauses
  are shadowing by design, and other platforms never collide. Both facets
  emit uncapped; a blank chord is partial with its skipped rows counted on
  the bindings section only, and the collector's forward caps rows for
  display.
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

`test/unit/keybindingsReportSource.test.ts`, 15 tests:

- Real-manifest: every declared binding on all three platforms,
  per-platform chord spot checks (including the `linux` override), panel
  and ACP rows, schema-valid sections, and the shipped defaults
  conflict-free (a new default clash fails on purpose).
- Built-in targets listed; empty/misshapen manifests refused as unavailable.
- Conflicts: same chord same `when` flags (one row per platform per shared
  clause, case insensitive, the clause in scope); different `when` clauses
  shadow by design and other platforms never collide.
- Order-independence and deduplication of facts; the same conflict bytes in
  either fact order (the normalized chord, not the first fact's casing).
- Generated bindings: the conflicts are exactly the sets sharing platform,
  chord and clause — nested comparison, never a group key — in forward,
  rotated and reversed input order, including the aliasing pairs a
  concatenated key would merge.
- Blank chord: the source is partial with its reason, the 3 skipped rows
  counted on the bindings section, the conflicts section empty with
  omission 0.
- ACP table pinned to the registrar's announced commands: the real agent
  over the ACP client announces the baseline (`help`/`compact`/`report`/
  `agents`) with no ports and exactly `ACP_COMMAND_FACTS` with every port
  bound — in any registration syntax — and a command no single gate
  explains fails as unclassifiable.
- Gate attribution: each bound port adds exactly its commands, and each
  reported `when` matches the announcing gates; the media pair announces
  only while not headless (an all-ports headless run withholds it).
- Docs pin the adapter sentences; real sections through the shared forward
  with row caps and `--full`; reader missing/invalid codes mapped by the
  source port; engine generates the kind bound and leaves it unbound
  without input.

Final run: 15 passed. `tsc --noEmit`, ESLint zero warnings on touched
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
(fixed test harness). The SHA-256 table below is Part A state, superseded
by the R2 table (the R2 repairs changed all three files).

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

## R2 — RVCM1135A repairs (lane CM1135AR2, 2026-10-11, rig kubuntu)

All six findings fixed, no residuals. Suite is now 12 tests in
`test/unit/keybindingsReportSource.test.ts` (was 9), all passing at the
repository timeout with `--maxWorkers=3`. No new dependency, no guard
widened, no new UI string (`check:l10n` clean by reuse: scope gates are
port identifiers spliced like editor `when` clauses).

- P2-1 `linux` chord dropped (`sources/keybindings.ts` schema,
  `collect/keybindings.ts` `EDITOR_PLATFORMS`): the manifest schema now
  keeps `linux`, and the Linux platform row uses
  `fact.linux ?? fact.key`, which also fixes Linux conflict detection
  (same platform table drives both paths). Sweep: `mac`/`win` were
  already kept; `scripts/lib/reference.mjs` already renders the Linux
  override; `package.json` has exactly one `linux` override
  (`museSpark.toggleThinking` → `ctrl+alt+o`). Regression: real-manifest
  `toggleThinking` spot checks per platform (linux/mac/windows).
- P2-2 ACP section was a copy of the help sentence
  (`sources/keybindings.ts`): `ACP_COMMAND_NAMES` (14 prose-derived
  strings) is replaced by `ACP_COMMAND_FACTS` (18 entries), the names
  `refreshCommands` (`src/acp/agent.ts`) announces, each with the port
  that gates it (`sharing`, `vault`, `accounts`, `legalScan`,
  `usage|resources`, `resources`, `playbook`, `schedules`,
  `media, not headless`, `estimate`, `questions`; absent means always
  announced). Shared names come from the same constants the agent reads
  (`SLASH_COMMAND_NAMES.report`, `.estimate`, `ACP_COMPACT_COMMAND`);
  the registrar modules are deliberately not imported (they would drag
  featureCatalog/sharing runtime into `dist/reporting.js`). Added the
  missing `vault`, `accounts`, `schedule`, `attach`, `record`,
  `estimate`; `/resources resume` and `/usage resources` are no longer
  commands (argument forms of `resources`/`usage`). Regression: the
  parity test reads the agent's announced table back — registrar names
  from the live `acpSharingCommands()`/`resourceCommands()` plus every
  `name:` literal in `refreshCommands` — and requires exact set equality
  with the report, so a new registrar entry fails until listed.
  (Mechanism redesigned in R4 below: the test now runs the registrar
  itself instead of scanning its source.)
- P2-3 panel rows dropped the setting gate
  (`sources` + `collect/keybindings.ts`): panel facts carry `when` from
  `referenceKeyboardActions()` (its context-name fallback means
  `when === command` is no gate), and the panel scope renders it via the
  same `scopeFor` helper as editor rows. `composer.send` now reads
  `panel (Enter: useCtrlEnterToSend=false; Ctrl/Cmd+Enter:
useCtrlEnterToSend=true)`; gateless gestures keep bare `panel`.
  Regression: gate text asserted on the send row, bare scope asserted on
  `team.tree`.
- P3-4 conflict cell kept first-fact casing
  (`collect/keybindings.ts`): the group stores the normalized chord, so
  both fact orders render identical bytes. Display is now the lowercase
  canonical form (`ctrl+k`). Regression: reversed case-variant fixtures
  collect byte-equal; existing expectation updated to `ctrl+k`.
- P3-5 blank chord skipped silently (`sources` + `collect/keybindings.ts`):
  both skip sites count, each section carries its own `omittedRows`, and
  the source reports `partial` with `sourceReason('invalid')` whenever
  the total is above zero (which also makes `--full` refuse, per the
  existing forward contract). Empty-string chords still fail the whole
  source as `invalid`, as before. Regression: whitespace-chord manifest
  yields `partial` + reason + 3/3 omitted rows with the kept binding intact.
- P3-6 docs: `docs/ide-compatibility/hosts.md` no longer names
  keybindings among the unavailable adapters and states the adapter is
  available in VS Code, ACP and the CLI (install-manifest readers wired);
  `docs/acp.md` lists `report keybindings` among the local reports.
  Regression: doc-content test pins both sentences (same pattern as
  `acpNpmReadme.test.ts`).

Incidental test repair: `generates the kind … in every host` now runs
`full` because the capped view keeps digest-hash row order — membership
in it is luck, not a contract manifest content can pin (the kind
previously passed only by hash luck once the ACP rows grew 14 → 18).

Red drills (break guard → named test fails → restore byte-exact,
SHA-256 verified after each restore; final SHAs below):

| Finding | Break                                  | Named test                                              | Result                |
| ------- | -------------------------------------- | ------------------------------------------------------- | --------------------- |
| P2-1    | linux platform back to `fact.key`      | lists every installed editor binding                    | 1 failed / 11 skipped |
| P2-2    | bogus extra ACP entry                  | pins the ACP table to the announced agent command table | 1 failed / 11 skipped |
| P2-3    | panel facts without `when`             | lists every installed editor binding (send gate)        | 1 failed / 11 skipped |
| P3-4    | group chord stores raw gesture         | renders the same conflict bytes                         | 1 failed / 11 skipped |
| P3-5    | source returns no `partial`            | marks the source partial                                | 1 failed / 11 skipped |
| P3-6    | hosts.md availability sentence removed | documents the keybindings adapter                       | 1 failed / 11 skipped |

Post-drill: 12 passed, and every file matched its pre-drill SHA-256
(verified after each restore). `prettier --write` afterwards reformatted
only the test and cert files (whitespace; suite re-run green), so the
table carries the final SHAs.

| File                                        | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/reporting/sources/keybindings.ts` | `fdc83a230ee0455bfdebcc5926c32353a45d862906d0f5ac87eaad803b7a93cb` |
| `src/core/reporting/collect/keybindings.ts` | `14fca20eb5cceedcd3b291dab1b6c9f06e3d1cc00b344487fbc536b739957ef6` |
| `test/unit/keybindingsReportSource.test.ts` | `b4181c05a7dd4111f1dc343ef19ca53d151188b6325667851c3b18b97c84e963` |
| `docs/ide-compatibility/hosts.md`           | `e550065fe07526cc9761f5b1f4879472eb71dcd750a4598d04b6230042b99d1c` |
| `docs/acp.md`                               | `ec0377ed5fa4a232c1d8d420a2e0c7f27d1c6505860b0c2a7673f7985cbda214` |

Decisions recorded: CHANGELOG untouched (the unreleased kind entry
already describes this behaviour; the fixes correct it pre-release).
`featureCatalog` keeps no keybindings-kind help row (truth-pass item,
not a finding; still withdrawn). The ACP section describes the command
table with per-command port gates because report time cannot see which
ports the running host bound — the conditions are the honest static
form, pinned to the live table by the parity test.

## R3 — RVCM1135B repairs (lane CM1135AR3, 2026-10-11, rig kubuntu)

All four findings fixed, no residuals. Suite is still 12 tests in
`test/unit/keybindingsReportSource.test.ts`, all passing at the
repository timeout with `--maxWorkers=3`. No new dependency, no guard
widened, no new UI string. PLAN's C-M113-5a paragraph and this file's
Implementation section above now describe the current behaviour.

- P2 conflict rows merged across `when` clauses
  (`collect/keybindings.ts`): the group key is platform, normalized
  chord AND `when` clause (redesigned as a JSON tuple in R4 below, after
  this round's concatenation was found to alias), and the row shows the
  shared clause in its scope through the same `scopeFor` helper as
  binding rows (`editor/linux (editorTextFocus)`; bare
  `editor/<platform>` when ungated). Sweep: the row key carries the
  clause too, so two clauses with identical command sets stay distinct
  rows; single-command groups emit nothing, as before. Regression: the
  conflict test fixtures two clashes on one chord under different clauses
  and expects six rows (three platforms times two clauses) with pair
  lists and clause scopes; the order-independence test pins the bare
  scope on the ungated clash.
- P3 blank chord inflated the conflicts omission
  (`collect/keybindings.ts`): `conflictRows` no longer counts blank
  chords — a blank names no gesture, so it cannot clash — and always
  reports `omittedRows` 0. The bindings section counts the 3 skipped
  platform rows and the source stays `partial`, so `--full` still
  refuses. Sweep: `collect/index.ts` only forwards section counts, so no
  change was needed there. Regression: the blank-chord test expects
  conflicts rows empty with omitted 0 beside bindings omitted 3.
- P3 parity checked names only (test): the ACP parity test now reads
  each announced command's gate as well as its name — the nine guarded
  `refreshCommands` spreads mapped guard to port, sharing and resource
  registrar names mapped to their ports — and requires the reported
  `when` to match for every gated command, so removing any gate fails
  the suite. A new spread shape throws until mapped, and the spread-gate
  pin fails on a new unmapped spread. (Mechanism redesigned in R4 below:
  the source scan could not see every spread shape, so the test now runs
  the registrar itself.) Sweep: unconditional entries
  (`help`, `compact`, `report`, `agents`) are read back from the table
  remainder, not assumed; dynamic `skill.selector` entries still match
  no name pattern and stay out.
- P3 stale record: PLAN's C-M113-5a paragraph now names
  `ACP_COMMAND_FACTS` with gates, clause-keyed conflicts with clause
  scopes, and the bindings-only blank omission.

Red drills (break guard → named test fails → restore byte-exact,
SHA-256 verified after each restore; final SHAs below):

| Finding  | Break                                           | Named test                                              | Result                                                                           |
| -------- | ----------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P2       | group key back to platform plus chord           | flags same-chord same-when editor bindings              | 1 failed / 11 skipped (`expected 3 rows to have length 6`)                       |
| P3 blank | conflictRows counts blank chords again          | marks the source partial                                | 1 failed / 11 skipped (`expected 3 to be +0`)                                    |
| P3 ACP   | `when: 'sharing'` removed from share and prompt | pins the ACP table to the announced agent command table | 1 failed / 11 skipped (`share: expected Set{} to deeply equal Set{ 'sharing' }`) |

Post-drill: 12 passed, and every drilled file matched its pre-drill
SHA-256 (verified after each restore with `sha256sum -c`).

| File                                        | SHA-256                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/core/reporting/collect/keybindings.ts` | `836896340ec1b3e824cbdfedcb5a2c7197bafe4e798daf940235a98ef61d20d9`                      |
| `src/core/reporting/sources/keybindings.ts` | `fdc83a230ee0455bfdebcc5926c32353a45d862906d0f5ac87eaad803b7a93cb` (unchanged since R2) |
| `test/unit/keybindingsReportSource.test.ts` | `7a33723accb62b277b6eabdb40215b519fa43ce4cae24e11f987eeae091b0ffb`                      |
| `PLAN.md`                                   | `63659630daec0b8aaee3e81646757d2e18fc5bb06780c35347482fd539e09cda`                      |

Decisions recorded: CHANGELOG untouched (the unreleased kind entry
already covers this behaviour; the fixes correct it pre-release).

## R4 — RVCM1135C repairs (lane CM1135AR4, 2026-10-11, rig kubuntu)

All three findings fixed, no residuals. This was the third review, so two
parts are redesigned instead of patched, as the brief required. Suite is
now 15 tests in `test/unit/keybindingsReportSource.test.ts` (was 12), all
passing at the repository timeout with `--maxWorkers=3`. No new
dependency, no guard widened, no new UI string. The diff stays inside this
lane's files (`collect/keybindings.ts`, the suite, this record); the
registrar itself is untouched — the new parity test only drives it.

- P3-1 conflict group key aliased (redesigned,
  `collect/keybindings.ts`): the key is now the JSON of the tuple
  (platform, normalised chord, `when` clause) — structured, never
  concatenated — so `ctrl+k` under `when: 'ab'` can never share a key
  with ungated `ctrl+kab`, and neither can a chord sequence with a chord
  plus a clause. Each row is built from the group's members in a sorted,
  stated order (by command, duplicates dropped), so the bytes never
  depend on input order either. Sweep: the lane's only other stringified
  key (`deduplicate`) was already a JSON array; no other concatenation
  keys remain in the lane's files. Regression: a property test over
  seeded generated bindings (case/whitespace variants, `linux`
  overrides, blank chords, both aliasing pairs) requires the conflicts
  to be exactly the sets sharing platform, chord and clause — worked out
  by nested comparison, never a group key — in forward, rotated and
  reversed input order.
- P3-2 parity scanner blind to spread shapes (redesigned, suite only):
  the source-text scan of `agent.ts` (`name:` literals plus one spread
  regex) is gone. The suite now runs the real registrar — a full agent
  over the ACP client, one `session/new`, then read-only `/agents` —
  against fakes: baseline (no ports), each of the eleven gates bound
  alone, every port bound, and every port bound headless. It requires the
  baseline to be exactly `help`/`compact`/`report`/`agents`, the all-ports
  announcement to equal `ACP_COMMAND_FACTS`, each gate to add exactly its
  commands (`GATE_COMMANDS`), each reported `when` to match the
  announcing gates, and the headless run to withhold `attach`/`record`
  only. A command no single gate explains fails as unclassifiable, so a
  new spread shape — or any other registration syntax — fails until
  listed instead of passing silently. Sweep: the scanner was the lane's
  only source-text check of `agent.ts`; the docs-content test still reads
  markdown, which is its subject, not code under test.
- P3-3 stale Validation (this file): the opening section above now
  describes the current 15-test suite and behaviour (per-platform
  per-clause conflicts, registrar-run parity with gates, 15 passed), and
  the R2/R3 bullets that described the withdrawn scanner and the
  concatenated key carry supersession notes pointing here.

Red drills (break guard → named test fails → restore byte-exact,
SHA-256 verified after each restore; final SHAs below):

| Finding | Break                                                           | Named test                                                               | Result               |
| ------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------- |
| P3-1    | group key back to concatenation                                 | groups generated bindings by platform, chord and when in any input order | 1 failed / 12 passed |
| P3-2    | unguarded `{ name: 'fleet' }` in `refreshCommands` (any syntax) | pins the ACP table to the registrar announced commands                   | 1 failed / 14 passed |
| P3-2    | `when: 'sharing'` removed from share                            | attributes each announced command to its registrar gate                  | 1 failed / 14 passed |

Post-drill: 15 passed, and every drilled file matched its pre-drill
SHA-256 (verified after each restore with `sha256sum`; the registrar
drill touched `src/acp/agent.ts` outside the lane and restored it to its
committed SHA `d7680d3b5f593e77b46c5d9c364e4c3e933b1fe41a4ce39528fa74c650b039e6`).

| File                                        | SHA-256                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/core/reporting/collect/keybindings.ts` | `2a567e31c70fbe54035026c774dab1058d853d3432583cb1e2ccfd8e0872cd0a`                      |
| `src/core/reporting/sources/keybindings.ts` | `fdc83a230ee0455bfdebcc5926c32353a45d862906d0f5ac87eaad803b7a93cb` (unchanged since R2) |
| `test/unit/keybindingsReportSource.test.ts` | `23ebd859e99eb17e63354ef02b6fd3368d2f2212a4fc63929000d5ead1509464`                      |

Decisions recorded: CHANGELOG untouched (the unreleased kind entry
already covers this behaviour; the fixes correct it pre-release).
`featureCatalog` keeps no keybindings-kind help row (truth-pass item,
not a finding; still withdrawn). PLAN's C-M113-5a paragraph is
behaviour-level and still accurate (name and gate parity, clause-keyed
conflicts, bindings-only blank omission), so it stands unchanged.

## R5 — RVCM1135D repairs (lane CM1135AR5, 2026-10-11, rig kubuntu)

Both P3 fixed, no residuals, no source change (test file only, as the
review expected). Suite is now 16 tests in
`test/unit/keybindingsReportSource.test.ts` (was 15), all passing at the
repository timeout with `--maxWorkers=3`. No new dependency, no guard
widened, no new UI string.

- P3-1 parity helper dropped qualifiers (suite only): `observedGates`
  (first word before the comma) is replaced by `observedQualifiers`
  (every comma-separated qualifier of every `|` alternative, as a set)
  plus `expectedQualifiers`/`fullGateMismatches`, which build each
  command's full gate from what the registrar really does in each mode —
  the announcing gates plus `not headless` exactly when the all-ports run
  announces it normally but withholds it headless. The attribution test
  requires zero mismatches across all reported facts in both modes, and
  the headless test now also requires the attach/record facts to carry
  exactly `{media, not headless}`. Regression: the new "flags a
  reported gate that drops not headless" test runs the reviewer's
  mutation (attach/record
  as `media`) through the same helper against synthetic registrar sets
  and requires both to be flagged — no registrar run, so it stays fast.
  Sweep of every other comparison in the file: `normalizeTestChord` is
  the conflict contract itself (mirrors the collector), the `.trim()` at
  the gesture read mirrors the blank-chord skip, the `slice` calls take
  fixed fixture subsets, and the docs `split(..., 2)` takes the section
  after the heading — none drops part of what is compared. No change
  needed beyond the gate helper.
- P3-2 unaudited `AcpGate` assertions (suite only): the three
  `Object.keys`/`Object.entries … as …` casts are gone. Gate iteration
  uses the typed `ACP_GATES` list (`readonly AcpGate[]`), so a mistyped
  gate fails `tsc` instead of compiling silently; the pins test requires
  `new Set(ACP_GATES)` to equal `new Set(Object.keys(GATE_COMMANDS))`,
  so a gate added to one side but not the other fails loudly. No escape
  hatch remains, so no inline reason and no PLAN §8 entry were needed.
  Sweep of rounds 3–5 additions: no `eslint-disable`, no
  `@ts-expect-error`, no other `as` (the one pre-R3 `key as keyof …`
  left with the withdrawn scanner). The `!` non-null index assertions
  follow the file's pre-R3 convention and are outside AGENTS.md rule 4's
  list. `tsc`, ESLint zero warnings and Prettier are clean on the file.

Red drills (break guard → named test fails → restore byte-exact,
SHA-256 verified after each restore; final SHA below):

| Finding | Break                                             | Named test                                                                                          | Result                |
| ------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------- |
| P3-1    | source facts attach/record `when` back to `media` | attributes each announced command to its registrar gate; withholds the media commands when headless | 2 failed / 14 passed  |
| P3-1    | `observedQualifiers` back to first-word-only      | flags a reported gate that drops `not headless`                                                     | 1 failed / 15 skipped |
| P3-2    | `media` removed from `ACP_GATES`                  | pins the ACP table to the registrar announced commands                                              | 1 failed / 15 skipped |

Post-drill: 16 passed, the test file matched its pre-drill SHA-256
(`sha256sum -c`), and the source file shows no diff (restored by
re-applying the exact lines).

| File                                        | SHA-256                                                            |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `test/unit/keybindingsReportSource.test.ts` | `657d3e1b668296c7af274d77f945387df5159a6a2dad885033be8a6d083bb681` |
| `src/core/reporting/sources/keybindings.ts` | unchanged since R2 (`fdc83a2…`, no diff)                           |
| `src/core/reporting/collect/keybindings.ts` | unchanged since R4 (`2a567e3…`, no diff)                           |

Decisions recorded: CHANGELOG untouched (test-only change, behaviour
already described). Dependent suite `test/unit/paidMoneyStructure.test.ts`
fails 1/8 on this tree (`flags every money-named numeric leaf`); neither
it nor its sources are touched by this lane (last commit CM1132R3), so it
is the same pre-existing base failure RVCM1135D reported — routed to the
lead, not fixed here.
