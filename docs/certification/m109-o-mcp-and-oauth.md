# M109 O — MCP credentials and OAuth

Lane `m109/o`, MacBook Pro Intel rig, 2026-10-06. Base `8a151dd40`.
Scope: PLAN D89.4, D89.14, acceptance 16; O only. No merge, push,
dependency install, credential-store inspection, live network/model call or
paid call. Every token used in tests is generated at runtime.

## Implemented behavior

- The pool preserves `${secret:<name>}` as a handle until server start.
  `mcpReferences.ts` is a small startup guard with no crypto or Zod import.
  It refuses references in commands, arguments, working directories and URLs;
  malformed names, interpolated environment values and duplicate header
  aliases; proxy and routing headers cannot carry a credential.
- `mcpVaultRoutes` sends only a server name, handles and a validated MCP use
  to X's injected feeder port. The use binds the resolved executable, argv,
  canonical working folder and variable names. `resolveMcpVaultCommand` uses
  real paths. Both the normal and vault host routes retain workspace-process
  admission and current trust checks. Cancellation before launch refuses;
  a late admitted child is ended. The ordinary spawner refuses unresolved
  vault references. A missing route refuses before spawning or fetching.
- Remote header references are restricted to the exact configured HTTPS
  endpoint and bound origin/header name. Redirects and caller substitution
  refuse. The trusted port gets uses and the ordinary request without its
  handle-valued headers. Header and OAuth authentication cannot overlap.
- Broker-local OAuth discovers RFC 9728 protected-resource metadata and
  RFC 8414 authorization-server metadata, with root/OIDC fallback only when
  metadata is missing. It requires S256, code flow and public-client auth;
  compares the whole issuer identifier and resource; uses a fresh loopback
  state and PKCE verifier; sends RFC 8707 `resource` in authorization, code
  exchange and refresh. Callback origin, path, state, code and response issuer
  are checked, including required RFC 9207 `iss` when advertised.
- Tokens are created directly through the encrypted vault port. Creation
  rejects an existing name; rotation retains metadata/policy. One broker-local
  owner serializes requests and refreshes. Public-client refresh must replace
  its token. Failed or uncertain rotation quarantines the item instead of
  retrying its old refresh token. The invalidation port must compare item id
  atomically, so delayed cleanup cannot remove a replacement item.
- Each token read and send is authorized through an acquired broker permit;
  current policy is asserted after I/O and at physical encrypted commit, and
  every permit receives a terminal success/failure settlement. Caller
  Authorization/proxy credentials are refused. Only the exact resource can
  receive the access token. There is no token getter or upstream passthrough.
  Every response passes the required T scrub port before delivery.
- Lock advances generation; scoped revoke aborts only its handle. Both synchronously wipe affected owned
  material, PKCE buffers and held Authorization headers. Temporary token
  JSON is bounded and parsed by Zod; errors expose only translated `No access`.
  Unpooled owned buffers are erased in `finally`, including cleanup failure.
  JS strings required by HTTP/JSON, fetch internals, swap and memory dumps
  cannot be guaranteed erased; this is D89's best-effort hygiene.
- **Move to vault** imports only the chosen literal under the resolved use,
  requires the trusted encrypted import to read back and hash-verify it, and
  erases its owned input. It returns a proposed JSON edit plus the original
  source's SHA-256. It never writes/saves the settings. The host must compare
  that digest against the current document before offering the reviewed edit.
  Environment interpolation and existing references are refused as imports.

## Integration handoffs

These are required injected ports, not production fake implementations.
Until they are bound, secret references fail closed. Existing servers without
references continue through their existing spawner/transport.

| ID    | Owner              | Required binding                                                                                                                                                                                                                                                                                                                                              |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-X   | X/B                | `McpVaultRoutePorts.start`: request/answer/redeem each handle for the server's `mcp` use, put tickets only on the inherited feeder channel, re-resolve/recheck actual executable/argv/cwd at dispatch, retain lifetime/revoke/tree containment and output scrub.                                                                                              |
| O-BH  | B/T/W              | `remote`: authorize every origin/header use, supply credentials only to the trusted pinned host HTTPS transport, scrub response/error bytes, retain live cancellation and settle each ticket. OAuth's `authorize` returns an active permit with `assertCurrent`/`finish`; `signIn` intent is authenticated user management, never a model-created credential. |
| O-C   | C/B                | `McpOAuthVaultPort`: encrypted reads; duplicate-safe create; atomic same-item rotation; `authorize` at physical write; invalidate only the expected item id. Instantiate one OAuth owner in the broker, not per window. Lock, screen lock and epoch changes call `invalidate()`; scoped revoke calls `invalidate(handle)`.                                    |
| O-95b | M95b/W             | Bind `McpOAuthLoopbackPort` to M95b's loopback helper, closing the IP-only ephemeral listener on abort. Bind trusted server registry to its public client registration id and immutable resource/issuer. No dependency or substitute loopback implementation added on this base.                                                                              |
| O-N   | Host network owner | `McpOAuthNetworkPort.fetch` must enforce the approved destination at connection time through the pinned HTTPS transport, including DNS rebinding protection and platform proxy/cert handling. `allowEndpoint` is preflight; it is not a substitute for connection-time policy. Browser open is authenticated user initiation.                                 |
| O-T   | T                  | Bind broker-local OAuth `scrub` and remote header response scrub to the actual vault service, updating registered values after create/rotation. JSON, SSE, error bodies and headers must be scrubbed before any MCP/model/log consumer.                                                                                                                       |
| O-96  | M96                | Use `McpVaultPoolPort` for bridged stdio and remote servers, registered by trusted launcher/server identity. Never resolve references into `muse serve`'s environment. Muse Code sees an unresolved entry and reaches it only through the bridge.                                                                                                             |
| O-U/H | U/H                | User-only sign-in and Move actions in every editor/CLI; preview original digest and proposed settings edit, compare before application, user reviews/saves. Value-bearing source/proposal stays in authenticated local editor UI, outside model/transcript/MHP. No UI implemented in this lane.                                                               |
| O-W   | W                  | Lazy broker/host bindings and bundle readers/budgets; help catalog if available on integrated base; README/CHANGELOG/release/reference and host API regeneration. No caps raised. No new command/setting registered on this base.                                                                                                                             |

All editors use the same core OAuth/reference/migration logic. Only the
existing VS Code-family command resolver/admission adapter is host-specific;
runtime/M96 bind their own trusted resolver and feeder through the same ports.
No UI/styling changed. No Chrome on this rig; U/W browser/visual/editor checks
are an integration handoff, never claimed as passed here.

## Threat control mapping

| Threat               | Control and named test family                                                                                                                                 | Red proof                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| V3 malicious MCP     | Command/server/name binding; exact resource/issuer; no passthrough; remote token echo scrub; missing routes refuse. `mcpSecrets`, `mcpVaultPool`, `mcpOAuth`. | Mutation receipts below. T retains full scrub/taint proof. |
| V7 memory            | Unpooled owned buffers; wipe after success/failure; synchronous invalidation during stalled network. `mcpOAuthLifecycle`.                                     | Mutation receipts below; OS isolation remains P/B.         |
| V9 logs/exports      | Sanitized protocol/network errors; mandatory response scrub before return; no token-returning API. `mcpOAuth`, `mcpSecrets`.                                  | Mutation receipts below; T/W own joined-boundary tests.    |
| V11 replay           | Unique state/PKCE; callback binding; exact resource at refresh; serialized replacement; physical-commit generation guard. `mcpOAuth`, `mcpOAuthLifecycle`.    | Mutation receipts below; approval replay remains B.        |
| V13 requester access | Server identity from pool/registry, command use and handles; no fallback when binding absent. `mcpVaultPool`, `mcpSecrets`.                                   | Mutation receipts below; peer authentication remains B.    |
| V14 origin downgrade | HTTPS metadata/remote headers, approved endpoints, exact callback origin/path/resource, routing headers refused. `mcpOAuth`, `mcpSecrets`.                    | Mutation receipts below; TLS/DNS posture belongs O-N.      |

V1/V2/V4/V5/V6/V8/V10/V12/V15/V16 retain their named owners in
[the threat model](m109-threat-model.md). O does not claim their platform,
taint, unattended, SSH, sudo, device or peer-enforcement proofs.

## Verification and deliberate failures

Focused test runs use repository default timeout and at most three files with
`--maxWorkers=3`. No timeout override or browser run. The rig brief overrides
aggregate quality and merge instructions: the lead owns joined-tree quality.
All 52 deliberate failures were observed in named tests, with byte-exact source
restoration and a final comparison of every source hash. Receipts:
[m109-o-drills.json](m109-o-drills.json). The nonempty-token drill removes both
equivalent constraints (minimum length and the regex's `+`) to make an empty
token admissible; changing only one correctly leaves the other defense intact.
Drill groups cover references/names/routing, command identity/admission,
source snapshot/digest/wipe, discovery/network/body caps, PKCE/resource/callback
binding, token schema/expiry, refresh serialization/rotation, physical commit,
lock/scoped revoke, buffer/header cleanup, permit settlement and missing ports.

The size-cap mutation initially did not fail: its oversized fixture was also
invalid JSON, so the parser masked the missing cap. The fixture now carries
valid oversized token JSON; removing only the cap produces the named failure.
Redirect fixtures likewise carry a complete valid token reply, so the redirect
guard itself must reject them. No production guard or timeout was weakened.

## Final MacBook receipts

| Check                                    | Result                                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                      | All five projects passed; `typecheck:unit` passed again after test-fixture deduplication.                                                                                       |
| Changed-file ESLint / Prettier           | Exit 0, no warning/disable/ignore added.                                                                                                                                        |
| `npm run deadcode`                       | Plain Knip exit 0.                                                                                                                                                              |
| `npx jscpd`                              | Zero clones at the unchanged zero threshold. It first caught two copied test blocks; the shared token-response fixture and a combined assertion removed them.                   |
| `node scripts/check-l10n.mjs`            | 14 tables, 164 manifest strings, zero problems. No new text keys or manifest registrations.                                                                                     |
| `npm run build`                          | Exit 0, all size/split/host-global/notices gates. Extension 438.0/600 KiB; Model API 448.1/475 KiB; checkpoint store 77.2/225 KiB.                                              |
| Owned four test files                    | 93 passed, default per-test timeout, at most three files and three workers per call.                                                                                            |
| Existing MCP/checkpoint regression files | 52 passed; six existing Windows-only process tests skipped by their existing platform guard on macOS. No skip or timeout introduced. Windows process checks are a lead handoff. |
| Total final focused tests                | 145 passed, six inherited platform skips, nine files in three separate runs. No CLI timeout override.                                                                           |
| New controls                             | 52 named red drills; all mutated source restored byte-exact and all final source hashes match receipts.                                                                         |
| `check:host-api`                         | Expected exit 1: existing B totals plus O's two crypto readers, 53 to 55. No new VS Code API, adapter, built-in or theme variable.                                              |
| Host API handoff                         | [m109-o-host-api.patch](m109-o-host-api.patch) projects the complete B+O count change on this base; `git apply --check` passed. W regenerates/reviews the joined tree.          |

The interrupted exploratory typecheck was restarted to keep gate processes
serialized; its result is not counted. The final full typecheck above passed.
No dependency/tool installed. No visual change/browser suite, external network,
model attempt or paid call. The rig brief forbids aggregate quality here; full
quality and editor/browser checks remain integration work.

## Documentation/help integration text

For W's `[Unreleased]` entry: “Prepared command-bound MCP vault references,
origin-bound remote headers, broker-local OAuth with S256 PKCE and resource-bound
refresh rotation, and digest-bound Move to vault review edits. Missing feeder,
broker transport and editor bindings fail closed; these preparation modules do
not expose a new command or change Muse Code's own sign-in stores.”

For README/reference, only after bindings and editor checks pass: stdio `env`
uses an exact `${secret:name}`; remote headers use it alone or `Bearer ` plus
the reference; credentials never go in command arguments. Muse Code needs the
bridge. OAuth belongs to this backend, never `muse mcp login`; registration,
issuer and resource are bound through the trusted registry. Move imports and
verifies the value, then shows a reviewable edit; the user saves it. Note process
disclosure for stdio and the unchanged paid-use gate. Feature catalog/generator
is absent on this base; register these three feature rows on integration.

## Planning status and next slice

O's core and pool seams are certified on fakes; M109 as a whole remains
planned and its integrated acceptance/checklist stays open. Next slice is
O-X/O-C/O-BH/O-T binding, followed by M95b loopback and M96 bridge, then U/H
editor actions and W's joined-tree gates/docs. No other lane was implemented.
