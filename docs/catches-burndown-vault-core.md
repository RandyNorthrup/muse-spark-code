# Catches burn-down: src/core/vault (D119 vault-core lane)

Area: `src/core/vault` and its subfolders (`broker`, `exec`, `migrate`,
`ssh`, `web`). The catch classifier (`scripts/catch-inventory.mjs`) is read
from the truth group's commit `b7537ba6f3` and run from `temp/catch`
(uncommitted); the baseline regeneration stays with the join.

## Counts

Before (worktree scan at lane start): 143 debt sites — 78 GENERIC,
40 SWALLOW, 25 CLEANUP (186 total catch sites under `src/core/vault`).

After: 76 debt sites — 18 GENERIC, 0 SWALLOW, 58 CLEANUP.

100 sites fixed at cause (every GENERIC/SWALLOW except the 18 designed
keeps below now classifies NARROW or REPORTED). No catch was widened, no
error invented, no person-facing sentence added or changed: every fix keeps
the existing fixed words and carries the failure as `cause` (typed faults
grew an optional cause slot, following `TeamMergeError`), or names the
expected condition (`SyntaxError`, `TypeError`, `AccountStoreError`,
`ENOENT`, `VaultError`/`VaultMigrationFault`/`VaultManagementError` codes,
the abort check).

## Fixed

- Cause slots: `VaultError`, `VaultWriterError`, `VaultChannelError`,
  `VaultMigrationFault`, `VaultManagementError`, `sshFailure`
  (`crypto.ts`, `broker/client.ts`, `migrate/fault.ts`,
  `broker/ports.ts`, `ssh/wire.ts`).
- Shared teardown: `wipeBuffers` (`crypto.ts`, also used by `scrub.ts`),
  `wipeImportMaterial` (`migrate/material.ts`, shared by
  `ambientCredentials.ts` and `loginCsv.ts`), `destroySockets` /
  `closeSessions` (`ssh/wire.ts`), `teardownBestEffort` /
  `unlinkConsumedFile` (`broker/files.ts`), `releaseRoute`
  (`fleet.ts`), `forgetReceiptBestEffort` (`migrate/importFile.ts`).
- Refusal mappers now carry the cause under the same fixed reason:
  `storeRefusal`, `importRefusal` (`broker/management.ts`).
- Whole files completed: every file under `src/core/vault` with debt is
  fixed except the keeps below. `taint.ts`, `useDigest.ts`, `kdf.ts` and
  the vault `exec/service.ts` carried no debt.
- Proof: `test/unit/vault/vaultCatchCauses.test.ts` (14 tests) drives the
  real code — wrong-key opens, torn splits and backups, malformed account,
  provider, cookie, envelope and seed bytes, a real `ENOTDIR` home, a real
  key file — and asserts the fixed sentence plus the cause. Existing
  suites kept green: `credentialMigration`, `loginCsv`,
  `migrationCodecRoundTrip`, `credentialMigrationStore` (6 pre-existing
  sandbox failures, identical on base `9b47fc806`), `sshImport`, `scrub`,
  `kdf`, `fileAnchor`, `policy`, `useDigest`, `brokerSession` and
  `brokerSocketDirectory` (7 pre-existing sandbox failures, identical on
  base).

## Designed keeps with reasons (accepted, not forgotten)

GENERIC keeps (the failure is consumed into a designed true outcome):

- `broker/broker.ts` audit/io/release dispatches (4): the dispatched
  error settles the waiter — `state.ts` `audited` settles with the event
  error and fires the failure effect; `completed` settles the same way —
  and the broker's settle effect rejects the caller with it.
- `broker/channel.ts` refusal boundary (4): `refusal()` maps typed vault
  failures to a fixed wire reason and rethrows the rest. The cause must
  not cross: parser and store text may hold secret bytes (same rule as the
  accepted `macVaultProtocol` baseline — only fixed vocabulary crosses).
- `broker/firstParty.ts` connect fallback (1): a fallback attempt
  supersedes the connect failure and its own outcome rules; both denial
  paths now carry the connect cause.
- `broker/management.ts` setup wraps (2): a failed OS-store wrap is saved
  and rules the setup through `storeRefusal` (the actionable error); a
  failed hardware wrap beside a working OS store still sets up.
- `broker/repository.ts` slot fallback (1): a lost TPM falls back to the
  OS store; only total failure denies.
- `broker/socketDirectory.ts` `isPathWithin` (1): unprovable containment
  reads outside — fail-closed boolean.
- `broker/state.ts` op settle (1): `settle(op, undefined, error)` pushes
  the settle effect with the error and the broker rejects the waiter
  with it.
- `migrate/importFile.ts` pending probe (1): P3-1 — only a proven-gone
  source is forgotten; anything unproven keeps its receipt and is listed.
- `remote.ts` deliver/report (2): delivery returns only success
  (fail-closed); a denial the peer received, or a stale operation, owns
  the outcome while a post-send failure rejects with its cause.
- `ssh/keys.ts` signature verify (1): a crypto failure rejects the
  signature — fail-closed boolean, proven by
  `vaultCatchCauses.test.ts`.

CLEANUP keeps: every CLEANUP site carries its reason in code. Pre-existing
(20): `broker/audit.ts` (previous caller owns its failure),
`broker/broker.ts` guarded-notify inner, `broker/client.ts` listener and
previous-tail, `broker/files.ts` published-leftover, `broker/management.ts`
watchers, serialize tail and the two cancellation cleanups,
`broker/repository.ts` view/subscriber loops, `migrate/importFile.ts`
drive-away and the two sweep retries, `scrub.ts` build tail,
`store.ts` op-retain and stage-delete, `fleet.ts` aborted-route retain,
`web/sessions.ts` and `web/ticket.ts` awaited cleanups. New (38): each
fail-closed teardown (emergency lock, audit signal, socket destroy,
session close, aborts, best-effort unlinks/closes/forget) or moot
follow-up (already-rejecting stop, superseded connect, tried-next
candidate, skipped blob/entry, lock-owned sweep) says so on its catch.

## Files remaining

None. The area is complete.
