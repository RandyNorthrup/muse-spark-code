# M110-N node service

2026-10-06, Kubuntu rig, `/home/randy/lanes/M110N`, branch `m110/n`.
Scope: PLAN D90.1, .3, .18, .23 and M110a0's N lane, including the
RVM110L0 closed Git and ordered terminal corrections. Model attempts: **0**.
No credential read, network/model call, dependency install, machine setting,
push, merge or rebase. Local commits use the unchanged hooks.

## Implemented core

- Canonical L0 state plus capped audit journal in one owner-only atomic
  transaction: data fsync, rename, directory fsync. Hashes bind content,
  node, sequence, predecessor and retained head. Rotation preserves its
  verified anchor. Newer/malformed state, secret fields, stale generations,
  non-private files, links and substituted opened identities fail closed.
- A forward-migration/backup interface. Current v1 has no invented legacy
  format. A future forward migration still needs its own actual format and
  qualification; these tests certify current-version and refusal behavior.
- Sealed, unattended boot before accepting work; durable attempt admission;
  uncertain/failed attempts become blocked, never replayed. Supervision
  rebuilds the instance with capped backoff and treats interrupted backoff
  as normal shutdown. The deployment process remains C's responsibility.
- Authenticated-owner attachment with elapsed-time deadlines, bounded asks
  and sessions, exact human replies, deny on expiry/abort, and the unattended
  floor. No automatic approval or new paid-consent policy is introduced.
- Stop/lock cancel work, dispose tools, and ask engine/model/stream/device
  ports to stop. Lock seals keys and ends both public attendance and A1's
  actual session state immediately. A wedged opener is signalled; controls
  fail within the kill deadline. Cleanup failure requires process restart.
  Late resources are disposed, and a queued/slow unlock cannot reverse lock.
- AES-256-GCM item encryption with separate HKDF domains and bound additional
  data, encrypted-only writes, serialized access and lock epochs. Restart
  stays sealed. Failed unlock seals an existing unlocked store. Only the
  Model API and deploy-key handles are accepted. No production codec/KDF
  fallback competes with M109's record format.
- A tools host with trusted OS UID and PTY ports: reject root/service UID,
  allow-list child environment, registered trusted workspaces, realpath
  containment, argv without a shell wrapper, combined bounded output,
  ordered acknowledged PTY output/exit, cancellation and disposal.
- Closed Git uses a Linux FD-anchored bounded private snapshot of objects,
  refs, index and HEAD, a constructed inert config, fixed Git options and
  an allow-list environment. Repository config, hooks, drivers, helpers,
  includes, alternates and replace refs cannot enter credentialed Git.
  A trusted network port consumes/rechecks the exact proof/destination/ref/
  head and supplies a pinned SSH wrapper/socket; mutation publication goes
  through U1's stale-write and tools-UID boundary. Raw Git output is for U1
  to convert to L0 results. No arbitrary Git argv or alias dispatch exists.
- Explicit `node init/serve/status/stop/lock/unlock/wipe` dispatch in the
  isolated `dist/node.js`; normal ACP and editors carry only the tiny loader.
  Init saves the selected private/loopback interface, identity and a hash of
  a short-lived setup code; it opens no port. Missing adapters fail explicitly.
  Local status refuses to invent a running service's state. Wipe requires
  explicit confirmation and calls slot/identity destruction before removal.
  Health is a fixed-word handler for C's loopback-only binding.

## Integration handoffs and limits

| Binding / owner                                | Required concrete integration                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1/M104 `NodeServiceBinding`                   | TLS companion/local authenticated control transport, route table and engine/controller. Call `NodeService.boot` exactly once before accepting work. Parse every transport frame with the L0 catalog/frozen M104 envelope. `NodeServicePorts.endSessions` must invalidate actual bearers/challenges; resources include every model request, stream and maker stop.                               |
| M109 `NodeVaultCodec`                          | Exact D89.2 slot/item/index reader and writer, real Argon2id/scrypt feature detection, generation/rollback validation and migration verification. Test `FixtureCodec` is deliberately incompatible test data, never product. Freeze HKDF/AAD encoding with that reader before claiming interoperability.                                                                                        |
| C/N `NodeToolHostOptions` and `NodePtyFactory` | Trusted OS peer/UID verification, two-user launcher, private service root, bounded paused native PTY, OS descendant containment/cleanup. No native socket/peer helper exists on this base. POSIX process groups alone cannot contain a child that deliberately escapes its group; C's qualified job/cgroup boundary must own that.                                                              |
| C/N supervisor lease                           | The current exclusive lock file safely refuses a second instance but conservatively refuses a stale crash lease. Bind a kernel-held single-writer lease or qualified recovery before claiming process-crash/reboot restart. Never blindly unlink a PID file.                                                                                                                                    |
| U1/M109 `NodeGitRunnerOptions`                 | Registered workspace resolution, service-approved commit identity, atomic data publication with current head/file preconditions, exact step-up consumption and host-key registration, private agent and trusted SSH wrapper. SHA-256/reftable repositories, linked-worktree gitfiles and repositories over the import caps are not qualified. Network Git on unborn HEAD is currently refused.  |
| C/N/U1 captures                                | A0-PTY, A0-GIT, A0-PUBLISH, actual state-read/ptrace denial and amd64/arm64/Desktop/container matrix remain required. Native Git/process tests here run as the rig user with synthetic ports; they do not prove the two-UID image. Muse Code stays unavailable pending A0-BWRAP/A0-LOGIN and Q-M110.9's sign-in isolation.                                                                      |
| J documentation                                | README, CHANGELOG, AGENTS, operator and editor docs are J-owned. Add these commands and behaviors after bindings are integrated. No featureCatalog/reference generator exists on this base; integration must list all seven commands, selected LAN listener, health, lock/stop/wipe, sealed store, attendance and tools/Git behavior. Regenerate the J-owned host-API record after integration. |

**Listener gate:** [the accepted-review requirement](m110-threat-model.md)
explicitly says Lead/Claude acceptance is pending and forbids listener code
before acceptance. Clarification was requested through the user-input tool;
no answer/accepted review was supplied. No LAN, HTTP, TLS or local socket
listener was implemented or bound. This lane is **core implementation,
not runnable home-node certification** until that gate and the bindings close.

Native Windows private files/tools require a qualified DACL/job adapter; the
A0 service runs in Linux/WSL/container. Paths normalize separators. Native
POSIX test cases execute on Linux/macOS; Windows executes an explicit
unsupported-boundary assertion instead of skipping those tests. Pure
parser/policy/fake terminal tests still execute on Windows. Git's FD snapshot
is explicitly Linux-only. No Windows/macOS rig result is claimed here.

**Wipe residual:** overwriting the current slots and identity and removing the
current root does not erase an older copied volume's passphrase-wrapped key,
filesystem snapshots, journal copies or SSD remanence. Such an older copy is
still decryptable with its original passphrase. D90's saved-volume claim needs
an owner/lead decision about an externally revocable wrapping key or a narrower
claim. Buffer cleanup does not guarantee JS string or process memory zeroization.

## Guard-fire receipts

Each accepted drill removes/breaks its guard, sees a named test or gate fail,
and restores the source byte-exact with equal SHA-256. Receipts:

- [State/private files](m110-n-node-service-drills.json)
- [Attendance, lifecycle, keys, tools and Git](m110-n-lifecycle-drills.json)
- [Layered bounds, cancellation, transaction and command boundaries](m110-n-boundary-drills.json)
- [Opened identity, owner, unlock and wedged controls](m110-n-control-drills.json)
- [Boot and interrupted restart](m110-n-boot-drills.json)
- [Shared-parser runtime exports](m110-n-parser-drills.json)
- [Real production bundle budget and lazy isolation](m110-n-bundle-drills.json)

Two initial removals remained green: an outer-root check masked the workspace
check, and the L0 output schema masked the early PTY limit. The sibling-root
escape case and combined layered-bound drill then failed. The analogous
combined child-output drill now fails a named rejection assertion. Some
mutants deliberately wedge work and fail at the repository's default timeout;
no raised test timeout was used. Historical receipts retain the exact source
hash they tested, even when later fixes/refactoring change that source.

## Verification

Kubuntu Linux x86_64, Node **v24.18.0**, repository default Vitest timeout:

- `npm run typecheck`: all five projects pass.
- Changed-file ESLint (`--max-warnings=0`): pass.
- Changed-file Prettier check: pass.
- `npm run deadcode`: pass (two existing configuration hints only).
- `npx jscpd`: zero clones, pass.
- `node scripts/check-l10n.mjs`: 14 tables, 164 manifest strings, zero problems.
- `node scripts/check-host-api.mjs`: **exit 1**, only the J-owned generated
  Node import-count rows differ. VS Code APIs (332), importers (31), built-ins
  (25) and theme variables (61) are unchanged.

J's exact regenerated counts: `node:child_process` 13→15, `node:crypto`
46→52, `node:fs` 33→35, `node:fs/promises` 47→51, `node:module` 1→2,
`node:path` 84→89, `node:util` 5→6. Run `npm run check:host-api -- --write`
in integration and review those rows.

Owned tests: **80 tests in eight files**, default timeout, at most three
files and three workers per run. State/lifecycle/service: 40; commands/tools/
keys: 33; Git: 5; shipped shared-parser boundary: 2. No test was skipped or
filtered. Native Git canaries exercise status, branches, unstaged/staged diff,
stage, commit and branch creation; changed network destination/head fail before
the synthetic SSH wrapper can run.

The built CLI smoke caught missing shared `ipv4`/`ipv6`/`partialRecord`
exports that inline-zod unit tests missed. The exports and node metafile
coverage are fixed, with a fast isolated bundle test and red drills for each
export and the production export gate. CLI help/init/offline status pass;
unbound serve, lock, unlock, stop and confirmed wipe explicitly fail and do
not remove state. These refusals are not service-support receipts.

`npm run build` passes: node **53.1/75 KiB**, shared validation **41.2/50 KiB**,
ACP **817.8/850 KiB**, extension **436.9/600 KiB**, browser startup **896.1/900
KiB**, deferred browser JS **49.7/50 KiB**. Existing budgets are unchanged.
The node cap was set from its initial 52.4 KiB measurement plus 15%, rounded
up to 25 KiB. `node scripts/package-acp.mjs` packages the lazy node bundle;
no package is published. The local tarball contains `node.js`, `acp.js`,
`validation.js` and `uiText.js`; membership and the built CLI smoke pass.

There are **63 accepted red-drill receipts**, every source hash restored.
The parser/export correction added three named unit failures and a real
production gate failure. Counted model attempts remain zero.
Full `npm run quality`, coverage/integration/editor/browser/image matrices are
reserved to the lead by the supplied rig/common rules; no gate was weakened.
The host-API gate currently reports only its stale generated Node import
counts, in a J-owned file. Its exact diff is handed off rather than editing
another lane's file. This is a named integration check, not a green result.
