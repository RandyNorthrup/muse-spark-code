# RLVAULTANCHOR — the vault's rollback anchor isolated per vault (2026-10-21)

## The measured cause

`muse-spark-code-acp vault status` on the owner's PC said
`{"state":"unavailable","reason":"vaultLost"}` although the owner never set
up a vault. The rollback anchor (`src/runtime/vault/keyringAnchor.ts`, OS
credential store service `Muse Spark Code (Unofficial)`, fixed account
`vault-anchor-v1`) is stored per OS user, not per vault location, while the
vault files live wherever the data folder points. A vault suite run with a
throwaway `LOCALAPPDATA`/`TEMP` therefore wrote the real user's anchor with
its throwaway vault's id (the record's last write, 2026-10-21 22:14:39, is
the time of a local vault suite run); once the throwaway files were deleted,
the anchor named a vault with no files, and status read that as lost. The
same holds for the macOS login Keychain. The suites were also one-shot per
profile: a second run's setup refused `exists` on the first run's anchor,
and the twice-client POSIX panel suite could not pass twice in one store.

## The fix

Every record a vault writes under the product's OS-store service is now
keyed to its canonical broker root
(`src/runtime/vault/vaultStoreScope.ts`):

- the rollback anchor: `vault-anchor-v1:<sha256 of the canonical root>`
- the audit checkpoint / pending intent:
  `vault-audit-v1:<root>:<vaultId>` / `vault-audit-pending-v1:<root>:<vaultId>`
- an OS-store slot key: `vault.<root>.<vaultId>.<slotId>`

The person's own root keeps its pre-scoping records through adopted
fallbacks, so existing vaults keep working unchanged with no migration and
no reset: the anchor adopts the `vault-anchor-v1` record only when it names
this root's own vault id (bound from a startup peek of the files,
`VaultStore.peekVaultId`, resolved lazily on the first anchor read so an
unavailable store still starts the broker), and writes stay on whichever
account was read; the audit checkpoint and pending intent read the scoped
account first and the pre-scoping one until the first scoped publish
retires it, with the lineage rule that a published scoped checkpoint is the
whole lineage; a slot record opens under its stored reference when it is
the scoped or the pre-scoping form, and removal covers both. Whether a root
is the person's own is never guessed from the environment: a throwaway
`LOCALAPPDATA` would pass that test.

The complete inventory of OS-store records the vault writes under the
product's service, all covered above: the rollback anchor, the audit
checkpoint, the audit pending intent, and the OS-store slot keys (Secret
Service on Linux, login Keychain on macOS; Windows and Secure Enclave slots
seal into files and write no store record). The `museSpark.provider.*`
credential accounts and the migration legacy port are the person's shared
credentials, not vault records, and are unchanged.

Every vault fixture removes its own records when its broker is dead
(`test/unit/helpers/vault/storeCleanup.ts`, wired into the POSIX and
Windows panel fixtures): the scoped anchor always, and the scoped audit
records and stored slot keys of the vault its files name. The pre-scoping
records are never deleted by a fixture. The hosts receipt script passes its
own root (`test/hosts/vault-os-store.mjs`).

## Proof runnable in this lane's container

The container cannot start D-Bus (below), so the real-store cases below
are written, collected, and wired to CI, and everything that runs without
a store is green here.

- `test/unit/vault/vaultStoreScope.test.ts`, `vault file peek`: real vault
  files from a real setup (recovery slot only, file anchor, no OS store)
  read back through both peek entry points, with corrupt and absent files
  reading as null. Red/green drill on linuxlt, 2026-10-22: breaking
  `peekVaultSlotFiles` to return null fails the case (exit 1); restored,
  the file passes 1 test with the 4 store cases honestly skipped (exit 0).
- The suites the change touches, plus `npx vitest related` over every
  changed source file (exit 0): `fileAnchor`, `slotProviders`,
  `brokerWithoutKeyring` (the file-fallback audit path through the edited
  audit code), `brokerSession`, `writerCrashPosix`,
  `credentialMigration{,Store,Adapter}`, `migrationCodecRoundTrip`,
  `vaultCommand{,Failure}`, `vaultHarnessScenarios`, `vaultNativeEditor`,
  `vaultPanelBuild`, `vaultCatchCauses`, `vaultExpiry`,
  `vaultHostIdentity`, `vaultExecSpawn`, `vaultHeadlessDeny`, `policy`,
  `scrub`, `useDigest`, `kdf`, `loginCsv`, `sshImport`,
  `sshKeyRefusal`, the grant/migration/state/status suites and
  `vaultViewMachine` all pass; the panel flows and Windows-only suites
  skip without a store or platform (exit 0).
- `brokerSocketDirectory.test.ts` fails 3 cases in this container with the
  default tmpdir and 1 with `TMPDIR=/tmp/l-rlva`; the same file on the
  untouched base (`0cab9f3`, extracted to `temp/lane-base`, since removed)
  fails the identical 3. None of the file or its imports is touched by
  this lane. Environmental, pre-existing, unrelated.
- Gates, each exit 0 unless noted: `typecheck`, `eslint --max-warnings 0`
  and `prettier --check` on every touched file, `check:catches` (the one
  new catch, the peek's malformed-file branch, classifies NARROW — the
  anchor adoption needs none, since a root with no files never reads the
  shared account; the baseline regenerated for the refactor's re-keyed
  pre-existing sites, GENERIC count unchanged at 203),
  `duplication` (two clones this lane introduced removed by sharing the
  slot guard and the panel first-party row), `cycles`, `deadcode`,
  `build` (all budgets hold), `check:l10n`, `check:reference`,
  `check:host-api` (record regenerated for the scope module's
  `node:crypto`/`node:path` imports), `check:plan` (223 milestones,
  0 drift), `check:roadmap`.
- No `eslint-disable`, `@ts-expect-error`, unverifiable cast or `any` was
  added, so PLAN.md §8 needs no row.

## The proof that needs a store (blocked in this container)

`test/unit/vault/vaultStoreScope.test.ts` holds the red/green proof, and
`.github/workflows/hosts.yml` runs it on Linux (Secret Service), macOS
(job keychain) and Windows (Credential Manager) in the `agent` job's
already-provisioned stores; the Windows and macOS unit shards run it too
where their store answers. What it proves with a real store: setup writes
the scoped anchor, audit and slot records while the shared
`vault-anchor-v1` reads back byte-identical; a checkpoint relocated to the
pre-scoping account is adopted and migrated; a pre-scoping anchor stays
with the vault that owns it and is invisible to any other; slots wrap
scoped references and still open pre-scoping ones; disposal removes every
record the vault wrote and nothing else.

Blocked here: this lane runs in a container (`systemd-detect-virt` says
`container-other`, `bwrap//&unpriv_bwrap (enforce)`) where every D-Bus
session connection fails — bare `dbus-send`, `secret-tool`, and
`@napi-rs/keyring` all fail identically with `Failed to query AppArmor
policy: Read-only file system` — so no Secret Service client can run and
neither the new store cases nor the panel suites can run on this rig. No
shim or workaround was built, per the lane's sandbox rule. The lead runs,
outside the container with a lane-private keyring home:

```
dbus-run-session -- sh -c "printf '<pw>\n' | gnome-keyring-daemon --unlock --components=secrets > /dev/null && npx vitest run test/unit/vault/vaultStoreScope.test.ts"
```

then the same file a second time in the same store (rerunnability: the
first run's disposal must leave nothing behind), plus
`test/unit/vault/posixVaultPanelFlow.test.ts`, and compares against the
base, where the scope case fails on the shared anchor write. Until that
run and hosted CI are green, the lane's proof is pending.
