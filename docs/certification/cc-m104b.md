# cc/m104b — M104 lane B on int/recovery: the runtime panel

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

## Commits

| Commit       | Slice                                         |
| ------------ | --------------------------------------------- |
| `c17faa0c2a` | slice 1: settings and storage store           |
| (next)       | slice 2: the controller registry, ACP over it |
