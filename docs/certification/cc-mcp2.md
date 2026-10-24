# cc/mcp2 — RLF-MCP2's four MCP follow-ups on RLMCPERA's client (D213)

Recorded 2026-10-23 on branch `cc/mcp2`, from `int/recovery` at
`d81327d360`. Scope: the Model API backend's MCP client
(`src/core/backends/modelapi/mcp/`), two constants blocks, the host's
verdict folder, two unit suites, five wire captures, the host-API count
record, and the records (PLAN.md's RLMCPERA section, this file). No model
call, credential, dependency or paid feature changed. RLF-MCP2
(`refs/rigs/macmini/rec/rlf-mcp2`, report
`muse-fleet/lead/codex/recovery/reports/RLF-MCP2.md`) rebuilt the
dual-era foundation in parallel and was not merged: its four features
were read from its code (`git show <ref>:<path>`) and rebuilt on
RLMCPERA's client, which stays the foundation (probe on a disposable
transport, `_meta` envelope, mirrored headers, `-32022` retry, MRTR).

The drill rig lives in the worktree's `temp/rig/` (ignored, not
committed): `driver.ts` bundles the product's own pool through its bundle
entry (`createMcpPool`), reads a real Muse settings file with the
product's reader, spawns stdio servers with `node:child_process`, reaches
HTTP servers with the real `fetch`, and records every byte the client
sends (each stdin write per process; each HTTP request's method, headers
and body) plus a passive copy of each reply. `run.mjs` writes one run,
`sent.mjs --expect` judges a run by what the client sent and exits
non-zero on a miss, `wirediff.mjs` diffs two runs' exact sent bytes
(only the server-assigned `Mcp-Session-Id` value normalised),
`extract.mjs` copies a recorded reply into a fixture, `battery.sh` reruns
everything.

Servers, all real and current on npm on 2026-10-23:

- Modern: the reference server `@modelcontextprotocol/server-everything`
  2.0.0 (on `@modelcontextprotocol/server` 2.4.0 and
  `@modelcontextprotocol/node` 2.1.2, both published 2026-10-23), HTTP on
  3311 (`PORT=3311 node dist/index.js streamableHttp`) and stdio
  (`node dist/index.js stdio`). Its `get-header-params` annotates `region`
  with `x-mcp-header: Region`, `trigger-list-changed` publishes on the
  handler's subscription bus (HTTP) or the instance (stdio), and its
  `tools/list` carries `ttlMs: 60000`.
- Legacy: the reference server at its last 2025-era release,
  `@modelcontextprotocol/server-everything` 2026.1.26, on
  `@modelcontextprotocol/sdk` 1.32.2 (top revision `2025-11-25`), HTTP on
  3312 and stdio.
- Drill server `temp/rig/stale-server.mjs`, the SDK 2.4.0 modern-only
  (`legacy: 'reject'`) on 3313, for what no reference server provokes: a
  tool whose `x-mcp-header` appears only after `annotate` runs (a stale
  listing, the SDK's own header validation answering `-32020`), the same
  server in `liar` mode on 3314 (the listing never shows the annotation
  its calls require), five annotated tools as the SDK serves them, and
  `drop_listen` (listen sockets destroyed: an abrupt drop) and
  `end_listen` (the SDK's graceful close of every subscription).
  The SDK's `McpServer` advertises `tools.listChanged: true` and
  `ttlMs: 0` by default.

## The specification read (revision 2026-07-28, read 2026-10-23)

Every chapter was downloaded as markdown from
`https://modelcontextprotocol.io/specification/2026-07-28/<path>.md`.

- **`Mcp-Param-*`**: `basic/transports/streamable-http` "Request
  Metadata" (Standard Request Headers; Custom Headers from Tool
  Parameters: Schema Extension, Value Encoding, Client Behavior, Server
  Behavior for Custom Headers; Server Validation), and `server/tools`
  "x-mcp-header". Clients MUST support it; a Streamable HTTP client MUST
  exclude a tool whose annotation breaks the constraints (empty, not an
  RFC 9110 token, not unique case-insensitively, not on string/integer/
  boolean, off a chain of `properties` keys) and SHOULD log the tool and
  the reason; stdio MAY ignore annotations; a value absent or `null` is
  omitted; values are Base64-sentinel encoded when not plain ASCII; on
  `HeaderMismatch` (`-32020`) the client SHOULD call `tools/list` and
  retry with the right headers.
- **`subscriptions/listen`**: `basic/patterns/subscriptions` (Opening a
  Stream, Notification Filter, Acknowledgment, Receiving Notifications,
  Cancellation, Graceful Closure), `basic/transports/streamable-http`
  "Receiving Messages" and "Message Flow", `basic/transports/stdio`
  (notifications correlated by `io.modelcontextprotocol/subscriptionId`),
  `basic/patterns/cancellation` (HTTP: close the stream; stdio:
  `notifications/cancelled`; a server ends a subscription with its own
  `notifications/cancelled`), and `server/tools` "List Changed
  Notification" (servers that declared `listChanged` send changes to a
  client listening with `toolsListChanged: true`). The acknowledgment is
  the first message, names the honoured subset; a transport that closes
  without the graceful result is a disconnect the client MAY reconnect.
- **`ttlMs`**: `server/utilities/caching` (Cacheable Results, Cache Key,
  Time-to-Live, Freshness Calculation `now < t_received + ttlMs`,
  Interaction with Notifications: a notification invalidates; Interaction
  with Pagination: each page's own clock, a consistent snapshot re-fetched
  from the beginning), `server/discover` (a cacheable result). `ttlMs` 0
  or absent is immediately stale and MAY be re-fetched every time;
  positive SHOULD be fresh that long and SHOULD be re-fetched on the next
  access once stale, never as a polling interval.
- **Verdict persistence**: `basic/versioning` "Backward Compatibility with
  Initialization-Based Versions": "The era determination is a property of
  the server, not of an individual request. Clients SHOULD cache the
  result for the lifetime of the server process (stdio) or origin (HTTP),
  and MAY persist it across restarts of the same server configuration,
  re-probing if the cached assumption later fails"; and its compatibility
  matrix.

The official v2 client (`@modelcontextprotocol/client` 2.4.0) was read
as the reference implementation: `scanXMcpHeaderDeclarations`,
`buildMcpParamHeaders` and `encodeMcpParamValue` (mirroring), `callTool`'s
evict, refetch and retry once on `-32020`, `listen()` and the
`listChanged` auto-open (a listen only for what the server advertises),
and `connect({ prior })` (a persisted verdict, `legacy` initializing
directly).

## What was built, and where it differs from RLF-MCP2

- `mcp/headers.ts` (new): the Base64 sentinel encoding (moved from
  `http.ts`, so `connection.ts` uses it without an import cycle; an empty
  value is now encoded too, as the official client does), the
  `x-mcp-header` scan and the `Mcp-Param-{Name}` headers. The scan follows
  the official client's keyword list (`items`, `prefixItems`, `contains`,
  `additionalProperties`, `unevaluated*`, `propertyNames`,
  `patternProperties`, `dependentSchemas`, `oneOf`, `anyOf`, `allOf`,
  `not`, `if`/`then`/`else`, `$defs`, `definitions`); RLF-MCP2 treated
  every other key as off-chain, which would reject a tool whose `default`
  or `const` value merely holds the key. A primitive value is mirrored as
  sent (string as-is, boolean lower case, number decimal, nothing past the
  safe integer range), as the official client does, so the header always
  matches the body and the server's own schema check reports a wrong type
  (RLF-MCP2 omitted it, turning a type error into a `-32020`).
- `mcp/connection.ts`: a modern HTTP listing scans each tool and leaves a
  breaking one out (a warning names it and the reason); a call carries its
  tool's mirrors on every MRTR round. `listenForToolChanges()` opens the
  subscription only on a modern server whose tools capability says
  `listChanged` (the official auto-open rule): on HTTP the listen's stream
  is held (`http.ts` `subscribe`), on stdio the listen is sent once and
  closing sends `notifications/cancelled` for it. The acknowledged filter
  is checked; one leaving tool changes out closes the subscription. The
  listen's own answer (graceful result or refusal) or the server's
  `notifications/cancelled` ends it; an acknowledged HTTP stream that
  drops without an answer is opened again, while one dropped before its
  acknowledgment counts as refused (RLF-MCP2 reopened any silent drop).
  The listing's freshness is the earliest positive page `ttlMs` past its
  receipt (`changes.ts` `pageFreshUntil`); a page with none leaves the
  listing without a clock; `notifications/tools/list_changed` makes it
  stale at once.
- `mcp/changes.ts` (new): the tools capability a discovery result names,
  the subscription messages' readers and `pageFreshUntil`. They first sat
  in `protocol.ts`, which `dist/modelApi.js` and `dist/hookRuntime.js`
  also bundle (through the elicitation and tool-outcome modules): esbuild
  keeps module-level zod schemas, so both grew 249 bytes, and
  `dist/modelApi.js` was already over its budget on the base. Moved here,
  imported by the connection alone, both bundles are byte-identical to
  the base build's (`cmp`), and `protocol.ts` differs from the base by
  one `export`.
- `mcp/pool.ts`: `definitions()` (each request's offer) starts a re-read
  of a modern listing whose clock lapsed, one at a time per server; the
  request that noticed carries the list it had, the next carries the new
  one. RLF-MCP2's per-connection response cache was never read by the
  product (every re-read path invalidated it first), so the port puts the
  spec's freshness where the product holds the listing: offered from
  memory while fresh, re-read from the beginning (the spec's
  consistent-snapshot rule) once stale. A `-32020` on a call relists
  through the pool, so the offered catalogue and the mirrors refresh
  together, then retries once; a tool the new listing no longer offers is
  not called again (RLF-MCP2 retried inside the connection, leaving the
  model's catalogue stale). The era verdict: a kept one opens the session
  without a probe (legacy: the plain handshake; modern: one
  `server/discover` on the session's own transport, under the probe's
  bound, adopting the capability it names), and any failure of that start
  but a Stop closes the session and probes afresh; the settled era is
  written when it differs from the kept one.
- `mcp/verdicts.ts` (new): one JSON file (`mcp-era-verdicts/verdicts.json`
  in the extension's global storage), written atomically
  (`writeFileAtomic`) and in order; a verdict is `{era}` or
  `{era, version}`, keyed by a SHA-256 of the server's launch as its
  entry writes it before `${VAR}` expansion (`servers.ts` `identity`), so
  no environment value reaches the key (RLF-MCP2 hashed the expanded
  command, arguments and URL). A missing file is a first run; one that
  cannot be read keeps nothing and says so, and is replaced on the next
  write.
- `mcp/era.ts`: the verdict carries the tools capability
  (`listChanged`), `confirmModern` confirms a kept modern verdict, and the
  probe's bound is shared with it (the same 10 s spec-ecosystem verdict
  bound D213 records, not a new one).
- Host: `mcpServers.ts` and `extension.ts` pass the verdict folder.

## RED drills (unmodified `d81327d360`, through the product's pool)

- **`Mcp-Param-*`** (`red-param`): `get-header-params {region: eu-west}`
  on the modern reference server failed `MCP error -32020: the request
headers do not match the request body`; the call's headers carried
  `mcp-method`, `mcp-name` and the version, no `mcp-param-region`. Exit 1.
- **listen** (`red-listen-modern-http`, `red-listen-modern-stdio`):
  `trigger-list-changed {list: tools}` answered "Sent
  notifications/tools/list_changed"; the client sent no
  `subscriptions/listen`, heard nothing and listed once (`--expect
{"subscriptions/listen":1,"tools/list":2}`: EXPECTATION FAILED, exit 1,
  on both transports).
- **`ttlMs`** (`red-ttl`): the reference server's `tools/list` said
  `ttlMs: 60000` (its `server/discover`, 300000); offered at 0.3 s, 61.3
  s and 62.8 s, the 61-second-old list was never read again (`tools/list`
  x1, expected x2: exit 1).
- **verdict** (`red-verdict-*`, the same configuration started twice with
  a verdict folder named): the second start of the legacy stdio server
  spawned the sibling probe again and sent `server/discover` (spawns 2,
  discover 1; expected 1 and 0: exit 1); the modern one also spawned its
  sibling again (spawns 2, expected 1: exit 1). No verdict file existed.
- Legacy baselines for the byte diff: `base-legacy-legacy-http` (7 HTTP
  requests, 2818 bytes) and `base-legacy-legacy-stdio` (2 processes, 983
  bytes): connect, `echo`, `get-sum(40, 2)` = 42, close.

## GREEN drills (the committed tree)

- **`Mcp-Param-*`**: `mcp-param-region: eu-west`, and for `Zürich`
  `=?base64?WsO8cmljaA==?=`; the server answered with the header it
  received (`regionHeader` equal to each). On the drill server: the
  stale listing's call drew `400 -32020`, the client listed again and
  retried once with `mcp-param-zone: after` (answer `zone after; header
after`); the liar server drew `-32020`, one relist, one retry, `-32020`
  again, surfaced as the call's failure (exactly two calls sent);
  `bad_header_tool`, `number_header_tool`, `twice_header_tool` and
  `items_header_tool` were left out, each with its reason in the log;
  `nested_header_tool {where: {region}, days: 3, flag: false}` carried
  `mcp-param-region: eu-west`, `mcp-param-days: 3` and
  `mcp-param-flag: false`, answered 200 by the SDK's own validation.
- **listen**: on HTTP the held stream carried
  `notifications/subscriptions/acknowledged` (filter
  `toolsListChanged: true`, subscription id 2), then, after
  `trigger-list-changed`, `notifications/tools/list_changed` under id 2;
  the client listed again ("changed its tools: 22 offered"); closing the
  pool aborted the stream. On stdio the listen (id 2), the relist after
  the change, and `notifications/cancelled` for the listen on close. On
  the drill server, `drop_listen` broke the acknowledged stream ("stream
  broke: TypeError"; "dropped; listening again"), the second listen was
  acknowledged, and `end_listen`'s graceful result ended it with no third
  listen (`subscriptions/listen` x2).
- **`ttlMs`**: offered at 0.1 s and 30 s from memory (no request); at 61
  s the lapsed listing was read once ("listed its tools again after their
  listing went stale: 22 offered"); at 62.6 s and 64 s fresh again
  (`tools/list` x2 in all). The drill server's `ttlMs: 0` listing was
  never re-read by the clock (`tools/list` x1 after 61 s).
- **verdict**: second starts opened in the kept era with no probe:
  legacy stdio one process, no `server/discover`; modern stdio one
  process, its `server/discover` on the session itself, then the listen;
  legacy HTTP no `server/discover`. The file held only hashes
  (`{"format":1,"verdicts":{"<64 hex>":{"era":"legacy"},...}}`; no
  name, command, path or URL). Kept assumptions failing: a kept modern
  verdict for `http://127.0.0.1:3315/mcp` with the legacy reference server
  now on that port: the session's discover drew a 400, "did not answer as
  its kept modern verdict said; probing it again", legacy, connected,
  verdict rewritten `legacy`; then a modern-only SDK server on that port
  under the kept legacy verdict: the handshake drew `-32022`, the
  corrective step went modern, verdict rewritten `modern`. Over stdio, one
  command line (`temp/rig/swap-stdio.mjs`) running the modern then the
  legacy reference server: the kept modern discover failed on the
  session's own process, the sibling probe said legacy, a new session
  connected, verdict rewritten.
- **Legacy bytes**: `wirediff.mjs` against the base baselines, both
  transports: a start with no verdict folder IDENTICAL (2818 and 983
  bytes); the first start with a folder IDENTICAL; a kept-verdict start
  IDENTICAL to the base's session alone (2211 and 685 bytes; the probe is
  simply not sent).

The final battery was rebuilt from the final source (after the lint
fixes and the `changes.ts` move) and run untouched: `battery.sh` (23
checks: mirroring, liar, listen on both transports, kept verdicts, the
six legacy byte diffs, `ttlMs` 60000) and `battery-drill.sh` against a
freshly started drill server (7 checks: `ttlMs` 0, the stale-schema
retry with the exclusion warning, listen drop and graceful end), all
PASS, `fails=0` for both. The three verdict swaps (HTTP both ways, stdio
legacy-after-modern) were run again on the same tree: each probed again
or took the corrective step, connected and rewrote its verdict as above.
One harness slip on the way, not the product: an earlier battery's
drill-server legs ran after `end_listen` had closed that server's
handler for good (every request answered HTTP 500), so those legs moved
into `battery-drill.sh`, which runs them on a fresh server with the
graceful end last.

## Unit tests and their gate fires

`test/unit/mcpEra.test.ts` (33 tests, 13 new) over five new captures in
`test/fixtures/mcpEra/` (provenance in its manifest's `cc-mcp2` block):
the reference listing's `Region` mirror and its values as the server
echoed them, every other reference tool kept, the four breaking drill
tools rejected with their reasons, the nested/integer/boolean mirrors
the SDK accepted, the `-32020` refusal read for its code (never its
words), the subscription's acknowledgment and change, and
`pageFreshUntil` over the 60000 and 0 listings.
`test/unit/mcpVerdicts.test.ts` (6 tests) over real files: keys from the
product's planner name the launch as written (a rotated `${TOKEN}` value
keeps the key), a restart reads both verdicts back, the file holds no
name, command, URL or secret, a changed verdict is rewritten, an
unreadable file is said out loud and replaced.

Broken on purpose, then reverted (each run exit 1, then green):

- the token check skipped in `scanHeaderMirrors`: "rejects the served
  bad_header_tool with its reason" failed (1 of 33);
- `pageFreshUntil` ignoring earlier pages: "keeps a listing whose ttlMs
  is positive fresh for that long" failed (1 of 33), in `protocol.ts` and
  again after its move to `changes.ts`;
- the store never writing: three `McpVerdictStore` tests failed (3 of 6).

## Gates (final tree)

Exit codes on the final tree; "base" is the untouched `d81327d360`, run
from a `git archive` extraction in `temp/base` or, where a suite needs
git, with the base versions of this lane's files checked out in place
and restored afterwards.

- `prettier --check` (touched files, captures, PLAN.md, this record): 0.
- `eslint --max-warnings 0` (touched files): 0.
- `npm run typecheck`: 0.
- MCP suites (`mcpEra`, `mcpVerdicts`, `mcpServers`, `mcpOffer`,
  `mcpParse`, `mcpOAuthDenied`, `mcpJobRetire`): 0, 55 tests.
- `vitest related` for the nine changed or new MCP sources and the
  host's `mcpServers.ts` (74 files, 809 tests): 1, two failures, both
  pre-existing: `extensionHookPlanProvider` (`EBUSY` removing its temp
  folder, identical on the base) and `evalJudgeWiring` ("expected 0 to be
  greater than 0", identical with the base sources in place; it drives a
  scripted turn with no MCP pool).
- `npm run cycles`: 0. `npm run deadcode` (knip): 0.
- `npm run check:host-api`: 0 after `-- --write` (count-only drift:
  `node:crypto` 306→307, `node:fs/promises` 198→199, `node:path`
  338→339, the verdict store's imports).
- `npm run check:l10n`: 0. `npm run check:reference`: 0.
  `npm run check:roadmap`: 0.
- `npm run check:catches`: 1, pre-existing: the same SWALLOW/GENERIC/
  CLEANUP rises and the same 24 new sites (accounts, paid, runtime
  providers, webview accounts) on the base; this lane's catches are
  NARROW or REPORTED and add none.
- `npm run duplication`: 1, pre-existing: 41 clones on the base and on
  this tree (one clone this lane first added, its test's temp-folder
  tracker, now uses the shared `temporaryTracker`).
- `npm run check:plan`: 1, pre-existing: PLAN.md 3,737,114 bytes on the
  base, over 85% of the archived-plan budget; this lane's eight lines
  make it 3,737,641 (527 bytes worse). The archive step is the lead's.
- `npm run build`: 1, pre-existing: the same 12 bundles over budget on
  the base (`modelApi.js` 575.0 KiB of 525, `modelsPanel.js`,
  `uiText.js`, `wire.js` and eight others). This lane's bundles hold:
  `dist/mcpPool.js` and `dist/modelApiMcp.js` 70.5 KiB of 75 (59.5 on
  the base); `dist/extension.js` 516.2 KiB of 600 (516.1);
  `dist/modelApi.js` and `dist/hookRuntime.js` byte-identical to the base
  build.

## Not drilled, with the reason

- A server that acknowledges a listen without `toolsListChanged`, and a
  stdio server's own `notifications/cancelled` for a listen: no
  conformant server that advertises `listChanged` does either (the SDK
  honours the filter its capability declares, and tears stdio
  subscriptions down only on shutdown, when the process exits too).
  Each ends the subscription in fixed words.
- A kept or probed modern verdict at a second modern revision: none
  exists yet (D213's note); `confirmModern` adopts the newest mutual
  revision a discovery result names.
- The packed product: these drills ran the product's pool from source
  through its bundle entry, not the installed VSIX, so README and
  CHANGELOG claims wait for the packed-product run (AGENTS: nothing is
  claimed until used for real through the packed product).
