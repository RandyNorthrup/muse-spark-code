# RLWINFIX2 — Defects found running the published 0.19.0 as the fleet overnight (2026-10-22)

Each item: the symptom in the published 0.19.0, the measured root cause,
the fix, and the red/green drill. Every drill runs real code only; exit
codes are pasted, not described. Gate exit codes are in the lane report,
`.lane/rlwinfix2-report.md`. The vault suites never ran on this PC per
the lane rules; hosted CI owns them.

## Item 1 — Two instances starting together lose a session

Symptom: lanes RLSCHED and RLFINISH started together (2026-10-22 00:52);
RLFINISH ran, RLSCHED never got a session: `session/new` failed with
`ERROR -32603 Internal error`, details `Command failed: powershell.exe
... [MuseSparkCreated]::Execute('publish', '<LOCALAPPDATA>\Muse Spark
Code\resource-created', ..., 'registry.json.<uuid>', 'registry.json',
<previous identity>, <stage identity>)`.

Root cause: `CreatedRegistry.save()` published compare-and-swap on the
manifest identity it last read; when another process published first,
the swap failed and the error ended the session. A winning save also
dropped whatever the other process had written (lost update).

Fix: `src/core/resources/createdRegistry.ts` `save()` now re-reads the
live manifest on a lost swap, merges this process's entries into it
(own delta since the synced baseline wins by id; entries others wrote
are kept; removals are honored; an ambiguous same-path-different-id
merge is `invalid`, never a silent drop), and publishes again, with no
attempt limit of ours (D121). A session never fails for a lost swap.
Genuine failures throw typed `CreatedRegistrySaveError`
(`refused|unsafe|invalid|io`), now in `src/shared/createdRegistrySaveError.ts`
so the eager bundles can name it without breaking the bundle split.

Drills:

- `test/unit/createdRegistryRace.test.ts` (2 processes × 2 rounds × 2
  creates through the product's own native file commands): red on the
  unmodified `save()` — driver exit 1, `created=3 failures=5 missing=[2
ids]`, the failure head showing the fleet's
  `[MuseSparkCreated]::Execute('publish',...)` signature; green after —
  driver exit 0, `created=8 failures=0 missing=[] crashed=0`.
- The driver (`test/hosts/created-registry-race.mjs`) is a plain node
  script, so the lead can run the same race by hand on any machine.
- `test/unit/createdRegistrySaveErrors.test.ts` (3 tests): a corrupt
  live manifest is `invalid`, an unusable folder is `unsafe`, an
  unwritable stage is `io` (via the real `denyWrites` ACL helper).
- Neighbours green: resourceCreatedSweep, resourcesContracts,
  resourceTreeFailures.

## Item 2 — A failed start says only "Internal error"

Symptom: a failed `session/new` or turn start answered only `Internal
error` with the cause buried in its data; `agent.stderr.log` carried
`an update was not sent: Error` and `task/stopAll before releasing
session <id> failed: Error`.

Root cause: the ACP SDK's `errorToResult` renders any non-`RequestError`
as bare `Internal error` plus a details blob (which leaks paths), and
the two warnings interpolated the error object (`${...}` → `Error`).

Fix: `src/acp/startText.ts` `startFailureText(error, site)` says what
failed in words — a refused registry save names itself and why, our own
installed sentences pass through, anything else gets the site template
with a fixed-vocabulary detail. `src/acp/agent.ts` wraps `newSession`
(logs `ACP session/new failed: ...`), the turn-start catch, and the
bare-terminal fallback (`UI_TEXT.turnFailed`). Both warnings and the new
log lines use `causeForLog`
(`src/core/backends/musecode/logText.ts`): `failureForLog` plus a
token-shaped code word, a registry reason, or one of our own installed
sentences (a closed session refusing a command threw
`Error(UI_TEXT.questionCancelled)`, which logged as bare `Error`). The
`Internal error: ` prefix on the ACP answer is the protocol's fixed
vocabulary (`RequestError.internalError`, code -32603 — the only code
in the ACP vocabulary that fits); the words after it are ours.

Drills (packed `muse-spark-code-acp-0.19.0-win32-x64`, isolated
LOCALAPPDATA/XDG/workspace, real `muse serve` 1.4.11, no model call):

- Control: `session/new` answers `ok:true` with a minted session id.
- Denied registry (icacls deny on the isolated `resource-created`,
  probe-refused with EPERM): before, bare `Internal error` (the
  fleet's 00:52 line); after, code -32603 with `The
created-resources registry could not be saved (the save could not be
written). The Muse Spark log has the details.`, and stderr
  `[warn] ACP session/new failed: CreatedRegistrySaveError io`.
- Dead serve at session release (serve child killed, then the client
  disconnects): before, `task/stopAll before releasing session ...
failed: Error`; after, `failed: Cancelled` — the owner's own
  sentence for the refused command.
- `test/unit/startText.test.ts` (6 tests) and the `causeForLog` cases
  in `test/unit/logText.test.ts` (16 tests) cover the mapper with the
  real error shapes each path throws.
- Neighbours green: accountErrorTruth, acpSignInLoss, acpPermissionAsk,
  promptWords.

## Item 3 — A Muse Code transport timeout ends the turn fleet-wide

Symptom: one transport timeout ended the turn on all five Mac mini
lanes at once (2026-10-22 02:55): `ERROR Internal error: transport
error [net-timeout]: timed out waiting for response data (meta stream)`
(Muse Code 1.4.7 pinned on the rigs).

Root cause, measured end to end: the CLI ends the turn with
`turn/completed` terminal `failed`; our mapper kept `errorKind` but
dropped `error.retryable`, and ACP `settle` rejected every failed turn
with `RequestError.internalError(reason)`. The CLI's own retry chain
(`turn/retryScheduled`, already surfaced as "Attempt N/M … retrying in
S s") runs first; the failure above is what is left when that chain
gives out.

Fix: the mapper forwards `TurnError.retryable` into the
`turnCompleted` event (`src/shared/agentEvents.ts`,
`src/core/backends/musecode/mapNotification.ts`; the field is the
vendor's published contract — CLI 1.4.11 `msp.schema.json` exported on
this machine plus SDK `TurnError.retryable`: "the server's judgment
that resubmitting the same input may succeed"). A failed turn with
`retryable: true` now answers shared transient words
(`src/shared/turnFailure.ts`, `UI_TEXT.turnTransientFailed` in English
plus all 14 tables): our sentence — the service could not finish the
turn, the turn kept its work, send the message again to continue —
with the turn's own reason beside it, so a timeout still reads as a
timeout. The ACP rejection carries `{ retryable: true }` data (which
round-trips through the SDK client) for harnesses that act on it. The
sentence deliberately does not claim "timed out": `retryable` also
covers overloads and 5xx, and only the CLI's detail names the class.
Non-retryable failures keep their existing words.

The turn keeps its work (verified by reading every failed-turn path,
no rollback found): the host only emits the event
(`MuseCodeHost.emit`); the ACP agent withdraws nothing and the session
stays usable for the next prompt; the panel settles the streamed rows
(`completeTurn`) and checkpoints release their marks without restoring
(`conversationCheckpoints.turnCompleted` — restore is person-initiated
only). The turn continues by resending the same input — the only
continue the CLI's protocol allows (a failed turn is terminal; there
is no resume primitive). No automatic resubmit loop ships in this lane:
it cannot be bounded by anything but provider judgment and person-set
limits, and it cannot be drilled without staging a real service
outage; the words and the retryable signal make the person- or
harness-driven retry possible instead.

Whether a newer CLI fixes transport retries (rig pin): read the full
Muse Code changelog 1.4.8 → 1.4.11 on 2026-10-22
(https://dev.meta.ai/docs/muse-code/changelog, current version 1.4.11).
No entry in any of the four versions changes model-transport retries:
1.4.8 (contributor routing, `turn/start` id conflicts, cutoff result
keeping), 1.4.9 (unattended flag, approval/reviewing event,
contributor signal), 1.4.10 (workflow retry resume, serve history),
1.4.11 (fork retry, failed-turn dedupe). The model-attempt retry
machinery predates 1.4.7 (1.4.3: fresh routes after server errors,
stalled-response budget). The lead should NOT move the rig pin for
this; the client-side recovery above is the fix.

Drills:

- `test/unit/turnFailure.test.ts` (5 tests): the recorded fleet
  reason through the real words function (sentence plus detail;
  sentence alone with no reason; `undefined` where not retryable)
  and through the real panel reducer (retryable → transient row text;
  non-retryable → bare reason as before). Red on the unmodified tree
  (the reducer row test fails, exit 1); green after (exit 0).
- `test/unit/mapNotification.test.ts` += the retryable-forwarding
  case (vendor-contract `TurnError` shape, recorded fleet reason;
  kind illustrative from the contract's vocabulary): red before
  (exit 1), green after. The pre-existing `authRequired` row now
  expects the forwarded `retryable: false` — the intended behaviour
  change, noted inline.
- No packed live drill: a transient provider failure cannot be staged
  without a real outage, and this lane ships no fakes. The fleet's
  02:55 line is the red; the vendor-contract-shaped red/green above
  is the green.
- Neighbours green: turnNotice, usageTruth, usageNotesBundle,
  questionUiState, snapshot, mapNotification (full file).

## Item 4 — Usage records always say `incomplete`

Symptom: a usage export listed every successful Muse Code request as
incomplete (six fleet lanes' journals: 204 to 695 requests each, every
one `incomplete`), and named the selected plain id where the CLI
served the contributor id.

Root cause: `MuseUsageDeltas` noted `outcome: 'incomplete'` on both
journal paths (per-completion and cumulative-delta) unconditionally,
and never recorded `served`.

Fix (`src/core/backends/musecode/usageDeltas.ts`): every
`session/tokenUsage` frame is one model call that completed (SDK
`SessionTokenUsageParams`: "one per model completion that reports
usage" — a failed, cancelled or refused call reports no usage and
journals no record), so both paths now note `outcome: 'completed'`.
The frame's effective model rides `served` where the CLI reports one;
`model` is unchanged (plan pricing keys off it — USAGETRUE F22).

Drills:

- `test/unit/museUsageDeltas.test.ts` += the outcome case through the
  real chain (wire mapper → deltas → recording → on-disk journal),
  with frames shaped like the recorded 2026-10-08 exchange
  (`docs/research/m105-captures/u16-2026-10-08.jsonl`, CLI 1.4.2): a
  `tool_calls` completion, a completion with no finish reason, a
  pre-`usage` frame, and a frame naming no model. Red before
  (`outcome` is `incomplete`, exit 1); green after (all four records
  `completed`; `served` set where reported, absent otherwise; exit 0).
- Neighbours green: usageTruth, usageNotesBundle, and the file's
  pre-existing cached-splits case.

## Gates

Full battery on the final tree (exit codes in the lane report,
`.lane/rlwinfix2-report.md`). Vault suites never ran on this PC per the
lane rules; hosted CI owns them.
