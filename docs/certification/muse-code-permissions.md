# Certification — Muse Code backend permissions (muse-code-permissions)

Lane MUSEPERMS, 2026-10-14, worktree branch `fix/muse-code-permissions`.
Lead's measurement (published 0.18.2, CLI 1.4.7, editor client answering
every `session/request_permission`): F13 — four sessions, 0 client permission
requests while commands ran (one session: 31 `execute` tool calls completed);
F16 — one command asked 13 times (13 `pending`, 28 `in_progress` against 14
`completed`); `acceptEdits` set, later updates still `currentModeId: manual`.

## Causes, with file and line

F13 (no request reaches the client) is the CLI raising no approval, not the
agent dropping one. Every shell approval the CLI sends is forwarded:

- `src/core/backends/musecode/mapNotification.ts:344` maps
  `approval/requested` to `approvalRequested`; the `approval/request`
  server-request mirror is delivered as the same notification
  (`src/core/backends/musecode/MuseCodeHost.ts:2139`, `2140`).
- The ledger admits a first-seen approval once
  (`src/core/backends/musecode/promptLedger.ts:42`).
- The ACP agent asks the client for every shell approval it sees:
  `src/acp/agent.ts` `approvalRequested` case stores and calls
  `askPermission`. The only no-ask path is `editAutomaticallyChoice`
  (`src/core/agent/approvalRules.ts:136`), which answers file writes only,
  in `acceptEdits` only. A shell subject can never take it.
- The wire mode sticks (live, no-turn probe, CLI 1.4.7,
  `muse serve --trust-workspace`, empty config home, empty workspace, no
  prompt sent): `session/start` with `approvalMode: promptUnmatched`
  returns `approvalMode: {mode: promptUnmatched, source: startup}` plus
  `session/approvalModeChanged {mode: promptUnmatched,
source: approvalReconfigure}`; `session/setApprovalMode` returns
  `{applyOutcome: noop, effectiveMode: {mode: promptUnmatched,
source: startup}}`. Mode clamping is ruled out.
- So under `promptUnmatched` the CLI itself classified F13's 31 commands as
  needing no approval (its own rules: workspace rules/skills loaded through
  `--trust-workspace`, managed policy, permission profiles, built-in
  classification). That decision is CLI-internal: no code path of ours sees
  it. One live request settles which rule fired: send one command turn in
  Manual on the lead's host and watch the `approval/requested` frames and
  the workspace's permission sources (`settings.json`, `.muse/hooks.json`,
  `muse config status`).

F16 (one command asked 13 times) is ours, three paths in `src/acp/agent.ts`
(old `askPermission`):

- `approvalUpdated` called `askPermission` anew, so every stage of a staged
  command (`a; b` is two stages, `src/shared/agentEvents.ts:274`) opened a
  fresh client request.
- No serialization: an update landing while a request was unanswered opened
  a second concurrent request for the same approval.
- The answer was discarded when the stage advanced mid-ask (old stale check
  after the client answered), so the client answered and nothing was
  decided, and the next update asked again.
- `allow_always` variance is the CLI's offering, not a bug: `permissionKind`
  (`src/acp/translate.ts:531`) maps the CLI's choice scope to the option
  kind, and the CLI offers session/persistent rule choices only for staged
  approvals (a stage's `suggestedPrefix`, `src/shared/agentEvents.ts:283`;
  `src/core/backends/musecode/promptLedger.ts:127`).

Mode reported back: `session/set_mode` returned `{}` and the agent never
sent `current_mode_update` (the protocol's mode-change notice), and a later
`session/load` rebuilt the session with the initial mode, discarding the
set one. Hence `acceptEdits` set, `manual` reported.

## Fixes

- Ask once (`src/acp/permissionAsk.ts`, new; wired in `src/acp/agent.ts`
  `askPermission`): the first answer is remembered per approval and per tool
  call and re-decided silently on later stages and re-issued approvals;
  one client request per approval at a time (synchronous claim); a mid-ask
  answer is applied to the latest stage by meaning
  (`answerChoice`: decision plus scope, never choice id), falling back to
  the denial default. Allow-once is never escalated to an allow-always rule.
- Mode report: `session/set_mode` notifies `current_mode_update`
  (`src/acp/agent.ts` `setMode`); ordinary loads keep the set mode,
  untrusted content still re-opens asking (`adoptedMode`, D49/M84);
  `AgentState.setSessionMode` records it. The CLI's effective mode is
  checked against the requested one and a mismatch is logged
  (`MuseCodeHost.ts` `applyModeEffect`, wire word via `wireWordForLog`);
  a CLI-initiated `approvalModeChanged` is logged in the ACP agent.
- Descriptions match what happens: Manual / Edit Automatically on Muse Code
  now say the agent asks before each command "unless a permission rule
  allows it" — panel Modes menu, editor-protocol mode list, settings
  manifests (`package.nls.json`) and help reference, in English and all 14
  tables. No approval weakened (words only).

## Proof

- Red first: `test/unit/acpPermissionAsk.test.ts` failed before
  `src/acp/permissionAsk.ts` existed (`Cannot find module
'../../src/acp/permissionAsk'`); the descriptions test failed until the
  English wording changed. After: 16/16 pass (repo default timeout).
- `permissionModes` 10/10, `acpTranslate` 44/44, `App` + `approvalRules` +
  `referenceGenerator` 385/385, `MuseCodeHost` + `mapNotification` 168/168.
- `acpAgent` 141/143: the 2 failures are fake-harness tests
  (`test/unit/helpers/fakeAgent` et al.) asserting the superseded behavior —
  `asks again for each stage of a staged command` and `ignores an answer
for an approval stage that advanced while the editor was asked`. Named
  and left untouched per the owner's testing rules.
- Gates on the final tree, all exit 0: `npm run typecheck` (5 projects),
  ESLint and Prettier on changed files, `npm run check:l10n` (0 problems),
  `npm run check:reference` (current), `npm run deadcode` (knip hints
  only), `npm run cycles` (no cycles), `npm run duplication` (0 clones),
  `npm run security:audit` (2 advisories, 1 exception),
  `npm run check:host-api` (0 problems), `npm run build` (all bundles,
  size checks pass). `npm run security:sast` unavailable: `semgrep is not
installed`.
- Packed product: `npm run build` rebuilt `dist/acp.js` + `dist/uiText.js`;
  the bundled English table contains the new description and no longer the
  old one (decompressed and read). Over stdio, the packed agent answers
  `initialize` but `session/new` fails with `Authentication required: Muse
Code is not signed in` under the empty HOME — the sandbox holds no CLI
  sign-in and lanes never mint credentials. The modes list, `set_mode`
  notice and permission counting are the lead's live session below.

## PRTH165 review repairs (2026-10-15, Windows)

### T1 — persistent rule identity

Reused the existing `ApprovalAnswers` / `answerChoice` module and the captured
2026-10-02 Muse Code stage data (`helpers/stageRaceCapture.ts`); no stand-in.
Persistent consent now compares `rulePreview` as well as decision/scope, and
missing rule identity cannot be reused. The exact current choice can still be
selected without a preview. A mid-ask meaning mismatch defaults to denial,
not a second lookup of the old option id in the new stage.

Real-module suite: 21/21, exit 0. Before the fix, three new assertions failed
with the unauthorized `Measure-Object` rule / missing-preview choice returned.
Green/red/restored-green drill removed the rule guard/comparison: exit 0 / 1 /
0, three intended failures. Restored SHA-256 of `src/acp/permissionAsk.ts`:
`c143d9495cbec373d8b21d97e96c909ced46dc97fe55fcd815b3414f441fe97c`.
Logs: `.lane/PRTH165.T1-{green,drill,restored}.log`.
An initial test setup used Zod's non-mini array method and discovered no tests;
that setup error was corrected and does not count as the red proof.

### T2 — consent published before dispatch

Code proof: the claim was released in `askPermission`'s `finally` before the
backend decision, and the cache write followed its awaited acknowledgement.
An `approvalUpdated` during that wait therefore found neither claim nor answer.
The cache write now occurs synchronously before calling `decideApproval`.
A failed dispatch does not erase the user's consent; a changed rule still
fails T1's identity check. No fake agent/backend was introduced to exercise
that interleaving. Lead run: in a real Muse Code staged command, answer once,
inspect the real MSP trace for an update preceding the decision response,
and confirm there is only one ACP request for that unchanged meaning.
Until that ordering is observed, integration verification remains pending.

### T3 — superseded assertions after merging main

The historical 141/143 result above describes the PR head, not this merged
branch. Main removed `test/unit/acpAgent.test.ts` in `f2b00c094` (test overhaul),
which is an ancestor of the requested merge target. Both that file and the
conflicting `App.test.tsx` remain deleted. No fake assertion was repaired or
restored. The surviving real-module permission suite covers 21 cases, including
staged answer reuse and updated persistent identity; it does not prove the
agent/backend event sequence. The real-life steps below replace the deleted
integration claims, per the owner's rule. No whole-suite pass is claimed.

### T4 — mode notice precedes the request response

`send` only appends to the session outbox; `setMode` previously returned
without waiting. The editor client checks its notification-populated map as
soon as the response arrives (`src/host/team/acpProcess.ts:620–628`). Now
`setMode` awaits that outbox after enqueuing `current_mode_update`, preserving
the existing ordered delivery and error reporting. No queue stand-in test.
Lead run: load a real conversation with history and immediately set Manual;
the real ACP trace must deliver its mode notice before the set response,
and the client must not report “did not confirm its mode”. Not run by lane.

### T5 — close retains the selected mode

`closeSession` no longer deletes `sessionModes`: close releases live ownership,
not saved history. `adopt` already reads that map through `adoptedMode`, whose
real-module tests retain the selected mode and re-ask untrusted imports.
This is connection-lifetime retention, not on-disk persistence across agent
restart. Lead run: configure initial Bypass, create a normal session, select
Manual, close it, then load the same stored id on the same connection. Expect
Manual in the load response and normal unmatched-command prompts. Repeat with
an imported session: the existing untrusted-content asking clamp must remain.
No live provider call made; those lifecycle steps remain for the lead.

### T6 — translated manifest descriptions

Read and updated Manual / Edit Automatically in all fourteen
`package.nls.<locale>.json` files. Each now includes the permission-rule
exception in that language, preserving Model API wording and the other modes.
The feature catalog's existing permission-limits binding remains canonical;
the reference is regenerated rather than creating another description.
Lead's small local look: with a supported non-English display language, open
Muse Spark settings and read the two initial-permission-mode descriptions.
Both must state the exception, while Model API still says commands ask.
No screenshot/visual gate or stand-in test was added.

### Final-tree verification and limits

All required scoped static gates passed, including all five typecheck projects,
zero-warning ESLint, Prettier, knip, cycles, duplication, l10n, reference,
host API, plan, roadmap and production build. Final receipts and exit codes
are in `.lane/PRTH165.report.md`. The unit typecheck first caught three
index-signature accesses in the new capture test; bracket access fixed them.
Four scoped real-module/manifest suites passed 76 tests; two list consumers
passed 17; six manifest/localization/compression consumers passed 56.

After the lint-required ternary rewrite, repeated T1's drill on the final
source: 21 green, three intended red failures (exit 1), 21 restored green.
Final before/after SHA-256:
`ef90855980ed80babeba7200a827c5b926b5a0f45932e3b40b0ea32ec0056143`.
Logs: `.lane/PRTH165.T1-final-{drill,restored}.log`.

Verification mistake disclosed: `vitest related` also selected surviving
fake-driven `acpStdio` and `runtimeServices` suites. They ran (13 and 17 cases),
but are not accepted as product proof. Live-provider cases remained disabled.
No tests of those kinds were added or repaired. No model calls were made.

Official `node scripts/package-acp.mjs` failed, exit 1:
`Required Darwin created-path helper is missing: native\\darwin\\muse-dictate`.
Both required Linux helper artifacts are absent too. No placeholder was made,
no packaging check bypassed; packed-product verification remains blocked.
The actual built agent's `--version`, English `help --all` and German
`help --all` ran with exit 0; an unknown option refused with exit 1. German
full Help renders both corrected manifest mode descriptions. These are built,
not packed, product observations. Lead must provide the genuine native release
artifacts, pack, and perform the signed-in steps before treating this certified.
SAST stays with hosted CI under this lane's brief. The generic delivery helper
cannot read this repository's native plan (expected a `quality-ledger` fence,
exit 2); `npm run check:plan` passes its actual plan format instead.

## Live-session steps for the lead (signed-in host)

1. Start the packed agent: `node dist/acp.js --backend museCode
--trust-workspace`; `initialize`, then `session/new` in a workspace.
   Check the modes list: Manual and Edit Automatically carry the
   "unless a permission rule allows it" line.
2. F13: in Manual, run a turn with several plain commands
   (`ls`, `grep -rn x .`). Count `session/request_permission` arrivals.
   Zero arrivals means the CLI's rules allowed them: inspect the
   workspace's permission sources and repeat with a command no rule
   allows; exactly one request must arrive before it runs.
3. F16: run one staged command (`grep -n "a" file | head; sed -n 1p
file`). Answer the single request `allow_once`: no second request may
   arrive, and the decided choice must repeat per stage in the log.
   Answer `reject_once`: later stages are denied without re-asking.
4. Modes: `session/set_mode acceptEdits` → expect a `current_mode_update`
   with `acceptEdits`; `session/load` the same id → `currentModeId`
   stays `acceptEdits`.
