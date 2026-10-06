# M110-N node service

2026-10-06, Kubuntu rig, `/home/randy/lanes/M110N`, branch `m110/n`.
Scope: PLAN D90.1, .3, .18, .23 and M110a0's N lane, including the
RVM110L0 closed Git and ordered terminal corrections. Model attempts: **0**.
No real credential read, external network/model call, dependency install, machine setting,
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
  includes, alternates and loose replace refs cannot enter credentialed Git;
  packed replace refs remain inert under the fixed `--no-replace-objects`
  option (named `M110N-packed-replace-ref` residual below).
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

**Listener acceptance:** the lead accepted the M110a0 table on 2026-10-06,
verbatim in [Lead acceptance](m110-threat-model.md#lead-acceptance), including
H19 and H20. The continuation implements N's listener within that table.
The earlier pending-acceptance refusal is resolved; production sign-in,
service composition, web assets and platform receipts remain named handoffs.

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

## Listener continuation (2026-10-06)

Implemented in `listener.ts`, `listenerGuard.ts`, `listenerMethods.ts` and
`listenerSocket.ts`, exported only from the lazy `dist/node.js` service bundle.
No dependency, key, production verifier fake, Meta/MSP shape or editor-specific
route was added. Local HTTPS tests use generated synthetic certificates and
fake shared ports; model attempts remain **0**.

- **H01:** config remains null before explicit selection. The canonical address
  parser permits loopback, RFC1918, ULA and explicitly chosen link-local;
  refuses wildcard, public, multicast, mapped IPv6 and metadata addresses,
  including expanded `fd00:ec2::254` and `fd20:ce::254`. Bind uses the numeric
  selected address and port only, with one start per listener and exclusive
  port ownership. There is no plain HTTP server or redirect.
- **H02:** load the leaf/key through owner-only, bounded `NodePrivateFiles`;
  require the configured SHA-256 pin, a non-CA leaf, exact SANs and current
  validity before bind. TLS 1.3 and the key/certificate match are enforced by
  Node. `print` receives the complete colon-separated SHA-256 fingerprint
  under the installed-language label for console/TUI display.
- **H06/H07/H08:** exact configured Host and matching HTTPS Origin, mandatory
  same-origin Fetch Metadata, duplicate critical header rejection, no cookies,
  CORS, URL credentials or cache of API replies. HTTP verifies the memory
  Authorization bearer before reading/parsing params. Every privileged route
  refuses without A1; no public auth operation can grant a session without its
  binding either. Params AND results use the shared catalog. Session abort
  signals cancel requests/streams on lock, sign-out, expiry and revocation.
- **WebSocket:** same-origin TLS handshake on `/node/terminal/stream`, with
  no header/query/subprotocol bearer; first frame must be the shared auth
  shape, with real verifier completion inside five seconds. Attach checks
  terminal ownership through the session's shared method port before U2's
  subscription opens. Input/resize/close also use that port. Every data frame
  and outbound event rechecks authentication; output is parsed and scoped to
  the attached terminal. Disconnect aborts U2's PTY subscription.
- **H09:** 2 MiB HTTP body, 8 KiB headers, 32 parsed headers, five-second
  request/handshake bound; 100 total connections/requests, 16 per source,
  1,000 source-admission records with expiry; source AND account failed-proof
  backoff with a 60-second ceiling before verifier/method work. Challenge
  issuance cannot clear failed-proof backoff. Existing sessions, including
  Stop, are independent of sign-in backoff. WebSocket input uses masked final
  text/control frames only, no compression or fragmentation, at most 64 KiB
  inbound frames, 2 MiB queued bytes and 64 frames/second. Shared terminal
  input stays at 16 KiB UTF8; output write queues stay bounded.
- **H19:** `node/maker/action` is an authored shared method with device,
  operation and exact payload; no hardware implementation is invented.
  `nodeActionDigest` hashes the method plus catalog-parsed payload, excluding
  only proof metadata. Caller digest and consumed A1 proof must match the
  exact payload, action, session, proof id and fresh lifetime. Terminal-open,
  network Git and wipe use the same binding. Stop has session access and
  needs no proof; the existing service/console Stop remains ungated.
- **H20:** N's transport backoff expires, with no permanent transport lockout
  and no remote recovery route. A1's actual 100-failure authenticator lockout,
  console display and new H04 setup-code recovery remain A1/T/C's binding.

### Named listener handoffs

| Handoff          | Owner         | Required binding                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `N-A1-VERIFIER`  | A1            | `NodeListenerOptions.verifier`: real in-memory bearer lookup returning public `NodeSession`, revocation/expiry `sessionSignal`, and atomic UV `consumeStepUp`. Monotonic idle/absolute and proof expiry; no token persistence/logging; H05 real WebAuthn qualification. H20 console lockout state and fresh-code recovery under H04.                              |
| `N-A1-S0-TLS`    | A1/S0         | Issue the exact non-CA leaf/key and approved full SHA-256 pin into the private service root; set configured SANs. Browser trust and `.local` captures remain required. Changed pins require pairing again. Bind the full fingerprint line to the console/TUI.                                                                                                     |
| `N-C-LISTENER`   | C/S0          | Compose `NodeServiceBinding.serve` after boot and the exclusive service lease, with the selected address, tools UID and firewall/publication boundary; off-LAN and image receipts. The ordinary runtime still explicitly refuses unbound serve.                                                                                                                   |
| `N-M104-METHODS` | M104/A1/U1/U2 | Bind a `NodeMethodPort` scoped to the verified session (null only for public auth). HTTP POST `/<catalog method>` has direct params JSON and direct validated result, not an invented MHP envelope; register all 32 catalog methods in the actual MHP adapter. Browser assets/controller are a separate named integration, not an unauthenticated fallback route. |
| `N-U2-TERMINAL`  | U2/C/T        | Bind ownership-checked attach/write/resize/close methods and the ordered, parsed event subscription. Honor abort by disposing PTY/descendants; native A0-PTY remains required. Clients send bounded final frames.                                                                                                                                                 |
| `N-M103-ACTION`  | M103/A1       | Register each physical effect through the shared action method or enforce the same step-up binding at the engine's physical-action gate; do not let a generic engine/tool route bypass H19. Keep Stop callable from any authenticated session and console.                                                                                                        |
| `N-J-LISTENER`   | J             | Integrate this implementation status into the operator/editor documentation and regenerate the host-API import counts. No `featureCatalog.ts` or reference generator exists on this base; register the commands/listener/actions when those integration files arrive.                                                                                             |

### Listener verification and drills

The real HTTPS fixture is generated once in `beforeAll`; pure WebSocket
five-second drills use fake timers while retaining the actual production
constant. Final tests use the repository's default timeout, with no test
filter, skip, increased timeout, gate ignore or threshold change. At most
three test files run at once, directly on Kubuntu.

The first TLS pin mutant stayed green because a second bind's port conflict
masked a missing certificate check. Each invalid-certificate fixture now
uses a different vacant port, and pin/CA/SAN/expiry removals fail independently.
A coherent forged Host+Origin case similarly proves the name allowlist beyond
the independent Origin check. Accepted source-restoration receipts are in
[m110-n-listener-drills.json](m110-n-listener-drills.json).

Final continuation verification on Kubuntu (Node v24.18.0): **334 tests in nine
files pass**, default timeout, three files/workers per invocation. Listener
88; canonical node/auth/method contracts 218; shipped bundle/service/commands 28. No tests were skipped or filtered in the passing final runs. `TMPDIR`
was scoped to `temp/verification` for the final commands after external
removal of `/tmp` fixtures/Vitest cache caused ENOENT suite failures; this
changes temporary-file placement only, not test behavior, gates or hooks.

All five typecheck projects, changed-file ESLint and Prettier, plain knip
(two existing configuration hints), zero-clone jscpd and localization (14
tables, 164 manifest strings, zero problems) pass. Production build passes:
node **64.7/75 KiB**, shared validation **41.2/50 KiB**, ACP **817.9/850 KiB**,
extension **437.0/600 KiB**, browser startup **896.2/900 KiB**, deferred JS
**49.7/50 KiB**. No budgets or gates changed. The continuation adds **43**
accepted named red drills (106 with the earlier 63); hashes restore byte-exact
and match the final production sources. The redundant first-frame type/token
checks use a documented combined removal; the slow-consumer queue test uses
valid frames across rate windows so a malformed-frame or rate guard cannot
mask a missing queue bound.

`node scripts/check-host-api.mjs` still exits **1**, solely for J's generated
import-count snapshot. The actual VS Code APIs (332), importers (31), built-ins
(25) and theme variables (61) remain unchanged. Final counts to regenerate:
`node:child_process` 13→15, `node:crypto` 46→55, `node:fs` 33→35,
`node:fs/promises` 47→51, `node:http` 4→7, `node:https` 1→2, `node:module`
1→2, `node:net` 7→8, `node:path` 84→89, `node:stream` 12→13, `node:util`
5→6. This deferral and the lead's full-quality responsibility are recorded
in PLAN §7; the snapshot is not reported green. No merge, push, rebase,
installation, paid/live attempt, production fake or machine setting change.

## RVM110NG corrections (FIXM110N2, 2026-10-06)

H07 is fixed in `listenerGuard.ts`: WebSocket upgrades require both mode
and destination `websocket`; HTTP retains destination `empty`. Both retain
exact Host/Origin and `Sec-Fetch-Site: same-origin`. Synthetic request and
real local TLS fixtures now send those transport-specific values. Metadata
mapping source: [Fetch Metadata §§2.1–2.3](https://www.w3.org/TR/fetch-metadata/),
read 2026-10-06: destination and mode map the request attributes, and site
maps its origin relationship. The browser WebSocket destination is the
explicit acceptance value in the rig brief; these are synthetic header
fixtures, not a new browser/platform capture. No model attempts were made.

The new `H07 uses browser Fetch Metadata for WebSocket=true` regression
failed against the original code (two failures, 58 passes). Corrected listener,
guard and socket suites pass: **96 tests in three files**, repository default
timeout on Kubuntu, at most three workers. Four accepted red drills revert
the destination to `empty`, remove destination separation, remove site and
remove Origin individually. The last two fail the new HTTP and WebSocket
foreign-site/origin cases. All restore the production source byte-exact:
[review drill receipts](m110-n-review-drills.json).

H08 is fixed in `attendance.ts`: first accepted verification and latest
authenticated activity are monotonic anchors. Remaining attendance is
`min(idle maximum, absolute maximum, idle maximum - elapsed since activity,
absolute maximum - elapsed since verification)`; wall-clock expiry fields
never set its length. Reverification refreshes activity and retains the first
anchor. Future creation/activity and already expired metadata fail closed;
the shared schema enforces both recorded lifetime maxima. Expired identities
cannot be revived by querying attendance or reattaching the same id. A1 must
detach identities after ending their actual sessions; until then retained
anchors count toward the existing 100-session cap. Lock/Stop endAll clears
them. This uses existing shared core behavior for all editor/runtime callers.

New regressions cover backward wall-clock steps before and after attach,
verification close to a metadata expiry, repeated activity up to the absolute
boundary, expired first attachment and both over-long verifier lifetimes.
The original attendance source is replayed as a red drill against the final
tests; no raised timeout is used. The wall timestamp and expiry checks have
redundant schema ordering, so their paired removals are documented together
in the review receipts. Other drills independently remove idle/absolute
elapsed bounds, reset the first anchor, suppress activity refresh and allow
expired identity revival. Existing lifetime schema guards are also removed
individually to prove the over-long verifier cases fire. Every restored hash
matches the final production source.

**Named residual `M110N-packed-replace-ref` (RVM110NG P3):** `gitSnapshot.ts`
rejects loose replacement refs but still imports packed replacement refs.
Safe for now: all `NodeGitRunner` operations prepend `NODE_GIT_OPTIONS`,
including `--no-replace-objects`, and current commands ignore replacement
objects. Existing `nodeMethods.test.ts` asserts that fixed option and the
Git runner still prepends the fixed options for each child. Follow-up: N/U1
reject packed replacement refs in the bounded FD-held importer, add a packed
replacement regression/red drill, and qualify before expanding the invocation
surface. PLAN §9 records the same residual. No P1 or P2 is deferred.

| Finding                           | Result                                    | Regression / verification                                                                                                                    | Red drill                                                                 |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| P2 H07 browser WebSocket metadata | Fixed                                     | `nodeListenerGuard.test.ts`: browser destination and both transports' foreign-site/origin cases; local TLS upgrade in `nodeListener.test.ts` | Four `H07-review-*` receipts                                              |
| P2 H08 session attendance         | Fixed                                     | Seven added `nodeLifecycle.test.ts` cases: rollback, verification origin, repeated activity, future/expired and over-long verifier metadata  | Eleven `H08-review-*` receipts, including original-source replay          |
| P3 packed replacement refs        | Named residual `M110N-packed-replace-ref` | `nodeMethods.test.ts` asserts `--no-replace-objects`; `nodeGitRunner.test.ts` verifies the current closed runner                             | No new packed-ref drill; importer regression/drill is the named follow-up |

### FIXM110N2 final verification

Kubuntu Linux x86_64, Node **v24.18.0**, repository-default test timeout.
The final scoped runs use `npx vitest run <files> --maxWorkers=3`, three files
per invocation, with `TMPDIR` pointing only to this worktree's
`temp/verification`. No test filter, skip, timeout override or gate change.

- Listener guard/socket/HTTPS: **96 tests**.
- Attendance/lifecycle, service and commands: **54 tests**.
- Git runner, shared method contracts and shipped bundle: **53 tests**.
- Total: **203 tests in nine files**, pass. **15** accepted review drills
  (H07 four, H08 eleven), all named failures and equal restored SHA-256 hashes.
- `npm run typecheck` (five projects), changed-file ESLint with zero warnings,
  changed-file Prettier, `npm run deadcode` (two existing configuration hints),
  `npx jscpd` (zero clones) and `npm run check:l10n` (14 tables, 164 manifest
  strings, zero problems): pass.
- `npm run build`: pass, including unchanged size/split/global/notices gates.
  Node **64.9/75 KiB**, shared validation **41.2/50 KiB**, ACP **817.9/850 KiB**,
  extension **437.0/600 KiB**, Model API **447.0/475 KiB**, browser startup
  **896.2/900 KiB**, deferred JS **49.7/50 KiB**.
- `npm run check:host-api`: **exit 1**, the same eleven J-owned import-count
  rows listed in the listener continuation above. Counts of VS Code APIs
  (332), importers (31), built-ins (25) and theme variables (61) are unchanged.
  J/lead must regenerate/review that snapshot in integration; this is not
  reported green. PLAN §7 retains the full-quality delegation to the lead.

The duplication gate initially caught the repeated fresh-session setup in two
regressions; they now share one test-only fixture helper. Lint also rejected
the temporary-array form of the attendance projection; a plain bounded loop
keeps the existing ES2023 API surface. The final receipt hashes cover that loop.
No dependency was added or installed. No merge, push, rebase, live/paid model
call, credential read or machine setting change. Local commits keep hooks on.
