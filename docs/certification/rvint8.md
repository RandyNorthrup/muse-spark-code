# RVINT8 — independent review of join round CC-INT8 (2026-10-31)

Grok review lane, worktree `/Users/randy/lanes/RVINT8`, branch `rv/int8`, on
the test rig `macmini`. Started at `cc/int8` `810b320fc` (record
`docs/certification/cc-int8.md`). Reviewed the join of cc/int6 (`339c1ec95`)
and cc/int7 and every first-parent `fix(int):` commit through `810b320fc`,
the MHP re-freeze to `mhp/1.5.1`, the merged security fixes, and the
CHANGELOG, README and ROADMAP claims. Model attempts: **0**. Provider
calls: **0**. Muse requests: **0** (the allowance is out until
2026-11-02T00:00:00Z). Nothing was pushed, rebased, stashed or tagged. No
credential was read. Tests used the repository's own timeout and
`--maxWorkers=2`. The vault suites (`test/unit/vault/**`) and the OS
credential-store suites were not run.

## Findings

### P2 — fixed in `ba81e195f`

`src/acp/agent.ts` (the outbound gate, `quotaOutboundSentence` at the
committed lines that follow `outboundTemplates`). The spent-window sentence
was an open prefix/suffix template. Any text between "Subscription quota
exhausted. Your usage window resets at " and the final period left on the
ACP wire. The recorded provider line
(`test/fixtures/musecode-quota/observed-acp-error.json`, request id
`e7eccfac-6e60-4252-8972-babf4e1d672e`), placed where `{resetTime}` goes,
left with that id. The sentence now leaves only when it is exactly the
sentence `quotaTurnFailureText` builds from the structured `resetsAt` (or
that sentence after an SDK prefix). The typed code and the structured
`resetsAt` stay. Anything else becomes `UI_TEXT.actionFailed`.

### P3 — fixed in `16fd2495d`

`CHANGELOG.md` `[Unreleased]` claimed the ACP agent maps team tools and
takes `--team` (the two bullets that followed the headless `exec --team`
hedge). `teamSessionAdmission` (`src/acp/teamAdmission.ts`) has no
production caller. `teamExecAdmission` is what headless `exec --team` uses
(`src/runtime/exec/execArgs.ts`). ROADMAP M96b already says the ACP agent
does not run teams yet (`docs/roadmap/entries.json`). Those two bullets are
withdrawn. The hedged headless `exec --team` bullet stays: it says the run
is off until certified, and that code exists.

The same commit corrects the `museSpark.museCodeQuotaContinue` bullet. It
read as if the wait were the default and as if Retry always showed. The
wait runs only when the setting is on
(`conversationController.ts`, `holdForQuotaReset`). Retry is attached only
when `event.retryable === true` (`src/webview/state/uiState.ts`,
`completeTurn`). The bullet now says that.

`README.md` (the paragraph that began "Local headless `exec --vault`")
described the packed command as ready. The record says that run is unproven
(`docs/real-life/unproven.md`, Lane RLF-M109; `docs/certification/rlf-m109.md`
section 7). The guide now says the command is built and has not been proved
through the packed product. The companion sentence about public panel state
is unchanged. No text-existence test was added.

### P3 — open, schema prose still says `mhp/1.5.0`

`scripts/mhp-schema.mjs` lines 113, 144 and 164 still say the runtime
returns and selects `mhp/1.5.0`. Those sentences are copied into
`src/shared/hostApi/mhp-v1.schema.json` and `mhp-v1.1.schema.json`. The
negotiated const is `mhp/1.5.1` (`src/shared/constants.ts`, `MHP` and
`MHP_PANEL`). `selectMhpVersion` returns `MHP.version` only when the offered
range contains it. A range `[mhp/1.5.0, mhp/1.6.0)` still selects
`mhp/1.5.1` (`test/unit/mhpPanelContract.test.ts`). D226 says the v1.1 lock
was re-frozen once, on CC-INT8, and `--adopt-version` refuses a lock already
at `mhp/1.5.1`. This review does not re-freeze. The next protocol revision
should correct the three generator strings and regenerate the schema, the
lock and the hosts together. No in-repo native host pins `mhp/1.5.0`. The
portable page speaks wire version `1.5` (`MHP_PANEL.wireVersion`).

### P3 — open, the CC-INT8 record's D250

`docs/certification/cc-int8.md` says D250 is RLF-ORCHEXT's. PLAN.md has no
`### D250` heading. D229 is still only RLF-MUSESETUP. D251 is teamfit and
D252 is quota, and the source comments that this round renumbered say those
numbers. Not a product bug. Not rewritten here.

### P3 — open, `9affc5e78`'s message

The notices commit says mime-db left every shipped bundle. CC-INT8 already
records the right reason (the lock moved the top-level package; the other
variants stay, and `dist/meta/connectorRemote.json` still carries mime-db).
The message was not rewritten. Rewriting it needs a rebase, which this lane
does not do.

### P3 — open, `acpUpdateNotSent` inside `vitest related`

`test/unit/acpUpdateNotSent.test.ts` warns when a session update cannot be
sent (`src/acp/agent.ts`, `deliver`'s catch). Run alone it passes in about
55 ms, on this tree and on `src/acp/agent.ts` at `810b320fc` (the quota
gate is not on that path). Run after each other file that `vitest related`
selects, in its own vitest process, it passes. Inside
`npx vitest related src/acp/agent.ts --run --maxWorkers=2` it fails: the
200-turn poll gives up (exit 1, twice, about 310 ms, "the unsent update was
never warned"). A four-second wait, tried and then restored so the file
matches the join, still saw no warning (exit 1, about 4.1 s) and would not
fit the repository's 5 s timeout with margin. The warning site is unchanged
by this lane. Left open. The related gate's exit code below is this failure.

## What was checked, and is not a finding

Twelve first-parent merges, `339c1ec95..810b320fc`. No source file unique to
one parent was dropped except deletions that parent already made and the
other parent had not touched (`subscriptionFile.ts` by RLF-NOSTUBS;
`macosRecording.test.ts` by the M105 recorder bind). Declared symbols missing
from a result were moves, not lost behaviour: `SessionClaim` lives on the
controller registry (`releaseAll` included); `describeForLog` is
`failureForLog` and the side-chat refusal is still logged;
`PLAYBOOK_JOB_ENVIRONMENT` and `PLAYBOOK_JOB_KILL_ON_CLOSE` are the native
helper's `Environment.Clear` and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
(`native/windows/MuseSparkJob.cs`); `listed` in the webview archive check
is `readZip` from the packager, which still requires the archive members and
rejects loose webview files. Combined diffs for the conflicted sources keep
both sides (build bundles, `MuseCodeHost` hardware guard and stage waiters,
runtime secrets and the maker store, deferred-bundle and ui-text regions,
team retire-by-decision at D251, `toolIo` curl exit and the governed hook
launcher, `createdNative` developer dir and cwd, the LSP `answer` wrapper
and position, `museReplay`'s combined `startLiveHost`). No `fix(int):`
commit made a refusal silent, added a cap of ours, or removed a retry, CAS
or sweep limit.

MHP structural contract since the 1.5.0 lock, as CC-INT8 measured and this
read confirmed: the version, and the optional `quota` object
`{limitKind, resetsAtMs}` on `turnCompleted` and `turnRetry` in the panel
envelope and `embeddedBridge.onMessage`. Required arrays unchanged.

Security as merged, read on this tree:

- RVTEMPLEAK: Darwin `native/darwin/MuseSparkCreated.c` `remove` finishes a
  quarantine it can prove and refuses a different directory. The Windows
  twin in `MuseSparkJob.cs` does the same. `isCreatedTreeCreatorGone`
  (`src/core/resources/createdOwner.ts`) returns false without machine, boot,
  namespace and exact birth.
- RVM109: POSIX policy read and write go through `readVaultFile` and
  `writeVaultFile` (`src/runtime/vault/vaultPolicy.ts`). The Windows read
  still follows links; the file says so (no `O_NOFOLLOW`) and names the pipe
  directory's DACL as the guard. Not a join regression. Not re-tested here:
  the vault suites were not run.
- `feederProcessEnvironment` (`src/host/vault/vaultExecSpawn.ts`) copies
  `XDG_RUNTIME_DIR` only when `path.posix.isAbsolute` says so.
- CC-WINPATH: the job assembly is
  `DefaultDllImportSearchPaths(System32)`. `RestrictDllSearch` runs before
  `worker`, `run-team` and `Main`. `windowsJobHost` (`src/core/execGuard.ts`)
  gives `PATH` empty and `cwd` the helper's own folder, and refuses a
  non-absolute assembly or system root. Every caller found
  (`playbookWindow`, `containedJob`, `resourceJobHolder`, `processLifetime`,
  `processTree`, `resourceGovernorEntry`, `trees/windows`, `workerOps`)
  passes `host.env` and `host.cwd`.
- ACP quota data: `outboundData` copies kind, an allow-listed reading,
  `requestSent`, `retryable`, a parseable `resetsAt`, and `museSpark.usage`
  only after `acpUsageSnapshotSchema` (strict). It does not copy `requestId`
  or `limitKind`. `toOutbound` is what `respond` sends. The P2 above is the
  hole that remained in the sentence.
- `scripts/check-webview-archive.mjs` uses `readZip` and `isEntryPoint`. No
  `unzip`, no `pathToFileURL`. CC-INT8's resolution stands.

D49's amended text (PLAN.md, "The browser check reaches only the origins the
person lists") matches `placeBrowserUrl`: non-public hosts are refused unless
the origin is one the person listed, and the maker companion ports are
refused. M109's two withdrawn CHANGELOG lines are still absent. The ROADMAP
ACP-teams sentence is the corrected one.

`follow-redirects` is pinned at 1.16.2 and is not in the lock. CC-INT8
recorded that as intentional. Not a finding.

The English table's `MuseΓÇÖs` mojibake in `turnTransientFailed` is from
`f0ee2638c` (before this join). Not changed here.

No PLAN.md status line was added. No milestone's truth changed beyond the
claims corrected above, which the existing CC-INT8 statuses already state.

## Red/green drill

The quota gate, on `test/unit/acpTurnFailure.test.ts`, repository timeout,
`--maxWorkers=2`.

Broke `quotaOutboundSentence` so any message left once `resetsAt` parsed.
`npx vitest run test/unit/acpTurnFailure.test.ts --maxWorkers=2` exited **1**.
12 tests, 1 failed: expected `That did not work (the Muse Spark log has the
details)`, received the planted sentence containing
`request_id=e7eccfac-6e60-4252-8972-babf4e1d672e`. Restored `src/acp/agent.ts`
byte-exact (`git hash-object` matched the HEAD blob `45d08ad30`). The same
command exited **0**, 12 passed.

## Gates

Every command ran in this worktree. `npm run check:cycles` is not a script;
the cycle gate is `npm run cycles`.

| Command                                                                                                       | Exit                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npx prettier --check` on `src/acp/agent.ts`, `test/unit/acpTurnFailure.test.ts`, `CHANGELOG.md`, `README.md` | 0                                                                                    |
| `npx eslint --max-warnings 0` on the two TypeScript files                                                     | 0                                                                                    |
| `node scripts/check-l10n.mjs`                                                                                 | 0 (0 problems)                                                                       |
| `npm run check:reference`                                                                                     | 0                                                                                    |
| `npm run check:host-api`                                                                                      | 0                                                                                    |
| `npm run check:plan`                                                                                          | 0                                                                                    |
| `npm run check:roadmap`                                                                                       | 0                                                                                    |
| `npm run check:catches`                                                                                       | 0                                                                                    |
| `npm run typecheck`                                                                                           | 0                                                                                    |
| `npm run duplication`                                                                                         | 0 (0 clones)                                                                         |
| `npm run cycles`                                                                                              | 0                                                                                    |
| `npm run deadcode`                                                                                            | 0                                                                                    |
| `npm run build`                                                                                               | 0 (budgets held; not raised)                                                         |
| `npx vitest run test/unit/acpTurnFailure.test.ts --maxWorkers=2`                                              | 0 (12)                                                                               |
| `npx vitest related src/acp/agent.ts --run --maxWorkers=2`                                                    | **1** (15 files passed, `acpUpdateNotSent.test.ts` failed; see the open P3)          |
| `SSL_CERT_FILE=/etc/ssl/cert.pem SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`                        | 0 (0 findings; semgrep also printed its segfault-handler warning and still finished) |
| `npm run security:audit`                                                                                      | 0 (2 moderate notes, 0 exceptions)                                                   |

Electron and Chrome were not started (a macOS lane cannot). The build above
is the tree of `16fd2495d`, before this record. This record is markdown only.

## Commits

| SHA         | Subject                                                      |
| ----------- | ------------------------------------------------------------ |
| `ba81e195f` | fix(acp): a request id cannot ride inside the quota sentence |
| `16fd2495d` | docs(int): unreleased claims match what this tree proves     |

Nothing was pushed. Base of the review: `810b320fc`.
