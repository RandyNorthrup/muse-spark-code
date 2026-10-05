# MHP 1.1.0 panel carrier

Authored contract for Muse Spark Code (Unofficial), lead decision 2026-10-05
(E01). Runtime delivery is lane B; companion HTTP/SSE is lane C; browser
bridges are lane D and the native-plugin lanes. This document and the JSON
Schemas define their contract; they do not claim those implementations ship.

## Compatibility and negotiation

`mhp-v1.schema.json` and its lock retain the frozen `mhp/1.0.0` contract.
`mhp-v1.1.schema.json` exports `mhp/1.1.0`, range
`[mhp/1.0.0, mhp/1.2.0)` (`mhp/1.0.0..1.1.x`). Every v1 method, call,
capability, error and non-initialize result is unchanged. The 1.1 initialize
result additionally accepts `protocolVersion: "mhp/1.1.0"`.

`selectMhpVersion` selects the newest implemented version in an explicit
minor-range offer bounded through `mhp/1.2.0`. Frozen v1 peers can advertise
`[mhp/1.0.0, mhp/2.0.0)`; that legacy wide offer conservatively selects
`mhp/1.0.0` and receives only v1 traffic. Existing v1 peers keep their old
range and validation unchanged. A carrier peer opts in with
`[mhp/1.0.0, mhp/1.2.0)` (or a narrower range containing 1.1.0). Panel
traffic starts only after initialization actually selects 1.1.0. Unknown
later revisions are never selected by inference. The original
`isMhpVersionSupported` and `parseMhpResult` remain frozen v1 boundaries.

## Envelope and admission

```json
{
  "mhp": "1.1",
  "kind": "panel",
  "surface": "opaque-id",
  "direction": "toHost",
  "seq": 1,
  "payload": { "type": "ready" }
}
```

`toHost` carries the panel's payload to the runtime's conversation host;
`toPanel` carries the runtime's payload through the editor/companion to the
browser. These names describe the shared panel boundary, independently of
which process physically forwards the frame. No JSON-RPC method is added.

`panel.envelope` is strict about envelope keys and discriminates direction.
It reuses `src/shared/protocol.ts` in both directions, `tasksProtocol.ts`
for Tasks, and `whatsNewMessages.ts` for What's New. Payload validation
retains those schemas' existing treatment of additional payload keys.
`parseMhpPanelEnvelope` additionally checks the registered surface's kind:
Tasks accepts only its read-only vocabulary; What's New accepts only its
existing page actions. What's New currently renders HTML and has no inbound
payload vocabulary. Usage and maker declare distinct kinds and use the main
shared protocol, as do the remaining kinds. This introduces no new maker,
usage or What's New message shapes.

An opaque surface id binds to exactly one nonempty conversation session id
and one kind: chat, tasks, whatsNew, usage, maker, models, traffic, settings,
walkthrough or diff. Multiple surfaces may bind the same session. A session
switch closes the old surface binding and opens a fresh opaque surface id;
an id is never reused during a transport's lifetime.

Sequence numbers are safe integers starting at 1, independent for each
surface and each direction. A receiver accepts only its next expected
sequence; duplicates and gaps produce `MHP_PANEL_OUT_OF_ORDER`. Advance only
after complete validation and admission. Invalid frames do not consume a
sequence or enter a delivery queue. Unknown or closed surfaces produce
`MHP_PANEL_UNKNOWN_SURFACE` and no delivery. A wrong receiving direction,
unready document, invalid shared payload or over-cap frame is also refused.
The exported `panel.error` envelope contains a technical code, surface and
sequence (null if the header could not be validated); it carries no raw
provider error or payload. It is terminal feedback, never itself acknowledged.

The UTF-8 serialization cap is `MHP_PANEL.maximumEnvelopeBytes` (16 MiB),
excluding the NDJSON line terminator. Count the original bytes before JSON
parsing or stripping unknown payload fields. `parseMhpStdioLine` enforces
that raw-line boundary; the pure panel admission guard also checks serialized
input. An exact-cap envelope is admitted; one byte over is refused. HTTP
readers and native bridge readers must enforce the same cap while reading,
then parse the envelope and check contextual admission before dispatch.

## Surface lifecycle

Lifecycle notifications have `mhp: "1.1"`, `kind: "surface"`, the full
binding (`surface`, `sessionId`, `surfaceKind`) and an `event`. They travel
host/editor-to-runtime, separately from the editor-service method table.

| Event    | Required additional fields | Effect                                                                              |
| -------- | -------------------------- | ----------------------------------------------------------------------------------- |
| opened   | none                       | Register a new immutable binding; document starts unready.                          |
| ready    | none                       | Browser listener is installed; drain admitted messages in order.                    |
| reloaded | stateRequest               | Keep binding and both sequence counters; suspend delivery until ready.              |
| hidden   | none                       | Keep the binding, state and sequence; a loaded document can still receive messages. |
| closed   | droppedMessages            | Unregister; discard both directions' queued messages and clear saved UI state.      |

`parseMhpSurfaceNotification` refuses duplicate opening, unknown bindings,
session/kind changes, and a reload request from another surface vocabulary.
The adapter serializes lifecycle operations with panel admission. Repeated
`ready`/`hidden` are idempotent. `closed` is terminal; unknown later lifecycle
traffic is refused. `droppedMessages` is a required safe nonnegative integer
count of admitted but undelivered messages in both directions. Completed transport writes are excluded from this queue-drop count and
do not prove the page rendered a message. A nonzero count requires a redacted technical warning `MHP_PANEL_DROPPED` with that
count through the host's logger, never the dropped payloads.

On `reloaded`, save one replay request. After the new page subscribes and
sends `ready`, dispatch that saved request once to the bound controller:
chat/maker and other main surfaces replay `{ "type": "ready" }` (including
an optional existing attachmentEpoch); Tasks replays `tasksReady`; usage
replays `readUsage`. What's New uses `stateRequest: null`, which requests a
fresh HTML render from its existing renderer. The replay is a lifecycle
operation, not a newly received panel envelope, and consumes no panel sequence.
Do not send a second page-level copy of that same reload request. A rejected
frame never starts a model call, grants permission or spends money.

## Embedded browser API

The native host installs `window.museHost` before page scripts run. Its
TypeScript contract is `MuseEmbeddedHost`; the export's `embeddedBridge`
contains the parameter/callback/state JSON Schemas.

| Member               | Contract                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| postMessage(payload) | `void`: validate for the bound surface, wrap as toHost, and enqueue within the local transport budget; throw on local refusal/backpressure. Remote admission errors use panelError frames. |
| onMessage(listener)  | Register a listener for validated toPanel payloads; return an unsubscribe function. Preserve delivery order and never expose another surface's payload.                                    |
| getState()           | Return saved JSON UI state for this surface, or undefined if absent.                                                                                                                       |
| setState(state)      | Validate JSON-only state and replace the surface's saved UI state; persist across reload, clear on close.                                                                                  |

The bridge owns the surface id and sequences; the page supplies only the
existing payload. Subscribe before ready. Listeners receive payload objects,
not envelopes or MessageEvents. Queued outbound frames retain their sequence
across reload. These APIs accept no credential-store operations: keys are
entered only through runtime `auth set`, never bridge state or carrier fields.

JCEF wraps `JBCefJSQuery`; its native handler validates the envelope before
forwarding to stdio, and invokes the registered JavaScript listener only with
validated payloads. WebView2 wraps `chrome.webview.postMessage`, validates at
`WebMessageReceived`, and unwraps validated native messages for listeners.
SWT wraps `BrowserFunction` and dispatches validated replies through the page's
listener registration. Remote refusals are validated panelError frames handled by the bridge/runtime
and logged as technical diagnostics; listeners receive only existing shared
payloads. Posting has no delivery acknowledgment or success result.
Native plugin pages keep the existing asset-only CSP/navigation restrictions.

The companion implements the same API with these HTTP/SSE mappings:

| Operation           | Mapping                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| postMessage         | `POST /panel/message`: one toHost envelope in the JSON body; 204 on admission, or 400/404/409/413/429 with `panel.error` for invalid/unknown/ordering-or-readiness/size/backpressure respectively. |
| lifecycle           | `POST /panel/surface`: one validated lifecycle notification; 204 on admission, otherwise the same technical error contract. The server accounts the actual close-drop count.                       |
| onMessage           | `GET /panel/events`: SSE `event: mhp`, one JSON toPanel or panelError frame in data. Validate and route by surface before invoking listeners.                                                      |
| getState / setState | Browser-local JSON state, keyed by opaque surface id, retained through document reload and removed on close; no new HTTP state endpoint.                                                           |

SSE id is `<encodeURIComponent(surface)>:<direction>:<seq>` for panel envelopes. Do not replay
already admitted envelopes on automatic EventSource reconnect. Disconnect
closes the surface and counts its pending queue drops; reconnection opens a
fresh opaque surface id bound to the same session and requests its state
after ready. This resets transport sequences without losing the conversation.
Never silently skip a sequence gap or reuse a closed surface id.
The server's launch-code, cookie, loopback, Host/Origin/Fetch-Metadata, custom
POST-header and CSP guards remain mandatory (lane C); this carrier confers no
authentication or authorization. SSE does not grant permissions. Its queue is
bounded by the same rules as stdio, and disconnect/close counts lost messages.

## Multiplexed stdio and backpressure

`panel --stdio` uses one UTF-8 NDJSON stream in each direction, one JSON
object per line, accepting LF or CRLF. Physical newlines inside strings are
JSON-escaped. No arrays, batches, blank lines or concatenated objects.
`framing` in the schema export names each validator: method-table call,
correlated result, existing failure, panel envelope, lifecycle or panelError.
`parseMhpStdioLine` is the stateless framing boundary; registry, request-id
correlation, negotiated direction and panel admission follow it in lane B.
Before negotiation, only initialization calls/results/failures are allowed. Stdout carries
protocol only; stderr carries redacted technical diagnostics.

Use one writer queue for service and panel traffic; writes never interleave
bytes. When write returns false, stop producing/writing, retain the already
accepted frame and resume on drain without resending it. Aggregate pending
messages are capped at 128 and UTF-8 bytes at 32 MiB (`MHP_PANEL` constants);
include queued service/lifecycle frames and writer-buffered bytes in those totals. Stop upstream reads
at the high-water mark; an attempted panel admission beyond either cap
refuses with `MHP_PANEL_BACKPRESSURE` before enqueue and sequence allocation.
Service requests pause producers or return the existing typed internal failure
before side effects; control frames also respect the bounds. Drain fairly
across surfaces while retaining each surface/direction's order. Closing a
surface purges its pending frames, reports their exact count, and never reports
an undelivered message as delivered. These rules are implementation requirements,
not a claim that this contract-only lane implements the queues.
