# RVNET certification (2026-10-30, branch `rv/net`)

Independent review of two listeners a stranger can reach, before they
merge. This worktree is `rv/net`, started at `rec/rlf-m124ro` (D240, the
connector's `mcp serve-http`). The second branch is `review/rlf-nodeserve`
at `79aee4ca8` (Muse Node `serve`). Merge base of the two is
`f3941b8548`. Rig `linuxlt`, worktree `/home/randy/lanes/RVNET`. No paid
call and no Muse request. The authors' records
(`docs/certification/rlf-m124ro.md`, and `docs/certification/rlf-nodeserve.md`
on the node branch) are their claims; this file is this review.

The connector finding is fixed on `rv/net` in `a02ebf146`. The node
listener had no finding. A temporary worktree of `review/rlf-nodeserve`
was used for the live requests and then removed, and the review branch
`rv/nodeserve` (created at `79aee4ca8`, no commit of its own) was deleted.
Nothing from that worktree is in this branch.

## Connector (`mcp serve-http`, D240)

### P2 — discovery followed a forwarded host

The authorization server builds its endpoint URLs from the request. In
tunnel mode the server trusts a proxy, and Koa then prefers
`X-Forwarded-Host` (its first value) over the Host this code had already
rewritten. An absolute-form request line is the whole URL, on the tunnel
listener and on the TLS listener. Protected-resource metadata is this
code's own document and already used the configured issuer.

Live, before the fix, against the real `serve-http` process. Tunnel,
`--public-url https://owner.example`, plain HTTP on 127.0.0.1.
`GET /.well-known/oauth-authorization-server` with
`X-Forwarded-Host: evil.example` answered HTTP 200. The body kept
`issuer` as `https://owner.example` and set
`authorization_endpoint`, `token_endpoint`, `jwks_uri` and
`revocation_endpoint` to `https://evil.example/...`. The same document
came back for `X-Forwarded-Host: evil.example, owner.example` (the first
value wins). An absolute-form line
`GET http://evil.example/.well-known/oauth-authorization-server` with
`Host: 127.0.0.1:<port>` answered HTTP 200 with those four endpoints as
`http://evil.example/...` and the same honest issuer. On the TLS
listener the same absolute-form line answered HTTP 200 with
`issuer` `https://127.0.0.1:<port>` and
`token_endpoint` `http://evil.example/token` (and the authorize, jwks
and revoke addresses the same way). `Forwarded: host=evil.example;proto=https`
did not rename anything. Discovery sent no `Cache-Control`.

Severity is P2. The `issuer` field stayed the public URL, so a client
that trusts only that field is not sent away. A client or a cache that
uses the endpoint fields would send the authorization code and the PKCE
verifier to the named host. The person's tunnel (cloudflared's default)
does not strip a client `X-Forwarded-Host`, and an appending proxy keeps
the client's value first. The public URL is already configured, so the
request must not be able to rename those addresses. Token theft of a
different person's client still needs that client, or a cache, to use
the poisoned document.

Fix, `a02ebf146`, in `src/runtime/connector/oauth/server.ts`: before the
library sees the request, `pinIssuer` sets Host to the configured issuer,
drops `X-Forwarded-Port` and `Forwarded`, sets or drops
`X-Forwarded-Host` and `X-Forwarded-Proto` so they match that issuer
(tunnel keeps `https`; the TLS listener drops both), and rewrites an
absolute-form request line to its path and query. A line that looks
absolute and is not a URL is HTTP 400 `invalid_request`. `provider.proxy`
stays on in tunnel mode, so a clean discovery document stays `https`.
Protected-resource metadata was already the configured issuer and is
covered by the same test.

`test/unit/connectorRemoteIssuer.test.ts` starts the real command and
sends these requests. It failed before the pin (below) and passes after.

### Who can connect

Default bind is 127.0.0.1. A live serve on that default did not accept a
TCP connection to this machine's LAN address `10.10.11.110`. The existing
suite (`test/unit/connectorRemote.test.ts`) already refuses a tunnel that
is asked to bind wider than loopback, and accepts a LAN bind only when
one is named. `--bind ::1` was not opened on this run. `::` is every
interface and, like `0.0.0.0`, needs `--public-url`.

`Host: evil.example` on the tunnel listener answered `HTTP/1.1 403`.
`Origin: https://evil.example` answered 403 with no
`access-control-allow-origin`. The server sets no CORS header of its
own. The outer Origin check compares hostnames: a browser Origin whose
host is not an address this server answers is refused, which is the
DNS-rebinding case, and that refusal was the live 403. When a browser
sends Origin to the consent page, that page requires the origin to equal
the issuer origin. MCP does not use a cookie. A WebSocket upgrade to
`/node/terminal/stream` on this server answered 403; this server has no
WebSocket route.

Loopback is shared by every account on the machine. Another account can
open the port. The OAuth state, the audit key and the TLS key are mode
`0600` under directories mode `0700` (live listing of the data folder;
`oauth/default.json` is asserted `0600` in the new test), so that account
cannot read them. Actions still need a bearer or the owner code.

### Authentication and authorization

The existing suite, re-run on this tree after the pin, drives the real
server with the official MCP SDK client: 401 with discovery, sign-in with
the owner code, a refused code, refresh reuse ending the sign-in, a token
for another address refused, grant revoke, client removal, registration
closed until `--open-registration`, and the startup refusals. This review
did not repeat that suite's OAuth matrix by hand. What this review sent
itself, on the real server:

- `POST /mcp` with no bearer: 401, and `WWW-Authenticate` did not carry
  `error="invalid_token"`.
- `POST /mcp` with `Authorization: Bearer bearer-secret-token`: 401, the
  body and the challenge did not contain that token, and the challenge
  did carry `error="invalid_token"`. That split is RFC 6750 (a presented
  token versus none), not a check of whether a secret matched.
- `POST /mcp?access_token=query-secret-token`: 401, and neither the body
  nor the challenge contained the query value. The token is read from
  the Authorization header only.
- `GET /mcp`: 405. `POST /register` with registration closed: 404.
- JWKS JSON contained `alg`, `crv`, `kid`, `kty`, `use`, `x`, `y` and no
  private `d`.

Owner-code comparison is a SHA-256 digest compared with `timingSafeEqual`,
rotated after five failures and after every approval (the existing suite).
Codes are one use; refresh rotation revokes the grant on reuse; the
resource is the configured issuer. Client ID Metadata Document fetches
use the library's connect-time refusal of special-use addresses. This
review did not stand up a bait server to watch that refusal.

### TLS

The TLS listener sets `minVersion: 'TLSv1.2'`. A live handshake negotiated
`TLSv1.2` with `ECDHE-ECDSA-AES128-GCM-SHA256`. `AES128-SHA` received
alert 40. A plaintext HTTP request to the TLS port received no HTTP
response. Node on this rig cannot offer TLS 1.0 or 1.1, and `openssl
s_client -tls1` was not run, so those two versions are not claimed
rejected by a live handshake. The plan's minimum is TLS 1.2; this review
did not raise it to 1.3. With `X-Forwarded-Host` and `X-Forwarded-Proto:
http` on the TLS listener (proxy off), endpoints stayed
`https://127.0.0.1:<port>/...`. There is no plaintext listener except
loopback `--tunnel`.

### Secrets

The query token and the bearer above were absent from the responses.
The process stderr from that run did not contain either value, `BEGIN
PRIVATE`, or a JWK `"d"`. State files are digests, mode `0600`. The
owner code is printed in the connector's terminal and is not in the
state file (existing suite).

### Input

Consent and OAuth form bodies stop at 16 KiB. The library's own body
reader stops at 56 KiB. The MCP body stops at 64 KiB after the bearer
check. `requestTimeout` and `headersTimeout` are 15 seconds. Pending
consent pages stop at 100 and unapproved open registrations at 200, both
already in `CONNECTOR_REMOTE_LIMITS` with their citations, and a further
request gets `temporarily_unavailable`. Wrong owner codes stop at 5.
There is no separate per-address request counter and no connection cap.
None was added: the default bind is loopback, and a new cap would be a
limit the person did not set. The admission bounds above stay.
`GET /mcp/../../etc/passwd` answered 404 and the body did not contain
`root:`.

### Process

The server runs as the user who started it (uid 1000 on this rig). Stop
exited 0 and the port no longer accepted a connection.

### Red/green drill

On the tree before `a02ebf146`, `pinIssuer` was reduced to the old two
lines (rewrite Host, and in tunnel mode set `X-Forwarded-Proto` to
`https`). `npx vitest run test/unit/connectorRemoteIssuer.test.ts
--maxWorkers=2`, repository timeout, exited 1: 2 failed, 1 passed. The
forwarded-host discovery returned
`authorization_endpoint` `https://evil.example/authorize`. The TLS
absolute-form discovery returned `token_endpoint`
`http://evil.example/token`. The Host and Origin test passed. The pin
was restored at once. The same command then exited 0 (3 passed).
`npx vitest run test/unit/connectorRemote.test.ts --maxWorkers=2` exited
0 (13 passed). The shell line that printed the status ran after vitest,
so the shell's own status was 0; the vitest status was 1, then 0.

## Muse Node `serve` (`review/rlf-nodeserve` at `79aee4ca8`)

Reviewed in a temporary worktree with that branch's own install. The
real server is `serveNode` / `NodeListener`, started the way
`test/unit/nodeServeBinding.test.ts` starts it (init on 127.0.0.1, then
the production binding). No source file on that branch was changed.

`npx vitest run test/unit/nodeServeBinding.test.ts --maxWorkers=2`
exited 0: 14 passed (fingerprint, missing and wrong bearer with the same
body, enroll, dashboard, audit, file read of real bytes, writes and
git and maker `unavailable`, step-up mismatch and replay, a terminal
socket for an unknown terminal, stop and lock, wipe, a second serve
reusing the fingerprint, stop signalling the recorded pid, serve without
an auth bundle refused). A second file in that worktree, not committed
and removed with it, sent the requests below against that same server.
It exited 0: 2 passed. Repository timeout both times.

### Who can connect

`parseNodeArgs` for `init --listen` of `0.0.0.0`, of `::`, and of
`8.8.8.8` each threw, and nothing was listening on `127.0.0.1:7443`
afterwards. A real serve on `127.0.0.1` accepted loopback and did not
accept a connection to this machine's other IPv4 address. `Host:
evil.example` answered 403. `Origin: https://evil.example` answered 403.
`Origin: http://home.local:<port>` answered 403 (the scheme must be
https). A cookie answered 403. `X-Forwarded-Host: evil.example` with a
valid Host answered 401 `{"code":"unauthenticated"}` and the body did
not contain `evil.example`. A WebSocket upgrade of
`/node/terminal/stream` with `Origin: https://evil.example` and
`Sec-Fetch-Site: cross-site` was closed and was not `101`. `--listen
::1` was not opened on this run. The address check allows loopback, RFC
1918, unique-local and link-local, and refuses every-interface and
public addresses (the three throws above).

### Authentication and authorization

Missing bearer and `Authorization: Bearer not-a-real-token` both
answered 401 with the identical body `{"code":"unauthenticated"}`.
`POST /node/stop` with no bearer answered 401 and the port stayed open.
Two setup codes of the required length (`a` repeated 128 times, and `b`
the same) answered the same `{"code":"unauthenticated"}`. A one-character
change of the real setup code answered that same body. A short code
`nope` answered `{"code":"invalidRequest"}`: that is the public shape
check, the same split as OAuth `invalid_request` against `invalid_grant`,
and both wrong secrets of the right shape were indistinguishable. A real
enrollment (ECDSA P-256, attestation `none`) answered 200 with a bearer.
The dashboard body contained neither that bearer nor the setup code.
Step-up mismatch and replay are the 403s in the suite above. The error
body is only `{code}`.

### TLS

The listener sets `minVersion: 'TLSv1.3'`. A client limited to TLS 1.2
was refused. A plaintext socket to the TLS port closed with zero bytes
and no HTTP (`end`, 0 bytes). The fingerprint printed at listen equalled
the served certificate's SHA-256 fingerprint. The TLS key file was mode
`0600`. The suite covers reuse of the committed pair. `openssl s_client
-tls1` was not run; the Node client on this rig cannot offer TLS 1.0 or
1.1, and the TLS 1.2 refusal is the check that matches this listener's
minimum.

### Secrets

Responses above are `{code}` or, after enrollment, a body that did not
echo the bearer or the setup code. The key file is mode `0600`. Modes of
the rest of the data tree were not listed on this run. The setup code
was not copied into this record.

### Input

`POST /node/files/read/../../etc/passwd` answered 404 and the body did
not contain `root:`. After enrollment, a workspace file read returned
that file's bytes; `../secret.txt` and a symlink `link.txt` did not
return the marker planted outside the workspace; a path `/etc/passwd`
did not return `root:`. Writes, git, maker and the PTY answer
`unavailable` (the suite). The body cap is 2 MiB in the listener; a
request over that cap was not sent on this run. An absolute-form request
line, a duplicate Host, and a WebSocket that passes the origin check and
then sends no auth frame were not sent on this run. The upgrade path
checks origin before `101`, forbids an Authorization header on the
upgrade, and requires the first text frame to authenticate the terminal
id closed over at open. The suite closes the socket for an unknown
terminal.

### Process

The server runs as the user who started it. After the abort that stops
`serve`, `127.0.0.1` on that port did not accept a connection. An
anonymous `node/stop` did not close it (above).

### No node change

No weakness in the requests above was reproduced. No fix was committed.
`rv/nodeserve` does not exist after this review.

## Gates

Measured on this worktree on 2026-10-30, repository timeouts, one heavy
command at a time. Where a gate is not 0, the finding is debt already on
this branch: none of it is in the issuer pin, the new test, or this
record. No budget, baseline or exception was changed to make one pass.
The node listener's suites ran in the temporary worktree (14 passed, then
the review's 2) and are not part of this branch's tree.

- prettier `--check` on `PLAN.md`, this file, `CHANGELOG.md`,
  `SECURITY.md`, `src/runtime/connector/oauth/server.ts` and
  `test/unit/connectorRemoteIssuer.test.ts`: 0 after formatting this
  file (the first check was 1, this file only).
- eslint `--max-warnings 0` on `server.ts` and the issuer test: 0.
- `npm run typecheck`: 0.
- `node scripts/check-l10n.mjs`: 0 (0 problems).
- `npm run check:reference`: 0. `npm run check:host-api`: 0.
  `npm run check:roadmap`: 0.
- `npm run check:plan`: 1. `PLAN.md` is 3,776,820 bytes against the
  3,565,158 budget. The RLF-M124RO record on this branch already had the
  file over that budget (3,775,918). This review adds the RVNET status
  paragraph. Archiving is the lead's procedure.
- `npm run check:catches`: 1. SWALLOW, GENERIC and CLEANUP rose in
  core, host, runtime and webview from other merged lanes (judge,
  accounts, providers). No new site is in `oauth/server.ts`. The
  connector sites the inventory names (`command.ts`, `registryHost.ts`)
  are the ones RLF-M124RO already recorded. The baseline was not
  regenerated.
- `npm run duplication`: 1, 7 clones, none in this review's files.
- `npm run cycles`: 0.
- `npm run deadcode`: 1. Unused `test/unit/helpers/judgeApprovalFixtures.ts`,
  `MAY_HOLD_SECRET`, `paidAvailability` and `JudgeLintOptions`. None are
  in this review's files.
- `npm run build`: 1, stopped at the size check. Ten bundles over budget,
  none of them the connector: `reportingPanel` 50.6/50 KiB,
  `resourceGovernor` 126.9/125, `resourceAdmission` 25.5/25,
  `modelApi` 544.3/525, `modelsPanel` 155.0/150, `usageService` 100.8/100,
  `teamScheduler` 75.3/75, `vaultActions` 25.1/25,
  `estimateContracts` 25.1/25, `wire` 76.2/75. Connector bundles:
  `connector` 106.7/125, `connectorStoreGuard` 15.1/18,
  `connectorRemote` 962.5/1125. No budget was raised. The later build
  steps were run on that tree: bundle-split 1 (three
  `subscriptions/chatgptRecord` problems, no connector file),
  lazy-registry 0, host-globals 0, third-party notices 0 (136 notices),
  legal build records 0.
- `npx vitest run test/unit/connectorRemoteIssuer.test.ts
test/unit/connectorRemote.test.ts --maxWorkers=2`: 0. 16 passed
  (3 and 13).
- `npx vitest related src/runtime/connector/oauth/server.ts --run
--maxWorkers=2`: 1. `connectorServe` 6 passed, `connectorRemote` 13
  passed, `connectorRemoteIssuer` 3 passed. `connectorStorageGuard` 3
  failed and 5 passed. The three failures are the cases that expect a
  grant written without the guard to be refused. On this rig that store
  already writes mode `0600` and `0700`, and the anchor chain is this
  user or root, so verify accepts it: serve starts and hits the 5 s
  test timeout, and `status` exits 0. The issuer pin does not touch the
  guard. Not changed.
- `SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`: 1. Five
  findings, all `replaceAll` HTML escaping in
  `src/host/backend/deviceWorkerDarwin.ts`. Semgrep also stopped three
  rules on `ModelApiHost.ts` and one on `App.tsx` after timeouts. No
  finding in this review's files.
- `npm run security:audit`: 1. Six highs (`@azure/msal-node`, `undici`
  four times, `zod`) and two exceptions (one expired 2026-10-24, one
  npm no longer reports). No dependency was added.

## What remains

- Packed-product use of `serve-http`, the MCP Inspector, and the
  RLMCPERA client: not this review. No model call was made.
- Connector `--bind ::1` was not opened live. Client ID Metadata
  Document refusal of a loopback bait server was not watched live.
  `openssl s_client -tls1` was not run against either listener.
- Node serve: a body over 2 MiB, an absolute-form request line, a
  duplicate Host, a WebSocket that is allowed and then silent, a listen
  address of ::1, and modes of the data tree beyond the TLS key were not
  sent or listed. The requests that were sent are above.
- Node `serve` waits on the lanes the node record already names (the
  maker action, the operator control transport, a second PC joining).
  This review did not take those up.
