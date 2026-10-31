# RLF-M109 — keystore owner, runtime migration binding, T5 measurement

Date: 2026-10-30. Host: macOS rig `macmini`. Worktree:
`/Users/randy/lanes/RLF-M109`, branch `rec/rlf-m109`.
Starting HEAD: `12bd07fc2` (RLM109 increments 2-4 merged over
int/recovery at `d057bf203`). Provider/model calls: 0. No real vault
or credential entry read; no keychain created.

Commits:

- `f311e718f` fix(keystore): one single-flight owner of secret reads
  per process
- `d4076e1fb` feat(vault): bind the key-store migration in the runtime
- `c9b148e06` fix(vault): name migration failures by kind in the
  runtime log

## 1. The reconciled keystore one-owner wrapper

`createSingleFlightSecretStore` (`src/host/auth/credentialStore.ts`):
concurrent reads of one entry share the one in-flight read; a settled
value or confirmed absence is remembered until `forget`. A failed read
is shared by its current waiters and never remembered (no retry, no
attempt count of ours; the store's error reaches every waiter
unchanged). Own writes update the remembered value; a failed write
forgets. Epochs are bumped when an entry is forgotten and when a
write starts and settles, so a read that started earlier cannot
remember an older value over newer state (the settle bump was added
in review here: without it, a read racing an in-flight write could
overwrite the just-written value with the pre-write read).

Composition: the window wraps SecretStorage under the migration shell
and forgets on the editor's change notice (`src/extension.ts`); the
runtime shares one owned store across its credential paths
(`src/runtime/main.ts`, providers account stores). The migration's
raw legacy port keeps reading the store directly in both hosts. A
provider's 401/403 to the key probe forgets exactly that entry,
decided from the answer's HTTP status only
(`noteKeyRejectedStatus`, wired in `providersCommands`' probe; the
probe outcome now carries the status). Boundary, recorded honestly:
engine-turn 401s deep in the transport have no (store, account, error)
choke point today, so rejection-forget fires at the probe; an
externally replaced key is otherwise picked up through the editor's
change notice (window) or the next process.

Proof: `test/unit/keystoreSingleFlight.test.ts` over the real
multipart keyring store and the real wrapper on a throwaway service
(remembered value/absence, one OS read for five concurrent reads,
corrupted-part failure not remembered, 401 forgets / 500 and no-status
keep). Windows-gated like `keyringParts` (this sandbox has no default
keychain), so hosted CI on Windows is its run; here it collects and
skips (3 skipped, exit 0). Cleanup shares
`test/unit/helpers/keyringCleanup.ts` with `keyringParts`.

## 2. The runtime key-store migration binding

`migrateKeyStore` (`src/runtime/vault/migrateKeyStore.ts`) had zero
callers. It is now the engine factory the shared controller runs in
the runtime: `CredentialMigrationController` gained an optional
`createMigration` dep (absent, the window's SecretStorage port is
used exactly as before). The binding lives in its own lazy chunk,
`dist/vaultRuntimeMigration.js` (`src/runtime/vault/vaultRuntimeMigrationEntry.ts`,
60.2 KiB measured, budget 70 KiB per the measured-plus-15% rule),
loaded by `dist/vaultRuntime.js` (24.4/25 KiB) on the first unlock
edge only, shipped in the ACP package and the VSIX. Providers are
listed from the person's providers file through its real reader (a
missing file configures none; a damaged one narrows the run and says
so), pooled accounts through the file-backed pool — RLM109's
`listAccounts` seam. The runtime process's secrets moved behind the
migration shell over the single-flight owner (the shell's `forget`
now forwards to the wrapped owner), so writes mirror and retired
slots read from the vault in CLI/ACP/headless exactly as in the
window. Unlock edges: the vault command port awaits the migration
after unlock, confirmed setup and recovery (one-shot processes exit
otherwise); while serving, the broker watch's lock transition fires
it. The shared `credentialMigrationPorts` composition replaces the
three copies (window entry, runtime entry, test driver).

Proof: a pooled-slot drive through the real binding, the real files
and the real broker in both broker suites
(`chatgptSubscriptionMigration.test.ts`,
`credentialMigrationStore.test.ts`, driver `driveRuntimeSlotCase`):
the slot migrates only if the binding lists the provider from the
user file and the account from the pool, then copies/verifies,
rotates through the shell, survives lock/unlock and signs out with a
quiet log. Both suites skip in this sandbox by their own guards
(`/bin/ps` denied, 148-byte TMPDIR over the 103-byte socket limit, no
default keychain — the RLM109 walls); hosted CI on macOS, Windows
and Linux is their run. Existing pure suites here:
`credentialMigration` and `migrationCodecRoundTrip` green (17
passed). Two gates fired red then green during the build-out: the
lazy registry refused the new chunk until the VSIX carried it, and
the split gate listed the new chunk's record schemas until both
migration chunks' declared exceptions (and the subscription leaf's)
were recorded.

## 3. T5, the engine secret-use consumer: measured blockers

Nothing of T5 shipped; shipping its wiring today would be dead code
that degrades an honest refusal. Measured state (file:line at this
lane's HEAD):

- `VaultExecService` is constructed nowhere; no `VaultExecHostPort`
  implementation exists; no `vault:` dep at any `createToolIo` site
  (`src/extension.ts`, `src/runtime/main.ts` setup hooks,
  `src/runtime/backends.ts`), so the engine's shell tool refuses
  `secrets` with the broker sentence (`src/core/backends/modelapi/tools.ts:1901`).
- `ExecVaultSession` (`src/runtime/vault/execVault.ts:28`) exposes
  only `close()`; `HeadlessVaultSession.request` has no call site.
  runExec opens the session and closes it unused.
- The installed broker refuses agent use three times over, by
  recorded design (`src/runtime/vault/brokerBindings.ts:403-415`,
  "T/X/S/O transport owners supply provenance and execution before
  agent use is enabled"): `ceiling: () => 'none'` denies every use in
  policy (`evaluateVaultPolicy`, `src/core/vault/broker/policy.ts:148`),
  the channel's `taint` rejects before any request is evaluated
  (`src/core/vault/broker/channel.ts:221`), and `perform` rejects
  after redemption (`channel.ts:280`). None has a recorded owner
  design to build against: the channel ignores the proposal's taint
  and asks its own dep (`channel.ts:223-232`), no wire route reports
  session provenance to the broker process, and `VaultTaintSession`
  (`src/core/vault/taint.ts`) is constructed nowhere; no record maps
  a requester to a ceiling; and the channel awaits `perform` on the
  requester's socket before it answers a redemption
  (`channel.ts:289-291`), with no private material frame kinds for
  redemption and no finish message on the wire.
- No feeder redemption transport is designed in the record: the
  feeder (`dist/vaultExec.js`, lane X) does not exist, and how a
  ticket becomes material in the feeder — feeder peer authentication
  against the ticket's requester, private material frames, lifetime
  close/terminate on lock or revoke — has no wire shape. D89.4 has
  the feeder prove the ticket to the broker itself, but redemption
  admission binds a ticket to its registration incarnation token by
  object identity (`src/core/vault/broker/state.ts`, `case 'redeem'`),
  which only the registering connection holds; no rule yet admits a
  feeder's own connection. PLAN §9 records the same state:
  "installed agent T/X/S/O execution, lifetime and trusted
  provenance owners remain absent and explicitly refused." Lane
  primitives exist (envelope/schema/feeder core in
  `src/core/vault/exec/**`, `spawnVaultFeeder` in
  `src/host/vault/vaultExecSpawn.ts`, `redeemVaultExecLease` in
  `src/core/vault/exec/brokerLease.ts`, the scrubber, the helper
  server), but their composition across the broker boundary is the
  undesigned part.

Options for the owner/lead:

1. Design lanes T and X first (provenance owner, ceiling owner,
   feeder redemption transport with feeder authentication), then
   build the consumer on top. Safest; matches PLAN's lane order
   (X after B, T after B, R after X).
2. Sequence a reduced first slice inside option 1: environment/stdin
   uses only (no git/askpass/sudo/SSH), headless-first. Still needs
   the redemption transport and the taint/ceiling owners; it only
   defers the helper/SSH surfaces.
3. Host-side redemption without a feeder process (the harness host
   receives material and feeds the command itself). Contradicts
   D89.4's feeder (the one way a brokered value reaches a child) and
   widens the host's secret surface; not recommended.

Recommendation: option 1, with option 2 as its first increment. The
consumer wiring this brief named (headless and ACP host ports,
runExec → agent → backend → tool IO, feeder packaging) is the last
step of that stack, not the first; building it now would ship a
`vault_run` that can only fail later and less honestly than today's
refusal.

Open owner questions (unchanged from RLM109): the undo trigger,
vault-reset restoration of retired slots, and the companion vault
surface. Add for T5: who owns feeder peer authentication (broker
peer identity plus command-tree membership, per the helper server's
`authenticate` contract), and whether the feeder registers as its
own requester with delegated tickets or redeems through the host's
registration.

## Gates on the final tree (this rig)

Exit codes are recorded in the lane's final message. Known base
state, measured on the untouched starting HEAD by swapping this
lane's files out and re-running: the production build's eight
over-budget bundles (reportInputs, reportingPanel, resourceGovernor,
resourceAdmission, modelApi, vaultActions, estimateContracts, wire)
are byte-identical with and without this lane's changes;
`providersProbe`'s first case times out at 5 s on base and branch
alike under this rig's load; vault broker suites skip or fail at
base under the sandbox walls above (RLM109's name-for-name list).
This lane adds no bundle overage: `dist/vaultRuntime.js` 24.4/25 KiB,
`dist/vaultRuntimeMigration.js` 60.2/70 KiB, `dist/vaultMigration.js`
43.9/45 KiB. SAST runs as
`SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`.

## 6. Resume 2026-10-30 (macmini): D243 first increment

The lead decided T5 (PLAN.md D243, recorded before building): lanes T
and X, first increment environment/stdin headless; host-side
redemption rejected. Commits: `da8145a66` (D243 + §9),
`19c1227d5` (broker owners: provenance frame, person ceiling,
delegated redemption, ancestry), `e324aa9a7` (feeder
`dist/vaultExec.js`, delegated client, policy chunk), `37276df60`
(headless consumer wiring + suites), `f02ffa674` (catch narrowing),
`e3af2b1d9` (headless exec stack in `dist/vaultExecHost.js`), plus
this record's commit.

**Proven locally on real parts.** The compiled POSIX helper's new
`parent` mode, run directly in a shell whose parent is the rig app:
`identity <shell-pid>` → `{"processId":36998,...,"executable":"/bin/bash"}`,
`parent <shell-pid>` → the app's pid with its start time, both exit 0. Governed identity probes in-process (governor configured, helper
compiled by the suite): `vaultProcessIdentity` and
`vaultParentIdentity` returned this process and its parent exactly.
Pure suites, green: vaultPersonPolicy (2 — default none, per-workspace
and per-role matching, damaged-file refusal, owner-only modes),
vaultExecEnvelopeDigest (2 — host/feeder digest agreement across the
JSON round trip, separation by command and env names),
vaultHeadlessDeny (3, unchanged expectations), policy (21),
vaultExecSpawn (2). The packed darwin-x64 ACP tarball lists
`package/dist/vaultExec.js`, `vaultExecHost.js` and `vaultPolicy.js`;
through the packed binary, `vault policy` printed `{"ceilings":[]}`
with exit 0 under a fresh HOME (no broker opened — the first-run
order). The built feeder bundle, spawned with a non-envelope on fd 3,
exited 1 with stdout empty and stderr exactly `vault-exec-refused`.

**Not run here; the named next proof.** The real broker/feeder suite
(`test/unit/vault/vaultExecDelegated.test.ts`: ceiling refusals in
words, env/stdin runs with the value's length only, scrubbed echo,
foreign-identity refusal, tainted denial, requester-socket redemption
denial, lock termination) skips on macmini through
`shouldSkipPosixBrokerSuite()`. The blocks, all measured on this rig:
(1) `/bin/ps` execution is `Operation not permitted` from every
process in this sandbox, so darwin exact process birth is
unavailable and any VaultStore writer refuses — the fixture broker
(and `brokerSession.test.ts`) fails identically (4 failed) at base
`640d52371` with `TMPDIR=/tmp`; (2) `security create-keychain` is
refused, so no login keychain exists under the sandbox HOME. No shim
or workaround was built for either, per the lane rules; the suite is
written to run where process listing works (capable rigs, hosted
CI), composing the product's file anchor and OS-store slot so it
needs no keychain even there. Until that run is recorded green, the
agent secret-use path is built and type/lint/build-proven but NOT
real-life proven; README and CHANGELOG say what ships, and this
record carries the proof status.

**Gates, this resume.** Full typecheck (all five projects) green;
eslint/prettier clean on every touched file; `check:l10n` green (two
new keys in all fifteen tables); `check:reference` green;
bundle-split and lazy-registry green; production build: the same
eight over-budget bundles as at base, no new one — new bundles
`dist/vaultExec.js` 127.8/150 KiB, `dist/vaultExecHost.js` 66.3/80 KiB,
`dist/vaultPolicy.js` 7.0/25 KiB, and `dist/vaultRuntime.js` fell
from 24.4 to 21.2/25 KiB with the session's move; the exact-byte
budgets for `dist/vaultBroker.js` (194,124 bytes measured) and
`dist/vaultBrokerBindings.js` (39,796 bytes) moved with the measured
bytes plus the standing 15%, reasons in scripts/check-bundle-size.mjs
and PLAN.md D6. `check:catches` is red at base `640d52371` too
(measured in a clean worktree: identical pre-existing site/count
rises, e.g. judge); this resume's new code adds zero SWALLOW/GENERIC
over that base and three CLEANUP sites with reason comments
(feeder-lease close on socket death, delegation-failure settle,
feeder main refusal); the baseline was NOT regenerated. `check:plan`
is red at base (PLAN.md 3,730,693 bytes before this resume, over the
3,565,158 hygiene bound); archiving closed history is lead-scale
editorial work and was not folded into this lane. SAST, accessibility
and the hosted suites are the lead's gates as before.
