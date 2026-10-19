# Lane VAULTPARITY — certification record

Branch starts at PR #216 (ms/msm109). Outcome: the vault stores, reads and
brokers credentials on Windows, macOS and Linux the same way.

## Parity survey (2026-10-18, lane start; `now` = surveyed, `after` = this lane)

- Windows broker channel — now: `startVaultBrokerProcess`
  ([brokerProcess.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/brokerProcess.ts))
  and `createVaultBrokerBindings`
  ([brokerBindings.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/brokerBindings.ts))
  throw `noAccess` on win32; the pipe-helper relay contract
  ([windowsPipe.ts](/home/randy/lanes/VAULTPARITY/src/core/vault/broker/windowsPipe.ts))
  and `MuseSparkVaultPipe.cs` design exist but no TS relay wires them into the
  channel. After: one `buildBrokerChannel()` body serves POSIX and Windows
  starters; Windows supplies pipe-relay files, DPAPI/CNG/Hello slots,
  claim-file claim/epoch locks and the guarded helper listener
  (`a7ece1345`; `windowsBrokerProcess.ts`, `windowsHost.ts`).
- Windows slot wiring — now: `WindowsVaultSlot` (DPAPI/CNG/Hello)
  ([windowsVaultSlot.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/slots/windowsVaultSlot.ts))
  exists but nothing imports it; the broker entry defaults to
  `PosixVaultSlots`. After: `defaultBrokerSlots()` dispatches per platform;
  Windows gets DPAPI always and CNG/Hello where probed (`6ff6bca9`,
  `windowsVaultSlots.ts`).
- macOS Secure Enclave slot — now: `MacVaultSlot`
  ([macVaultSlot.ts](/home/randy/lanes/VAULTPARITY/src/runtime/vault/slots/macVaultSlot.ts))
  exists but nothing imports it; storage is `OsStoreVaultSlot` (login Keychain)
  only via `PosixVaultSlots`. After: `MacVaultSlots` offers the Keychain slot
  plus the Secure Enclave slot where probed (`6ff6bca9`, `macVaultSlots.ts`).
- macOS presence check — now: `PosixVaultSlots.presence()` always returns
  false. After: presence reflects a fresh Secure Enclave unwrap, fail-closed.
- Linux TPM2/systemd-creds — now: Secret Service only; D89 promises a TPM2
  sealed object via `systemd-creds --user` or tpm2-tools where `/dev/tpmrm0`
  opens. After: `LinuxTpm2Slot` seals via `systemd-creds encrypt --user -T`
  where the device opens and systemd ≥ 256; presence stays refused after a
  real probe (no platform prompter on Linux; the passphrase prompt owns
  presence) (`6ff6bca9`, `linuxTpm2Slot.ts`, `linuxVaultSlots.ts`).
- Linux presence check — now: `PosixVaultSlots.presence()` always returns
  false. After: presence stays refused after a real TPM2 capability probe
  (no platform prompter on Linux; the person's presence mechanism is the
  vault passphrase, prompted per use by the host, D89 table)
  (`6ff6bca9`, `linuxVaultSlots.ts`).
- Keyring-absent broker — found mid-lane: the staged `.vsix` carries no
  `node_modules`, so `import('@napi-rs/keyring')` fails and the broker
  refused startup on every platform. After: the bindings degrade to a
  per-operation storeUnavailable factory and choose the owner-only file
  anchor (same record, same rollback rules, inherited from the keyring
  anchor) when the binding is missing; the OS store stays preferred wherever
  it is installed. The Windows broker handle carries its claim location like
  the POSIX one (`e813a4e3`, `fileAnchor.ts`, `brokerBindings.ts`,
  `keyringAnchor.ts`, `windowsBrokerProcess.ts`).
- Packaging — now: the universal VSIX carries every platform's native
  helpers but no keyring binaries at all (verified: vsce lists zero
  `node_modules` files); staging them would need 4,716,310 bytes compressed
  (PLAN.md D3 record) against ~380–540 KB of headroom, so no package can
  carry them under the unchanged 3700 KiB budget. After: `package-vsix
--target` packs one `.vsix` per VS Code target platform, each with only
  its own native pieces within budget; CI packs and asserts all six
  (own helpers only, TargetPlatform in the manifest). Keyring stays out by
  measurement: the linux-x64 binary alone deflates to 1,368,682 bytes
  (3,201,632 raw) vs 377,276 headroom on the measured linux-x64 package.

## Proofs (real code on each platform)

- Linux: direct runs in this worktree (`npx vitest run`, typecheck, build).
  - `slotProviders.test.ts` 9 passed; `windowsPipeRelay.test.ts` 6 passed;
    `fileAnchor.test.ts` 3 passed; `brokerWithoutKeyring.test.ts` 1 passed;
    `brokerSession.test.ts` 4 passed; `writerCrashPosix.test.ts` 17 passed;
    `vaultHarnessScenarios.test.ts` + `windowsPipeRelay` re-passed;
    `vsixTargets.test.mjs` 7 passed (all with the repo-default 5 s timeout).
  - Gate-fire: `brokerWithoutKeyring` fails on the pre-fix tree (broker
    refuses startup, no ready message) and passes with the fix.
  - Targeted pack, real production build on this rig:
    `muse-spark-code-linux-x64-0.18.2.vsix` = 3,411,524 bytes (budget
    3,788,800), `TargetPlatform="linux-x64"`, zero foreign helpers, all
    vault bundles present, x64 helpers built here (`muse-created` 43,208
    bytes, `muse-vault-peer` 14,544 bytes).
  - Rig env the vault suites need here: `TMPDIR=$PWD/temp`
    (the harness TMPDIR is ~130 chars; the broker's home-fallback socket
    must fit 107 bytes) and `XDG_RUNTIME_DIR=$PWD/temp/xdg` (HOME is
    read-only). Root-caused 2026-10-18: deep TMPDIR → fallback socket
    108+ bytes → broker correctly refuses → client launch loop hits its
    5 s deadline; verified byte-identical bundles behave identically, and
    the suite passes with a fitting TMPDIR.
  - Pre-existing, not this lane: `brokerSocketDirectory.test.ts`
    "refuses a symlink…" fails identically with and without this lane's
    changes (verified on the wiring commit); `brokerSession`/`writerCrash`
    need the TMPDIR/XDG env above on this rig.
- Windows/macOS: no spare hosts on this rig — proof is the lead's
  Windows/macOS run of the same suites plus the per-platform package install;
  recorded here when it lands. The Windows pipe helper compiles for net48
  with zero warnings (`dotnet build`); the C# targets the user's Framework
  `csc.exe` path at first use, to be confirmed on Windows CI.
- Bundle budgets moved with measured numbers (working rule 2):
  `dist/vaultBroker.js` 168,477 bytes → 193,749 budget (Windows broker,
  host, file anchor); `dist/vaultBrokerBindings.js` 33,159 → 38,133
  (anchor choice). Split manifest swaps deleted `posixVaultSlots.ts` for
  the three platform slot providers.

## Proofs, lane PR247FIX (macOS rig, repo-default timeouts, `--maxWorkers=3`)

- `slotProviders.test.ts` 13 passed (explicit platforms everywhere;
  hardware probes per platform; TPM2 round-trip where a machine seals).
- `brokerWithoutKeyring.test.ts` 1 passed with a short owner-only
  runtime root (exploratory env: natural per-user TMPDIR plus
  DEVELOPER_DIR for the fixture `cc`); skips with a reason where the
  root cannot fit the socket (this lane's 149-char sandbox TMPDIR).
- `fileAnchor.test.ts` 4 passed (POSIX-only mode assertion; guard order
  and refusal mapping covered).
- `windowsPipeRelay.test.ts` 2 passed + 1 win32 suite skipped;
  `windowsBrokerClient.test.ts` 1 win32 suite skipped (no Windows host
  on this rig; both prove on Windows CI against the real helper).
- `migrationCodecRoundTrip.test.ts` passes with the corrected
  owner-SID server trust; `vsixTargets.test.mjs` 7 passed (slot sources
  required on win32, `dist/vaultWindows.js` shared).
- `check:l10n` 0 problems (corrected `storeUnavailable` in all tables);
  `tsc` host + unit clean; `eslint` zero warnings on touched files;
  `cycles` clean; production `build` green with `dist/vaultWindows.js`
  = 40,706 bytes → 46,812 budget (15% headroom, working rule 2).
- UNMEASURED on this rig, not this lane: `brokerSession.test.ts`
  times out 3 of 4 here (changed tree) and hangs the base worktree past
  300 s under the same env; neither run reaches the changed code (no
  setup, no probe — verified by call-site). The lead's Linux CI decides.
- Windows proof pending: the lead's Windows run plus Windows CI
  (`windowsBrokerClient`, `windowsPipeRelay` real-helper suites).

## Grok review response (lane PR247FIX, 2026-10-18)

One line per finding; each is fixed at its cause below or answered with a
measured reason. No test timeout is raised anywhere; no stand-in is kept.

- F1 (Windows client unreachable): fix at cause — add the Windows client
  platform (helper build, child launch with `windowsHelper`, pipe
  discovery/connect), a Windows branch in `VaultBrokerClient.open`, and
  broker-entry Windows startup that reuses one serve relay; pipe tests run
  on Windows CI against the real helper, skipped elsewhere with a reason.
- F2 (hardware slots never created): fix at cause — setup wraps a
  capability-probed hardware slot beside the OS-store slot (`auto` = both,
  D89), and a working non-OS-store setup where only hardware seals.
- F3 (`systemd-creds` without PATH): fix at cause — resolve the absolute
  tool (`/usr/bin` then `/bin`), memoised; unavailable when neither exists.
- F4 (`slotProviders` off Linux): fix at cause — every case constructs its
  provider with an explicit `platform`; the live-platform dispatch case
  asserts the actual platform and the win32-only branch skips elsewhere.
- F5 (`brokerWithoutKeyring` macOS timeout): fix at cause — the child gets
  a short owner-only `TMPDIR` on macOS (XDG is Linux-only) and the parent
  races ready against exit; skip with a reason when no short base fits.
- F6 (anchor modes on Windows): fix at cause — the Windows bindings pass
  the pipe-helper guard into the file anchor (dir and file protected after
  write); the `0o600` assertion stays POSIX-only.
- F7 (`storeUnavailable` untrue): fix at cause — a distinct
  binding-missing refusal (new sentence in every table) where the package
  lacks the OS-store binding, and a working hardware-only setup where the
  machine seals; keyring binaries stay out by the measured budget.
- F8 (pipe-relay peer stand-in): fix at cause — delete the peer; pure
  contract tests stay, and the relay integration drives the real
  `MuseSparkVaultPipe` binary on Windows CI (skip elsewhere with a reason).
- F9 (self-written audit marker): fix at cause — drop the child's write;
  the child asserts a real `osStore.wrap` refusal in process and the parent
  asserts ready plus a clean shutdown.
- F10 (Linux presence survey): fix the survey — presence stays refused
  after a real TPM2 probe (the passphrase owns Linux presence, D89 table).

## macOS replay (lane VAULTOPEN, 2026-10-18, macmini arm64, repo-default 5 s timeouts, `--maxWorkers=3`)

Env the suites need here: `TMPDIR` at the natural per-user root
(`/var/folders/r2/xm1s2y_x67zg6lz1kr7x8f2h0000gp/T`, 42 chars, owner-only,
outside the repo) and `umask 022`. The sandbox forces a 151-char TMPDIR
inside the worktree with umask 077; both break suites by the suites' own
rules (socket-length refusal, owner-only mode assertion), not the product.

- `slotProviders.test.ts` 13 passed; `fileAnchor.test.ts` 4 passed;
  `migrationCodecRoundTrip.test.ts` 6 passed.
- `brokerWithoutKeyring.test.ts` 1 passed with the natural TMPDIR. With
  the sandbox TMPDIR inside the repo the suite's own guard fails fast in
  `beforeAll` (the binding would resolve from the repo's `node_modules`,
  so the fixture cannot prove keyring absence) — the designed fail-fast,
  not a product failure.
- `vaultHarnessScenarios.test.ts` 3 passed; `windowsPipeRelay.test.ts`
  2 passed + 1 win32 suite skipped with a reason.
- `brokerSocketDirectory.test.ts` 14 passed with umask 022 (with the
  sandbox umask 077 one mode assertion fails: `mkdir` 0755 is masked to
  0700, so the permissive base is not permissive — the msm109 record's
  known signature, measured again here).
- `brokerSession.test.ts` 0/4 in this sandbox, same signature as the
  PR247FIX record. Measured one level deeper with an error-printing
  probe of the same broker startup (probe scripts in worktree `temp/`,
  fixtures under the natural TMPDIR, removed after): the three forked
  clients (`env: { HOME }`) never send ready because the broker refuses
  at startup with "The broker cannot start. First-party keys still work;
  agent uses are refused. Repair the broker installation."
  (`assertVaultSocketLength`: the bare env drops TMPDIR, the socket
  falls back under HOME at the 151-char sandbox root, over the darwin
  limit — the product correctly refuses). The fourth (full env) starts
  and sends ready, then exits 1 on SIGTERM instead of 0; the exact
  refusing shutdown step is UNMEASURED beyond the signature. Neither
  reaches changed code; CI decides.
- `writerCrashPosix.test.ts` 0/17 in this sandbox, all
  `{ kind: 'refused', reason: 'io' }`. Measured cause: the writer
  lease's macOS birth probe runs `/bin/ps`, and this sandbox denies it
  (`/bin/ps: Operation not permitted`, `src/core/locks/processOwner.ts`
  `darwinStartTime`). No shim was built; the lead runs these outside
  the sandbox.
- OS-keychain-backed paths need a desktop session with an unlocked
  keychain: `security create-keychain` fails in this sandbox
  (`SecKeychainCreate ... parameters ... not valid`, exit 206) and
  `@napi-rs/keyring` reports no default keychain under the sandbox
  HOME. The owner's own login keychain was never touched. The
  keyring-absent broker path (file anchor) above is the documented
  fallback and passes here.

## Lane VAULTMIGFIX note (2026-10-18, appended by the VAULTMIGFIX lane)

Grok's security review of the VAULTOPEN key-store migration (branch
`ms/msm109-open`, PR #247) found it not mergeable: a save during unlock
could write the older key back over the new one, a key saved after
sign-out never migrated, a changed provider key stayed stale in the vault
until the next unlock, and migrated rows were listed with Edit/Remove
that a removal then left unrepaired. This lane fixes each at its cause on
branch `ms/msm109-open-fix` (shared migration lock, legacy-match checks
in `store`, phase-aware `mirrorWrite`/`ensureMigrated`, section hides
hidden first-party rows, missing vault copies re-copied on unlock), with
regression tests driving the real controller and the real VaultStore.
Full record, tests and gates: `docs/certification/msm109.md`
§VAULTMIGFIX. No parity-surface change.

## Lane VAULTMIGFIX2 note (2026-10-19, appended by the VAULTMIGFIX2 lane)

Grok's re-review of the VAULTMIGFIX key-store migration found it not
mergeable: an interrupted sign-out deleted a key saved afterwards, and saving
an oauth, subscription or account record stuck that secret in the vault with
a `copying` row the unlock skipped forever. This lane fixes each at its cause
on branch `ms/msm109-open-fix2` (resumed `deleting` rows keep a live legacy
copy and re-seed apiKey records; `mirrorWrite` shares the unlock's apiKey
check; stranded non-apiKey copies roll back on unlock; the shell test binds
the real controller), with regression tests driving the real controller and
the real VaultStore. Full record, tests and gates: `docs/certification/msm109.md`
§VAULTMIGFIX2. No parity-surface change. The store suite could not run in this
sandbox (`/bin/ps: Operation not permitted` stops `VaultStore.create` in
`beforeEach`, like `writerCrashPosix`); the lead runs it outside.

## Lane VAULTMIGFIX3 note (2026-10-19, appended by the VAULTMIGFIX3 lane)

VAULTMIGFIX2 left one race open: a save landing between a fresh sign-out's
SecretStorage clear and its engine delete lost the newer key the old
`removeLegacy` way. This lane closes it on branch `ms/msm109-open-fix3`
(each shell save and each shell sign-out holds the shared migration lane
across both phases as one atomic op, holder detected by async ancestry;
second-comer wins, proven by a real save racing a real sign-out through
the real controller over the real VaultStore). This rig runs the store
suite VAULTMIGFIX2 could not: `credentialMigrationStore.test.ts` 19/19
with the repository's own timeout, plus every other vault suite — the
only failures are byte-identical on the untouched base (one `vaultPanelBuild`
U-host module-graph assertion, three `brokerSocketDirectory` cases under
this sandbox's long TMPDIR plus umask 077, four `brokerSession` spawn
timeouts). Full record, tests and gates: `docs/certification/msm109.md`
§VAULTMIGFIX3. No parity-surface change.

## Lane VAULTMIGFIX4 note (2026-10-19, appended by the VAULTMIGFIX4 lane)

Grok's third security review (GRVVAULTMIG3) confirms the earlier findings
fixed and the save/sign-out race closed, and finds two more paths, fixed
here at their cause on branch `ms/msm109-open-fix4`: a non-apiKey save over
a migrated slot now drops the orphaned vault copy (engine
`removeStaleVaultCopy`, live SecretStorage record untouched), and a
sign-out runs the journaled engine delete before clearing SecretStorage,
so a failure surfaces with the key still readable instead of stranding the
vault copy. Proven by two new tests driving the real shell, the real
controller, persisted SecretStorage files and the real VaultStore (each
red on the lane base, green after). Full record, tests and gates:
`docs/certification/msm109.md` §VAULTMIGFIX4. Parity-surface change: a
sign-out the locked vault cannot complete now fails loudly instead of
resolving half-finished.

## Lane VAULTMIGFIX5 note (2026-10-19, appended by the VAULTMIGFIX5 lane)

Grok's fourth security review (GRVVAULTMIG4) confirms every earlier finding
fixed and still holding, and finds one blocking path, fixed here at its
cause on branch `ms/msm109-open-fix5`: a sign-out that journals `deleting`
then fails its vault remove no longer restores the key on retry or on
unlock. The engine compares the live SecretStorage record against the
journaled digest — the same digest is the original key, so the sign-out
finishes (both copies removed); only a different digest is a newer save
worth keeping. Proven by a new test driving the real shell, the real
controller, persisted SecretStorage files and the real VaultStore (red on
the lane base, green after). Full record, tests and gates:
`docs/certification/msm109.md` §VAULTMIGFIX5. Parity-surface change: a
retried or unlock-healed sign-out now removes the key it was asked to
remove, instead of resolving with both copies still present.

## Grok re-review response (lane PR247FIX2, 2026-10-18, rig `linuxlt`)

One line per finding, each fixed at its cause. No test timeout raised
anywhere; no check weakened to pass; no stand-in kept.

- F1 (pipe-server trust always fails): fix at cause —
  `native/windows/MuseSparkVaultPipe.cs` `OnServer` now sets
  `ownerOnlyDacl` from `IsOwnerOnlyPipe(handle)` on the opened server
  handle, the same predicate the pipe creation asserts at
  `MuseSparkVaultPipe.cs:421` (and faults `integrity` on when false, so
  the predicate is proven on pipe handles on Windows). The client check
  (`isVaultPipeServerTrusted`) is unchanged: it still requires the SID
  match, non-remote peer and `ownerOnlyDacl: true`. The relay suite now
  asserts the predicate against the helper's whole real server answer
  (`windowsPipeRelay.test.ts`), so an `ok` with `ownerOnlyDacl: false`
  fails Windows CI instead of passing it. Gate-fire: the pre-existing
  contract case in the same suite already asserts the predicate is false
  for `ownerOnlyDacl: false`, so the old helper shape fails the new
  assertion by that same rule.
- F2 (Windows end-to-end test cannot start): fix at cause — the suite
  mints `hostId`/`hostSession` with `randomBytes(16).toString('hex')`,
  the way the panel does (`vaultPanelEntry.ts:36-37`), instead of
  `'test-host'`/`'test-session'` which `hostSchema` rejects in
  `beforeAll` on Windows.
- F3 (Windows empty-idle is the 5 s startup budget): fix at cause —
  `windowsBrokerProcess.ts` defaults `idleMs` to
  `VAULT_BROKER_EMPTY_IDLE_MS` (30 s), the same idle the POSIX broker
  uses, never `VAULT_BROKER_NATIVE_TIMEOUT_MS`. Provenance of that
  value: it arrived with the POSIX broker (`65caa2cbf0`) as our own
  chosen idle — no OS rule publishes a broker idle lifetime, on Windows
  or POSIX — and this lane shares it rather than inventing a second one.
  No suite times a 30 s idle on any platform (fake timers are forbidden);
  the mechanism stays covered by the POSIX lifecycle suite and the
  default by the shared constant; Windows CI's end-to-end exercises the
  fixed path indirectly (dial plus status inside one broker lifetime).

## POSIX-assumption audit (same lane, Windows vault path)

- `0o600`/`0o700` modes (`fileAnchor.ts`): Node ignores `mode` on
  Windows; the Windows bindings pass the pipe-helper guard, which sets
  the owner-only DACL after each write (`brokerBindings.ts:360-362`).
  No change needed.
- Socket-only checks: `VaultBrokerClient.open` verifies the socket file
  only off win32 and dial-verifies the pipe on win32 (`client.ts:50-59`);
  the channel's POSIX listen refuses win32 and Windows injects its own
  relay listener (`channel.ts`, `windowsBrokerProcess.ts:196-211`).
- Startup-vs-idle timeouts: every remaining `VAULT_BROKER_NATIVE_TIMEOUT_MS`
  use on the Windows path is a startup/dial budget (discovery deadline,
  launch wait, relay query timeout) — correct as is. The single misuse
  was the empty-socket default, fixed above (F3).

## Proofs, lane PR247FIX2 (linuxlt rig, repo-default timeout, `--maxWorkers=3`)

- `windowsPipeRelay.test.ts`, `windowsBrokerClient.test.ts`,
  `migrationCodecRoundTrip.test.ts` — 8 passed, 2 skipped (the win32
  suites: relay integration and broker end to end; no Windows host on
  this rig).
- Which suite proves which fix on hosted Windows CI: `windowsPipeRelay`
  real-helper suite proves F1 (trust predicate over the real answer);
  `windowsBrokerClient` end to end proves F1's dial path plus F2 (it
  starts at all); F3 is proven by the shared-constant default in code —
  no timing suite exists on any platform.
- `tsc` root project clean; `eslint --max-warnings=0` clean on all five
  touched files; `prettier --check` clean on the touched TS files (no
  Prettier parser exists for `.cs`; the one-line C# edit follows the
  file's own style).
- Pre-existing, not this lane: `npm run check:reference` fails with
  `Catalogue asserts conditional state: museSpark.vault.enabled`, measured
  identical on the pristine base (`f44f54120d`, separate worktree, same
  command) and on this lane's tree — none of this lane's files feeds the
  catalogue. Left red for the lead; weakening the gate is forbidden and a
  catalogue fix is outside this lane's three findings.
- Pre-existing, not this lane: `npm run duplication` reports 37 clones
  (0.11%) over its 0.0% threshold, but no reported clone range intersects
  any line this lane added or changed (relay-test hunks at 66-74 and
  179-192 vs clones at 91-104, 122-156, 169-178; broker-process hunk at
  220-229 vs clones at 116-185; no clones in the other touched files).
  This lane adds zero clones; the red predates it.

## Grok re-review response (lane PR247FIX3, 2026-10-18, rig `linuxlt`)

One line per finding, each fixed at its cause. No test timeout raised
anywhere; no check weakened to pass; no stand-in kept.

- F1 (Windows broker locks the vault every second): fix at cause —
  `windowsBrokerProcess.ts` no longer calls `options.lock` on every
  one-second tick. The interval only tracks `emptySince` and shuts an
  empty broker down after the 30 s idle; the lock callback (cancel an
  in-progress setup, then `broker.lock()`) runs once, from `close()`,
  the way the POSIX broker runs its own lock from process shutdown
  (`brokerProcess.ts:170`). Before, every tick bumped the lock epoch
  and wiped the in-memory key even with clients connected, so an
  unlock lasted about a second and Set Up Vault was cancelled on the
  next tick. Gate-fire by reasoning from the code path (this rig is
  Linux): `lock` with `bump: true` always appends an epoch bump
  (`state.ts:868-883`), so the old interval raised `lockEpoch` every
  second; the fixed one cannot — the only `options.lock` call site
  left is `close()`.
- F2 (Windows end-to-end suite expects `uncreated` from the broker):
  fix at cause — the suite now asserts what its `{ kind: 'status' }`
  request actually returns with no store open: `locked` with reason
  `locked` (`state.ts:1499-1508`). `uncreated` is the management
  view's answer over the data folder (`management.ts:428-429`, and the
  codebase's own rule at `vaultRuntimeEntry.ts:78`: "The management
  view knows `uncreated` and `setupPending`; the broker alone does
  not"), which this request never reaches — the POSIX drill reads it
  through `VaultManageSession.snapshot()`. The suite still proves the
  dial: `broker.connect` (pipe verify plus hello binding the broker)
  must succeed before any status is read, and any dial failure throws
  before the assertion.
- F1 regression coverage: the same suite reads status twice 1200 ms
  apart (more than one 1 s tick, real delay, no fake timers) and
  asserts a stable `lockEpoch`. Every lock bumps the epoch, so the
  old interval fails this assertion and the fixed code passes it. The
  1200 ms wait plus the broker launch fit the repository's own 5 s
  test timeout; no timeout is set or raised.

## Timer audit (same lane: nothing else drops the unlock on a timer)

- macOS and Linux share `brokerProcess.ts`: `options.lock` is called
  only from `close()` (line 170), never from the empty-idle arm
  (`empty()` only schedules `close()`). Same rule as the fixed
  Windows process. No change needed.
- `VaultBroker`'s own one-second timer (`broker.ts:140-145`) calls
  `tick()`, which locks only when a key is held past the 240-minute
  idle (`VAULT_IDLE_MINUTES`); otherwise it sends a no-op `tick`
  command — no lock, no epoch bump. The designed idle auto-lock,
  identical on all three platforms. No change needed.
- Remaining timers near the vault are lease renewals (`store.ts`),
  approval TTLs (`fleet.ts`, `channel.ts`, `client.ts`) and watch
  retries (`manageClient.ts`): none calls `lock`. No change needed.

## Proofs, lane PR247FIX3 (linuxlt rig, repo-default timeout, `--maxWorkers=3`)

- `npx vitest run test/unit/vault/windowsPipeRelay.test.ts
test/unit/vault/windowsBrokerClient.test.ts
test/unit/vault/migrationCodecRoundTrip.test.ts --maxWorkers=3`
  (no `--testTimeout`, the repository's own 5 s timeout): 2 files
  passed, 1 skipped (`windowsBrokerClient`, whole file `skipIf`
  win32); 8 tests passed, 2 skipped (the win32 relay integration and
  the broker end to end — no Windows host on this rig). The new
  `locked` assertion and the `lockEpoch`-stability regression prove
  on hosted Windows CI.
- Which suite proves which fix on hosted Windows CI: `windowsBrokerClient`
  end to end proves both — the `locked` status proves the dial (F2:
  hello plus pipe verify must succeed before any status is read, and
  any dial failure throws before the assertion), and the stable
  `lockEpoch` across two ticks proves the interval no longer locks
  (F1: the old interval raises `lockEpoch` every second, failing the
  new assertion). `windowsPipeRelay` real-helper suite keeps proving
  the FIX2 DACL fix.
- `npm run typecheck` (all five projects) exit 0 with zero
  `error TS` lines; `eslint --max-warnings=0` clean on both touched
  TS files; `prettier --check` clean on all four touched files;
  `check:plan` (0 drift), `check:l10n` (0 problems) and `check:host-api`
  (0 problems) green; `knip` exit 0; `cycles` clean;
  production `npm run build` green with budgets unraised.
- Pre-existing, not this lane: `npm run check:reference` exits 1 with
  the identical `Catalogue asserts conditional state:
museSpark.vault.enabled` measured on the pristine base in FIX2 —
  none of this lane's files feeds the catalogue. `npm run duplication`
  still reports the same 37 clones (0.11%); the clone ranges touching
  `windowsBrokerProcess.ts` are at 116-125, 149-158 and 178-185, all
  below this lane's hunks (interval at 222-237, `close()` at 248-275)
  — this lane adds zero clones.
