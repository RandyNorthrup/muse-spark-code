# RVACPTEAM — Independent review of RLF-ACPTEAM

Branch `rv/acpteam`, worktree on `linuxlt`. Reviewed `rec/rlf-acpteam` at
`57004781c` (11 commits on int/recovery `0a5ebd718`). Nothing in that
range had had an independent read. The review made **no Muse request
and no paid call**. The packed `dist/acp.js --team` run was not
retried: the source lane's real run stopped at `session/new` with 0
generation requests, and it stays on the waiting list
(`docs/certification/rlf-acpteam.md`).

Fix commit: `1828517da` (`fix(acp): isolate team sessions and tell an unfinished task honestly`).

## 1. Findings

| Sev | Where                                                                                                                   | Scenario                                                                                                                                                                                                       | Result                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `src/acp/acpTeamEntry.ts:379` (`showTreeTo`) and `:307` (`showDiff`)                                                    | Two ACP sessions in one folder share one team. Before the fix, every session received every task's brief, plan, tool call, report and diff.                                                                    | Fixed in `1828517da`. A session is sent only the tasks whose `sessionId` is its own (`taskSession` on the host service and the binding). An unknown owner is not broadcast.                                                                                             |
| P1  | `src/core/team/teamHost.ts:3017` (`stopSessionTasks`); `src/acp/acpTeamEntry.ts:832` (`cancel`) and `:732` (`askMerge`) | Cancel and close stopped only a running or queued task. A finished task waiting on Merge kept its copy. A Merge answer that arrived after cancel landed in the repository.                                     | Fixed in `1828517da`. Cancel, close and agent shutdown bump the session's card epoch before any await, then stop a waiting merge and any copy that session still holds (a merge already applying is left to finish). A late answer is not applied. The copy is removed. |
| P1  | `src/acp/acpTeamEntry.ts:466` (`acpFinishStatus`)                                                                       | A restored worker whose report status was `capped` was labelled `done` on the tree and `completed` on the ACP tool call.                                                                                       | Fixed in `1828517da`. ACP `completed` is only a `done` report on a done or merged task. Any other report, including `capped`, is `failed`, and the report text is the call's content.                                                                                   |
| P2  | `src/acp/acpTeamEntry.ts:588` (`sayUnanswered`); `src/shared/l10n/en.ts` `acpTeamUnanswered`                            | The editor's permission request threw (the client cannot answer). The merge was discarded and the log recorded it. The session said nothing.                                                                   | Fixed in `1828517da`. The session says "The editor did not answer, so this team step was refused." (English and all 14 tables) and then discards. An explicit Cancel does not get that sentence.                                                                        |
| P3  | `src/acp/acpTeamEntry.ts:566`                                                                                           | `showCard`'s catch sends `error.message` as a session chunk. A product sentence (`teamTaskUnknown`, a merge refusal) must stay visible. An unexpected message could still carry a path.                        | Open. No real throw in this review produced a secret, and a stand-in error is not a proof.                                                                                                                                                                              |
| P3  | `src/acp/acpTeamEntry.ts:336`                                                                                           | Board writes chain on `this.writes`. A rejected write fails the later ones. A crash can leave `team-board.json.new`.                                                                                           | Open. Not hit by the suite.                                                                                                                                                                                                                                             |
| P3  | `src/acp/acpTeamEntry.ts:127` (`asTeamRefusal`)                                                                         | A stored-team error is branded when its message equals a known template or starts with that template's head (the text before `{`). A short head could brand an unrelated error.                                | Open. The current templates' heads are the product's own sentences.                                                                                                                                                                                                     |
| P3  | `src/acp/acpTeamEntry.ts:154` (`fileBytes`)                                                                             | The stored-team reader loads the whole file, then slices to the caller's bound.                                                                                                                                | Open. Robustness, not a cap on the person's work.                                                                                                                                                                                                                       |
| P3  | `src/host/teamHostBinding.ts:457`                                                                                       | `dispose` does not pass `waitForWorkers`. `WorkspaceTeam.dispose` now stops each session's tasks first, which removes a waiting copy. An in-flight worker process is aborted with the service and not awaited. | Open. The suite's cancel path awaits `stop`, which awaits the task's own finish.                                                                                                                                                                                        |

## 2. Reviewed, and holding

- The team MCP token is not given to the ACP client. A forged bearer is refused with 401 (the source suite, still green here).
- `collect`, `cancel` and `merge` refuse a task whose `sessionId` is not the caller's (`ownTask`). The scheduler's own cancel is an internal port.
- A permission answer whose option id is not `merge` does not land. Bypass still auto-merges, which the ACP guide states and the source lane certified.
- An admission refusal is the product's sentence as a JSON-RPC invalid request (`-32600`), not `-32603`.
- Changing the Team config option mid-session refuses in words.
- `maxWorkers` is `availableParallelism()`, the same value the panel and headless exec use. It is not a new cap, and it was not removed. The per-task request ceilings in `teamEnginePorts.ts` pre-date this lane and were not removed. D121 as clarified on 2026-10-23: no cap of ours on the person's work; a retry or wait that exists to survive an error keeps its industry-standard limit. This review did not find one this branch had deleted.
- A client-sent role is parsed and an unknown role is refused. The worker's model is the stored entry, not a field of the ACP request. The worker's directory is the trusted ACP workspace, fenced by `assertWorkerRoot`.
- Diff text is read with `git show` inside the task copy. A real git repository does not store a `..` path. No stand-in diff was added.
- Engine workers are Model API sessions. `canRunKind` is engine-only, so a Muse Code or external entry is not dispatched. The orchestrator uses the model the person selected for the session. A worker therefore does not send a Muse request, and an unknown-tier Muse id (`muse-wonder-1.0`, a plain id) is not a path this team starts. No product gate was added that would reject a legitimate Model API catalogue id. No live request was made to check it.
- `docs/acp.md` and the changelog say what this suite proves. They do not say the packed run passed.

## 3. Red/green drills (2026-11-02, this rig)

Repository timeout only (no `--testTimeout`). `--maxWorkers=2`.

Before the product change, the four new cases against `57004781c` failed together: exit 1 (the other session contained `fix the bug`; the copy still existed after cancel; the unanswered sentence timed out; the capped call timed out).

| #   | Guard                                     | Break                                                                                     | Red                                                          |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | One session cannot see another's tasks    | `showTreeTo` stopped filtering by `taskSession`                                           | exit 1. The other session's updates contained `fix the bug`. |
| 2   | Cancel drops a waiting merge and its copy | `stopSessionTasks` went back to running and queued tasks only                             | exit 1. `existsSync(copyFolder)` stayed true.                |
| 3   | A non-`done` report is not `completed`    | `acpFinishStatus` reported `completed` unless the tree status was `failed` or `cancelled` | exit 1. Timed out waiting for the capped task's failed call. |

Each file was restored with `git checkout --` of that path. The restored suite then passed: `npx vitest run test/unit/acpTeamSession.test.ts --maxWorkers=2`, 12 passed, exit 0. The same 12 had passed on the fix before the commit (exit 0).

## 4. Gates

Filled in after the gate run on this rig. A gate that fails or is skipped is named as such.
