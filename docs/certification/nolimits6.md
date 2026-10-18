# NOLIMITS6: no limits of ours on tool rounds, shell time, attachments and the vault

Branch `fix/nolimits-6`, started at `origin/main` 81dacaf5a7 (2026-10-17).
Owner rule (AGENTS.md, "Limits"): the only hard-coded limits are each
provider's own published limits; with no limit the person set, nothing is
reserved, refused or locked. Each item below was checked against the
repository's provider notes (`docs/research/`, PLAN.md, the certification
records that cite a provider page) before it was kept or removed.

## Items: now and after

| #   | Limit (main)                                                                                                                                                                                                                                                                                             | Provider's own?                                                                                                                                                                                                                                                                                                                                                       | After                                                                                                                                               | Overlap                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `MODEL_API_MAX_TOOL_ROUNDS = 50` (`constants.ts:2409`), a Model API turn fails "stopped after 50 tool rounds" (`ModelApiHost.ts:13857`); README "50 per turn"                                                                                                                                            | No. No provider documents a per-turn round count; the constant's own comment says "to bound a loop" (ours).                                                                                                                                                                                                                                                           | Removed. A turn runs model calls until the model answers without a tool call, the person stops it, a hook stops it, or a goal budget they set does. | PR #178 (`fix/tool-rounds`) raises the same line to 200 and adds a wrap-up at the last round; this branch removes the constant, so #178's constant hunk and its last-round wrap-up conflict with it by design.                            |
| 2   | Shell tool: `SHELL_DEFAULT_TIMEOUT_MS = 120_000`, `SHELL_MAX_TIMEOUT_MS = 600_000` (`constants.ts:4033`, `:4049`; `tools.ts:1960-1963`); README "2 minutes by default, 10 at most"                                                                                                                       | No. Ours.                                                                                                                                                                                                                                                                                                                                                             | Not changed on this branch (see "Open").                                                                                                            | PR #214 (`fix/nolimits-2`) already removes both from the shell tool (`tools.ts` `shell()`, `toolIo.ts` `runCommand` with no deadline when none is named, plus its still-waiting notice). A second copy here would conflict hunk for hunk. |
| 3   | Attachments: 20 per message (`MAX_ATTACHMENTS_PER_MESSAGE`, `constants.ts:1335`), images 10 MiB (`MAX_IMAGE_BYTES`, `:1319`), PDFs 32 MB (`MAX_DOCUMENT_BYTES`, `:1408`), text 1 MiB a file (`MAX_TEXT_ATTACHMENT_BYTES`, `:1424`) and 768 KiB combined (`MAX_MODEL_API_TEXT_ATTACHMENT_BYTES`, `:2302`) | Partly. Meta's published limits (dev.meta.ai/docs/file-handling and /docs/image-understanding, recorded in `docs/research/meta-coverage-2026-10-05.md` rows 18 and §Images, and `docs/certification/m54.md`): 50 MB per inline file, 50 images per request (PDF page images count), text from the first 100 PDF pages. 20, 10 MiB, 32 MB, 1 MiB and 768 KiB are ours. | Not changed on this branch (see "Open").                                                                                                            | PR #204 (`fix/nolimits-4`) rewrites the same admission code (`src/core/attachments.ts` record-based byte limits, `mediaBudget.ts`, the 48,000,000-character aggregate).                                                                   |
| 4   | `museSpark.webSearchMaxPerRequest` 1–20, default 5 (`package.json:1502`, `WEB_SEARCH_MAX_PER_REQUEST(_LIMIT)`, `constants.ts:2268-2270`); `museSpark.screenRecordingMaxSeconds` 120 by default, 10–600 (`package.json:1616`, `constants.ts:1394-1396`)                                                   | No. PLAN.md already rules both "set by the person, none by default" (D-section lines 7815 and 26265); no provider bound for `max_tool_calls` or a recording length is recorded.                                                                                                                                                                                       | Not changed on this branch (see "Open").                                                                                                            | None found in #178, #204, #214, #229.                                                                                                                                                                                                     |
| 5   | `VAULT_LIMITS` (`constants.ts:8111`): 10,000 items, 10,000 grants, 1,000 cookies, 128 names/reasons, 256 argv, 1 MiB value, 4 MiB frame, 4,096-character text                                                                                                                                            | No operating-system or provider limit is recorded for any of them. `day: 6`, `hour: 24`, `idBytes: 16` and `sha256Hex: 64` are format facts (weekday index, hour of day, id size, SHA-256 hex length), not caps.                                                                                                                                                      | Not changed on this branch (see "Open").                                                                                                            | PR #214 edits the neighbouring approval schema in `src/shared/vault.ts` (approval TTL), not `VAULT_LIMITS`.                                                                                                                               |

## Item 1: what changed

- `src/core/backends/modelapi/ModelApiHost.ts` `loop()`: the round loop has
  no bound (`for (let round = 0; ; round += 1)`). The tail that ran after
  the 50th round (promote steered input, `outcomeStopReason = 'budget'`,
  throw "stopped after 50 tool rounds") is gone with it; nothing can reach
  it. The output-continuation branch loses its "not on the last round"
  clause.
- `verifyRound` (`ModelApiHost.ts`, `schedulesEntry.ts`) loses
  `isLastRound`: only the 50-round cap could make it true.
- `src/shared/constants.ts`: `MODEL_API_MAX_TOOL_ROUNDS` deleted.
- README limits table: the "Model API: tool rounds, 50 per turn" row is
  gone. `docs/design/judge-fast-path.md` §6.3 says the cap was removed.
- What still ends a turn, all unchanged: the model's answer without a tool
  call; Stop; a Stop, PostToolBatch or check hook; a goal budget or session
  budget the person set; `TOOL_REPEAT_LIMIT` (three identical calls);
  the provider's own errors (context overflow after one compaction, refused
  requests).
- No unit test: a turn of many rounds needs a model answering with tool
  calls, and the owner's rule forbids a stand-in provider or a local server
  answering as one. The proof is real use in the packed product (below).

### Real-use steps (packed product, Model API backend)

1. Build and install the VSIX from this branch; pick a Model API model.
2. Ask for a task that takes more than 50 tool calls, for example "read
   every file under src/core/media one by one with read_file and list each
   file's exports".
3. Before: the turn ends at round 50 with "stopped after 50 tool rounds".
   After: it keeps going until the model answers, or until Stop.

Not run here: no model provider is available to this lane, and the
release run (CLAUDE.md) states calls and a dollar cap first.

### Local gates on this tree (2026-10-17, Windows 11)

| Gate                                                                                                                                               | Exit |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| prettier `--check` on every changed file                                                                                                           | 0    |
| eslint `--max-warnings=0` on the changed source files                                                                                              | 0    |
| `typecheck:host`, `:webview`, `:unit`, `:e2e`, `:integration`                                                                                      | 0    |
| `check:plan`                                                                                                                                       | 0    |
| `check:l10n` (no string added or changed)                                                                                                          | 0    |
| `check:reference`, `check:roadmap`                                                                                                                 | 0    |
| `build` (sizes, split, lazy registry, host globals, notices)                                                                                       | 0    |
| vitest: `invariants`, `lazyBundleFiles`, `paidMoneyStructure`, `sideCallSchemas` (the suites naming `ModelApiHost` or `schedulesEntry`), 108 tests | 0    |

## PR234W2 review-thread record (lane PR234W2, branch `fix/nolimits-6-w2`)

One line per thread, then per hosted-CI failure (the brief lists none after the
threads: it goes from thread 3 straight to Gates).

- P1 CHANGELOG-prove: WITHDRAW UNTIL PROVED (this change) — the
  `[Unreleased]` entry is removed until the lead's real-life run certifies a
  turn past 50 tool rounds through the packed product; this rig may not make
  provider calls (lane brief: "No paid or live model calls unless the brief
  explicitly says so"), and no stand-in may stand in for the provider.
  Restore text and steps below.
- P2 repeat guard in stop conditions: FIX IN WORDING (this change) — the
  withdrawn entry's restore text names the repeat-guard stop; the `loop()`
  comment and the item-1 "After" cell below are corrected in the same change
  (`RepeatGuard.before()` returns `stuck`, `settlePreparedCall` turns it into
  the turn-ending `stopReason`).
- P1 roadmap for this user-facing limit change: UPDATE M106 (this change) —
  `Stronger agent-loop guarantees` gains the no-round-count turn rule;
  `ROADMAP.md` regenerated.
- Hosted CI failures: none listed in the brief; `check:roadmap` and the local
  gates below are the check.

### PR234W2: claim withdrawn pending the real-life run (thread 1)

The code change stands (the loop is unbounded, the constant is deleted); the
release-facing claim does not until it has worked for real. Restore the entry
below only after the run in "Real-use steps" records a turn past 50 tool
rounds through the packed product on the Model API backend:

- A Model API turn no longer stops itself after 50 tool rounds. No provider
  publishes a round count, so the product sets none: a turn runs until the
  model answers without a tool call, you press Stop, a hook stops it, the
  repeat guard stops an unchanged repeated tool call, the provider refuses the
  request, or a budget you set is spent.

## Open (not done on this branch, with the exact sites)

- **Item 2, shell time.** PR #214 holds the change. On main the shell
  tool still clamps to 2 and 10 minutes (`tools.ts:1960-1963`); the README
  limits table keeps saying so until #214 merges, because a README line may not
  run ahead of the code. Other readers of the same constants that #214
  keeps: `ModelApiHost.ts:12232-12329` (check commands' default),
  `core/judge/fast/inspectExec.ts:144`, `core/vault/exec/service.ts:94`,
  `core/media/convert.ts:392-407`, and `CHECK_MAX_TIMEOUT_SECONDS`
  (`constants.ts:4957`), which PR #229 (`fix/nolimits-1-final`) deletes.
- **Item 3, attachments.** Overlaps PR #204 in `src/core/attachments.ts`
  (lines 332 and 362 hold the 20-per-message refusals). The rest of the
  count's readers: `acp/agent.ts:693`, `webview/components/Composer.tsx:952`,
  `webview/state/uiState.ts:821`, `core/imageResize.ts:51`,
  `runtime/companion/nativeAttachments.ts:25`, `runtime/exec/attachArgs.ts:26`,
  `scripts/lib/reference.mjs:303`, and the tests `attachments.test.ts:105,252`
  and `attachArgs.test.ts:25`. Replacing 20 with Meta's 50 media per request
  (`MODEL_API_MEDIA_PER_REQUEST`, already enforced at request build) and
  the 10 MiB image and 32 MB PDF bounds with the capability record's
  `maxBytes` (Meta: 50 MB) belongs on top of #204's record-based gate.
- **Item 4, settings.** `webSearchMaxPerRequest` feeds D78's paid
  reservation (`ModelApiHost.ts:2893`, `:4753`; `sessionBudget.ts:306`):
  with no bound, the reservation needs a rule for unbounded hosted
  searches before the default can go. `screenRecordingMaxSeconds` is passed
  as a required number to the native recorders on all three systems
  (`core/media/record/windows.ts:168,179,291`, `macos.ts:283,313,358`,
  `linux.ts:218,314,345`, `webview/media/recorder/browserRecorder.ts:187-193`,
  `host/media/previewPanel.ts:156-158`, `shared/media.ts:195-197`,
  `host/settings.ts:317-319`); "none by default" means each recorder runs
  until Stop, which changes `native/windows/capture.ps1` and the macOS
  helper's `--capture` mode.
- **Item 5, `VAULT_LIMITS`.** About 80 readers in `src/shared/vault*.ts`,
  `src/core/vault/**`, `src/runtime/vault/**`, `src/host/vault/**` and
  `src/core/mcp/oauth/**` (list: `rg "VAULT_LIMITS\." src`). Collection
  caps (`items`, `grants`, `cookies`, `reasons`, `names`, `argv`) are zod
  `maxLength` checks and size checks on in-memory sets (replay cache
  `core/vault/remote.ts:256`, broker tickets, connections, registrations and
  pending in `core/vault/broker/state.ts:639,897,1010,1696`);
  `frameBytes` also sizes a buffer (`runtime/vault/vaultInput.ts:20`) and
  `text` sizes `SLOT_STDOUT_LIMIT` (`runtime/vault/slots/slotChild.ts:9`).
  The vault commands still refuse closed on main (AGENTS.md layout), so no
  person meets these caps today.

## PR #234 review threads, lane PR234W2 (2026-10-18, rig macmini)

- T1 (P1, CHANGELOG.md:15 unproven claim): no model provider is available
  to this lane and the brief forbids live model calls, so the required
  packed-product >50-round run cannot be done here; the `Changed` entry is
  removed until that run is recorded.
- T2 (P2, repeat guard missing from stop conditions): the exhaustive
  four-event sentence is removed with the entry (the guard is real:
  `repeatGuard.ts:67` `stuck` ends the turn via
  `ModelApiHost.ts:13090-13091` with `toolRepeatStopped`).
- T3 (P1, roadmap stale): no applicable entry exists —
  `docs/roadmap/entries.json` and `ROADMAP.md` never mention the 50-round
  ceiling (measured `grep`, 2026-10-18), the branch adds no PLAN.md
  milestone, and the user-facing limit table (README) was updated in the
  code commit; `npm run check:roadmap` passes unchanged.
- Hosted CI failures: the brief lists none after the threads; none
  addressed beyond the gates below.
