# M113-P — The plan reader and check:plan

2026-10-06, Windows rig `win11`, worktree `C:/lanes/M113P`, branch `m113/p`.
Authority: `C:/lanes/_ctx/M113P.rig.md`, shared `codex/common.md`, AGENTS.md,
PLAN D93 and M113 read in full. Lane 0's contracts and both review corrections,
the fixture plans, and the vendored quality-ledger model/reader/template were
read before implementation. This record uses `check-plan` in its portable
filename: Windows filenames cannot contain the brief's `check:plan` colon.

## Documentation repair

The actual base has three Gates headings, not the two described in the older
research. All three are combined into one §7 with their gate paragraphs
retained. M98 and the five Help working milestones under Gates move into §6.
Missing or undated milestones get explicit dated statuses from their named
certification records or the unchanged scope's documented disposition. The
old M74 status becomes a historical note; M87's integration note adopts the
documented parenthesized form. No implementation or acceptance is upgraded.
In particular, M80 and M92 remain building, M77 remains building, M88 is
planned, and M85 is superseded by M98. The badge follow-up is built on
October 5, as its certification/history says, with live release proof open.

Source paths accompany added status lines. The original prose, outstanding
checkboxes, paid/credential rules, delivery order and all gate requirements
remain intact. The one §8 addition logs the required `no-thenable` exception
for the ledger's declarative `then` schema field; no rule level is changed.

Initial scoped proof: the full plan reads as 137 milestone records, zero
drift, one Gates section and 20 delivery entries. All three owned test files
passed, **59 tests**, on win11 with repository default timeouts and
`--maxWorkers=3`. All five `npm run typecheck` projects passed. Changed-file
ESLint passed with zero warnings. The first test run caught a missing legacy
release variant and an assertion that incorrectly assumed a 0.14.0 §10
record existed; both were corrected before the green run.

## Integration handoffs

- **M113-P-S:** S passes scrubbed plan text to `readPlan(text, evidence)` and
  supplies normalized branch ancestry, PR facts and certification paths;
  the returned `facts` is lane 0's `PlanFacts` contract. No reader performs IO.
- **M113-P-K:** K consumes `facts.drift` as its Plan format row, uses
  `findMilestone` for exact ids/exit 3/suggestions and `nextSteps` for declared
  delivery order. Full conditional Needs prose remains in each reason.
- **M113-P-R/W:** W's lazy reporting engine imports this shared reader.
  R still scrubs every rendered output before hashing. No startup import,
  UI chunk, provider call or backend binding is added by P.
- **M113-P-W-docs:** README's development checks need `npm run check:plan`
  and its optional file/id arguments. Unreleased Added: deterministic shared
  plan/quality-ledger reader and mandatory whole-plan drift gate; Fixed:
  misplaced milestones, duplicate Gates sections and missing status lines.
  W owns README, CHANGELOG and the Reports catalogue/reference rows. The
  prepared `reportUi.planDrift`, `reportUi.notFound` and `reportLabels.planFormat`
  translations are reused; no translation or manifest key is introduced.

Every editor/runtime binds the same pure core. No VS Code-only path, fake
production adapter, dependency, live/paid call, credential read, network
request, push, merge, rebase or git configuration change is needed.

## Guard drills and final verification

The final baseline/restored run is **72 passing tests in three complete
files**, 9.66 seconds on win11: `planReader.test.ts` (35),
`qualityLedgerPlan.test.ts` (17), `checkPlan.test.ts` (20). Every run uses
`--maxWorkers=3` and the repository's default timeout; no filtered/skipped
test or timeout override is used. The CLI tests run real child processes
with only PATH/SystemRoot/TEMP/TMP, never credential environment variables.

All **30 deliberate guard mutations** exited **1**, with the named assertion
below observed in the complete owning test file. The runner restores bytes
in `finally` and compares the full pre/post SHA-256. Every comparison
matched. Logs/JSON receipts remain in the ignored `temp/plan-drills/`;
this table and the full restored hashes below are the committed record.

| Mutation                                    | Named failing assertion (suite)                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Remove milestone-heading drift              | reports milestone-heading at the original line and exposes the same report fact (planReader)                  |
| Remove milestone-section drift              | reports milestone-section at the original line and exposes the same report fact (planReader)                  |
| Remove section-duplicate drift              | reports section-duplicate at the original line and exposes the same report fact (planReader)                  |
| Remove milestone-status drift               | reports milestone-status at the original line and exposes the same report fact (planReader)                   |
| Remove status-form drift                    | reports status-form at the original line and exposes the same report fact (planReader)                        |
| Remove status-phrase drift                  | reports status-phrase at the original line and exposes the same report fact (planReader)                      |
| Remove delivery-form drift                  | reports delivery-form at the original line and exposes the same report fact (planReader)                      |
| Remove milestone-duplicate drift            | reports milestone-duplicate at the original line and exposes the same report fact (planReader)                |
| Remove lanes-columns drift                  | reports lanes-columns at the original line and exposes the same report fact (planReader)                      |
| Remove lanes-row drift                      | reports lanes-row at the original line and exposes the same report fact (planReader)                          |
| Remove ledger duplicate-id drift            | rejects duplicate ids and dangling references rather than inventing evidence (qualityLedgerPlan)              |
| Remove ledger reference drift               | rejects duplicate ids and dangling references rather than inventing evidence (qualityLedgerPlan)              |
| Accept every schema version                 | rejects version at the strict zod boundary (qualityLedgerPlan)                                                |
| Strip strict-object validation              | rejects unknown-field at the strict zod boundary (qualityLedgerPlan)                                          |
| Accept overwritten JSON keys                | refuses duplicate JSON keys even when a valid final value would hide them (qualityLedgerPlan)                 |
| Accept multiple ledger fences               | reports malformed JSON and missing or duplicate fences with their line (qualityLedgerPlan)                    |
| Mark all acceptance checks done             | retains work, requirements, acceptance, tasks and inert check evidence (qualityLedgerPlan)                    |
| Ignore merged ancestry                      | derives lane status only from branch ancestry, open PRs and normalized certification paths (planReader)       |
| Ignore open PR review state                 | derives lane status only from branch ancestry, open PRs and normalized certification paths (planReader)       |
| Stop normalizing Windows paths              | derives lane status only from branch ancestry, open PRs and normalized certification paths (planReader)       |
| Match id prefixes                           | reads current heading variants and treats follow-ups as distinct exact ids (planReader)                       |
| Remove suggestion tie ordering              | returns exit 3 with edit-distance suggestions and id-order ties (planReader)                                  |
| Ignore next-step Needs                      | offers the first incomplete delivery entries only when every Need is complete (planReader)                    |
| Remove check:plan from quality:gates        | is mandatory in quality:gates and runs the entire repository without a baseline (checkPlan)                   |
| Exit zero on drift                          | fails milestone-heading with the parser message and original line (checkPlan)                                 |
| Remove input redaction                      | scrubs synthetic credential canaries from plan diagnostics and unknown ids (checkPlan)                        |
| Require a local ref before open-PR evidence | keeps an open PR as lane evidence when local branch refs are unavailable (planReader)                         |
| Preset the initial release to 0.1.0         | reads the initial release version from its record rather than assuming this repository version (planReader)   |
| Treat preparation as a completed release    | retains preparation records without satisfying a completed release dependency (planReader)                    |
| Remove lane-zero l0 alias                   | recognizes the captured lane-zero l0 branch spelling without treating a neighboring lane as zero (planReader) |

| Restored file                          | SHA-256                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `src/core/reporting/plan/reader.ts`    | `958cd57f2afc0c6b2d30e72e3fe05be04f9b2b218761dc678d7d967c100d7667` |
| `src/core/reporting/plan/lanes.ts`     | `5f88103de575168dfd09729193482f7aee2d971645fc8644b0b201f446eeb141` |
| `src/core/reporting/plan/ledger.ts`    | `d8a7356710de4c1a212e0d61533760de507aaa4e5232532c36c331c3e2a89069` |
| `src/core/reporting/plan/selection.ts` | `5a5c54310d5baf8e4ac9267bf5aa27e31bff5361729116f9689098ea84bf07f6` |
| `package.json`                         | `76acbcdeb248c04732b7e174094fb6216d02b3332d2923cb1e6ec230a5905019` |
| `scripts/check-plan.mjs`               | `97b24adc900aa7aca3df0ba2e486c0053c68ca67069de0cf143b03cb76067914` |

The added regressions for an open PR without refs, a non-0.1.0 initial
release, an incomplete preparation dependency and the captured `l0` branch
spelling were each observed failing before their implementation fixes.
The full restored suites subsequently passed. Clone detection initially
caught repeated test marker/line calculations; the tests now share the
small private `planDrift` helper, and jscpd reports zero clones.

## Scoped gates and performance

- `npm run check:plan`: exit 0, 137 milestones, zero drift; all ten numbered
  sections, 86 decisions, 14 questions, 48 §8 rows, 25 release records and
  20 delivery entries retained. All 57 captured/canonical phrase entries
  are exercised by the owned tests.
- `npm run typecheck`: exit 0 for all five projects (host, webview, unit,
  e2e, integration). Changed-file ESLint: exit 0, zero warnings.
- Changed-file Prettier and `git diff --check`: exit 0.
- Plain `npm run deadcode`: exit 0, with the two unchanged configuration
  hints. `npx --no-install jscpd`: exit 0, 1,202 files, zero clones.
- `npm run check:host-api`: exit 0, 332 VS Code APIs, 31 importing files,
  25 Node built-ins, 61 theme variables, zero problems.
- `npm run check:reference`: exit 0, current 53 features, 44 commands,
  59 settings, 26 slash and 116 CLI rows. W adds the report surface bindings.
- `npm run check:l10n`: **exit 1**, the same seven unused W-owned Reports
  manifest keys already recorded by lane 0. All 14 UI tables pass. The
  keys are `command.showReport.title`, `config.reports.network.description`,
  its `whenSignedIn`/`always`/`off` enum descriptions,
  `config.reports.keepHistory.description` and
  `config.reports.agentSources.description`. No key or translation was
  added/changed by P; W's command/settings integration resolves this.
- `npm run build`: exit 0; production size, split, host-global and notices
  checks pass without any cap change. Extension 439.5/600 KiB; Model API
  446.9/475; ACP 821.5/850; checkpoint store 76.9/225; webview startup
  797.7/900 and deferred JS 50.0/50. These are the same printed sizes as
  lane 0's final receipt: P is pure core for W's later lazy binding and
  adds no activation or browser import.

On win11, Node v24.21.0, the 2,716,321-byte/31,168-line PLAN parses in
114.602 ms cold, then 96.858, 89.762, 89.958, 62.828, 69.455, 62.736,
78.821, 58.547 and 56.102 ms. All ten are below D93's 200 ms bound.
The returned result's SHA-256 is identical across all ten runs:
`be8cfead2b4f228a6d9ae89d1d725c316690942375ad38b04e547be0ae2d7dcf`.
This measures the pure parse, excluding bundling/file IO. Lead integration
must repeat the performance receipt on the other rigs.

Aggregate `npm run quality` is reserved to the lead by the explicit
common/rig rules. It was not run, and the whole M113 milestone is not
claimed complete. No gate threshold, ignore or configuration was weakened.
No tool/dependency was installed. Documentation repair commit `a2563f21`
ran the repository's real pre-commit hook (Prettier plus staged gitleaks,
zero leaks); implementation is committed with the same hooks enabled.
