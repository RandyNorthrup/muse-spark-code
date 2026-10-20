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
  plus `HostInfo.canDeleteSessions` (optional): Model API always true; a
  Muse Code host omits it. The offer gate `canDeleteMuseSession` lives in
  `src/core/backends/musecode/museDeleteGate.ts`, outside the activation
  graph so the activation budget holds (version between 1.4.0 and 1.4.4 with
  build labels stripped, and the lifecycle reader injected — false
  everywhere tonight since no reader is injected, PLAN.md D26).
- `ModelApiHost.deleteSession`: marks the id deleted first, drains
  in-flight saves, removes the session through the product's own
  `SessionStore` (file, questions, uploads), drops cached
  headers/snapshots/save state, then stops the live session (`disposeAll`)
  so its turn cannot keep spending. No later save resurrects it: `persist`,
  `persistSpend`, `persistBudgetReservation` (a settling refund), and
  `persistTeamCommands` are no-ops that never reject for a deleted id, and
  `queueSave` plus the save writer (`runSessionSaves`) refuse to write one —
  a save queued after the mark resolves without touching the store, and a
  save still waiting when the mark lands is dropped with its waiters
  resolved. `revive` refuses a deleted id, so the session can no longer be
  resumed or forked; `listSessions` hides it. A removal failure unmarks the
  id and rethrows, so the delete reports its real cause.
- `MuseCodeHost.deleteSession` resolves `void` (no caller uses the
  terminal return; the terminal still reaches lifecycle listeners) and keeps
  the shipped reader-missing refusal, so the activation bundle holds the
  line. The panel and ACP layers refuse first with `sessionDeleteUnsupported`
  and the CLI version, naming the real cause where the person sees it.
- Panel History: `deleteSession` webview message, controller handler with
  capability check, confirmation naming the conversation
  (`confirmFileAction`), backend delete, then — only once the backend
  confirms the removal — row and question-count drop, archived-id update
  (`cleanupFailed` says an archived-ids failure with its real cause instead
  of the delete's), checkpoint forget, new conversation when the open one
  was deleted, one named success notice, and a re-list proving the row is
  gone. The checkpoint forget cannot fail outward (a removal it cannot do
  warns to the log itself) and neither can the re-list (it says
  `historyUnavailable` with the real cause itself). A failure of the backend
  delete itself names its real cause and keeps the row. An epoch change
  after a successful removal still drops the row and still says the success
  notice, without touching the newer generation's session. The row offers
  Delete only when the `sessionList` message says so
  (`canDeleteSessions: false` hides it — the rename/fork-on-Windows pattern).
- ACP `session/delete` served on both backends through the same port, with
  per-host refusal naming the real cause; advertised in `sessionCapabilities`
  only on the Model API backend (the only one that can honor it tonight).
  `sessionTap` forwards the port.
- Strings: `historyDeleteConfirm{,Detail}`, `historyDeleted`,
  `historyDeleteFailed`, `historyDeleteCleanupFailed` (a cleanup failure
  after a confirmed delete, naming the conversation and the real cause),
  `sessionDeleteUnsupported` in `en.ts` and all 14 `l10n/ui.*.json` tables,
  in key order. `docs/acp.md` and the generated reference updated
  (`session/delete` appears in the ACP method list).
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
- Red/green for the review fix (2026-10-18, this lane, on this rig).
  `ModelApiHost.deleteSession keeps a deleted conversation deleted` drives
  the real host (production `ModelApiHost`, `ModelApiClient` constructed but
  never called — no turn runs, so any provider use would fail loudly through
  its missing key; production `fileContextIo`, `createToolIo`,
  `createFileSessionStore` in a `mkdtemp` folder) with a real in-flight save
  (a rename queued, the delete landing before it must have finished; an
  `awaitSaved` helper proves the file exists before the delete, so the
  file-gone assertions cannot pass vacuously). On the pre-fix tree it fails
  — `resumeSession` on the deleted id resolves with a live loaded session
  instead of rejecting — and after the fix it passes on the repo's own
  timeout. It pins: the in-flight save drains and the file is removed,
  `listSessions` hides the id, resume and fork of the deleted id refuse,
  touching the stopped handle writes nothing back, and deleting again
  resolves. The test account is the real SHA-256 digest of its name (the
  spend ledger only serves 64-hex key digests) and the model is the real
  `DEFAULT_MODEL_ID` (an unpriced id fails the ledger closed and no save
  would ever land — found while the first version of this test stayed red).
  `ConversationController.deleteSession tells one true story` drives the
  real controller through the same `handle` entry the webview uses, against
  the same real host and store: answering the confirm dialog is the test
  operator's part, capturing posted messages its observation; everything the
  delete touches is production code, and collaborators the path never
  reaches fail closed instead of pretending. It pins success-once (exactly
  one `Deleted` notice and the re-listed History loses the row), the decline
  (no delete, no notice), the archived-ids cleanup failure (the file is gone
  and the panel says `Deleted` with the real cause, never the delete's
  failure text), and the stale epoch (hosts stopping mid-delete through the
  real `backendStopping`: the row drops and `Deleted` is still said once,
  without touching the new generation). On the pre-fix tree (a worktree at
  the reviewed commit with only this test file added) the host test and the
  cleanup and epoch tests fail — the live session revives, the lone notice
  is the `Could not delete` lie, the stale delete says nothing — and after
  the fix all 8 pass on the repo's own timeout. The post-delete refund /
  team no-op guards are unreachable without a provider turn, so no committed
  test drives them: they are covered by code review against the turn-end
  paths (`endRequest` → `onPersisted('refund')`, `TeamCommandRegistry` →
  `onPersisted('team')`) and by every gate below. The panel click-through
  stays listed below as not run.
- Gates on the final tree: `tsc` host/webview/unit clean; eslint zero on all
  changed files; prettier clean; `check:l10n` 0 problems; `check:reference`
  current (regenerated); `check:plan` 0 drift; `check:host-api` 0 problems;
  `check:roadmap` current; `cycles` none; `knip` exit 0; `jscpd` 0 clones;
  `npm run build` green with budgets held; `security:audit` exit 0
  (2 advisories, 1 exceptioned); `security:sast` 533 rules on 3265 files,
  0 findings.
- Suites: sessionDelete (8), sessionStore (21), sessions (12), sessionBoard
  (7), sessionRecords (11), sessionTransfer (25), byoProtocol,
  questionContracts, snapshot (38), questionUiState, paidMoneyStructure,
  mediaContracts (73) — all pass on the repo's own timeout.
- Not run for real (no provider key, no display on this rig): the panel
  click-through and an ACP `session/delete` round trip. The controller and
  ACP paths are reviewed against the shipped archive/close flows they mirror
  and covered by every gate above; the store behavior they call is proven by
  the kept test.

## PR250FIX2 (2026-10-19, this lane, macbook rig)

Hosted CI ran every unit shard on Linux, Windows and macOS: the only red
was the lane K activation budget, and Grok's re-review (GRV250C) found two
more defects. All three are fixed at their cause below; behaviour is
unchanged everywhere a person can reach.

- GRV250C-1, a turn that ends after delete puts the row back in History:
  `ModelApiHost.announce` now returns when the id is in `deletedSessionIds`,
  so a late touch (a turn settling after the removal, same as a rename on
  the stopped handle) persists nothing and publishes nothing. The kept test
  `a touch that lands after the delete does not put the row back` drives the
  real controller, host and store through the panel's `handle` entry, deletes,
  renames on the stopped handle (the same onChanged persist-and-announce
  path a turn exit takes — no provider turn can run on this rig, and a
  hand-answered one would be a fake), and asserts no list event is heard and
  the last posted `sessionList` omits the id. On the pre-fix tree it fails
  with `expected [ { type: 'changed', …(1) } ] to deeply equal []`; after the
  fix it passes on the repo's own timeout.
- GRV250C-2, an epoch change during delete leaves the row on screen: the
  stale delete path now posts the session list after dropping the row (it
  still skips `clear()`, so the newer generation's open conversation stays).
  The kept test `a new conversation mid-delete still drops the row from the
posted list` parks the delete at its confirm dialog, starts a new
  conversation through the real `clearConversation` entry (a real epoch
  invalidator that posts no list of its own, unlike `backendStopping`), then
  confirms, and asserts the file is gone, `Deleted` is said once, and the
  last posted `sessionList` omits the id. On the pre-fix tree it fails with
  `expected 1 to be greater than 1` (no second list is posted); after the
  fix it passes on the repo's own timeout. The `backendStopping` epoch test
  stays as the hosts-restart variant.
- Activation budget: `modelsActivationBudget` failed with growth 3116 over
  the 3072 budget. Measured on `main` (a worktree at the fork point, same
  test): baseline 561352, main 564253, growth 2901 — main holds 171 bytes of
  headroom, and this branch added 215 bytes on the activation path, all of
  it in `MuseCodeHost.ts` (the delete offer gate in the sync constructor;
  the controller, Model API host, protocol, webview and ACP changes all
  live outside `dist/extension.js`). A dynamic import cannot serve a sync
  constructor, so the offer moved instead of the code: `HostInfo`
  gains `canDeleteSessions?` (absent on Muse Code), the gate moved to
  `src/core/backends/musecode/museDeleteGate.ts` (no activation-graph
  module may import it; the kept `canDeleteMuseSession` table pins it), and
  `MuseCodeHost.deleteSession` keeps its shipped refusal and void resolve.
  After: baseline 561352, current 564232, growth 2880 — 21 bytes under
  main's figure, 192 bytes of headroom left for the release's remaining
  pull requests. Behaviour is identical everywhere it runs tonight: the
  offer was already false on every Muse Code host (no lifecycle reader is
  injected anywhere in production), and the panel/ACP refusals still name
  `sessionDeleteUnsupported` with the CLI version.
- Gates on the final tree: `tsc` host/webview/unit/e2e/integration clean;
  eslint zero on all changed files; prettier clean; `check:l10n` 0 problems;
  `check:reference` current; `check:host-api` 0 problems; `check:plan`
  0 drift; `cycles` none; `knip` exit 0; `jscpd` exit 0; `npm run build`
  green with budgets held.
- Suites: sessionDelete (10), modelsActivationBudget (1), plus
  `vitest related` over the changed sources (sessionDelete, agentErrors;
  the live e2e drills skip without a key) — all pass on the repo's own
  timeout.
- Not run for real (same rig limits): the panel click-through, an ACP
  `session/delete` round trip, and a mid-flight provider turn deleted from
  History (needs a live model call).
