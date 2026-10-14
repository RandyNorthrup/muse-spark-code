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
