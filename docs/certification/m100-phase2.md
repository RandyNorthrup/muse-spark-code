# M100 phase 2 — certification record (per-lane entries)

2026-10-07, kubuntu rig, worktree `/home/randy/lanes/FIXM100P2L0`,
branch `m100/p2-l0-fix`. Lane W completes this file on the joined tree
(README, PRIVACY, SECURITY, qualification); each lane appends its own
section with gate results and test-fire proofs. No live model calls in
any lane-0 entry: model attempts **0**, inference spend **0**.

## Lane 0 fix (RVM100P2L0): six findings made structural

Base `2d2292cc7`; review `/home/randy/lanes/_ctx/codex/RVM100P2L0.report.md`.
Every finding below is enforced from the shared contract alone
(`src/shared/devices.ts`, `src/shared/constants.ts`), with a regression
test in `test/unit/devicePhase2Contracts.test.ts` that fails on the base.

- P2 capability byte cap: `deviceCapabilitySchema` carries a refine on the
  serialized size (`src/shared/devices.ts`), so a field-valid advertisement
  past `capabilityBytes` refuses to parse. Test `refuses a field-valid
advertisement that serializes past the byte cap` builds the maximum
  advertisement (64 tools at `labelChars`, 16 engines at `modelIdChars`,
  `transportResets` at `Number.MAX_SAFE_INTEGER`, 10920 bytes): it fails
  when the refine is removed and when `capabilityBytes` is raised.
- P2 unread queue caps: `canAddOwner`, `canAddGrant` and `canQueueResultAck`
  export the `ownersPerDevice` (4), `grantsPerOwner` (16) and
  `pendingResultAcks` (256) bounds for lanes K and R to call. The queue-cap
  tests lock each literal and each boundary, and fail when a cap is removed
  or changed.
- P2 grant ceiling: `DEVICE_GRANT_MODE_ORDER` (`plan < manual < acceptEdits
< auto`, deliberately not `PERMISSION_MODES` order) and
  `grantCeilingRefusal` refuse a grant wider than the sender's ceiling in
  mode or in any of the six quota fields with the typed `scope-denied`
  refusal. The sample grant port calls it. Tests cover mode, each quota
  field, and the port's `scope-denied`.
- P2 threat model: `docs/certification/m100-threat-model.md` carries a
  threat table naming stolen pair key, malicious paired device, replay,
  downgrade, resource exhaustion and the D101 reconcile, each with its
  mitigation, owning lane and planned test. The owning test parses the
  table and requires a lane and a test file per threat, not substrings.
- P3 jitter: `handshakeBackoffMs` takes an injected random source
  (`Math.random` by default) and removes up to `handshakeBackoffJitter`
  (0.25) of the nominal delay, never above the nominal delay or the cap.
  Tests use fixed sources (`() => 0`, `() => 0.5`, `() => 1`).
- P3 epoch-bound acknowledgement: `isAckForEnvelope` settles one
  (epoch, digest) pair; the sample result port dedupes on
  `epoch:digest` and returns the envelope's epoch. The test publishes an
  epoch-2 envelope beside an epoch-1 ack and requires a fresh accept.

### Test-fire proof (base `2d2292cc7`, new test file copied over, rig run)

`npx vitest run test/unit/devicePhase2Contracts.test.ts --maxWorkers=3`:
9 failed, 26 passed. Every new or reworked test fails; every pre-existing
test passes. Failing: the jitter test (`handshakeBackoffJitter`
undefined), the capability refusal (`expected true to be false`), both
queue-cap tests (`canAddOwner is not a function`), both ceiling tests plus
the widened-grant port case, the epoch-ack case, and the threat-table
case (no table on base). On the fixed tree the same file is 35 passed.

### Verification (fresh clone `/tmp/fixm100-verify`, `npm ci`, `CI=true`, default timeouts)

- `npx vitest run test/unit/devicePhase2Contracts.test.ts --maxWorkers=3`
  three times: 35 passed each time.
- `npm run typecheck` (host, webview, unit, e2e, integration): clean.
- `npm run lint:js` (full tree, `--max-warnings=0`): clean.
- `npx prettier --check` on every changed file: clean.
- Plain `knip`: exit 0 (two pre-existing configuration hints only).
- `jscpd`: 0 clones.
- `npm run check:reference`: current (53 features, Devices reference
  18 entries). `node scripts/check-l10n.mjs`: 14 tables, 0 problems.
  `node scripts/check-host-api.mjs`: 0 problems.

## Base integration — M100P2BASE (macmini, 2026-10-07)

Worktree `/Users/randy/lanes/M100P2BASE`, branch `m100/p2-int`.
Release base `9d1ab33c3` (0.15.0); authorized merge
`git merge --no-ff 23c67925f` (phase 1, phase-2 plan/contracts and lane-0
review repairs). No other branch is merged. Version remains 0.15.0;
Devices remains unshipped. Model attempts **0**, inference spend **0**.

### Conflicts (19 files)

| Files                                                                                                               | Resolution                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHANGELOG.md`                                                                                                      | Preserve release history and existing Unreleased fixes; place all incoming Devices entries under Unreleased.                                                              |
| `PLAN.md`                                                                                                           | Preserve both branches' phase-2 plan, gate records, escape-hatch register and residual-risk records.                                                                      |
| `docs/orchestration-gotchas.md`                                                                                     | Retain every release rule/id, including G29–G33; add incoming channel, Windows host and auth rules as G34–G36 to avoid duplicate ids.                                     |
| `knip.jsonc`, `package.json`                                                                                        | Union entry inventories, retain the release's compiler/quality/reference scripts, add both Devices cycle entries.                                                         |
| `scripts/build.mjs`, `scripts/check-bundle-split.mjs`, `scripts/lib/deferredBundles.mjs`, `scripts/package-acp.mjs` | Keep every release bundle, lazy mapping and text guard; add Devices with its inherited independent budgets. Existing caps are unchanged.                                  |
| `scripts/gen-reference.mjs`                                                                                         | Run the complete release reference generator, the incoming Devices inventory and the release sharing inventory together.                                                  |
| `src/shared/l10n/en.ts`                                                                                             | Union English keys; all 14 translated tables merge automatically with both branches' keys and values.                                                                     |
| `src/shared/modelsPanel.ts`                                                                                         | Retain complete provider/team/traffic boundaries; move the strict Devices region into `src/shared/devicesPanel.ts` so unrelated validators stay outside its lazy closure. |
| `scripts/lib/harnessServer.mjs`, `test/harness/index.html`                                                          | Retain every release scenario and fake-host handler, add Devices scenes, sizing and request/reply handling.                                                               |
| `test/unit/bundleSize.test.mjs`, `test/unit/deferredBundles.test.ts`, `test/unit/webviewBundles.test.mjs`           | Retain release tests/setup and add the incoming Devices budget, build entry and Windows-separator closure assertion.                                                      |
| `docs/ide-compatibility/host-api.md`, `src/shared/reference/reference.generated.ts`                                 | Regenerate with `npm run check:host-api -- --write` and `npm run reference:generate`; no hand-edited generated output.                                                    |

### Verification scope

The rig brief explicitly requires the full unit/process-e2e suite with coverage
and all four CI shard memberships, overriding common.md's owning-files-only
limit. Heavy commands run serially on macmini. Test execution retains the
rig's maximum three files/workers per invocation and repository timeouts;
partial coverage maps are merged once with the unchanged global thresholds.
No test filter, skip, global timeout override, gate waiver or paid/live call
is introduced. Fresh-clone commands/results and exact counts follow after
verification; this initial merge record does not claim those gates passed.

### Initial integration regressions

All five compiler projects passed. The first complete three-file run
(`devicePhase2Contracts.test.ts`, `deferredBundles.test.ts`,
`webviewBundles.test.mjs`) reported **124 passed, 2 failed**. The phase-2
register assertion found six G29/G30/G31 rows because the release already
used those ids. Preserve those release ids and assign the incoming rules
G34/G35/G36, updating their plan, threat model, comments and test references.
The legal cap drill's green control failed because its synthetic browser
metafile omitted Devices; add that exact entry beside its existing Models
and Usage fixtures. No assertion, gate, budget or deadline is removed.
The localization gate also caught the automatically merged duplicate
`check:reference` package script; retain the release's single script.

The completed legal fixture then exposed the real Devices bundle cap:
**105.8/100 KiB**, because the shared Models panel loaded provider/team
validator construction with Devices. A new independent-boundary assertion
was deliberately run against that combined implementation: **2 failed,
78 passed** in the full deferred-bundle file (boundary assertion and cap).
Move the Devices region, without changing its schemas, into
`src/shared/devicesPanel.ts`; update its consumers and the guarded lazy
inventory. The final complete three-file run is **127 passed**, including
both inherited cap/global red/restored drills and the new separation check.
The real production build passes every unchanged size/split/global/notices
gate: Devices **80.7/100 KiB**, activation **462.8/600 KiB**, Model API
**456.0/475 KiB**, chat startup **735.8/900 KiB**, original deferred JS
**31.9/50 KiB**. `.husky/_/pre-commit` exists before the merge commit.

### First fresh-clone static run and release-head lint repair

Committed merge `1b24c700f`, fresh clone
`/var/folders/r2/xm1s2y_x67zg6lz1kr7x8f2h0000gp/T/m100p2base-ci-45gdvk6h/repo`,
`CI=true`, `npm ci` (exit 0). All five typechecks, full Prettier,
plain knip, duplication (zero clones), cycles (866 files, zero cycles),
reference, localization, host API and production build passed.
Full JavaScript lint found the release-head conditional spread at
`scripts/check-badges.mjs:37` (`unicorn/consistent-conditional-object-spread`).
Use a logical conditional spread while preserving the job-token header's
GitHub-only binding. The complete fake-only `checkBadges.test.mjs` passes
**40 tests** at repository deadlines, including token/no-token and image-host
boundary checks. No HTTP request is added by this repair or its tests.
Final verification starts from another fresh clone of the repair commit.

### Deliberate independent-panel drill

Temporarily add a side-effect import of `./modelsPanel` to the Devices
boundary. The full `deferredBundles.test.ts` file fails its new independent
boundary assertion and its unchanged size gate: **2 failed, 78 passed**.
Restore source byte-exact, then run the complete deferred/phase-2 contract
files together: **115 passed** at repository deadlines. The cap/global
artifact drills inside the deferred file also verify byte-exact restoration.

Source `src/shared/devicesPanel.ts` before/after SHA-256: `4a672cc45df36ee29d203d758e0dabe39d337c815951f0ff2e33b6a33b2abbbb`
(equal); red exit 1, restored exit 0.
