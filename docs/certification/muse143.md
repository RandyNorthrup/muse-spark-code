# MUSE143 — Windows upstream verification and update guidance

Date: 2026-10-05. Base: `2d4d72bd38d870269cfa66924f46b7a656207307`,
branch `fix/muse-1.4.3`. This is scoped maintenance, not release certification.

## Live evidence

Windows owner host: `Muse Code 1.4.3 (1.4.3-R5018.1)`, Node `v24.20.0`.
The repo's pinned SDK 1.3.0 `spawnMspConnection` / raw `Connection.command`
was used, following the existing live drill and MSP host. Server arguments:
`serve --trust-workspace`; no sandbox override. New empty `%TEMP%` workspace,
contributor-safe throwaway content, existing subscription sign-in untouched.
Scratch driver: `temp/muse143/probe.mjs`; durable scrubbed receipt:
[muse-1.4.3-wire.jsonl](../research/muse-1.4.3-wire.jsonl).

| Issue               | Observed on 1.4.3                                                                                                      | Product decision                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| #29 approval ledger | One approval/decide accepted, terminal true; approval resolved; no ledger fault.                                       | Older-version fault notice adds the existing installer command and 1.4.3 floor. Newer/unknown hosts keep the defensive actual-fault notice. |
| #30 rename          | -32603 internal, `session naming is unavailable`, retryable false.                                                     | Windows gate retained, including 1.4.3 and future versions until a fix is proven.                                                           |
| #31 fork            | -32023 forkBoundaryInvalid, `WriteFailed`, retryable false.                                                            | Same Windows gate retained. File-only rewind remains available.                                                                             |
| #26 sandbox cwd     | Output names the temporary workspace, not System32. The same command's file write fails with Access is denied, code 1. | Prepared-host cwd success does not resolve fresh-setup reliability. `auto` and profile-workspace warnings retained.                         |

One model turn, one approval, six admitted model attempts. The count comes
from this process's CLI bootstrap trace after shutdown, using the existing
`model.attempt.lifecycle` / `phase="admission"` count and session marker.
Muse Code also runs bundled reminder agents; attempts are not the turn count.
An initial handshake used a hyphenated client name, was refused before any
session or turn (`invalidParams`), and was retried with a machine identifier.
That attempt made zero model calls. No other live turns were submitted.

The owned server's EOF drain exceeded the scratch driver's five-second
budget; the SDK stopped that owned process with SIGTERM. The process exited,
then the verified temporary workspace was removed. No unrelated server,
credential file, user setting or sign-in was touched.

## Changes and compatibility

`conversationController` records whether the attached Muse Code version is
older than 1.4.3. The known `-R<build>.<revision>` label denotes its release,
so 1.4.3-R5018.1 is treated as 1.4.3. Unknown version text does not promise a
fix. Only an actual #29 fault triggers either notice; healthy versions get
none. Deduplication, applied-decision handling and new-conversation action
remain intact. All 14 language tables include the new complete template.

Update guidance reuses `MUSE_INSTALL_COMMANDS` (Windows PowerShell installer
or POSIX installer); it does not invent a `muse update` subcommand. The
installed CLI's successful `--help` has no such subcommand. The installer was
not rerun on this already-current host; its existing project install flow
and command remain unchanged. Restarting unrelated sessions is not part of
the lane.

The controller and React notice bridge are shared by compatible extension
hosts; this adds no VS Code-only control. ACP/headless still use shared MSP
fault detection and their existing explicit command failure reporting; no
interactive notice or update execution is introduced there. Rename/fork
limits remain in the shared core. `featureCatalog.ts` and `gen-reference.mjs`
are absent on this base, so the brief's conditional reference step does not
apply.

## Verification

Mac mini, before the product fix: snapshot `1be1a800`, controller file
580 tests, 578 passed / two intended failures. Both failures expected the
older-version update notice and received the old generic notice instead.
After the fix: snapshot `ae2527c8`, controller and MSP host files,
676 tests passed (580 + 96), exit 0, `--maxWorkers=3`.

Guard-fire drill on the Mac mini, snapshot `a2bd9482`: changed the version
comparison from `< 0` to `<= 0` in the disposable rig copy. The tests for
1.4.3 and 1.4.3-R5018.1 failed (two failures / 578 passes, vitest exit 1).
The driver restored the original bytes in `finally`; SHA-256 before and
after was `7df863035bdcd2193983d078d9f389a811ec326684eae81bb108f14818539401`,
matching the untouched local source. The drill command itself exited 0
only after observing the intended red and matching restoration hash.
Logs: `temp/muse143/red-before.log`, `green.log`, `guard-drill.log`.

Final restored-green and gates: Mac mini snapshot `1a02b12d`, exit 0.
`git diff --exit-code 1a02b12d --` over all changed source, tests and locale
tables confirms the local product bytes match the verified snapshot;
only documentation receipts changed afterward.

| Gate                                                                                                    | Result                                                                  |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npx vitest run test/unit/conversationController.test.ts test/unit/MuseCodeHost.test.ts --maxWorkers=3` | 676/676 passed, two files, no skips.                                    |
| `npm run typecheck`                                                                                     | All five projects passed.                                               |
| `npx eslint --max-warnings=0` on the six changed TypeScript files                                       | Passed.                                                                 |
| `npx prettier --check` on changed source, tests, docs and translations                                  | Passed.                                                                 |
| `npm run deadcode`                                                                                      | Passed; two existing configuration-cleanup suggestions, no unused code. |
| `npx jscpd`                                                                                             | 1,159 files, zero clones.                                               |
| `npm run check:l10n`                                                                                    | 14 tables, zero problems.                                               |
| `npm run check:host-api`                                                                                | 332 APIs, zero problems.                                                |
| `npm run build`                                                                                         | Every size cap, bundle split, host-global and notices check passed.     |

Production sizes in KiB: extension **436.7 / 600**, conversation
**194.5 / 250**, Model API **446.6 / 475**, checkpoint store **76.9 / 225**,
webview JS plus static imports **893.4 / 900** (entry **617.9**), ACP
**816.8 / 850**. No cap changed.
Complete output: `temp/muse143/final-gates.log`. Formatting ran on the
Windows owner host too. Commit hooks are present at this worktree's
`.husky/_/pre-commit`; the configured lint-staged and staged gitleaks checks
remain enabled.

Full `npm run quality`, hosted CI, fresh Windows sandbox certification and
damaged-session recovery remain the lead's work; the lane brief explicitly
forbids the aggregate run. No lane blocker remains. Suggested next steps:
lead reviews these changes, posts the prepared #30/#31 repro comments and
#26 supplementary result, then runs aggregate gates. A fresh Windows
sandbox repro is required before relaxing that workaround.
The local `origin/main` already contains M72's merged PR #55; the named old
integration branch is absent. `git merge --no-edit origin/main` reported
already up to date.

## Port onto 0.17.1 (2026-10-10)

`fix/muse-1.4.3` (`1285eb6f4`) was never merged and sat 1,993 commits
behind main. Triage for the 0.17.1 release branch: v0.17.0 (SDK 1.4.4,
`docs/certification/sdk144.md`) still showed the plain ledger notice on
every Muse Code version (`MUSE_APPROVAL_LEDGER_FIXED_VERSION`,
`approvalLedgerFaultUpdate` and the version check were absent), and its
SDK 1.4.4 audit lists the #29 workaround as kept and not retested. The
extension still connects to whatever `muse` CLI is installed, so a host
older than 1.4.3 can still meet the fault: the change applies.

It was ported by hand onto the release branch's current files, not merged:
the constant beside `MUSE_APPROVAL_LEDGER_FAULT`, the template after
`approvalLedgerFault` in `en.ts` and all 14 tables (the commit's own
translations), the controller's version check where the session attaches
and its notice choice in `noteMuseCodeFault`, the rename/fork comment, both
tests (the default fake handshake `1.3.0-test` is below the floor, so the
existing ledger test now expects the update notice on `win32`, and the
boundary cases cover 1.4.2-R4684.1 to `dev`), README, changelog and PLAN.
The live evidence above is unchanged; no new live turn was run.

Port gates (kubuntu, default timeouts): `conversationController`,
`MuseCodeHost`, the l10n suites and the bundle gates (`deferredBundles`,
`bundleSize`, `webviewBundle`, `modelsActivationBudget`, `teamHarness`)
passed, 10 files / 1,127 tests. Drill: the floor check changed to `<= 0`
failed exactly the `1.4.3` and `1.4.3-R5018.1` boundary cases (2 of 7
ledger-fault tests); the file was restored and its SHA-256 matched.
Host: check:l10n, check:plan, check:roadmap, check:reference and
check:host-api pass; the host and unit typechecks show only the known
environmental `museCodeSdk142.test.ts` error (this checkout's SDK 1.4.2).
