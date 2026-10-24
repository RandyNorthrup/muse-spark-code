# RLSCHED certification (M115 remainder + M115w)

Recovery lane on 0.19.0 main (branch `rec/rlsched`). Two legs:

- Windows 11, owner PC, 2026-10-22/23: VS Code stable 1.143.1, real timers,
  no stand-in clock, no live model or paid calls.
- Mac mini (Darwin 24.6.0 x86_64, Node 24.21.0), 2026-10-24: unit suites,
  every local gate, the production build, and real use of the built CLI.
  No Muse request and no paid call was made (the Muse allowance is spent
  until 2026-10-25 17:00 Pacific), and no browser, Electron or GUI started.

`SCHEDULE_EDITOR_DELIVERY_CERTIFICATION` stays off. It flips only on the lead's
complete receipts (VS Code admission and safety on Windows, Linux and macOS,
the native modal decline, independent review, aggregate/artifact
qualification). This lane produced the Windows leg; VS Code cannot start on
the macOS host (NOT RUN below), so neither of the other two legs exists.

## What landed

| Part                        | State                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-M115-4 event sources      | git refs, workspace files, the agents hub, durable cross-process claims, a schedule never refires on its own settlement. The macOS watcher fault found on the rig is fixed (below).                                                                    |
| Lane RA, `schedule_report`  | live authority, durable occurrences, the agent tool; reports refuse `destinationsPending` until M113 lane Q's backend binds.                                                                                                                           |
| C-M115-6 OS wakes           | the wake is re-armed after run-due; background-maintain reconciles.                                                                                                                                                                                    |
| C-M115-8 role/team targets  | NOT BUILT: refuse `targetUnavailable`. M96c's `TaskBoard` is a window-owned board of VS Code's team runtime, and M96's lane (`rec/rlm96c`) is not passed on; see "Open questions".                                                                     |
| C-M115-9 native editors     | NOT BUILT: waits on M104's native hosts.                                                                                                                                                                                                               |
| M115w W0 contracts          | state machine, records, `triageFindings` v1, policy, templates. The reporter's language is not detected (PLAN: "otherwise English"); public posts are English.                                                                                         |
| WA acknowledge              | template, label, automated note, marker; read, post and record under the repository's lock (two pollers post once).                                                                                                                                    |
| WT triage                   | charter, evidence pack (duplicates, releases, tags, commits, plans), instruction-like phrases named, findings validated.                                                                                                                               |
| WD decide, WV verify, reply | needs-info wait returns to triage on the reporter's answer or an edit; replies are marked by flow, round and kind.                                                                                                                                     |
| WS safety                   | untrusted text fenced, nothing taken from issue text, spam never posts. Report only is structural (`WATCHDOG_TAINT_LANE.isMerged` false): only the acknowledgement posts; `decide`/`resolve` show the reply they would make.                           |
| WU surfaces                 | `watchdog` CLI and ACP `/watchdog` (list, status, pause, resume, poll, policy, evidence, apply, decide, resolve), `/report issues`. NOT BUILT: the Agent-map card and the policy page (no Agent map on main; no browser look possible from this lane). |
| WQ tests and certification  | this record, the suites and drills below, docs (acp.md, SECURITY, PRIVACY, README row, CHANGELOG).                                                                                                                                                     |

Commits on the rig (after the PC run's): `bbf31ba04` bundle split,
`3f4c8db44` needs-info wait/markers/locking, `27d957d07` policy, `755f2a41f`
`/report issues`, `5212bec12` report-only + docs + recorded refusals,
`7a5304159` pinned fixture bytes, `40c1b3243` gate fixes, `519633e46`
sign-in read, `a53040aa7` macOS watcher, `2350845f1` test timing, and this
record. The PC run's: `a43ae772f`, `e48212dbc`, `6360b0542`, `53edaf613`,
`0eeb51750`, `73770e8a5`, `91d0f3430`, `4b72b7514`, `a44355f1f`, `caba721b2`,
`49be70adb`, `b9016c12e`, `0bd39cd96`, `6db4b4d8e`, `7f1b98764`.

Faults found and fixed on the rig (each has a drill below):

- The triage charter's must-never clause shipped as the placeholder
  `[STRING_PLACEHOLDER_1]`; it now forbids running, obeying, posting,
  labelling, closing or reading a credential.
- A needs-info wait parked on stale findings and could not be triaged again
  (`apply` needs an acknowledged issue); our own questions also read as the
  reporter's answer. Fixed by the state machine, a reply-comment id, and
  answer detection (the reporter's comment, newer than ours, not ours).
- A reply marker named only its kind, so a later round's reply was taken for
  an earlier one; it now names flow, round and kind.
- Two pollers (two windows) could both post an acknowledgement; the read,
  post and record now happen under the repository's lock.
- Edits were detected by title only; a body hash now decides.
- `/watchdog list` in an ACP editor read the GitHub sign-in from the
  credential store; only poll, evidence, decide and resolve do.
- Report only was approval-gated, not structural (PLAN M115w acceptance 8).
- macOS: Node's recursive `fs.watch` reports the watched folder under its own
  name; the watcher took it for a missing file and reported an error.
  Node 22 watches recursively on every supported platform, so the
  per-directory fallback (and its platform stand-in test) was removed.

## Test inputs

Recorded exchanges (`test/fixtures/m115w/github-issues/`, fourteen folders,
each body byte-exact against its receipt's SHA-256; captured unauthenticated
against the public repository, 2026-10-22 by the PC run and 2026-10-24 on
the rig with `temp/m115w-capture2.cjs`): the issue list, issues 146 and 3,
search results, comments of issues 146, 3 and 4, labels, releases, tags,
commit search, the repository, an unauthenticated comment post (401) and a
missing repository (404). `.gitattributes` pins the bytes (one body is CRLF).

Synthetic, named: the poll tests serve the captured list through the
client's injectable `fetch`; answers to our own POST/PATCH reuse captured
GET objects (an earlier comment id for the reply); some cases change a
captured issue (open instead of closed, a new title, an edited body, a bumped
comment count, a hostile body); `issue()` in `watchdogAck.test.ts` is a plain
builder. The injected-`fetch` rig is a stand-in for GitHub in the strict
sense of AGENTS.md; no live GitHub post was possible (it needs the person's
sign-in). `scheduleReportBinding.test.ts` hands the bound-backend case
tripwires that reject if called (the unbound M113 Q backend). The lead
decides whether PR #183's deletion list takes any of these.

## Suites (real code, repository default timeouts, at most three files per run)

Exit codes and counts are in "Gates". Watchdog: captures (14 folders,
receipt hashes), contracts, client, ack and guards, poll (including the
needs-info loop through two rounds and two racing pollers), decide/resolve,
triage, command surfaces (policy, report-only, sign-in read), surface and
bundle entry. Reports: `reportIssues` (real store, real reader, real engine).
Schedules: event intake, file watcher (real `fs.watch`), git refs, report
binding and secrecy, background reconcile, lazy owners.

## Red/green drills (each broken on purpose, failed with exit 1, restored, green)

| Drill                                       | Break                                                                  | Red                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC run: WT self-exclusion                   | triage counts the issue's own body as evidence                         | 2 triage tests fail                                                                                                                                           |
| PC run: WU approval gate                    | forced-off: posts beyond ack without `--approve`                       | posted assertion fails                                                                                                                                        |
| PC run: catch guard                         | removed the NARROW guard                                               | `check:catches` GENERIC 265→266, exit 1                                                                                                                       |
| PC run: reference gate                      | `watchdog` command without catalog/help rows                           | `check:reference` fails                                                                                                                                       |
| D1 ack under the lock                       | the step decides on no record and no comments instead of the live ones | `watchdogPoll`: race test posts 4 comments not 2, adopt test fails                                                                                            |
| D2 needs-info return                        | `awaitingInfo`+`infoReceived` goes to `triaged` (the old table)        | `watchdogContracts` flow + `watchdogPoll` two-round loop fail                                                                                                 |
| D3 answer newer than the reply              | drop `comment.id > replyCommentId`                                     | `watchdogPoll` "hears the reporter back" fails                                                                                                                |
| D4 reply marker names the round             | drop `round=` from the marker                                          | `watchdogDecide` later-round reply + `watchdogPoll` loop fail                                                                                                 |
| D5 edit by body hash                        | compare titles only                                                    | `watchdogPoll` body-edit case fails                                                                                                                           |
| D6 our post is not an answer                | drop `!isWatchdogPost`                                                 | `watchdogPoll` "hears the reporter back" fails                                                                                                                |
| D7 charter placeholder                      | `[STRING_PLACEHOLDER_1]` back in `triageMustNever`                     | `watchdogTriage` charter test fails                                                                                                                           |
| D8 public posts in English                  | `ack.ts` reads the installed display table (German installed)          | `watchdogAck` English-post test fails                                                                                                                         |
| D9, D10 policy Always / Never               | the gate stops reading `always` / `never`                              | `watchdogAck` gate test + `watchdogCommand` policy-gate test fail                                                                                             |
| D11 owner-blocked first                     | the closed stage ranked with the person's                              | `reportIssues` ordering + language tests fail                                                                                                                 |
| D12 `--repo`                                | the source ignores the scope                                           | `reportIssues` scope test fails                                                                                                                               |
| D13 report only                             | decide/resolve ignore the hold                                         | `watchdogDecide` ×2 and `watchdogCommand` report-only fail                                                                                                    |
| D14 report-only binding                     | the surface binds `isReportOnly` false                                 | `watchdogSurface` fails                                                                                                                                       |
| D15 sign-in read                            | every command reads the sign-in                                        | `watchdogCommand` sign-in test fails                                                                                                                          |
| D16 C-M115-4 self-trigger                   | the intake stops skipping a schedule's own settlement                  | `scheduleEventIntake` "never fires a schedule on its own settlement" fails                                                                                    |
| D17 macOS root event                        | the guard for the watched folder's own name removed                    | `scheduleFileWatcher` "observes root and nested writes" fails on this host (four tests failed here before the fix); no such event arrives on Windows or Linux |
| Gate fired for real: catches                | two new GENERIC handlers in the issues source and reader               | `check:catches` exit 1 (core 265→266, runtime 203→204); narrowed with `isParseFailure`, exit 0                                                                |
| Gate fired for real: SAST                   | `new RegExp` built from an issue number                                | semgrep 2 findings, exit 1; matcher rewritten without a pattern, 0 findings, exit 0                                                                           |
| Gate fired for real: host-api, clones, PLAN | `node:crypto` count, 3 clones, PLAN 1,156 bytes over the 85% budget    | each exited 1; record regenerated, clones removed, status paragraph shortened, exit 0                                                                         |

## Real use through the built product

Through the production build (`dist/acp.js` from `npm run build`), in a
scratch home and an empty workspace, no network and no Muse request. The
packed tarball could not be made here: `npm run package:acp` stops at
`Required native helper is missing: native/darwin/muse-vault-peer-x64`
(that helper is not built on this host); the lead packs it.

```
watchdog list                      → "The watchdog is not watching any repository yet."   exit 0
watchdog policy O/R posts never    → "Set posts for O/R."                                  exit 0
watchdog policy O/R close onReply  → "Set close for O/R."                                  exit 0
watchdog policy O/R posts sometimes→ "That value is not allowed for posts. Use ask, always, never."  exit 1
watchdog policy O/R                → the six settings, posts: never, close: onReply         exit 0
watchdog list / pause / resume     → "O/R · 0 issues" / paused / resumed                    exit 0
report issues --repo O/R --format text → Issues, Needs You, Limits (posts, close, paused)  exit 0
watchdog bogus                     → the usage sentence                                     exit 2
watchdog poll O/R                  → "The watchdog command could not be completed."         exit 1
                                     (this host's credential store is unavailable)
```

NOT RUN, with the reason: a live `poll`/acknowledgement against GitHub (needs
the person's GitHub sign-in and a repository to post to); `evidence`,
`apply`, `decide`, `resolve` against GitHub (same); the watched-issue rows of
`/report issues` through the product (they need a poll's records; the
`reportIssues` suite covers them through the real store and engine); an ACP
editor session with `/watchdog` (a nested ACP session; Muse allowance); VS
Code integration on this host (macOS lanes cannot start Electron); the
Linux and Windows legs of the schedule delivery switch.

## Measured causes (no "flake" without both results)

- `security:audit` exit 1: 13 advisories (@azure/msal-node, undici, zod,
  fast-uri, …). The untouched base's `package.json` and `package-lock.json`
  (`f3941b854`) give identical output; the lane changes no dependency file.
- `gitleaks git` over all history: exit 1, 7 findings, all in other lanes'
  commits (`test/fixtures/nodeos-boot/*`, `docs/certification/m125-f1-linux.json`,
  `test/unit/nodeSignin.test.ts`, two vault tests). Over the lane's own
  commits (`f3941b854..HEAD`): exit 0, no leaks.
- `scheduleFireFailures` (5 tests), `schedulePauseAfterFailures` (1) time out
  at 5 s when run beside other files on this Mac mini: the untouched base
  fails the same four tests in the same trio (`scheduleFireFailures`,
  `schedulePauseAfterFailures`, `scheduleLeaseLifecycle`); each passes alone
  on the base and on the lane (8 and 5 tests). Both are base files: fsync-heavy
  real-store tests on this host's disk. The lane's own heavy suites
  (`scheduleReportBinding`, `scheduleEventIntake`) name a 30 s durable-commit
  timeout with the reason beside it.
- Windows VS Code leg (PC run): the one `extension` suite failure
  (`creates AGENTS.md (D15)`, `ENOENT unlink …/AGENTS.md`) reproduces on a
  fresh `v0.19.0` worktree; unrelated to this lane (retained below).

## Gates (final tree)

| Gate                                                                                       | Exit | Result                                                                                           |
| ------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------ |
| prettier --check (every touched file, 114 files)                                           | 0    |                                                                                                  |
| eslint --max-warnings 0 (touched .ts/.tsx/.mjs)                                            | 0    |                                                                                                  |
| typecheck                                                                                  | 0    |                                                                                                  |
| check-l10n                                                                                 | 0    |                                                                                                  |
| check-reference                                                                            | 0    |                                                                                                  |
| check-host-api                                                                             | 0    |                                                                                                  |
| check-plan                                                                                 | 0    |                                                                                                  |
| check-roadmap                                                                              | 0    |                                                                                                  |
| check-catches                                                                              | 0    |                                                                                                  |
| duplication                                                                                | 0    |                                                                                                  |
| cycles                                                                                     | 0    |                                                                                                  |
| deadcode                                                                                   | 0    |                                                                                                  |
| check-badges                                                                               | 0    |                                                                                                  |
| check-tokens                                                                               | 0    |                                                                                                  |
| check-usable-reply                                                                         | 0    |                                                                                                  |
| check-wrap-up-request                                                                      | 0    |                                                                                                  |
| check-no-output-cap                                                                        | 0    |                                                                                                  |
| check-no-round-cap                                                                         | 0    |                                                                                                  |
| check-workflow-scripts                                                                     | 0    |                                                                                                  |
| check-lazy-registry                                                                        | 0    |                                                                                                  |
| build                                                                                      | 0    |                                                                                                  |
| security:sast                                                                              | 0    |                                                                                                  |
| security:audit                                                                             | 1    | (13 advisories; identical output on the untouched base's package files, measured)                |
| gitleaks over the lane's commits f3941b854..HEAD                                           | 0    |                                                                                                  |
| vitest [watchdogAck watchdogCaptures watchdogCommand]                                      | 0    | Test Files 3 passed (3) Tests 45 passed (45)                                                     |
| vitest [watchdogContracts watchdogDecide watchdogGithubClient]                             | 0    | Test Files 3 passed (3) Tests 25 passed (25)                                                     |
| vitest [watchdogPoll watchdogSurface watchdogTriage]                                       | 0    | Test Files 3 passed (3) Tests 23 passed (23)                                                     |
| vitest [reportIssues cx1r4Truth cx1r2Truth]                                                | 0    | Test Files 3 passed (3) Tests 45 passed (45)                                                     |
| vitest [collect.rowSources cliHelp scheduleEventIntake]                                    | 0    | Test Files 3 passed (3) Tests 202 passed (202)                                                   |
| vitest [scheduleFileWatcher scheduleGitRefs scheduleReportBinding]                         | 0    | Test Files 3 passed (3) Tests 21 passed (21)                                                     |
| vitest [scheduleReportSecrecy scheduleBackgroundReconcile scheduleLazyOwners]              | 0    | Test Files 3 passed (3) Tests 10 passed (10)                                                     |
| vitest related (all 51 changed src files except constants.ts, en.ts, generated)            | 1    | Test Files 3 failed, 147 passed, 1 skipped (151); Tests 9 failed, 3116 passed, 10 skipped (3135) |
| vitest [playbookSchedulesInputs alone]                                                     | 0    | Tests 21 passed (21)                                                                             |
| vitest [scheduleFireFailures alone]                                                        | 0    | Tests 8 passed (8)                                                                               |
| vitest [schedulePauseAfterFailures alone]                                                  | 0    | Tests 5 passed (5)                                                                               |
| vitest related, 2 workers (all 51 changed src files except constants.ts, en.ts, generated) | 1    | Test Files 1 failed, 149 passed, 1 skipped (151); Tests 5 failed, 3120 passed, 10 skipped (3135) |

Notes on the two non-zero rows:

- `security:audit` exit 1 is measured identical on the untouched base (see
  "Measured causes"); it is the registry's advisories, not this lane.
- `vitest related` (3 workers) exit 1: 9 timeouts in `scheduleFireFailures`
  (5), `scheduleEventIntake` (3, since given a named 30 s timeout) and
  `playbookSchedulesInputs` (1) under load; with 2 workers only
  `scheduleFireFailures` (5, a base file) remains. Each passes alone (rows
  above); the base fails `scheduleFireFailures` the same way beside two
  neighbours. An earlier related run on this tree also failed
  `scheduleFileWatcher` (a wait that counted events instead of waiting for
  the paths it needs: a test fault, fixed in `2350845f1` and run three times
  green) and `schedulePauseAfterFailures` (load, as above). No failure was
  rerun into green: each was read, measured or fixed.
- The earlier full gate names appear once each; `gitleaks git` over all
  history (exit 1, 7 findings in other lanes' commits) is under "Measured
  causes", the lane-range row above is the one that applies to these commits.

## Certification leg: VS Code integration, Windows (PC run, retained)

`npx vscode-test --label stable`, lane tree, combined
`scheduleBackground` + `extension` run: `scheduleBackground` 2 pass /
1 pending (win32-gated register row) with long timings (104 s, 92 s);
`extension` 11 pass / 1 fail — `creates AGENTS.md (D15)` fails in `finally`
cleanup with `ENOENT unlink .../test/fixtures/workspace/AGENTS.md`.
Extension suite alone on the lane tree: same single failure, exit 1.

Base comparison: fresh worktree of untouched `v0.19.0`, same VS Code
1.143.1, extension suite alone: `creates AGENTS.md` fails with the
identical ENOENT signature (10 passing, 2 failing — the second, the
panel-focus test, passed on the lane tree, a timing flake either way).
The AGENTS.md failure is therefore measured on the base, unrelated to
this lane (rules-file creation path, untouched by the lane diff); left
for the lead/hosted CI. Worktree removed after the run.

## Limits (D121, D208)

The watchdog sets no cap of ours: no daily count, no rate, no spam
threshold (a spam verdict comes from the triage, and holds the record
without a post). It retries nothing: GitHub's own refusal (rate limit,
locked issue, missing sign-in) stops the poll or the post and says so; the
only waits are the 5-minute acknowledgement target, which names an overdue
acknowledgement and never hurries one. The event intake and the file
watcher retry nothing and report each failure. `WATCHDOG_TAINT_LANE` is a
milestone switch, not a limit of the person's.

## Open questions and what waits

- C-M115-8 (role/team targets): `TaskBoard` lives in a VS Code window's team
  runtime and M96's lane is moving it (`rec/rlm96c` is not on
  `refs/heads/lanes/`). Options: (a) wait for the lead to pass RLM96C on,
  then bind `board` delivery to a team host port in the extension; (b) bind
  now in `src/host/` against today's `TaskBoard` and rework on the merge.
  Recommended: (a).
- A person-set daily or hourly post cap per repository (PLAN acceptance 7,
  `WATCHDOG_ISSUES_PER_REPO_PER_DAY`): none exists, by D121/D208. Options:
  add a person-set `policy` key (none by default) with the cap notice going
  to the orchestrator when M110's host exists, or leave caps to GitHub's own
  limits. Recommended: add it with the orchestrator notice, not before.
- M109 taint lane T: when it merges, flip `WATCHDOG_TAINT_LANE.isMerged`;
  the decide/resolve posting path, the gate and the markers are tested with
  report-only off.
- M113 lane Q destinations: `dist/schedules.js` (235.4 of 250 KiB) is
  unmeasured after the bind.
- `PLAN.md` is 101 bytes under the 85% archive budget: the next addition to
  it needs `npm run plan:archive` first.
