# M117 P — Spin it up

Worktree `/Users/user/lanes/M117P`, branch `m117/p`, MacBook Pro rig,
2026-10-06. Base `08ee52b2`; required `m117/s` (`c28cf3073`) and `m117/c`
(`df69a66aa`) merges preserve both sides of PLAN/CHANGELOG conflicts.
Merge commits: `8d35fcca` and `f9fee626`, hooks enabled (Prettier and staged
Gitleaks pass). No other merge, rebase or push is authorized.

## Read and scope

Read the rig brief, shared `codex/common.md`, AGENTS.md, the orchestration
gotchas register, D97 and M117 in full, D96's contracts/prerequisite policy,
D89's broker uses and D90's installer/pairing/wipe rules. Read lane 0's
contracts and fakes, G/R/S/C certification and `docs/estimator/prior.md`.
The plan names no additional estimator research capture. No real provider
wire capture exists on this base; real adapters must supply captured codecs.

Own D97.7's portable core under `src/core/estimator/provision/**`, owning
tests, PLAN acceptance notes and this record. W retains product CHANGELOG
and feature-reference updates when the behavior is wired.
No other lane's implementation changes. No new package, escaped type,
credential access, live/paid/model call, cloud resource or external network
request. No visual styling or UI changes; browser tests remain W's handoff.

## Implementation slices

1. Five-operation vault-brokered adapter and first-wave dispatch. Validate
   application projections with Zod; deny all other routes/redirects and
   disconnected providers. Use S's actual resource reservations, contracts
   first, and a fresh audited board submission. Serialize ownership and
   suppress duplicate submissions after ambiguous outcomes.
2. Exact run-budget admission, full-price preview, separate per-server
   confirmations, M110f cloud-init/install and M110d pairing. Retain uncertain
   create liability. Add idle notices with Keep, activity rechecks, mandatory
   funded-lifetime teardown, wipe-before-delete and deletion receipts.
3. Guard-fire drills with SHA-256 restores, owning default-timeout tests,
   all typechecks, scoped lint/format, deadcode, duplication, localization,
   reference, host API and production build. No aggregate quality/full suite
   in this lane: the supplied shared rules explicitly assign them to W/lead.

## Binding and billing limits

The budget caps admitted **rental liability**, calculated from the provider's
normalized hourly tariff and explicitly chosen maximum billed hours, with
exact fractions until display. Provider billing increments, setup fees,
taxes, storage/network charges and an unenforced or delayed deletion can
invalidate an hourly-only bill bound. M109/M110f must supply a verified
all-in tariff/billing policy, enforce the funded deadline independently of
the estimator process and reconcile provider receipts before real provisioning
is enabled. A failed/uncertain create is never assumed free; its reservation
stays. Keep cannot silently extend funded liability. No recommendation/catalog
price constitutes a spend authorization. No provider may create an account,
fill payment details or charge outside individually confirmed server creation.

## Named integration handoffs

| Handoff                 | Required binding                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M117-P-M96-M116-start` | M96 board/M110 hosts implement `EstimateStartPort`: audit reviewed contracts and merged Starts prerequisites using current receipts, atomically claim the selected lane IDs/resource placements, and return outcome receipts. Across-process deduplication belongs to that board. |
| `M117-P-M109-provider`  | The vault owns credentials and exposes the injected connected-provider broker only. Enforce origin/path/method and no redirects before attaching credentials; scrub response/error bodies. Concrete provider codecs cite captured wire fixtures.                                  |
| `M117-P-M110f-install`  | Supply verified Muse Node OS/container cloud-init, enforce the funded teardown deadline, install and report readiness. No provider token is placed on the server.                                                                                                                 |
| `M117-P-M110d-pair`     | Pair through the authenticated node routes after installation; feed actual activity/leases to the portable lifecycle.                                                                                                                                                             |
| `M117-P-M110f-teardown` | Drive lifecycle sweeps continuously and after reconnect, independently enforce funded lifetime, wipe/revoke pairs before provider deletion, and reconcile deletion receipts and outstanding liabilities.                                                                          |
| `M117-P-U-W-surfaces`   | Bind price preview, each-server modal and idle Keep notice in the shared panel, companion/native hosts, ACP permission requests and CLI/TUI. Register only completed commands/features in featureCatalog; measure W's lazy chunk and all-editor/browser behavior.                 |
| `M117-P-W-gates`        | Full aggregate quality, integrated end-to-end flow, cross-rig checks and the existing C-owned import-count change's host-API record refresh.                                                                                                                                      |

All editors use the same core and injected ports: VS Code, JetBrains,
Visual Studio, Eclipse, Zed, Xcode, Neovim/Emacs/Sublime, ACP/headless and
CLI/TUI. Provisioning is advice-only when broker/install/pairing bindings
are absent. No command or reachable product feature is registered by P.

## Receipts

Tests, deliberate failures, exact restoration hashes, scoped gates and
hooked commit receipts will be recorded as each slice completes.

## Slice 1 guard-fire receipts

All 37 mutations ran both complete provider/start files on this rig, with
`--maxWorkers=3`, no skips/name filters/timeout override. Every mutation
exited 1 at its intended named assertion; each source restored byte-exact.
The first returned-ID drill initially passed because the shared schema
already rejected the slash-containing sample. Added dotted/colon aliases,
which the shared schema accepts and the adapter must refuse; replay fired.
No gate or production guard was weakened.

| Drill                       | Intended named failing regression                                                                                                  | Exit |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `P01-https`                 | M117 connected vault-brokered provider operations refuses unpinned origin http://provider.invalid                                  | 1    |
| `P02-pinned-origin`         | M117 connected vault-brokered provider operations refuses unpinned origin https://provider.invalid/path                            | 1    |
| `P03-billing`               | M117 connected vault-brokered provider operations refuses forbidden allow-list path /billing before any request                    | 1    |
| `P04-payment`               | M117 connected vault-brokered provider operations refuses forbidden allow-list path /payments before any request                   | 1    |
| `P05-signup`                | M117 connected vault-brokered provider operations refuses forbidden allow-list path /sign-up before any request                    | 1    |
| `P06-account`               | M117 connected vault-brokered provider operations refuses forbidden allow-list path /accounts before any request                   | 1    |
| `P07-canonical-path`        | M117 connected vault-brokered provider operations refuses noncanonical endpoint /servers/%62illing                                 | 1    |
| `P08-method`                | M117 connected vault-brokered provider operations requires every operation exactly once with its prescribed method                 | 1    |
| `P09-operation-count`       | M117 connected vault-brokered provider operations requires every operation exactly once with its prescribed method                 | 1    |
| `P10-operation-uniqueness`  | M117 connected vault-brokered provider operations refuses repeated operations even when the allow-list length is correct           | 1    |
| `P11-id-template`           | M117 connected vault-brokered provider operations requires the server ID as exactly one final status/delete segment                | 1    |
| `P12-connected-provider`    | M117 connected vault-brokered provider operations rechecks connection at every request and never reads a credential                | 1    |
| `P13-no-redirect`           | M117 connected vault-brokered provider operations exposes exactly five operations and pins the origin before broker dispatch       | 1    |
| `P14-response-origin`       | M117 connected vault-brokered provider operations refuses redirect or failed receipt 200 https://other.invalid/sizes               | 1    |
| `P15-http-status`           | M117 connected vault-brokered provider operations refuses redirect or failed receipt 401 https://estimator-provider.invalid/sizes  | 1    |
| `P16-size-schema`           | M117 connected vault-brokered provider operations suppresses raw broker errors and validates normalized response boundaries        | 1    |
| `P17-image-schema`          | M117 connected vault-brokered provider operations rejects malformed and duplicate sizes/images after the captured codec projection | 1    |
| `P18-size-uniqueness`       | M117 connected vault-brokered provider operations rejects malformed and duplicate sizes/images after the captured codec projection | 1    |
| `P19-image-uniqueness`      | M117 connected vault-brokered provider operations rejects malformed and duplicate sizes/images after the captured codec projection | 1    |
| `P20-create-size`           | M117 connected vault-brokered provider operations rejects wrong create identities, invalid states and empty installation data      | 1    |
| `P21-create-image`          | M117 connected vault-brokered provider operations rejects wrong create identities, invalid states and empty installation data      | 1    |
| `P22-create-state`          | M117 connected vault-brokered provider operations rejects wrong create identities, invalid states and empty installation data      | 1    |
| `P23-created-id`            | M117 connected vault-brokered provider operations rejects wrong create identities, invalid states and empty installation data      | 1    |
| `P24-cloud-init`            | M117 connected vault-brokered provider operations rejects wrong create identities, invalid states and empty installation data      | 1    |
| `P25-payment-fields`        | M117 connected vault-brokered provider operations never sends payment or account field payment_method                              | 1    |
| `P26-status-identity`       | M117 connected vault-brokered provider operations validates create, identity-matched status and deletion acceptance                | 1    |
| `P27-delete-acceptance`     | M117 connected vault-brokered provider operations validates create, identity-matched status and deletion acceptance                | 1    |
| `S01-first-wave`            | M117 first-wave dispatch under the playbook submits only resource-admitted first lanes, sorted small first, after the audit        | 1    |
| `S02-planned-only`          | M117 first-wave dispatch under the playbook never duplicates a running lane or dispatches its dependent before merge               | 1    |
| `S03-merged-dependencies`   | M117 first-wave dispatch under the playbook waits for merge evidence even when a running prerequisite has zero estimated remainder | 1    |
| `S04-contract-first`        | M117 first-wave dispatch under the playbook dispatches contracts first while other ready lanes wait                                | 1    |
| `S05-audit-allowed`         | M117 first-wave dispatch under the playbook refuses inconsistent or malformed audit results and audit failures                     | 1    |
| `S06-audit-missing`         | M117 first-wave dispatch under the playbook refuses inconsistent or malformed audit results and audit failures                     | 1    |
| `S07-claim-before-dispatch` | M117 first-wave dispatch under the playbook serializes concurrent starts and retains claims after uncertain dispatch               | 1    |
| `S08-known-capacity`        | M117 first-wave dispatch under the playbook refuses unknown capacity and malformed inputs without submitting                       | 1    |
| `O01-serialized-owner`      | M117 first-wave dispatch under the playbook serializes concurrent starts and retains claims after uncertain dispatch               | 1    |
| `O02-owner-recovers`        | M117 first-wave dispatch under the playbook serializes concurrent starts and retains claims after uncertain dispatch               | 1    |

Restoration hashes (identical before/after each mutation):

- `provider.ts`: `1ab15679262987c89b0aa4e11c333b3579e0923cc2096ae2816df521956dcf14`.
- `start.ts`: `b408d6cfcb15d93c73b7e59d55e0808faa00f4b8586368a40a9184217e1d6232`.
- `owner.ts`: `0733087a1664076e18fc10e19948f54ed71ffd77b25ddcbb8450cb68f5eb0f7e`.

Slice 1 post-drill green: **53/53** in provider, start and
fake-only estimator e2e files, repository default timeout. Earlier host/unit
typechecks passed; enabled commit hooks lint/format this slice. The e2e
resolves a fixture milestone through G, schedules it through S and submits
its audited contract wave before the next merged-prerequisite wave.

## Slice 2 receipts (C-M117-6, 2026-10-11, linuxlt)

Portable provisioning lifecycle in `src/core/estimator/provision/lifecycle.ts`
(`quoteProvisioning`, `EstimateProvisioner`), tested by
`test/unit/estimatorProvision.test.ts` (16 tests, fakes only, repository
default timeout). Behavior: exact nano-USD quotes per server
(`hourlyUsd × maxBilledHours`, `scaleUsdNanos`, never binary arithmetic)
with the batch total fixed before any confirmation; one confirmation per
spend through the injected callback, denied when it answers false or throws;
an explicit non-negative run budget with no default, enforced before any
provider request or confirmation; liability reserved before create and
retained on every uncertain outcome (failed create, failed install/pair,
failed wipe, unconfirmed deletion); install then pair through the injected
`EstimateNodePort`; idle `Keep` returning without touching the funded
lifetime; teardown answers rechecking activity first; wipe before provider
deletion with a `deleted` status receipt before liability release. No
timers, no provider network client, no payment field (the brokered create
path is covered by Slice 1's payment-field drills), no command, no UI, no
new string, no new dependency. Unknown servers refuse without touching the
provider. Rented provisioning stays advice-only behind `M117-P-M109-provider`
until the M109 broker and M110d/M110f bindings land (handoffs above
unchanged); no editor rows are owed by this lane — U/W bind the preview,
modal and notice surfaces later.

Slice 2 guard-fire drills (each mutation exits 1 at its named test; source
restored byte-exact, SHA-256 `d309a716e3f9b9640b104fb404f697a2532144031856b5c7ac371422b6ec86d9`
before and after; the first drill pass ran pre-lint and was repeated on the
final source after the lint fixes, and `L5` was fired a third time after its
stub became a `FakeEstimateProvider` subclass (exactly 1 failed, 15 passed,
same restore hash):

| Drill                            | Intended named failing regression                                  | Exit |
| -------------------------------- | ------------------------------------------------------------------ | ---- |
| `L1-no-unconfirmed-spend`        | denies without confirmation                                        | 1    |
| `L2-cap-never-refuses`           | refuses a server past the cap before any request or confirmation   | 1    |
| `L3-delete-before-wipe`          | wipes before provider deletion and requires the deleted receipt    | 1    |
| `L4-release-on-uncertain-create` | retains liability on an uncertain create                           | 1    |
| `L5-no-deletion-receipt`         | keeps liability when the status receipt never shows deleted        | 1    |
| `L6-keep-tears-down`             | keeps an idle server on Keep without extending its funded lifetime | 1    |
| `L7-no-batch-total`              | shows every price and the total before any confirmation            | 1    |

Billing/payment/sign-up/account endpoint refusal stays Slice 1's P03–P06
drills; the lifecycle's broker integration test provisions and
decommissions through the allow-listed broker. Gates for this slice:
`tsc` host and unit projects, `eslint --max-warnings=0`, `prettier --check`,
`check:l10n` (0 problems, no new keys), `npm run build` (exit 1 only on the
pre-existing `dist/webview` estimator panel OVER, 25.3 KiB vs 25 KiB on the
untouched base: the module has no production importer and none of its
strings appear in any bundle, so this lane adds zero bytes; cap changes are
the owner's call),
`knip`, `check:reference` and `check:host-api` unchanged, plus the
neighbour provider/start/fakes suites. Self review, one pass by class:
validation (zod batch/size/image/hours/cloudInit/budget boundaries),
security (cap before request, no credential or payment surface, errors name
only the operation), failure paths (deny, retain, refuse-unknown, all
covered above), concurrency/lifecycle (one `EstimateSerialOwner`,
clone-before-queue, no timers). Codex + Grok review remains lead-owned.

## RVCM1176 fixes (CM1176R2, 2026-10-11, linuxlt)

All six findings fixed, no residuals. One class: every outcome sequence
keeps the liability invariant (reserved before create; kept on every
uncertain outcome; released only on a deleted receipt for the torn-down
id; never released twice; never below zero), and every input feeding a
price or budget is validated before use. The review's outcome-sequence
table is now a table-driven suite (`outcome-sequence liability` in
`test/unit/estimatorProvision.test.ts`: 10 rows asserting `liabilityUsd`
and tracked-server count after each sequence, plus the single-case
regressions below). 32 tests, fakes only, repository default timeout
(no `--testTimeout`). No new dependency, no new l10n key (the honest
budget error reuses `estimateFailed` with a technical detail), no guard
widened, no `as` cast, no eslint-disable.

| Finding                            | Fix (`lifecycle.ts`)                                                                                                                                                                                                               | Regression test                                                                                                                                                            | Drill (guard broken → named failure, exit 1)                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P2 quote mutation (`:175`)         | `snapshotQuote`: the callback receives a frozen copy; `admit` reserves, creates and records the pre-confirmation values (`admit`, `provision`)                                                                                     | `hands the confirmation a frozen copy and spends the quoted values` (write attempts fail via `Reflect.set`; spend keeps `small`/`0.06`; copy + cost + size + image frozen) | R1 unfreeze: the named test fails                                                                                  |
| P2 duplicate create id (`:185`)    | `admit` refuses an already-tracked id with `duplicate-server-id`; the earlier record keeps its cost and the new reservation stays pending                                                                                          | `keeps both liabilities when create returns an already-tracked id` (liability `0.12`, one tracked server)                                                                  | R2 guard removed: the named test fails                                                                             |
| P2 re-entrant callback (`:168`)    | confirmations (`provision`) and the idle check (`settleIdle`) run without holding `EstimateSerialOwner`; each confirmed server is cap-checked and reserved atomically in `admit`, and teardown re-reads the record under the owner | `lets a confirmation tear down an earlier server without deadlocking` (deny-after-teardown leaves no servers, liability `0`)                                               | R3 confirm back under the lock: the named test times out at the repo default (5000 ms), the review's exact symptom |
| P3 foreign receipt (`:199`)        | `teardown` releases only on `state === 'deleted'` **and** `receipt.id` matching the torn-down server                                                                                                                               | `keeps the server on a foreign deletion receipt` + `status-foreign` table row (kept, liability `0.06`)                                                                     | R4 id check removed: the named test fails                                                                          |
| P3 sub-nano budget (`:149`)        | the constructor's precision failure throws `estimateFailed` with `budget-unrepresentable`, not the "no default" sentence                                                                                                           | `reports an unrepresentable budget honestly instead of "no default"`                                                                                                       | R5 second catch restored to `refusedBudget()`: the named test fails                                                |
| P3 install/pair retention (`:184`) | order kept (reserve → create → track → install → pair); the suite now covers the reviewer's named mutation                                                                                                                         | `install-throws` / `pair-throws` / `delete-throws` / `confirm-throws` table rows (all keep `0.06`; confirms keep `0`)                                                      | R6 `managed.set` moved after `pair`: both named rows fail                                                          |

Drill restores byte-exact: `lifecycle.ts` `ead9efa7836bdd5709c677e89c1e3f0285f31316fbda0d36da4221be9446bf28`
and `estimatorProvision.test.ts`
`50c23e84aa11f4e297877b23ada3ef00f92f9b762e917bd034fa29738172d0e6`
before and after every drill (R1–R6; R3's red run ends in the 5 s repo
timeout). Post-drill lint/type fixes touched both files again; final
hashes: `lifecycle.ts`
`fdf88c07bb4b8373070f2677cc7f0863753349a036d9310f7e805c68ebe424d3`,
`estimatorProvision.test.ts`
`c76f3eb24b73525068f14c0b35830210d7f2b94e0a90157adc5674877cb7e2de`.

Sweep for siblings: `settleIdle`'s activity check got the same
outside-the-lock treatment as the spend confirmation (it awaited
`isIdleNow` on the turn); the check now receives a copy of the server
record. `quoteProvisioning` inputs were already zod-validated
(size/image schemas, finite positive hours, non-empty cloud-init);
budget precision is the remaining price/budget input and is now
validated in the constructor. No other `managed.set` / `pending` /
receipt-release sites exist in the lane.

Planned call sites (review §"Planned call sites") are still a handoff:
no production importer of `lifecycle.ts` exists, so none of this is
reachable from Spin it up today. The callback contract the call sites
must keep is now enforced in code, not only prose: the quote cannot be
rewritten through the copy, and a callback may await `decommission` /
`settleIdle` on the same instance.

## RLM117 port note (2026-10-22, macbook, C-M117-6)

True merge onto `rec/rlm117`: `lifecycle.ts` added clean (no content
conflict; the implementation is unchanged from the branch). The suite is
rewritten, not carried: the branch's 16 fake-only tests (scripted provider,
`vi.fn` confirmations, spied-on methods) are replaced by 7 tests that run
the real core with tripwire ports — every provider/node method throws on
contact, so a test that touches a port fails loudly instead of proving a
double. Covered for real: exact nano-USD quotes and batch total, request
validation, representable-budget admission, cap refusal before any
confirmation, denial, the frozen confirmation copy, the confirmation text,
and unknown-server refusals. Not run (no provider exists to run them
against): create/install/pair/status/delete flows, idle-teardown execution
and decommission. Those wait for the M109 broker and the M110d/M110f
bindings, with live-provider drills; until then the core stays
advice-only behind `M117-P-M109-provider` and no surface calls it. The
never-pays drill holds for what exists: no spend path runs without a
per-spend confirmation under the hard cap, and the suite proves the cap
refuses before the question is asked. Never-creates-accounts holds
structurally: the core has no account, sign-up or payment path (accounts
stay with M108; payment fields stay refused in the broker).
