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
measure all three, with a 100 ms hold-time bound before the 2 s wait is certified.

**Lock.** A complete staged directory containing one uniquely named owner
note is renamed into the lock name; an existing nonempty directory prevents
replacement. The note carries `currentProcessOwner()` (pid, OS birth and boot),
read once per process. Only a provably dead owner note is removed by its exact
unique name; then `rmdir` removes the empty lock. A crashed remover leaves an
empty lock, which is safe to remove: a holder does no work after removing its
note. Neither a stale remover nor a loser can remove a new owner's nonempty
lock. No live owner is evicted by elapsed time. The monotonic wait is 2 s
(20 times the proposed measured hold bound); polling is only lock contention.
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
