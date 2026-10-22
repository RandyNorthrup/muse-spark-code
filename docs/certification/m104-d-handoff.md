# M104D continuation — lane B handoff

For `m104/b2`, 2026-10-05. This is the browser-side contract and the remaining
carrier work; it does not claim a qualified editor or completed RPC integration.

## Assets and entry selection

- VS Code continues to load `dist/webview/main.js` + `main.css` for chat and
  Tasks, and `dist/webview/whatsNew.js` + `whatsNew.css` for What's New.
  Those graphs contain no portable bridge or React host-service fallback.
- Native/companion documents load **`dist/webview/portable/main.js`** as an
  ES module, with **`dist/webview/portable/main.css`**. It automatically mounts
  chat or Tasks according to `body[data-surface]`. What's New loads
  **`dist/webview/portable/whatsNew.js`** + **`whatsNew.css`** and wires the
  host-rendered markup. Its global page styles stay outside chat's stylesheet.
- The separate **`dist/webview/portable/bridge.js`** exports `selectBridge`
  and `selectWhatsNewBridge`. The returned `PanelBridge.loadFallbacks()`
  imports **`dist/webview/portable/fallbacks.js`**. The fallback module exports
  `createFallbackUi`, `SettingsPage`, `Walkthrough`, `DiffPage`,
  `TerminalOutput` and `ManagerPage`. Load **`fallbacks.css`** when the fallback
  module is used by a document that did not load `main.css`.
- Preserve every emitted relative import under
  **`dist/webview/portable/chunks/*.js`**, including static shared chunks.
  `dist/meta/portable.json` is the exact asset manifest for the production
  build; all its emitted CSS and JS belong to this artifact. Do not mix its
  chunks with `dist/webview/chunks`, whose graph belongs to VS Code.
  The VSIX's existing explicit allowlist excludes the portable directory.
  Package/deliver the portable assets with the native/companion carrier.

## Bridge contract and existing panel messages

`selectBridge(codec, onError)` selects `window.museHost` first, then
`body[data-bridge="companion"]`, otherwise the VS Code API (also used by the
portable browser fixtures). Its `PanelBridge` has `post`, `messages`,
`savedState`, `saveState`, `loadFallbacks` and `dispose`. `PanelCodec.outgoing`
and `.incoming` parse the selected surface's existing shared payloads.

The native `window.museHost` remains the frozen `MuseEmbeddedHost` in
`src/shared/hostApi/panel.ts`: `postMessage(payload)`,
`onMessage(listener): unsubscribe`, `getState()` and `setState(json)`.
No `ui/*` request or response is added to that panel payload union here.

Companion pages embed a validated `#muse-panel` JSON binding
`{ surface, sessionId, surfaceKind }`. `selectBridge` uses the page's
**already authenticated `window.fetch` closure**. `companionBridge` opens
`POST /panel/events` with `{}` and sends ordered `POST /panel/message`, both with
`Content-Type: application/json`, `X-Muse-Panel: 1`, `credentials: omit` and
an abort signal. The integration posts opened then ready to `/panel/surface`. Both use the frozen `mhp: "1.1"` surface lifecycle
vocabulary; application posts are frozen panel envelopes with
`direction: "toHost"`, surface, increasing `seq` and payload. SSE `data:`
frames deliver `toPanel` envelopes or the existing lifecycle/error frames.
Each direction's application sequence begins at 1. Existing envelope and
queue limits, schemas, surface binding and disposal rules remain in force.

| Surface    | Existing outgoing vocabulary                                         | Incoming vocabulary                       |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------- |
| Chat       | `webviewToHostMessageSchema`, including `ready` and `hostAction`     | `hostToWebviewMessageSchema`              |
| Tasks      | `tasksReady`, `moveTasksToWindow`                                    | `tasksState` via `tasksHostMessageSchema` |
| What's New | `openLink { index }`, `tryIt { index }`, `hideOnUpdate { isHidden }` | none                                      |

State is JSON only. Companion snapshots are session storage keyed by surface;
no bearer is stored there. Pagehide disposes the bridge and saves chat state.

## Native fallback RPC routing still belongs to lane B

MHP v1 editor-service calls stay separate from the frozen panel payloads.
Route an unavailable native UI service to the browser's
`createFallbackUi(element, onCommand).request(method, params, signal)`, then
return its result through the existing MHP request ID/result channel.
Parse incoming params and outgoing results with `MHP_METHODS[method]` and
`parseMhpResult`; preserve numeric versus string opaque IDs and cancellation.
The adapter validates params, queues modal prompts, restores focus, makes the
surrounding document inert and rejects pending prompts on disposal.

| Method        | Existing params                                      | Browser result             |
| ------------- | ---------------------------------------------------- | -------------------------- |
| `ui/confirm`  | `title`, `message`, `choices`                        | chosen opaque ID or `null` |
| `ui/pick`     | `title`, `items`, `multiple`                         | opaque ID array or `null`  |
| `ui/input`    | `title`, `prompt`, optional `value`                  | string or `null`           |
| `ui/notify`   | `severity`, `message`                                | `null`                     |
| `ui/status`   | `id`, `text`, `visible`, optional `command`          | `null`                     |
| `ui/progress` | `id`, `title`, optional `message`/`fraction`, `done` | `null`                     |

`onCommand(id)` is an injected real command callback, not a new panel message.
`ui/openExternal` and `ui/clipboard` are not implemented by this adapter.
Settings use supplied `HostServices.request('settings/update',
{ key, value, scope })`. Walkthrough actions post existing chat host actions.
DiffPage calls `onDecide(hunkId, decision)`; the carrier binds the current
`reviewId` and emits `diff/didDecide { reviewId, hunkId, decision }`.
TerminalOutput calls the supplied `onStop`. ManagerPage receives real records
and `run(): Promise<void>` actions. They retain the host's confirmations,
credential handling, trust and paid consent. There are no production fake
records, command implementations, remembered grants or consent bypasses.

## Authenticated companion module delivery still belongs to lane B

The initial page fetch closure can attach its memory bearer. Browser static
and dynamic module requests cannot attach that header by themselves. The
carrier must load the complete portable import graph through an authenticated
module loader compatible with the existing nonce CSP, and preserve relative
imports and stylesheet delivery. Keep the exact asset allowlist and existing
Host/Origin/Fetch-Metadata/bearer checks. Do not make assets public, put a
bearer in a URL or storage, enable CORS, or loosen the CSP to make imports work.
This lane supplies no new loader or runtime endpoint. Browser fixtures are
local fakes; their normal module delivery is not an authenticated receipt.

M104INT routes the companion UI RPC separately at `/host/events` and
`/host/message`, ships the generated module manifest and nonce loader, and
uses the original six method/result schemas. Native stdio uses its existing
MHP HostServices. See [the integration record](m104-int.md) for receipts and
native bootstrap/auxiliary-view blockers; the frozen panel union is unchanged.
