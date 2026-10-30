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
