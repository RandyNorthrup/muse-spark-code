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

| Slice | Commit        | What                                                                                                       | Proof                                                                                                                                       |
| ----- | ------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `c17faa0c2a`  | `src/runtime/settingsStore.ts` over the runtime's own settings files                                       | `runtimeSettingsStore` 12/12; drills S1–S3 fire, S4 not caught (why below)                                                                  |
| 2     | `f432fac54d`  | `src/runtime/panel/controllerRegistry.ts`, AgentState delegating; ACP turns untouched                      | `acpSessionRegistry` 2/2; drills R1, R2 fire; int's ACP suites 228/230 (2 = int's own)                                                      |
| 3     | (this commit) | `panel --stdio` (dist/runtimePanel.js): handshake, settings, storage; wire.js shares the two panel schemas | `runtimePanel` 9/9 on the production build; drills P1–P6 fire (below); `wireEntry` 2/2; fixed: a fatal close left the process alive (below) |

### Next step, exactly

Slice 4 onward (below). Slice 3 is proven (its section at the end), the
rig-specific facts are in "Rig notes".

### Slices left, in order, with the intended design

4. **The runtime conversation (`RuntimeConversation`, RLM104
   `runtimeController.ts`).** `ConversationController` runs in the panel
   process through `conversationLoader(...).createConversation(deps)`, one
   per session, held by slice 2's `ControllerRegistry` (the same class ACP
   uses). Prerequisite found on int: `conversationEntry.ts` imports
   `../vscode/questions/questionStore` at runtime (it imports `vscode`), so
   the conversation bundle cannot load outside VS Code until
   `questionClock`/`questionsDeferAfterSeconds` come from a portable module
   (RLM104 moved `questionClock` to `questions/questionStorage` and passed
   `deferAfterSeconds` in). The controller additions RLM104 needed
   (`modelAllowsFeature`, `onSessionAttached`, `replayHistory`,
   `startFreshSession`, `selectedModelId`) must be re-applied to int's
   13,960-line controller by hand; `arePermissionsExternal`,
   `submitParts`, `useExternalPermissionMode` were for ACP-on-controller and
   are **not** wanted (item 2 keeps ACP's own turns).
5. **Shared composition (`src/host/compose/conversationDeps.ts`) and
   `src/host/vscode/hostServices.ts`.** int's `ConversationDeps` has about
   120 members (RLM104's base had fewer: int added playbook, judge uses,
   team MCP, orchestrator slot, bookmarks, sequences, legal fixes, estimator
   generation and more). extension.ts composes them inline at about lines
   4967–5470. The design: move that mapping into `composeConversationDeps`
   (editor-agnostic, `HostServices` for async editor actions) so VS Code
   and the runtime share one copy; VS Code's behaviour must not change
   (typecheck, the unit suites, and the integration suite inside VS Code,
   which was never run on this PC). Then `src/runtime/features/**` supply
   the runtime's ports (RLM104 had 24 modules, about 3,100 lines: auth,
   checkpoints, codeIntel, editReview, git, hooks, judge, mcp, paidUse,
   review, tab, verify, voice, webFetch, worktrees...), each against int's
   current interfaces, each an honest refusal where the host lacks the
   capability (MHP `unsupportedCapability`), never an empty success.
6. **Paid use in the panel (D48, D208).** Compose int's `PaidUseConsent`
   exactly as `src/acp/paid.ts`'s `AcpPaidUse` does: the question asked
   through MHP `ui/confirm` with D48's three answers, keyed grants in the
   runtime's own grants store (`runtime/paidGrants.ts`, shared with ACP),
   and **no spending check, reservation or ledger read unless the person set
   a limit** (session budget, `paidDailyBudgetUsd`, an agent budget). The
   daily budget is the one in the data folder's `settings.json`, which is
   exactly the file slice 1's store writes, so the panel and ACP state the
   same budget. RLM104's `features/paidBudget.ts`/`paidRequest.ts`/
   `paidUse.ts` and its `paidConsent.ts`/`paidFeatures.ts` diffs are the
   pre-D208 path: do not port them; drop RLM104's `paidGrants.ts`
   revocation lane (int's `isAnswerCurrent` already refuses a revoked
   question, cc-rlm104 "Dropped as duplicates").
7. **Chat surfaces over MHP** (RLM104 `surfaces.ts`, `uiRequests.ts`,
   `delivery.ts`'s per-surface readiness and drop): `surfaces/open`, panel
   envelopes admitted with `parseMhpPanelEnvelope` (sequence, readiness,
   binding), the runtime-to-host request path with correlation and
   `$/cancelRequest` (no deadline of ours: a consent question waits for the
   person). Slice 3's connection refuses every panel envelope with
   `MHP_PANEL_UNKNOWN_SURFACE` and asks the host nothing; both grow here.
   `panelEventId` and the presentation types return with their readers.
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

## Commits

| Commit       | Slice                                         |
| ------------ | --------------------------------------------- |
| `c17faa0c2a` | slice 1: settings and storage store           |
| `f432fac54d` | slice 2: the controller registry, ACP over it |
| `097aba7b42` | slice 3 (work in progress): `panel --stdio`   |
| (next)       | slice 3 proven, with the drills               |
| (this)       | the handoff above                             |
