# ACPGAPS — stabilized editor-protocol gaps, closed on SDK 1.7.0

2026-10-12, Linux rig `linuxlt`, worktree `/home/randy/lanes/ACPGAPS`,
branch `feat/acp-stable-methods` from `main e763f4938` (release 0.18.1).
No model call and no request to any model provider was made from this
lane. Every fact below that rests on provider or protocol documentation
is marked UNVERIFIED until a real editor confirms it; the exact requests
the lead must send are in
[`ACPGAPS-capture-plan.json`](ACPGAPS-capture-plan.json) (12 requests).

SDK source cited throughout:
`node_modules/@agentclientprotocol/sdk/dist/` (pinned 1.7.0).
Protocol pages re-read 2026-10-12: `protocol/v1/session-delete`,
`protocol/v1/authentication`, `protocol/v1/cancellation`,
`protocol/v1/session-config-options`, `protocol/v1/session-modes`.
The scan (`~/lanes/_ctx/gaps/acp.json`) was right about our code in all
nine cases: no handler, option, field or call existed where it said none
did.

## ACP-G02 — session/delete (done)

Built: `AgentState.deleteSession` (`src/acp/agent.ts`) stops a held
session, then calls the new optional `AgentHost.deleteSession`
(`src/core/agent/agentBackend.ts`). Muse Code's existing delete verb
satisfies it; Model API gained one (`ModelApiHost.deleteSession`: let go
of a live session, drop the maps, await in-flight saves, forced file
remove, `closed` event). Unknown ids succeed silently; a backend report
that the session survived (`outcome: 'failed'`) fails instead.
Advertised as `sessionCapabilities.delete: {}` on both backends.
Docs: schema `DeleteSessionRequest`/`SessionDeleteCapabilities`
(`schema/types.gen.d.ts:5266`, `:1634`) and the session-delete page.

UNVERIFIED: what the Muse Code CLI reports for an unknown id
(completed vs failed); whether Zed shows deletion once advertised.

Person's steps: in Zed, list sessions, delete one, list again — it is
gone; delete it again — success, nothing changes.

Parity: the panel has no session delete (follow-up).

## ACP-G03 — logout (done)

Built: `logout` request ends every held session and calls the new
`signOut` dep, wired in `serve` only for the Model API backend to the
same store entry `auth clear` deletes (`src/runtime/main.ts`). The CLI's
sign-in stays the user's to end. Advertised as `auth.logout: {}`.
Docs: schema `AgentAuthCapabilities` (`:1806`) and the authentication
page (logout flow diagram).

UNVERIFIED: Zed's sign-out affordance once advertised; post-logout
authenticate/prompt behavior in Zed.

Person's steps: sign out in the editor — sessions stop; on the Model API
backend `auth status` reports no key and the next turn asks to sign in
again; on Muse Code, `muse logout` still ends the CLI sign-in itself.

Parity: the terminal agent has no logout/delete surface (follow-up).

## ACP-G04 — $/cancel_request, both sides (done)

Built, agent side: the SDK's JSON-RPC layer already aborts an incoming
request's `context.signal` on `$/cancel_request`
(`dist/jsonrpc.js: handleProtocolNotification`, params `{requestId}`,
verified in `dist/acp.test.js:691`); the `session/prompt` handler now
listens to that signal, cancels the turn exactly like `session/cancel`,
and answers `stopReason: 'cancelled'`. Every outbound client request
(permission, elicitation, recovery confirm, paid use; vault and usage
forms already had theirs) carries the turn's stop, so a cancel sends
`$/cancel_request` for each waiting editor request — the cascade in the
cancellation page's diagram. Built, team side: the worker bridge aborts
its in-flight `session/prompt` (SDK sends the notification) beside the
`session/cancel` notify (`src/host/team/acpProcess.ts`).
Docs: the cancellation page, read in full 2026-10-12.

UNVERIFIED: that Zed ever sends `$/cancel_request` (it may only send
`session/cancel`); the exact id type it sends; every editor answering
ours with `-32800`.

Person's steps: start a long turn, cancel it from the editor — the turn
ends `cancelled`; with a permission prompt open, cancel — the prompt is
withdrawn, nothing runs by default.

## ACP-G05 — mode selector (done)

Built: the permission modes are also a `category: 'mode'` select option
(`ACP_CONFIG_IDS.mode`), set through `session/set_config_option` down
the same path as `session/set_mode`, and every mode change sends
`current_mode_update`. Legacy `modes`/`set_mode` stay.
Docs: the session-config-options page ("SHOULD use them instead of
`modes`… removed in a future version") and the session-modes page
(agent-driven `current_mode_update`).

UNVERIFIED: that Zed renders the `mode` selector and stops calling
`set_mode`; the team bridge already consumes both (it prefers the
selector and applies `current_mode_update`).

Person's steps: change mode in the editor's settings selector — the turn
behavior changes and the legacy mode control shows the same mode.

Parity: the panel already has the modes; nothing vscode-only was added.

## ACP-G06 — boolean option (done)

Built: paid "Allow always" is a `type: 'boolean'` option, on when the
session may offer it, off when paid uses must offer only Allow once and
Deny (no grant is then stored from the session). It is included only
when the client advertises `session.configOptions.boolean`, and
`set_config_option` takes a real boolean for it and still demands
strings elsewhere.
Docs: the session-config-options page ("`boolean` is only supported when
the Client advertises…", "MUST NOT include" otherwise) and
`SessionConfigOptionsCapabilities` (`schema/types.gen.d.ts:4617`).

UNVERIFIED: how Zed renders the toggle and the exact boolean value shape
it sends.

Person's steps: with a client that renders booleans, switch the option
off, trigger a paid use — only Allow once and Deny are offered.

Parity: the panel has no per-session refusal (follow-up).

## ACP-G09 — additionalDirectories (done)

Built: new/load/resume accept absolute `additionalDirectories`
(non-absolute refused as bad requests), remember them per session, and
`session/list` reports them on the sessions this agent opened. Tools
keep running in the session folder: backends have no multi-root scope,
so this is accept, retain and report, said plainly.
Docs: `New/Load/ResumeSessionRequest.additionalDirectories` and
`SessionInfo.additionalDirectories` (`schema/types.gen.d.ts:5024`,
`:5222`, `:5355`, `:2771`).

UNVERIFIED: whether Zed sends the field and gates on the capability;
cwd-mismatch behavior against a real editor.

Person's steps: open a session with a second root — it opens; list
sessions — the roots are reported.

## ACP-G10 — messageId on chunks (done)

Built: every streamed chunk carries its item's id (`src/acp/translate.ts`;
translator comment names the rule), so deltas of one message group and a
new item starts a new message. One-shot notices (`backendNotice`, the
agent's remaining direct sends) still go out ungrouped — follow-up.
Docs: `ContentChunk.messageId` (`schema/types.gen.d.ts:3399`).

UNVERIFIED: Zed's grouping with real ids (the team bridge already groups
by it and improves: previously every chunk folded into one message).

Person's steps: watch a turn stream — separate assistant messages stay
separate instead of folding into one block.

## ACP-G11 — programmatic tool names (done)

Built: `tool_call` carries `name` (the backend tool, `shell` for `!`
commands), permission requests carry it too, paid uses carry the feature
id, vault carries `vault` (`src/acp/translate.ts`, `src/acp/agent.ts`).
Docs: `ToolCall.name` and `ToolCallUpdate.name`
(`schema/types.gen.d.ts`, tool-calls page).

UNVERIFIED: how Zed renders `name` beside `title`; null/omitted
behavior needs no verification (we always send one).

Person's steps: run a turn with tool calls — rows show the same titles;
an editor that icons by name can now do so.

## ACP-G12 — client terminal/* and fs/* (NOT started; design note)

The agent makes no `terminal/*` or `fs/*` call, and no turn needs one:
every file and command goes through the backends' own tools today.
Inventing a call site would be guessing at product behavior, so none was
added and no capability is claimed that is not used. Decision points for
the lane that needs it: which turn (and which approval result) may run a
command in the client's terminal instead of the backend sandbox; whose
approval gates an `fs/write_text_file` into an unsaved editor buffer;
how the capability is withdrawn mid-turn; and what the panel and the
terminal agent get at the same time (owner: all editors equal). Note:
the team bridge already advertises `fs` read/write as a client; whether
foreign agents may call them on it is untested (capture plan G12b).

## Live probe of the built product (no provider, no model call)

`node dist/acp.js` on stdio, driven by the pinned SDK's own
`ClientSideConnection` (probe script kept outside the repo: it is a
manual run, not a test). Observed 2026-10-12 on `linuxlt`:

- `initialize` answers, on both backends,
  `sessionCapabilities: {list, delete, additionalDirectories, resume,
close}` and `auth: {logout}` — the advertised surface is real.
- `logout` with nothing held answers `{}` on the Muse Code backend.
- `session/delete` of an unknown id could NOT be exercised here: on
  the Muse Code backend the CLI host does not start in this sandbox
  (Internal error), on Model API there is no Secret Service
  (`store-unavailable`). Both are measured environment blocks, not
  code verdicts; the silent-success claim stays UNVERIFIED for the
  capture run, as do the CLI's unknown-id report and Zed's affordances.

## Static proof and tests

- `npx tsc --noEmit -p tsconfig.json`: clean.
- New `test/unit/acpStableMethods.test.ts`: 7 tests, whole bodies,
  through the real modules — pass. (An 8th, the tool `name` body, was
  removed as an exact duplicate of the translate test's; G11 coverage
  lives there.)
- `test/unit/acpTranslate.test.ts`: 44 pass (4 expectations extended
  additively with the new documented fields, nothing else touched).
- `test/unit/teamAcpProcess.test.ts`, `acpAccounts`, `acpPaid`: 110 pass.
- `test/unit/acpAgent.test.ts`: 143 pass. Three expectations predated
  the documented `messageId` field and were updated to assert it (the
  turn-stream chunks carry their item id, the replayed history chunks
  carry theirs, the one-shot notice asserts a string id) — the old
  bodies were wrong, not the new code.
