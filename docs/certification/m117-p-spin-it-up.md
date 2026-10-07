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

## Slice 2 implementation and inspection

`EstimateProvisionRun` seals connected-provider selections, shows the full
quote before each fresh boolean confirmation, atomically admits all positive
liabilities under the explicit run cap and reserves before create. Decimal
hourly rates, sums and billed durations use exact fractions; only display
rounds up to nano-USD. Funded durations floor exact milliseconds. A lost or
malformed create retains liability and stops further creates; a known returned
identity remains available in its uncertain outcome. Failed install/pairing
is cleaned up through the lifecycle; unconfirmed cleanup stays visible.

`EstimateServerLifecycle` tracks provider-scoped identities, activity,
funded expiry and deletion receipts. Busy work gets no idle notice. Every
activity invalidates the notice generation. Wipe completes before deletion;
pending/failed deletion is reconciled without repeating a successful wipe.
Keep postpones idle cleanup, while expiry still binds. Inspection found that
awaiting a notice inside the shared owner could block a future expiry sweep.
The notice now waits outside that owner, then re-enters with its generation;
retirement invalidates late replies. A dedicated unanswered-notice/expiry
regression and a late-Keep/explicit-retire regression protect both paths.
M110f must drive expiry events independently while a notice is pending;
a sequential loop that waits for a user's answer before scheduling the next
sweep is not an acceptable binding.

The expanded pre-drill budget/lifecycle suites passed 40/40; the next two
concurrency/boundary regressions are included in final verification below.
All five TypeScript projects passed on this rig. Exact final post-drill and
post-hook receipts follow. No CLI test-timeout override is used.

The M96/M116 start binding must also enforce M110/M100's verified input/base
manifest and hook environment, fresh worker leases and acknowledged outcome
receipts (gotchas G1/G2/G5/G6/G14/G15/G19/G27). P submits IDs through the
frozen port and never fabricates their absent worker transport. Base-age and
account-headroom estimate disclosures remain G/U/W's ownership (G4/G25).

Verification orchestration correction: an early unit typecheck and scoped
ESLint accidentally overlapped while a yielded process was still running.
Both completed; subsequent heavy commands and the final verification pipeline
run sequentially. No concurrency setting, hook, gate, timeout or cap was altered.

The unchanged duplication gate initially found eleven clones in clocks,
receipt identity checks and fixture setup. One shared injected clock and one
receipt validator remove the core duplication; test-only scenario builders
remove repeated setup/assertions. Final duplication reports **zero clones
across 1,226 files**. No ignore or threshold changed. New helpers are all used;
there is no production fake or default success.

The first floating-sum mutation fired at sub-nano liability and extreme-price
regressions, rather than the intended decimal-sum tie: the old 0.01 + 0.02 +
0.03 example happens to sum to the same binary value. Added the independent
0.1 + 0.1 + 0.1 cap-equality case without changing product coverage; replay
must fail that named sum regression before this drill certifies.

Two further test-development corrections were exposed by deliberate breaks:
0.07 hours floors to the same integer with binary multiplication, so the
lifetime test also pins 0.29 hours (exactly 1,044,000 ms; binary floor loses
one millisecond). An obsolete queued no-op in the preview mock masked its
mutation callback; removing that no-op makes the preview-copy drill fail.
These strengthened the witnesses without changing the production guards.

The service's repeated created-state check did not independently fire:
the mandatory `EstimateServerLifecycle.track` already refused that state
before registration/install. The service now delegates that check to the
single authoritative lifecycle guard; L15 breaks it and must fail the
inactive-tracking regression. No valid state, cap, consent or endpoint policy
is broadened. Each deliberate mutation still restores its original bytes;
the record below retains both run-module hashes across this structural
consolidation.

## Slice 2 guard-fire receipts

All 63 mutations ran complete provider, budget and lifecycle files, at most
three files per command, `--maxWorkers=3`, repository timeouts, no filters
or skips. Each exited 1 at the named regression and restored source bytes
with matching SHA-256. L18 reinstates the old lock-holding notice loop; the
unanswered-notice expiry and late-Keep/retire regressions fail at the default
5-second timeout. No timeout override or delayed sleep is retained.

| Drill                       | Intended named failing regression                                                                                                                | Exit |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `P28-size-bound`            | M117 connected vault-brokered provider operations bounds provider selection arrays before use                                                    | 1    |
| `P29-image-bound`           | M117 connected vault-brokered provider operations bounds provider selection arrays before use                                                    | 1    |
| `P30-broker-receipt`        | M117 connected vault-brokered provider operations requires a complete integer-status broker receipt before decoding its body                     | 1    |
| `B01-budget-required`       | M117 exact confirmed run-budget provisioning requires an explicit valid budget undefined before reading a provider                               | 1    |
| `B02-provider-unique`       | M117 exact confirmed run-budget provisioning refuses duplicate providers and catalog selections before creation                                  | 1    |
| `B03-node-bindings`         | M117 exact confirmed run-budget provisioning keeps missing node bindings advice-only and refuses unknown providers                               | 1    |
| `B04-provider-connected`    | M117 exact confirmed run-budget provisioning keeps missing node bindings advice-only and refuses unknown providers                               | 1    |
| `B05-request-unique`        | M117 exact confirmed run-budget provisioning refuses bad selections, duplicate requests and incompatible images                                  | 1    |
| `B06-request-bound`         | M117 exact confirmed run-budget provisioning bounds quote requests and rejects empty or malformed inputs before catalog reads                    | 1    |
| `B07-request-required`      | M117 exact confirmed run-budget provisioning bounds quote requests and rejects empty or malformed inputs before catalog reads                    | 1    |
| `B08-catalog-boundary`      | M117 exact confirmed run-budget provisioning requires a valid captured projection, valid image, explicit boolean consent and nonempty cloud-init | 1    |
| `B09-selection-unique`      | M117 exact confirmed run-budget provisioning refuses duplicate providers and catalog selections before creation                                  | 1    |
| `B10-known-selection`       | M117 exact confirmed run-budget provisioning requires a valid captured projection, valid image, explicit boolean consent and nonempty cloud-init | 1    |
| `B11-image-affinity`        | M117 exact confirmed run-budget provisioning refuses bad selections, duplicate requests and incompatible images                                  | 1    |
| `B12-price-finite`          | M117 exact confirmed run-budget provisioning refuses an unrepresentable price, total or lifetime rather than displaying an infinite quote        | 1    |
| `B13-total-finite`          | M117 exact confirmed run-budget provisioning refuses an unrepresentable price, total or lifetime rather than displaying an infinite quote        | 1    |
| `B14-exact-charge`          | M117 exact confirmed run-budget provisioning admits exact decimal equality without binary floating-point overrun                                 | 1    |
| `B15-exact-total`           | M117 exact confirmed run-budget provisioning admits exact decimal equality without binary floating-point overrun (sums)                          | 1    |
| `B16-exact-lifetime`        | M117 exact confirmed run-budget provisioning funds decimal lifetimes exactly and floors fractional milliseconds without extending the charge     | 1    |
| `B17-funded-duration`       | M117 exact confirmed run-budget provisioning funds decimal lifetimes exactly and floors fractional milliseconds without extending the charge     | 1    |
| `B18-fresh-quote`           | M117 exact confirmed run-budget provisioning serializes concurrent executions, reserves before create and refuses reuse of a consumed quote      | 1    |
| `B19-hard-cap`              | M117 exact confirmed run-budget provisioning refuses a run over its cap before any execution request or popup                                    | 1    |
| `B20-price-preview`         | M117 exact confirmed run-budget provisioning shows each price and the whole total before separate server confirmations and ordered install/pair  | 1    |
| `B21-server-consent`        | M117 exact confirmed run-budget provisioning denial creates nothing and cannot become a remembered grant for another server                      | 1    |
| `B22-boolean-consent`       | M117 exact confirmed run-budget provisioning requires a valid captured projection, valid image, explicit boolean consent and nonempty cloud-init | 1    |
| `B23-sealed-quote`          | M117 exact confirmed run-budget provisioning clones quotes, prices and consent payloads so a popup cannot change the authorized spend            | 1    |
| `B24-copied-preview`        | M117 exact confirmed run-budget provisioning clones quotes, prices and consent payloads so a popup cannot change the authorized spend            | 1    |
| `B25-copied-consent`        | M117 exact confirmed run-budget provisioning clones quotes, prices and consent payloads so a popup cannot change the authorized spend            | 1    |
| `B26-funded-deadline`       | M117 exact confirmed run-budget provisioning refuses an unrepresentable price, total or lifetime rather than displaying an infinite quote        | 1    |
| `B27-cloud-init`            | M117 exact confirmed run-budget provisioning does not create when expired fails or outlives funding                                              | 1    |
| `B28-reserve-before-create` | M117 exact confirmed run-budget provisioning retains an uncertain create reservation and never retries or spends past it                         | 1    |
| `B29-created-size`          | M117 exact confirmed run-budget provisioning rejects malformed or mismatched created servers and retains their uncertain liability               | 1    |
| `B30-created-image`         | M117 exact confirmed run-budget provisioning rejects malformed or mismatched created servers and retains their uncertain liability               | 1    |
| `B32-installed-identity`    | M117 exact confirmed run-budget provisioning does not pair a node until its status proves the created identity is running                        | 1    |
| `B33-installed-size`        | M117 exact confirmed run-budget provisioning does not pair a node until its status proves the created identity is running                        | 1    |
| `B34-installed-image`       | M117 exact confirmed run-budget provisioning does not pair a node until its status proves the created identity is running                        | 1    |
| `B35-installed-state`       | M117 exact confirmed run-budget provisioning does not pair a node until its status proves the created identity is running                        | 1    |
| `B36-create-expiry`         | M117 exact confirmed run-budget provisioning cleans up when creation, installation or pairing outlives the funded deadline                       | 1    |
| `B37-install-expiry`        | M117 exact confirmed run-budget provisioning cleans up when creation, installation or pairing outlives the funded deadline                       | 1    |
| `B38-pair-expiry`           | M117 exact confirmed run-budget provisioning cleans up when creation, installation or pairing outlives the funded deadline                       | 1    |
| `B39-failed-setup-cleanup`  | M117 exact confirmed run-budget provisioning wipes and deletes failed installation/pairing, retaining admitted liability                         | 1    |
| `B40-copied-outcomes`       | M117 idle Keep and funded-lifetime teardown returns copied lifecycle and run outcome snapshots                                                   | 1    |
| `L01-idle-floor`            | M117 idle Keep and funded-lifetime teardown waits thirty idle minutes, shows notice, then wipes before confirmed deletion                        | 1    |
| `L02-busy-work`             | M117 idle Keep and funded-lifetime teardown never idles out busy work and cancels a stale notice after new activity                              | 1    |
| `L03-keep`                  | M117 idle Keep and funded-lifetime teardown Keep postpones idle teardown, then the next idle interval asks again                                 | 1    |
| `L04-funded-expiry`         | M117 idle Keep and funded-lifetime teardown Keep never extends the funded deadline, even for a busy server                                       | 1    |
| `L05-stale-notice`          | M117 idle Keep and funded-lifetime teardown new idle activity invalidates a pending notice even when the worker has already finished             | 1    |
| `L06-retire-generation`     | M117 idle Keep and funded-lifetime teardown a late Keep cannot reactivate a server explicitly retired while the notice was open                  | 1    |
| `L07-notice-failure`        | M117 idle Keep and funded-lifetime teardown failed notice grants no idle deletion while expiry still enforces teardown                           | 1    |
| `L08-expiry-after-notice`   | M117 idle Keep and funded-lifetime teardown funded expiry still binds while Keep or a failed notice is awaiting its answer                       | 1    |
| `L09-wipe-before-delete`    | M117 idle Keep and funded-lifetime teardown waits thirty idle minutes, shows notice, then wipes before confirmed deletion                        | 1    |
| `L10-wipe-once`             | M117 idle Keep and funded-lifetime teardown keeps deletion failure visible and reconciles lost replies without a second wipe                     | 1    |
| `L11-deleted-identity`      | M117 idle Keep and funded-lifetime teardown refuses a deletion receipt belonging to a different server                                           | 1    |
| `L12-confirmed-deletion`    | M117 idle Keep and funded-lifetime teardown refuses wrong deletion receipts and never declares a live server deleted                             | 1    |
| `L13-server-unique`         | M117 idle Keep and funded-lifetime teardown refuses duplicate server tracking, invalid activity and backward clocks                              | 1    |
| `L14-expiry-boundary`       | M117 idle Keep and funded-lifetime teardown refuses inactive tracking, malformed expiry and unknown cleanup without provider requests            | 1    |
| `L15-valid-created-state`   | M117 idle Keep and funded-lifetime teardown refuses inactive tracking, malformed expiry and unknown cleanup without provider requests            | 1    |
| `L16-copied-leases`         | M117 idle Keep and funded-lifetime teardown returns copied lifecycle and run outcome snapshots                                                   | 1    |
| `L17-activity-boundary`     | M117 idle Keep and funded-lifetime teardown refuses malformed activity without changing the lease or postponing idle teardown                    | 1    |
| `L18-notice-owns-no-lock`   | M117 idle Keep and funded-lifetime teardown expires a server through a new sweep while its Keep notice is still unanswered                       | 1    |
| `C01-monotonic-time`        | M117 exact confirmed run-budget provisioning refuses backward or invalid injected time before a create request                                   | 1    |
| `C02-integer-time`          | M117 exact confirmed run-budget provisioning refuses invalid injected epoch milliseconds 0.5 before dispatch                                     | 1    |
| `C03-date-range`            | M117 exact confirmed run-budget provisioning refuses invalid injected epoch milliseconds 8900000000000000 before dispatch                        | 1    |

Restoration hashes, each verified before and after its applicable mutations:

- `provider.ts`: `1ab15679262987c89b0aa4e11c333b3579e0923cc2096ae2816df521956dcf14`.
- `run.ts`: `7c195c7aabb379d03a60ea597efabc9f19f8a9f6e664d26663901ce981a35213`.
- `run.ts`: `e5066fca283574cbcae4dbb0be2c8bb0739793b8c565577a15dd3136ccb995ee`.
- `lifecycle.ts`: `b09e118530a6a53bf039317cb24c6e405e484756493f66af16ec9cab1653f661`.
- `clock.ts`: `6d86f89ff2dfd33903777d4407b3d416c9872a9b730ea13f3ba63e1be9a6cda3`.

## Final scoped verification (MacBook Pro)

All final commands ran directly in this worktree, sequentially, on the final
source. Owning files only, at most three per Vitest run, `--maxWorkers=3`,
repository default timeout, no skips or name filters. **106/106 tests**:
45 provider, 8 first-wave, 2 fake e2e, 33 run-budget and 18 lifecycle.
All **100** deliberate failures fired at their named assertions; all
restorations matched SHA-256. No model, paid, provider network, credential
store or cloud resource was used. No package/tool was installed.

| Check                                  | Result                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Provider/start/fake e2e                | 55/55 passed, exit 0                                                             |
| Run-budget/lifecycle                   | 51/51 passed, exit 0                                                             |
| `npm run typecheck`                    | All five projects pass                                                           |
| Scoped ESLint                          | Exit 0, zero warnings, all 13 TypeScript paths                                   |
| Scoped Prettier and `git diff --check` | Exit 0                                                                           |
| `npm run deadcode`                     | Exit 0; existing vendor/axe-core configuration hints only                        |
| `npx jscpd`                            | Exit 0; zero clones across 1,226 files                                           |
| `node scripts/check-l10n.mjs`          | 14 tables, 166 manifest strings, 626 source files, zero problems                 |
| `npm run check:reference`              | Current: 53 features, 44 commands, 59 settings, 26 slash, 116 CLI                |
| `npm run check:host-api`               | Exit 1: inherited C-owned five import-count increments below; W refresh required |
| `npm run build`                        | Exit 0: all unchanged size/split/host-global/notices checks; 83 packages         |

The host-API record's only drift is its existing Node import table:
`node:buffer` **39→40**, `node:crypto` **46→47**, `node:fs` **33→34**,
`node:fs/promises` **47→48**, `node:path` **84→85**. The scanner still finds
332 VS Code APIs, 31 VS Code import files, 25 Node built-ins and 61 theme
variables. P adds no Node built-in or VS Code import. W owns
`docs/ide-compatibility/host-api.md`; it must regenerate/review that file and
run the integrated gate. This is the existing `M117-W-host-api-record`, also
listed in `M117-P-W-gates` and PLAN §7, rather than a claimed green result.

Measured production budgets, KiB (single sample, rounded to 0.1): activation
**439.5/600**, Model API **446.9/475**, checkpoint **76.9/225**, ACP
**821.4/850**, shared English **55.0/125**, webview startup **797.1/900**,
deferred webview JS **50.0/50**. All caps remain unchanged. P has no shipped
entry here; these measurements do not certify W's future estimator chunk.

No new command, setting or reachable product feature is registered by P.
W retains README/PRIVACY/SECURITY/CHANGELOG, featureCatalog/help registration,
all-editor/modal/browser verification and the full aggregate quality gate
(the shared brief prohibits running aggregate quality in this lane).

## Planning status and next slice

P's portable core and fake acceptance/drills are complete. The M117 checklist
marks the fake-provider/cap/operation-restriction flow and P's named waiting
bindings complete; the full milestone remains pending integration. Next:
U/W integrates P's ports and surfaces, binds M96/M116 for audited live starts,
then M109 plus M110d/M110f for captured provider traffic, verified all-in
billing/deadline enforcement, install/pair and wipe/deletion receipts.
Until those bind, rentals remain advice-only. W refreshes the inherited host
record, updates product docs/reference, measures the lazy budgets and runs
full/cross-rig/editor gates. No owner decision is defaulted beyond those
explicitly written in D97 and this lane brief.

Source/test commit and hook receipts follow; documentation-only receipts do
not invalidate the final code hashes or require repeating unchanged tests.
