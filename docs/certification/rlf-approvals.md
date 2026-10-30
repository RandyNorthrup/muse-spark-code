# RLF-APPROVALS: approval decisions that fail `internal` while the approval advances (RLF-HARVEST H1/U1, brief B1)

Base `rec/rlf-harvest` (`int/recovery` b781451b94 plus the harvest's three
fixes, HEAD 0eaf17293). Commits: `2fc7cf7ca` (capture fixture and the suite,
red on the old handling), `a6e4d12e6` (the fix), `281d65adb` (the two new
fault handlers shaped for the catches gate; one scheduled-run log line's
wording), `73a7ba434` (the suite deduped for the duplication gate),
`8d0921d24` (a failed pending check proves neither applied nor not). The
packed proof below ran the `a6e4d12e6` build; of the later commits, only
`8d0921d24` touches this code path and only for a pending check that
itself fails — every pending read in the proof succeeded, and with
successful reads the outcomes are identical (verified by diff and by
the suites re-run on the final tree). Lead: upstream
report U1 below is written for filing with Meta; nothing here was filed
from this lane.

## What was wrong, measured

The harvest record (`rlf-harvest.md`, H1) counted, across 13 lanes on
linuxlt, macbook and the owner's PC (Muse Code 1.4.7 and 1.4.11), 1,180
`stage N decision failed: internal (MSP error -32603)` infos, 1,017 internal
warnings, and 442 decisions ending `DecisionNotAppliedError` in the ACP
session. The logs never carried the CLI's message (our log redacts it by
design), so this lane first measured what Muse Code itself recorded for
those same decisions in its own durable session log
(`runtime.approval_command_intake.*` records), and then captured the wire
exchange live.

Linuxlt RLM125 (session `01a1652c-79bf-7831-80fd-58eb38f8700c`, Muse Code
1.4.7, 457 MB session log, 10,720 settled decision intakes), measured this
lane from that record joined to the lane's `agent.stderr.log`:

| Decisions                                                                 | Count  | Intake received → settled (CLI record)    |
| ------------------------------------------------------------------------- | ------ | ----------------------------------------- |
| Settled `accepted` and the client saw no failure                          | 10,697 | median 1,300 ms, slowest 9,985 ms         |
| Settled `accepted` but the client saw `internal (MSP error -32603)`       | 23     | every one 11,270–15,131 ms (first intake) |
| Recorded as intake errors at all (`approvalAlreadyResolved`, the retries) | 4      | each the duplicate our side sent next     |

So every failed decision had in fact applied: Muse Code records no -32603
intake outcome at all; it replies the error from its serving layer after
about ten seconds (successes stay under 9,985 ms, failures settle at
11,270 ms or later) while its decide worker settles the decision
`accepted` afterwards. Decide latency grows with the session record
(median 289 ms in the session's first 25k records, 3,044 ms past 175k;
a fresh session on this rig measures 15–45 ms), which is why busy,
long-running sessions cross the line and short ones never do. Our side
then made it worse: an immediate `approval/listPending` still named the
old stage (see the capture's 16 ms race below), so the stage was unmarked
and returned `DecisionNotAppliedError`; in ACP that warned, and a second
decision for the same stage went out and came back
`approvalAlreadyResolved`. A person approving a multi-stage command saw
an error for a decision that had taken effect.

## The live capture (step 1 of the brief)

Stated before starting (`temp/capture-approvals/plan.txt`, ignored): at
most 6 model requests for the capture, $0 (subscription, contributor
tier), model `muse-spark-1.3-contributor` by that explicit name only, no
turn sent if that id is not the selected model; packed product
(`npm run package:acp -- --target linux-x64`, its installed
`dist/acp.js`); empty workspaces under `temp/`.

Two live forms, both on the pinned Muse Code 1.4.7-R6101.1 binary:

1. Packed ACP (the brief's form): the installed tarball's agent in an
   empty workspace, `--muse-binary` the pinned 1.4.7, `--allow-contributor-models`,
   model set to `muse-spark-1.3-contributor` and verified from the
   agent's own answer before the prompt, one 40-stage compound shell
   command approved stage by stage (`out/run3`, session
   `01a18e21-6465-74b1-b8bc-83560eb88719`). In a fresh session every
   decision settled in 17–45 ms and nothing failed — as the measurement
   above predicts.
2. Direct MSP over stdio against the same binary (for the raw frames our
   log deliberately never prints): one turn, one 120-stage compound
   command, `approval/listPending` before the stage-0 decision, after
   its reply, and again 3 s later. To cross the CLI's own persistence
   timeout deterministically the serve process was paused (SIGSTOP
   12 s) after the decision's intake record landed and then resumed
   (SIGCONT) — fault injection, recorded in the fixture's provenance;
   the natural crossing is the RLM125 measurement above. The CLI's
   durable record for that stage settled `accepted` after 12,070 ms,
   inside the harvest's 11,270–15,131 ms band. One earlier direct run
   paused before the worker's intake and the decision simply succeeded
   after the resume (the timer runs from intake); it is counted below.

The exchange, verbatim
([approval-decide-persistence-1.4.7.json](../../test/fixtures/rlf-approvals/approval-decide-persistence-1.4.7.json),
listPending rows projected to the fields the check reads):

```json
{
  "code": -32603,
  "data": { "kind": "internal", "retryable": true },
  "message": "approval persistence timed out; the decision may still apply and an always-allow rule may still be saved — re-open the approval to verify"
}
```

Relative to the `approval/decide` send: the error replied at +12,062 ms,
an immediate `approval/listPending` answered at +12,074 ms still naming
stage 0, the host's `approval/updated` to stage 1 arrived at +12,090 ms
(16 ms after the pending read), and the read at +15,096 ms named stage 1.

## The fix (step 2 of the brief)

- The worded condition is a named fault: `approvalPersistence` joins
  `MuseCodeFault`/`MuseCodeFaultError`
  ([agentBackend.ts](../../src/core/agent/agentBackend.ts)), matched in
  `MuseCodeHost.decisionFailed` through the existing `faultOr` table on
  kind `internal` plus the captured words
  `MUSE_APPROVAL_PERSISTENCE_FAULT` ("approval persistence timed out")
  — never on the -32603 code alone.
- It is treated as applied only once verified: `stageAdvanced` (the
  prompt ledger's current stage, a closed approval, or
  `approval/listPending` no longer naming the stage). While the
  immediate read still names the stage, `waitForStageEvent` waits for
  the host's own stage news (`approvalRequested`/`approvalUpdated`/
  `approvalResolved`, or the host's closed-approval signal) inside
  `APPROVAL_PERSISTENCE_SETTLE_MS` (10 s: the capture applied 28 ms
  after the reply; RLM125's failures settled within about five seconds
  of it), then reads the pending stage once more. Only a stage still
  waiting after that is unmarked and returns
  `DecisionNotAppliedError` exactly as before. If the pending check
  itself fails both times it proves neither way: the stage stays
  decided and the original error stands, as for a decision with no
  answer.
- Said in words once per session: `approvalPersistenceFault` in
  English and all 14 tables ("Muse Code took too long to save that
  decision and reported an error, but the decision took effect…"),
  warning level, no action offered (nothing to do: the card follows the
  host). The unverified case keeps the existing
  `decisionErrorNotice` path — every refusal is said, none is silent.
- ACP logs a `MuseCodeFaultError` decision at info as the host's own
  news ([agent.ts](../../src/acp/agent.ts)), like a settled prompt:
  no warn, no re-ask. The remaining decision callers treat the fault
  the same way the card does: Edit automatically keeps the approval
  answered instead of forwarding a card, the side-chat policy's refusal
  stands, and a scheduled approval does not stop the scheduled run —
  in each case because this error now means "verified applied" (as the
  ledger fault already did for the Auto reviewer).

A person reaches the fix by approving any step of a multi-stage command
in a long or busy Muse Code conversation (panel or an ACP editor):
where the card used to error and offer the moved-on step again, it now
carries on to the step Muse Code waits on, with the one notice above
the first time it happens in a conversation.

## Proof

- Red on the old handling, green on the new:
  [museCodeApprovalPersistence.test.ts](../../test/unit/museCodeApprovalPersistence.test.ts)
  drives the real `MuseCodeHost`/`MuseSession` over the SDK's real
  Connection with the captured frames (the decided stage's error, the
  stage-0 pending read, the stage-1 update 25 ms later in the test's
  timing). Before the fix: `1 failed` (`isDecisionNotAppliedError`
  true) + `1 passed`, exit 1. After: `2 passed`, exit 0. The second
  case keeps the old contract where it is true: no stage news and still
  waiting after the (test-shortened) settle window returns
  `DecisionNotAppliedError` and the choice is sent again.
- Drills (break on purpose, watch it fail, restore; repository
  timeouts): (1) the fault marker replaced with `drill-removed wording`
  → exit 1, exactly the applied-despite-error test fails; (2) the
  still-waiting return replaced with blanket-apply → exit 1, exactly
  the still-waiting test fails. Both edits reverted before commit.
- Packed product, after the fix: the freshly packed and installed ACP
  agent (`install2`, tarball `muse-spark-code-acp-0.19.0-linux-x64.tgz`)
  ran the brief's 40-stage command in an empty workspace on
  `muse-spark-1.3-contributor`; the same 12 s pause was applied to its
  own `muse serve` (found by command line with its cwd verified as the
  proof workspace, `out/proof2/watcher.log`) while its stage-0 decision
  was in flight. Its log, verbatim:

  ```text
  [info] Approval 01a18e75-056d-75d1-8224-e39e37bbdbce stage 0 decision failed: internal (MSP error -32603)
  [info] Approval 01a18e75-056d-75d1-8224-e39e37bbdbce stage 0: Muse Code timed out saving the decision, but its stage update shows it applied
  [info] ACP session 01a18e74-f808-7392-ad22-d9ebd5054c2e: approval 01a18e75-056d-75d1-8224-e39e37bbdbce: MuseCodeFaultError
  ```

  `DecisionNotAppliedError` count in that log: 0. The turn ended
  `end_turn` with all 40 stage lines printed; Muse Code's record shows
  the stage-0 intake settled `accepted` after 12,064 ms. One earlier
  proof attempt's watcher crashed on a scan of the sessions folder
  after its turn had already run naturally (no pause, no decision
  failure, no `DecisionNotAppliedError`); it is counted below and is
  not used as evidence of the fault path.

- Harvest re-measure on one fresh lane, as the brief asked: the counts
  to compare are the packed proof session's (1 decision failure of the
  captured kind, 0 `DecisionNotAppliedError`, 0 internal warnings,
  turn `done`) against the harvest's 1,180 / 1,017 / 442 over 13 lanes.
  A full working lane on the fixed build is the lead's integration run;
  this lane does not claim it.

### Model requests actually made (counted from Muse Code's session records)

Counted as the lane driver counts them (`"kind":"provider"` rows naming
a model, `~/.local/share/muse/sessions/2026/10/30/<id>/session.jsonl`),
every row on `muse-spark-1.3-contributor`, $0 (subscription):

| Session                                | What                                | Requests |
| -------------------------------------- | ----------------------------------- | -------- |
| `01a18e21-6465-74b1-b8bc-83560eb88719` | packed capture run (fresh, natural) | 2        |
| `01a18e23-1219-7a33-b356-b0cccee0a2af` | direct MSP, pause landed too early  | 1        |
| `01a18e27-6d5b-7030-b2f7-52ac653c5448` | direct MSP capture (the fixture)    | 2        |
| `01a18e73-eba8-74b0-8d7c-101f9b8b7ecb` | packed proof 1 (watcher crashed)    | 2        |
| `01a18e74-f808-7392-ad22-d9ebd5054c2e` | packed proof 2 (induced, fixed)     | 2        |

Capture phase (the brief's stated cap): 5 of at most 6. The proof phase
the brief also names used 4 more (one wasted by the crashed watcher).
Total 9. The failed `session/new` attempts before the sandbox's
writable Muse binds were found, and the `session/start` probes, sent no
turn and made no provider request.

## Upstream report U1 (for the lead to file with Meta)

> **Title:** `approval/decide` replies -32603 "approval persistence
> timed out" for decisions it then settles `accepted`; clients cannot
> tell applied from refused from the reply or an immediate
> `approval/listPending`
>
> **Versions:** Muse Code 1.4.7-R6101.1 (Linux, captured live
> 2026-10-30) and 1.4.11-R6667.1 (Windows, same failure counts in lane
> logs 2026-10-20…30). Client: MSP over stdio.
>
> **What happens:** In large, busy sessions `approval/decide` takes
> longer to persist as the session record grows (median intake→settled
> 1.3 s at 190k records on one measured session). Past about ten
> seconds the serving layer answers
> `{"code":-32603,"data":{"kind":"internal","retryable":true},"message":"approval persistence timed out; the decision may still apply and an always-allow rule may still be saved — re-open the approval to verify"}`
> while the decide worker goes on to settle the same decision
> `accepted` in the durable intake record (measured: every one of 23
> such decisions on the session above settled accepted after
> 11,270–15,131 ms; no -32603 outcome is ever recorded). An
> `approval/listPending` sent immediately after the error still names
> the decided stage (captured: reply at +12 ms after the error naming
> stage 0; `approval/updated` to stage 1 at +28 ms; pending read at
> +3 s naming stage 1), so a client that verifies at once concludes
> "not applied" for a decision that applied ~16 ms later, offers the
> choice again, and its second decision is refused
> `approvalAlreadyResolved`. Over ten days of editor-protocol lanes
> this produced 1,180 stage failures and 442 "decision not applied"
> outcomes across 13 sessions in one client's logs.
>
> **Capture:** one multi-stage approval with `approval/listPending`
> before and after, frames and timings in
> `test/fixtures/rlf-approvals/approval-decide-persistence-1.4.7.json`
> of muse-spark-code (the timeout crossing was induced by pausing the
> serve process after intake; the settled intake duration, 12,070 ms,
> sits inside the naturally measured band). The RLM125 measurements
> above come from the CLI's own `runtime.approval_command_intake.*`
> records joined to the client's log.
>
> **Ask:** any of — (a) reply to `approval/decide` only once the intake
> settles, or extend the serving deadline past measured persistence on
> large sessions; (b) if a transient must be answered, give it a
> distinct `kind` (today it shares `internal` with true internal
> errors) and make `approval/listPending` not name a stage whose
> decision is already settling; (c) document the "re-open the approval
> to verify" contract with the timing a client must allow (today the
> stage event can land after an immediate read still shows the old
> stage). Our client now keys on the message wording, waits for the
> host's stage event, and re-reads pending before ever offering the
> choice again; a distinct kind would let it drop the wording match.

## Limits and non-claims

- The 10 s timeout value is inferred from the measured split
  (successes ≤ 9,985 ms; failures ≥ 11,270 ms) and the capture, not
  from a documented constant; the fix does not depend on it — only the
  settle window's size cites the measurements.
- "The decision took effect" in the person's notice is said only on
  the verified path (stage seen advanced). The unverified path keeps
  the older, non-committal wording.
- Windows and macOS behaviour of the fix is code-identical (the host is
  shared); a Windows packed run was not repeated on this Linux rig.
- VS Code panel card behaviour beyond the controller's notice mapping
  was exercised through the controller's real code paths in suites,
  not by a separate VS Code window run; the packed proof above is the
  ACP surface.

## Gates on this lane's final tree (linuxlt, direct)

Every exit code as run; test runs with the repository's own timeout
(never `--testTimeout`).

- `npx vitest run test/unit/museCodeApprovalPersistence.test.ts --maxWorkers=3` — 1 on the old handling (1 failed the fault assertion), 0 after the fix (2 passed), and 0 again after the dedupe and the failed-check change.
- Drills above: 1 and 1, as intended, both restored before commit.
- Touched suites, all 0: `promptLedger` + `museCodeDecisions` + `reviewedApprovals` (16 passed), `museCodeLatest` + `mapNotification` + `approvalModesFailurePaths` (108), `acpPermissionAsk` + `acpTurnFailure` + the new suite (29), `conversationCheckpoints` + `conversationGitBundle` + `worktreeConversations` (21).
- `npx vitest related <the six changed sources> --run --maxWorkers=3` — 1: 30 files / 88 tests failed, 1,097 files / 27,430 tests passed. Every failing file but one was re-run in small batches on this tree and on an untouched `0eaf17293` worktree and failed to the identical counts on both (pre-existing on the recovery base in this sandbox: device/connector storage, browser and first-paint builds, estimator plan fixture, manifest notices, and friends); `playbookSchedulesInputs` passes alone on both trees. `runtimeLsp` was not base-re-run (its three failures are 240 s test timeouts in supervisor-process tests, an area this lane does not touch) and is recorded as uncompared, not as passing.
- `prettier --check` and `eslint --max-warnings 0` on all touched files — 0 and 0.
- `npm run typecheck` (all projects) — 0, no `error TS` lines; the sequence ran through `typecheck:faults` last.
- `node scripts/check-l10n.mjs` — 0 (14 tables, 0 problems).
- `npm run check:reference` — 0. `npm run check:host-api` — 0. `npm run check:plan` — 0. `npm run check:roadmap` — 0 (no milestone change).
- `npm run check:catches` — 1 before shaping (one new GENERIC, one changed site); after the two handlers were shaped and the lowered baseline regenerated (host GENERIC 95 → 94, no count rose) — 0.
- `npm run duplication` — 1 before dedupe (2 clones in the new suite), 0 after (0 clones).
- `npm run cycles` — 0. `npm run deadcode` (knip) — 0, with the usual configuration and tag hints only.
- `npm run build` — 0 (all budgets hold; `legal build records: 162 bundles, 2865 files, 0 problems`).
- `npm run security:audit` — 0 (7 advisories noted, 0 exceptions, as on base).
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast` — 1: six blocking findings, the same count the base record names, none in a file this lane touched (the log names `src/core/backends/modelapi/mcp/headers.ts`, `src/runtime/node/keyStore.ts`, `src/webview/App.tsx`; semgrep also warned of rule timeouts in `ModelApiHost.ts`).
- `npm run security:secrets` — 1: gitleaks over 8,572 commits (base 8,567 + this lane's 5) still finds the same 2 history leaks as the base record; this lane added none. Not fixed here: no history rewrite (the exposure stays for the lead to address as on base).

Not run here: integration tests, `test:a11y` / `test:legal-a11y` (no UI change beyond one notice's text and actions), packaging beyond the proof's own `package:acp` runs, and the credential-store/vault suites (not touched; the sandbox facts in the brief apply). No UI scene changed, so no `ui:look` pictures.
