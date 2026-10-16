# ChatGPT grant lock without a fixed TCP port (LOCKPORT)

Worktree `/home/randy/lanes/LOCKPORT`, branch `fix/chatgpt-grant-lock`,
base `898a26c5e` (release 0.18.2).

## The measured case

On the owner's Windows 11 PC (WSL and Hyper-V installed), published
`muse-spark-code-acp` 0.18.2, `providers add chatgpt` printed "Continue in
your browser to sign in." then "ChatGPT is temporarily unavailable. Try
again." (exit 1), twice, before any browser opened. A step logger showed
`listen EACCES: permission denied 127.0.0.1:49953` both times.

49953 was the product's own fixed port: `CHATGPT_REFRESH_LOCK_PORT`
(`src/shared/constants.ts:298` at base). `src/runtime/chatGptRefreshLock.ts`
took "one machine-wide grant lock" by listening exclusively on it before
every sign-in and token refresh. On that PC Windows reserves 49950-50049
(`netsh interface ipv4 show excludedportrange protocol=tcp`: 17 ranges).
The lock's `listen()` mapped every non-EADDRINUSE error to
`ChatGptSignInError('request-failed')`, which the person reads as
"temporarily unavailable". The ChatGPT plan could never be signed in or
refreshed on such a PC, and nothing said why.

## What changed

- `src/runtime/chatGptRefreshLock.ts` (rewritten): the grant lock by NAME,
  not by TCP port. Windows: exclusive named pipe
  `\\.\pipe\muse-spark-chatgpt-grant-<scope>` (a pipe that exists has a live
  holder; the OS removes a crashed process's pipe with its last handle).
  macOS/Linux: Unix domain socket `<tmpdir>/muse-spark-chatgpt-grant-<scope>/grant.lock`
  (folder created mode 0700). `<scope>` is 16 hex chars of the SHA-256 of
  `uid:<uid>` (POSIX) or `user:<username>` (Windows), so the lock is scoped
  to the person (their own credential store), not the machine.
- Stale socket files: a bind that reports EADDRINUSE probes the path with a
  connection. Answered: live holder, wait and retry. Refused/absent/not-a-
  socket (ECONNREFUSED/ENOENT/ENOTSOCK): crashed holder, unlink and bind;
  the OS grants the bind to exactly one racing contender, so there are never
  two holders. Any other probe failure is a local failure with its OS code.
- Kept behaviour: retry every `CHATGPT_REFRESH_LOCK_RETRY_MS` (100 ms),
  deadline `timeoutMs ?? OAUTH_CODE_TTL_MS`, caller abort, fail closed
  (deadline/abort/contention-timeout still `request-failed`).
- New `ChatGptSignInError('lock-unavailable', reason)` (`src/core/
providers/subscriptions/chatgpt.ts`): `reason` is the OS code (EACCES,
  EPERM, ENOTDIR, …). `createRuntimeChatGptHost` rethrows it unchanged
  (`src/runtime/chatGptHost.ts`); the command text maps it to the new
  `UI_TEXT.acpChatGpt.lockUnavailable` template filled with the reason
  (`src/runtime/chatGptProviderCommands.ts`), including the ACP
  `verify` path. New strings in `src/shared/l10n/en.ts` and all 14
  `l10n/ui.*.json`, each in the same relative position (last inside
  `acpChatGpt`) so the pack-time order check holds.
- `CHATGPT_REFRESH_LOCK_PORT` is gone from `src/shared/constants.ts`;
  `ChatGptLockOptions.port` is now `ChatGptLockOptions.directory` (POSIX
  folder override; tests isolate with it).
- Nothing else changed. The VS Code sign-in keeps its global-storage file
  lock (`src/host/providers/chatgptSignIn.ts:183-248`); every OAuth callback
  listener keeps its OS-chosen port (sweep table below).

## How other tools serialize OAuth refresh (primary sources, read 2026-10-14)

- Codex CLI (`openai/codex`, main): NO cross-process serialization. Refresh
  is guarded only by in-process `std::sync::{Mutex,RwLock}`
  (`codex-rs/login/src/auth/manager.rs:200` holds
  `auth_dot_json: Arc<Mutex<Option<AuthDotJson>>>`;
  `refresh_token_from_authority_impl` at `:2916`, persist at `:3114`), and
  `FileAuthStorage::save` (`codex-rs/login/src/auth/storage.rs:215-232`)
  does a plain truncate-and-write of `~/.codex/auth.json` (mode 0600, no
  temp+rename, no lock). OpenAI rotates the refresh token on every refresh,
  so two concurrent processes can burn each other; their own
  `REFRESH_TOKEN_REUSED_MESSAGE` (`manager.rs:208`: "your refresh token was
  already used") is that failure mode. Third-party readers refuse to write
  for exactly this reason.
- oauth2client, the gcloud-heritage Python OAuth client
  (`googleapis/oauth2client`, master): cross-process file lock.
  `oauth2client/contrib/multiprocess_file_storage.py:200-201` holds
  `fasteners.InterProcessLock('<file>.lock')` (fasteners: fcntl on POSIX,
  LockFileEx on Windows), acquired with a 1 s deadline
  (`INTERPROCESS_LOCK_DEADLINE = 1` at `:92`, `acquire(timeout=…)` at
  `:226`); on timeout it falls back to read-only (refresh in memory, do not
  write). One lock per credential key (user/client/scopes); a refresh by one
  process makes the others re-read instead of re-requesting (`:28-30`).
- VS Code's Microsoft auth extension (`microsoft/vscode`, main):
  in-process promise-chain sequencer only.
  `extensions/microsoft-authentication/src/node/
cachedPublicClientApplication.ts:35` holds `_sequencer = new Sequencer()`;
  the `Sequencer` (`:381-388`) chains every acquisition, and every
  `acquireTokenSilent` (`:117`, also `:134`, `:151`) and
  `acquireTokenByRefreshToken` (`:217`) goes through `this._sequencer.queue`.
  Across processes/windows it relies on the native broker when available
  (`:20-33`) and the SecretStorage-backed MSAL cache
  (`src/common/cachePlugin.ts`); no OS-level cross-process lock in the
  extension itself.

Our choice (exclusive listener, no `.lock` file, no broker) fits this
product: the ACP agent has no broker, and a listener — unlike a lock file —
needs no stale-lease bookkeeping on Windows at all.

## Fixed-port sweep (every `listen(`/`connect(` in `src`, plus port constants)

Changed:

- `src/runtime/chatGptRefreshLock.ts` — was the only fixed local TCP port
  (49953). Now a named pipe (Windows) / OS-user-scoped socket (POSIX).

Kept, with the reason each cannot collide:

- `src/host/providers/chatgptSignIn.ts:67` (VS Code callback),
  `src/runtime/chatGptCallback.ts:114` (ACP callback),
  `src/host/providers/oauthLoopback.ts:144` (generic OAuth callback),
  `src/host/mcpLoopback.ts:60` (`listenLoopback`, also serving
  `src/host/ide/ideMcpServer.ts:191` and `src/host/team/mcpBridge.ts:517`),
  `src/host/team/teamMcpServer.ts:269`, `src/runtime/companion/server.ts:297`,
  `src/core/browser/checkProxy.ts:450` — all `port: 0` / `listen(0, …)`: the
  OS picks the port, so a reserved range never refuses them.
- `src/core/browser/canaries.ts:104-225` — binds port 0 first, then reuses
  only that OS-picked port on the other loopback addresses.
- `src/host/backend/mcpJobLaunch.ts:256` — named pipe with a random UUID per
  launch (`muse-spark-mcp-<uuid>`), no TCP.
- `src/host/team/processLifetime.ts:864` — Windows-only named pipes with
  per-launch random owner/status names, no TCP.
- `src/core/vault/ssh/endpoint.ts:21-46` — socket path with a fresh random
  token per endpoint (`s-<token>.sock`) or an owner-only Windows pipe; an
  existing pathname is never replaced.
- `src/core/vault/exec/helpers.ts:165-190`,
  `src/core/vault/broker/channel.ts:232-248` — listen on caller-supplied
  socket paths (per-session directories such as
  `broker-v<ver>-<session-hex>` in `discovery.ts:23`), never a fixed TCP port.
- `WEB_FETCH_DEFAULT_PORT = 443` (`constants.ts:2624`) — a URL default, not
  a listener. `RUNNER_PORT_MAX = 65535` (`constants.ts:2928`) — a zod upper
  bound for a user-configured team-runner port (`src/shared/team.ts:806`),
  not a listener.
- No `.connect(`/`createConnection` to a fixed TCP port anywhere in `src`
  (only API-object `connect()`s and the lock's own socket probe).

## Red and green

- RED (real old code, isolated worktree of base `898a26c5e` under
  `$TMPDIR/old-base`, `$TMPDIR/red-drill.cjs`): another listener holds
  127.0.0.1:49953, old `withChatGptRefreshLock(work, { timeoutMs: 800 })`
  rejects with `chatgpt.request-failed`. Output: `RED: old lock rejected:
chatgpt.request-failed`, exit 0 (expected outcome).
- GREEN counterpart (new code, `$TMPDIR/green-drill.cjs`, port held the same
  way): the new lock never touches the port; in this sandbox it stops at the
  sandbox's own socket block with `chatgpt.lock-unavailable reason=EINVAL`
  (the lane's 130-char TMPDIR overflows `sun_path`; real tmpdirs are short).
  Full green (two processes serialize, SIGKILL release, stale replacement,
  deadline fail-closed) is committed in `test/unit/runtimeChatGptLock.test.ts`
  and runs outside the sandbox (see sandbox note).
- Committed regression test `takes the lock while the old fixed TCP port is
held by another listener` fails on the old code (deadline,
  `request-failed`) and passes on the new code.

## Packed-product run (this Linux machine)

`npm run build` green (budgets intact), then built `dist/acp.js` under a new
empty HOME (`temp/pp-home`, short lane-owned TMPDIR `temp/pp-tmp`) with
127.0.0.1:49953 held by another listener (`$TMPDIR/packed-proof.cjs`):

- stdout: `ChatGPT Plus or Pro is required. … Continue in your browser to
sign in.`
- stderr: `The local sign-in lock could not be opened (EPERM). Try again.`
- exit 1. No provider was contacted (the lock comes before discovery).

In this sandbox that is the complete run: `AF_UNIX` is blocked (see below),
so the lock cannot open here. Outside the sandbox the same run is expected
to print the sign-in address and wait (Ctrl-C to stop), fetching only the
public discovery document — the lead re-runs it there, plus the Windows case
on the owner's PC with this branch's build.

## Sandbox note (measured, both directions)

This sandbox blocks `AF_UNIX` entirely: `socket(AF_UNIX)` fails `EPERM` in
Node and Python, in `/tmp`, the worktree `temp/`, and `$TMPDIR` alike,
while TCP loopback binds fine (even 49953). It also routes `fetch()` through
`HTTP_PROXY=http://127.0.0.1:39881`, so `fetch` to loopback fails while raw
sockets connect.

- `test/unit/runtimeChatGptLock.test.ts` here: 2/8 pass (the local-failure
  sentence test and the cancelled-acquisition test — both through the real
  module). The 6 socket tests need AF_UNIX: lead runs them outside.
- `test/unit/runtimeChatGpt.test.ts` here: 29 fail / 6 pass on this tree
  (fast `lock-unavailable` at bind, 6.4 s). On the untouched base in the same
  conditions the same file also fails 29/35 — slowly (150 s): the
  sandbox-broken `fetch` handoff hangs the first test while it holds the
  fixed port, and every later test starves on EADDRINUSE. Measured with
  isolated runs: each failing test passes alone on base. That cascade is the
  fixed-port design failing exactly as reported; per-test socket dirs in the
  new tests remove the shared-port coupling by construction.
- `test/unit/acpAgent.test.ts` here: 142/143 pass; the one failure is the
  ChatGPT-actions test failing with the NEW honest text end to end
  (`Authentication required: The local sign-in lock could not be opened
(EINVAL). Try again.` — EINVAL from the lane's overlong TMPDIR). It passes
  on base here. Lead re-runs outside.
- `npm run security:sast` cannot run: `semgrep is not installed: pip install
-r .github/semgrep/requirements.txt`.

## Gates on the final tree

`npm run typecheck` (all 5 projects) clean; ESLint and Prettier clean on all
changed files; `npm run check:l10n` 0 problems; `npm run check:reference`
current; `npm run deadcode` exit 0; `npm run cycles` no cycles;
`npm run duplication` 0 clones; `npm run security:audit` exit 0;
`npm run build` green (incl. bundle-size and bundle-split). No
`eslint-disable`, `@ts-expect-error`, `as` cast or `any` added (no PLAN.md
§8 row needed).

## Real-life scenario for the lead

1. On the owner's PC: `muse-spark-code-acp providers add chatgpt` prints the
   notice, opens the browser at the authorize URL, and completes sign-in
   (the reserved-range EACCES is gone).
2. With two shells racing `providers status chatgpt`, both answer; racing
   `add` never double-signs-in.
3. If the lock folder is made uncreatable, the command prints `The local
sign-in lock could not be opened (<CODE>). Try again.` — never
   "temporarily unavailable".

---

# Host-ID follow-up (HOSTID, branch `fix/chatgpt-host-id`)

Worktree `/home/randy/lanes/HOSTID`, from LOCKPORT's head `791395dc2`.

## The cause

With the lock fixed, the lead's run printed the authorize address and
OpenAI's authorize endpoint answered:

`{"error":{"message":"Invalid authorize request","type":"invalid_request_error","param":"ext_agent_host_id","code":"invalid_authorize_request"}}`

Our app sent `ext_agent_host_id` as a bare 22-character random string
(`chatgpt.ts` `hostId`, validated with `isPkceState` like a PKCE value).
OpenAI's token-sharing documentation
(`https://developers.openai.com/siwc/token-sharing-open-source`, read
2026-10-14) accepts only three forms and ours is none of them:

- "`urn:ietf:params:oauth:jwk-thumbprint:…`", "Recommended ... Derive the
  URI from the host's public key using RFC 9278";
- "`urn:uuid:…`", "Supported alternative. Generate a UUID and store its
  URI once for the host's lifecycle";
- "`did:key:<key>`", "Use `did:key`, not another DID method".

Further: "Choose and persist the host ID before its first sign-in.",
"each host must have its own distinct host identifier.", "Use an opaque
value, not an email, user ID, or other user-identifying value." The
registration page shows `"ext_agent_host_id": "urn:uuid:..."` and says to
send the same value for the same host.

## What changed

- New `urn:uuid:<UUIDv4>` host id, generated once per host and persisted
  (`isChatGptHostId`, `createChatGptHostId`,
  `src/core/providers/subscriptions/chatgptHostId.ts`). The JWK
  thumbprint form was not chosen: our host has no key pair, and the docs
  call the thumbprint "an identifier only" that OpenAI does not verify,
  so it would add key management for nothing.
- Every creator, store, validator and sender follows:
  `buildChatGptAuthorizeUrl` (sends it, rejects the old form),
  `createRuntimeChatGptHost` (OS-store slot, terminal/ACP),
  `loadChatGptHostId` (new `src/host/providers/chatgptHostId.ts`,
  the `chatgpt.host-id` file, VS Code). The record schema
  (`chatGptRecordSchema.hostId`) stays open: a stored grant is never
  re-parsed against the new shape, and refresh never sends the id.
- Migration: a stored bare-random id is replaced in place with a fresh
  documented one before the next sign-in; anything else unparseable is
  still rejected, never repaired. An issued `client_id` survives the
  migration with no re-authorization: the docs bind it "to the
  authenticated user and the workspace", and "a single client can have
  multiple hosts ... each has its own host ID". The locally derived
  account key (`chatGptAccountId`, a hash of the record's host id)
  follows the stored record on the next sign-in.
- Refusal sentence: the callback's `error` now validates `state`, stops
  without exchanging a code, and throws
  `ChatGptSignInError('authorize-refused', <OpenAI's error code>)`,
  shown as `OpenAI refused the ChatGPT sign-in request ({reason}). …`
  (new `UI_TEXT.acpChatGpt.authorizeRefused` in all 14 locales, last
  inside `acpChatGpt`). One honest limit is recorded: the measured
  direct-JSON refusal (`invalid_authorize_request`, param
  `ext_agent_host_id`) is answered to the browser, never to our loopback
  callback, so the sentence carries OpenAI's error code from the
  callback redirect; after this fix that refusal cannot recur.
- Bundle diet (measured): the helpers first dragged the whole sign-in
  core into `dist/modelsPanel.js` (123.4 → 125.4 KiB, over its 125 KiB
  budget). The id, validator and failure codes now live in a
  dependency-free module the panel reaches through the externalized
  subscriptions bundle; the module joined the split guard's
  subscription sibling list with drill rows. Panel is at 123.6 KiB;
  `npm run build` is green.

## Red and green

- RED: `isChatGptHostId` weakened to accept long strings —
  `test/unit/chatGptHostId.test.ts` fails 5 assertions (old id accepted,
  old URL built, migration skipped); reverted byte-exact (SHA-256
  `fdc22de6…` before and after).
- GREEN: `test/unit/chatGptHostId.test.ts` 13/13 (format, persistence,
  old-id migration in a real temp folder, refusal sentence) through the
  real modules, no stand-ins.

## Platform tests

- This sandbox blocks `AF_UNIX` (`socket(AF_UNIX)` → `EPERM`, measured
  with `node:net` listen in the worktree `temp/`): the 6 socket lock
  tests cannot run here. The 2 lock tests that need no socket pass, and
  the Windows pipe case correctly skips.
- `test/unit/runtimeChatGptLock.test.ts`: socket-file cases now run
  only off Windows (`runIf`); Windows gets its own pipe crash-recovery
  case (worker holds the pipe, SIGKILL, re-acquire, no `lstat`) and its
  own pipe local-failure case. The failure trigger is grounded in
  libuv 1.52.1 `src/win/pipe.c` `uv_pipe_bind2` (fetched): an occupied
  name fails `CreateNamedPipe` with `ERROR_ACCESS_DENIED` → `EADDRINUSE`
  (contention, retried), while `ERROR_INVALID_NAME`/`ERROR_PATH_NOT_FOUND`
  → `EACCES`, which the unchanged lock already reports as
  `lock-unavailable` with its OS code. The lock takes a Windows-only
  `pipeName` override (the POSIX `directory` option's counterpart, same
  test-isolation legitimacy); the case passes an empty name no object
  can carry, so the kernel itself refuses the bind. The assertion is
  code-agnostic (`lock-unavailable` + string reason carried into the
  sentence, never "temporarily unavailable"), so whichever refusal
  Windows reports is the one checked. NOT RUN HERE: both Windows cases
  skip on Linux (verified); the lead runs this file on the owner's PC,
  where the new case's output names the actual Windows code.
  Contention on the real pipe stays covered by the live-holder test.
- Stale-socket Linux failure: the lock path is proven by the passing
  crash test (same EADDRINUSE → refused-probe → unlink → bind
  sequence), and Node's own `lib/net.js` (v24.21.0, fetched) performs no
  unlink on `close()`, so the setup — bind, graceful close, expect the
  file — is where it breaks, not the lock. The drill now builds the
  file the way production does (a child binds a raw socket and is
  SIGKilled; no cleanup runs), which the crash test already proves
  leaves the file.
- Suite fixtures migrated to the documented form (fixture values only,
  no test logic changed): `chatGptSignIn.test.ts` `HOST` is now
  `urn:uuid:12345678-1234-4234-8234-123456789012` — back to 105/105
  here. `runtimeChatGpt.test.ts`'s record fixture likewise, and its
  installation-id regex now asserts the `urn:uuid:` shape; in this
  sandbox that test still stops at the blocked lock
  (`chatgpt.lock-unavailable`, never reaching the assertion), so the
  regex itself is verified by the lead's outside-sandbox/Windows run.
  `chatGptVsCode.test.ts` needed no migration (dynamic ids only).
  Unchanged in-sandbox: `runtimeChatGpt.test.ts` 29/6 and
  `chatGptVsCode.test.ts` 9/17 before and after (sandbox socket/fetch
  cascade); `subscriptionIntegration` + `configuredProviders` 5 fail
  identically on the untouched base in the same sandbox (measured in
  a base export under `$TMPDIR`).

## Packed-product run (this Linux machine)

`npm run build` green, then built `dist/acp.js` under a new empty HOME:
`providers add chatgpt` prints the notice, then `The local sign-in
lock could not be opened (EINVAL). Try again.` (exit 1) — the sandbox
blocks the lock before discovery, so no authorize address prints here.
Through the packed `dist/subscriptions.js` itself (no network, no
lock): created id has shape `urn:uuid:<uuidv4-redacted>` (45 chars),
accepted; the old bare-random id and an email rejected; the packed
parser throws `authorize-refused` with reason `access_denied`. No
request to OpenAI beyond the public documentation pages. The lead
re-runs the authorize-address run outside the sandbox (Ctrl-C to stop).

## Gates on the final tree

`npm run typecheck` clean; ESLint and Prettier clean on changed files;
`npm run check:l10n` 0 problems (key order verified English-last in all
14 tables); `npm run check:reference` current; `npm run deadcode` exit
0; `npm run cycles` no cycles; `npm run duplication` exit 0;
`npm run security:audit` exit 0; `npm run build` green (incl.
bundle-size and bundle-split). `npm run security:sast` cannot run:
`semgrep is not installed: pip install -r
.github/semgrep/requirements.txt`. No `eslint-disable`,
`@ts-expect-error`, `as` cast or `any` added (no PLAN.md §8 row
needed). `test/e2e/execStdio.e2e.test.ts` 46/46. Follow-up re-verified
after the fixture migration and pipe option: typecheck clean, ESLint
and Prettier clean on changed files, duplication exit 0, build green
(modelsPanel 123.6 KiB), `chatGptSignIn.test.ts` 105/105.

## Real-life scenarios for the lead

1. Outside the sandbox with an empty HOME: `providers add chatgpt`
   prints the authorize URL whose `ext_agent_host_id` is
   `urn:uuid:…`; completing it in the browser signs in (OpenAI accepts
   the form), and a second run keeps the same host id.
2. With an old-format id already stored, the next `providers add
chatgpt` migrates the stored value in place and signs in with the
   new one; an existing grant keeps working (refresh never sends the
   id).
3. A refused authorize request (e.g. declined consent) ends with
   `OpenAI refused the ChatGPT sign-in request (access_denied). …` —
   never "temporarily unavailable".

## RVHOSTID: callback refusal propagation (2026-10-14, Windows)

Both real callback adapters caught `authorize-refused` and replaced it with
`invalid-callback`, losing the reason HOSTID's parser had validated. The runtime
listener regression returned HTTP 400 and `invalid-callback` before repair (exit
1); preserving only `ChatGptSignInError` through each adapter keeps the reason
without exposing arbitrary error text. Runtime listener + host-id tests pass 14/14
(exit 0). Deliberately discarding the typed failure fails that same real-listener
assertion (13 pass, 1 fail, exit 1). Byte-exact restored SHA-256:
`7E6B1611687641E1B28D996B6699D845808BC36133720D617AB1DFD9F167DB74`.
Restored host-id + codec + pure plan-error cases: 41/41, exit 0. Receipts:
`.lane/callback-red.log`, `.lane/callback-drill.log`, `.lane/fixes-green.log`.
The final adapter preserves `authorize-refused` only; malformed/state failures
retain the previous invalid-callback contract. Final deliberate removal: 13 pass,
1 fail, exit 1; restored callback + host-id + keyring suites 40/40 (exit 0),
SHA-256 `B70050DBD55C26CA15314E30DA40BD47F96C23CC4A309B7CD36513D6E57BE42D`
identical. Logs: `.lane/callback-final-drill.log`,
`.lane/callback-final-restored.log`. Real callback + capability suite 67/67.
The VS Code adapter is source-reviewed; no replacement editor API was used.
The panel's separate generic-error presentation remains an open review finding.
Runtime host creation now preserves every validated sign-in error, including a
corrupt host id's `invalid-token`, instead of turning it into `request-failed`.
The OS-only keyring suite passes 8/8; reinstating the old catch produces the
intended failure (7 pass, 1 fail, exit 1), restored 8/8, exit 0. Host SHA-256
before/after `27A4B9B3FDA5C0AC0F1A360E6608AB2A0A7C8949578CC444BEB25E7271352007`.
Receipts: `.lane/host-error-drill.log`, `.lane/host-error-restored.log`.
The real Windows store case uses a unique throwaway test account only.
No sign-in, live stored grant access or provider request was made.

## F78: the record did not fit Windows Credential Manager (lead, Windows, 2026-10-14)

Found by using the build of this branch for real on Windows (this PC), with
the owner approving the sign-in in the browser three times (12:30 to
12:33 PM PT):

- Every attempt ended with "ChatGPT is temporarily unavailable. Try again."
  and `providers status chatgpt` then said "ChatGPT is not signed in."
- Node's own request log (`NODE_DEBUG=undici`, addresses and statuses only)
  showed the discovery document, the token exchange and the signing keys
  all answering HTTP 200, and no request after them.
- A value-blind diagnostic preloaded with `node --import` (it printed only
  field names and yes/no comparisons) showed the ID token passes every
  check: issuer, audience contains the client id sent, nonce equals the
  sign-in address's, expiry an hour away, RS256 key found in the JWKS.
- The printed sentence is `planUi.retry`, the text of `request-failed`, not
  the ID-token failure's. The next step after the check is saving the
  record.
- Measured with throwaway values through `@napi-rs/keyring` (the agent's
  binding): Windows Credential Manager accepts 1,280 characters and refuses
  1,281 with "Value of 'password encoded as UTF-16' is longer than the
  platform limit of 2560 chars". `storeOperation` turned that into
  `StoreUnavailableError`, and the sign-in core's guard reported any
  foreign error as `request-failed` (finding F14).

Fix:

- `keyringSecretStore` (the one place the agent opens the OS store) keeps a
  value longer than `KEYRING_PART_CHARS` (1,200), or one that starts with
  the parts tag, as parts written first under names carrying the value's
  hash, then a header (`muse-spark-parts:v1:<count>:<sha256>`) written
  last; reading reassembles and verifies the hash; replacing or deleting
  removes the parts it replaces. Short values are stored and read exactly
  as before.
- `createRuntimeChatGptHost` maps a store refusal to `store-unavailable`
  (its own sentence), never the generic retry.

Proof:

- `test/unit/keyringParts.test.ts`: 7/7 on Windows, including one case
  through the real Windows Credential Manager with a 3,000-character
  throwaway value. The other cases use a stand-in for the operating system
  that refuses what Windows refuses, word for word.
- Red drill: with `src/runtime/keyStore.ts` put back to the previous
  commit, 5 of the 7 fail (the real-store case among them); restored
  byte-exact (SHA-256 prefix compared).
- On this tree: `typecheck:unit` 0, ESLint 0 and Prettier 0 on the changed
  files, `build` 0, `deadcode` 0, `cycles` 0, `duplication` 0,
  `check:reference` 0, `check:host-api` 0 after regenerating its import
  counts (this branch's new files had changed them).
- `test/unit/runtimeChatGpt.test.ts` keeps its 2 Windows-only failures
  measured before this change ("The local sign-in lock could not be opened
  (unknown)"); the real `providers status chatgpt` from this build opens
  the lock on the same PC. The test overhaul deletes that file.

---

# PLANFIX R1 + R5: one owner per credential account (2026-10-14, Windows)

**RVPLANFIX correction (2026-10-16).** The original worker used the production
service, and `findCredentialsAsync(KEYRING_SERVICE)` returns passwords, not
names alone (`@napi-rs/keyring`'s `Credential` contains `account` and `password`).
Therefore the original run cannot support the claims below that other entries
were never read. The worker and enumeration now use only
`Muse Spark Code (Unofficial).test.<random scope>`, including cleanup. No original
unsafe enumeration is rerun as a red drill. Fresh isolated-service results are
recorded in `.lane/RVPLANFIX.report.md`; the historical counts below remain
historical, not fresh verification.

## RVPLANFIX: reads must reclaim too (2026-10-16, Windows)

The original `get` returned a short or absent primary without becoming an
owner, and a long read took ownership without reclaiming. A read could therefore
be the next operation after a crash yet leave the generation journal and orphaned
parts indefinitely. All reads now take the existing account lock and reclaim
before returning, including absent-value reads. This supersedes the lock-free
short-read description below; no new lock mechanism was introduced.

The isolated-service native suite was extended to inspect entries immediately
after recovery reads, before any write/delete could hide the defect. With the
old read path deliberately restored: 4 passed, 2 failed, exit 1 (orphan journal
at first-write call 3; five entries instead of four at replacement call 12).
The fixed source SHA-256 is
`0F6591990C07D8DD64AD990247C209554803C7AC5889AFA7A8A5DABC6FF17BB5`.
Fresh restored run: `npx vitest run test/unit/keystoreOwner.test.ts --maxWorkers=2`,
6 passed, exit 0. Receipts: `.lane/RVPLANFIX-read-reclaim-red.log` and
`.lane/RVPLANFIX-read-reclaim-final.log`. These runs use only the separate random
test service, never production-service enumeration.

## Design (written before the code)

**The defects (RVHOSTID R1, R5).** `keyringSecretStore` (`src/runtime/keyStore.ts`)
keeps a long secret as parts plus a header. Nothing serializes two writers, a
reader and a writer, or a writer and a delete, across processes:

- R1: writer A writes X's parts and pauses before publishing X's header; writer B
  writes Y, publishes Y, deletes X's parts; A publishes X's header and returns
  success. The account now holds a header whose parts are gone: every read throws.
- R1 (reader): a reader holds X's header while a replacement deletes X's parts.
- R5: a failure or a crash after some parts and before the header, or after the
  header and before the old parts are removed, leaves parts no header names;
  `delete(key)` only knows the parts the current header names.

**One owner per account, across processes.** Every write, delete and long-value
read takes a lock named after the account, by the existing lock-by-name
mechanism (Windows: an exclusive named pipe; macOS/Linux: a socket in the
person's private folder), on a name of its own (`muse-spark-keystore-<person>`,
file `<8 hex of the account's SHA-256>.lock`), never the ChatGPT grant lock:
the grant lock is held across a whole sign-in or refresh, which itself reads and
writes the store, so sharing one name would deadlock. The mechanism moves from
`chatGptRefreshLock.ts` to `namedLock.ts` unchanged in behaviour (the store
cannot import the grant lock's module: that one imports the store's error type,
a cycle). The OS releases a crashed owner's lock; a hung owner makes waiters
fail closed (`StoreUnavailableError`) after `KEYSTORE_LOCK_TIMEOUT_MS`.
A short value read stays lock-free: a plain value is one atomic OS read, and the
Model API key is read per request. Only a header sends the reader to the lock.

**Generation records that survive a crash.** A generation is the parts of one
long value, named by its hash (`<key>#<hash12>.<i>`, as before). Before the
owner changes anything that can leave parts behind, it writes a record
`<key>#gens` (`muse-spark-gens:v1:<hash12>.<count>,…`) naming every generation
that may hold parts: the one the header names now and the one it is about to
write (or, for a delete or a long-to-short write, the one it is about to drop).
It writes the new parts, then the header (the single publication point), then
removes the generation the header no longer names, then deletes the record.
A clean account has no record. The record holds hashes and counts, never a part.

Every owner, before its own work, reclaims: it reads the header and the record,
removes the parts of every generation the record names that the header does not,
and deletes the record. So a crash at any step is found and cleaned by the next
owner of that account:

| killed after              | header names | next owner                                      |
| ------------------------- | ------------ | ----------------------------------------------- |
| record written            | old          | removes the new generation's parts (maybe none) |
| some or all parts written | old          | removes them                                    |
| header written            | new          | removes the old generation's parts              |
| old parts removed         | new          | deletes the record                              |
| delete: header removed    | none         | removes every named generation                  |

**Readers never see a deleted generation.** A header read without the lock
sends the reader to the lock, which waits for any owner; it reads the header
again under the lock and assembles that generation. Parts are removed only by
an owner, only after the header stopped naming them, and never while a
reader holds the lock. A part missing under the lock is damage, refused as
before.

**Delete order.** Header first, so the account reads as absent; then the
parts; then the record. A crash after the header leaves the record naming
what to remove.

## What was built

- `src/runtime/namedLock.ts` (new): the pipe/socket lock of
  `chatGptRefreshLock.ts`, moved unchanged in behaviour (`withNamedLock`,
  `personScope`). `chatGptRefreshLock.ts` is now only the grant's own name on
  it. No new lock kind.
- `src/runtime/keyStore.ts`: `keyringSecretStore(open, { lockScope? })`. Every
  `store` and `delete`, and the read of a header, runs inside the account's
  lock; `reclaim` runs first in every owner; the generation record
  `<key>#gens` is written before any part and deleted last. A lock that
  cannot be had (timeout `KEYSTORE_LOCK_TIMEOUT_MS`, 30 s, or a local failure)
  is `StoreUnavailableError`, never a partial write. A short value read is
  still one lock-free OS read. `lockScope` exists so the proof's processes
  share a throwaway lock name that no real account shares.
- `src/shared/constants.ts`: `KEYRING_GENERATIONS_SUFFIX`,
  `KEYRING_GENERATIONS_TAG`, `KEYSTORE_LOCK_PIPE`, `KEYSTORE_LOCK_DIR`,
  `KEYSTORE_LOCK_ACCOUNT_CHARS`, `KEYSTORE_LOCK_TIMEOUT_MS`.

## Proof: the real keyringSecretStore, the real Windows Credential Manager

`test/unit/keystoreOwner.test.ts` bundles the real `src/runtime/keyStore.ts`
with esbuild and runs it in real child processes
(`test/hosts/keystore-worker.mjs`) over the real `@napi-rs/keyring`, on
throwaway accounts `museSpark.test.keystoreOwner.<uuid>` and a throwaway lock
scope. Nothing of ours is replaced. The worker adds only scheduling of the OS
calls, which a race this narrow needs to be repeatable: SIGKILL at the Nth OS
call, or a pause before the header write / after a header read. It reads no
credential and the owner's ChatGPT grant is never opened (its account name is
not used anywhere in the test).

| Case                                                                                           | What a person would suffer if it failed                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| two processes write the same account at once, four rounds                                      | one write destroys the other: the account reads as damage                   |
| a reader polls while a writer replaces the value twelve times                                  | a reader meets a deleted generation                                         |
| R1: writer A paused before its header, writer B writes meanwhile                               | A publishes a header whose parts B deleted                                  |
| R1: a reader paused holding a header, a replacement removes its parts                          | the reader is handed parts that are gone                                    |
| a replacing write killed at EACH of its OS calls (every one, measured on a live process first) | a write that was acknowledged cannot be read, or a part outlives the delete |
| a first write killed at calls 3 to 6, before any header                                        | orphaned secret parts no header names, which no delete ever removed (R5)    |

After every kill point: the account reads as the old value or the new one
(never as damage); the next owner stores and deletes it; the service then
holds no entry whose name starts with the account (`entriesOf` lists the
real store).

Results (this PC, Windows, 2026-10-14 22:4x PM):

- `test/unit/keystoreOwner.test.ts` 6/6 and `keyringParts.test.ts` 8/8
  (14/14, exit 0), after the lint fixes below. The first run failed once
  (5/6): the worker paused on the reader's first header read AND its second
  one under the lock (a read reads the header twice); the pause is now once per
  process. A test-harness defect, not the store's.
- Red drills (each file restored byte-exact; SHA-256 before and after
  `023B1CCC…F9F1` identical for the first three; final tree `9C78402F…F37D`):
  1. The previous `keyStore.ts` (HEAD): 5 of 6 fail
     (`killed at call 12: expected [ …(3) ] to deeply equal []`, `expected 'X:…'
to be 'Y:…'`, writers refused). Its first attempt printed 6/6 failed in
     60 ms each because the old file has no `lockScope` option and the
     worker could not start: that run was discarded as proving nothing.
  2. Reclamation switched off (`reclaim` returns at once): 2 fail, the two kill
     sweeps (`killed at call 17`, `killed at call 4`: parts left behind).
  3. The lock bypassed (`return await work()`): 3 fail, the concurrency cases
     (`expected [ …(7) ] to have a length of 4`, `expected [ …(3) ] to include
null`, a refused write).
- The original run reported no `test.keystoreOwner` entry left. Its enumeration
  also loaded the service's other entries' passwords; the earlier claim that
  these were counted by name only was false (see the RVPLANFIX correction).
- Dependents run: `runtimeChatGptLock.test.ts` 7 pass / 3 skipped (the POSIX
  socket cases skip on Windows), `runtimeAccountStore.test.ts` +
  `execProvider.test.ts` 20/20.
- Gates on this tree: `typecheck:host` 0, `typecheck:unit` 0, ESLint 0 on the
  six files (the first run had 32 findings, all fixed, none disabled),
  Prettier unchanged, `deadcode` 0, `cycles` 0 (3,275 files), `check:host-api` 0.

Honest limits: the proof is Windows. On POSIX the same worker would run over
the Secret Service / Keychain, which this PC cannot reach; the lock beneath is
the same mechanism the grant lock already proves on both. A killed process at
the store's OS call is a process killed between two OS calls, which is the
only granularity a crash has on a credential store; a power cut mid-call is the
OS's atomicity to give, and the record is written before the call it protects.

---

# PLANFIX R2: POSIX stale-socket recovery by ownership (2026-10-14)

## The defect (RVHOSTID R2), and a correction to this record

Earlier sections above say "the OS grants the bind to exactly one racing
contender, so there are never two holders". That holds for a bind of a free
name; it is false for the recovery that came first (probe the path, `unlink`
it, bind again). A and B both find a crashed holder's file and both probe it
dead. A unlinks it and binds a NEW live socket. B, still acting on its probe,
unlinks A's new file and binds its own. Both hold. A probe repeated before the
unlink only narrows the window: no operating system removes "this file, if it
is still the stale one" in one step.

## Design: recovery by ownership, never by a race on a shared name

`src/runtime/namedLock.ts` (POSIX branch only; the Windows pipe is unchanged,
the OS removes a crashed process's pipe with its last handle):

1. A contender never binds, probes-and-removes or recovers the lock's shared
   name. It binds a socket under a name of its own, `<file>.<6 random hex>`,
   that nobody else binds or removes.
2. It then looks at every other `<file>.*` entry in the lock's folder. An entry
   with a listener (a connection is accepted, or reset after accept, or the
   backlog is full) means another holder or contender: it closes and removes
   its own entry and waits `100 ms + 0..99 ms` (random, so two contenders that
   gave way to each other do not repeat in step) and tries again.
3. No live entry: it holds the lock. It removes its own entry when done.
4. A dead entry (connection refused, file gone, not a socket) never blocks. It
   is removed only when older than `NAMED_LOCK_GARBAGE_MIN_AGE_MS` (10 s), so
   a file whose owner has bound but not yet listened is never taken. Removal
   only ever targets a name that was bound once and is never bound again.

Why two holders cannot occur: A and B both pass only if A's look at B's entry
found it not live and B's look at A's entry found it not live. A's listener
exists before A's look and B's before B's. A's look at B's entry found no
listener, so B's listener started after it, so B's look came after A's
listener started, and B finds A live. Contradiction. The proof needs only that
`listen()` follows `bind()` within the process, which Node does in one call.
The one assumption outside it is the 10 s age: a bound-but-not-listening file
older than that is treated as a corpse, which `bind` then `listen` in one
synchronous call cannot be.

What else changed with it:

- Socket paths are held to macOS's limit (103 characters; its temp folder takes
  48). The per-contender suffix lengthened the path, so the folder and file
  names were shortened: the grant lock `muse-spark-grant-<12 hex>/grant.lock.<6 hex>`
  (96 characters on macOS) and the credential store
  `muse-spark-keys-<12 hex>/<8 hex>.lock.<6 hex>` (98). The R1/R5 commit's
  store path was 107 characters on macOS, which `bind` would have refused
  (`EINVAL`) there: measured by the arithmetic below, fixed here. A test holds
  both under 103.
- `CHATGPT_GRANT_LOCK_SCOPE_CHARS` 16 to 12. On Windows the pipe name carries
  it, so the grant lock's pipe name changed; the pipe-based lock has not been
  released (the published build used a TCP port), so no running process holds
  the old name.
- A connection that a lock listener accepts and drops reads as `ECONNRESET` to
  the prober. The first run on Linux measured it (a process failed with
  `lock-unavailable ECONNRESET`); it now counts as a live listener.

## Proof

`test/hosts/named-lock-race.mjs` (a plain node script, with
`named-lock-worker.mjs`): first it leaves dead socket files in every round's
folder the way a crash does (a process binds and is SIGKILLed): the old shared
name and a per-contender-style name. Then 6 real processes meet at the same
instant in every round (a shared start time), take the real `withNamedLock`,
and inside it create a marker file with `wx`; a second holder inside fails that
create and is counted. It exits 1 on any violation, failure or crashed process,
or if a process did not get the lock in every round.

`test/unit/namedLockRace.test.ts` runs it through vitest and checks the path
budget. `test/unit/runtimeChatGptLock.test.ts` follows the new shape (a
crashed holder leaves one entry; a dead entry never blocks).

Run on REAL Linux (Windows PC's WSL2 Arch distro, Linux 6.18.54.1-microsoft-standard-WSL2,
Node v26.9.0, on WSL's own ext4 `/tmp`; the Windows-mounted drive refuses
`AF_UNIX` with `ENOTSUP`, so the checkout was copied to `/tmp` and installed
there with `npm ci --ignore-scripts`; nothing was written outside that copy
and this worktree's `temp/`):

- OLD recovery (this lane's previous commit `5cbd65139`), 6 processes: 14 rounds
  `entered 60 of 84, violations 23, failures 1`; and a 1-round run
  `violations 2`: two holders inside the protected work at once. RED.
- NEW: 20 rounds, 6 processes: `entered 120 of 120, violations 0, failures 0`.
  (The first NEW run printed `lock-unavailable ECONNRESET` for some processes
  and violations 0: the dropped-connection case above, fixed, then the run
  above.)
- vitest on Linux, final bytes (SHA-256 `4680976A…C39E`): `runtimeChatGptLock`
  - `namedLockRace` 10 passed, 2 skipped (the two Windows-only cases), three
    times in a row.
- Red drill through the test itself, on Linux: the previous `namedLock.ts`
  put into the Linux copy: `AssertionError: two holders inside the protected
work at once: expected 16 to be +0`, 1 failed; the new file restored there,
  SHA-256 identical to this worktree's (`517FEBC3…`, the bytes of that run;
  lint-only edits followed, re-proven by the three runs above).
- Windows (this PC), final bytes: `runtimeChatGptLock` 7 passed, 3 skipped;
  `namedLockRace` 2 passed (the pipe race, 6 processes x 8 rounds, and the
  path budget); `keystoreOwner` 6/6 and `keyringParts` 8/8 on the shortened
  store lock names. 23 passed, 3 skipped, exit 0.

This was run on Linux, not macOS. **For the lead: run `test/unit/namedLockRace.test.ts`
and `test/unit/runtimeChatGptLock.test.ts` on macOS** (its `AF_UNIX` and the
103-character path are the part Linux cannot show), and
`node test/hosts/named-lock-race.mjs <bundle> <folder> 6 40` for a longer
race on either. Not proven here: a real `SIGKILL` of a holder inside the
racing rounds themselves (the crash test and the seeded dead files cover the
dead-entry paths separately).

---

# PLANFIX R7 remainder: local causes shown as a temporary ChatGPT outage (2026-10-15)

## What the review listed, and what each one says now

Every sentence below goes through one function, `chatGptFailureText`
(`src/core/providers/subscriptions/registry.ts`): the terminal and ACP commands
(`chatGptCommandText().failure`), the ACP `verify` path and the plan stream's
catch all read it, so a cause cannot be said one way in the terminal and
another in the panel's turns. A code that is genuinely the network or OpenAI
(`request-failed`) keeps "ChatGPT is temporarily unavailable. Try again."

| Review item                                                                                                                       | Before                                         | Now (code, sentence key)                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime grant lock: contention past the deadline                                                                                  | `request-failed`                               | `lock-busy`, `acpChatGpt.lockBusy` ("Another window or process is signing in..."). `NamedLockError('busy')` from `namedLock.ts`, mapped in `chatGptRefreshLock.ts`                      |
| Runtime grant lock: the caller aborted                                                                                            | `request-failed`                               | `cancelled`, `acpChatGpt.cancelled`                                                                                                                                                     |
| Runtime grant lock: untyped failure of the protected work                                                                         | `request-failed`                               | UNCHANGED, on purpose: nothing at that point can tell a network failure from a local one (see "Tried and reverted")                                                                     |
| Local providers file unreadable                                                                                                   | `request-failed`                               | `providers-file-unreadable` + the file's reason (`unparseable`, `invalid`), `acpChatGpt.providersFileUnreadable`                                                                        |
| Local providers file cannot be saved                                                                                              | `request-failed`                               | `providers-file-unwritable` + reason (`io-error`, `invalid`), `acpChatGpt.providersFileUnwritable`                                                                                      |
| Duplicate ChatGPT entry on add                                                                                                    | `request-failed`                               | `already-added`, the existing `acpChatGpt.alreadyAdded`                                                                                                                                 |
| VS Code host-id / file setup failure                                                                                              | `request-failed`                               | a typed failure (corrupt host id: `invalid-token`) is kept; any other file failure is `local-failed` + the OS code, `acpChatGpt.localFailed`                                            |
| VS Code file-lock deadlines (two)                                                                                                 | `request-failed`                               | `lock-busy`                                                                                                                                                                             |
| Browser opener refused or returned false (VS Code)                                                                                | `request-failed`                               | `browser-unavailable`, `acpChatGpt.browserUnavailable`                                                                                                                                  |
| Runtime browser opener threw                                                                                                      | the editor's raw error through the guard       | `browser-unavailable`; the editor's message is never carried                                                                                                                            |
| VS Code SecretStorage read, write, delete refused                                                                                 | untyped, then `request-failed`                 | `store-unavailable` (the sentence the runtime already used); an unparseable stored record is `invalid-token`                                                                            |
| Plan stream: this app's own refusal to build the request (hosted tool it cannot send, output cap it was not given, a bad counter) | the generic retry                              | `planUi.requestNotBuilt` + the refusal's reason word. `ResponsesDecodeError.isLocal` marks exactly those four sites; a frame the provider sent that does not parse stays the provider's |
| Plan stream: the reply grew past the size this app accepts                                                                        | `UI_TEXT.actionFailed`, then the generic retry | `planUi.streamTooLarge`                                                                                                                                                                 |
| Plan stream: a typed sign-in error (store, lock, ...)                                                                             | `acpChatGpt.failure`, with `reason` lost       | its own sentence with its reason, through `chatGptFailureText`                                                                                                                          |
| Runtime `openBrowser` printing foreign errors                                                                                     | the guard's `request-failed`                   | covered by the browser row                                                                                                                                                              |

New strings: `acpChatGpt.lockBusy`, `cancelled`, `browserUnavailable`,
`localFailed`, `providersFileUnreadable`, `providersFileUnwritable` (last
inside `acpChatGpt`) and `planUi.streamTooLarge`, `requestNotBuilt` (last
inside `planUi`), in `src/shared/l10n/en.ts` and all 14 `l10n/ui.*.json`, each
a real translation in the English table's position. `npm run check:l10n`: 0
problems.

`namedLock.ts` has its own `NamedLockError` (`unavailable | busy | cancelled`)
and does not import any ChatGPT type: the mechanism knows nothing of a caller.
(The R1/R5 and R2 commits imported `chatgptHostId.ts` there, which put that file
into `dist/acp.js`, `dist/headless.js` and `dist/runtimeAccounts.js` and broke
the build's bundle-split check with 3 problems; that, and `headless.js` going
over its 100 KiB budget by 0.1 KiB when the import was switched to
`chatgpt.ts`, are gone with this change. `chatGptRefreshLock.ts` maps the
lock's error to the ChatGPT codes.)

## Not done, and why

- **The Models panel still shows `UI_TEXT.actionFailed` for any failed
  connect.** `src/host/models/modelsPanel.ts:201-205` replaces the error with the
  generic sentence for every operation. Showing the typed cause there means a
  change in the lazy panel, which is at 124.0 of 125 KiB; a cap moves only on
  the owner's word. The plan stream in VS Code (the turns) does say the cause.
  This is the review's R6 presentation residual and it stays open.
- **The runtime lock's untyped failure of protected work stays
  `request-failed`.** See the next section.

## Tried and reverted

A first version mapped the runtime lock's untyped failure to `local-failed`.
It is wrong: the protected work includes the token refresh and the network, so
an untyped throw there is as likely the provider as this machine. Three
existing runtime cases asserted the retry code for exactly that, and it was
right. Reverted to `request-failed`; the typed causes carry the rest.

## Proof

`test/unit/chatGptLocalFailures.test.ts` (15 cases, real modules): every new
code returns its own sentence and none is the retry text, the terminal, the
ACP verify path and the plan stream read the same function, a real broken
providers file and a real unwritable path (a regular file where a folder is
needed) end the real `runChatGptProviderCommand` with their reason, the real
runtime host turns a browser that cannot open and a credential store that
refuses into their own codes (the editor's message is never carried), and the
real codec tells this app's own refusals (hosted tool, missing output cap)
from a frame the provider sent. The grant-lock suite now asserts the lock's
timeout as `lock-busy` and a caller's abort as `cancelled`.

The OS store and the browser are the outside world; they are supplied as a
store that refuses and an opener that rejects. Nothing of ours is replaced.

Red drills (each file restored byte-exact, SHA-256 identical before and after):

1. `lock-busy` collapsed into the retry sentence: 1 fails
   (`expected 'ChatGPT is temporarily unavailable. T…' not to be …`).
2. The runtime host's browser failure left untyped: 1 fails
   (`expected Error: no display to be an instance of ChatGptSignInError`).
3. The `isLocal` flag dropped from the hosted-tool refusal: 1 fails
   (`expected false to be true`).

Results on this PC (Windows), final bytes: the R7, lock, race, keystore,
keyring, host-id and sign-in core suites, 7 files, 156 passed and 3 skipped,
exit 0.

## Existing suites this changes (named, left alone)

These use stand-ins and are in the test-overhaul lane's deletion set; they
assert the old catch-all code for causes that now have their own. Measured on
this tree against an untouched export of the previous commit (`30e035562`),
same machine, same command:

- `test/unit/chatGptVsCode.test.ts`: base 1 failed / 25 passed; now 9 failed.
  The 1 on base is `access_denied` expected as `invalid-callback` while the
  parser now says `authorize-refused` (RVHOSTID R6, unrelated to this change).
  The 8 new ones each assert `request-failed` where the received code is now
  `lock-busy` (5), `browser-unavailable` (1) or `invalid-token` (2).
- `test/unit/runtimeChatGpt.test.ts`: base 4 failed of 35; now 7. The 3 new:
  two `preserves invalid or existing provider configuration...` cases expect the
  retry sentence and now get the providers-file and already-added sentences;
  `propagates cancellation...` expects `request-failed` and gets `cancelled`.
- `test/unit/subscriptionIntegration.test.ts`: 2 failed on base and now.

I did not edit them.

## Packed-product / real-life steps for the lead

1. With a folder where `~/.config/<providers dir>/providers.json` is not valid
   JSON: `muse-spark-code-acp providers add chatgpt` prints "The providers file
   could not be read (unparseable). Fix or remove it..." and never "temporarily
   unavailable"; remove the file and it signs in.
2. Hold the grant lock in one shell (start `providers add chatgpt` and leave
   the browser step open), run `providers status chatgpt` in a second: after the
   wait it says "Another window or process is signing in..."; Ctrl-C of the
   second says it was cancelled.
3. In VS Code, with the opener failing (a remote window), the sign-in says the
   address could not be opened in a browser.

---

# PLANFIX: gates on the final tree (2026-10-15, Windows, head `f8c05f942`)

Each command run alone, exit code read from the command itself.

| Gate                                                                                  | Result                                                                                |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run typecheck` (host, webview, unit, e2e, integration)                           | exit 0                                                                                |
| `npx eslint --max-warnings=0` on the 23 code files the lane changed since `7ed95bc1f` | exit 0                                                                                |
| `npx prettier --check` on all 40 changed files                                        | exit 0                                                                                |
| `npm run check:l10n`                                                                  | 0 problems (14 UI tables)                                                             |
| `npm run check:host-api`                                                              | 0 problems                                                                            |
| `npm run check:reference`                                                             | current                                                                               |
| `npm run deadcode`                                                                    | exit 0                                                                                |
| `npm run cycles`                                                                      | exit 0, no circular dependency                                                        |
| `npx jscpd`                                                                           | exit 1, 5 clones, none in a file this lane wrote or changed in this round (see below) |
| `npm run build`                                                                       | exit 1 on the bundle-split check, 8 problems (see below); sizes within caps           |

Build sizes (this tree): `extension.js` 550.9 / 600 KiB, `modelApi.js`
508.8 / 525, `subscriptions.js` 36.1 / 50, `modelsPanel.js` 124.0 / 125,
`acp.js` 241.1 / 850, `headless.js` 98.5 / 100. No cap was changed.

**`jscpd`: 5 clones remain.** Four are `test/e2e/modelApi.live.e2e.test.ts` against
`test/unit/chatgptFastTier.test.ts` (the controller's dependency literal), one is
`chatgptFastTier.test.ts` against `test/unit/helpers/modelApiHostDeps.ts`. They come
from the R3 commit `bb3c5af2d` (this lane's earlier run, `chatgptFastTier.test.ts`
copies the live e2e harness's constructor). I removed the clones this round's
tests made (`chatGptLocalFailures.test.ts`, `keystoreOwner.test.ts`: 9 down to 5).
I did not touch the R3 test: the owner's rule is to leave a stand-in suite for the
test-overhaul lane, and its fix is a shared harness extraction across an e2e file
that the lane does not own. For the lead.

**`npm run build`, 8 bundle-split problems.** `pageWorker.js` (parse5, entities,
html-encoding-sniffer, @exodus/bytes), `agentImport.js` (smol-toml),
`imageResizeWorker.js` (jpeg-js, pngjs), `validation.js` (mini-parser): "no longer
carries". The review recorded the same 8 on the base (`UNMEASURED` attribution
there). They are not in a file this lane touched. The 3 further problems this lane
caused (`chatgptHostId.ts` in `acp.js`, `headless.js`, `runtimeAccounts.js`) are
fixed in R7 (`namedLock.ts` has its own error type).

Not run: `npm run security:sast` (semgrep is not installed on this PC; the review
saw the same), `npm run security:audit`, the packed-product file
`test/e2e/execStdio.e2e.test.ts` and the ACP package build (the review saw it
fail on a missing `native/darwin/muse-dictate`): this lane did not run them.

## Left for the lead

1. **POSIX / macOS run of the lock race:** `npx vitest run test/unit/namedLockRace.test.ts
test/unit/runtimeChatGptLock.test.ts`, then `node test/hosts/named-lock-race.mjs
<bundle> <folder> 6 40` for a longer race. Linux (WSL2) was run here; macOS
   (`AF_UNIX` and its 103-character path) was not.
2. **Real-store proof on macOS / Linux for the keystore:** `test/unit/keystoreOwner.test.ts`
   is `runIf(win32)`; the worker (`test/hosts/keystore-worker.mjs`) is portable but
   was only run over Windows Credential Manager.
3. The Models panel still hides the typed cause behind its general sentence
   (`src/host/models/modelsPanel.ts:201`); 124.0 / 125 KiB leaves no room.
4. The three suites named under R7, which assert the old catch-all code and use
   stand-ins; they are in the overhaul's deletion set.
