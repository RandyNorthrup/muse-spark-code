# CC-ESTPLAN — PLAN's lane tables parse, and the roadmap tells M96d's truth (2026-10-30)

Lane `RLF-ESTPLAN`, worktree `/home/randy/lanes/RLF-ESTPLAN`, branch
`rec/rlf-estplan`, on the test rig `linuxlt` (Linux x86_64, Node 24.21.0,
npm 11.19.0). Base: int/recovery `9b090e87c`. Model attempts: **0**.
Provider calls: **0**. Nothing was pushed, rebased, stashed or tagged.
No browser or GUI app was started. Scratch files lived in the worktree's
ignored `temp/` (drill backups and run logs, removed afterwards).

Two suites failed on int/recovery (`docs/certification/cc-tests.md`,
"Left failing"): `estimatorPlanSnapshotRealPlan` (8) and `cx1r2Truth`
(1). Both are green now, with `npm run check:plan` and
`npm run check:roadmap` green.

## 1. M100's lane tables (the 8 estimator failures)

All 8 failures were the same three whole-plan problems, all in M100:

- `duplicate-lane: M100:0, M100:U` — phase 1's and phase 2's tables each
  declare lanes `0` and `U`;
- `malformed-starts` on 9 rows — bare `0`, `day 0, blocks all`,
  `0, reads M103 rules`, `M109 B; D101 reconcile if landed`;
- `unknown-rig` on 14 names — `linux`, `macos`,
  `macOS + Linux (Bonjour vs Avahi matrix)`,
  `All four (Windows PC, Kubuntu VM, Mac mini, Win11 VM)` and the rest.

### The fix

`954895950 fix(plan): M100 lane tables parse: merged 0/U rows, strict
Starts, known rigs` (`PLAN.md`, the reviewed prerequisite fixture, one
stale count comment in the test).

Merged lanes 0 and U by what each lane actually owns: each is now
declared once, in the phase-2 table, owning both phases' scope, with
phase 1's review focus kept in a new `Review focus` column (the eight
other phase-2 rows honestly leave it empty). Phase 1's table keeps its
six done lanes (P, T, E, S, G, I); its prose still names lanes 0 and U,
which still exist. No milestone's meaning changed: every other lane's
`after 0` still resolves to the same lane, and phase 1's six rows keep
their empty Starts.

Starts cells now follow the strict grammar (AGENTS.md rule 19): `day 0
(blocks all)`, `after 0`, `after 0 (reads M103 rules)`,
`after M109:B (D101 reconcile if landed)`, `last`. Lane K's `M109:B`
is not a typo for the `M109 lane R` its Owns column names: K builds
brokered-use call sites, so it starts after M109's Broker lane exists
(M100's own Depends-on prose: "M109 (vault broker for lane K)") and
works with lane R. The D101 and M103 notes stay prose in parentheses,
never refs.

Rigs use the estimator's known names only: `Kubuntu` for Linux work,
`Mac mini`, `Win11 VM`, `Windows` (the Windows PC). The known list
needed no extension: every real rig M100 names maps onto it, matching
how the other ten Rig-bearing tables already write them. The
parenthetical rig explanations (Bonjour-vs-Avahi matrix,
systemd/launchd, presence drills) already live in the lanes' acceptance
prose, so no meaning left the plan.

The reviewed fixture `test/fixtures/estimator/plan-prerequisites.json`
gains the eight phase-2 lanes (`M100:A/C/D/H/R/V` after `M100:0`,
`M100:K` after `M109:B`, `M100:W` last over all fifteen siblings),
`M100:U` moves from `[]` to `["M100:0"]` (the merged row keeps
phase-2's `after 0`), and the four whole-`M100` expansions (`M110:TJ`,
`M111:SB2`, `M115:E`, `M116:I`) gain the eight new lanes. Total
declarations 407 → 415; the test's count comment (stale at 398) now
says 415.

### Drills

- **Drill A (plan shape).** M100:D's Starts `after 0` back to `0` →
  `reports zero problems` fails, exit non-zero,
  `malformed-starts: M100:D line 20102`. Restored → 1 passed, exit 0.
- **Drill B (fixture deps).** Fixture `M100:K` to `["M100:0"]` → F3 for
  M100 fails, exit 1,
  `M100:K: expected [ 'M109:B' ] to deeply equal [ 'M100:0' ]`.
  Restored → 1 passed, exit 0.

Full file after the fix: 43 passed, exit 0.

## 2. M96d's roadmap truth (the 1 cx1r2Truth failure)

The case expects M96d's In-progress row to carry an "in progress"
sentence with no shipped/release words. M96d's real state agrees with
the case, so the entries file was the stale side, not the test:
PLAN.md's latest status is "**Status 2026-10-22 (RLM96D): built,
pending integration**" (the production coordinator and all eight
optimisations implemented, merged as RLM96D; outstanding: native
three-OS receipts, hosted CI, the lead ruling, independent acceptance),
which the plan reader maps to `building`, and the roadmap already
listed M96d under In progress. Only the summary still read as a
planned description.

The fix rewrites the `M96d` summary in
`docs/roadmap/entries.json` to say what is true — built with its
scheduler optimisations, while integration, native qualification and
independent acceptance are in progress — and regenerates `ROADMAP.md`.
PLAN.md's status line already agreed and is untouched.

### Drill

- **Drill C (entries → roadmap → case).** Summary's in-progress
  sentence replaced with `with integration upcoming.`, regenerated →
  `roadmap places dormant work in progress` fails, exit 1,
  `expected '- **Machine-wide agent coordination**…' to match
/(?:is|are) in progress\./`. Entries restored, regenerated,
  `check:roadmap` current → 1 passed, exit 0.

Full file after the fix: 18 passed, exit 0.

## 3. Gates

On the final tree: `npm run check:plan` exit 0 (240 milestones,
0 drift); `npm run check:roadmap` exit 0 (240 entries, current);
`estimatorPlanSnapshotRealPlan` 43 passed; `cx1r2Truth` 18 passed;
prettier check on touched files exit 0. No source file changed, so
typecheck, eslint, l10n, reference, host-api, catches, duplication,
cycles, deadcode and build are unaffected; the final lane-gate run is
recorded in LANE DONE.
