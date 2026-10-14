# muse-restart-model: a conversation keeps the chosen model across restarts

Lane RESTARTMODEL, branch `fix/muse-restart-model`, from main `898a26c5e`
(release 0.18.2). The lead measured on 2026-10-14 that after a
`muse serve` restart a conversation ran on `muse-wonder-1.0-contributor`
(the CLI's default) while the panel and the log said `muse-spark-1.3`.

## Cause (measured, file:line)

- `src/core/backends/musecode/MuseCodeHost.ts:2572-2589`
  (`resumeSession`): the `session/resume` command carries only
  `sessionId`, history preference and MCP config. The SDK's
  `SessionResumeParams`
  (`node_modules/@muse-code/sdk/dist/src/msp.d.ts:1683`) has no model
  field, and `turn/start` (`msp.d.ts:2516`) takes no model either, so a
  turn runs on whatever standing model the fresh `muse serve` holds.
- `src/core/backends/musecode/MuseCodeHost.ts:2312-2319` (`loaded`):
  the resumed handle is tracked with the caller's assumed `modelId`,
  ignoring the CLI's envelope.
- `src/host/conversation/conversationController.ts:4122-4127`
  (`resumeAfterRestart`, before this change): resumed with
  `this.modelId` but never called `session/setModel` and never read the
  CLI's active row back; `attach` then logged the assumed model
  (`Session … continued after a restart on the museCode backend, model …`).

So after any restart (setting change, crash, backend switch-back) the
conversation continued on the CLI's default while the panel showed the
choice. History resume had the same hole (adopt read the active row but
never applied the choice); the ACP agent forgot the choice entirely when
its session was released.

## Fix (commit `17432d304`)

- New pure module `src/core/backends/musecode/resumedModel.ts`:
  `resolveResumedModel({ wantedModelId, activeModelId })` returns
  `{ ok: true }` when the CLI reports the wanted model (or no active
  row: the `setModel` ack is trusted), `{ ok: false }` on a mismatch.
- Panel (`conversationController.ts`, `enforceResumedModel`): every
  resume applies the choice with `session/setModel` and reads it back
  with `model/list` (the `isActive` row) before the next turn is sent.
  Called in `resumeAfterRestart` (setting change, crash restart, backend
  switch-back) and in `adopt` for origin `'resumed'` (History). A
  mismatch disposes the handle, refuses the message with the new
  `UI_TEXT.modelNotKeptAfterRestart` text, and keeps the conversation as
  the resume target, so choosing the reported model and resending
  continues it. The panel header (`sessionInfo`) and the log line come
  from the reported model. Effort was already applied and awaited in
  `attach` (`applyEffort`); the `session/setReasoningEffort` ack is the
  durability confirmation (SDK tdd SS3.21) and lands before the turn.
- ACP (`src/acp/agent.ts`): `AgentState` remembers each session's
  `{ modelId, effort }` on `session/new`, `session/set_config_option`
  and `session/load`, and forgets it on `session/close`.
  `AcpSession.restoreChoice` re-applies the remembered choice on load
  (setModel, read back, applyEffort) and fails the load on a mismatch,
  so nothing runs on a model the editor was not told. Sessions with no
  remembered choice keep `matchAdvertised`.
- New sentence `modelNotKeptAfterRestart` in `src/shared/l10n/en.ts`
  and all 14 `l10n/ui.*.json`, each at the same position (after
  `sessionNotContinued`).

## Proof

- Red first: `test/unit/resumedModel.test.ts` failed before the module
  existed (`Cannot find module
'../../src/core/backends/musecode/resumedModel'`), then passed 3/3
  after. Pure logic through the real module, values passed in as data;
  no mocks, no fakes.
- Packed product: `npm run build` exit 0. The built `dist/acp.js` was
  driven over the editor protocol with the real CLI (`muse` 1.4.7)
  under a new empty HOME with a scratch driver (lane scratch, not
  committed). `initialize` answers on the museCode backend, but
  `session/new` is refused: `Authentication required: Muse Code is not
signed in; sign in and try again.` No signed-in CLI exists on this rig
  without credentials, which the lane may not touch, so the restart half
  of the drill is left for the lead (steps below). No prompt was sent at
  any point.
- Static gates on the final tree, each exit 0: `tsc -p tsconfig.json`,
  unit-project tsc, `eslint --max-warnings=0` on changed files,
  `prettier --check` on changed files, `npm run check:l10n`
  (`0 problems`), `npm run check:reference`, `npm run deadcode`,
  `npm run cycles`, `npm run duplication`, `npm run build`.
- Dependents (measured, not labelled): `vitest related` over the
  changed sources fails 27 tests in 3 files on this tree while the
  untouched base `898a26c5e` passes them all
  (`conversationController.test.ts` 688/688;
  `acpAgent.test.ts` + `acpQuestionDeferral.test.ts` 223/223). Every
  failure is a fake-wire suite (hand-written stand-in for the CLI over
  MSP) that cannot answer the new `session/setModel` + `model/list`
  round trip, e.g. `conversationController.test.ts >
ConversationController: session history (M6) > resumes a stored
session: history, model from the catalogue, composer state, title,
memory` stops after the first `modelList` post because the fake never
  serves history after the unscripted commands. Per the owner's testing
  rules these suites are named here and left untouched for the TESTCUT
  lane:
  - `test/unit/conversationController.test.ts` (21 failures, all in
    resume/history/rewind/tasks paths that resume a session)
  - `test/unit/acpAgent.test.ts` (4 failures, ACP session-ownership
    reload paths)
  - `test/unit/acpQuestionDeferral.test.ts` (2 failures, resumed-turn
    question paths)

## Open / for the lead

- The one real request: with a signed-in CLI, run the packed agent and
  the scratch driver shape (`initialize`, `session/new` with
  `mcpServers: []`, `session/set_config_option` model to
  `muse-spark-1.3`, kill the agent's own `muse serve`, `session/load`)
  and confirm the load's `configOptions` model `currentValue` is still
  `muse-spark-1.3` with no prompt sent; then send one real request and
  read the CLI session file's `"kind":"provider","model"` record.
- `npm run security:audit` exit 0 (`2 advisories, 1 exceptions`).
  `npm run security:sast` is not runnable on this rig: it prints
  `semgrep is not installed: pip install -r
.github/semgrep/requirements.txt` (and `npx semgrep` cannot fetch:
  EROFS on the npm cache).
