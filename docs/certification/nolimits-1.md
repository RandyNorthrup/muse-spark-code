# NOLIMITS1 certification (group A: model loop's and features' counts and sizes)

Lane branch `fix/nolimits-1`. Method: `NOLIMITS-common.md` (owner rule
2026-10-16); resumed after the 2026-10-16 outage, continued 2026-10-17
under the corrected rule and the 2026-10-17 STOP MAKING FAKE section.
Decision record: PLAN.md D121 (this lane wrote the heading; one line per
row). No model calls; no credentials printed, copied or stored.

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
no test merely asserts that text, a key or a file exists; the two
behaviours that need a live run (65 real subagent spawns, a real
multi-thousand-file PR checkout) are named as lead real-life checks,
not stood in for.

## Per-row table

| id  | what it was                                      | decision                                | evidence                                                                                                                                                                                          | commit                           |
| --- | ------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| A7  | Best-of-N ≤5 attempts, 5–50 requests/attempt     | removed                                 | No provider documents a cap; both numbers are the person's per-run choice (dialog defaults 3 × 20 stay)                                                                                           | `25c7906`                        |
| A8  | Headless exec ≤500 max requests, ≤$20 budget     | removed (person's flags stay)           | No provider documents them; `--max-requests` (default 30) and `--max-budget-usd` stay with no ceiling of ours                                                                                     | `c1e9450`                        |
| A11 | `RENAME_MAX_FILES` = 200                         | removed                                 | A count, not about a model; the language service names the files                                                                                                                                  | `d3ef3d0`                        |
| A13 | `HOOK_AGENT_MAX_STEPS` = 5                       | removed                                 | Our bound on a model loop, no provider documents one; loops until the model stops calling tools (Stop aborts)                                                                                     | `a82c59e`                        |
| A21 | Goal objective ≤4000 chars                       | removed                                 | Invented (Muse Code states no limit); only a blank objective refuses                                                                                                                              | `e40fd20`                        |
| A22 | Plan ≤50 steps, plan file ≤256 KiB               | removed                                 | Not about a model; every step kept, plans and handoff briefs save/read at any size                                                                                                                | `2f2d7fb`                        |
| A23 | Saved prompts ≤200/scope, title ≤80, body ≤10000 | removed                                 | Not about a model; only a blank title refuses; the prompt file bound stays                                                                                                                        | `cedd6b4` + correction `aa7517e` |
| A24 | Image prompt ≤4000 chars, ≤4 edit sources        | removed (nothing local enforced)        | Meta documents no prompt length and 1–10 edit items (dev.meta.ai/docs/image-generation, read 2026-10-16); the capability record carries neither, so Meta's own refusal answers oversize calls     | `b02b72b`                        |
| A25 | Accounts ≤64 per provider                        | removed                                 | A count, not about a model; duplicate ids still refuse                                                                                                                                            | `be5e655`                        |
| A26 | Check commands ≤8, each ≤600 s                   | removed                                 | Not about a model; any number of checks, each naming any positive `timeoutSeconds` (300 unless set); `package.json` maxItems/maximum went with them                                               | `471d80c`                        |
| A27 | Subagents ≤64/conversation                       | removed                                 | A child count, not about a model; paid consent still asks per spawn; the 8-at-once queue (C6) untouched                                                                                           | `47361c8` + README `971419e`     |
| A28 | Team ≤6 tasks per `delegate`, engine ceiling 20  | removed                                 | Ours, not the platform's; engines are bounded by the documented Meta per-team limits, live 429 adaptation and the machine                                                                         | `f345149`                        |
| A29 | Import replay ≈768 KiB                           | SAFETY RULE — kept, listed for the lead | Window-minus-reserve against the model's documented 1 MiB window (dev.meta.ai/docs/models); removing it breaks every later message past the window instead of refusing once at import — see below | none (no change)                 |
| A30 | Export/share ≤16 MiB                             | removed                                 | A file size, not about a model; write and read back at any byte size; the transcript item count still bounds all three paths; the report reader keeps its bound as `REPORT_SOURCE_MAX_BYTES`      | `8fe5418`                        |
| A35 | Held PR checkout ≤20000 entries / ≤250 MB        | removed                                 | Not about a model; tree parses and checkout writes at any size; unreadable listings, unsafe and colliding paths still refuse                                                                      | `1f9c0f5`                        |

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
cap above stays until lane L2 applies each model's record"). So: kept
unchanged for the lead to decide — rewire via L2, or accept the guard.

## L10n

Removed refusal texts went from English and all 14 tables in the same
commits (A21, A22, A23, A35); `node scripts/check-l10n.mjs` is green.
`shareTooLarge` stays: it still fires for the transcript item count.
`transferTooLarge` stays: the picker's size branch is now unreachable
through size but the shape is unchanged.

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
  first resumes and answers, the second refuses once at import (A29 kept).
- Export a conversation past 16 MiB and open it back as a share file.

## APP PROBLEMS

None found in this lane's rows. Two neighbouring observations, not
changed (out of scope): `shareTooLarge`'s wording still names "file
size" although only the transcript item count can now trigger it, and the
share-file picker's `tooLarge` branch is unreachable through size; both
kept to avoid l10n churn and defensive-branch removal. The
`museSpark.teamMaxWorkers` name appears only in comments — no such
setting exists yet.

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
