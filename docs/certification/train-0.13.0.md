# TRAIN13 — 0.13.0 release train

Worktree: `/home/randy/lanes/TRAIN13`, branch `release/train-0.13.0`.
Base: `244d5905` (`main-sync`, PR #117). Tests run directly on Kubuntu.
The task is integration only: no push, rebase, squash, live or paid model call.
All existing quality thresholds and budgets remain unchanged.

Final disposition: **release blocked**. The unchanged webview and VSIX size
gates fail; implementation stops at the owner's budget-stop instruction.
The final full quality run also stops on two `/tmp` disk-quota failures in
unchanged checkpoint tests. This train is not certified green.

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

| Merge          | Commit     |
| -------------- | ---------- |
| #116           | `fe162135` |
| #87            | `176a459c` |
| #118           | `5bc2abc3` |
| #119           | `81ce22ac` |
| Defaults / D78 | `514feaef` |
| M92 / M92e     | `43245e96` |

Integration corrections are in `390760c0`. Every merge has two parents;
every source head is reachable. Hooks ran on all commits. The final receipt
commit changes documentation only.

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
[train-0.13.0-drills.json](train-0.13.0-drills.json). Scoped tests pass with
the guards restored; the full-gate findings are recorded below. No gate or
threshold is weakened.

The hashes record each file immediately before and after its deliberate
regression, before the final corrective commit and its formatting/comment
updates; they are restoration receipts, not a final-tree hash manifest.

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
duplication is zero clones. The complete rerun below includes these
integration-only corrections.

## Full gate and package

`VITEST_MAX_WORKERS=3 npm run quality` exits 1 on the corrected tree.
The supported environment variable bounds concurrency without selecting
tests or changing timeouts/thresholds.

- Formatting, JavaScript/CSS lint, all five TypeScript projects,
  localization, host APIs, dead code, cycles and duplication pass.
  PowerShell lint retains its existing Linux skip. Localization: 14 tables,
  131 manifest strings, 472 source files, zero problems. Host inventory:
  296 APIs, 24 VS Code-importing files, 25 Node built-ins, 61 theme
  variables, zero problems. Duplication: zero clones across 930 files.
- Test files: **387 passed, 2 failed, 6 skipped (395)**. Tests:
  **7,758 passed, 2 failed, 65 skipped (7,825)**. Duration: 275.76 seconds.
  The six integration failures from the first run do not recur.
- `checkpointHost` cannot copy Node to its temporary fake-git path:
  system error `-122` is `EDQUOT`. `checkpointStoreGuards` restores two
  of five large files. A normal-path scoped rerun reproduces `EDQUOT`
  explicitly for both the copy and the large-file write (59 passed,
  2 failed). Neither these tests nor their checkpoint/git implementation
  differs from `main-sync`.
- A diagnostic scoped run with `TMPDIR` inside this worktree passes both
  original failures, with 60 passed and one different failure: the
  workspace-overlap guard correctly refuses temporary checkpoint storage
  inside the workspace. This relocation is not a valid full-gate workaround.
  No fixture, guard or test limit changes; nothing outside this worktree
  is deleted to clear the shared rig quota.
- Coverage is enabled, but no summary or LCOV report is emitted because
  tests fail. Coverage thresholds are therefore **not certified**.
- Build, dependency audit, accessibility, full-history secret scan and
  Semgrep are not reached by the full quality command. Commit hooks run
  their staged secret scan. Installed-editor integration and native macOS/
  Windows acceptance are outside this local receipt.

Separate `npm run build`: production compilation succeeds, then the
unchanged bundle-size gate exits 1. All 22 other gated artifacts pass.
Its subsequent split/global/notices checks do not run in this attempt.
Notices were regenerated by their script (83 packages); host APIs and exec
schemas were also generated/verified by their scripts.

| Artifact                | Bytes       | Budget bytes | Remaining bytes |
| ----------------------- | ----------- | ------------ | --------------- |
| Activation              | 613,570     | 614,400      | 830             |
| Model API               | 457,409     | 486,400      | 28,991          |
| Checkpoint store        | 112,710     | 230,400      | 117,690         |
| Webview main            | **928,507** | **921,600**  | **−6,907**      |
| What's New host         | 36,807      | 51,200       | 14,393          |
| What's New notes        | 34,410      | 40,960       | 6,550           |
| Shared English fallback | 122,182     | 128,000      | 5,818           |

Webview main is **906.7 KiB against 900 KiB**. Its largest emitted inputs
are React DOM (205,683 bytes), English text (121,687), UI state (40,947),
App (30,008), highlight core (20,984), Zod schemas (15,269), CSS highlighting
(13,446), Transcript (12,905), shared constants (12,115) and Composer
(12,047). Shared secret detection contributes 4,331 bytes and the new secret
dialog 596 bytes. These are input contributions, not an attribution of the
entire overage to one branch. No bundle diet or cap change is attempted
after this failure.

For the requested compressed-size measurement, the installed VSCE 4 pack
function collects and validates the current production files with
`dependencies: false` into an ignored, private archive. It does not run
the CLI prepublish step; ordinary release packaging remains blocked by the
failed build gate. No package script or gate changes; this is not a release
artifact.

`node scripts/check-vsix-size.mjs temp/train13/train-0.13.0-measurement.vsix`
exits 1: **2,330,538 bytes**, against **2,252,800 bytes (2,200 KiB)**,
an excess of **77,738 bytes**. Its 124 ZIP entries contain 2,307,900
compressed bytes; ZIP overhead is 22,638 bytes.

| ZIP content group                   | Compressed bytes |
| ----------------------------------- | ---------------- |
| dist                                | 1,024,976        |
| translated UI tables                | 613,642          |
| root files and VSIX metadata        | 334,921          |
| walkthrough/resources               | 159,823          |
| vendor skills                       | 139,197          |
| docs                                | 17,023           |
| native sources/helpers present here | 11,769           |
| media                               | 5,064            |
| first-party skill                   | 1,485            |

Largest individual compressed entries: webview main 282,974 bytes,
activation 190,208, Model API 144,541, README 102,787, changelog 85,723,
page worker 62,877 and walkthrough open image 59,085.
Archive SHA-256:
`94dd12e859d1c4fcf847380ad3629eb8704289eea401c6d1a694d9ea7ed01ab7`.

The manifest stays at **0.12.1**; release versioning is outside the merge
brief. The universal macOS dictation binary is absent from this Linux
worktree and archive. Even without it the package exceeds budget; this
measurement cannot certify universal-package size. Exact machine-readable
bytes are in [train-0.13.0-result.json](train-0.13.0-result.json).
Implementation stops at both confirmed budget failures as instructed.
Quota recovery, full certification and package reduction remain unresolved.

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

Validation: static gates pass; the corrected full run has 7,758 passed,
two `/tmp` quota failures and 65 existing skips, so coverage and downstream
accessibility/security gates are unverified. Release is blocked by the
928,507-byte webview (900 KiB cap) and 2,330,538-byte local measurement VSIX
(2,200 KiB cap), already over before adding the missing universal macOS
helper. Nine deliberate regression drills fail and restore byte-exact.
Caps and thresholds stay unchanged; implementation stops at the required
budget boundary. No publication or remote operation was performed.
