# M116 lane 0 — frozen contracts and integration handoffs

2026-10-06, `m116/l0`, Mac mini, base `1c5f016a`. Read local PLAN D96 and
M116 in full, AGENTS.md, the rig brief, shared `codex/common.md`, and the
M70/M68/M89/M92 certification evidence. `origin/main` is not present in this
rig checkout; the supplied base's merged plan is authoritative. No fetch,
merge, push, live call or paid call was made.

This lane supplies contracts, additive review parsing, strings and acceptance
fakes. It does not implement or certify lane P's policy or lane U's surfaces.
The full milestone remains planned until P, K, U, I and W finish.

## Frozen vocabulary

- `PLAYBOOK_PATCH_ROUNDS_MAX = 2`: two fixes after the build, so findings
  after review round three require redesign. Teams may choose one or two.
- `PLAYBOOK_LAUNDER_WINDOW_MS = 3_600_000`: same effect and subject, regardless
  of requester or spelling. Classifier blocks do not expire under this window.
- `PLAYBOOK_RECORD_MAX = 5000`: JSONL lines retained per workspace.
- Finding classes, in coverage order: `validation`, `security`, `failure`,
  `honesty`, `concurrency`, `lifecycle`, `tests`, `docs`.
- Eight configurable ids match `playbook.<id>` in D96. `neverAround` is
  rule nine's immutable id; it is absent from the settings keys.
- A disabled setting carries a trimmed nonempty reason, actor and integer
  timestamp. Settings require every configurable rule and reject extra keys.
  `defaultPlaybookSettings(teamId)` creates a fresh all-on table.

## Review format

`parseReviewBlock` reads the extension-owned `muse-review` format. It is not
an inferred Muse Code/Model API wire shape and needs no live capture. The
existing `parseReviewFindings` is retained. M70's prompt, example, empty block
and request construction have no changes.

```json
{
  "findings": [
    { "file": "src/core/schedules/store.ts", "title": "Racy claim", "class": "concurrency" }
  ],
  "coverage": [
    "validation",
    "security",
    "failure",
    "honesty",
    "concurrency",
    "lifecycle",
    "tests",
    "docs"
  ],
  "resolution": [
    {
      "findingId": "store-claim",
      "outcome": "impossible",
      "reason": "The claim is one atomic operation."
    }
  ]
}
```

Every addition is optional. Unknown finding classes and coverage words are
preserved; `knownFindingClass` recognizes the eight names without discarding
unknown text. Unclassified/unknown findings count under the module aggregate.
Resolution names are `impossible`, `caught`, `remains`, with a required reason
and a host-assigned prior finding id. P rejects duplicate, unknown or missing
prior ids and requires every old finding to be structurally impossible before
closing. A caught finding stays open. A remains answer goes to the user first.
Coverage validation and round counting belong to P: an incomplete review is
refused without consuming a round. P supplies finding answers together,
fixed or disputed with a reason, before admitting the next review.

## Policy seam

`PlaybookPolicy` is synchronous admission, immediately before an effect:
`beforeDispatch(lane, board)`, `beforeReview(module)`,
`afterReview(module, reviewBlock)`, `beforeFixRound(module)`,
`beforeMerge(lane)`, `beforeCommand(command, requester)`, and `order(queue)`.
Allow/refuse decisions have a structured `PlaybookWhyNote`. Ordering returns
its queue and notes, or an explicit refusal for a cycle/missing dependency.
No empty success is permitted. Notes are rendered from UI_TEXT at use time;
paths and ids are technical details, numbers/dates use the Intl helpers.

Additional seams cover the rest of D96 without inventing production doubles:
`answerFindings`, `recordDesignDecision`, `resolveRedesign`, `recordRefusal`,
`beforeCheck` (local, worker id or CI), and `orderReport` (owner/failure items
first). `recordRefusal` records an existing permission or classifier refusal;
no policy allow replaces existing permissions, paid consent or tool gates.
Commands carry a normalized effect+subject and shell text/edit paths/gate
intent; P refuses hook/gate tampering and never records raw command text.
The adapter must normalize equivalent effects before asking the policy.

`PlaybookLane` contains milestone, module, dependencies, estimate, merged and
reviewed facts, integration trunk/merged trunks, drill records, and an optional
design decision id. Bare dependency ids are local to the lane's milestone;
external lane/milestone dependencies must be qualified by their adapter.
`PlaybookBoard` adds merged prerequisites, workers and CI availability.
`PlaybookPlanPort.readBoard()` is the injected seam until M113/M96 merge.
The contracts do not parse other milestones' files or guess their APIs.

## Record boundary

`playbookRecordFile(workspaceKey)` produces
`playbook/v1/<workspaceKey>.jsonl`, relative to the agent data folder, with a
safe hash/slug only; the host joins it using its platform's path API.
The strict `playbookRecordSchema` validates round, design, note and settings
lines. Finding references hold only id, file, optional line and known class.
Redesign rounds also retain optional `resolution` entries (each prior id,
outcome and reason) using the same review-resolution schema. Notes include an
optional `workerId` for the offload decision and at most eight class entries,
bounded by the shared class vocabulary. Raw review detail/file
content/output fields are rejected. P owns retention,
second scrubbing of all free text, canonical workspace identity, persistence,
recovery, and append ordering. Schemas constrain shape; they do not claim to
prevent a credential pasted into a reason from being retained without that
scrubber. Round class omitted means module aggregate, not a made-up class.
A design decision names failure class, failed-patch explanation, structural
change, plan location, redesign lane, outcome and timestamp.

## Acceptance fixtures

`test/unit/helpers/playbook/fakes.ts` provides:

- `ScriptedPlaybookReviewer`: independent per-module sequences, validated
  fresh review blocks, explicit errors on invalid/exhausted scripts.
- `threeStrikesScript(outcome)`: three concurrency rounds with all-class
  coverage, followed by `impossible`, `caught` or `remains` for `store-claim`.
  Inject other module/class scripts for counter-isolation acceptance.
- `FakePlaybookReviewLoop`: calls admission before consuming the reviewer;
  forwards the complete block to the injected real policy after review.
- `FakePlaybookBoard`, `fakePlaybookLanes`, `fakePlaybookPlan`: M116's
  deliberately unsorted dependency/estimate board; separate merged/reviewed
  facts; detached snapshots; workers and CI; explicit unknown-lane failure.
- `FakePlaybookDelegate`: records a permission/classifier refusal before
  another agent re-asks the identical effect and subject.

Policy spies in lane-0 tests only verify forwarding. P's rounds, ordering,
safety and escalation tests must inject the real implementation into these
fakes; no production fake or placeholder was added.

## Named handoffs

| Lane | Binding and review obligations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P    | Implement PlaybookPolicy in new core/orchestration/playbook files. Count module aggregate plus recognized classes; only complete reviews count. Require all prior answers, decision+redesign, exact prior-id resolution, lowered-only ceiling, reviewed+merged lane 0, merged prerequisites, topology/estimate/id ordering, governed offload/CI, integration trunk, drill hashes and loud failures. Rule 9 refuses each listed hook bypass, skipped gate, same-effect delegated retry, and any classifier retry. Retain/scrub validated records. Emit a why-note on each enforced decision. |
| K    | Ask for the optional class/coverage/resolution shapes above only in the playbook reviewer charter. Do not change M70 requests. Bundle the first-party skill on both backends. PLAYBOOK_MODEL_TEXT and its reader/split guard are K/W-owned; lane 0 adds no model-text block.                                                                                                                                                                                                                                                                                                                |
| U    | Render playbook notes, strike counts, settings/reasons/actor/date, and design outcomes from UI_TEXT at runtime in panel/Agent map/ACP/CLI and shared surfaces. Persist per-team settings; panel workspace scope before M96. Rule nine is informational with no toggle, including CLI/ACP. Pass integer timestamps to the Intl date helper, counts to plural.                                                                                                                                                                                                                                |
| I    | Bind every planner to P before its actual effect: panel subagents/delegate/best-of-N/review, then M96/M96c, M110 and M115w as they merge. Capture refusals from existing permission/classifier gates. Normalize effect+subject independent of agent/tool spelling. Bind the M113 plan port and playbook/milestone/fleet reports with user/failure rows first.                                                                                                                                                                                                                               |
| W    | Review the completed integration, docs/help, AGENTS rule 14, request goldens, axe, lazy bundle/split guards/budgets and full quality on the rigs. This lane cannot certify other lanes' policy or surfaces.                                                                                                                                                                                                                                                                                                                                                                                 |

`src/shared/hostApi/**` (M104) and `src/shared/featureCatalog.ts` are absent on
this base. Named integration bindings are `playbook/status`, `playbook/record`,
`playbook/settings`, and the policy note/strike subscriptions in M104, plus
`/playbook`, CLI `playbook status|record|settings`, settings, immutable safety
rule, redesign action and skill in the help reference. Their owners must use
these schemas at the boundary and regenerate/check the host API/help records.
No manifests/commands/settings were registered by lane 0. New per-team
settings are custom shared UI settings, not VS Code machine-scoped manifest
settings; package.nls updates therefore use the existing bundled-skill
setting description rather than unused keys, which the localization gate
correctly refuses.

Single-model requests remain unchanged. No paid feature/call was added.
Enhancements stay on by default for the chosen setup; any later paid extra
uses the existing first-charge three-choice consent naming its price and
shared `museSpark.paidDailyBudgetUsd`, per the owner ruling. Editor bindings
are shared-core/React/host-port work, with ACP/CLI equivalents; no feature in
this lane depends on VS Code.

## Strings delivered by lane 0

The `playbook*` group in en.ts and all 14 UI tables includes the settings,
reason/actor/date, lowerable limit, immutable safety rule, design decision
fields, pending outcome, three resolution labels, eight class labels, nine
rule labels, every note code and the plural strike badge. The existing
manifest bundled-skills description is generalized in all 15 manifest
tables for project quality workflows and first-party skills; its localized
command reference matches the existing command title. No unused manifest
key, registration or changed request prefix was introduced.

U maps note module/laneId/workerId/round/classes/missing/actor/reason to the
matching template slots; permission-laundering duration comes from
PLAYBOOK_LAUNDER_WINDOW_MS through the Intl unit helper. Emit all fields
needed by the selected note code. New manifest registrations, if U chooses
to introduce any, need matching translated manifest keys with their binding
in that lane; these per-team switches currently use the shared UI table.

## W’s changelog handoff

Suggested Unreleased wording for the integrated milestone: define shared
playbook contracts, per-team settings, review rounds, design decisions,
structured why-notes and acceptance fakes; add optional review classes,
coverage and redesign answers without breaking old blocks; supply the
playbook wording in all 14 languages and generalize the bundled-skills
description for first-party skills. W should describe actual integrated
policy and surfaces once those lanes certify.

The first piece included a CHANGELOG entry under the general repository
documentation rule. The ownership review found that region belongs to W;
the final lane-0 diff restores CHANGELOG byte-exact to the supplied base.
