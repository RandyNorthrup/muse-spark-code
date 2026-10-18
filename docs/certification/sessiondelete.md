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

## What the probes found (2026-10-18, this lane, zero model attempts)

- The rig has Muse Code CLI 1.4.10 (`muse --version`; npm shows
  `@muse-code/sdk` up to 1.4.10 while the repo pins 1.4.4 — bleeding-edge
  gap reported separately below).
- Live probe (`temp/probe-delete.mjs`, scratch, not committed): `muse serve`
  handshake as `serverInfo.version 1.4.10`, then `session/delete` with a
  bogus id answers `-32601 method not found, data.kind methodNotFound`.
- The CLI's own schema export (`muse schema generate-json-schema`, scratch
  output in `temp/schema-out/`, not committed) lists 26 `session/*`
  methods and no `session/delete` or `session/deleteCompleted`.
- Conclusion: no supported interface on the Muse Code backend can remove a
  stored session tonight. PLAN.md D26 ("must not be wired for 1.4.4
  hosts") holds for every CLI from 1.4.4 through current 1.4.10. The Delete
  port (`MuseCodeHost.deleteSession`) stays callable but gated: it is never
  sent to a host that cannot answer it.

## What was built

- `AgentHost.deleteSession(sessionId)` (`src/core/agent/agentBackend.ts`)
  plus `HostInfo.canDeleteSessions`: Model API always true; Muse Code from
  `canDeleteMuseSession` (new in `MuseCodeHost.ts`, version between 1.4.0
  and 1.4.4 with build labels stripped, and the lifecycle reader injected —
  false everywhere tonight since no reader is injected).
- `ModelApiHost.deleteSession`: drains in-flight saves, removes the session
  through the product's own `SessionStore` (file, questions, uploads), drops
  cached headers/snapshots/save state, and records the id so no later save
  resurrects it (`persist`, the save writer and `listSessions` all honor
  the record).
- `MuseCodeHost.deleteSession` now resolves `void` (the terminal still
  reaches lifecycle listeners) and its reader-missing error names the real
  cause (`sessionDeleteUnsupported` with the CLI version) instead of `Delete`.
- Panel History: `deleteSession` webview message, controller handler with
  capability check, confirmation naming the conversation
  (`confirmFileAction`), backend delete, archived-id/question-count/
  checkpoint cleanup, new conversation when the open one was deleted,
  re-list proving the row is gone, named success notice, real-cause failure
  notice. The row offers Delete only when the `sessionList` message says so
  (`canDeleteSessions: false` hides it — the rename/fork-on-Windows pattern).
- ACP `session/delete` served on both backends through the same port, with
  per-host refusal naming the real cause; advertised in `sessionCapabilities`
  only on the Model API backend (the only one that can honor it tonight).
  `sessionTap` forwards the port.
- Strings: `historyDeleteConfirm{,Detail}`, `historyDeleted`,
  `historyDeleteFailed`, `sessionDeleteUnsupported` in `en.ts` and all 14
  `l10n/ui.*.json` tables, in key order. `docs/acp.md` and the generated
  reference updated (`session/delete` appears in the ACP method list).
- Out of scope, deliberately: the session board (mixes live/window rows, not
  a stored-session list) and a CLI-native `muse sessions delete` (no such
  command exists upstream). The `@muse-code/sdk` 1.4.4 → 1.4.10 pin gap is
  reported, not taken: a dependency upgrade needs its own PLAN record and
  re-verification.

## Proof

- `test/unit/sessionDelete.test.ts` (kept): the real `createFileSessionStore`
  in a `mkdtemp` folder — save lists the session, `remove` deletes its file
  and its row, `load` goes undefined, removing an unknown id resolves; plus
  the `canDeleteMuseSession` table (1.4.0–1.4.3 open with a reader, 1.4.4 /
  1.4.10 / build labels / unknown versions / missing reader refused).
- Fire proofs: with `remove` sabotaged to skip one id, the store test fails
  (1 failed, 2 passed) and passes again on the revert; a throwaway test
  asserting 1.4.4 allows delete fails and was removed.
- Gates on the final tree: `tsc` host/webview/unit clean; eslint zero on all
  changed files; prettier clean; `check:l10n` 0 problems; `check:reference`
  current (regenerated); `check:plan` 0 drift; `check:host-api` 0 problems;
  `check:roadmap` current; `cycles` none; `knip` exit 0; `jscpd` 0 clones;
  `npm run build` green with budgets held; `security:audit` exit 0
  (2 advisories, 1 exceptioned); `security:sast` 533 rules on 3265 files,
  0 findings.
- Suites: sessionDelete (3), sessionStore (21), sessions (12), sessionBoard
  (7), sessionRecords (11), sessionTransfer (25), byoProtocol,
  questionContracts, snapshot (38), questionUiState, paidMoneyStructure,
  mediaContracts (73) — all pass on the repo's own timeout.
- Not run for real (no provider key, no display on this rig): the panel
  click-through and an ACP `session/delete` round trip. The controller and
  ACP paths are reviewed against the shipped archive/close flows they mirror
  and covered by every gate above; the store behavior they call is proven by
  the kept test.
