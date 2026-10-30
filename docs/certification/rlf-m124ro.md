# RLF-M124RO certification (2026-10-30, branch `rec/rlf-m124ro`)

M124 phases R (remote transport) and O (OAuth), on the person's own PC
(D217). Lane base: int/recovery at `f53ef168fe` (main at 0.19.0 plus the
merged recovery lanes, including RLM124 and RLMCPERA). The code was
written 2026-10-24 in this lane's first run and finished 2026-10-30 after
the quota interruption; commits are listed at the end.

## The owner's answer

Q-M124.1 (remote domain and OAuth operator) was answered by the owner on
2026-10-23, verbatim: "the remote mcp should not be something on a vps
this is for the user so it should be on their pc". D217 records it and
closes the question; M110d–f get the same answer. Nothing in this lane
contacts, provisions or requires a server, domain, tunnel or account of
ours.

## What landed

- `src/runtime/connector/http.ts` (new): the Streamable HTTP endpoint.
  One `/mcp` endpoint beside the OAuth endpoints on one origin; legacy-era
  revisions per D213 (`initialize` opens a `Mcp-Session-Id` session; a
  dual-era client falls back exactly as D213 describes). Every request
  re-verifies its Bearer [REDACTED] for this one resource (MCP authorization
  2025-11-25, "Token Handling"); the token is read from the
  `Authorization` header only, never the query string. No server event
  stream (GET 405, as the transport chapter provides). Host and Origin
  are validated on every request (the DNS-rebinding rule). A session
  belongs to the client its first token named, and a later token can only
  narrow its scopes.
- `src/runtime/connector/oauth/` (new): the authorization server on the
  PC, on `oidc-provider` 9.12.2 (certified OAuth 2.0 / OpenID Connect;
  no hand-rolled crypto). Authorization code with PKCE S256 only,
  RFC 8707 resource binding, rotating refresh tokens (presenting a spent
  one ends the whole sign-in), RFC 9728 Protected Resource Metadata at
  `/.well-known/oauth-protected-resource/mcp`, RFC 8414 metadata,
  RFC 9207 `iss`, RFC 7009 revocation, Client ID Metadata Documents with
  the library's connect-time SSRF guard, and RFC 7591 registration only
  behind `--open-registration`. Ours is the consent page (an owner code
  printed in the connector's terminal and nowhere else; replaced after
  five wrong tries and after every approval), the `WWW-Authenticate`
  challenge, and the binding to the live grant: `mcp revoke` ends every
  token at once and a new grant does not revive them; `mcp client remove`
  ends one client while serving continues. State (signing key, token
  digests, grants, clients) is whole-file JSON in RLM124's owner-only
  folder; a file that cannot be read refuses the start instead of
  minting fresh state silently.
- `src/runtime/connector/remoteEntry.ts` and `remoteBundle.ts` (new):
  `mcp serve-http` and `mcp client add/list/remove`, loaded as
  `dist/connectorRemote.js` (962.0 KiB measured; new budget 1125 KiB =
  measured +15% rounded up to 25 KiB, the RLM124 formula). Reach:
  loopback unless `--bind` names more; a wider address needs
  `--public-url`; plain HTTP only on loopback with `--tunnel` (the
  person's own tunnel ends TLS); otherwise `--tls-cert`/`--tls-key` with
  the person's own certificate. `--token-minutes` and `--sign-in-days`
  are the person's; protocol timings in `CONNECTOR_REMOTE_LIMITS` cite
  their sources inline (OAuth 2.1 draft-13 §4.1.2, Keycloak/Okta
  defaults, NIST SP 800-63B §5.2.2).
- `src/runtime/connector/registryHost.ts` (new): the registry/approval
  host extracted from `entry.ts` unchanged in behaviour, so stdio (one
  registry) and HTTPS (one per session, scope-narrowed authorities)
  share one approval page and audit. `entry.ts` refuses remote commands
  with usage; `main.ts` routes `serve-http`/`client` to the remote
  bundle.
- `src/runtime/connector/store.ts`: OAuth state and owner-client records
  through the same secured whole-file write as grants.
- `src/shared/connectorRemote.ts` (new), `src/shared/constants.ts`,
  English plus all 14 tables (`acpConnectorRemote`, check:l10n 0
  problems), build/split/size wiring, `scripts/lib/acpBundles.mjs`,
  regenerated lazy registry, host-API record, reference, roadmap and
  third-party notices (koa family via `oidc-provider`;
  `vendor/koa-compose/LICENSE` for the one tarball without a licence
  file; three licence-review receipts for wording-variant MIT/ISC
  texts read in full).

## Sources read

MCP specification 2025-11-25, Authorization and Transports chapters
(https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization):
PRM is mandatory for servers, clients must do PKCE S256 and send the
`resource` parameter, tokens belong in the `Authorization` header never a
URL. Read with 2026-07-28 and D213's record
(`docs/certification/rlmcpera.md`): the connector stays legacy-era, so a
2026-07-28 client probes, is refused, and falls back to `initialize`.
RFC 9728 (PRM), RFC 8414 (AS metadata), RFC 8707 (resource indicators),
RFC 7636 (PKCE), RFC 7591 (DCR), RFC 7009 (revocation), RFC 9207
(`iss`), OAuth 2.1 draft-13 §4.1.2 (short-lived codes). `oidc-provider`
is the OpenID Foundation-certified implementation by the author of
`jose`; the SDK client in the tests is `@modelcontextprotocol/sdk`
1.32.1, test-only.

## Proof

`test/unit/connectorRemote.test.ts` (13 tests) runs the real
`serve-http` command in-process on a real data folder behind a real
localhost certificate (`test/fixtures/connector-remote`, manifest
records the OpenSSL command and date), and drives it with the official
MCP SDK client over HTTPS: 401 with `resource_metadata` and scope,
PRM and AS metadata shapes, query-string and garbage tokens refused,
unregistered client refused, full sign-in with an owner-registered
client (consent page names the client, its callback and every scope;
tool list and call; no held token anywhere in the state file), owner
deny and wrong code, owner-code rotation after five wrong tries and
after an approval, refresh rotation and reuse ending the sign-in, a
token from another connector address refused even when its record is
known, grant revoke ending all sign-ins across a re-grant, client
removal mid-serve, open registration closed until `--open-registration`,
loopback-only until a wider bind is named (raw TCP to the LAN address
refused, then accepted), tunnel mode serving its public name over
loopback HTTP, and the three startup refusals.

Results: the first 10 passed 10/10 on linuxlt on 2026-10-24 (this lane's
first run, repository timeout). The 2026-10-30 resume runs inside Muse
Spark Code's app sandbox, whose user namespace owns `/` as `nobody`
(65534): RLM124's storage guard rightly refuses every anchor chain
there, so the serving tests cannot start in it. Measured, not assumed:
the untouched `connectorStorageGuard.test.ts` fails 4 of 8 in the same
sandbox, and the remote suite fails at the same guard line before any
test logic. The startup-refusal test (no guard on that path) passes
here. The full suite, the packed-product run and the Inspector and
RLMCPERA-client passes are owed to the lead/CI outside this sandbox;
no packed-product claim is made until they run. No provider or model
call was made anywhere in this lane.

## Red/green drills

1. Startup refusal (2026-10-30): the `needsHttps` refusal in
   `reachOf` was removed; the "refuses to start" test failed (vitest
   exit 1, 1 failed). Restored: 1 passed. This drill runs in the app
   sandbox because the refusal precedes the storage guard.
2. Notices licence gate: the `koa-compose` vendored-licence row was
   removed; `node scripts/third-party-notices.mjs` exited 1 with
   `koa-compose: ships no licence file`. Restored: exit 0,
   `ok THIRD_PARTY_NOTICES.txt: 136 third-party notices`.
3. Bundle-split rule: the expected remote source
   `src/runtime/connector/oauth/server.ts` was renamed to a missing
   file; the check reported a fourth problem
   (`dist/connectorRemote.js no longer carries …server-drill.ts`).
   Restored: back to the three pre-existing problems (below).
4. Catch classification: the connector subtree's sites were classified
   directly (`scanCatches` on `src/runtime/connector`): the new
   OAuth/remote handlers are NARROW or REPORTED after giving them named
   conditions (`isFileError`, `isListenError`, `isInvalidJwkRefusal`)
   and `{ cause }`-carrying throws; the same scan before that change
   classified four of them GENERIC.

## Gates (2026-10-30, this sandbox; `TMPDIR=/dev/shm/rlf-m124ro`)

Exit codes measured on the final tree. Where a gate is red, the same
failure was measured on the untouched base `f53ef168fe` where noted —
int/recovery carries other lanes' debt that integration owns.

- `npm run typecheck` (all projects): 0.
- eslint `--max-warnings 0` on every touched source, script and test
  file: 0. prettier `--check` on the same files: 0.
- `node scripts/check-l10n.mjs`: 0 (0 problems).
- `npm run check:reference`: 0. `npm run check:roadmap`: 0.
  `npm run check:host-api`: 0 after the count-only regeneration.
- `npm run build`: 1 — ten bundles over budget (`modelApi` 544.3/525
  KiB the largest), byte-identical sizes measured on a clean
  `f53ef168fe` worktree build the same day; the connector bundles are
  within theirs (`connector` 106.7/125, `connectorStoreGuard`
  15.1/18, `connectorRemote` 962.0/1125). No budget was raised except
  the new bundle's own (formula above). The rest of the build chain
  was run piece by piece: bundle-split 1 (three
  `subscriptions/chatgptRecord` problems, no connector problem; drill
  3), lazy-registry 0, host-globals 0, third-party notices 0, legal
  build records 0 (0 incomplete after the three licence receipts).
- `npm run check:plan`: 1 — PLAN.md is 3,775,918 bytes against the
  3,565,158 budget; the base file is already 3,769,703, so the gate is
  red before this lane's 6 KB. Archiving is the lead's procedure.
- `npm run check:catches`: 1 — counts rose in core/host/runtime/webview
  from other merged lanes (judge, accounts, providers); this lane's new
  handlers classify NARROW/REPORTED (drill 4). Three sites moved files
  with the registry-host extraction (`command.ts:278` CLEANUP,
  `registryHost.ts:50` CLEANUP, `registryHost.ts:113` GENERIC) —
  count-neutral, new identities; the baseline was not regenerated
  here because that would also bless the other lanes' sites.
- `npm run duplication`: 1 with 7 clones, none in this lane's files
  (11 before this lane's four clones were de-duplicated by sharing
  `readBoundedBody`, `registryHostFor` and `OWNER_COMMAND_IO`).
- `npm run cycles`: 0. `npm run deadcode` (knip): 1, four findings,
  none in this lane's files.
- `npm run security:audit`: 1 — six pre-existing highs (msal-node,
  undici ×4, zod) plus two expired exceptions (lead's, 2026-10-24);
  this lane's only new high (the SDK's transitive `body-parser`) was
  lock-bumped to the fixed 2.4.0 and is gone.
- `npm run security:secrets`: 1 over full history (9 findings in 8468
  commits); the same scan limited to this lane's commit range
  (`f53ef168f..HEAD`) exits 0 with no leaks.
- `npm run security:sast`: 1 — five findings, all in
  `src/host/backend/deviceWorkerDarwin.ts` (M100, untouched here);
  no finding in any file of this lane.
- Tests, repository timeouts throughout: `connectorRemote` startup
  refusals pass here (serving tests blocked by the sandbox's
  storage-guard anchor, above); `connectorLogic` +
  `connectorApprovalButtons` 10/10 pass. `connectorRuntime`,
  `connectorServe` and `connectorStorageGuard` need the same guard
  and are owed to CI with the rest of the suite.

Commits: `0ffb72204` (the remote connector, tests, build wiring,
locales and the TLS fixture) and the records commit that carries this
file. The pre-commit hooks ran on both; the committed diffs were
re-read after each (AGENTS rule 15).

## What a person does

1. `muse-spark-code-acp mcp grant --workspace …` (existing).
2. `muse-spark-code-acp mcp client add --name "…" --redirect-uri <callback>`
   and type `y`: the printed `client_id` goes to the client.
3. `muse-spark-code-acp mcp serve-http --tls-cert … --tls-key …` (or
   `--bind lan --public-url https://…`, or `--tunnel --public-url
https://…`): the terminal names the `/mcp` address and the owner
   code.
4. In the client, add the HTTPS MCP server with that address; its
   sign-in opens the consent page on this PC; type the owner code and
   Allow. Writes still wait for the connector's own approval page, as
   locally.
5. `mcp client list/remove`, `mcp revoke`, `mcp kill` end things exactly
   as locally.

## Still open

- Packed-product real use, MCP Inspector and our dual-era client
  (RLMCPERA) against `serve-http`: owed to the lead (sandbox above).
- Muse Node's paired-device channel: M110 lane N wires no node server
  yet, so there is no channel to serve through; `serve-http` is the
  command a home node will run unchanged.
- From RLM124 unchanged: the T adapters (fleet/outcomes/lanes/teams say
  `unavailable`), the shared approval UI (M104), and
  authenticated-session tool calls through vendor clients (owner
  accounts).
