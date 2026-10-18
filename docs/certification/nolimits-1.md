# NOLIMITS1 certification (group A: model loop's and features' counts and sizes)

Lane branch `fix/nolimits-1`. Method: `NOLIMITS-common.md` (owner rule
2026-10-16); resumed after the 2026-10-16 outage, continued 2026-10-17
under the corrected rule and the 2026-10-17 STOP MAKING FAKE section.
Decision record: PLAN.md D121 (this lane wrote the heading; one line per
row). No model calls; no credentials printed, copied or stored.

## NOLIMITS1FIX (2026-10-17, branch `fix/nolimits-1-final`)

Removes the three bounds the RVNOLIMITS1 review listed for the lead (F3)
plus the kept A29, chains long check timeouts past Node's timer maximum,
and drops every refusal string the removed bounds used. One section per
piece, with its commit.

### §N1 — prompt file bound removed (A23fix)

`PROMPT_LIMITS.fileBytes` (128 KiB) deleted from `src/shared/constants.ts`;
`validatePrompt` refuses only a blank title (`promptTitleRequired`);
`readPromptFile` streams chunks to end-of-file at any size; the import
preview drops its byte check; the VS Code link/gist reader and the runtime
stdin reader take any size (remote reads use web fetch's own 5 MiB body
bound, `WEB_FETCH_MAX_BYTES`). `promptLimits` removed from English and all
14 tables; `promptTitleRequired` added in all 15. Proof tests (NOLIMITS1FIN 2026-10-18: the two files first cited here were deleted as stand-ins in the main-now merge; the proof now lives in `test/unit/promptBoundsRemoved.test.ts` — a 131,073-byte file reads back whole, a past-cap portable file previews through a real file read, and any title/body/count stands with only blank refusing). Real-use proof with the built product: see §N6.

### §N2 — transcript item count removed (A30fix)

`SESSION_EXPORT_MAX_ITEMS` (20,000) deleted from `src/shared/constants.ts`;
`buildChatShare` renders, `sessionExportSchema` parses and `exportJson`
writes at any item count; the `tooLarge` export outcome, its notice and
both refusal strings (`shareTooLarge`, `exportTooLarge`) are gone from
English and all 14 tables. The share view still pages 200 items at a time,
which refuses nothing. Proof tests: `sessionTransfer.test.ts` parses a
20,001-item transcript; `chatShareRange.test.ts` shares 20,001 items.
Real-use proof with the built product: see §N6.

### §N3 — report source byte bound removed (A30fix)

`REPORT_SOURCE_MAX_BYTES` (16 MiB) deleted from `src/shared/constants.ts`;
`reportFileIo` reads at any size by default, chunk by chunk, and a saved
report (`readSaved`) reads whole at any size. The finite `maxBytes` path
stays for the one caller that passes its own untrusted-file bound
(`EXEC_UNTRUSTED_FILE_MAX_BYTES`, exec's own, untouched); row and text
bounds (`REPORT_MAX_ROWS`, `REPORT_MAX_TEXT_CHARS`) still refuse what they
bound, so `reportSourceReasons.limit` stays. No refusal string is removed
for this piece. Real-use proof with the built product: see §N6.

### §N4 — A29 repointed at the provider's window

`MODEL_API_IMPORT_MAX_REPLAY_BYTES` (window minus our 256 KiB reserve,
about 768 KiB) deleted from `src/shared/constants.ts`. An import is
refused only past the provider's own documented window
(`MODEL_API_CONTEXT_WINDOW`, 1 MiB, dev.meta.ai/docs/models), counted high
as one token per UTF-8 byte; the refusal still names both sizes through
the unchanged `importReplayTooLarge` string, which now carries the
provider's number instead of ours. Rewiring the window to the per-model
capability record stays lane L2's. Proof test: `sessionTransfer.test.ts`
imports half a window and refuses a replay past the full window, naming
both sizes. Real-use proof with the built product: see §N6.

### §N5 — long timeouts chained past Node's timer maximum

Node timers stop at 2^31-1 ms (about 24.8 days, a platform fact —
observed on this rig: `setTimeout(..., 2 ** 31)` warns
`TimeoutOverflowWarning: ... set to 1` and fires after ~14 ms, which
would end a person's month-long check at once as a false timeout). The
shell runner (`runCommand` in `src/host/backend/toolIo.ts`, the funnel
for check, shell-tool and hook runs) now arms `setChainedTimeout`, which
re-arms in slices of at most `NODE_MAX_TIMER_MS`. No cap is added.
Proof test: `chainedTimeout.test.ts` fires once after the whole delay
across 10 ms slices (elapsed ≥ 90 ms for a 100 ms delay), fires a short
delay, and never fires after `clear()` — real timers throughout.

### §N6 — real use of the built product

`npm run build` green (production bundles plus the size, split,
host-globals and notices gates). The proof scripts below live in the
lane's `$TMPDIR` (`proof-report.mjs`, `proof-share.mjs`); no model, no
keys, no network, no stand-ins — the built `dist/` bundles with real
files, asserted with exit codes:

- Large prompt file (§N1): piped a 168,016-byte body (marker
  `BIG-BODY-MARKER` plus padding) on stdin through built
  `dist/sharingRuntime.js` `prompts save`. Exit 0, `kind: saved`; the
  stored file holds 168,281 characters whole. The old code refused past
  128 KiB at the stdin read.
- Long share (§N2): a 20,001-item source through built
  `dist/sharingRuntime.js` `share` (two passes: preview, then confirm
  with the preview's own id). Exit 0; `share.json` is 2,418,186 bytes
  with all 20,001 items. The old code threw `shareTooLarge`.
- Large report source (§N3): a 17,835,661-byte codex rollout file
  (3 valid `token_count` events plus filler lines) as
  `~/.codex/sessions/2026/10/17/rollout-proof.jsonl` through built
  `dist/reporting.js` `createReportingServices(...).generate({kind:
'usage', ...})`. Status `generated`; the `agentUsage` record is
  `status: ok, reason: null`, and the last event's 7777 input tokens
  are in the document. The old code refused with `limit` past 16 MiB
  (red drill: the new `reportSourceSize.test.ts` fails on the pre-N3
  tree, passes on it).
- Refusal strings: `promptLimits` (`exceeds the size limit`),
  `shareTooLarge` (`exceeds the file size`), `exportTooLarge`
  (`too long for a session export`) and `transferTooLarge`
  (`larger than a session export can be`) appear in no `dist/*.js` bundle
  and no shipped `l10n/ui.*.json`; the new `promptTitleRequired`
  ships in `dist/prompts.js`, `dist/sharingRuntime.js` and all
  14 tables; the repointed `importReplayTooLarge` ships with the
  provider's number.
- Timer (§N5) and A29 (§N4) behavior: covered by the committed unit
  tests over the real modules (`chainedTimeout.test.ts`,
  `sessionTransfer.test.ts`) plus the observed platform fact
  (`setTimeout(..., 2 ** 31)` warns `TimeoutOverflowWarning` and
  fires after ~14 ms).

### §N9 — the picker's size refusal goes with the removed ceiling

`transferTooLarge` (`The file is larger than a session export can be.`)
deleted from English and all 14 tables; the `tooLarge` pick kind dropped
from `PickedTransferFile`, its branch dropped from the picker (a vanished
file reports as missing through `transferFileMissing`) and its notice
dropped from the controller. No test covered the dead branch, so none
changes; typecheck, `check-l10n` and the related suites prove the removal.

## Correction review (2026-10-16 continuation)

The first nine commits (A7, A8, A11, A13, A21–A25) were re-checked against
the corrected rule: every one is a pure removal — none turned a limit into
a general Setting, a terminal flag, an OS fact or a safety rule, so none
needed rework. One leftover surfaced later by typecheck: A23 had missed the
share-title truncation in `src/host/prompts/promptCommands.ts`, fixed in
`aa7517eae`. The A27 README sentences naming the 64 cap were fixed in
`971419e90`.

STOP MAKING FAKE compliance: every proof test below runs the REAL module
with real inputs (no mocks, no stand-ins, no invented provider/CLI data);
the behaviours that need a live run (65 real subagent spawns, a real
multi-thousand-file PR checkout, a hook agent past 5 tool steps) are named
as lead real-life checks, not stood in for. Review correction
(RVNOLIMITS1): the lane's `hookAgentSteps.test.ts` only read source text
for the removed constant's name — a reflex guard test, which the owner's
rules forbid — so the review deleted it; A13's proof is the code (the
unbounded loop in `hookModelEntry.ts`) plus the real-life check below.

## Per-row table

| id     | what it was                                                    | decision                                | evidence                                                                                                                                                                                          | commit                           |
| ------ | -------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A7     | Best-of-N ≤5 attempts, 5–50 requests/attempt                   | removed                                 | No provider documents a cap; both numbers are the person's per-run choice (dialog defaults 3 × 20 stay)                                                                                           | `25c7906`                        |
| A8     | Headless exec ≤500 max requests, ≤$20 budget                   | removed (person's flags stay)           | No provider documents them; `--max-requests` (default 30) and `--max-budget-usd` stay with no ceiling of ours                                                                                     | `c1e9450` + correction below     |
| A11    | `RENAME_MAX_FILES` = 200                                       | removed                                 | A count, not about a model; the language service names the files                                                                                                                                  | `d3ef3d0`                        |
| A13    | `HOOK_AGENT_MAX_STEPS` = 5                                     | removed                                 | Our bound on a model loop, no provider documents one; loops until the model stops calling tools (Stop aborts)                                                                                     | `a82c59e`                        |
| A21    | Goal objective ≤4000 chars                                     | removed                                 | Invented (Muse Code states no limit); only a blank objective refuses                                                                                                                              | `e40fd20`                        |
| A22    | Plan ≤50 steps, plan file ≤256 KiB                             | removed                                 | Not about a model; every step kept, plans and handoff briefs save/read at any size                                                                                                                | `2f2d7fb`                        |
| A23    | Saved prompts ≤200/scope, title ≤80, body ≤10000               | removed                                 | Not about a model; only a blank title refuses (the prompt file bound went too — A23fix)                                                                                                           | `cedd6b4` + correction `aa7517e` |
| A23fix | Prompt file ≤128 KiB (`PROMPT_LIMITS.fileBytes`)               | removed (NOLIMITS1FIX §N1)              | Not about a model; files read/import/share at any size; link imports read under web fetch's own 5 MiB body bound; only a blank title refuses (`promptTitleRequired`)                              | see §N1                          |
| A24    | Image prompt ≤4000 chars, ≤4 edit sources                      | removed (nothing local enforced)        | Meta documents no prompt length and 1–10 edit items (dev.meta.ai/docs/image-generation, read 2026-10-16); the capability record carries neither, so Meta's own refusal answers oversize calls     | `b02b72b`                        |
| A25    | Accounts ≤64 per provider                                      | removed                                 | A count, not about a model; duplicate ids still refuse                                                                                                                                            | `be5e655`                        |
| A26    | Check commands ≤8, each ≤600 s                                 | removed                                 | Not about a model; any number of checks, each naming any positive `timeoutSeconds` (300 unless set); `package.json` maxItems/maximum went with them                                               | `471d80c`                        |
| A27    | Subagents ≤64/conversation                                     | removed                                 | A child count, not about a model; paid consent still asks per spawn; the 8-at-once queue (C6) untouched                                                                                           | `47361c8` + README `971419e`     |
| A28    | Team ≤6 tasks per `delegate`, engine ceiling 20                | removed                                 | Ours, not the platform's; engines are bounded by the documented Meta per-team limits, live 429 adaptation and the machine                                                                         | `f345149`                        |
| A29    | Import replay ≈768 KiB                                         | SAFETY RULE — kept, listed for the lead | Window-minus-reserve against the model's documented 1 MiB window (dev.meta.ai/docs/models); removing it breaks every later message past the window instead of refusing once at import — see below | none (no change)                 |
| A29fix | Import replay window-minus-reserve (≈768 KiB)                  | provider's window (NOLIMITS1FIX §N4)    | The reserve was ours; an import now refuses only past the provider's documented 1 MiB window (dev.meta.ai/docs/models), naming both sizes; per-model record wiring stays lane L2's                | see §N4                          |
| A30    | Export/share ≤16 MiB                                           | removed                                 | A file size, not about a model; write and read back at any byte size (the item count went too — A30fix; the report reader's bound went too — §N3)                                                 | `8fe5418`                        |
| A30fix | Export/share/import ≤20,000 items (`SESSION_EXPORT_MAX_ITEMS`) | removed (NOLIMITS1FIX §N2)              | A count, not about a model; files write, render and parse at any item count; the `tooLarge` outcome and `shareTooLarge`/`exportTooLarge` are gone                                                 | see §N2                          |
| A35    | Held PR checkout ≤20000 entries / ≤250 MB                      | removed                                 | Not about a model; tree parses and checkout writes at any size; unreadable listings, unsafe and colliding paths still refuse                                                                      | `1f9c0f5`                        |

## A29 detail (for the lead)

`MODEL_API_IMPORT_MAX_REPLAY_BYTES` (`src/shared/constants.ts`) is a
formula, not an invented number: `MODEL_API_CONTEXT_WINDOW` (1 MiB,
comment cites dev.meta.ai/docs/models) minus
`MODEL_API_TEXT_CONTEXT_RESERVE_TOKENS` (256 KiB of room for
instructions, tools and the reply). `sanitizeImportedSession` /
`importRefusal` (`src/core/export/sessionTransfer.ts`) refuse an import
past it, naming both sizes. Without the refusal, an over-window
conversation imports cleanly and then fails EVERY later message against
the model's window — the removal the rule wants would trade one refusal
at import for a permanently broken session. Sourcing the window from the
per-model capability record (`record.limits.contextTokens`,
`src/core/providers/configured.ts`) is lane L2's migration ("The legacy
cap above stays until lane L2 applies each model's record"). That was the
kept state the review listed; NOLIMITS1FIX §N4 then removed the reserve
(below), keeping the provider's own window.

NOLIMITS1FIX (§N4): the formula is gone. The 256 KiB reserve was ours, not
the provider's, so the import now refuses only past the provider's own
documented window (`MODEL_API_CONTEXT_WINDOW`, dev.meta.ai/docs/models),
still naming both sizes through `importReplayTooLarge`. Rewiring that
window to the per-model capability record stays lane L2's.

## L10n

Removed refusal texts went from English and all 14 tables in the same
commits (A21, A22, A23, A35); `node scripts/check-l10n.mjs` is green.
`shareTooLarge` stayed through the lane (it still fired for the transcript
item count; NOLIMITS1FIX §N2 removed it with the count).
`transferTooLarge` stayed while the picker's unreachable size branch kept
its shape; NOLIMITS1FIX §N9 removes the string from all 15 tables with
the branch, the `tooLarge` pick kind and the controller notice.

NOLIMITS1FIX: `promptLimits` is gone from all 15 tables (§N1, blank titles
refuse with the new `promptTitleRequired`); `shareTooLarge` and
`exportTooLarge` are gone from all 15 tables (§N2); `transferTooLarge`
is gone from all 15 tables (§N9);
`node scripts/check-l10n.mjs` is green.

## Gates (final tree, exit codes)

| gate                                                | result                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format:check` (prettier)                           | exit 0                                                                                                                                                                |
| `lint` (eslint zero warnings, stylelint, ps)        | exit 0 — after fixing `chatShare.ts` template literal and the lane's spent `temp/nolimits-l10n.mjs` helper (one line each); lint-scratch `temp/l10n-builds-*` removed |
| `typecheck` (host, webview, unit, e2e, integration) | exit 0 — after fixing the A23 `promptCommands` reader and a test assertion type                                                                                       |
| `deadcode` (knip)                                   | exit 0 (3 pre-existing config hints)                                                                                                                                  |
| `cycles` (dpdm)                                     | exit 0, no circular dependencies                                                                                                                                      |
| `duplication` (jscpd)                               | exit 0, 0 clones                                                                                                                                                      |
| `check:l10n`                                        | exit 0, 0 problems                                                                                                                                                    |
| `check:reference`                                   | exit 0 (regenerated after A26)                                                                                                                                        |
| `check:host-api`                                    | exit 0, 0 problems                                                                                                                                                    |
| `check:plan`                                        | exit 0, 0 drift                                                                                                                                                       |
| `build` (production + budgets + notices)            | exit 0                                                                                                                                                                |
| `security:sast` (semgrep)                           | exit 0, 0 findings on 3236 files                                                                                                                                      |
| touched unit suites (21 files, repo's own timeout)  | all pass — see the lane report for counts                                                                                                                             |

Slow-test fix (rig rule 2026-10-06): the A22 proof did two full mdast
parses of one 275 KiB plan and timed out the 5 s budget on the loaded
rig. Split into a 55-step count test (86 ms) and one 262 KiB save/read
test; the big read carries the sanctioned named per-test timeout
(30 s) with its one-line reason. No `--testTimeout` used anywhere.

## What the lead must check in real life

- Spawn subagents past 64 in one Model API conversation: no "limit
  reached" refusal; paid consent asks per spawn; Stop ends them.
- Open a held checkout of a very large pull request: writes at any size;
  unsafe/colliding paths still refuse before anything is written.
- Import a conversation near the replay bound, and one just over it: the
  first resumes and answers, the second refuses once at import (A29
  repointed at the provider's own window, §N4).
- NOLIMITS1FIX lead checks: save, import and share a prompt file past
  128 KiB; export, share and import a transcript past 20,000 items; read a
  report source past 16 MiB; import a conversation between the old
  ≈768 KiB formula and the 1 MiB provider window (it now imports) and one
  past the window (it still refuses once at import, naming both sizes).
- Export a conversation past 16 MiB and open it back as a share file.
- Run an agent-type hook whose model calls read-only tools more than five
  times: it keeps going until the model stops (A13; no unit test can prove
  this without a stand-in for the model, so it is a live check only).

## Kept bounds, listed for the lead (RVNOLIMITS1 review)

The lane had kept three bounds without an outcome-4 listing; they were
listed in PLAN.md D121 for the lead's decision: `PROMPT_LIMITS.fileBytes`
(128 KiB per prompt file), `SESSION_EXPORT_MAX_ITEMS` (20,000 transcript
items — A30 had removed the byte ceiling, not the count), and the report
reader's 16 MiB bound renamed `REPORT_SOURCE_MAX_BYTES` (pre-existing
under the removed constant's name, not a new cap).

NOLIMITS1FIX removed all three plus the A29 reserve: the prompt file
bound (§N1), the transcript item count (§N2), the report reader bound
(§N3) and the window-minus-reserve formula (§N4) are all gone; nothing of
the three remains in code, English or any table.

## APP PROBLEMS

None found in this lane's rows. The share-file picker's unreachable
`tooLarge` branch went with §N9 (reads are unbounded; a vanished file
reports as missing). The `museSpark.teamMaxWorkers` name appears only in
comments — no such setting exists yet.

## A8 correction (2026-10-17): the starved start reservation

The first A8 version capped `previewResponseReservation` at the run's own
budget. A below-minimum budget ($0.10 < $0.108135) then refused its own
reservation inside the preview, the minimum computed as zero, no budget
latch fired, and the run died incomplete (exit 8) instead of
budget-exceeded (exit 5 with the named minimum) — the W-low-budget e2e
caught it. The preview now caps at the most one response can cost at the
tier's prices (full-window charge from the platform's price card and
window), which refuses nothing the person sees. Regression test:
`runLedger.test.ts` quotes $0.108135 past a $0.10 run cap; the W-low-budget
e2e passes again.

Review fix (RVNOLIMITS1): exec accepted budget strings past $20 while the
Action's `budgetString` (`action/lib/tools.mjs`) still refused them, so
`actionInputs.test.ts` "accepts exactly the budget strings exec accepts"
failed deterministically (`20.000001`) — a red test on the lane tree. The
Action's $20 and 500-request caps are the same invented ceilings as A8's,
so the review removed both (`action/lib/tools.mjs`, `action/action.yml`,
`docs/ci.md`); the parity test passes and 501 requests parse.

## Full-suite triage (2026-10-17, `npm run test:unit`: 531 files passed,

20 failed, 9085 tests passed)

- Fixed by this lane: `BestOfNDialog.test.tsx` (A7's component test still
  asserted the removed 2–5 range; updated to the 1-or-more contract) and
  the W-low-budget e2e above.
- Fixed in the RVNOLIMITS1 review: `actionInputs.test.ts` budget parity (above).
- Load timeouts, all passing in isolation afterwards: ResourcesSection,
  attachments (2), browserUiText (see below), checkTokens (2),
  colourLiteralRule, cyclesRoots, legalLocalization, modelsApp, tokens
  (2), vault scrub floor, reports e2e (md/json), packaging/vsix/usage/
  runtimeChatGpt/inspectNative hooks, execStdio e2e hook. Rig load was
  ~18 on 8 cores throughout.
- `browserUiText` full-table check (~5.2 s vs the 5 s default) fails
  identically on the untouched base (`ba995775f` worktree) — pre-existing
  marginality on a loaded rig, not this lane; passes with room given a
  raised exploratory timeout (stated here, not committed).
- `treesLinuxLaunchNative` cgroup failures (`systemd-run` fails, no
  cgroup waved through): sandbox/environment, none of this lane's files
  involved.

## Environment incidents (2026-10-17, this rig)

- ~08:40: 170 tracked test files (`test/unit`, `test/e2e`) vanished from
  the worktree from no command of this lane's; no other process of this
  lane was active. Restored byte-identical from HEAD (`git checkout`
  of exactly those paths); status after restore showed only this lane's
  own `M PLAN.md` plus this untracked record. Cause unknown — reported,
  not investigated further.
- `temp/nolimits-l10n.mjs` (this lane's spent pre-outage helper) failed
  `unicorn/no-useless-template-literals`; fixed with a one-line edit,
  file kept.

## NOLIMITS1FIN (2026-10-18, branch `fix/nolimits-1-fin`): main-now merge, no stand-ins

Merge commit `1a1d5aa03` takes current `main-now` (98 commits), keeping
both sides: main's product work stands, and this lane's source removals
stand with no dangling uses left in `src/` (checked by name: none of
`PROMPT_LIMITS`, `SESSION_EXPORT_MAX_ITEMS`, `REPORT_SOURCE_MAX_BYTES`,
`CHECK_COMMANDS_MAX`, `TEAM_ENGINE_HARD_CEILING`, `TEAM_DELEGATE_MAX`
is referenced anywhere under `src/`).

Main's no-stand-ins sweep (PR #183) deleted six test files this branch
had modified; the merge keeps the deletions, since every one of the six
used `vi.fn`, which main's eslint gate now refuses in `test/`
(`no-restricted-properties`). Per-file outcome:

- `BestOfNDialog.test.tsx`: deleted. Its 1-or-more contract is still
  proven on real code by `bestOfN.test.ts` ("accepts any whole-number
  count of 1 or more", attempts 201 stands); the dialog-form wiring it
  covered is withdrawn to `docs/real-life/unproven.md`.
- `bridgeChecks.test.ts`: deleted. The removed check-count ceiling is
  still proven by `checkCommands.test.ts` ("takes any number of checks
  (D121)", 9 checks stand); the "oversized calls" half of its unproven
  entry is withdrawn there, the rest stays backlog.
- `promptImport.test.ts` and `promptStore.test.ts`: deleted, replaced by
  one vi-free file, `test/unit/promptBoundsRemoved.test.ts` (3 tests,
  real temp files, the real store, the real importer over a real file
  read, 868 ms): past-128 KiB reads whole, past-cap previews carry the
  tags with untrusted on, any title/body/count stands with only blank
  refusing, and the 201st prompt stands. Fire drill: a planted 200-row
  cap in `scan` fails exactly the count test (2 pass, 1 fails); reverted
  byte-identical, 3/3 pass again.
- `actionInputs.test.ts`: deleted. Exec-side 501 parsing is still proven
  by `execArgs.test.ts` (`max-requests 501`); the Action-side parity
  title stays listed in `unproven.md`.
- `execSchema.test.ts`: deleted with its D121 501/$21 parse assertions;
  CLI-side parsing stays proven by `execArgs.test.ts`; the schema titles
  stay listed in `unproven.md`.
- `teamConstants.test.ts`: takes main's version. The whole caps/strings
  describes the sweep removed are gone, which subsumes this lane's
  two-line assertion drop (`TEAM_DELEGATE_MAX`,
  `TEAM_ENGINE_HARD_CEILING` — both constants, and every use of them,
  are gone from the merged tree).

Stale bound language in `unproven.md` (entries that still say a removed
cap is "enforced") carries a dated NOLIMITS1FIN note naming what is
withdrawn and what stays backlog, so a future real-use run cannot
re-prove a removed bound by mistake.

Limits check on the merged tree: main added no job-stopping cap of ours
— its only new bound-like constants since the merge base are lane
PROVERR's `PROVIDER_REFUSAL_MESSAGE_MAX_CHARS` (500) and
`PROVIDER_REQUEST_ID_MAX_CHARS` (200), which truncate quoted provider
text for display and the log; they refuse no work and stop no job.
