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
