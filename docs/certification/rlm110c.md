# RLM110C certification: M110c-h ready cores

Lane RLM110C, 2026-10-22, rig `macmini`, branch `rec/rlm110c`, base
main at 0.19.0 (`f3941b85`). Recovery lane: nothing for M110c-h
existed on base; this lane wrote orchestrator/remote reach/sign-in/
servers/local models/team mode as ready cores with real tests. The
per-phase threat model is `rlm110c-threat-model.md`; the independent
review of lanes X, A and F is `rlm110c-review-xaf.md`.

Scope: this lane owns `src/core/devices/*`, `src/runtime/node/**`,
`src/webview/node/**`, `deploy/**` and its new tests and fixtures.
It reuses M96c's `orderMergeQueue`, M109's vault concepts and M95's
provider legs, and leaves the node server, pair transport, sign-in
lifetimes and CLIs to lanes N, M100, A1 and the CLI lanes. Nothing
here is wired to a command yet.

## What landed

- M110d X2 (pairing security): `src/core/devices/{identity,sas,
sequence,revocation,rotation,invitation}.ts` on real `node:crypto`
  (Ed25519, HKDF-SHA256 SAS, hash-chained MACed revocation,
  rotation overlap, single-use invitations).
- M110d X1/F3/G (remote reach): `src/runtime/node/relay/
{protocol,server,client}.ts` (opaque length-prefixed frames,
  first-wins registration, latched reader, flushing refusals,
  tracked/drained sockets, keepalive, operator-only ceilings),
  `src/core/devices/routes/select.ts` (explicit local-range
  allowlist), `src/core/devices/brokeredUse.ts` (credential-free
  envelope), `src/runtime/node/seal.ts` (sealed-at-boot unseal
  grants, KEK wrap), `src/runtime/node/attach/{policy,handshake}.ts`
  (remote-session gate, `fs/*` denied to ACP sessions).
- M110c (orchestrator): `src/runtime/node/roles/orchestrator.ts`
  (worker registry, duty planning over M96c's queue),
  `src/runtime/node/modelRelay.ts` (credential-free relay envelope,
  idempotent payer ledger), `src/webview/node/team/TeamPage.tsx` and
  `src/webview/node/nodes/NodesPage.tsx` with the 15-table l10n
  block `nodeTeam`.
- M110e (sign-in): `src/runtime/node/auth/{passwords,totp,
recoveryCodes,oidc,proxySignin}.ts` (scrypt N=32768/r=8/p=1,
  RFC 6238 vectors, single-use hashed recovery codes, OIDC with
  PKCE S256, proxy trust by socket and name) and
  `src/runtime/node/acme/{challenge,certificate,secureContext,
pwaManifest}.ts` (RFC 8557 authorizations, live-certificate
  install check, secure-context and manifest checks), with the
  recorded fixture `test/fixtures/node-acme/
example-com-2026-10-22.pem`.
- M110f (servers/ops): `deploy/cloud-init/muse-node.yml`,
  `deploy/helm/muse-node/` (restricted PSS), `deploy/proxmox/
muse-node.conf`, `deploy/install/verify-node-install.mjs` and
  `src/runtime/node/ops/{backup,upgrade,retention,clock,wipe,
metrics}.ts`.
- M110g (local models): `deploy/compose/models/ollama-{cpu,cuda,
rocm}.yml` (pinned Ollama 0.40.8 / 0.40.8-rocm, verified against
  the registry on 2026-10-22), `src/runtime/node/models/loopback.ts`
  (loopback guard) and `src/runtime/node/models/detect.ts`
  (spawn-free backend detection; this rig classifies CPU).
- M110h (team mode): `src/runtime/node/team/{roles,namespaces,
budgets}.ts` (role matrix, per-person scoping, whole-cent
  budgets, grow-only audit, terms admit gate).

## Test suites (repo-default timeout, no overrides)

| Suite                                 | Tests | Result |
| ------------------------------------- | ----: | ------ |
| test/unit/nodePairingSecurity.test.ts |    10 | pass   |
| test/unit/nodeRelay.test.ts           |     5 | pass   |
| test/unit/nodeRemoteReach.test.ts     |     4 | pass   |
| test/unit/nodeOrchestrator.test.ts    |     5 | pass   |
| test/unit/nodeTeamPages.test.tsx      |     4 | pass   |
| test/unit/nodeSignin.test.ts          |    10 | pass   |
| test/unit/nodeOps.test.ts             |     7 | pass   |
| test/unit/nodeInstallVerify.test.mjs  |     3 | pass   |
| test/unit/nodeModels.test.ts          |     3 | pass   |
| test/unit/nodeTeamMode.test.ts        |     6 | pass   |

57 tests, all green, run as `npx vitest run <files>
--maxWorkers=3` with at most 3 files per run.

## Red/green drills

Each of the 10 suites was broken on purpose (a small mutation in
its own core), run to red, reverted, and run to green, under the
strict harness: RED counts only when the output contains `failed`,
GREEN only when it does not. Every drill went RED-OK then
GREEN-OK and every revert was verified clean (`git status` /
targeted diff). One loose-harness false GREEN on the pages drill
was caught and re-verified strictly before acceptance.

## Gates

- `npm run quality:gates`: exit 1 at `test:unit` — 22 files / 58
  tests failed of 853 files / 23,357 tests in 1,620 s on this
  shared rig. Every gate before it passed: format, lint,
  typecheck (all 5 projects), badges, tokens, l10n, reference,
  host-api, plan, roadmap, catches, usable-reply,
  wrap-up-request, no-output-cap, no-round-cap,
  workflow-scripts, deadcode, cycles, duplication. The
  failed-file list was not captured (output piped through
  `tail`); the visible failures were vault POSIX
  process-timing tests. The full suite is beyond the recovery
  gate (touched suites + `related`, below); hosted CI is its
  gate. Reported as red, as run.
- `node scripts/check-l10n.mjs`: exit 0, 0 problems.
- `npm run check:plan`: exit 0, 0 drift (`recovery (RLM110C)`
  phrase registered in `statusPhrases.ts`).
- `npm run check:roadmap`, `check:reference`: exit 0, current.
- `npm run check:host-api`: exit 0 (regenerated once for the new
  `node:*` imports).
- `npm run check:catches`: exit 0, all sites match the baseline
  (OpenSSL/GCM brand guards, no new GENERIC).
- `npm run build`: exit 0, every budget holds. (A re-run after
  the a11y suites first failed exit 1 on `dist/traffic-harness/*`
  left in the ignored `dist/` by the a11y harness runs; removed
  as regenerable tool output, re-run exit 0.)
- `npm run security:audit`: exit 0 (4 advisories, 2 recorded
  exceptions).
- `npm run security:sast`: first run exit 1 with one blocking
  finding in this lane's `src/runtime/node/seal.ts`
  (`createDecipheriv` without an explicit GCM tag length).
  Fixed with `{ authTagLength: GCM_TAG_BYTES }`, mirroring
  `src/core/vault/crypto.ts`; the seal suite stays green.
  Re-run exit 0: 0 findings on 544 rules / 4,045 files.
- `gitleaks git --pre-commit --staged --redact --no-banner`: no
  leaks found (two standard-vector fingerprints ignored with
  justification in `.gitleaksignore`).
- `npm run security:secrets` (full history): exit 1 with 2
  findings, both `generic-api-key` in base-history commit
  `1cbebd98c` (vault key-store migration tests). A
  base-history-only scan reports the identical 2; this lane
  adds none.
- `npm run test:legal-a11y`: exit 1 identically on this tree
  and on a built base clone (12 pseudo-locale pages without a
  result, `Dropped malformed host message` at `isFastEnabled`).
- `npm run test:a11y`: exit 1 on this tree (2 rules on 629
  elements, 138 pages without a result) and on the built base
  (the same 2 rules — `color-contrast`,
  `label-content-name-mismatch` — on 663 elements, 129 without
  a result). No scene references this lane's pages. Both a11y
  gates are merge/release-only per AGENTS.md, outside the
  recovery gate list; reported as red, as run.

## Blast-radius measurement (untouched base f3941b854)

`npx vitest related --run --maxWorkers=3` over every changed
source file: the lane's own batches resolve to the 10 new
suites, all green (57/57). The shared batch (`en.ts`,
`statusPhrases.ts`, the installer verifier) ran 728 files:
695 passed, 14 failed (45 tests), none of them lane files.
Each failing file was run on a clean base clone and, where it
diverged, again on this tree in the same small batching:

- Fail identically on the untouched base (10): crashMarker,
  macRss (`/bin/ps` is blocked in this sandbox — the run's own
  `ps` answers `Operation not permitted`), resourceCreatedSweep,
  scheduleFireFailures, treeSyncNoDeadline, treesLifecycleNative,
  vault/brokerSocketDirectory,
  vault/credentialMigrationStore (the OS process-birth check
  fails in this sandbox), vault/writerCrashPosix,
  vsixCompression (the pinned `zopfli` is not installed here).
- Pass identically in small batches on both trees (4):
  estimatorSnapshotStrict, noLimitsInput, planReader (the
  lane's PLAN.md addition is exonerated: 88/88 pass on this
  tree), uploadLedgerTwoProcess (3/3 on this tree alone).

No failure is caused by this lane's change. Per-file logs are
in the worktree's ignored `temp/` (`rlm110c-related-shared.log`,
`rlm110c-base-b[1-5].log`, `rlm110c-lane-l[12].log`).

## What waits (not buildable in this lane)

The owner's server and domain (public listener, relay, ACME);
Meta's terms decision Q-M110 (enforced by the admit gate);
the owner's key ceremony (artifact signatures, OTA); the
person's OIDC provider choice; lanes N, T, M100, M104e, M95,
M96c task rows, M107, M108, M109, M110b lane K, A1, A2 and the
channel transport; qualification on real hosts. Full list per
phase in `rlm110c-threat-model.md`.

## Commits

Recorded in the lane's final message; this file commits with
the lane's closing change.
