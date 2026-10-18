# Lane SESSIONDELETE — session-delete record

## Every place sessions are listed (2026-10-18, from the code)

1. **Panel History dialog** — `src/webview/components/HistoryDialog.tsx`
   renders the workspace's stored sessions (Today / Yesterday / Previous 7
   days / Older, search, Archive / Unarchive per row, Show Archived switch).
   Rows render in `src/webview/components/HistoryPromptRow.tsx`. Data comes
   from the host: `conversationController.listSessions()`
   (`src/host/conversation/conversationController.ts:4394`) calls
   `host.listSessions()` and answers the `listSessions` webview message
   (`protocol.ts:776`). Archive toggles go through `setArchivedIds`.
   The row components already accept an optional `onDelete(sessionId)` (a
   delete control plus Shift+Delete), but nothing in `src/` passes it, so no
   Delete button is rendered today.
2. **Session board dialog** — `src/webview/components/SessionBoardDialog.tsx`
   fed by `src/host/sessionBoard.ts:123` (`host.listSessions(...)`). A second
   panel list surface; Delete belongs here too if it lists stored sessions
   (to verify while implementing).
3. **ACP agent** — `src/acp/agent.ts`: `session/new`, `session/load`,
   `session/resume`, `session/list`, `session/close` are served
   (`listSessions` at `:2596`, wired at `:2708`). There is no
   `session/delete`: the editor can list and close (release) sessions but
   cannot remove one from the backend store. `closeSession` (`:2647`) only
   releases the held ACP session; it does not delete store data.
4. **CLI (`muse-spark-code-acp` / exec runtime)** — no session list/delete
   command exists: `src/runtime/cliArgs.ts` / `src/runtime/main.ts` serve
   `resources [status|history|resume]` (usage history) and per-run ledgers,
   not the conversation store. If the product "already lists sessions" on
   the CLI, it is via the ACP `session/list` above (the agent's own
   command surface); a headless list/delete entry point will be added only
   if one already lists sessions — to confirm during implementation.
5. **Backends**
   - Muse Code: `MuseCodeHost.listSessions` (`:2570`, `session/list` MSP
     command) and the orphaned `MuseCodeHost.deleteSession` (`:2491`,
     waits for the terminal `deleteCompleted` notification). Nothing calls it.
   - Model API: `ModelApiHost.listSessions` (`ModelApiHost.ts:17800`) over
     the product's own `SessionStore`
     (`src/core/backends/modelapi/sessionStore.ts:194`), which already has
     `remove(sessionId)`. Nothing calls `remove` from a user action.

## What Delete will do in each place

- **History (panel), both backends:** a Delete action per row with a
  confirmation that names the conversation (title/first prompt), then
  removes it from the backend's store — Muse Code through `deleteSession`,
  Model API through the session store's `remove` — and from the list
  (plus its archived-id entry). A failure keeps the row and reports its
  real cause.
- **ACP:** a delete request beside `session/close` that deletes from the
  backend store through the same backend path and releases any held copy.
- **CLI:** only if a session-listing command exists there; otherwise the
  ACP request plus the panel cover "every place sessions are listed".
- Strings in `src/shared/l10n/en.ts` plus every `l10n/ui.*.json` table;
  `npm run check:l10n` clean. Tests drive the real code against a real
  store in a temporary folder (no stand-ins). CHANGELOG `[Unreleased]` line.
