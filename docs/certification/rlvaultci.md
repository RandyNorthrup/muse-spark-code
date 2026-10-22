# The vault panel flow's intermittent hosted failures, found and fixed (lane RLVAULTCI, 2026-10-22)

Base: main at 0.19.0 (`0cab9f3`). Machine: macmini (Mac mini Intel),
inside the lane sandbox (the MACVAULTFLOW wall stands: `/bin/ps` is
blocked with `Operation not permitted`, and the lane's `TMPDIR` is too
long for the broker socket, so the panel suites skip here and hosted CI
is their proof).

## The two failures

- macOS shard 15, capacity run 39722575285: after Unlock the panel still
  read Locked when the 60 s step wait ended, with no toast and no log.
- Windows shard 6, capacity run 39703535342: the first open settled on
  `uncreated` with two `The vault operation failed. Try again.` toasts.

Both passed locally and on other runs of the same code. Shard placement
was verified locally from vitest 5's own sharding (sha1 of the file path,
sorted, sliced into 16): `posixVaultPanelFlow` lands in shard 15 and
`windowsVaultPanelFlow` in shard 6, exactly the failing shards.

## Cause 1 (macOS, product): a stale broker event retired Unlock without a word

`VaultPanelHost` retired every in-flight operation on every broker event:
a `locked`, `revoked` or `changed` event bumped the generation and reset
the queue, so an operation still in its connect phase (peer-helper
execs through the governor, hello) threw `useChanged` at `authorize()`
and settled silent on the retired generation — no toast, no log, no
publish. The victim that matches every detail is Unlock: the earlier
Lock's own `locked` watch event, delivered late on a loaded runner,
killed Unlock before it was sent, and the event's own refresh published
the still-locked truth. Nothing retried it: the panel sat on Locked.

Fix (`src/host/vault/vaultPanelHost.ts`): a broker event never retires
the person's in-flight operation — only the person's own barrier (their
Lock or Revoke click, disposal) does. The broker validates every commit
(verified: answers re-check digest and policy currency; grants, removes,
resets and setup confirms are broker-checked or inert when stale), so a
change an operation genuinely conflicts with comes back as a refusal and
is shown. Add/edit keep a draft guard on its own generation (a stale
draft must not restore an older policy): conflicts now toast the new
`vault.editConflict` sentence (English plus all 14 tables, `check:l10n`
green) instead of dropping silently. Confirm dialogs (setup code, reset
word) stand through a mere change on their own signal; lock/revocation
still abort them.

No limit of ours added (D121): no new timeout, retry count, budget or
threshold. Paths were removed, none bounded.

## Cause 2 (Windows, test placement): the cold broker launch lived inside the flow

At first open the broker is not running yet, and the watch and the load
share one cold launch (the C# serve spawn on a loaded runner). Past the
5 s × 2 launch budget both fail: the watch reports `watchLost` (toast

1. and the load settles through its reload (toast 2) onto the true
   `uncreated` state. The product behaved honestly (reported, recovered);
   the one-time cold cost sat inside the toast-sensitive flow.

Fix (`test/unit/helpers/vault/windowsBrokerFixture.ts`): the fixture
warms the broker until it answers, inside the hook that has no time
limit of ours — the same one-time-costs-belong-in-hooks rule the POSIX
suite follows. Each attempt stays inside the product's own budget.

## Red/green drills (real broker, real host, no stand-ins)

The panel suites cannot run in this sandbox (the wall), so the vehicle
is `temp/rlvaultci/hammer.ts` (kept as scratch, gitignored): the real
POSIX fixture, the real panel host over the real panel service, 40
rounds of Lock followed immediately by Unlock with two extra direct
lock attempts racing each Unlock's connect, plus 4 background snapshot
storms through the same governor. Here the vault fail-closes, so every
delivered Unlock is refused (toast + log); a swallowed one adds
neither — the capacity run's exact silence signature. Short owner-only
`TMPDIR=/tmp/rlvci` (the MACVAULTFLOW precedent), macOS
disk-backed `/tmp`, removed afterwards.

- Pre-fix, base host (`HEAD~2`): 20/40 swallowed, exit 1.
- Pre-fix, base host again: 14/40 swallowed, exit 1.
- Post-fix, three runs: 0/40, 0/40, 0/40, exit 0 each time.

The suite-fire record: the hammer went red on its first pre-fix run
(20/40), before any product change existed, and green on its first
post-fix run; no break-on-purpose beyond the two pre-fix runs was
needed. The existing panel suites are the committed regression tests:
stuck-silent fails `settled('unlocked')`, and cold toasts fail
`settled('uncreated')` — both fail on the bug (the capacity runs) and
pass after it (hosted CI).

## Gates (final tree; every exit code)

- `tsc --noEmit` host, webview, unit, e2e, integration: 0, 0, 0, 0, 0.
- eslint `--max-warnings 0` on touched files: 0. prettier `--check` on
  touched files (sources plus all 14 tables): 0.
- `node scripts/check-l10n.mjs`: 0 problems, exit 0.
- `npm run check:reference`: current, exit 0.
- `npm run check:host-api`: 0 problems, exit 0.
- `npm run check:catches`: baseline matches, exit 0 (no new catch).
- `npm run duplication`: 0 clones, exit 0. `npm run cycles`: none,
  exit 0. `npm run deadcode`: exit 0.
- `npm run build`: exit 0 twice; every budget holds.
- `npx vitest related src/host/vault/vaultPanelHost.ts --run`: the two
  panel suites skip with reason here, exit 0.
- `npx vitest related src/shared/vaultRefusals.ts --run`: 443 passed,
  37 skipped; the one failing file is
  `credentialMigrationStore.test.ts`, which fails in its setup on the
  sandbox wall (writer birth via `/bin/ps`), in files this lane never
  touched — pre-existing and environmental.
- `vaultViewMachine` + `vaultPanelBuild` + `vaultCatchCauses`: 36
  passed, exit 0. `brokerWithoutKeyring` (short TMPDIR): 1 passed.
  `loadUiTable` + `mediaLocalization` + `accountUsageText`: 26 passed.
  Panel suites: skip with reason, exit 0.
- `npm run security:audit`: exit 0 (4 advisories, 2 exceptions, as committed). SAST: exit 0, 533
  rules on 3993 files, 0 findings — with `SSL_CERT_FILE=/etc/ssl/cert.pem`
  (without it semgrep's own binary crashes in this container with
  `ca-certs: empty trust anchors`, exit 2: environmental, not a finding).
  `related src/shared/l10n/en.ts` was not run as a whole battery per the
  shared-machine rule; the additive key is covered by `check:l10n` and
  the table-consumer suites above.

## What remains

- Hosted CI is the proof for the two panel suites (they skip in this
  sandbox by design) and for the Windows fixture warm-up (win32-only).
