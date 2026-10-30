# cc-playbook: playbookConversation on real code only (RLF-PLAYBOOK, 2026-10-30)

Lane RLF-PLAYBOOK, worktree `/home/randy/lanes/RLF-PLAYBOOK`, branch
`rec/rlf-playbook`, base `int/recovery b781451b94` (which carries cc/fixes).

## What was done

`test/unit/playbookConversation.test.ts` drove the conversation over a
scripted window, scripted pickers and a scripted backend, which the
2026-10-17 rule forbids (cc-fixes item 3). The file held 52 cases by
vitest's own count (cc-fixes said 43: it undercounted the `it.each`
expansions). Counted again here: 52.

- 32 cases moved onto the real composition in the same file: the real
  conversation over the real window, the real worker code behind the
  in-process thread, a real journal and a real git repository. The moved
  behaviours keep their meaning; where the old setup needed a child
  session, an empty child list or the person's taken best-of-N attempt
  carries the same conversation path without reading any session.
- 20 cases left the unit suite for `docs/real-life/unproven.md`, each
  with the exact real-life steps a person follows in the packed product,
  plus the offer and hook-output slivers of the moved tell-everything
  case. They need a real child session's own items and stored patches,
  or VS Code's pickers.
- The shared composition now lives in
  `test/unit/helpers/playbook/playbookScene.ts`, run by both this suite
  and `test/unit/playbookWindow.test.ts`, so the duplication gate holds
  at 0 clones.

## Moved: 32 old titles into 16 new cases

| New case                                                                                 | Old titles it proves                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| sends a review the window calls ordinary exactly as it is, and follows nothing           | the same title (with no children; a child that changed an unrelated file is the window's classification, already proven by playbookWindow)                                                                                                       |
| still refuses a review of more files than the journal can hold                           | the same title (best-of-N child)                                                                                                                                                                                                                 |
| runs at once for a conversation that has no session yet                                  | the same title                                                                                                                                                                                                                                   |
| throws on what the work itself threw, as it is                                           | the same title                                                                                                                                                                                                                                   |
| refuses, saying the playbook could not be asked, when that is why                        | the same title                                                                                                                                                                                                                                   |
| says so when nothing is open, and when the journal cannot be read                        | the same title                                                                                                                                                                                                                                   |
| closes before a dispatch starts and suppresses its notices                               | closes before an in-flight `%s` admission … (delegate, bestOfN, subagent)                                                                                                                                                                        |
| counts the taken attempt as a child, and cancels the review when its turn cannot be sent | counts the best-of-N attempt the person took as a child; cancels the review when its turn cannot be sent                                                                                                                                         |
| binds its review, refuses until answered, and tells notes, rounds and failure            | sends a playbook review with the charter, binds it to its turn and watches it to its end; refuses in the playbook's own words, and sends nothing; the why-note, rounds and failure slivers of shows each why-note, offer and counted round …     |
| ends rounds with the child, the run, the next review, or the abort                       | goes through the window, and its round ends when the child's row does; ends a best-of-N round with its run, and every open round with the next review; waits for the child's own end where the caller can see it, and stops waiting when told to |
| ends an admission with the child or the abort, leaving no callback behind                | runs through the window's dispatch …; stops waiting for a child that never finishes …; removes an aborted wait's callback from the child's waiter set                                                                                            |
| says a refusal in the playbook's own words, and never runs the work                      | the same title; makes a refusal the caller's own result, in both wordings, and never runs the work                                                                                                                                               |
| opens one round per live row and ends only its own                                       | opens exactly one round before the child session id arrives …; closes the matching round on `%s` (completed, failed, cancelled)                                                                                                                  |
| ends a silent child at the next review, and everything at dispose                        | closes a child that never reports at the next review; closes on conversation replacement or window reload and accepts no later work                                                                                                              |
| settles rows that ended early, and replays settle nothing later                          | settles a row that ended while admission was in flight; a repeated live completion does not close a later follow-up; ignores a replayed row after a new round …                                                                                  |
| stops following, cancels its open reviews and ends every round that waited               | the same title                                                                                                                                                                                                                                   |

## Left: 20 titles plus 2 slivers

In `docs/real-life/unproven.md` under "Rewritten on lane RLF-PLAYBOOK
(2026-10-30)": the eight child-evidence review cases (host files, stored
patch, whole paging, endless/garbled patch, changed-nothing, unreadable
session, too many files, two unasked children), the five blocked codes,
the two blocked re-reads, the five picker cases, and the offer and
hook-output slivers. Counts line updated: 99 to 119 tests, 31 to 32
files.

## Fakes deleted

Gone with the rewrite, every one local to the old file: `scriptedPort`,
`scene`, `ticket`, the picker script (`Step`, `UNTICK_ALL`,
`disputedWith`, `scripted`), the hand-written child items and patch
pages (`changed`, `pageOf`, `PATCHED`), the hand-written standings
(`module`, `finding`), the fake-backend drivers (`expectUnreadable`,
`blockedOnce`, `firstRound`, `newChild`, `isOverYet`, `settleWork`),
the fake charter/note/refusal (`CHARTER`, `NOTE`, `REFUSED_TEXT`) and
`noopLog`. `keepCalls` stays: it records calls to real functions and is
still read by `playbookWindow.test.ts`, `playbookPanelChannel.test.ts`,
`helpers/playbook/workerThread.ts` and this suite. What remains is the
controller's own: `request` (submit/listen), `observedRow`
(schema-typed live rows), `bothWordings`, `isSettled`, and a best-of-N
run parsed by its schema.

## What the real composition showed (findings, not failures)

- One held lease per module: a dispatch or review refuses with
  `prerequisiteMissing` while another round holds the module's lease, so
  two governed rounds on one module never overlap. The fakes' concurrent
  rounds are unreachable on the real policy (the journal is
  compare-and-swap, so overlapping verifications would fail closed
  anyway). Rounds in the suite run strictly sequentially.
- The journal is append-only: intermediate holds stay held, and the last
  lease record wins. Lease quiescence asserts the last record (or a
  release count), never every record.
- A `redesignRequired` refusal also emits the redesign offer; a crashed
  or disposed round logs its certification warning on the window. The
  suite asserts these exact lines.

## Red/green drill

Broke the charter path a moved case proves
(`src/host/playbook/playbookConversation.ts`: submit `request.parts`
instead of `admitted.parts(request.parts)`): "counts the taken attempt
as a child, and cancels the review when its turn cannot be sent" failed
with exit 1 (`expected [ [ [ { type: 'text', …(1) } ] ] ] to deeply
equal [ Array(1) ]`). Restored the line; `git status` clean
(byte-identical); the case green again (32.84 s wall with setup).

## Gates (all exit 0)

| Gate                                                          | Result                         |
| ------------------------------------------------------------- | ------------------------------ |
| prettier --check, eslint --max-warnings 0 (3 files)           | 0                              |
| npm run typecheck (all projects)                              | 0                              |
| node scripts/check-l10n.mjs                                   | 0 (0 problems)                 |
| npm run check:reference                                       | 0                              |
| npm run check:host-api                                        | 0 (0 problems)                 |
| npm run check:plan                                            | 0 (0 drift)                    |
| npm run check:roadmap                                         | 0 (current)                    |
| npm run check:catches                                         | 0 (matches baseline)           |
| npm run duplication                                           | 0 (0 clones)                   |
| npm run cycles                                                | 0 (no circular dependency)     |
| npm run deadcode                                              | 0                              |
| npm run build                                                 | 0 (budgets hold)               |
| npm run security:audit                                        | 0 (7 advisories, 0 exceptions) |
| SAST (`SEMGREP_ENABLE_VERSION_CHECK=0 npm run security:sast`) | 0                              |
| rewritten suite, repo's own timeouts                          | 16/16 green, 115 s             |
| playbookWindow suite (shares the harness)                     | 29/29 green, 29 s              |
| npx vitest related (3 changed files) --run                    | 45/45 green, 172 s             |

No packed-product run in this lane: the brief names none, and the
deliverable is the real-code suite itself, proven by the runs and the
drill above. The unproven entries await a real-use run.
