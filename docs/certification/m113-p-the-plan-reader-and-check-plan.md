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

Implementation drill receipts and final scoped results are recorded here
after the reader/gate's exact-restoration runs. Aggregate quality remains
the lead's responsibility under the explicit common/rig instructions;
the local lane runs complete owned files and the prescribed scoped gates.
