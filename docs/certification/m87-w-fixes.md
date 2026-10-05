# M87 integration review fixes (FIXM87W)

Scope: `RVM87W.report.md`'s P1 and both P3 findings, on `m87/int`,
starting at `59f1d7f7`. No gooey menu, status/heartbeat or composer CSS edits.

## Readiness and reuse

Read the lane brief, all common rules, AGENTS.md, M87's canonical plan,
controller/review implementation and owning tests. The existing patch capture
shapes, checkpoint lease, localized `restoreTurnRunning` refusal, controller
session fence and test harness are reused. No dependency, localization key,
suppression or production helper module added.

The native stack inventory succeeded. The feature-delivery snapshot helper
cannot validate this repository's existing PLAN format (`expected exactly one
quality-ledger fence`); its structural validation is deferred. The project plan
and certification checklist remain authoritative.

## Findings

- **P1:** Revert revalidates session and turn state after patch pages and file
  preparation waits. Its guard reaches actual write/delete admission after the
  checkpoint lease wait. Turn admission is held until Revert I/O settles;
  ordinary sends and typed shell commands cannot start meanwhile. Pending
  submissions count as running, and a turn-start epoch detects a turn that
  both starts and ends under an await. The same shared revert path protects
  code rewind; its old positive test now finishes the turn before undoing it.
- **P3, native Tasks acceptance:** PLAN status and the milestone checklist
  explicitly keep the inside-VS-Code check open: open beside the editor,
  receive its task list, and probe the move command. Unit/harness and quality
  receipts do not establish it.
- **P3, command inventory:** README names
  `workbench.action.moveEditorToNewWindow` and accurately says the generated
  host-API record lists the probing/execution APIs, not command-ID values.

## Verification

Tests and builds run on macmini, as the brief requires. The initial two-file
run had 454 passes and one failure: the old rewind fixture expected writes
while its turn still ran. After finishing that fixture's turn, the rerun
passed all 460 tests. Later scoped checks and drills are recorded below.

On macmini (Node v24.21.0), snapshot `48695b29044ab433d604953d4863e90fa00e27af`:
all 461 tests in the two owning files passed, without filtering or timeout
changes. Each mutation below exited 1 with the intended assertion; every
restored run passed all 461 again. The mutated files lived only in the rig's
disposable snapshot, and each restoration matched its saved SHA-256 exactly.
Receipt: [m87-w-fixes-drills.json](m87-w-fixes-drills.json). Full logs are in
the rig slot `fixm87w-drills/temp/` and local `temp/fixm87w-drills.log`.

| Drill                  | Defect                              | Observed failure                                                   |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| turn-after-output      | omit the running/started-turn guard | held patch output reaches Revert; four late file stages write/read |
| session-after-await    | omit the session guard              | four stale-session stages proceed                                  |
| prepare-after-resolve  | omit preparation guards             | canonical resolution reads a file after invalidation               |
| io-guard-forwarding    | pass no-op guards to write/delete   | four held I/O stages change the file                               |
| send-admission         | omit admission checks               | a second turn starts during Revert I/O                             |
| pending-turn-admission | ignore pending submissions          | Revert proceeds before the turn acknowledgement                    |
| completed-turn-epoch   | stop counting turn starts           | a turn completed during held output lets Revert proceed            |

The hook's declaration-order check required moving the confirmation's epoch
capture below both early exits, still before the await. The guarded behavior
and all drilled guard bodies are unchanged; the final owning-file run below
covers that adjustment.

Final scoped checks ran serially on macmini, slot `fixm87w-gates`, snapshot
`bf0110a1`. Each exited 0; the log is local `temp/fixm87w-gates.log`.

| Check                                                                                                                | Result                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `npm run typecheck`                                                                                                  | all five projects pass                                        |
| `npx eslint --max-warnings=0` on the four changed TypeScript files                                                   | 0 errors/warnings                                             |
| `npx prettier --check` on changed source and docs                                                                    | pass                                                          |
| `npm run deadcode`                                                                                                   | pass                                                          |
| `npx jscpd`                                                                                                          | 817 files, 0 clones                                           |
| `npm run check:l10n`                                                                                                 | 14 tables, 117 manifest strings, 410 source files, 0 problems |
| `npm run check:host-api`                                                                                             | 279 APIs, 57 theme variables, 0 problems                      |
| `npm run build`                                                                                                      | all D6 size/split/global/notices checks pass                  |
| `npx vitest run test/unit/conversationController.test.ts test/unit/editReview.test.ts --maxWorkers=1 --reporter=dot` | 2 files, 461 tests passed, 0 skipped; 15.77 s                 |

Production sizes (KiB): extension **587.3/600**, Model API **422.8/475**,
checkpoint store **140.2/225**, webview **863.0/900**, shared text **102.8/125**.
All other bundled outputs passed their existing caps too. D6 caps are unchanged.

The final source adjustment passed ESLint on the rig; the first hook attempt
had correctly rejected the remaining declaration-order error. Commit hooks
remain enabled. The final documentation additions only record these results;
they do not change the tested source.

## Candidate synchronization

The common brief's `git merge --no-edit integrate/m72-on-24ff` exits 1:
`not something we can merge`. That local branch no longer exists. M72's
released tree, `v0.10.0` (`26ff5eb6`), is already an ancestor of this worktree
and of `origin/main` (both ancestry checks exit 0).

`origin/main` is `1e93c67c`, with 240 changed files beyond this branch's base,
including M70's replacement of Revert with conditional file I/O and its lazy
review bundle. A merge was refused before changing files because this lane's
edits overlapped. Porting the callback into that separate implementation and
its lazy adapter is deferred to the lead under the lane's size/time bounds;
no conflicted merge or partially adapted M70 code is left here. This lane does
not claim synchronization with that newer main.

## Still open

- Lead: native VS Code Tasks acceptance test and receipt.
- Lead: full `npm run quality` and hosted CI on the final milestone head. The
  lane's common rules reserve those full gates for the lead.
- Lead: confirm the intended current release base and integrate these guards
  with M70's conditional Revert and lazy adapter before combining with newer
  main. Rerun the owning tests and affected drills after that port.
