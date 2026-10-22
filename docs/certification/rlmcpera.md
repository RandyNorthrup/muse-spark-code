# RLMCPERA — MCP client for both protocol eras (D213)

Recorded 2026-10-22 in `RLMCPERA`, branch `rec/rlmcpera`, from
`f3941b8548f3d9ef9126f2dd48ce94ba28f3e53b` (main at 0.19.0). Scope: the
Model API backend's MCP client (`src/core/backends/modelapi/mcp/`),
its constants, one test suite, eleven wire captures, and the records
(PLAN D213, CHANGELOG, README, roadmap). No model call, credential,
dependency or paid feature changed. The drill rig (SDK example servers
and a driver over the product's real pool) lives outside the repo under
the lane's `$TMPDIR/mcp-era` and is not committed.

## Survey verification (every claim against its source, 2026-10-22)

- Current spec is `2026-07-28`: the spec's versioning page names it as
  the current revision
  (`https://modelcontextprotocol.io/specification/versioning`).
- No handshake; the version rides every request: `_meta` carries
  `io.modelcontextprotocol/protocolVersion` (required),
  `io.modelcontextprotocol/clientCapabilities` (required) and
  `io.modelcontextprotocol/clientInfo` (recommended)
  (`…/specification/2026-07-28/basic/index#meta`).
- `server/discover`: servers MUST implement it; clients MAY call it but
  MAY also send any request directly and handle `-32022`
  (`…/2026-07-28/basic/versioning`, `…/2026-07-28/server/discover`).
- Legacy client against modern-only server fails: the compatibility
  matrix's legacy/modern-only row fails on both transports
  (`…/basic/versioning#backward-compatibility-with-initialization-based-versions`).
- TS SDK 1.x (`@modelcontextprotocol/sdk` 1.32.1, latest on npm
  2026-10-22) is legacy-only: its tarball's
  `LATEST_PROTOCOL_VERSION` is `2025-11-25`. The v2 split
  (`@modelcontextprotocol/client`, `@modelcontextprotocol/server`,
  both 2.3.1) speaks `2026-07-28` (tarballs +
  `https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions`).
  Python `mcp` 2.3.0 is dual-era (wheel: `mcp/client/_probe.py`,
  `DISCOVER_TIMEOUT_SECONDS = 10.0`).
- The probe design mirrors the official v2 clients' `auto` mode (the
  v2 client doc above; Python `negotiate_auto`): probe `server/discover`,
  fall back to `initialize`, denylist (only modern evidence is modern),
  `-32022` corrective continuation, no retries, transport-aware silence
  (stdio silence is legacy, HTTP silence is an outage), auth/5xx never
  era evidence, stdio probe on a disposable sibling.
- Connector clients (Codex, Claude Code, Gemini CLI): none speaks only
  the new era. Codex still defaults to `2025-06-18` with `2026-07-28`
  behind its opt-in flag (the public MCP support matrix,
  checked 2026-10-22). The spec requires nothing of legacy-only
  servers (serving both eras is MAY). Hence D213: the connector stays
  legacy-only, no build; the revisit condition is a connector client
  that speaks only the new era.

## What was built

- `mcp/era.ts` (new): one `server/discover` probe at `2026-07-28` on a
  disposable transport (sibling process on stdio, fresh instance on
  HTTP), bounded by the ecosystem's 10 s probe timeout clamped to the
  entry's start-up budget (stdio) or the entry's budget when set (HTTP).
  Verdict modern only on a `DiscoverResult` sharing a modern version or
  a `-32022` at a mutual modern version; `-32022` naming handshake
  versions, and every other answer, falls back; `-32022` naming
  neither fails loudly with the versions named.
- `mcp/connection.ts`: modern requests carry the `_meta` envelope;
  per-request `-32022` retries once at a mutual modern version, never
  to the version in use; `resultType` read per spec (absent is
  complete, unrecognized is invalid); `input_required` runs the MRTR
  loop for form elicitations through the M91 machinery (sampling and
  roots refused, request state echoed untouched, a repeated state
  stops loudly); cancellation stays `notifications/cancelled` on
  stdio in both eras and is never sent on modern HTTP; the legacy
  path is byte-identical.
- `mcp/http.ts`: `MCP-Protocol-Version` mirrored from the body's own
  envelope, `Mcp-Method`, `Mcp-Name` with the spec's Base64 sentinel
  encoding; 400/404 bodies inspected for modern errors (code and
  versions read, text never surfaced).
- `mcp/pool.ts`: era probe before the session opens; the connected
  log line names the settled revision.
- `mcp/elicitation.ts`: the form schema accepts the `$schema` dialect
  annotation modern servers stamp (captured; the restricted subset is
  unchanged).
- `test/unit/mcpEra.test.ts` (20 tests) over
  `test/fixtures/mcpEra/` (11 captures + manifest): verdicts, retry
  inputs, result readings, both eras' form schemas, header vectors
  from the spec's Value Encoding table.

## Drills (real SDK servers through the product's real pool)

Driver: `driver.mjs` (esbuild bundle of `src/…/mcp/pool.ts` with a
settings reader and a `node:child_process` spawner) against SDK
example servers with `add`/`slow`/`greet` tools. Modern-only servers
use `legacy: 'reject'`; legacy use TS SDK 1.32.1.

- RED on unmodified main: modern-only stdio fails with `MCP error
-32022: Unsupported protocol version: 2025-06-18`; modern-only HTTP
  fails with `HTTP 400 Bad Request`. Legacy baseline on main: both
  transports connect, `add(40,2)` is `42`.
- GREEN after: all four connect (`MCP 2026-07-28` / `MCP 2025-06-18`
  in the log); `add` is `42`, `slow` answers `slowly` on each.
- Dual-era (`legacy: 'serve'`/`'stateless'`): verdict modern on both
  transports, tools work.
- Slow modern-only stdio (deaf 12 s): probe times out at 10 s
  (`is silent; the legacy handshake follows`), the session's
  `initialize` answers `-32022`, the corrective step adopts
  `2026-07-28` (`speaks modern MCP; adopting 2026-07-28 after
all`), tools work.
- MRTR elicitation (modern, form + `requestState`, handler accepts):
  `greet` answers `hello, drill`; the server verified the echoed
  state. Legacy elicitation through the refactored resolver:
  `hello, drill` (no regression).
- Decline: the server re-issues the same state; the client stops
  loudly (`repeated its request state instead of advancing`).
- No handler on modern: the server answers `-32021`, surfaced
  (`the request's client capabilities do not declare the required
capability`).
- Cancel on modern stdio (byte tap between client and server):
  `notifications/cancelled` sent after the abort; the envelope on
  the wire carries `2026-07-28`, client `muse-spark-code`, empty
  capabilities. Cancel on modern HTTP (POST sniffer at the real
  SDK handler): no `cancelled` POST after the abort.
- Cancel on legacy (both transports, `extra.signal` observed in the
  real v1 servers): `cancelled=true` — the legacy path still sends it.

## Gate-fire proof

`encodeHeaderValue` was broken on purpose (always the plain value):
6 of the 20 tests failed (the five encoding vectors and the
round-trip); reverted, 20/20 green. `npm run check:catches` passes
with the baseline unchanged (the new handlers are NARROW/REPORTED).

## Notes and follow-ups (D213)

- Not drillable until a second modern revision exists: a disjoint
  modern-only server, and the per-request retry to a _different_
  version (the retry's guard — once, never to the version in use — is
  reviewed; its `-32022` parsing is unit-covered).
- Not sent by any conformant server, hence defensive only: sampling
  or roots `inputRequests`, `input_required` on `tools/list`, an
  unknown `resultType`, an elicitation the client did not declare.
  Each refuses loudly in fixed words.
- The v2 SDK itself refuses to emit a non-flat elicitation schema
  (observed: `Elicitation requestedSchema only supports flat
primitive properties`), so the decline path's schema leg cannot be
  fed by a conformant server; the decline itself was observed live
  (see above).
- Spec-table observation: the Value Encoding table's `Hello世界`
  vector omits the base64 padding the standard requires; the client
  emits standard base64 (`SGVsbG/kuJbnlYw=`), verified by round-trip.
- Follow-ups, not this lane: `Mcp-Param-*` mirroring for
  `x-mcp-header` tools (a `-32020` surfaces honestly today),
  `subscriptions/listen` for modern list changes, response caching
  from `ttlMs`, and verdict caching across restarts (re-probed per
  connect today, always correct).
