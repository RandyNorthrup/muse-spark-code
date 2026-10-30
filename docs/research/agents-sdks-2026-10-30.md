# Agent backends, protocols and editor SDKs — currency survey (2026-10-30)

Lane RLF-UPAGENT, base `int/recovery` `b781451b94`, rig `linuxlt`.
Every source below was read on 2026-10-30 unless a different date is
named. Registry facts are `npm view <pkg> version|time --json` run that
day against registry.npmjs.org; package diffs are `npm pack` tarballs
unpacked under the lane's `$TMPDIR` the same day. Our state is this
tree: `package.json`/`package-lock.json` pins, `src/`, PLAN.md
M127/M63/M104/D213. The gap table is §7; the lane briefs for the larger
gaps and the fix record are `docs/certification/rlf-upagent.md`.

## 1. Muse Code CLI and `@muse-code/sdk` (M127)

Our pin: `@muse-code/sdk` 1.4.11 (`package.json`); this rig's CLI is
1.4.11 (1.4.11-R6667.1, `muse --version`, 2026-10-30). The registry's
latest is **1.4.14** (published 2026-10-27T18:59Z); 1.4.13 was
2026-10-24 and 1.4.12 was 2026-10-22, so on 2026-10-30 only **1.4.12 is
past this repository's 7-day `min-release-age` window** (`.npmrc`).
The official changelog (`https://dev.meta.ai/docs/muse-code/changelog`,
read 2026-10-30) documents 1.4.13 and 1.4.12; it carries no 1.4.14
section yet.

What 1.4.12 changes for a session-protocol host (same changelog):

- `muse serve --preset` chooses a run preset when starting a session
  host. We never pass `--preset` (`grep src/` 2026-10-30): no break, a
  capability we do not offer.
- Permission profiles gain `network.local_ports` (`allow`/`ask`/`deny`
  per port), and a loopback entry in `network.targets` is now rejected;
  a chat that saved local-port rules cannot be opened by an older
  build. We pass only a profile _name_ (`permissionProfile` in
  `src/core/backends/musecode/MuseCodeHost.ts`) and author no network
  targets, so our bytes are unaffected; a person's own saved profile is
  the CLI's to refuse, in its words.
- Shell commands can write under every `workspaceRoots` root a session
  client grants, not only the primary root — a fix in our favour.
- Hooks set with `muse serve -c hooks.…` now run in served sessions
  instead of being silently dropped — a fix in our favour.
- The session snapshot's `activeTurn` now names the turn a Replace
  started; several `session/leave` races are fixed (timeout, stop,
  replay after restart).

What 1.4.13 changes (same changelog): `muse usage` shows the
subscription allowance (windows, resets, tier) without a model turn,
and `muse exec --json` reads it when the run saw no usage update —
we call neither today; `--yolo` keeps the `request_user_input` tool
and enables async questions, with `--disable-request-user-input` for
runs that should ask nothing — we pass neither flag; filesystem `deny`
rules on profiles extending `:ask-me` are enforced on macOS/Linux
instead of silently ignored; untrusted-workspace sessions fail closed
and no longer inherit trusted behaviour or an earlier trusted
session's project rules; a resumed chat whose saved history lost a
permission change resets to defaults (or read-only) instead of
reopening wider; `turn/unqueue` works behind an internal turn;
connected clients are offered the same third-party models as the
terminal picker — our catalogue reads `model/list` as served, so those
rows arrive without code. No contributor-mode or tier change is
recorded in either release; `contributor_mode_enabled` handling is as
M127 recorded it (2026-10-18).

Package diff, `@muse-code/sdk` 1.4.11 → 1.4.12 (`diff -rq` of the two
tarballs, 2026-10-30): only `dist/src/facade/approval.js` (retains a
request's `cuaCardFacts` across approval stages), `dist/src/msp.d.ts`,
and the fingerprint pin differ. The modules we import
(`dist/src/connection/*`, `dist/src/fingerprint.js`, the package root)
are otherwise byte-identical; the fingerprint value moves from
`sha256:f282ad16…1082` (1.4.11) to `sha256:cfdb6d25…b4e0` (1.4.12).
`msp.d.ts` adds, all optionally: `ApprovalRequest.cuaCardFacts`
(Computer Use card facts: page host, window title, consequential
steps), item payloads `BackgroundTerminalCompletion`, `BlockedPrompt`
and `CheckpointBoundary`, item kinds `backgroundTerminalCompletion`
and `overdueNotice`, and `Task.executionMode`
(`foreground`/`background`). Our wire item schema keeps `kind` an open
string (`src/shared/agentEvents.ts`, `itemSnapshotFields`), so new
kinds parse and render generically; the new payload fields are stripped
by zod today and rendering them properly is new UI (brief B2 below).
With the SDK still at 1.4.11, a person on CLI 1.4.12 gets a
schema-fingerprint _warning_ at every `muse serve` start (served
`cfdb…` is neither the pin nor a `MSP_KNOWN_SCHEMA_FINGERPRINTS` entry,
`src/host/backend/museCodeBackendManager.ts` `logFingerprint`); pinning
1.4.12 makes that host exact-match silent and keeps 1.4.11 hosts on the
known-build info line. That pin is this lane's fix.

1.4.14 (registry 2026-10-27, no changelog section yet) moves the
fingerprint again (`sha256:c94c3d1f…49c6`) and adds more optional MSP
fields (`reviewerReason`, `held`/`heldFor`, `earlierHistory` items,
`queuedInputs`, session `worktree`/`spawnedBy`, CUA `data` mask facts;
tarball diff 1.4.12 → 1.4.14, 2026-10-30). It is inside the 7-day
window; brief B2 covers the move with served captures.

## 2. ACP — spec and `@agentclientprotocol/sdk`

Our pin: 2.0.1 (published 2026-10-22), agent side on `/unstable`
(RLSDKMUSE, 2026-10-22). Registry latest is **2.2.0** (2026-10-30,
same day); 2.1.0 was 2026-10-28 and 2.0.2 was 2026-10-23T19:39Z, so
**none of 2.0.2 → 2.2.0 is past the 7-day window on 2026-10-30**
(2.0.2 clears it on 2026-10-31). Protocol version is still 1 in the
v1 entrypoints of every one of these releases (`PROTOCOL_VERSION = 1`
in each tarball's `dist/v1/schema/index.js`); an experimental v2
(protocol 2, `auth/login`/`auth/logout`, no fs/terminal methods in its
current method set) ships beside it and no editor requires it.

Tarball diffs (2026-10-30):

- **2.0.2** fixes the stdio line buffer: LF/CRLF and optional CR line
  endings, including a CRLF split across chunks
  (`dist/core/line-buffer.js`), and documents the HTTP-stream
  transport's per-request error semantics. We run the agent on the
  SDK's own `ndJsonStream` (`src/runtime/runtimeEngineEntry.ts`), so a
  client that frames with CRLF (a Windows editor pipeline) can stall
  or corrupt framing on 2.0.1. This is the one ACP change with
  shipped-feature reach; its pin waits one day for the window (brief
  B1).
- **2.1.0** adds an MCP-over-ACP binding (`dist/mcp/`,
  `McpOverAcpCaller`/`McpOverAcpProvider`) speaking MCP **2026-07-28**
  (`MCP_PROTOCOL_VERSION` in `dist/mcp/core.js`) with the per-request
  `_meta` envelope. Our agent parses ACP-transport MCP servers (that is
  why it is on `/unstable`) but cannot run them: `mcpServersFrom`
  (`src/acp/translate.ts`) forwards stdio and HTTP servers and reports
  the rest skipped. Serving them is brief B3.
- **2.2.0** is transport and router work (connection, HTTP stream,
  WebSocket) plus schema regeneration; the v1 method set is unchanged
  from 2.0.1 (method lists compared across all four tarballs). Zed's
  own update to Rust SDK 2.2.0 names the user-visible fix as accepting
  `null` for empty/defaultable agent payloads
  (`https://github.com/zed-industries/zed/commit/85b8198e863413325bbbf7f34f616e374277c6cf`,
  read 2026-10-30) — client-side tolerance, nothing an agent must do.

What clients now expect: Zed (v0.221+) and JetBrains AI Assistant
(2025.3+, registry integration in 2026.1) install agents one-click
from the **ACP Agent Registry**, launched 2026-01-28 by Zed and
JetBrains (`https://www.jetbrains.com/help/ai-assistant/acp.html`,
last modified 2026-10-07, read 2026-10-30;
`https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/` via search
result, 2026-10-30). The registry's gating requirement is an
`initialize` response whose `authMethods` holds at least one `agent`
or `terminal` method (registry prerequisites as recorded by two
independent agent projects' publishing guides, read through search
2026-10-30). Our agent already answers that shape: it offers a
`terminal` method when the client announces terminal auth
(`src/acp/agent.ts` `authMethod`). But **we are not listed**: nothing
in PLAN.md or `docs/acp.md` records a registry submission (`grep
2026-10-30`), so Zed and JetBrains users cannot one-click install us
(brief B4). The ACP _Streamable HTTP & WebSocket transport_ RFD moved
to Active on 2026-07-02 (recorded in a third-party ACP study read
through search 2026-10-30); Zed still launches external agents as
local stdio subprocesses today, which is what we ship. Neovim reaches
ACP through CodeCompanion (and avante.nvim/agentic.nvim), Emacs
through agent-shell — both already our M63 test targets
(`docs/ide-compatibility/hosts.md`); no client-side change since
M104's design alters what they ask of an agent beyond §2's items.

## 3. MCP — spec, TypeScript SDK, host expectations

Current spec revision is **2026-07-28**; no newer stable revision
exists (`https://modelcontextprotocol.io/specification/2026-07-28/changelog`
and `.../basic/versioning`, read 2026-10-30: "Modern: revision
2026-07-28 and later"; the revision list's previous entry is
2025-11-25). D213/RLMCPERA already speak it: the client probes
`server/discover` at 2026-07-28, carries the `_meta` envelope and
mirrored headers, retries `-32022` once, runs MRTR elicitation,
mirrors `Mcp-Param-*` for `x-mcp-header` arguments, runs
`subscriptions/listen`, honours a listing's `ttlMs`, and persists each
server's era verdict (`src/shared/constants.ts` MCP block;
`src/core/backends/modelapi/mcp/`). Against the 2026-07-28 changelog
item by item (same URL, read 2026-10-30):

- Stateless core, `server/discover`, `subscriptions/listen`, MRTR,
  `resultType`, cacheable results: implemented (D213 + cc/mcp2).
- Authorization: `iss` validation before redeeming a code (SEP-2468)
  is implemented (`src/core/mcp/oauth/client.ts`, the callback `iss`
  check against the recorded issuer). Credentials are bound to a
  recorded `issuer` in the binding (SEP-2352's direction). What we do
  **not** have: any client registration at all — a binding requires a
  `clientId` the person supplies, and there is no Dynamic Client
  Registration and no Client ID Metadata Document support (`grep
2026-10-30`). The 2026-07-28 revision _deprecates_ DCR (RFC 7591) in
  favour of Client ID Metadata Documents and requires an appropriate
  `application_type` where DCR is still used (SEP-837). A server whose
  authorization server expects registration therefore cannot be
  onboarded by a person who has no pre-registered client (brief B5).
- Roots, Sampling and Logging are deprecated (SEP-2577, twelve-month
  minimum window under the new lifecycle policy). Our client offers
  neither Roots nor Sampling (`connection.ts`: "the client offers
  nothing else (no sampling or roots)"), which is the direction the
  spec now blesses; nothing to remove.
- Tasks moved out of the core into the `io.modelcontextprotocol/tasks`
  extension (SEP-2663). We advertise no tasks support client-side and
  the connector offers none; a server that requires the Tasks
  extension is out of reach until brief B6 is taken or refused with
  evidence.
- Error-code allocation: `-32020`…`-32099` is now spec-reserved and
  `-32000`…`-32019` implementation-defined with existing usage
  grandfathered. Our connector's own `-32001`
  (`CONNECTOR_RPC_ERRORS.requestTooLarge`, `src/shared/constants.ts`)
  sits inside the implementation-defined range, and the connector is
  legacy-era by D213; no change owed.

The official TypeScript SDK split for 2026-07-28 into
`@modelcontextprotocol/client` + `/server` (v2, stable 2026-07-27;
`https://github.com/modelcontextprotocol/typescript-sdk/releases`,
read 2026-10-30); the v1 monolith `@modelcontextprotocol/sdk` 1.32.2
(2026-10-23) is maintenance. We depend on neither — the client is
hand-rolled (`grep package.json`), and its `x-mcp-header` walk already
follows the v2 client's 2.4.0 `scanXMcpHeaderDeclarations` including
the rule that an annotation on a `number` parameter rejects the tool
(`src/core/backends/modelapi/mcp/headers.ts`, read against the 2.4.0
release 2026-10-23). What 2.4.0 adds that we lack: the **Skills
extension** (SEP-2640: a server publishes a folder of skills; same
release page), and on the server side the **MCP Apps extension**
(`io.modelcontextprotocol/ui`, spec extension-negotiation example,
`.../basic/versioning` read 2026-10-30). Both are optional extensions
a host must opt into; they matter for our M124 connector only when a
named host asks (brief B6). Mainstream hosts (VS Code, Claude, Cursor,
Zed) keep accepting legacy-era stdio and Streamable HTTP servers with
`initialize` — dual-era is the spec's own term for supporting both, and
nothing read on 2026-10-30 announces a legacy cut-off; D213's
"connector stays legacy" still holds. Our connector negotiates
2025-11-25 first (`CONNECTOR_PROTOCOL_VERSIONS`) and serves
`structuredContent` from 2025-06-18, which is what current hosts
require of a tools server.

## 4. VS Code API

Current stable is **1.144.0** (released 2026-10-28;
`https://code.visualstudio.com/updates/v1_144`, read 2026-10-30), and
`@types/vscode` 1.144.0 was published 2026-10-28. Our engine floor is
`^1.99.0` with `@types/vscode` 1.99.0, deliberately: PLAN.md's A8
rationale records that VSCodium 1.99.3 and code-server 4.99.4 refused
a 1.125 floor, and `.vscode-test.mjs` runs the floor so a newer API
fails here first. Raising the floor is a product decision against that
record, not a currency fix; this lane does not raise it. We declare no
`enabledApiProposals` (`package.json`, 2026-10-30), so no proposed API
finalization strands us, and 1.144's notes list **no deprecated
features or settings** (same URL). Two 1.144 items do reach us:

- **Publishing.** `vsce publish --oidc` (Trusted Publishing, no stored
  PAT) ships in `@vscode/vsce` 4.1.0 (published 2026-10-28; the
  tarball carries `out/oidc.js` and its README documents the flag,
  verified 2026-10-30). The same notes state that **global PATs in
  Azure DevOps are retired on 2026-12-01** and recommend moving
  publishing off them. Our `release.yml` publishes to the Marketplace
  with `secrets.VSCE_PAT` on `@vscode/vsce` 4.0.0. After 2026-12-01
  that job cannot publish: **P1**, brief B7 (the Trusted Publishing
  policy itself is created in the publisher's Marketplace account —
  the owner's step, like buying credits).
- **Agent Host Protocol (AHP) 1.0.** VS Code 1.144 publishes AHP, the
  JSON-RPC protocol its separate Agent Host process speaks so agent
  sessions outlive an editor window and can be driven from VS Code,
  the Copilot app and GitHub.com (1.144 notes above;
  `https://github.com/microsoft/agent-host-protocol` via search,
  2026-10-30). It is not an extension API we use today (we ship our
  own panel and backends); appearing as an AHP host or client is a new
  surface, brief B8, not a break.

Chat participants, the Language Model API (our Copilot route already
reads models through `vscode.lm` — `docs/ide-compatibility.md`
subscription boundary), inline completions (our Tab surface) and
terminal shell integration were all finalized long before the 1.99
floor; nothing in the 1.141–1.144 run of notes (read through the
1.144 page and its archive links, 2026-10-30) deprecates an API this
tree calls — the tree-wide host-API record is
`docs/ide-compatibility/host-api.md`, kept by `npm run
check:host-api`, and no row in it names a removed API. TypeScript
stays 6.0.3: `typescript-eslint` 8.72.1 (registry, 2026-10-30) still
peers `typescript >=4.8.4 <6.1.0`, so the AGENTS.md pin holds.

## 5. Editor hosts for M104

M104's rows in this tree are mostly Planned/Prototype
(`docs/ide-compatibility/hosts.md`: JetBrains and Visual Studio
Planned; the native hosts in `hosts/` are one Kotlin file and one Java
file of MHP error vocabulary). What changed upstream since M104's
design, per host (all read 2026-10-30):

- **JetBrains.** The ACP route is now the front door: AI Assistant
  connects external ACP agents in every IntelliJ-family IDE, from the
  shared registry or `~/.jetbrains/acp.json`, without a JetBrains AI
  subscription (`https://www.jetbrains.com/help/ai-assistant/acp.html`,
  modified 2026-10-07). For M104's planned _native_ plugin, IntelliJ
  Platform 2026.3 extracts several core-plugin modules into separate
  classloaders (explicit `build.gradle.kts` dependencies owed), moves
  bundled JNA out of the core classloader toward FFM, and renames the
  LSP APIs from server-named to client-named
  (`https://plugins.jetbrains.com/docs/intellij/api-changes-list-2026.html`,
  modified 2026-10-09; platform forum posts read through search). Our
  one Kotlin file uses none of those APIs; the native lane inherits
  the notes when it is built (brief B9 records them).
- **Visual Studio.** Visual Studio 2026 shipped with the new
  out-of-process `VisualStudio.Extensibility` SDK as the modern route
  while keeping Visual Studio 2022 extension compatibility
  (`https://www.infoworld.com/article/4088876/microsoft-releases-ai-native-visual-studio-2026.html`
  and Microsoft Learn's extensibility pages, read through search
  2026-10-30). M104's Visual Studio row names "Native (VSSDK,
  WebView2)"; when that lane is built it should target the new SDK
  first (brief B9).
- **Xcode.** Xcode 27 (WWDC 2026, Apple silicon only) accepts plug-ins
  that "connect any agent compatible with the Agent Client Protocol"
  and bring tools through MCP (Apple's announcement as carried by
  `https://www.stocktitan.net/news/AAPL/apple-accelerates-app-development-with-new-intelligence-frameworks-ze0pnnna0jni.html`,
  2026-06-08, read 2026-10-30). M63 already lists "then Xcode 27"
  after Zed and JetBrains; the route is the shipped ACP agent, not a
  source-editor extension (brief B10: qualify it).
- **Zed.** External agents come from the ACP Registry (preferred since
  Zed v0.221.x) or `agent_servers` settings; Zed launches them as
  local stdio subprocesses (§2). A _native Zed extension_ (M104's
  other possible route) would use Zed's extension API, which the
  registry route makes unnecessary for an agent; no change owed.
- **Neovim / Emacs.** CodeCompanion (plus avante.nvim, agentic.nvim)
  and agent-shell remain the ACP clients; both are already M63 test
  targets with recorded runs (`docs/ide-compatibility/hosts.md`). No
  protocol change since M104's design reaches them (§2).
- **Sublime Text / Qt Creator.** Both now have community ACP clients
  (the Sublime `ACP` package with persistent sessions and model/mode
  switching; a Qt Creator ACP client in the ACP clients directory —
  `https://agentclientprotocol.com/get-started/clients` via the
  awesome-agent-client-protocol list, read 2026-10-30). M63 lists
  both editors; qualification is a test-target job, brief B10.
- **Eclipse.** Our row runs through Theia/Eclipse in `test/hosts/` on
  every touching pull request; nothing read on 2026-10-30 announces an
  Eclipse platform change that reaches the one Java file we ship.

## 6. Grok / xAI (RLGROKAUTH)

Still no supported third-party route. RLGROKAUTH waits because xAI
publishes no developer console to register a third-party OAuth client,
and this product refuses to borrow another application's client id
(`src/shared/constants.ts`, the `grokClientId` setting stays empty
until xAI issues one). Nothing read on 2026-10-30 changes that:
multiple current third-party implementations record the same fact in
their own words — "xAI publishes no developer console to register a
third-party OAuth client", "xAI has not published documentation
permitting this for third-party apps, and may change or block it" —
and proceed anyway on the Grok CLI's public client id (open-source
provider plugins and decision records read through search
2026-10-30). That remains off-label use of another application's
identity; the owner's standing rule (credentials and identity are
never another app's) keeps RLGROKAUTH waiting on xAI. The check to
repeat is xAI's own documentation: `https://docs.x.ai` carries API and
release notes but, as read 2026-10-30, no third-party OAuth client
registration.

API-side changes that touch the _API-key_ Grok route we do ship
(`https://docs.x.ai/developers/release-notes`, read through search
2026-10-30): `grok-voice-3.0` replaced Voice 2.0 on 2026-10-14;
`grok-voice-transcribe-1.0` reached end of life 2026-10-02;
`grok-imagine-image-quality` retires 2026-11-02 (migrate to
`grok-imagine-image-2.0`); Grok 4, 4.1 Fast and 3 were retired
2026-05-15; Grok 4.7 (2026-09-21) is the current flagship. Our tree
names none of the retired slugs (`grep src/` 2026-10-30) and its xAI
reasoning facts already cover grok-4.5 through grok-4.7
(`src/core/providers/presets.ts`): no gap.

## 7. Gap table

Severity: P1 breaks or will break a shipped feature; P2 a standard
capability we lack; P3 nice to have. "Fixed here" is this lane;
B-numbers are the lane briefs in `docs/certification/rlf-upagent.md`.

| Component            | Item                                                                                                         | Source (read 2026-10-30)                      | Our state                                                               | Severity                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- |
| VS Code publishing   | Global Azure DevOps PATs retire 2026-12-01; `vsce publish --oidc` is the replacement                         | code.visualstudio.com/updates/v1_144          | `release.yml` publishes with `VSCE_PAT` on vsce 4.0.0                   | **P1** (B7)                       |
| Muse SDK             | 1.4.12 fingerprint + additive MSP fields                                                                     | dev.meta.ai changelog; npm tarballs           | Pinned 1.4.11 → warning per start on CLI 1.4.12                         | P2 — **fixed here** (pin 1.4.12)  |
| Muse SDK             | 1.4.13/1.4.14 fields (`cuaCardFacts` rendering, `backgroundTerminalCompletion`, `held`, `earlierHistory`, …) | dev.meta.ai changelog; npm tarball 1.4.14     | Kinds parse generically; payloads stripped; 1.4.13+ inside 7-day window | P2 (B2)                           |
| Muse CLI             | `muse usage` subscription allowance (1.4.13); `muse serve --preset` (1.4.12)                                 | dev.meta.ai changelog                         | Neither called nor offered                                              | P3 (B2)                           |
| ACP SDK              | 2.0.2 CRLF/CR stdio framing fix                                                                              | npm tarballs 2.0.1→2.0.2                      | Pinned 2.0.1 on SDK `ndJsonStream`; pin eligible 2026-10-31             | P2 (B1)                           |
| ACP                  | MCP-over-ACP binding (SDK 2.1, MCP 2026-07-28)                                                               | npm tarball 2.1.0                             | ACP-transport servers parsed, reported skipped                          | P2 (B3)                           |
| ACP                  | Agent Registry one-click listing (Zed + JetBrains)                                                           | jetbrains.com/help/ai-assistant/acp.html      | `authMethods` shape ready; not submitted                                | P2 (B4)                           |
| ACP                  | Experimental protocol v2; HTTP/WebSocket transport RFD                                                       | npm tarballs; ACP RFD via search              | v1 stdio, as every client launches today                                | P3 (watch)                        |
| MCP client           | Client registration: CIMD preferred, DCR deprecated (2026-07-28)                                             | modelcontextprotocol.io 2026-07-28 changelog  | Person-supplied `clientId` only; no registration                        | P2 (B5)                           |
| MCP                  | Tasks extension, Skills extension, MCP Apps (UI) extension                                                   | 2026-07-28 changelog; TS SDK 2.4.0 release    | None advertised (client or connector)                                   | P3 (B6 — take per named host)     |
| VS Code              | Agent Host Protocol 1.0 (sessions outliving the window)                                                      | code.visualstudio.com/updates/v1_144          | Own panel/backends only                                                 | P2 (B8 — design decision first)   |
| VS Code              | Engine floor 1.99 vs stable 1.144                                                                            | code.visualstudio.com/updates/v1_144; PLAN A8 | Floor deliberate (forks); no removed API used                           | none — recorded decision          |
| JetBrains host       | Platform 2026.3 module/classloader, JNA→FFM, LSP renames                                                     | plugins.jetbrains.com api-changes-list-2026   | Native plugin not yet built                                             | P3 (B9 — notes for the M104 lane) |
| Visual Studio host   | VS 2026 `VisualStudio.Extensibility` SDK is the modern route                                                 | Microsoft Learn / InfoWorld via search        | Row still names VSSDK                                                   | P3 (B9)                           |
| Xcode 27             | Native ACP agent connection                                                                                  | Apple WWDC 2026 announcement                  | M63 lists it; unqualified                                               | P2 (B10)                          |
| Sublime / Qt Creator | Community ACP clients exist                                                                                  | agentclientprotocol.com clients directory     | M63 lists both; unqualified                                             | P3 (B10)                          |
| Grok sign-in         | No official third-party OAuth registration                                                                   | docs.x.ai; third-party records via search     | RLGROKAUTH correctly waiting; API-key route current                     | none — outside API, owner's rule  |
