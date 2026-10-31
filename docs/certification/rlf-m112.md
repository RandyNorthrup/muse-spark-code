# RLF-M112 — M112, questions that never block: the int audit and the open row

Lane `RLF-M112`, rig `macbook` (the owner's laptop), worktree
`/Users/user/lanes/RLF-M112`, branch `rec/rlf-m112`. Base: int/recovery
`0a5ebd7189` (CC-INT5; its known failures are not counted against this
lane). Model attempts: **0**. Provider calls: **0**. No paid or live
model call (the brief names none). Nothing pushed, rebased, stashed,
merged or tagged. No browser, GUI app, keychain or credential-store
suite was run; the vault suites were never run. Scratch files lived in
the worktree's ignored `temp/` and were removed afterwards.

Git on this rig needs `DEVELOPER_DIR=/Library/Developer/CommandLineTools`
(the default points at an absent `/Applications/Xcode.app`); every git
command below ran with it.

## 1. The audit: every lane and acceptance row against int's code

Read first: PLAN.md's M112 section, both D92 blocks, D104 in §2 and its
full record, and `m112.md`, `m112-q.md`, `m112-u.md`, `m112-a.md`,
`m112-contracts.md`, `m112-0.md`, `msm112.md`, `rlfinish.md`. Every row
below was then checked by reading the code on int, never from a status
line. Line numbers are on the base `0a5ebd7189` unless the file is this
lane's own change.

### Lanes

| Lane                           | Int has                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Contracts, strings           | `OpenQuestion`/snapshot/answer/dismiss/jump schemas, `QUESTION_STATES`, the store/clock/deferral/delivery ports; `deferQuestions` on `AgentSession`; the `openQuestions`/`answerOpenQuestion`/`dismissOpenQuestion`/`jumpToOpenQuestion` protocol messages, zod-parsed; strings in English and all 14 tables (`check:l10n` 0 problems)                                                              | `src/shared/questions.ts`, `src/core/agent/agentBackend.ts:929`, `src/shared/protocol.ts`, `src/shared/l10n/en.ts`                                                                                                                                                                                                                  |
| 0 Keymap check                 | Recorded in `m112-contracts.md`/`m112-0.md`; the chords ship chat-focus-scoped                                                                                                                                                                                                                                                                                                                      | `package.json` keybindings, pinned by `questionManifest.test.ts`                                                                                                                                                                                                                                                                    |
| 0 Fakes                        | Deleted by the no-fakes overhaul; stay deleted per owner rules                                                                                                                                                                                                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                   |
| Q Registry, backends, delivery | States/clock/store port, key, reminders, late answers; Model API `deferred` reply and tool output; Muse Code deferral through `userInput/clarify` with the deferred-id set; settled mapping (`clarified`→`deferred` only for harness-deferred ids); store adapters for VS Code and the runtime; the controller's question region; the reminder notice                                               | `src/core/questions/{registry,key,lateAnswer,reminders,deferralEntry}.ts`, `ModelApiHost.ts:19532` + `:9266`, `MuseCodeHost.ts:2616`, `mapNotification.ts:760`, `src/host/questions/questionStorage.ts`, `src/runtime/questions/questionStore.ts`, `conversationController.ts:4053,4105,12803-12843,3420`, `turnNotifications.ts`   |
| U Dock, transcript, VS Code    | `AttentionDock` (approvals first, then waiting newest-first, MCP forms, the open-questions chip); card states incl. focus/draft preservation; MCP forms in the dock; reducer question cases; jump commands and keys; badge count+tooltip taking precedence over the unread dot; tab title `· N open`; History marker; live-region texts (arrival, deferral, reminder, late answer)                  | `src/webview/components/{AttentionDock,QuestionCard,OpenQuestionsChip,QuestionUi,QuestionSurface,DeferredQuestionUi}.tsx`, `src/webview/state/uiState.ts:2925-2975`, `src/host/vscode/views/{ChatViewProvider.ts:25-31,chatPanel.ts:35}`, `HistoryDialog.tsx:89`, `App.tsx:1940` (`document.title`, shared with the companion page) |
| A ACP, runtime, docs, help     | The agent's clock; form withdrawal by `cancellationSignal`; late form answers after the deadline delivered as late answers; defer-at-once for clients without forms; `/answer` and `/questions`; one notice per deferral; the runtime registry/queue/disk restart; `--questions-defer-after`; `/help` rows; README, `docs/acp.md`, `docs/ci.md`, CONTRIBUTING, AGENTS layout, the `hosts.md` matrix | `src/acp/{questionDeferral.ts:267-467,questions.ts:153-156,agent.ts}`, `src/runtime/questions/{acpRegistry,questionRegistryBundle,questionRegistryEntry,questionStore}.ts`, `src/runtime/cliArgs.ts:880`, `docs/reference.md:643-655`, `docs/ide-compatibility/hosts.md:91-110`                                                     |
| Integration, live checks, gate | The two live checks stay with the lead (§4). The full gate is §5.                                                                                                                                                                                                                                                                                                                                   |

### Acceptance 1–13

1. **Pinned.** Carried: dock/row settlement through the snapshot, approvals
   first and never deferred, MCP forms in the dock with their 300-second
   expiry (`MCP_ELICITATION_TIMEOUT_MS`, still enforced at
   `mcp/connection.ts:381`, notice tested).
2. **Deferral.** Carried, under D121 (not the plan's 60/10/3600 numbers):
   `questionDeferSeconds` takes any whole seconds ≥ 0, 0 never defers
   (`src/shared/questionDeadline.ts`); default 0, minimum 0, machine scope,
   no maximum (pinned by `questionManifest.test.ts`); the fixed deferral
   note; ≤500-char Muse Code clarification (MSP v1's own documented limit,
   SDK `msp.d.ts:3549`); user explanations stay Explained
   (`questionSettlementOutcome`).
3. **The cache.** Carried: pre-deferral requests keep the goldens
   (`metaRequestGoldens` green on int per CC-INT5).
4. **Under the user's hands.** Carried: the card stays full under focus or
   a draft; the draft survives and sends as a late answer (`QuestionUi`,
   `uiState`).
5. **Late answers.** Carried: steer into a running turn, refused-steer and
   idle fall back to a new turn showing "Answer to your earlier question";
   exactly-once via mark-before-send (`lateAnswer.ts`, registry,
   `questionDeferral.ts:295-326` for ACP).
6. **Asked again.** Carried: key reuse shares one card; the open one
   becomes `answeredOnReask` with no late message (`registry.ts:258-261,366,416`,
   `key.ts`).
7. **Reminders.** Carried: turn end expands the oldest open question once
   (`endTurn` → `nextQuestionReminder`, bound 2) and raises one notice
   (`notifyOpenQuestions`, unfocused-window rule); the surface expands from
   the reminders increment (`uiState.ts:2944`); no model request follows.
8. **Kept.** Carried: reload/resume/second-surface persistence, the
   21st-expiry with its notice (`questionExpiryNotice.test.ts`, real
   registry over the real file store), session deletion removing them
   (`fileSessionStore.ts:587,798`), owner-only validated storage, ids and
   fixed words in logs (`failureForLog`), schema strictness canary
   (`questionContracts.test.ts`).
9. **Easy to pick out.** Carried in code: labels/icons per state, Next and
   Previous with chat-focus-scoped keys, badge/tab/History counts, live
   region texts. Installed-keyboard runs, README shots and the axe matrix
   are lead-owned (no browser on this machine).
10. **Runs nobody watches.** Carried: `exec` declines (`question_declined`,
    no clock, and `--questions-defer-after` refused as an unknown flag by
    `parseExec`); best-of-N/worktree conversations cancel
    (`worktreeConversationHost.ts:217`); the M75 evaluation clarifies
    (`eval/driver.ts:455`); scheduled prompts defer at once
    (`schedules/unattended.ts:358`); team engine workers decline through
    `WorktreeConversationHost` (`engineWorker.ts:332-336`).
11. **ACP.** Carried: deadline withdrawal, late answers steered or queued
    before the next prompt, no-form text plus defer-at-once, `/answer`,
    `/questions`, one notice per deferral (`questionDeferral.ts`,
    `questions.ts`). Installed-client behaviour is lead-owned.
12. **Editors.** VS Code family carried (RLFINISH: the integration test
    green on both VS Code versions). Companion page: the shared panel and
    `document.title` count ride the same App; the page's keys wait for a
    webview key layer that exists for nothing on int (open, §4). Native
    hosts: the panel carries the card/dock/chip once `lanes/rlf-hostsland`
    merges; the status-item count mapping needs the host code (open, §4).
    TUI: no question code on int and unreachable surface (open, §4).
    Desktop: no M111b on int (open, §4).
13. **Budgets.** Carried: `acpQuestions.js` 15.8/25, `runtimeQuestions.js`
    23.1/25, `questionNotes.js` 3.2/25, webview question UI 21.5/25 KiB;
    activation unchanged. The build's four overs are the base's (§5).

## 2. Built: the open row int could carry

One row was open: the deferral setting's words. The D121 lane updated the
code, the CLI help, the `/help` reference and all 14 translations, but the
English setting description, the README and the ACP guide still promised
the removed clamp ("60 by default; 1–9 are read as 10; maximum 3,600").

- `package.nls.json`: the description now says D121, matching the 14
  translations' meaning: no limit unless set, 0 (the default) never
  defers, any other whole seconds used as set, machine scope.
- `README.md` ("Questions"): "After one minute" → once the set seconds
  pass; the setting sentence states any whole seconds, used as set.
- `docs/acp.md`: the `--questions-defer-after` table row and prose state
  the 0 default, whole-seconds acceptance and the negatives/fractions/
  nonnumeric refusal, matching `cliArgs.ts:880-887`.
- `test/unit/questionManifest.test.ts`: a new case pins the English
  description's claims against the code (the frozen default in
  "0 (the default) means never", used-as-set, machine scope) and fails on
  the removed-clamp phrases — the established `manifest.test.ts` pattern.
- Regenerated `docs/reference.md` and the three generated reference files
  (one line each, the description).

Proof: `questionManifest` 3/3 green; kept question suites green (§5);
`check:l10n` 0 problems; `check:reference` green after regeneration.

## 3. Red/green drill

| Break                                                                                                   | Caught by                                                                                                                           | red               | green                                                         |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| `package.nls.json`: the stale clamp text put back ("60 by default … 1–9 are read as 10; maximum 3,600") | `questionManifest` "describes the deferral the code keeps…" (`AssertionError: expected … to contain '0 (the default) means never'`) | vitest exit **1** | vitest exit **0** (3/3), restored line verified in `git diff` |

## 4. Rows open and what they wait for

1. **The two live checks — with the lead** (plan step 3, M112's §6.0
   checklist). Nothing here claims them. Exactly what the lead must run,
   with the deadline at 10 seconds, in an empty workspace, on
   `muse-spark-1.3-contributor`, counts taken from the trace logs
   afterwards:
   - **Model API:** one turn that asks, defers at 10 s and carries on,
     then a late answer as a new turn. Expected: 3 inference requests.
     Record what the model did after the deferral: carried on, did not
     guess, did not ask again. If it guessed or asked again, lane 0's
     text is revised and the check runs once more. (Still unproven live:
     REL0143's Model API run answered the form before any deferral.)
   - **Muse Code:** the same in two turns, counted from the CLI's trace
     log (REL0143's receipt: 10 CLI admissions, form withdrawn at the
     deadline, "WAITING" without guessing; re-run on this build).
2. **Native-host rows — wait for the `lanes/rlf-hostsland` merge.**
   Built against MHP's contract on int: the runtime panel wires the
   question store and deferral (`panelSession.ts:148,331-332`,
   `runtimeConversation.ts:209-210`) and the MHP v1.1 schema carries the
   panel's `openQuestions`/`answerOpenQuestion`/`dismissOpenQuestion`/
   `jumpToOpenQuestion` messages, so the card, dock and chip ride the
   panel the nine hosts embed. What needs the host code itself and is
   left: each bridge mapping the open count to its status item / tool
   window (`ui/status` has no sender on int; sending it with no consumer
   would be dead code), and the installed-editor runs.
3. **Companion page keys — wait for a webview key layer.** Panel,
   document title and `/help` ride the shared App; Next/Previous exist
   only as VS Code keybindings (`App.tsx` handles no keys), so the
   page's keys need a companion key story with no owner on int.
4. **TUI row — waits for lane T and node agent sessions.** `src/runtime/tui/`
   holds no question code; `runLocalTui` has no CLI caller on int; the
   node runs no agent sessions, so no question can reach the TUI.
5. **Desktop row — waits for M111b** (no desktop on int).
6. **Installed runs** (VS Code-family keys/focus/counts, ACP clients'
   capability/withdrawal behaviour, README shots, the axe matrix) stay
   with the lead; no browser runs on this machine.

Observed and deliberately not changed:

- D92's "What exists" carries two stale parentheticals against int's
  code: the 500-clarification cap "is removed" (still enforced in four
  places, and MSP v1 documents ≤500 as the protocol's own limit), and
  the MCP 300-second deadline "is removed" (still enforced at
  `mcp/connection.ts:381`, tested, and correctly stated in the README).
  The code matches the provider's limit and the shipped behaviour; the
  plan lines are archaeology for the lead.
- D92.3 says "Unbounded" while acceptance 8 and the code expire the 21st
  open question; the RLLIMITS-kept `questionExpiryNotice` suite pins the
  shipped behaviour, so it stays.
- An ACP team worker whose child agent sends `elicitation/create` gets
  the SDK's unhandled-method answer (no handler is registered in
  `acpProcess.ts`); engine workers decline through
  `WorktreeConversationHost`. Whether lane W wants an explicit decline is
  M96's call, not M112's.

## 5. Gates and suites (final tree, honest exit codes)

Kept question suites (repo timeouts, `--maxWorkers=3`): `questionKey` +
`questionContracts` 17/17; `questionManifest` 3/3 (with the new case);
`questionUiState` + `questionAttentionOwnership` + `questionDeferLongWait`
20/20; `questionExpiryNotice` + `acpElicitation` + `elicitationHookSeam`
23/23; `elicitationTimeoutNotice` 1/1; `questionManifest` +
`manifest` 44/44 after the change; `vitest related
test/unit/questionManifest.test.ts` 3/3, exit 0.

| Gate                                             | Exit    | Result                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| prettier `--check` (touched files)               | 0       | (one `docs/acp.md` table realignment by `--write`, committed)                                                                                                                                                                       |
| eslint `--max-warnings 0` (touched)              | 0       |                                                                                                                                                                                                                                     |
| `npm run typecheck`                              | 0       | 0 `error TS`                                                                                                                                                                                                                        |
| `node scripts/check-l10n.mjs`                    | 0       | 14 UI, 14 usage, 284 manifest, 2496 sources; 0 problems                                                                                                                                                                             |
| `npm run check:reference`                        | 0       | after regenerating the 4 reference files for the description                                                                                                                                                                        |
| `npm run check:host-api`                         | 0       | 392 APIs, 57 files, 30 built-ins, 76 theme vars; 0 problems                                                                                                                                                                         |
| `npm run check:plan`                             | 0       | 244 milestones; 0 drift                                                                                                                                                                                                             |
| `npm run check:roadmap`                          | 0       | 244 entries; current                                                                                                                                                                                                                |
| `npm run check:catches`                          | 0       | baseline matches; nothing added                                                                                                                                                                                                     |
| `npm run duplication`                            | 0       | 0 clones                                                                                                                                                                                                                            |
| `npm run cycles`                                 | 0       | no circular dependency                                                                                                                                                                                                              |
| `npm run deadcode`                               | 0       | only the inherited tag hints                                                                                                                                                                                                        |
| `npm run build`                                  | 1       | **the base's four overs, byte-identical** (`teamHost` 140.2/130, `teamRunners` 78.4/75, `teamScheduler` 76.5/75, `uiText` 125.3/125 KiB); question bundles hold (§1.13). No budget raised.                                          |
| tokens / split / lazy-registry `--check` by hand | 0, 0, 0 | 184 bundles, 290 loads, current                                                                                                                                                                                                     |
| `npm run security:audit`                         | 1       | 10 advisories incl. high `GHSA-mrwp-f3q8-3g9p` (follow-redirects); the lane changes no dependency (`git diff` on `package.json`/`package-lock.json` empty), so this is the base plus a newer advisory DB, not this lane             |
| `npm run security:sast`                          | blocked | semgrep is not installed; installing 1.180.0 in a temp venv fails building metadata (`rustup could not choose a version of cargo`) — no toolchain on this rig. Zero product source changed, so no finding could come from this lane |

Not run: the VS Code integration suites (Electron cannot start here),
browser suites and `ui:look`, the vault and OS credential-store suites
(forbidden on this machine), any model or paid call.

## 6. Commits

- `7beb4c8e2` fix(m112): the deferral docs say D121, as the code and
  translations already do (README, `docs/acp.md`, `package.nls.json`,
  the `questionManifest` guard + drill)
- `58d657827` docs(reference): regenerate for the D121 deferral description
- `479d0b927` docs(m112): RLF-M112 audit record, changelog and plan status
