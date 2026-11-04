# CC-SMALL3 — a batch of small, already-diagnosed fixes on the integration head

Lane `CC-SMALL3`, branch `cc/small3` from `f572397f23`, on the owner's Windows PC, with a throwaway Linux checkout in WSL for
what only POSIX can show. Nothing pushed. No Muse request, no paid call, no real `muse`, `MUSE_TEST_REAL_CLI` unset, no vault or
credential-store file run or imported, no budget or timeout raised. Every vitest run named its files through `temp/small3/vt.ps1`, which
refuses those names, with `--maxWorkers=4`. Team landing code is another lane's and was read, not changed. `GIT_CEILING_DIRECTORIES` was
set for the runs; the temporary folder stayed outside the worktree.

| Item                                    | Outcome                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Dead Stop on the maker review page   | Fixed, and a worse form of it found and fixed: the Stop was on six documents that can never answer it. `4b7dbc192c`                   |
| 2. A wonder id labelled standard        | Already fixed on this head (`1cf3819710`, RLF-WONDER). Nothing to do                                                                  |
| 3a. Intermediate symlink in a recording | Fixed. `23b5e05aaf`                                                                                                                   |
| 3b. Failed questions-count publish      | Fixed, and a real stale-count fault found in it. `23b5e05aaf`                                                                         |
| 3c. The endpoint pin says a code        | The code the record names is gone; its successor reached the sentence as raw schema JSON. Fixed. `23b5e05aaf`                         |
| 4. RVACPTEAM's five P3s                 | All five fixed, one of them a real fault under the P3 label. `2c7b3c2731`, `6e60baacf7`. The headless board has the same chain; named |
| 5. Per-server always load               | Built, words in all 14 tables. `eed5d4e5fa`. No headless flag; not used in the packed product; named                                  |
| 6. The `supervise` edge                 | The sighting did not reproduce. What does leave a page serving is fixed, on measured numbers. `689cae2189`                            |

## 1. The Stop on the maker page

**Cause.** `html.ts` paints a Stop that has no handler until `listenForMaker` runs. A click in that moment did nothing and said nothing
(`cc-int11fix6.md`: `load` at 38 to 65 ms here, longer on a slow machine).

**The choice: disabled until live, not a script ahead of the bundle.** Disabled is one attribute and one line. It adds no inline script
to every chat panel, keeps the protocol's one speaker and `acquireVsCodeApi`'s one caller (it may be called once, so an early script would
have to own the API and hand it to `vsCodeHostBridge` on a global), and it is true in every state, including a bundle that never comes:
the person sees a Stop that cannot be pressed, not one that seems to work. The status bar's Stop (`vscodeMakerHost.ts`) does not depend on
the page and stays the way out in that moment. What this does not do: a press in those 40 to 65 ms still stops nothing. It says so
instead of swallowing it.

**Worse than it looked.** `buildWebviewHtml` painted the Stop on every document but `tasks`, and `listenForMaker` has one caller, the
chat's default branch of `src/webview/main.tsx`. So Devices (`mountDevices`), the maker preview, reports, usage, Models & Agents and the
judge wizard all carried a Stop nothing could ever answer, not for 65 ms but for good, and only `main.css` styles it, so on the others it
sat wherever it fell. Only the chat document paints it now (`hasMakerStop`, passed by `webviewSetup.ts`).

**Named, not changed.** The VS Code maker preview does not work at all on this head, separately from the Stop: `buildWebviewHtml` paints
no `#maker-canvas`, so `wireMakerPreview` throws `makerPreviewDocument` before it says it is ready, the page never answers
`makerApprovalPreview`, and nothing in the webview posts `makerPreviewRendered`. Removing its dead Stop leaves that page with none. The
chat's Stop and the status bar's are live. It wants a lane of its own: the host would have to paint the canvas and the labelled stops.

**The look.** `npm run ui:look -- maker-hardware-off` (light and dark) shows the surface's own Stop unchanged. No scene shows the static
one, since the harness has no host document, so one more look: the document's markup with the built `main.css`, in the captured light and
dark themes. It reads as unavailable in both:

![Static Stop disabled, light](cc-small3/static-stop-disabled-light.png)
![Static Stop disabled, dark](cc-small3/static-stop-disabled-dark.png)

## 2. A wonder id labelled standard: already fixed

`teamModelRegistry.ts:221` drops a wonder id with the reason `wonderTier`, and `museCodeWorker.ts:158` and `workerFence.ts:1051` refuse a
pool that names one, in words (`1cf3819710`, `docs/certification/rlf-wonder.md`). Line 156's `'standard'` is the engine's per-team limit
row, which Wonder shares by the documented numbers; its rates stay Wonder's. Run here: `teamWonderTier`, `teamModelRegistry`: green.

## 3. RVHOSTS2's three

**A link in a recording's folder.** `createMediaSourceOpen` skips workspace confinement for a path spelled inside the recording root, and a
spelling says nothing about where a link under it goes: `<root>/hop/secret.mp4`, with `hop` a link out, opened the outside file. It now
walks the folders with `confineToRoot`, so a link that leaves is refused and one that stays inside still opens. The final name stays as
spelled, so `lstat` keeps refusing a final link, inside or not. A root that is not there refuses without a word, as a gone file does.

**The questions count.** The record says only logged. Reading it showed a real fault too: the publisher remembered the count before the
publish, so after a refusal every later update at that count was dropped and the editor's item stayed stale until the number moved. A
refusal now forgets it, and the person is told once in `ui/notify` (`openQuestionsStatusFailed`, all 14 tables), again only after a publish
has been taken in between. A host that offers no `ui` at all stays silent, as before, because the notice cannot go there either.

**The endpoint pin.** `MHP_GITHUB_ENDPOINT_REFUSED` is gone from this head: the merge took M123's `nativeGitHub.ts`, where the method's
schema is the pin. That was no better. The schema's parse throws, and `GitHubClient` puts a failed fetch's message in the sentence the
person reads, so what they got was zod's issue JSON (drill H5 shows it). The lease now refuses first, in words
(`gitHubLeaseEndpointRefused`, all 14 tables), from one rule the schema shares (`src/shared/hostApi/githubLeaseUrl.ts`). The panel's own calls
stay on the pinned origin, so a person should never see it.

## 4. RVACPTEAM's five P3s

| P3 (`src/acp/acpTeamEntry.ts`) | What was there                                                                                                                                                                                                                                       | Now                                                                                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `asTeamRefusal`                | **A real fault.** "A short head could brand an unrelated error": `teamRunnerUnavailable` opens with `{tool}`, so its head is empty, and every error starts with that. Any failure of a team start went to the editor as a refusal, with its raw text | A refusal is the whole template with its slots filled (`isFilledTemplate`). Drill T2 is the old rule going red on a board that cannot be read                                                                                              |
| `showCard`'s catch             | Sent `error.message`. Real landings said the bare word `unknownTask` there (`BoardRefusal`'s, masking the real failure)                                                                                                                              | A bare code or an absolute path reads as `actionFailed`; the log keeps the failure; the team's sentences still show. A raw message with neither still shows, since the merge flow's refusals cannot be told apart here without touching it |
| The board's writes             | A rejected write failed all later ones; a failed write could leave `.new`                                                                                                                                                                            | `src/acp/teamBoardFile.ts`: each write has its own outcome, the next repairs the file, a failed one removes its temporary. A crash's leftover is never read and the next write replaces it                                                 |
| `fileBytes`                    | Read the whole file, then sliced; past 2 GiB it failed outright                                                                                                                                                                                      | Reads no further than the bound. A 2 GiB + 1 byte file now gets the unreadable sentence                                                                                                                                                    |
| `TeamHostBinding.dispose`      | Did not wait for an aborted worker                                                                                                                                                                                                                   | `WorkspaceTeam.dispose` waits for them, within the 10 s a stopped process tree gets, says in the log if one is left, and goes on. The editor's own deactivate is unchanged                                                                 |

**Named.** `execTeamEntry.ts` has the same board chain and was left: a headless run's `close` reads the last write's outcome and that
path has no suite here that would show a change. **The wait has an end, and my first form did not:** `teamEnginePorts.ts:324` awaits a
worker's start before it reads the abort, so an unbounded wait could hold an editor's exit for ever. A headless run's `close` still waits
without one, as it did. That code is the landing lane's; it was read, not changed.

## 5. Per-server always load

`museSpark.modelApiMcpAlwaysLoad`, machine-scoped, an array of server names (`docs/certification/h-mcp-defer.md` explains deferral; this
closes M128's open opt-out, RSCH-CC R1). A setting of ours, not a key in the MCP settings file the Muse Code CLI shares. While the rest defer,
those servers' tools are declared first, in catalogue order and ahead of every discovery, so the prefix still only grows. The list is frozen
per turn with the threshold. `tool_search` names only the servers with tools left to load. A search that finds one says it is already
loaded and moves nothing. With every server named there is nothing to defer. A name no server has changes nothing. Words in `package.nls.json`
and all 14 language tables; README, CHANGELOG, PLAN, reference. `dist/mcpPool.js` and `dist/modelApiMcp.js` are 74.8 of 75 KiB, unraised.

**Not done, and why.** Headless runs read no settings, so `exec --mcp-defer-tokens` has no always-load beside it. **Not used for real:** a
packed-product run needs a model call, and none was allowed here. The planner runs on the real captured `tools/list` frames and the real core
tool builder, as M128's own proof does; the setting's read in `extension.ts` is by the gates only. README and CHANGELOG carry it because
rule 10 asks for a setting there; M128's real use stays open and that line may want holding with it.

## 6. The `supervise` edge

**The sighting did not reproduce.** `cc-int11.md`: "a TERM to `supervise` in its first moments can still leave the child running". On WSL's
Arch, kernel 6.18, Node 26.13, a real `dist/acp.js supervise panel --companion`, nothing left behind on the build before the fix:

| What was sent                                         | Samples      | Children left |
| ----------------------------------------------------- | ------------ | ------------- |
| One TERM across the start, 240 to 1,500 ms, fast disk | 37           | 0             |
| One TERM across the start, from `/mnt/c`              | 38           | 0             |
| The shim's order: `stop` at 0 to 400 ms, then TERM    | 21, `/mnt/c` | 0             |
| Two TERMs 5 ms apart, across the start, fast disk     | 37           | 0             |

Reading agrees: before the handlers go in, TERM's default ends `supervise` with no child yet; after, `launching` is set in the same tick,
and a stop that lands during admission or after the spawn is answered by `didStop`, then `endGroup` signals a group that exists. Two earlier
fast-disk sweeps were thrown away: the copied package lacked `l10n/`, so the child failed by itself, and a later one found WSL's `/tmp`
emptied by its idle stop. Rig `linuxlt`'s own conditions were not available here, so **why that child stayed is not known**.

**What does leave the page serving, measured on the same build:** a page that answers 200, then the signal.

| Signal to `supervise`   | Before: exit, page, left                        | After: exit, page, left      |
| ----------------------- | ----------------------------------------------- | ---------------------------- |
| TERM                    | 0, gone at 11 ms, none                          | 0, gone at 5 ms, none        |
| INT                     | 0, gone at 3 ms, none                           | 0, gone at 3 ms, none        |
| KILL                    | killed, **still answering at 15 s, child left** | killed, gone at 505 ms, none |
| HUP (a closed terminal) | killed, **still answering at 15 s, child left** | 0, gone at 1 ms, none        |
| TERM, TERM 5 ms apart   | **killed by the second**, gone at 4 ms          | 0, gone at 2 ms, none        |

One cause: the child leads its own group, so when the supervisor goes without running its stop, nothing ends it.

**The fix closes that for any moment, known or not.** A supervised run on POSIX looks for its supervisor once a second and, once it is gone,
ends its own group as the stop would, TERM then KILL after the same grace (`src/runtime/supervise/supervisorWatch.ts`). The pid travels in
`MUSE_SPARK_SUPERVISOR_PID`, read once and removed, so a command the run starts does not inherit the watch. HUP is a stop now, and a later
signal finds the stop in hand: `once` used to hand a second TERM to the default action. Windows keeps its kill-on-close job and is not
changed by the watch. **Not covered:** a supervisor that stays alive and loses its child, of which reading found no path.

## Drills

Each restored byte-exact (sha256 compared, `temp/small3/drill.mjs`) unless it says Linux, where it ran in the throwaway checkout and
`git checkout` restored it, `git status` empty. Red is exit 1 on the named case; every green is exit 0. Drills whose lines moved in the lint
round ran again on the final code (F below).

| Drill   | Break                                                                                                        | Red                                                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1      | The Stop painted live                                                                                        | `the static Stop is disabled until its handler is live`, `renders localized Stop`                                                                                             |
| S2      | `listenForMaker` never enables it                                                                            | that case, `retry reloads…`, `storage-denied reload…`                                                                                                                         |
| S3      | Painted on every document but tasks, as it was                                                               | `paints the Stop only for the document that says it wires it`                                                                                                                 |
| H1      | The recording walk removed. **First try exit 0: my break left the refusal in, so it proved nothing;** redone | `refuses a recording whose folder leads out through a link`, `expected { …(2) } to be undefined`: on Windows through a real junction, and on Linux through a symlink          |
| H2 (F)  | A refused publish keeps its count                                                                            | `says a refused status once…`: `expected undefined to deeply equal { id… }`                                                                                                   |
| H3 (F)  | Said on every failure                                                                                        | same case: length 1, got 2                                                                                                                                                    |
| H4 (F)  | Never said                                                                                                   | same case: `expected undefined to deeply equal { severity: 'warning', … }`                                                                                                    |
| H5 (F)  | The lease's guard off                                                                                        | `refuses another address in words`: the message is zod's issue JSON                                                                                                           |
| T1a (F) | The card's filter lets a bare code through                                                                   | `says a card that failed for real…`: `[ 'unknownTask' ]`; the words case                                                                                                      |
| T1b (F) | The card's filter lets a path through                                                                        | `lets a card's own words through…` on a real ENOENT and a real `git -C` failure. **First form of this test exit 0, it had no path to catch;** it was rebuilt on real failures |
| T2 (F)  | Refusal by head, as it was                                                                                   | `keeps an unrelated failure's own kind`                                                                                                                                       |
| T3 (F)  | Refusal by exact text only                                                                                   | `brands a stored-team sentence with its slot filled`                                                                                                                          |
| T4b     | The whole-file read, as it was                                                                               | `reads a stored file no further than its bound`. (T4, a cruder break, took 13 cases with it; replaced)                                                                        |
| T5 (F)  | `dispose` without the wait                                                                                   | `waits for an aborted worker`: `expected true to be false`                                                                                                                    |
| T8      | The grace does not fire. **First try exit 0: my break added a promise and left the grace running;** redone   | `goes on past a worker that never finishes`, at its 30 s                                                                                                                      |
| T6      | The chain awaits the previous write                                                                          | `fails one write alone…`, `lets a write queued behind…`                                                                                                                       |
| T7      | A failed write leaves its temporary                                                                          | the same two                                                                                                                                                                  |
| M1      | The list ignored                                                                                             | all three always-load cases                                                                                                                                                   |
| M2      | Every server named still defers                                                                              | `has nothing to defer once every server always loads`                                                                                                                         |
| M3 (F)  | The list not frozen per turn                                                                                 | `reads the list once per turn…`                                                                                                                                               |
| M4 (F)  | A search loads a pinned tool again                                                                           | `keeps an always-load server declared…`                                                                                                                                       |
| M5 (F)  | A pinned tool reads as undiscovered                                                                          | same case                                                                                                                                                                     |
| M6 (F)  | `tool_search` names the pinned server                                                                        | same case                                                                                                                                                                     |
| W1      | Linux: no watch, no HUP, `once` as it was                                                                    | `ends when a KILL…` (30.8 s), `stops in order when the terminal closes`, `lets a second TERM…`                                                                                |

## Suites

Named files only; the wrapper refuses a vault or credential-store name and none of these imports one by those names. No keyring refusal fired.

**Windows, on `6d9618eaaa`, Node 24.20:** exit 0, 28 files (26 passed, 2 skipped: `superviseOrphan` and `superviseRefusal` are POSIX only), 451 passed, 10
skipped: `html`, `makerReviewBrowser`, `recordingLatest`, `runtimePanelMedia`, `runtimeQuestionsStatus`, `nativeGitHubLeasePin`, `acpTeamSession`,
`acpTeamBoardFile`, `mcpDefer`, `teamWonderTier`, `teamModelRegistry`, `superviseGoverned`, `superviseRefusal`, `superviseOrphan`, `manifest`,
`noDefaultLimits`, `featureCatalogDetails`, `teamChunkPackaging`, `teamAvailability`, `team/teamHttpBridge`, `team/externalOrchestrator`, `runtimePanelGit`,
`runtimePanelGitLease`, `resourceForkProtection`, `mhpContract`, `mhpPanelContract`, `packagedBundles`, `lazyBundleFiles`. **Not run:** the whole unit suite,
as briefed; `acpShutdown` needs the real CLI.

**Linux, the same tree, a fresh checkout and install in WSL's `/tmp` (gone with it), Node 26.13, its own production build:** exit 0, 13 files, 198 passed, 3
skipped (Windows-only cases): `superviseOrphan` (4 passed), `superviseGoverned`, `superviseRefusal`, `recordingLatest`, `acpTeamBoardFile`, `acpTeamSession`,
`mcpDefer`, `nativeGitHubLeasePin`, `runtimeQuestionsStatus`, `html`, `runtimePanelMedia`, `teamWonderTier`, `teamModelRegistry`. Node 26 is not CI's 22, and WSL
is not a hosted runner.

**Two runs of `acpTeamSession` went red once each and could not be read.** T1's first green: `hands a refused chat turn on only for the
session…` at 3,920 ms. T8's first green: `asks for a merge with the real diff…` at 23,227 ms and `lands the change on the editor's
approval` at 20,903 ms, where each takes about 0.7 s, past Windows' 15 s case limit, while other lanes were building on this PC. None of
those cases' paths is what this lane changed, and T8's two run before the case it added. My drill runner kept only their names until then,
so **their messages are gone and their cause is not known.** (This line first said the runner "keeps everything now". It did not: that patch
had failed silently. It was really made in the next round, and `cc-int12fix.md` says so.) Every other run of the file, more than 30 on Windows
and 2 on Linux, showed no failure but the one its drill asked for. A slow PC is the likely reading, not a shown one, and hosted CI is what
will say.

## Gates

One after another on `6d9618eaaa`, the head before this record, Node 22.19.0 (CI's major; the PC's default is 24.20), nothing else
touching the tree. **Every exit is 0.** The first full pass was not: it is why two commits follow the fixes.

| Gate                                                                                                                 | Exit             |
| -------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `format:check`                                                                                                       | 0                |
| `lint`: `lint:js:main`, `lint:js:unit`, `lint:js:tests`, `lint:css`, `lint:ps` (PSScriptAnalyzer findings: 0)        | 0, 0, 0, 0, 0    |
| `typecheck`: `host`, `webview`, `desktop`, `unit`, `e2e`, `integration`, `faults`                                    | 0                |
| `check:badges`, `check:tokens`, `check:art`, `check:l10n`, `check:reference`                                         | 0, 0, 0, 0, 0    |
| `check:host-api`, `check:mhp`, `check:plan`, `check:roadmap`, `check:editor-matrix`, `check:catches`                 | 0, 0, 0, 0, 0, 0 |
| `check:usable-reply`, `check:wrap-up-request`, `check:no-output-cap`, `check:no-round-cap`, `check:workflow-scripts` | 0, 0, 0, 0, 0    |
| `deadcode`, `cycles`, `duplication`                                                                                  | 0, 0, 0          |
| `build`                                                                                                              | 0                |
| `security:audit` (2 moderate advisories noted, 0 exceptions)                                                         | 0                |

**What the first pass caught, each read and fixed, nothing weakened:** `typecheck` refused a log level in the lease suite (vitest strips types, so it had
passed). `check:host-api` moved by the three Node imports the lane added, by its `--write`. `check:catches` read the status publisher's new handler as
GENERIC, since its helper logs a stack; it logs through `failureForLog` now, and the baseline did not move. `duplication` found three clones, broken up
rather than ignored. **Budgets, none raised:** `dist/mcpPool.js` and `dist/modelApiMcp.js` 74.8 of 75 KiB (they were 74.4 and 74.3),
`dist/resourceGovernor.js` 124.8 of 125, `dist/modelApi.js` 519.5 of 525, `dist/acp.js` 434.6 of 850, `dist/acpTeam.js` 58.8 of 75, `dist/uiText.js`
119.4 of 125. On this record's own head: prettier on the record, and `check:plan`.

## Not proven, and why

- **Windows and macOS for the watch.** The orphan suite is POSIX only, and macOS was not run: only hosted CI runs it there. On Windows the job's
  kill-on-close is what it always was, untouched.
- **The original `supervise` sighting**, above.
- **The static Stop in a real VS Code webview.** Real Chrome, the document's real markup, the real `listenForMaker`, with the suite's existing
  in-page host; `npm run test:integration` was not run.
- **Always load in the packed product**, above.
- The whole unit suite was not run, as briefed. `npm run security:sast` is not in the static job and was not run.
