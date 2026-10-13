# Spend ledger — design (LEDGER, 2026-10-12)

One mechanism owns every durable budget. `admit(scope, bound, cap)` takes
its scope lock, recovers pending transactions, reads one current snapshot,
refuses without publishing a claim when `total + bound > cap`, and otherwise
commits the reservation before returning it. Exactly k of n equal requests
fit when k reservations fit, including across processes. A zero cap means
accounting without a cap, never accounting without a reservation.

**Disk.** `spend-ledger-v3/<session>/<account>/state.json` contains a generation,
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
lock. No live owner is evicted by elapsed time. The monotonic wait is 2 s
(eight times the measured hold maximum rounded up to 250 ms); polling is only lock contention.
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

| EXECPROV7 | Disposition and owning proof                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-1      | Fixed: each ambiguous retry closes its first claim as uncertain at the full bound and admits a new claim. `modelApiHost`, `runLedger`, `spendLedger`.                                                                                                                                |
| P1-2      | Fixed: Anthropic +25% estimate, capped by canonical-body UTF-8 bytes; Gemini counting disabled until a full captured shape is verified; actual overage saved and run stopped. `execExactCount`, `tokenCount`, `runLedger`. Editor/helper text reservations use canonical-body bytes. |
| P1-3      | Fixed: complete renamed snapshots, generation retry and funded-claim checks. Real process start/stop harness.                                                                                                                                                                        |
| P2-1      | Fixed: nullable cap remedy above $20; output floor is max(parser minimum, provider minimum); binary-search largest fitting output. `execExactCount`, `execRun`.                                                                                                                      |
| P2-2      | Fixed: typed `context_limit`, separate from tariff. `execPaidRefusal`, packed provider row.                                                                                                                                                                                          |
| P2-3      | Fixed: settings/legacy/corruption/integrity refuse by kind; no false reached sentence. `paidDailyBudget`, `runtimeAccounting`.                                                                                                                                                       |
| P2-4      | Fixed: portable typed ledger error, scoped file/errno facts. `spendLedger`, packed refusal rows.                                                                                                                                                                                     |
| P3-1      | Fixed: Meta startup quote separates input from total reservation. `execRun`.                                                                                                                                                                                                         |
| P3-2      | Fixed: cancellation, confirmation, stale and daily precheck run before count; canceled signal is never discarded. `execExactCount`.                                                                                                                                                  |
| P3-3      | Fixed isolation and old-reader parse safety: new folder, captured v1/v2 import, 556 rows of each, old reader executed. Shared simultaneous old/new spending cannot be certified under R9; explicit limitation above.                                                                 |
| P3-4      | Fixed for new records: full OS process birth identity and boot, cached once. Unverifiable identities remain counted. Windows/macOS probes and takeover remain UNMEASURED here.                                                                                                       |
| P3-5      | Fixed: no age close. Incurred receipt drains before dead-owner recovery. Live late settlement cannot be closed by a clock or sleep. `spendLedger`.                                                                                                                                   |
| P3-6      | Fixed: typed names/kinds cross bundles; no budget template comparison. `modelApiHost`, `execPaidRefusal`, packed product.                                                                                                                                                            |
| P3-7      | Fixed: output flag documented; price comes from provider registry; real child processes replace same-process race proof. Machine-dependent byte test derives arithmetic from this checkout's request. Paths in system context are intentional workspace facts and consume tokens.    |

| EXECRACE3 | Disposition and owning proof                                                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1      | Fixed: typed local refusal propagates through transport and lazy bundles. Packed product checks historic false sentences absent.                                                                                                                                        |
| P1-2      | Fixed: unique complete owner note, provable-death takeover and empty-lock cleanup, no live eviction. Crash harness.                                                                                                                                                     |
| P1-3      | Fixed: no partial visible claim directory; capacity check and publication under one lock. Nine k-of-n groups (n=2,k=3 means two fit).                                                                                                                                   |
| P2-1      | Fixed: session, editor daily and runtime daily all call core admit with their cap; scheduled shared consent uses the lower cap at admission too. `paidDailyBudget`, `schedulePaid`, `modelApiHost`.                                                                     |
| P2-2      | Fixed: durable inbox precedes wait, process queue retained on write failure; readers count pending liability; next operation drains exactly once. Busy and crash tests.                                                                                                 |
| P2-3      | Fixed: daily errors carry daily scope, not session label. `paidDailyBudget`.                                                                                                                                                                                            |
| P2-4      | Fixed: rejected unsent claim queues zero release, cleanup failure preserves original refusal; `runtimeAccounting` injects ENOSPC as an explicit fake errno (not a measured rig disk failure).                                                                           |
| P2-5      | Fixed separately: all notes added under Unreleased; no released block copied from the reviewed branch.                                                                                                                                                                  |
| P2-6      | Fixed by design: O(open claims), closed audit never scanned on normal admission; 2-second monotonic wait, identity probes outside lock. Benchmark below.                                                                                                                |
| P2-7      | Fixed: real-process capacity mutation red drill; exact-k assertions fail on the first overadmission, not only at settlement.                                                                                                                                            |
| P3-1      | Fixed: daily admission formats `PaidBudgetStopError` with daily cap/used/held/reset.                                                                                                                                                                                    |
| P3-2      | Fixed: reached reserved for true cap refusals; unavailable text translated as unavailable.                                                                                                                                                                              |
| P3-3      | Fixed: invalid thresholds are account integrity; voice reports typed actual cause; missing store is unreadable/NOT_CONFIGURED. `usageWriterLoadKindOf` is absent from this base (reviewed branch not merged), so its proposed misclassification is not applicable here. |
| P3-4      | Not applicable to the absent `execStartRace`/`execUsageRace` files; old journal comments and attempt lock were deleted. New harness uses 12 real processes.                                                                                                             |
| P3-5      | Not applicable: those cast rows/helpers are absent from this base; no reviewed-branch §8 rows were imported. New ledger and adapter need no unsafe casts.                                                                                                               |
| P3-6      | Fixed: typed midnight refusal says restart with today's budget. `execPaidRefusal`, packed row.                                                                                                                                                                          |

Editor overages stop the current turn before its next automatic request; a
new explicit user turn can spend a remaining cap. The recorded actual amount
always stays counted. A failed earlier write cannot suppress a later incurred
charge: the host's next journal operation retries the core's retained receipts.
Reviewer/hook post-send errors are uncertain unless a 429 proves a zero bill;
the general user-refusal classifier alone is not evidence of a noncharge.

The next production build found the browser surface-English closure 0.2 KiB
above its existing 25 KiB cap. Its static text walk followed shared/paid's
UserRefusalError import into the complete host classifier. The plain refusal
class now has a dependency-free leaf; browser pricing imports that leaf. Ledger
classifiers stay portable, and browser pricing does not import host ledger prose.
No budget was moved or raised.

The 2-second deadline bounds lock polling, not the existing operating-system
identity query. On Windows/macOS, one foreign-owner birth query can run past
that deadline by at most the processOwner port's 10-second timeout; recovery
also probes open foreign owners before acquiring the lock. Own identity uses
the existing process cache and own-pid shortcut. Total admission latency on
those platforms is UNMEASURED; the actual lock-contention wall bound is at most
12 seconds plus filesystem operations, not a claimed universal two seconds.
Changing the OS query port is outside R4's ruling; no live owner is stolen.

Final compiled-core process proof exited 0: nine groups × 500 rounds (4,500),
200 real start/stop rounds with a finite $10 cap, and 28 SIGKILL boundaries.
Admission maxima at 10 / 1,000 / 10,000 closed claims: 2.878 / 4.316 / 2.389 ms;
means 2.346 / 2.933 / 2.313 ms. Maximum lock hold across parent and real workers:
242.086 ms. The initial proposed 100 ms hold bound was not met; the independent
100 ms admission benchmark passed. The 2 s wait stays unchanged: eight times
the observed hold rounded up to 250 ms. These are measured Linux wall times,
not a bound on arbitrary OS suspension or filesystem stalls.

R5/R7 combined rule: an ambiguous attempt priced from an estimate ends the run
before any retry. Its margin is not a verified upper bound; retrying it could
make two unseen estimation errors exceed the cap. Byte/exact-bound attempts can
retry with independent reservations. Estimated 429/400 zero bills and verified
actual settlements retain their existing retry rules. This is necessary for the
published “only the last request's estimate error” guarantee.

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
