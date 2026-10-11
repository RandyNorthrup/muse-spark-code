# M115 join certification

MacBook lane, 2026-10-11. No browser, GUI, live model or paid calls.
Automatic delivery remains disabled until lead qualification.

## Join resolution

- Runtime head `792ebc525`: deliveryBinding keeps VS Code final authority,
  generation, consent and complete promotion-chain checks; adds runtime owner
  lifetime, submitted-message identity and queued withdrawal on close.
- Engine keeps shared-window polling serialization and adds runtime tick/dispatch
  shutdown tracking and persisted workspace roots.
- runtimeEntry keeps editor billing/caller ports and runtime delivery ports.
- scheduleClaims keeps round-three IPC barriers, warm admission and assertions
  inside the default-timeout test; no timing-based race or weakened assertions.
- README scopes disabled delivery to VS Code; PLAN and CHANGELOG retain both
  lanes' records. Roadmap describes joined candidates. Generated Help/reference
  and roadmap use their generators after merging source records.

- Consent head `5a03e44b3`: paidBinding retains cause-specific/refund/Once-CAS
  checks and restores the final dispatch callback plus synchronous authority
  generation checks from the window head. Both regression matrices remain.
- Translation conflicts retain the runtime labels and VS Code-scoped limitation
  plus the gated paid-consent explanation. Generated files are regenerated.
- Runtime merge verification: host typecheck passed; 74 tests passed in
  scheduleRuntimeDelivery, scheduleDeliveryBinding and scheduleWorkspaceBridge.

## Outstanding proof

Core dispatch/settlement implementation is in `src/core/schedules/scheduler.ts`;
`store.ts` journals explicit never-dispatched state, dispatch-started state and
acknowledged terminal facts. A legacy admitted row without a dispatch flag is
ambiguous and fails closed. Runtime host catch/terminal ledger, engine abandoned
claim retirement and engine admission-tracking/close settlement were removed.
The host now validates/reports facts and reads the journal; the core alone
acknowledges and records the terminal. Runtime shutdown aborts the core and
joins dispatches, then retries journal finalization.

The table `journals $exit for $kind, drains next fire and never replays after
reload` has 72 cases (nine exits, eight entries), including the real Run now
request path. Every delivery enum is included automatically. Source records
unknown dispatched work as `uncertain`, with its reason and retained cap;
known completed output whose cost read fails stays `ran` with unknown cost.
English and all 14 tables provide the uncertainty label/reasons.

Real-process crash tests (`scheduleSettlement.e2e.test.ts`) passed five cases:
admitted/runOnce sends once; admitted/skip remains missed; dispatch-started
without a result never sends; sent-without-result never resends; acknowledged
result retains that result. Each kills and observes the first process's exit,
starts a fresh process on the same actual journal and observes its exit.
Expensive first-process setup uses a shared `beforeAll` IPC barrier; final tests
use repository deadlines, with no timeout override. Initial unsplit fixture
work exceeded five seconds; splitting setup removed the slow-test defect.

Merge checks: 74 runtime/window tests and 111 paid tests passed. Subsequent
runtime/paid/binding checks passed 108 tests. All five typecheck projects passed. Four complete-file red drills fired at the
named regression and restored source byte-exact: dispatch fence, final terminal,
inactive refusal and runtime transport authority. The restored combined core/
accounting/runtime batch passed 146 tests; the liability/outbox/scheduler batch
passed 144 (72 table cases plus the liability snapshot test). Store/outbox/refusal
verification passed 69, including real subprocess tests. Pure value/ordering
checks use the same serialized memory journal; two real multi-process journal
operations have a named 15-second per-test budget with its OS/fsync reason,
without a global timeout override or changed assertion. Dispatch now persists
its effective liability separately from later grant edits. New native billing
regression proves a subscription schedule never opens the Model API billing
route merely because the factory installs that optional port.
Remaining dependent/static gates and byte receipts are pending.

Full production host composition is authored in `scheduleJoinAssembly.test.ts`:
real runtime backend/built Model API, real schedule/paid journals and fake model
transport; it checks both reservations before HTTP and both settlements after.
Its Mac runs failed in cleanup, first on absent admission, then on absent
`src/core/native/darwin/muse-dictate` for created-directory publication; ACP/CLI
then exceeded default deadlines. The MacBook brief forbids invoking that
recorder executable, including this helper path. Stop this part, retain the
complete test and its deadlines, and run it on Linux with packaged native
helpers; do not treat those attempted runs as passing receipts. Browser and installed-GUI suites must
run on Linux. Windows process/storage/native queue checks remain lead replay.

A completed-turn/late-retirement cost regression first failed with outcome
`refused`, then passed after completion stopped being downgraded by a later
authority retirement. Known delivered output remains delivered with unknown
cost; initial authority refusal still records refused before HTTP.
