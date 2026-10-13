# Spend ledger — design (LEDGER, 2026-10-12)

One mechanism owns every durable budget. `admit(scope, bound, cap)` takes
its scope lock, recovers pending transactions, reads one current snapshot,
refuses without publishing a claim when `total + bound > cap`, and otherwise
commits the reservation before returning it. Exactly k of n equal requests
fit when k reservations fit, including across processes. A zero cap means
accounting without a cap, never accounting without a reservation.

**Disk.** `spend-ledger-v3/<account>/<session>/state.json` contains a generation,
exact decimal settled and uncertain totals, unknown legacy history and only
open claims. Closed history is immutable audit records indexed by claim id;
admission never scans it. A single write-ahead transaction is flushed before
the snapshot is replaced. Recovery replays that transaction once, by its
expected generation, then completes its audit record. Files are staged beside
their target, flushed, closed and renamed. A reader reads one complete snapshot;
it can see the prior generation, never half of either. Admission is O(open
claims), independent of 10, 1,000 or 10,000 closed claims; a benchmark must
measure all three, with a 100 ms admission-time bound. The contention hold measurements below
set the wait margin.

**Lock.** A complete staged directory containing one uniquely named owner
note is renamed into the lock name; an existing nonempty directory prevents
replacement. The note carries `currentProcessOwner()` (pid, OS birth and boot),
read once per process. Only a provably dead owner note is removed by its exact
unique name; then `rmdir` removes the empty lock. A crashed remover leaves an
empty lock, which is safe to remove: a holder does no work after removing its
note. Neither a stale remover nor a loser can remove a new owner's nonempty
lock. No live owner is evicted by elapsed time. The monotonic wait remains 2 s. The earlier Linux hold margin does not certify
the current macOS measurements; polling is only lock contention.
Windows identity probes can take seconds; own identity is cached, foreign
identity is probed once per observed owner. No claim is refused after admission
because another fitting claim appeared.

**States and evidence.** `reserved` counts its bound; `settled` counts the
verified final cost; `uncertain` counts its full reservation permanently;
`released` counts zero. Every attempt gets its own claim. Before dispatch a
complete durable sent marker is written. Dead owner without a marker releases;
dead owner with a marker becomes uncertain; unverifiable owner remains reserved.
Age alone never proves anything. Settlement over the bound records the overage
and stops before another request. A known charge unable to get the lock stays
queued and counted in its process, is retried at the next operation, and does
not get replaced with a log line. A reservation remains globally counted while
its settlement is queued. Contradictory settlements or wrong ownership are
integrity refusals, never a transport failure.

**Input and sentences.** Verified exact counts retain their tariff reservation.
Anthropic estimates reserve estimate + 25%, at most the UTF-8 byte bound;
unverified Gemini count shapes use the byte bound. Start lines name the rule.
No request is sent unless its reservation fits; a provider estimate can make
only the final request exceed a cap, by its recorded overage. Cancellation,
confirmation, stale-run and cheap daily prechecks precede count dispatch.
Typed refusals preserve budget kind and facts across bundles. Translated
sentences distinguish cap, live lock, damaged file kind, errno, recovery,
unknown tariff, context limit and midnight. Suggested caps stay at most $20;
output remedies stay above both parser and provider minima; impossible requests
say no accepted run cap fits.

**Migration and R9 incompatibility.** Old records are imported once, validated
with their captured v1/v2 shapes, and never modified. Ownerless uncertain
history stays counted; ambiguous old liabilities whose reservation did not
bound every attempt refuse capped spending. The old reader from `87d9ab91c`
reads only `budget-journal` and `budget-intents`, so new v3 writes cannot poison
its parsing or change its totals. However a single shared cap across concurrently
spending old and new binaries is impossible under R9's isolation: the old binary
cannot count records it never reads. The alternative is an explicit version
boundary: budgets cover imported history plus v3 attempts; simultaneous old
spending is outside that guarantee. An interoperable shared cap requires an
old-build update or a write bridge, which conflicts with the no-old-format-write
ruling. This limitation must be stated, never claimed as certified joint spending.

The proof record below will name tests, real command exits, measurements and
all review findings. Unrun platform semantics and any incomplete invariant
remain marked UNMEASURED; no live or paid model request is authorized.

## Part 1 proof (in progress)

The primary mechanism is `src/core/paid/spendLedger.ts`: four states, atomic
admission, complete snapshots, durable queued settlements and process-identity
recovery. A settlement inbox is flushed before waiting for the lock; snapshots
name the consumed inbox event until its removal is durable. Readers retry when
the snapshot generation changes. Process birth probes run before acquisition,
so Windows probes do not occupy the critical section. The adapter contains only
captured v1/v2 migration and session projection; every new write is v3.

Initial core run: 12 tests passed. Intentional admission-comparison reversal:
`npx vitest run test/unit/spendLedger.test.ts --maxWorkers=3` exited 1,
7 failed / 4 passed; restored SHA-256 byte for byte. Migration/projection suite:
6 passed, including executing `87d9ab91c`’s old reader against 556 generated
v1 rows and 556 v2 rows, checking old files byte for byte after new writes.
Initial caller batch: 54 passed (core, migration, editor daily); terminal daily
23 passed separately. These are intermediate results; final-tree results follow.

The first process proof (before the durable inbox enhancement) passed eight
feasible k-of-n groups at 500 rounds each and 200 start-while-running rounds.
It measured admission maxima 3.294 / 5.201 / 3.938 ms at 10 / 1,000 / 10,000
closed claims. Its 4,461.255 ms recovery lock hold exposed identity probes under
the lock; those probes were moved outside. These numbers do not certify the
final tree. The requested n=2, k=3 case cannot admit three of only two requests;
the final harness checks that both fit when the capacity is three, explicitly.

Part 1 final module certification: 15 core cases and 6 migration/projection cases
passed with repository defaults (21 total); the authority reducer adds 15 passing
cases. ESLint/Prettier pass for the module, unit file, constants and English table;
localization reports 14 UI tables, 14 usage tables, 0 problems. Full caller and
packed-product qualification remains Part 2/3 work, not a Part 1 pass claim.

Production integration exceeded runtimeAccounting’s 50 KiB cap by 132 bytes.
Two rounds of local simplification did not fix that boundary; the design now
shares processOwner’s identity implementation through the existing process-wide
resourceAdmission bundle. This preserves every cap and caches identity once
across lazy bundles, rather than maintaining a copy per consumer.

R1’s unqualified exactly-k requirement conflicts with R4’s finite busy refusal:
a live holder stopped by the operating system can outlast any deadline while
capacity still fits. Exactly-k is certified for completed capacity admissions;
busy/I/O refusals are distinct and cannot be represented as capacity refusals.

## Review disposition

The two reviewed branches were read; `snap/exec-start-race` was not merged.
Rows below identify the implemented remedy; final proof exits are recorded separately.

| EXECPROV7 | Disposition / evidence                                                                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1      | Separate attempt claims; uncertain first attempt survives a successful retry. Core/runLedger proofs; real-provider retry remains UNMEASURED.                                                                               |
| P1-2      | Anthropic estimate +25% for terminal admission; shared daily uses bytes/context. Gemini guessed count code removed. Actual excess recorded and stops. execExactCount/tokenCount/runLedger; live count behavior UNMEASURED. |
| P1-3      | Complete snapshot publication; no directory-per-claim publication. Process proof below; full final macOS matrix not yet certified.                                                                                         |
| P2-1      | Largest fitting output remedy uses parser/provider floor and accepted $20 maximum. Pure execExactCount proof.                                                                                                              |
| P2-2      | Typed context_limit distinct from tariff; execPaidRefusal proof; real provider row UNMEASURED.                                                                                                                             |
| P2-3      | Typed settings/history/damage/ownership causes retained. Caller review; real editor prompts UNMEASURED.                                                                                                                    |
| P2-4      | Portable SpendLedgerError carries scope, file kind and errno. Real core filesystem proofs.                                                                                                                                 |
| P3-1      | Removed Meta full-context startup refusal; actual request admits canonical body with sent output cap. Packed CLI and lead scenario below.                                                                                  |
| P3-2      | Count follows cancellation, confirmation, stale and cheap daily precheck. Source review; live count sequencing UNMEASURED.                                                                                                 |
| P3-3      | 556 v1 and 556 v2 rows migrated; old reader executed and original files unchanged. Joint old/new cap impossible under isolated R9 folders, documented above.                                                               |
| P3-4      | Reuses cached processOwner port. Real macOS absent-pid/crash proof; Windows takeover UNMEASURED. Port fallback birth verification is not improved in this lane.                                                            |
| P3-5      | No age close; durable outcomes drain before identity recovery. Real core retention/receipt proofs.                                                                                                                         |
| P3-6      | Typed refusal names/kinds across bundles; no template-message comparisons. execPaidRefusal and packed CLI.                                                                                                                 |
| P3-7      | Output flag documented and arithmetic uses real price/parser/encoder. Workspace body bytes derive from this checkout; process proof uses Node children.                                                                    |

| EXECRACE3 | Disposition / evidence                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1      | Configured transport preserves typed refusal before connect; runtime unwraps original cause. Packed closed-port and typed pure proof.                                             |
| P1-2      | Unique complete process-owner lock notes; dead-owner/empty-lock recovery. Real core/process proof; Windows semantics UNMEASURED.                                                  |
| P1-3      | Capacity comparison and complete publication in one lock. Process proof below; finite busy refusal cannot promise exactly k under arbitrary scheduling.                           |
| P2-1      | Session/editor daily/runtime daily pass cap to the same core admit; schedule uses lower cap. Source review; real editor/schedule paths UNMEASURED.                                |
| P2-2      | Outcome is queued before snapshot read or lock wait; durable inbox and local queue count it. Real corrupted-snapshot/repair and busy proofs.                                      |
| P2-3      | Daily scope has own typed sentence. execPaidRefusal; live editor damage prompt UNMEASURED.                                                                                        |
| P2-4      | Cleanup retains original logical cause; zero release remains queued on IO failure. No fabricated ENOSPC test retained. Actual disk-full cleanup UNMEASURED.                       |
| P2-5      | Changes are under Unreleased; released text not moved.                                                                                                                            |
| P2-6      | O(open claims) normal admission; closed history not scanned. 100 ms threshold unchanged and currently FAILS on macOS; full measurements below. No larger timeout hides it.        |
| P2-7      | Real process exact-k assertion and capacity reversal drill. No fake runtime/store race retained.                                                                                  |
| P3-1      | Daily cap refusal carries daily scope, amount and reset. Pure typed refusal proof.                                                                                                |
| P3-2      | Unavailable/damaged/settings text does not say reached. Translated tables and localization gate.                                                                                  |
| P3-3      | Account thresholds use integrity; voice keeps actual typed cause; missing store uses unreadable/NOT_CONFIGURED. usageWriterLoadKindOf absent on this base. Real hosts UNMEASURED. |
| P3-4      | Old adapter comments removed with implementation; inherited untouched fake race files belong to TESTCUT, not repaired.                                                            |
| P3-5      | Existing PLAN cast rows point at test/unit/helpers/execRace.ts. No new unverified cast.                                                                                           |
| P3-6      | Explicit midnight refusal; real temporary daily folder and calendar data proof.                                                                                                   |

## Continuation decisions (macmini, 2026-10-12)

The owner's final testing rules supersede the original fake-provider and packed
e2e requirements. New proof uses the real ledger, real folders and actual
process identities. Inherited fake-provider test edits are removed; those
existing suites are left to TESTCUT. Build, pack, local commands and real error
paths are exercised without credentials or a model request.

A: an initial HTTP rejection before any response/output is a known zero-cost
outcome for validation/authentication/authorization/quota refusals (4xx except
408 and 499, which can describe interrupted processing). HTTP errors after a
successful stream starts never use this rule. Transport loss, 5xx and missing
final usage remain uncertain. The same rule applies to every provider wrapper,
run, session and paid request. A successful policy-refusal response can be
billable; it follows its usage, not the zero-cost HTTP rule.

B / R10: the requested smaller _true upper bound_ from received characters
is impossible on the documented contracts. Anthropic says a client disconnect
on a request on track to succeed is still charged. OpenAI includes non-visible
generated tokens. None of the six contracts found guarantees a finite tail
smaller than the output cap after disconnect. Therefore keep full unresolved
liability separately, never book it as verified spend, and replace it only with
a provider's final usage report. Do not invent a cancellation billing promise.
The missing tighter bound remains an owner/provider evidence question in §3.

| Provider          | Official evidence read on 2026-10-12; implemented interpretation                                                                                                                                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic         | [Billing](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage) explicitly distinguishes failed calls from billable disconnects. [Errors](https://platform.claude.com/docs/en/api/errors) defines validation/auth/quota rejections. Zero for initial rejection; disconnect unknown.                                      |
| OpenAI            | [Errors](https://developers.openai.com/api/docs/guides/error-codes) defines initial auth/validation/quota rejection. [Token counting](https://developers.openai.com/api/docs/guides/token-counting) counts generated non-visible output. Zero-cost rejection is an inference from rejection before generation; no blanket cancellation guarantee found. |
| Google            | [Billing](https://ai.google.dev/gemini-api/docs/billing#am-i-charged-for-failed-requests) explicitly says HTTP 400/500 tokens are not billed. Initial 400 zero; retain 5xx uncertainty conservatively until a provider report, as R5 requires. No received-output cancellation bound found.                                                             |
| xAI               | [Billing](https://docs.x.ai/developers/faq/billing) charges API consumption. Its page supplies no universal rejection/cancellation billing guarantee. Initial auth/validation/quota zero is an inference; arbitrary 4xx cancellation is excluded.                                                                                                       |
| Meta              | [Billing](https://dev.meta.ai/help/billing/api-bill) charges processed token usage. No universal cancellation tail or error refund guarantee found; initial validation/auth/quota zero is an inference.                                                                                                                                                 |
| OpenAI-compatible | [OpenRouter FAQ](https://openrouter.ai/docs/faq) and [streaming](https://openrouter.ai/docs/guides/streaming) describe provider-dependent billing and cancellation. Compatibility specifies wire shape, not billing: zero assumes a genuine pre-generation rejection; cancellation remains unresolved without final usage.                              |

C: `--max-output-tokens` already exists on this branch. `runExec` resolves
`min(flag, model policy cap)` and the actual body uses that value. Reservations
price that sent value. A $1 cap with a $23 model output limit must receive the
largest accepted fitting output remedy; a cap remedy above $20 is omitted.
Input that cannot fit even at the provider/parser minimum says no allowed cap
can admit it. A workspace path in terminal instructions explains the old 7,825
vs 7,848 byte count; it is useful context, so arithmetic uses the actual body.

Harness research: [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
uses a client-side spend estimate and explicitly allows cap overshoot. The
[current Codex reference](https://developers.openai.com/codex/config-reference)
does not list `model_max_output_tokens`; an older undocumented knob is not
evidence that the current CLI sends it. [Aider model settings](https://aider.chat/docs/config/adv-model-settings.html)
pass explicit `extra_params.max_tokens`. Retain Muse's stronger request
admission with a cap sent on the wire, and honest estimate/unknown accounting.

Inherited test changes using providers, stores, fake clocks or replacement spies
were removed from 22 suites; `execExactCount` was rewritten as real price/parser/
encoder arithmetic. The fake session helper's parallel money core was deleted
(the remaining old session fixtures belong to TESTCUT). The inherited
`execStdio` fake-provider additions were restored byte-for-byte to HEAD and are
not run. The real core-process proof is `test/unit/spendLedger.process.mjs`, not
a provider or application e2e stand-in.

macOS default-timeout receipts so far: spendLedger 17 passed; runLedger and
execPaidRefusal 54 passed; migration and remedy files 10 passed. The first
three-file run failed 7 cases (old accounting expectations and two slow migration
fixtures plus a filesystem-failure setup); standalone migration reproduced a
6.872 s case. Fixture generation and the old-reader baseline moved into shared
setup, without widening a timeout. Final-tree receipts supersede these below.

The Meta startup minimum still priced the entire context window on inspection.
It was removed: its start line now states the size-bound rule and sent output
cap, with each actual request admitted by the same runtime accounting. Configured
decoders deliver a failed terminal's final usage before raising its error.

## Measured macOS durability cost and implementation correction

The full matrix first passed n=2/k=1, 500 rounds, then was stopped with its
entire verified process group (exit 143) to measure admission early. The real
10-claim benchmark exited 1 at 1,106.692 ms, above the unchanged 100 ms gate.
Direct real-filesystem measurements found file fsync 42.415–99.289 ms,
fdatasync 60.670–113.189 ms, and directory fsync 19.725–89.384 ms. Those are
observations here, not a diagnosis of the rig or a universal scheduling bound.

Correction: each committed transaction is one flushed immutable inode. Its
complete contents also contain the current-state fields. Atomic hard-link
publication gives the snapshot and immutable audit/history indices that same
inode, avoiding repeated writes and flushes of identical data. Directory
metadata is synced before removing the durable settlement inbox or returning
an admission. A process-unique immutable owner note is flushed once per scope
and linked into each staged lock; a dead owner can never acquire again, and
another process has a different note name. No durability step is removed and
no wait, test timeout or 100 ms gate is widened. Windows hard-link and rename
semantics still require the named platform command.

The terminal reservation may use Anthropic's estimate plus its margin; the
shared daily reservation uses the complete body byte bound instead. Otherwise
several concurrent processes with low estimates could accumulate more than one
unknown input error against the daily cap. Media uses the model context limit
for the shared daily reservation while its terminal estimate remains explicit.
Session and paid helper requests already reserve canonical-body bytes.

## macOS final qualification and remaining gate failures

The owner's latest testing rules supersede the brief's fake packed-provider
cases and full quality invocation. No visual/a11y/browser/paid-provider run is
authorized here. Provider outcomes are real-use scenarios for the lead; no
stand-in response is presented as product evidence.

The post-correction default-timeout core run passed 15 and failed 2: `admits
every fitting request and no extra request` at 5.184 s, and `each state counts
its sole amount` at 6.842 s. These are unresolved timing failures, not a
diagnosis of machine load. Two attempted structural corrections did not make
those cases pass; no timeout or assertion was weakened. The earlier Linux
passes and interrupted 500-round macOS group do not certify this final tree.

R10 alternatives remain explicit: received-output cancellation cannot bound
provider billing; isolated old/new versions cannot share a hard cap; finite
lock wait cannot guarantee exactly k under an arbitrarily stalled live owner;
n=2 cannot admit k=3 requests. Busy is a separate no-send result.

History-size benchmark fixture option: `--benchmark-only --history-fixture`
expands the real writer's complete immutable transaction shape into 10 / 1,000 /
10,000 closed history entries, with consistent audit generations and a snapshot
total verified by the real reader. It measures history-size admission cost; it
does not claim that 10,000 calls were admitted or dispatched. The default
benchmark still creates every claim through the real writer.

## Lead real-use scenarios (no provider stand-ins)

Use the locally packed CLI, an existing user-configured provider and a throwaway
workspace. The lead supplies its own credentials through the normal credential
store; no key appears in a command or fixture. The provider/model names below
refer to an existing configuration; adjust only those identifiers.

- Refusal: run `muse-spark-code-acp exec --backend modelApi --provider anthropic
--model anthropic/claude-haiku-4-5 --max-budget-usd 1 --max-output-tokens 128
--max-requests 1 --ephemeral --output json "Reply ready"` against a real
  provider account that returns an initial auth/validation/rate-limit refusal.
  Record the actual HTTP status and whether any response frame arrived. Initial
  listed 4xx codes settle zero; 408/499/5xx or a stream cut retain liability.
  Observe the attempt fields and separate possibly-charged summary/usage row.
  Repeat for OpenAI, xAI, Google, Meta and the configured compatible provider;
  compatible billing remains conditional on that provider's policy.
- Stop: the same real Anthropic model, prompt `Write a long story`, output cap
  4096, cap $1, one request. Stop after 177 visible characters (record timing
  and text length). If final usage is delivered, confirmed spend uses it. If
  absent, confirmed spend excludes the full reservation, and its own
  possibly-charged line keeps that liability. The requested smaller true bound
  is not claimed. Repeat via the editor Stop action and Account & usage.
- Expensive output: configured OpenRouter `openrouter/openai/gpt-5.5-pro`, cap
  $1, one request. Without a smaller output cap, refusal suggests only accepted
  flags (no cap above $20; no output below the model/parser floor). Repeat with
  the suggested `--max-output-tokens`; provider-side request tracing must show
  that exact smaller cap. Confirm the reservation prices that field, not the
  catalogue limit. Pure arithmetic covers this locally without buying a call.
- Helpers: give explicit paid consent, trigger hosted search, image generation,
  compaction and reviewer calls. Inspect v3 receipts after each. A returned image
  remains charged when saving fails or data is unusable; extra returned images
  record actual unit overage and stop. A sent helper with no known outcome stays
  uncertain; an initial definite refusal refunds. Compare editor and terminal
  daily totals, and the conversation's separate reserved/uncertain rows.
- Concurrent windows: with only one request bound left, start paid calls in two
  editor windows and one terminal using the same new-version storage. Exactly
  one capacity grant is sent; losers have no claim and their typed refusal names
  the right budget. No guarantee covers an old binary spending in its isolated
  v1/v2 folder at the same time.
- Midnight/repair: start a real run near local midnight; the next send refuses
  with midnight text and refunds an unsent hold. In a throwaway profile damage
  `state.json`; admission must name damaged state and send nothing. Restore the
  exact bytes and retry; a queued known outcome is written once. For real disk
  full/permission failures, retain original logical refusal and queued outcome.
- UI: one local editor look by the lead at Account & usage and conversation
  budget, with a pending request and an unresolved cancelled one. Confirm spend,
  reserved and possibly charged are separate, remaining includes all three, and
  keyboard/screen-reader text gives the same amounts. No screenshot gate.

Windows PowerShell platform proof, from this checkout: `node
 test/unit/spendLedger.process.mjs --quick --proof-only`; then `node
 test/unit/spendLedger.process.mjs --proof-only` for the 500-round groups and
200 start rounds, and `node test/unit/spendLedger.process.mjs --benchmark-only`
for actual 10,000 writer-created claims. On macOS run those identical commands.
The `--history-fixture` benchmark is explicitly the indexed-data measurement,
not a substitute for the full writer-created benchmark. Run `npx vitest run
 test/unit/spendLedger.test.ts test/unit/sessionBudgetJournal.test.ts
 --maxWorkers=2` with repository default timeouts on both platforms.

Current macOS history-fixture command exited 1 (unchanged 100 ms assertions):

| Closed entries | Admission max ms | Admission mean ms | Samples |
| -------------- | ---------------: | ----------------: | ------: |
| 10             |          782.652 |           219.490 |      10 |
| 1,000          |          440.347 |           172.339 |      10 |
| 10,000         |          380.090 |           167.169 |      10 |

Maximum observed lock hold: 856.212 ms. These observations establish neither
a cause for the latency nor a universal timing bound. The 2-second wait no
longer has a certified eightfold margin on this measurement; R3/R4 timing
qualification stays open. The default writer-created 10,000-claim benchmark
and full final matrix remain unrun. Log: `temp/ledger/benchmark-fixture2.log`.

Current real-process smoke command (`--quick --proof-only`) exited 0:
all nine groups n=2/6/12, k=1/2/3 passed two rounds each (18 rounds);
start-while-running passed two rounds; all 32 kill/recovery boundaries passed
without loss or double counting. n=2/k=3 explicitly expects two admissions.
Maximum observed hold was 2,409.727 ms, including deliberate crash pauses and
recovery; it does not certify the normal admission timing margin. Full
500-round groups and 200-start final run remain UNMEASURED.

Default-timeout current core/migration/typed-refusal batch: 35 passed, exit 0.
The earlier two deadline failures did not recur in this run; their cause is
UNMEASURED, and the earlier receipts remain above. Pure run-cap/remedy/usage
batch: 48 passed.

Red drills, actual commands with no stand-in behavior:

- Image returned-unit settlement reverted to one unit: runLedger command exited
  1, 2 failed / 41 passed; extra returned images and empty returns are caught.
- Initial rejection policy reverted to 429 only, and final non-completed usage
  discarded: runLedger command exited 1, 11 failed / 32 passed.
- Core capacity comparison reversed: real-process quick command exited 1 on
  round 0, `2 !== 1` (two of two admitted with room for one).
- Receipt identity reverted to claim id: core unit command exited 1, one failed
  / 17 passed; retained reservation never became closed uncertain.

Each source file was restored with matching SHA-256 bytes before continuation.
Logs: `temp/ledger/runLedger-red.log`, `refusal-terminal-red.log`,
`process-cap-red.log`, `receipt-red.log`. The first SAST scan was stopped as a
whole verified process group (exit 143) before the final source was settled;
it is not a clean scan. Final static/packed receipts will be recorded below.

Committed-source inspection found helper refund classification still checked
completion rather than receipt of any response frame. Reviewer and hook calls
now retain liability after any frame; only an initial refusal refunds. Both
compaction callback bindings also recognize typed no-send errors. Those helper
provider interactions remain assigned to the lead's real-use scenarios.

Final verification found the installed hook's ESLint fix and Prettier rewrite
disagree on nested ternaries. Those five expressions now use explicit branches,
without gate suppression; the unused ScheduleConsent type is removed. The
host API inventory is regenerated from actual imports. A partial search receipt
keeps at least its original bound until final settlement; it cannot shrink an
active reservation.

Dependency selection found 390 suites for non-hub changes. The rig brief's
`only the files you touched` constraint and the final no-stand-in rule prohibit
a broad dependent run here; the selection manifest stays in
`temp/ledger/related-selected.json` for integration. No stand-in suite was
repaired. HUB integration: constants.ts, en.ts, usageEn.ts, usagePage.ts,
featureCatalog.ts and generated reference files.

The full-history redacted gitleaks command exited 1: two findings among 4,731
commits (241.24 MB); it printed only the summary. The installed staged scans
passed. Their cause and commit locations are UNMEASURED; no credential text was
printed and history was not rewritten. The original complete SAST scan remains
unqualified until the final-tree command finishes.
