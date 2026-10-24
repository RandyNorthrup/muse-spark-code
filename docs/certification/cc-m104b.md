# cc/m104b — M104 lane B on int/recovery: the runtime panel

## Handoff (2026-10-24, to the rig continuing on this branch)

The owner freed this PC; lane B continues on a rig on branch `cc/m104b`.
Everything is committed (last commit before this record: `097aba7b42`);
the worktree is clean apart from ignored `temp/`.

### The brief (as given)

Build the largest remaining area of M104 on int: remainder item 1 of
`docs/certification/cc-rlm104.md` ("Runtime panel (lane B)"), with item 2
(ACP on the controller) and the int-specific design that record gives.
Already on int: area 1 (MHP 1.5 contract, `check:mhp`), area 2
(`src/host/vscode/` and its host-API rule), lane H (`lsp`, `supervise`,
`stop`, `docs/certification/cc-m104h.md`). RLM104's code is on
`refs/rigs/linuxlt/rec/rlm104` in the hub repo (read with `git show`; never
merge it). Build: `panel --stdio|--companion`, the controller registry, the
settings and storage store, `src/runtime/features/**`,
`src/runtime/panel/**`, `host/compose`, `host/vscode/hostServices.ts`,
reconciling RLM104's 16 conflicting files (paidConsent, paidFeatures,
resourceGovernorEntry, mcpJobLaunch, modelApiBackendManager,
conversationController, judgeBundle/judgeEntry/judgeUsage, runtime/backends,
cliHelp, cliOptions, companion/page, exec/runExec, runtime/main,
cliCommands). Paid use composes int's `PaidUseConsent` (D48; D208: no
spending check without a limit the person set) the way `src/acp/paid.ts`'s
`AcpPaidUse` does, not RLM104's pre-D208 path. ACP keeps int's turn path
exactly (RLACP's slash handling, resource sessions, outbound error
allow-list, `acpAccounting`); the panel's registry observes ACP sessions and
their events rather than taking over their turns. Own the exports area 1
removed (`panelEventId`, the presentation types) and
`fallbackUi.ts`/`portableAssets.ts`. Never a second copy of anything int
has. Suites on the real composition (no stand-in store, runtime,
transport, editor API or provider). Vertical slices, each committed when
its real-code suites are green; keep this record and a short PLAN status
line current. Rules: hooks on, explicit paths, never push, no provider
calls, no vault/credential-store suites on this PC, no bundle budget
raised, new code in lazy chunks with measured budgets (D6).

### Slices done

| Slice     | Commit        | What                                                                                                                                                                                                                               | Proof                                                                                                                                       |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | `c17faa0c2a`  | `src/runtime/settingsStore.ts` over the runtime's own settings files                                                                                                                                                               | `runtimeSettingsStore` 12/12; drills S1–S3 fire, S4 not caught (why below)                                                                  |
| 2         | `f432fac54d`  | `src/runtime/panel/controllerRegistry.ts`, AgentState delegating; ACP turns untouched                                                                                                                                              | `acpSessionRegistry` 2/2; drills R1, R2 fire; int's ACP suites 228/230 (2 = int's own)                                                      |
| 3         | `a26bb6a23`   | `panel --stdio` (dist/runtimePanel.js): handshake, settings, storage; wire.js shares the two panel schemas                                                                                                                         | `runtimePanel` 9/9 on the production build; drills P1–P6 fire (below); `wireEntry` 2/2; fixed: a fatal close left the process alive (below) |
| 4a        | `9d44d6774`   | the conversation bundle loads without the `vscode` module (portable question clock; `questionsForHost(store, deferAfterSeconds)`)                                                                                                  | `runtimePortableBundles` 1/1; drill B1 fires                                                                                                |
| 4b–5a, 7a | `3c61b9a1a`   | the chat in `panel --stdio`: runtime-to-host requests, surfaces and delivery, `RuntimeConversation`, the shared mapping `composeConversationDeps`, the runtime's ports (auth, files, mentions, editor context), the session bundle | `runtimePanelConversation` 2/2, `runtimePanelSessions` 6/6; drills C1–C8 fire (below)                                                       |
| 6         | `1081aca0e`   | paid use in the panel: the gate over the runtime's settings, the question through MHP `ui/confirm`, Always in the grants file ACP shares                                                                                           | `runtimePanelSessions` 9/9, `runtimeSettingsStore` 13/13; drills M1–M5 fire                                                                 |
| 5b        | `728a52409`   | edit review and `/review` over int's review bundle, export and import through the editor's dialogs, unsaved editor files told to the backend                                                                                       | `runtimeReview` 6/6, `runtimeTransfer` 4/4, `runtimePanelSessions` 10/10; drills V1–V5, X1–X4, U1–U2 fire                                   |
| 5c        | `40106f850`   | git and pull requests in the panel: the native route over the editor's services, in `dist/nativeGit.js`; the GitHub sign-in (device flow, `gh`) shared with VS Code                                                                | `runtimePanelGit` 6/6, `runtimeSettingsStore` 13/13, `pathGuardSpawns` record moved; drills G1–G7 fire                                      |
| 5d        | (this commit) | Ask again, saved plans, a tool row's output in an editor tab, sign-out said in words                                                                                                                                               | `runtimePanelSessions` 14/14; drills D1–D6 fire                                                                                             |

### Next step, exactly

Continue slice 5 with the runtime's remaining ports (below, "Shared
composition": checkpoints, the IDE tool server, usage insights, dictation,
the Model API manager port, the session log export, host actions), then 7b (the other surfaces), 8, 9. The
rig-specific facts are in "Rig notes".

### Slices left, in order, with the intended design

4. **The runtime conversation. Done (4a, 4b).** `RuntimeConversation`
   (`src/runtime/panel/runtimeConversation.ts`) runs int's own
   `ConversationController` in the panel process and is held by slice 2's
   `ControllerRegistry`. The controller got `onSessionAttached`,
   `replayHistory`, `startFreshSession` and `selectedModelId`;
   `modelAllowsFeature` is **not** applied: int's controller gates effort on
   the served catalogue (`servedLevels`) already, and the other gates
   (compaction, handoff, attachments) read the host kind, which is the same
   gate ACP uses; it returns when a capability record source exists in the
   runtime. `arePermissionsExternal`, `submitParts`,
   `useExternalPermissionMode` stay out (ACP keeps its own turns).
5. **Shared composition. Partly done (5a).** `composeConversationDeps`
   (`src/host/compose/conversationDeps.ts`) is the one mapping of what is
   the same in every editor (settings, the paid gate, the model API manager,
   the session board, best-of-N edits, verify guidance); VS Code builds its
   controller from it (its modals, clipboard, save-all and new windows come
   in as `ConversationEditorPorts`) and the runtime builds the same from MHP
   requests. This deviates from the intended design in one way: the shared
   function takes five narrow editor ports, not the whole MHP `HostServices`,
   so VS Code needs no 554-line MHP adapter of its own (it would implement
   every MHP method for five calls). VS Code's behaviour is unchanged by
   construction (the closures moved; typecheck and lint pass); the
   integration suite inside VS Code was not run here (see "Not run").
   `src/runtime/features/**` holds the runtime's ports. Done: auth
   (`RuntimeAuth`, over the backend's readiness; keys only in the editor's
   terminal), workspace files and mentions (confined, race-checked reads),
   editor context, paid use (6), edit review and `/review` (`review.ts`: int's
   `dist/review.js` with the editor's diff, picker and the data folder's
   trash), export and import (`transfer.ts`: the editor's save and open
   dialogs, a preview file the editor opens before the person decides), and
   the unsaved editor files, which reach the backend's tools
   (`RuntimeBackendDeps.unsavedFiles`), git with pull requests (5c,
   `src/runtime/panel/git/panelGit.ts`), and (5d) "Ask again", saved plans
   (`dist/runtimePanelPorts.js`), a tool row's output in an editor tab and the
   sign-out sentence. Still refused in words
   (`unavailable()`), each to be built against int's interfaces: checkpoints
   (`store: undefined`; they need the admission git's commit and push run
   through), the IDE tool server (`ideMcpEndpoint`), usage insights,
   dictation and Muse Voice, the Model API manager port (best-of-N, voice
   budget), Muse Code install, the session log export (Muse Code writes it
   to a path; the editor's dialog hands the runtime text), and most host
   actions.
6. **Paid use in the panel (D48, D208). Done.** `src/runtime/features/paid.ts`
   builds int's own `PaidFeatureGate` and `PaidUsage` over the runtime's
   settings (a setting the person never set is on by default on the Model API,
   D78, and unavailable on Muse Code; turning one on names its price in
   `ui/confirm`) and the `AcpPaidUse` of the runtime backend is composed as
   the ACP agent composes it: its flags are the features the gate says are
   on, it asks through `ui/confirm` with D48's three answers (no Always
   where nothing can be kept), "Always" is kept in `runtime/paidGrants.ts`,
   the file ACP reads, and a conversation let go while the editor is asked is
   billed for nothing. A change of the features on replaces the backend, so a
   feature turned off loses its Always (`forgetUnflaggedGrants`). **No spending
   check, reservation or ledger read exists in this path:** the daily budget
   line names the limit the person set, or says there is none. Not in the
   panel yet: sign-out of paid consent (`forgetPaidUse`, "Ask again"), the
   features outside ACP's four (subagents, scheduled prompts, best-of-N,
   team workers, Tab, hook models, judge, legal explanations).
7. **Chat surfaces over MHP. Chat done (7a).** `connection.ts` asks the
   host (correlated ids, `$/cancelRequest`, no deadline of ours),
   `surfaces.ts` admits lifecycle and envelopes with the frozen contract,
   `delivery.ts` holds a surface's frames until it is ready and drops them,
   counted, when it closes. `surfaces/open` is asked once the handshake is
   done; a conversation without a backend session yet is bound to an id of
   its own and its surface is replaced when the first session starts (MHP
   binds a surface to one session for good). Still to do (7b): the other
   surface kinds (tasks, whatsNew, usage, maker, models, traffic, settings,
   walkthrough, diff, plans, manager, roles), host actions that open them,
   and `panelEventId` with its readers.
8. **`--companion`** over int's companion server (`src/runtime/companion/`,
   its launch code and bearer, cc-rlm104 item 4 `/panel/*` routes), with
   `fallbackUi.ts` and `portableAssets.ts` moving in with their first
   readers (lane D's portable page).
9. **ACP sessions seen in the panel (item 2).** The panel and the agent
   must share a process for this (ACP's `/panel`, or the companion started
   from the ACP process); then the panel's registry is ACP's
   `ControllerRegistry` instance (pass it in through `AcpAgentDeps`) and a
   panel view observes the ACP session's `AgentSession.onEvent` (both
   backends keep a listener set) read-only. No turn goes through the panel.
10. **Reconciling the 16 conflicting files** happens inside 4–8 as each is
    reached, against int's code, never by applying RLM104's diffs:
    `runtime/backends` (RLM104 +439, the panel's backend profile),
    `exec/runExec` (+625), `runtime/main`, `cliHelp`/`cliOptions`/
    `cliCommands` (slice 3 already added `panel` the int way),
    `companion/page`, `judgeBundle`/`judgeEntry`/`judgeUsage`,
    `mcpJobLaunch`, `resourceGovernorEntry`, `modelApiBackendManager`,
    `conversationController`, `paidConsent`/`paidFeatures` (see 6).

### Gotchas found here

- **`dist/wire.js` hides names.** Every lazy Node bundle resolves
  `protocol.ts` to `dist/wire.js`; a name it does not re-export reads as
  `undefined` and a module that builds a zod schema from it throws at load
  ("Cannot read properties of undefined (reading 'def')"). Area 1 left the
  two MHP panel message schemas out; slice 3 shares them
  (`src/shared/wireEntry.ts`, `wireEntry.test.ts` now demands every export).
- **Python on Windows writes CRLF.** Edits made through Python's text mode
  turned files into CRLF, which broke `gen-reference`'s account-restore
  anchors ("Account restore anchor missing: WB-165 README.md"). Write with
  `newline='\n'`; everything committed here is LF.
- **Settings already live in two runtime files.** `<data>/settings.json`
  (unprefixed keys, `reports.planMaxBytes` documented as
  `reportsPlanMaxBytes`) and `<data>/resources.json` (`museSpark.`-prefixed
  governor keys, not in the settings table at all). The store routes each
  setting to where the runtime reads it; resource settings validate through
  `resourceSettingsSchema`.
- **Whole-file compare-and-swap is not atomic in one process.**
  `writeFileIfUnchanged` lost a key under 24 concurrent writers (two passed
  the final comparison before either renamed); the store uses an in-process
  queue plus the runtime's `withNamedLock`.
- **Muse Code captures cannot serve an ACP `session/new`.** Each capture
  lacks either `museHome` in initialize or `session/setReasoningEffort`;
  the registry suite uses the real Model API host rig with the editor-chat
  providers file instead (a provider run also needs `initialModelId`).
- **`acpServeHandshake` fails on int itself on this PC** (generic failure
  instead of the sign-in refusal), checked on an archive of `acb48b7f35`.
- **The lint is strict** (`unicorn/consistent-boolean-name` flags a
  parameter typed as a function returning boolean; class member order puts
  private methods first; `Promise.withResolvers` is preferred by lint but
  absent from the host's ES2023 lib, so wrap the work in one `new Promise`).
- **`check:catches`** counts a handler that hands the error to a helper as
  GENERIC; record it in the handler through `failureForLog`.
- **Text groups** must not be named after a CLI route (the reference pulls
  them into the panel's English): the panel's group is `hostService`.

- **The agent's package did not carry the controller.** The lazy-registry
  gate found, once the panel loaded `conversation.js` in the agent, that the
  package lacked it and the four chunks the controller loads on use
  (`conversationTransfer.js`, `report.js`, `sessionBoard.js`,
  `scheduleSurfaces.js`); `scripts/lib/acpBundles.mjs` lists them now and the
  registry rows read `both`.
- **A session change must finish before its surface opens.** The first
  version opened the new surface inside `onSessionAttached`. The editor
  answers `surfaces/open` at once and its webview says `ready` while the
  controller is still taking the session, so the replay found no session and
  the transcript was never shown. The surface now opens after the message
  that caused the change has been handled (`settled`), which drill C3 proves.
- **A surface needs a session id before there is a session.** MHP binds a
  surface to one session, and a signed-out person must still see the sign-in
  gate. The conversation holds an id of its own until the backend starts a
  session; the surface is replaced when it does. RLM104 refused the whole
  handshake while the backend was not ready.
- **`z.core` is not in `dist/validation.js`.** The bundle-split gate refused
  a read of `z.core.$ZodError` from the shared validation bundle; the check
  reads the error's name instead.
- **The credential store cannot be faked, so a ready backend cannot be
  reached hermetically through the real process.** `runtimePanelSessions`
  runs `runPanel` in the suite's process over streams, with the product's own
  runtime, a Model API host over a real file store reported ready, and a
  credential store that fails the suite if anything reads it;
  `runtimePanelConversation` runs the packed process and covers the gate.
- **The lint prefers** `Iterator#toArray` to a spread of a Map iterator, but
  the host's ES2023 lib has no `toArray`: take the values through an
  `Iterable`-typed local, then spread.

### Rig notes (Mac mini, 2026-10-24)

- Gates and suites run directly in the worktree (no rig scripts). Node 24.21.0.
- `test/unit/runtimeLsp.test.ts` (lane H's suite) fails 5 of 9 cases here:
  the two `--tab` hook cases (each 120 s) and the three `supervise`/`stop`
  cases (each 240 s). The same 5 fail identically on an archive of this
  branch's base commit `8173c8649` (before any edit of this session), run as
  its own git repository under `temp/`. They are not caused by this lane and
  are not re-run into green; hosted CI or the lead's other rig decides them.
- Gate results are in "Gates" at the end of this record.

---

Claude Code lane. Base: int/recovery `acb48b7f35` (after cc/m104h's join).
Branch `cc/m104b`, worktree `C:\Users\Randy\Coding\mx-cc-m104b`. Source
read, never merged: RLM104's branch `refs/rigs/linuxlt/rec/rlm104`
(`src/runtime/panel/**`, `src/runtime/settingsStore.ts`,
`src/runtime/features/**`, `src/host/compose/**`,
`src/host/vscode/hostServices.ts` and their tests). The brief is remainder
items 1 and 2 of `docs/certification/cc-rlm104.md`.

Environment: Windows 11 workstation, Node 24.20.0. Vitest ran with
`TMP`/`TEMP` under the worktree's `temp/tmp` and `GIT_CEILING_DIRECTORIES`
at the worktree's `temp/`. No push, no paid or live model call, no provider
request of any kind; the vault and credential-store suites (`**/vault/**`,
keyringParts, keystoreOwner, credentialLease, providerHeadersStore) were
not run.

## Slice 1 — the settings and storage store

`src/runtime/settingsStore.ts` answers MHP's `settings/*` and `storage/*`
for the runtime panel. Int-specific design, against what int's runtime
already reads (RLM104's store kept every setting in hashed per-key records
under a folder of its own, which on int would have been a second copy of
the daily budget and three other settings):

- **A user setting lives where the runtime already reads it.** The agent
  data folder's `settings.json`, under its documented key: the setting's
  name with a dotted group folded into camel case, which is exactly the key
  of every setting the runtime read there before (`paidDailyBudgetUsd`,
  `mediaConverterPath`, `reportsPlanMaxBytes` for `reports.planMaxBytes`).
  The resource governor's eight settings go to `resources.json` under their
  `museSpark.` keys, as `resourceMachineStore` reads them; their names now
  come from one exported table (`RESOURCE_SETTING_KEYS`) and are validated by
  the governor's own `resourceSettingsSchema`. Keys the store does not know
  (a person's own lines) are kept.
- **A workspace's own settings and both storage scopes** are JSON files in
  the workspace's folder of the data folder (`<data>/acp/<workspace key>/`,
  the folder the ACP agent already keeps per workspace), never in the
  repository. A machine-scoped setting (`MACHINE_SCOPED_SETTINGS`, D15)
  refuses the workspace scope, and a read takes it from the user's file
  only, as VS Code does.
- **Validation** is the settings table's own schema (`parseSettingValue`,
  new beside `readSettings` in `src/host/settings.ts`); `settings/get`
  answers the stored value, or the default when none is stored or the
  stored one is invalid (VS Code's rule); `readAll` is `readSettings` over
  the two files.
- **Rule 8.** A value whose field names a credential (spelt as an
  environment variable: `apiKey` → `API_KEY`, through int's
  `isCredentialVariable`), an environment entry naming one, or text the
  redactor recognises as a key is refused before anything is written.
- **One writer per file.** RLM104's lock files with a 100 ms retry and a
  timeout are replaced by int's own cross-process named lock
  (`withNamedLock`: a pipe on Windows, a socket in a private `/tmp` folder
  elsewhere; the OS releases a dead holder's), with no deadline of ours,
  plus an in-process queue. A first version used a whole-file
  compare-and-swap through `writeFileIfUnchanged`; the concurrency case
  lost a key with it, because two writers in one process can both pass the
  final comparison before either renames. Writes replace the file
  atomically (`writeFileAtomically`, mode 0600).
- **No size cap of ours.** RLM104 bounded a record at 1 MiB and a key at
  1,024 characters; MHP's own envelope bound (`MHP_PANEL`) already bounds
  what a host can send, and the person's own settings get no limit.

Suite `test/unit/runtimeSettingsStore.test.ts` (12 cases, real files): a
budget written through the store is the one `runtimeDailyBudgetUsd`,
`runtimeReportsPlanMaxBytes` and `runtimeConverterPath` read, with the
person's own line kept; a resource setting reaches `resourceMachineStore`;
defaults; workspace precedence in that workspace only; machine-scoped
refusal; unknown and invalid values refused with nothing written; four
credential shapes refused; every setting's own default accepted under a
key no other setting shares, and `readAll` unchanged by writing them;
24 concurrent storage writes and three settings writes from two stores lose
nothing; storage scopes, null removal, reopening; a damaged file refused
and left as it was; change notices reach every store over the same files.

| Drill | Break                                                         | Result                                                      |
| ----- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| S1    | `change` writes without the queue and the named lock          | exit 1: "loses no key when several writers change one file" |
| S2    | the machine-scoped refusal of the workspace scope removed     | exit 1: "keeps a machine-scoped setting the person's alone" |
| S3    | the credential field-name check removed                       | exit 1: "never stores a credential"                         |
| S4    | a read takes a machine-scoped setting from the workspace file | exit 0: not caught (below)                                  |

S4 is not caught: only the store writes the workspace file, and it refuses
a machine-scoped setting there, so no case can put one in it except by
hand; the read rule stays, matching VS Code. The cross-process half of S1
(the named lock with the in-process queue left in) is proven by slice 3's
two-process case. Every file was restored and matched its blob hash.

## Slice 2 — one controller registry, ACP's turns untouched

`src/runtime/panel/controllerRegistry.ts` is the ACP agent's own session
bookkeeping (AgentState's `sessions`, `adopting`, `claims`, `releasing`,
watched and exited hosts), moved out unchanged: claim before backend I/O,
adopt only a prepared view behind the release barrier of the one it
replaces, close, release every session on sign-out, and retire every
session of a backend that exits. RLM104's registry was the same
extraction; on int it is the single copy, which the runtime panel's own
conversations will use as well instead of a second one.

AgentState now delegates to it and keeps only what is ACP's: the remembered
model and effort, client modes, extra roots (cleared through the registry's
`released` hook, as `releaseAll` cleared them before) and the log line a
stopped backend writes. ACP's turn path is exactly int's: RLM104's
`createConversation`, `AcpConversation`, `acpComposition.ts` and its
`this.conversation.submit(...)` turn are not brought in, so RLACP's slash
handling, resource sessions, outbound error allow-list and `acpAccounting`
run as merged.

Observing ACP sessions from a panel (cc-rlm104 item 2) needs the panel and
the agent in one process (ACP's `/panel` or the companion route): the
registry they would share is this one. `panel --stdio` runs as a process
of its own, so it is remainder with lane C.

Suite `test/unit/acpSessionRegistry.test.ts` (2 cases): a real ACP client
drives the real agent over the product's own Model API host and real file
session store, no key stored, with the editor-chat rig's real providers
file for its models (local addresses; any send refuses). `session/new`
adopts a session; `session/close` lets it go; a second close and a prompt
answer the protocol's resource-not-found; `logout` lets every held session
go. `modelApiRig` gained an optional model resolver for this. The Muse Code
captures could not serve it: each one either lacks `museHome` in its
initialize (the host refuses it) or lacks `session/setReasoningEffort`,
and joining two captures would invent an exchange.

| Drill | Break                                             | Result                                |
| ----- | ------------------------------------------------- | ------------------------------------- |
| R1    | `closeSession` reports a session found every time | exit 1: both cases (the second close) |
| R2    | `releaseEvery` lets no session go                 | exit 1: "lets every held session go"  |

Int's ACP suites over the extraction: 21 of 22 files, 228 of 230 cases
pass. `acpServeHandshake` (2) fails the same way on an archive of
int/recovery `acb48b7f35` on this PC: the staged agent answers its
session list with the generic failure instead of the sign-in refusal, with
or without this change.

## Slice 3 — `panel --stdio`, proven

`muse-spark-code-acp panel --stdio [--workspace <dir>]` (dist/runtimePanel.js,
loaded only by `panel`): the MHP 1.5 handshake (D226: one version; a range
without it is `MHP_INCOMPATIBLE_VERSION`), the host's folder bound to the one
workspace the process started in, `settings/*` and `storage/*` answered by
slice 1's store, request cancellation, shutdown (exit 0) and a host that
leaves (exit 1), an oversized line ending the connection (exit 1, said on
stderr), and every other panel envelope refused with
`MHP_PANEL_UNKNOWN_SURFACE`.

Suite `test/unit/runtimePanel.test.ts` (9 cases, each under 1.5 s, the
repository's own 5 s timeout): the real `dist/acp.js` of the shared
production build, spawned and driven over real stdio by frames built and
parsed with the frozen contract (`src/shared/hostApi`); every per-user folder
points into the suite's folder; no provider, key or network. The host keeps
its end of the pipe open after `shutdown`, as a running editor does, so each
shutdown case also proves the runtime ends by itself.

Found by the drills and fixed:

- **A fatal close left the process alive.** An oversized line ended the
  connection (`resolve(1)`), but `process.stdin` stayed open and flowing, so a
  host that kept its pipe open held the runtime forever. The close now
  destroys the input (`panelEntry.ts`).
- **The workspace-binding case never reached the comparison.** It used a
  folder that did not exist, so the refusal came from `ENOENT`, and breaking
  the `isSamePath` comparison went unnoticed. The case now tries a folder that
  exists and one that does not.

| Drill | Break                                                                                             | Result                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P1    | the version refusal in `connection.ts` `initialize` removed                                       | exit 1: "refuses a version range without MHP 1.5, …"                                               |
| P2    | `stateFailure`: machine setting answers `invalidParams`                                           | exit 1: "writes a setting where the runtime reads it, …" (with P1 in one run: 2 distinct failures) |
| P3    | `boundWorkspace`'s `isSamePath` comparison removed                                                | first run exit 0 (not caught: see above); after the test fix exit 1                                |
| P4    | both oversized-line checks in `readLines` removed                                                 | exit 1: "ends the connection, saying why, on a line longer than MHP allows" (5 s timeout)          |
| P5    | `closed(isFatal)` always resolves 1                                                               | exit 1: 5 cases that expect exit 0 after shutdown                                                  |
| P6    | `deps.stdin.destroy()` removed from `closed`                                                      | exit 1: 6 cases time out (the process outlives its connection)                                     |
| L1    | slice 1's `withNamedLock` removed from `RuntimeSettingsStore.change` (the in-process queue stays) | exit 1 in 3 of 3 runs: "loses no setting when two runtimes write the same file at once"            |

Every file was restored from `HEAD` and matched its blob hash. `dist/wire.js`
is 76,202 of 76,800 bytes (budget 75 KiB, the same shape as int's: the two
panel schemas fit by weight); `dist/runtimePanel.js` 66.8 of 100 KiB.

jscpd found three clones this lane had introduced (slice 2's registry suite
against `sessionTitles`, and `runtimePanel` against lane H's `runtimeLsp`
environment helper). The shared test helpers `helpers/acpLocalAgentDeps.ts`
and `helpers/isolatedRuntimeEnvironment.ts` replace the copies; both suites'
neighbours (`sessionTitles`, `runtimeLsp`) read them too.

## Slice 4a — the conversation bundle loads without `vscode`

`dist/conversation.js` required `vscode` at load, through the question
store's setting reader and clock, so no other editor's runtime could create a
conversation. The clock moved to the portable question storage and the editor
passes the defer-after setting in. `runtimePortableBundles` requires the
shared production build's bundle in a plain Node process.

| Drill | Break                                                       | Result                                |
| ----- | ----------------------------------------------------------- | ------------------------------------- |
| B1    | the `vscode`-importing question store put back in the entry | exit 1: "Cannot find module 'vscode'" |

## Slices 4b–5a and 7a — the chat in `panel --stdio`

What a person gets: an editor that speaks MHP 1.5 starts
`muse-spark-code-acp panel --stdio` in its workspace, and the runtime asks it
to open a chat surface (`surfaces/open`). The webview's messages go to int's
own conversation controller; its replies come back in panel envelopes; the
sign-in gate, the composer's state, the model list, the session's
information, settings changes and the editor's selection reach it; closing the
editor's connection ends every session. Which backend runs is the person's
`museSpark.backend` setting (`auto` is Muse Code, as `serve` defaults), the
editor's `trusted` decides the workspace's trust, and a change of either, or
of any setting the backend is built from, ends the conversations and starts a
fresh one.

Where it lives: `connection.ts` (requests both ways, `$/cancelRequest`),
`surfaces.ts` and `delivery.ts` (lifecycle, sequence, readiness, drops),
`runtimeConversation.ts` (one conversation, any number of surfaces),
`panelSession.ts` (backend, registry, first surface, settings, trust,
selection, documents; `dist/runtimePanelSession.js`, 75.1 KiB of 120),
`panelEntry.ts` (the transport, now 76.7 KiB of 100), `runtimeFeatures.ts`
(the controller's dependencies), `features/` (auth, files, editor context).

Suites, on the shared production build, real code only:

- `runtimePanelConversation` (2): the packed process, a backend that is not
  ready; the editor serves `surfaces/open` and `terminal/*`. The gate shows
  with its methods; Sign in asks the editor's terminal to run `login`; the
  contract's refusals (a skipped sequence, an unknown surface, a frame the
  wrong way round, a surface for a session the runtime does not hold) are
  said with their codes and the surface still works after them.
- `runtimePanelSessions` (6): `runPanel` over streams with the product's
  runtime and a Model API host over a real file session store: a session
  starts and the surface is bound to it; clearing the conversation closes the
  old surface and opens a fresh one on a new session; a reloaded surface is
  shown the transcript again; a settings change reaches every surface; the
  editor withdrawing trust, and a change of what the backend is built from,
  each end the conversation and start another; shutdown lets every session
  go.

| Drill | Break                                                                    | Result                                                                  |
| ----- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| C1    | `onSessionAttached` no longer tells the panel (`sessionChanged` not run) | exit 1: all 6 sessions cases (no surface for the session)               |
| C2    | the new session's surface is never scheduled to open                     | exit 1: all 6 sessions cases                                            |
| C3    | the surface opens inside `onSessionAttached` (the first version)         | exit 1: "shows a reloaded surface the conversation again" (the race)    |
| C4    | a trust change is ignored                                                | exit 1: "ends its conversations … stops trusting the workspace"         |
| C5    | a settings change is not published to the surfaces                       | exit 1: "shows every surface the person's settings when they change"    |
| C6    | the old session's surfaces are not retired                               | exit 1: the clear, trust and backend-change cases                       |
| C7    | an admitted frame does not advance the surface's input sequence          | exit 1: "shows the sign-in gate …" (its second message is out of order) |
| C8    | an `opened` for a session the runtime does not hold is ignored           | exit 1: "refuses, in the contract's words, …"                           |

Every file was restored and matched its hash.

Not run: the integration suite inside VS Code (`npm run test:integration`);
VS Code builds its controller from the shared mapping now, and its behaviour
is unchanged by construction, but only hosted CI starts VS Code.

## Slice 6 — paid use in the panel

What a person gets: the panel shows which paid features are on, the palette's
toggles turn one off at once and turn it on again after naming its price,
and every paid use asks first in the editor (Allow once, Allow always in this
workspace where the workspace is trusted, Deny), naming the price and the
daily limit they set (or that none is set). Nothing is spent without their
yes, and nothing is checked against a limit they did not set.

| Drill | Break                                                          | Result                                                                                                                                                 |
| ----- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1    | Allow always offered where nothing can be kept                 | exit 1: "names the limit the person set, and offers no Always …"                                                                                       |
| M2    | the turn-on confirmation accepts whatever the editor answers   | first run exit 0 (the declined case raced the settings read); after the test waits for the second question, exit 1: "shows the features that are on …" |
| M3    | the question is not attached to the backend (every use denied) | exit 1: both use cases                                                                                                                                 |
| M4    | the daily limit line states a limit the person did not set     | exit 1: both use cases                                                                                                                                 |
| M5    | a change of the features on does not replace the backend       | exit 1: "shows the features that are on …" (no new surface)                                                                                            |

`dist/runtimePanelSession.js` is 98.7 KiB of its 120 KiB row; the gate and the
tally are int's own `paidFeatures.ts` (11.8 KB of it).

## Slice 5b — review, export and import, unsaved files

What a person gets: `/review` reads git's material through the editor's
picker and a Revert or the diff of an edit works through the editor's diff
(the original side is a file of the data folder, removed with the
conversation); Revert refuses a file the editor holds unsaved, and a file it
removes is kept in the data folder's `trash/`; exporting a conversation goes
through the editor's save dialog, a portable export's redacted preview opens
in the editor before the person chooses what to save, and importing reads the
file the person picks, whole. The files the editor holds unsaved reach the
backend's tools, which leave them alone (D27).

Suites: `runtimeReview` (6) over a real git repository and a real connection;
`runtimeTransfer` (4); `runtimePanelSessions` gains the unsaved-files case.
That `backends.ts` hands the function to the tool IO is by typecheck: a
file-writing tool call needs a model turn, which no suite here makes.

| Drill | Break                                                   | Result                                                                      |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| V1    | the editor's unsaved text is ignored by a Revert        | exit 1: "puts the file back only while … never over unsaved text"           |
| V2    | a removed file is deleted instead of moved to the trash | exit 1: "keeps a file a Revert removes in the data folder's trash"          |
| V3    | the diff's original side is the file as it is now       | exit 1: "shows the editor the file before the edit …"                       |
| V4    | `/review` goes on after the conversation is let go      | exit 1: "answers nothing once the conversation is let go"                   |
| V5    | the editor's pick of a commit is ignored                | exit 1: "asks the editor which commit …"                                    |
| X1    | the export preview file is not removed                  | exit 1: "opens the redacted file in the editor before asking …"             |
| X2    | a closed preview dialog saves the redacted file         | exit 1: same case                                                           |
| X3    | invalid UTF-8 read lossily                              | exit 1: "reads the file the person picked …"                                |
| X4    | any answer imports                                      | exit 1: "imports only on an explicit yes"                                   |
| U1    | the dirty flag is ignored                               | exit 1: "reaches the backend, so the model's tools leave those files alone" |
| U2    | the backend is given no function                        | exit 1: same case                                                           |

`dist/runtimePanelSession.js` is 110.6 KiB of its 120 KiB row: git and
checkpoints do not fit in it and go in a lazy chunk of their own.

## Slice 5c — git and pull requests

What a person gets: the git buttons of the chat (commit form, commit, push,
pull requests) work in the workspace's repository, which is git's toplevel
of the workspace folder (a workspace that is one folder of a repository works
on the whole repository, its files named from the root). A push asks in the
editor first (`ui/confirm`: the remote and its masked URL, the branch and
its target, the commit count, never a force, that hooks and credential
helpers run), and a closed question is a no. A push git itself could not
finish opens the same command in the editor's terminal (`terminal/create`,
`terminal/show`). A workspace the editor does not trust runs no git (the
service's own refusal, in words). A workspace in no repository, or a machine
with no git program on the PATH, says which in the panel (two new strings in
all fifteen tables) instead of showing VS Code's wording.

How: `openPanelGit` (`src/runtime/panel/git/panelGit.ts`) lives in the
existing `dist/nativeGit.js` (97.7 of 125 KiB), loaded by the session through
`panelGitLoader`; it builds int's `RuntimeGitDeps` over MHP and calls
`createRuntimeGit`. The session builds it once per connection, before the first
conversation (and again for a conversation if the workspace has since become a
repository). The connection has one `GitHubSignIn` over the device flow and the
opt-in `gh` login (`src/runtime/github/githubSources.ts`, now shared with VS
Code's window, which adds its editor session in front); `useGhLogin` is read
from the machine-scoped setting, so a workspace cannot switch it on. Pull
request links are the workspace storage, through the same `PullRequestLinks`
VS Code uses (`pullRequestLinkStoreOf`). The push question's words are one
function (`pushConfirmationText`) for VS Code's modal and the panel.

Not in the panel: a pull request's held worktree (`worktreeState` is empty,
`confirmWorktreeTrust` does nothing, no card shows a hold) and the checkpoints'
admission of commit and push hooks (no checkpoint store exists in the panel
yet). Not proved here: the GitHub half (the device flow and `gh` need the
network and the machine's credential store, which a suite cannot answer for;
the adapter's own suite `nativeGitPullRequests` covers the flow) and
`workspace/openFolder`. VS Code's `gitWindow.ts` and `githubSession.ts` were
refactored onto the shared pieces (pure moves; the VS Code integration suite
was not run here).

Suites: `runtimePanelGit` (6) on real repositories, a bare remote of the
suite's own and the real `dist/nativeGit.js`; `runtimeSettingsStore` gains the
`gh` setting's scope; `pathGuardSpawns`' record names `githubSources.ts` where
the `gh` start now lives (that suite has one failure that is the same on the
base: unreviewed starts under `src/runtime/node/`, not this lane's).

| Drill | Break                                                      | Result                                                          |
| ----- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| G1    | any answer to the push question pushes                     | exit 1: "asks before it pushes … only on a yes"                 |
| G2    | the editor's trust is ignored                              | exit 1: "does nothing in a workspace the editor does not trust" |
| G3    | the repository is the workspace folder, not git's toplevel | exit 1: "works on the repository around a workspace …"          |
| G4    | git's "not a repository" is not told apart from a failure  | exit 1: "says why there is no Git …"                            |
| G5    | the terminal is given an environment                       | exit 1: "opens a push git itself could not finish …"            |
| G6    | the `gh` setting can be set by a workspace                 | exit 1: "keeps a machine-scoped setting the person's alone"     |
| G7    | the push question leaves out that a force is never made    | exit 1: "asks before it pushes, names every part of the push …" |

## Slice 5d — Ask again, saved plans, tool output tabs, sign-out words

What a person gets: Account & usage's "Ask again" makes every paid feature
ask again (the badge and toggles show it at once). Plans… lists the saved
plans (`.agents/plans/`) in the editor's pick and opens one or implements it,
and a plan from Plan mode saves after the one yes `.agents/` needs. A tool
row's "open output" shows the whole text in an editor tab (a file of the data
folder, removed when the connection ends). Sign out, which only the person can
do where the sign-in is kept (the stored key, Muse Code's own login), is said
in words with the two commands instead of "That did not work".

How: `AcpPaidUse.forget` (the ACP agent never calls it) drops the folder
consent's held answers and lapses each feature's Always; the grants file keeps
one generation per feature, so Ask again lapses Always in every folder, as
turning a feature off already does. Plans are int's `createPlanFiles` over
`createPlanIo`, built inside the new `dist/runtimePanelPorts.js` (22.6 KiB, row
30 KiB; it is where the checkpoint store goes) and reached through
`lazyPlans`; the plan reader (`planMarkdown.js`) and the Plans… list
(`commands.js`) are int's own chunks, now in the ACP package list. The session
bundle is 113.3 of 120 KiB. No checkpoint exists in the panel, so a plan save
records no edit.

Suites: `runtimePanelSessions` (14), with a real `PlanStore` writing the plan
the panel then lists, and the editor's pick and open answered as an editor
would. `runtimePortableBundles` also loads `nativeGit.js`,
`runtimePanelPorts.js` and `commands.js` without the `vscode` module.

| Drill | Break                                         | Result                                                             |
| ----- | --------------------------------------------- | ------------------------------------------------------------------ |
| D1    | the tab's file is written empty               | exit 1: "shows a tool row's full output in a tab …"                |
| D2    | the files are not removed with the connection | exit 1: same case                                                  |
| D3    | the editor's pick is ignored                  | exit 1: "lists the saved plans in the editor's pick …" (times out) |
| D4    | Ask again leaves Always in the grants file    | exit 1: "asks again for every feature when the person says so"     |
| D5    | the sign-out refusal is the generic failure   | exit 1: "says how to sign out …"                                   |
| D6    | Ask again does not tell the surfaces          | exit 1: "asks again …" (times out)                                 |

## Commits

| Commit       | Slice                                                    |
| ------------ | -------------------------------------------------------- |
| `c17faa0c2a` | slice 1: settings and storage store                      |
| `f432fac54d` | slice 2: the controller registry, ACP over it            |
| `097aba7b42` | slice 3 (work in progress): `panel --stdio`              |
| `a26bb6a23`  | slice 3 proven, with the drills                          |
| `9d44d6774`  | slice 4a: the conversation bundle loads without `vscode` |
| `3c61b9a1a`  | slices 4b–5a, 7a: the chat in `panel --stdio`            |
| `1081aca0e`  | slice 6: paid use in the panel                           |
| `728a52409`  | slice 5b: review, export and import, unsaved files       |
| `40106f850`  | slice 5c: git and pull requests in the panel             |
| (this)       | slice 5d: Ask again, plans, output tabs, sign-out words  |
