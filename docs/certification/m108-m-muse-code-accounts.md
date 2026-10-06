# M108 M — Muse Code accounts

Worktree `/Users/randy/lanes/M108M`, branch `m108/m`, base `291fc547a`,
macmini, 2026-10-06. Read the rig brief, shared `codex/common.md`, AGENTS,
PLAN D88 and M108 in full, Q-M108, the terms research, lane-0 policy source
checks and K/T/P certification before editing. No live/paid call, credential
read, dependency, push, merge or rebase is authorized for this lane.

## Implementation plan and capture boundary

D88.8 and acceptance 9 require Muse Code accounts to remain unavailable
without Q-M108's config-home capture. No such capture is present on this
base. Build and certify the core with fakes; do not claim live support.
The existing M8 capture (`docs/certification/m8.md`, `scratchpad/live-m8.log`,
workspace `C:\muse-live-ws`, four counted model attempts) supplies the
`usage/changed` shape. No new vendor wire shape is inferred.

- Add the editor-independent, capture-gated account-home owner at the
  lane-owned `src/core/backends/musecode/accountHomes.ts`.
- Require host-owned capture evidence for the exact CLI version/platform,
  and a private-directory adapter before returning a usable home. Copy only
  the non-secret configuration explicitly selected from the capture's list.
- Bind a manager to one immutable home. Set `XDG_CONFIG_HOME` after all
  environment settings, strip credential/auth-path overrides for isolated
  accounts, and give terminal sign-in the same environment as serve. Leave
  the existing manager path unchanged when no account home is supplied.
- Attribute parsed usage only to the home that received it; adapt captured
  `window` and `weekly` into T's local limits snapshots, preserving the raw
  subscription row and percentages above 100 for display. Refuse stale
  lifecycle callbacks and out-of-order usage.
- Present the existing Meta subscription row and upgrade/wait/PAYG recovery
  before pooling. PAYG uses a separate injected D48 consent and shared-budget
  admission port; no key or Model API client enters the CLI path.
- Prove every new guard with named red drills and byte-exact restoration.
  Run scoped tests using the repository default timeout and all required
  static/build checks directly here, then commit with normal hooks.

## Named integration handoffs

- **M-Q108-CAPTURE (owner/W):** capture a second home signing in and serving
  on each enabled platform, with CLI build, workspace, counted attempts and
  settings/hooks/skills/MCP/memory relocation facts. Only then supply the
  host-owned capture port. The current shipped path supplies no evidence.
- **M-W-PRIVATE-HOME:** bind owner-only storage to extension global storage
  (runtime: the private profile directory), reject symlinks/junction escapes,
  and enforce POSIX permissions or Windows owner-only ACLs. The core awaits
  this adapter and propagates refusal; no pretend filesystem implementation.
- **M-W-CONFIG-COPY:** provide a capture-derived non-secret configuration
  exporter, reading only the user's selected categories. Never copy auth
  files, tokens, settings secrets or credential-bearing MCP/hook values.
- **M-U-H-LIFETIME:** create one home/manager per account, bind terminal
  launch behind the normal workspace startup fence, and invalidate leases
  before removal/logout. Bind the same core through every editor's bridge,
  ACP and runtime; no VS Code-only account UI is introduced here.
- **M-P-RECOVERY-PAYG:** offer the subscription's recovery first, then P's
  policy gate. Bind PAYG to the user's selected Model API account, its tariff,
  D48's three-choice consent and unchanged daily/conversation budget. Never
  route a Model API credential into a Muse Code process.
- **M-W-DOCS-BUNDLE-HELP:** W owns README/CHANGELOG/PLAN, bundles, manifest and
  reference generation. Document the gated account feature and recovery in
  those files during integration. `featureCatalog.ts` is absent on this base;
  list the feature for W rather than editing another lane's files. Keep the
  account owner lazy; type-only imports in existing startup modules must not
  pull it into activation. No cap increase or new UI chunk is needed here.

## Implemented behavior and editor parity

`MuseCodeAccountHomes` requires local evidence for the exact CLI build and
platform before preparing any account. Each additional account lives at
`<storage>/muse-code-accounts/<provider>/<account>`. The migrated `default`
has no override: its existing environment and CLI sign-in remain unchanged.
The account lease is immutable and fenced by capture, membership and removal
generation. One owner per provider/profile must be shared by every surface;
W must invalidate it synchronously before removal/logout and dispose the
account's managers. K's capture block stays in force until that composition.

Private-home and selected-configuration adapters are awaited, and errors
propagate. The selection is copied before the first await; only categories
listed by the capture are eligible, and nothing is copied by default. These
are required ports, not fake or empty-success production implementations.
No credential value is accepted by an account-home or terminal API.

The manager accepts one immutable home, pins its XDG home after settings,
and strips inherited/configured `*_API_KEY`, hook-forbidden credential names
and the POSIX launcher's `MUSE_AUTH_PATH` override for additional accounts.
The default path preserves D1. Terminal login uses the same builder, a direct
CLI command with `['login']`, and `strictEnv: true`; the terminal port applies
the normal workspace startup fence and the supplied final lease check.
Revocation is checked for cached hosts and after asynchronous initialization;
a revoked initialized process is closed. The fake two-account turn demonstrates
separate processes/environments and usage attribution.

Parsed `usage/changed` and `usage/read` observations go only to that host's
account. The raw subscription row retains tier, observed time, duration and
percentages above 100. T's normalized windows are named `window` and `weekly`
from the existing capture; percentages clamp only in the normalized snapshot.
A full window blocks admission even without a user threshold, until the
latest active full-window reset. Missing configured windows refuse admission;
invalid times/percentages and old observations cannot replace a valid row.
Consumers get a copy of the raw row.

Recovery presents the existing `meta/muse-code` policy row and upgrade/wait/
PAYG choices before P's confirmation. A PAYG port exists only while its stored
Model API key is available. The selected billing identity, tariff and exact
bigint daily budget are snapshotted before the recovery question; only those
four fields cross into the consent/dispatch ports. D48 consent precedes the
shared daily/conversation admission transaction, which owns reservation
cleanup and settlement. Final authority is checked inside that transaction
before Model API dispatch. Deny, unavailable/stale accounts, malformed choices
or budget refusal spend nothing. No stored Model API key reaches a CLI process.

Every editor can bind this core: VS Code/native/companion through U's bridge,
ACP and terminal through H's runtime ports. No new VS Code API, setting,
command, user-visible string or UI was introduced; all words reuse lane 0's
translated table. W must list isolated Muse Code accounts, plan thresholds,
subscription policy/recovery and account-bound PAYG consent in its help
reference and documentation. No platform or editor is claimed live-certified.

## Regression reds and test-harness corrections

The initial launch tests failed on wrong XDG home, inherited credentials and
missing revocation fences. Host/manager regressions failed on unbound usage
and stale accounts; selection-mutation and extra billing-field regressions
failed before their fixes. The first manager regression red reached the legacy
credential-structure probe before the new guard existed; that was a test-harness
oversight. The tests now stub the probe and native refusal spawns, and every
actual child is the test-owned fake CLI with a fixture config home. No
credential value was shown, copied or stored and no live Muse/model call ran.
The fake initialized-host wrapper was corrected to preserve the SDK class
prototype and return the SDK's exit receipt; its close runs in `finally`.

## Executed guard drills

All 62 deliberate mutations ran the complete owning test file without a
test-name filter, skip or raised test timeout. Each exited 1 with a named
assertion failure. Saved bytes were restored in `finally`; byte comparison
and SHA-256 matched after every run. The table names a failing assertion per
mutation (some mutations also fail other assertions). Logs and the runner
were temporary and are removed before final delivery.

- `src/core/backends/musecode/accountHomes.ts` restored SHA-256: `5b0f34b7fbd3e1951c24020241f3f5a2e9569a6e51fca7ad9889dddc43669366`.
- `src/core/backends/musecode/launch.ts` restored SHA-256: `82f4b06e6469933612f87ee0f9fad5599c1a66f1c14b828d3d48b48c52c05f75`.
- `src/host/backend/museCodeBackendManager.ts` restored SHA-256: `5e2aa978f6564338832241fa9a71d2a6144f2f6e18a260f3b0d812692d61c66f`.
- `src/core/backends/musecode/MuseCodeHost.ts` restored SHA-256: `833ccda091a01686a07bf1156d7c3a8869d1418b5c172a94d55d65c476dfb798`.

| Drill                        | Named failing assertion                                                                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capture-absent`             | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > stays unavailable without the config-home capture and explains why                                                  |
| `capture-version`            | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses unsupported or malformed capture evidence 0                                                                 |
| `capture-platform`           | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses unsupported or malformed capture evidence 1                                                                 |
| `capture-extra-fields`       | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses unsupported or malformed capture evidence 3                                                                 |
| `capture-reference`          | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses unsupported or malformed capture evidence 2                                                                 |
| `capture-config-category`    | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses unsupported or malformed capture evidence 4                                                                 |
| `provider-id`                | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > rejects malformed configured provider and account identities before folder I/O                                      |
| `account-id`                 | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > rejects malformed configured provider and account identities before folder I/O                                      |
| `account-membership`         | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses invalid or absent account unknown before I/O                                                                |
| `selection-allowlist`        | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > copies only the selected captured non-secret configuration                                                          |
| `selection-snapshot`         | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > freezes selected configuration before asynchronous directory preparation                                            |
| `default-selection`          | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > preserves the migrated default sign-in and environment without creating or copying a home                           |
| `absolute-storage`           | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses relative storage roots and propagates a private-folder refusal                                              |
| `default-home`               | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > preserves the migrated default sign-in and environment without creating or copying a home                           |
| `owner-only-folder`          | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > uses a distinct owner-only home for each account and copies nothing by default                                      |
| `home-generation`            | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > invalidates an in-flight home when the account is removed and re-added                                              |
| `capture-generation`         | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > rechecks capture and membership after asynchronous configuration copying                                            |
| `after-folder-fence`         | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > invalidates an in-flight home when the account is removed and re-added                                              |
| `after-copy-fence`           | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > rechecks capture and membership after asynchronous configuration copying                                            |
| `immutable-home`             | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > uses a distinct owner-only home for each account and copies nothing by default                                      |
| `terminal-home-owner`        | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses a stale or foreign terminal home before sign-in                                                             |
| `terminal-platform`          | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > refuses a stale or foreign terminal home before sign-in                                                             |
| `terminal-replacement-env`   | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > runs terminal sign-in with the same home and no inherited credential overrides                                      |
| `observed-integer`           | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses unusable subscription observation 1 without replacing the last row                                 |
| `observed-date`              | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses unusable subscription observation 2 without replacing the last row                                 |
| `observed-future`            | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses unusable subscription observation 0 without replacing the last row                                 |
| `observation-clock`          | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses invalid clocks and stops enforcing full windows once their captured resets pass                    |
| `window-duration`            | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses unusable subscription observation 3 without replacing the last row                                 |
| `negative-window`            | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses unusable subscription observation 4 without replacing the last row                                 |
| `reset-integer`              | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses unusable subscription observation 6 without replacing the last row                                 |
| `reset-date`                 | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses unusable subscription observation 7 without replacing the last row                                 |
| `observation-order`          | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > ignores out-of-order usage and refuses invalid or post-invalidation observations                           |
| `usage-account`              | test/unit/accountHomes.test.ts > M108 Muse Code isolated account homes > preserves the migrated default sign-in and environment without creating or copying a home                           |
| `subscription-copy`          | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > does not expose mutable subscription data to consumers                                                     |
| `limits-provider`            | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > attributes usage to its home, preserves the subscription row and trips both thresholds                     |
| `limits-clock`               | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses invalid clocks and stops enforcing full windows once their captured resets pass                    |
| `full-window-stop`           | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > keeps percentages above 100 for display while enforcing the latest full-window reset                       |
| `expired-window`             | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > refuses invalid clocks and stops enforcing full windows once their captured resets pass                    |
| `latest-window-reset`        | test/unit/accountHomes.test.ts > M108 captured subscription windows per account > keeps percentages above 100 for display while enforcing the latest full-window reset                       |
| `policy-present`             | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > refuses recovery when the researched subscription policy is absent                                                   |
| `recovery-choice`            | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > refuses an unknown recovery choice before spending                                                                   |
| `paid-binding-snapshot`      | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > keeps the account and tariff shown before the recovery choice immutable through dispatch                             |
| `paid-metadata-only`         | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > carries only billing metadata across the PAYG consent port                                                           |
| `paid-available`             | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > does not offer PAYG without the stored-key path and refuses a forged choice                                          |
| `paid-pre-question-fence`    | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > refuses a removed PAYG account before asking for paid consent                                                        |
| `paid-consent-denial`        | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > refuses paid dispatch on denial, stale account or exhausted shared budget                                            |
| `paid-post-consent-fence`    | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > rechecks account authority after paid consent before budget admission                                                |
| `paid-dispatch-fence`        | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > refuses paid dispatch on denial, stale account or exhausted shared budget                                            |
| `paid-budget`                | test/unit/accountHomes.test.ts > M108 Muse Code subscription recovery > offers the researched subscription row and recovery before a separate D48 PAYG question                              |
| `launch-home-fence`          | test/unit/launch.test.ts > buildChildEnvironment > pins the linux account home after settings and removes inherited credentials                                                              |
| `launch-home-override`       | test/unit/launch.test.ts > buildChildEnvironment > pins the linux account home after settings and removes inherited credentials                                                              |
| `launch-api-keys`            | test/unit/launch.test.ts > buildChildEnvironment > pins the linux account home after settings and removes inherited credentials                                                              |
| `launch-other-credentials`   | test/unit/launch.test.ts > buildChildEnvironment > pins the linux account home after settings and removes inherited credentials                                                              |
| `launch-auth-path`           | test/unit/launch.test.ts > buildChildEnvironment > pins the linux account home after settings and removes inherited credentials                                                              |
| `manager-home-binding`       | test/unit/museCodeBackendManager.test.ts > MuseCodeBackendManager: immutable account launch (M108) > uses one account home for serve and credential inspection, ignoring account overrides   |
| `manager-initialize-fence`   | test/unit/museCodeBackendManager.test.ts > MuseCodeBackendManager: immutable account launch (M108) > closes a fake CLI whose account is revoked during initialization                        |
| `manager-cached-fence`       | test/unit/museCodeBackendManager.test.ts > MuseCodeBackendManager: immutable account launch (M108) > serves two accounts in separate fake CLI processes with their own environment and usage |
| `manager-usage-binding`      | test/unit/museCodeBackendManager.test.ts > MuseCodeBackendManager: immutable account launch (M108) > serves two accounts in separate fake CLI processes with their own environment and usage |
| `notification-account-fence` | test/unit/MuseCodeHost.test.ts > MuseCodeHost: subscription usage (M8) > refuses revoked account observations before notifying usage listeners                                               |
| `notification-account-usage` | test/unit/MuseCodeHost.test.ts > MuseCodeHost: subscription usage (M8) > attributes parsed usage/changed and usage/read only to the serving account                                          |
| `read-account-fence`         | test/unit/MuseCodeHost.test.ts > MuseCodeHost: subscription usage (M8) > refuses revoked account observations before notifying usage listeners                                               |
| `read-account-usage`         | test/unit/MuseCodeHost.test.ts > MuseCodeHost: subscription usage (M8) > attributes parsed usage/changed and usage/read only to the serving account                                          |

## Delivery boundary

No source or shared-file region owned by another lane was changed. README,
CHANGELOG, PLAN, manifest/reference/bundle wiring and real capture adapters
remain the named W/U/H/K/P integration handoffs above. Q-M108's sign-in/serve/
configuration relocation capture is still absent: shipped multi-account
Muse Code remains off. Preparing a home without evidence refuses with
`accounts.museCodeUnavailable`.
The full quality/coverage, live capture, native editor and release gates belong
to the lead under the explicit bounded rig brief; no gate or budget is weakened.

## Initial commit verification

Direct macmini checks, repository default timeout throughout:

- `npx vitest run test/unit/accountHomes.test.ts test/unit/launch.test.ts test/unit/museCodeBackendManager.test.ts --maxWorkers=3`: exit 0, **98 tests**.
- `npx vitest run test/unit/MuseCodeHost.test.ts --maxWorkers=3`: exit 0, **98 tests**. **196 tests total**.
- `npm run typecheck`: exit 0, all five projects after correcting the fake SDK close receipt.
- Changed-file ESLint `--max-warnings=0`: exit 0, nine TypeScript files, no suppression/cast/any added.
- Changed-file Prettier check and `git diff --check`: exit 0.
- **62 guard drills**: named failures, exit 1, byte-exact restoration and SHA-256 parity.

Remaining required bounded-lane static/build receipts are recorded below when
complete. The explicit rig brief forbids the full quality/unit suite here;
the lead owns that gate. Existing thresholds, rules, hooks and budgets stay
unchanged. `.husky/_/pre-commit` existed before this first local commit.

## Final bounded-lane checks and build

All commands ran directly on macmini; every test run used the repository's
default timeout, at most three complete files, and no test-name filter.

| Check                                                 | Result                                                                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Four owning test files                                | Exit 0, **196 tests** (50 home/recovery, 26 launch, 22 manager, 98 host).                                                                                                     |
| `npm run typecheck`                                   | Exit 0, all five projects.                                                                                                                                                    |
| Changed-source ESLint / Prettier / `git diff --check` | Exit 0, no new escape hatch.                                                                                                                                                  |
| `npm run deadcode`                                    | Exit 0; only existing vendor/axe-core configuration hints.                                                                                                                    |
| `npx jscpd`                                           | Exit 0, **1,191 files, zero clones**, unchanged zero threshold. The first run caught duplicated native-refusal test setup; one shared test-only throwing function removes it. |
| `node scripts/check-l10n.mjs`                         | Exit 0; **14 tables, 164 manifest strings, 607 source files, zero problems**. No new strings.                                                                                 |
| `npm run check:host-api`                              | Exit 1: record-only count drift, no boundary violations. See the W-owned handoff below.                                                                                       |
| `npm run build`                                       | Exit 0: all budgets, split guards, host-global checks and **83-package notices** pass.                                                                                        |
| Guard drills                                          | **62 distinct named red drills**, exact-byte/SHA-256 restoration. Four manager drills repeated after removing duplicated test setup, then all 22 manager tests pass again.    |
| Implementation commit                                 | `c578d50b`, hooks on: nine TS files pass lint-staged ESLint/Prettier, staged gitleaks reports **zero leaks**.                                                                 |

Production sizes: activation **441.0/600 KiB**, Model API **450.1/475 KiB**,
ACP **819.3/850 KiB**, checkpoint **76.9/225 KiB**, webview startup including
static imports **897.3/900 KiB**, deferred webview JS **49.7/50 KiB**.
No cap changes. Metafile inspection confirms **zero production bundles**
include `accountHomes.ts`: existing modules import its port only as a type.
W must bind the owner/recovery into M95's lazy providers factory, install the
caller's language table before use, measure that bundle and retain its split
guard. This core is not falsely advertised as an installed feature.

### M-W-HOST-API — record-only integration handoff

`docs/ide-compatibility/host-api.md` belongs to W, and the lane brief forbids
editing another lane's files. The exact required record changes are:

- `node:crypto`: **46 → 47** importers. This is inherited: a read-only AST
  import inventory of base `291fc547a` using the gate's import-node rules
  confirms 47 crypto importers and 84 path importers.
- `node:path`: **84 → 85** importers, from the new account-home path builder.

The check reports **332 VS Code APIs, 31 vscode importers, 25 Node built-ins
and 61 theme variables**, with one record-drift problem. There is no new
VS Code API or forbidden portable import. W's concrete resume action is
`npm run check:host-api -- --write`, review those two count rows, then run
`npm run check:host-api`. W must record this bounded-lane deferral in PLAN §7
when integrating its owned documentation; this lane does not weaken the gate
or edit the record to conceal the drift.

Q-M108 capture and W's bindings remain required before enabling the feature.
There was no install, live/paid call, merge, rebase or push. Temporary drill
logs, runners and receipts are removed inside this worktree at final cleanup.
The normal commit hook's own backup stash was automatic; no manual stash ran.
