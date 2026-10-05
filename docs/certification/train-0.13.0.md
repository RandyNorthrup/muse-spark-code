# TRAIN13 — 0.13.0 release train

Worktree: `/home/randy/lanes/TRAIN13`, branch `release/train-0.13.0`.
Base: `244d5905` (`main-sync`, PR #117). Tests run directly on Kubuntu.
The task is integration only: no push, rebase, squash, live or paid model call.
All existing quality thresholds and budgets remain unchanged.

## Ordered merges and resolutions

| Included branch            | PR                              | Source head | Resolution                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/truth-audit-0120`    | #116                            | `07370da5`  | Clean merge; retain central diagnostic redaction, confidential dispatch checks, protected agent folders and the truth audit.                                                                                                                                                                                                                                                                 |
| `feature/m81-browser`      | #87                             | `2b7eb656`  | Union changelog/plan/certification entries, commands and all translated manifest keys; retain truth-audit wording and updated walkthrough pixels, recompressed losslessly with identical decoded RGBA bytes. Keep both M87 queue/time tests and M81 browser tests. Regenerate host APIs.                                                                                                     |
| `fix/mcp-job-helper-flake` | #118                            | `a1cc4158`  | Union changelog and gate records; regenerate host APIs. Direct .NET compilation and compiler diagnostics remain intact.                                                                                                                                                                                                                                                                      |
| `feature/m99-whats-new`    | #119                            | `85c3f027`  | Union contributed commands/settings, cycle roots and lazy bundle packaging/notices. Retain browser and bundled-skill entries, truth-audit command/setting descriptions and M99 Highlights; regenerate notices and host APIs.                                                                                                                                                                 |
| `feat/defaults-on`         | enhancements                    | `4e92a19d`  | D78 availability/defaults supersede old off-by-default descriptions. Retain consent/Always caveats, browser privacy docs, What's New and all budget/engine settings. Regenerate host APIs; no confidential guard removed.                                                                                                                                                                    |
| `fix/m92e-review`          | M92 including M92e review fixes | `19635f31`  | Union protected-path and secret-approval guards, queue and secret-prompt schemas/reducers/tests. Re-export M92's single shared detection table and retain #116's diagnostic-event helper in core. Consolidate the duplicate redactor import introduced by automatic merging. Held secret resends also use M87's submission timestamp. Preserve all decisions/milestones without renumbering. |

The final Unreleased section has exactly one Highlights block, five bullets,
and one each of Added, Changed, Fixed and Security. Try markers name only
manifest-contributed commands/settings. All released sections are copied
byte-identically from main; historical release notes are not rewritten.

## Scoped validation

All direct Vitest commands use `--maxWorkers=3 --testTimeout=120000`, with
at most three files per invocation.

| Files                                                    | Result                                                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `modelApiHost`, `permissions`, `museCodeProtectedWrites` | 683 passed                                                                                                        |
| `jobBuild`, `mcpJobExecutable`, `shellJob`               | 12 passed, 3 existing Windows-only skips                                                                          |
| `changelogVersion`, `whatsNewContent`, `whatsNewPanel`   | 22 passed                                                                                                         |
| `paidDailyBudget`, `paidHost`, `settings`                | 52 passed                                                                                                         |
| `App`, `uiState`, `protocol`                             | 454 passed                                                                                                        |
| `conversationController`, `redact`, `approvalSecrets`    | 670 passed after the initial transform failure detected duplicate `redactSecrets` imports in the automatic merge. |

Localization repeatedly reports 14 translated tables and zero problems.
Host API inventory and notices are regenerated by their scripts; the exec
schema script verifies the shipped schema matches.

## Integrated guards and deliberate drills

Nine deliberate regressions each exit 1; every modified file is restored
byte-exact and its before/after SHA-256 is recorded in
[train-0.13.0-drills.json](train-0.13.0-drills.json). The combined full tests
verify the restored tree. No gate or threshold is weakened.

| Deliberate regression                                   | Tests that fail |
| ------------------------------------------------------- | --------------- |
| Return diagnostic events without redaction              | 1               |
| Remove the final confidential dispatch guard            | 8               |
| Remove protected file-access checks from approval rules | 9               |
| Return secret approval cards unsanitized                | 4               |
| Add a second Unreleased Highlights block                | 1               |
| Make the monitor probe report a live process as stopped | 1               |
| Bind the verify-loop writer to the wrong session type   | 2               |
| Restore eager recall before any observation is packed   | 1               |
| Remove What's New's palette tip                         | 2               |

The first complete quality attempt passed all static gates but stopped in
unit tests: 7,754 passed, six failed, 65 skipped, across 395 files. Two failures
were M87's missing tooltip for the new M99 row; the tip is now translated in
all 14 tables. Two verify-loop assertions assumed concurrent parent/child
request arrival order, changed by D78's paid-admission await; the fixture now
binds the writer to the requested session type and retains all three-session
grant invalidation checks. The M75 packing test expected eager recall, which
D78 explicitly supersedes; it now requires recall absent from the first
three requests and present when the output actually packs.

The new monitor test also failed its signal-zero PID probe in that combined
run and passed unchanged in isolation. Signal zero includes exited Linux
zombies; the probe now uses the same running-versus-zombie semantics as the
existing MCP tests, with a live-process control assertion. The initial
process state was not captured, so zombie retention is an inference rather
than an observed receipt. No execution timeout, test timeout, threshold or
skip changes. Corrective scoped runs: 81 verify-loop/packing/monitor tests,
then 50 palette/monitor tests passed. Localization is zero problems;
duplication is zero clones. A complete final rerun is required after these
integration-only corrections.

## Full gate and package

Pending final `VITEST_MAX_WORKERS=3 npm run quality` rerun and VSIX packaging/size check.
The manifest version stays at the base's 0.12.1; release versioning is not
part of the merge brief. The macOS universal dictation helper is absent on
this Linux worktree, so a local VSIX size is not proof of universal-package
size. Record exact local bytes and this limitation.

## PR description

Title: Integrate the reviewed 0.13.0 release train

Integrate the ready branches in one ordered, history-preserving release train
so the shared conflict resolution and full gate apply to their combined tree.
Included: #116 documentation/security hardening, #87 M81 browser checks,
#118 Windows MCP job-helper compilation, #119 M99 What's New,
`feat/defaults-on` (D78), and `fix/m92e-review` (Muse Gadgets/M92e fixes).
Every source head remains reachable through a merge commit.

Keep central diagnostic redaction and confidential admission across the new
surfaces, share the M92 secret detector, retain browser/What's New lazy
bundles, and consolidate five Unreleased highlights. Released changelog
sections are byte-identical to main; generated artifacts come from scripts.

Validation and any remaining blocker: see the full gate and package receipt
above. No publication or remote operation was performed in this lane.
