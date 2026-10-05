# TRAIN13 — 0.13.0 release train

Current TRAIN13B result: **complete Kubuntu quality and CI-shaped VSIX gates pass**.
The implementation is `3e04f6f5d3fbf354db27338a5ec26321ceace154`; the final receipt commit
changes documentation only. See [TRAIN13B recovery](#train13b-size-recovery-2026-10-05)
and the current [PR description](#pr-description). Historical train failures follow first.

Worktree: `/home/randy/lanes/TRAIN13`, branch `release/train-0.13.0`.
Base: `244d5905` (`main-sync`, PR #117). Tests run directly on Kubuntu.
The task is integration only: no push, rebase, squash, live or paid model call.
All existing quality thresholds and budgets remain unchanged.

Historical TRAIN13 disposition: **release blocked**. The unchanged webview and VSIX size
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

## Historical TRAIN13 PR description

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

## TRAIN13B size recovery (2026-10-05)

Worktree `/home/randy/lanes/TRAIN13B`, branch `release/train-0.13.0-fix`,
starting head `42b9165ae0d8318544bec095a7ad860adb0948b2`. The specific rig
brief authorizes the complete gate and read-only release-asset download;
no merges, pushes, live/paid model calls, credential access or gate relaxation.
The preceding sections preserve the previous lane's historical failures.

Both unchanged checkpoint files were run **first**, using their normal
`/tmp` paths after the lead's cleanup: **61 tests passed**, two files, 7.90 s.
No `TMPDIR` relocation or checkpoint implementation/test change. This resolves
the earlier quota blocker on this rig.

### First paint and archive trade-offs

The original esbuild inputs were ranked against pre-train `244d5905`:
English fallback +9,328 emitted bytes, shared redaction +4,331, UI state
+2,287, App +837, browser-check constants +784, secret dialog +596,
approval card +240, shared constants +211, snapshot +203, protocol +103.
The large shared tables, consent and security code stay available at startup.
Account & usage, Agent map, best-of-N, review pane, history and session board
now load through six React lazy imports when opened. Their loading state is
announced, Close/Escape cancels even during import, and late completion cannot
reopen a closed surface. Existing ErrorBoundary handles a failed import.
The nonce-bearing ESM entry retains the nonce-only script CSP. The full eager
import graph is counted once against the **unchanged 900 KiB cap**, including
static shared chunks; the full browser JS graph grows 9,332 raw bytes due to
splitting/loading overhead while first paint shrinks. Optional JavaScript has its own new measured 50 KiB
aggregate cap. Split and packaging checks require every emitted chunk and
reject an eager surface, an unlisted dynamic entry or a stale chunk.

Node bundles share the **used** zod/mini API through `dist/validation.js`;
browser and integration bundles retain their inline parser. The shared
runtime is in VSIX, ACP and private fake-only packages, with split/API/global
and inventory guards. An unrestricted export-star prototype was rejected
because it carried 433,860 bytes; the actual runtime is 40,416 bytes.
This is an archive-size trade-off: activation alone falls by 17,505 bytes,
but activation plus its new parser rises by **22,911 raw bytes**; ACP itself
rises by **7,965 bytes**, within its existing cap. Repeated parsers are removed
from deferred Node bundles. Existing parser schemas and boundary behavior are
unchanged; compiled-runtime valid/invalid parse controls also pass.

VSCE's actual allowlist is staged beneath `dist/vsix-package`. Only shipped
UI/manifest JSON and generated What's New data are compacted; parsed values
must equal their readable source. The normal localization gate also reads
the **exact staged bytes**, checking every translated table and manifest.
Vendor files stay byte-identical, preserving their recorded hashes. The
package uses a concise marketplace guide linking the complete source README;
Unreleased and the newest two releases remain in its changelog with a complete
history link. Full repository docs/history remain intact. Privacy, skills,
walkthrough images, notices, native helpers and runtime features still ship.
Packaging tests forbid PLAN/AGENTS, certification, tests/fixtures/source,
metafiles/maps, unused README media, packaging-source docs and localization
allowlists. Shorter packaged docs reduce offline documentation depth; the
full guide/history are available through their explicit links.

The universal macOS helper is the actual executable extracted from the public
[0.12.1 release asset](https://github.com/RandyNorthrup/muse-spark-code/releases/download/v0.12.1/muse-spark-code-0.12.1.vsix):
414,832 raw bytes, **119,342 compressed bytes** and 164 bytes of ZIP entry
overhead. Added to the original helper-less measurement, it reconstructs a
CI-shaped baseline of **2,450,044 bytes** (not a fresh baseline build).
The new local archive includes that executable with executable permissions.
Fresh macOS compilation and the hosted OS matrix remain external acceptance;
the release binary establishes size, not a new native-build receipt.

### Verification and drills

All scoped Vitest commands use `--maxWorkers=3 --testTimeout=120000`, at most
three files per invocation. New deferred/package tests pass, as do App,
review, handoff, HTML, bundle, manifest and compiled-parser tests. The full
suite exposed ACP packaging fixtures lacking the new required runtime and
four panel assertions tied to script attribute order. Fixtures now include
that runtime and panel assertions require the module script **and nonce**;
the two package e2e files pass all 42 tests, the two panel files all 18.
No skip, timeout, threshold or existing security assertion is weakened.

Focused accessibility: all six deferred surfaces across four VS Code themes,
**24 pages**, zero violations, undecided checks or missing pages. Browser
execution under the production nonce-only script policy opens all six actual
surfaces with zero CSP violations or page errors. DeferredSurface tests also
cover pending close, late completion, latest props and import failure.

**20 deliberate regressions exit 1**, recorded in
[train-0.13.0-size-drills.json](train-0.13.0-size-drills.json). They cover
all six eager-surface regressions, parser re-inlining, missing compiled API,
new unsupported source API, stale chunks, startup/deferred overages, host
browser globals, development-file inclusion, missing package chunks,
uncompacted JSON, historical changelog return, bypassed loading and differing
shipped translation values, plus a nested scenario that never becomes ready. Nineteen drills modify a file and restore it byte-exact with
before/after SHA-256 receipts; one drill creates only a stale chunk,
which is removed. Restored gates/tests pass. These hashes prove restoration
at drill time; they are not the final artifact digest manifest.

The first complete tail reached all 564 accessibility pages with zero violations
but failed two nested-surface interactions that used fixed delays. Those
interactions now use the existing bounded `whenFound` helper; four nested
scenarios also require their actual final state before a scan. All 16 focused
pages pass. A deliberate impossible readiness selector fails all four themes
at the unchanged ten-second deadline, then restores byte-exact.

Full gate receipt and final artifact inventory follow below.

### Exact artifact bytes

All byte counts below are raw, except the VSIX. Existing caps are unchanged;
only the new parser and optional-JS totals receive new independent caps.
`webview/main.js` denotes its **transitive eager JS total** in the budget row.

| Artifact                   | Before bytes | After bytes | Cap bytes | Headroom bytes |
| -------------------------- | -----------: | ----------: | --------: | -------------: |
| `dist/extension.js`        |      613,570 |     596,065 |   614,400 |         18,335 |
| `dist/modelApi.js`         |      457,409 |     439,642 |   486,400 |         46,758 |
| `dist/review.js`           |       45,297 |      28,918 |    51,200 |         22,282 |
| `dist/sessionBoard.js`     |       69,660 |      49,604 |    76,800 |         27,196 |
| `dist/reviewer.js`         |       30,572 |      13,717 |    76,800 |         63,083 |
| `dist/planMarkdown.js`     |      147,608 |     147,608 |   153,600 |          5,992 |
| `dist/checkpointStore.js`  |      112,710 |      91,147 |   230,400 |        139,253 |
| `dist/agentImport.js`      |       94,012 |      75,212 |   128,000 |         52,788 |
| `dist/browserCheck.js`     |       52,229 |      38,524 |    76,800 |         38,276 |
| `dist/browserRuntime.js`   |       38,219 |      19,762 |    51,200 |         31,438 |
| `dist/bundledSkills.js`    |       28,735 |      14,341 |    51,200 |         36,859 |
| `dist/codeIntel.js`        |       56,956 |      39,453 |   102,400 |         62,947 |
| `dist/voice.js`            |       36,503 |      18,578 |    51,200 |         32,622 |
| `dist/webFetch.js`         |       48,970 |      35,911 |    76,800 |         40,889 |
| `dist/museCodeReviewer.js` |       18,584 |      18,584 |    76,800 |         58,216 |
| `dist/whatsNew.js`         |       36,807 |      16,997 |    51,200 |         34,203 |
| `dist/uiText.js`           |      122,182 |     122,182 |   128,000 |          5,818 |
| `dist/validation.js`       |          new |      40,416 |    51,200 |         10,784 |
| `dist/searchWorker.js`     |       18,571 |       4,969 |    51,200 |         46,231 |
| `dist/pageWorker.js`       |      208,040 |     193,171 |   307,200 |        114,029 |
| `dist/webview/main.js`     |      928,507 |     898,355 |   921,600 |         23,245 |
| `dist/webview/whatsNew.js` |          708 |         708 |    25,600 |         24,892 |
| `dist/acp.js`              |      815,561 |     823,526 |   870,400 |         46,874 |
| `dist/whatsNew.json`       |       34,410 |      34,410 |    40,960 |          6,550 |
| `dist/webview deferred JS` |            0 |      39,484 |    51,200 |         11,716 |

Webview startup falls **30,152 bytes**, with **23,245 bytes (22.70 KiB)**
left under the cap, exceeding the requested 20 KiB headroom. Optional JS is
39,484 bytes with 11,716 bytes of its new 50 KiB aggregate budget left.

Each emitted browser file is listed below. Eager files share the startup cap;
optional files share the deferred aggregate cap, rather than separate caps.

| Browser file                                         |   Bytes | Loaded at first paint |
| ---------------------------------------------------- | ------: | --------------------- |
| `dist/webview/chunks/AgentMap-LPUZHIEP.js`           |   8,009 | on demand             |
| `dist/webview/chunks/BestOfNDialog-YX53KGBH.js`      |   7,043 | on demand             |
| `dist/webview/chunks/HistoryDialog-KV2LQAES.js`      |   3,433 | on demand             |
| `dist/webview/chunks/ReviewPane-UQIGRIQ7.js`         |   5,582 | on demand             |
| `dist/webview/chunks/SessionBoardDialog-J5AP3TW2.js` |   2,286 | on demand             |
| `dist/webview/chunks/UsageDialog-WIF6SKXO.js`        |  11,254 | on demand             |
| `dist/webview/chunks/chunk-2IMK2LJV.js`              |     946 | yes                   |
| `dist/webview/chunks/chunk-5D5OIGMZ.js`              |     165 | yes                   |
| `dist/webview/chunks/chunk-5OYIARPN.js`              |       0 | yes                   |
| `dist/webview/chunks/chunk-AFH65HPM.js`              |     372 | yes                   |
| `dist/webview/chunks/chunk-CPCWHKL4.js`              |  72,031 | yes                   |
| `dist/webview/chunks/chunk-DNVKS4PV.js`              |     210 | yes                   |
| `dist/webview/chunks/chunk-FLQ4MYD3.js`              |   7,051 | yes                   |
| `dist/webview/chunks/chunk-H3C37OEY.js`              | 148,264 | yes                   |
| `dist/webview/chunks/chunk-H423DP7K.js`              |   1,877 | on demand             |
| `dist/webview/chunks/chunk-M3IDBAAM.js`              |   1,549 | yes                   |
| `dist/webview/chunks/chunk-OEALNJ7J.js`              |  31,962 | yes                   |
| `dist/webview/chunks/chunk-S76IJPNW.js`              |   1,143 | yes                   |
| `dist/webview/chunks/chunk-UUZMLMHR.js`              |   5,498 | yes                   |
| `dist/webview/chunks/chunk-WKCHX755.js`              |   8,335 | yes                   |
| `dist/webview/chunks/chunk-WROIWOFY.js`              |   4,040 | yes                   |
| `dist/webview/main.js`                               | 616,789 | yes                   |

### Complete gate and final package

`VITEST_MAX_WORKERS=3 npm run quality` **exits 0**, including every stage:
formatting, JavaScript/CSS lint, all five TypeScript projects, localization,
host APIs, Knip, cycles, zero duplication, unit/e2e coverage, production
budgets/split/globals/notices, audit, accessibility, history secret scan and
Semgrep. PowerShell lint retains its existing Windows-only policy on Linux.
No caps, thresholds, skips, deadlines, ignore rules or audit exceptions change.

- **391 files passed, 6 existing skips (397); 7,782 tests passed, 65 existing
  skips (7,847)**, zero failures, 260.17 s. Coverage: **94.30% statements,
  89.97% branches, 95.65% functions, 94.48% lines**, above the unchanged
  90/85/90/90 thresholds.
- Localization: 14 tables, 131 manifest strings, 474 source files, zero
  problems. Host API inventory: 296 APIs, 24 VS Code-importing files,
  25 Node built-ins, 61 theme variables, zero problems. Notices: 83 packages.
- Accessibility: **564 pages (141 scenarios × four themes)**, zero violations,
  undecided rules or missing results. The eight existing scrollable-listbox
  exemptions remain. Axe cannot measure contrast for 1,393 covered/offscreen
  elements and 20 glyph-only elements, under its existing documented policy.
- Audit passes with two advisories and one existing reviewed exception
  (`braces`, high; `serialize-javascript`, low). No exception is added.
- History secret scan: 1,357 commits before this lane's commits, zero leaks.
  Commit hooks also scan each staged patch; history is scanned again after
  both local commits. Semgrep: 287 applicable rules, 831 targets, zero findings.

`npm run package` **exits 0**, running the production build, exact staged
localization and unchanged compressed-size gate. The documented
`npm run check:l10n -- --packaged dist/vsix-package` also exits 0.

| VSIX measurement                            |         Bytes |     Cap bytes | Headroom bytes |
| ------------------------------------------- | ------------: | ------------: | -------------: |
| Previous Linux, helper absent               |     2,330,538 |     2,252,800 |        −77,738 |
| Reconstructed baseline with release helper  |     2,450,044 |     2,252,800 |       −197,244 |
| **Final CI-shaped archive, helper present** | **2,206,151** | **2,252,800** |     **46,649** |

Reduction against the reconstructed helper-inclusive baseline:
**243,893 bytes**. The archive has 147 entries,
6,730,871 raw content bytes, 2,179,209
compressed content bytes and 26,942 ZIP overhead bytes.
SHA-256: `598520a485781d459781bd17189c3bc64353a7e3e3d06711ef91feefc4c3d94e`.
The preliminary 2,206,108-byte measurement is superseded by this final
`npm run package` result. Manifest version stays **0.12.1**, as versioning
was outside this brief.

Compressed ranking from `unzip -lv`, in bytes:

| Entry                                               | Previous compressed bytes | Final compressed bytes |
| --------------------------------------------------- | ------------------------: | ---------------------: |
| Webview main (its eager shared chunks now separate) |                   282,974 |                190,894 |
| Activation                                          |                   190,208 |                181,964 |
| Model API                                           |                   144,541 |                136,221 |
| Universal helper                                    |                    absent |                119,342 |
| README                                              |                   102,787 |                  1,879 |
| Changelog                                           |                    85,723 |                 21,546 |
| Page worker                                         |                    62,877 |                 58,398 |
| Walkthrough open image                              |                    59,085 |                 59,085 |

The complete final largest-entry ranking is in the JSON receipt. Every
packaged JavaScript byte matches the final production build; all **29** UI and
manifest locale files match both the exact stage and their source values.
The universal helper is executable and `file` identifies both x86_64 and
arm64 Mach-O architectures. Its SHA-256 is
`97d8d06dab53a91696cdaa82ab1a33b9d12709cc8486b42945b29a8bf45925a5`.

`npm run package:acp` and `node scripts/package-acp-test.mjs` exit 0. The
production tarball is **1,088,347 bytes / 29 entries**; the private unsigned
fake-only tarball is **1,152,464 bytes / 30 entries**. Both contain the
shared parser and exact committed schemas. The production tarball has no
test launcher; the fake variant is marked private, uses its distinct name/bin,
and leaves the product tarball's digest unchanged. Digests and inventories
are recorded in [train-0.13.0-result.json](train-0.13.0-result.json). Nothing is
published. Fresh native builds, installed-editor/hosted OS acceptance and
M80's pending live receipts remain outside this Kubuntu gate.

## PR description

Title: Fit the integrated 0.13.0 train under startup and universal VSIX caps

The combined train exceeded the chat startup and VSIX caps. Defer Account &
usage, Agent map, best-of-N, history, session board and edit review with
accessible loading/cancellation, and count every eager browser chunk. Share
the used Node validation API; stage compact shipped JSON and shorter landing
docs with links to the complete source guides/history. Preserve runtime
features, consent/security guards, privacy, skills, notices and native helpers.
The reviewed #116, #87, #118, #119, D78 defaults and M92/M92e integrations
remain intact, with their merge history preserved.

Webview startup: **928,507 → 898,355 bytes**, **23,245 bytes** of headroom.
CI-shaped VSIX: reconstructed **2,450,044 → 2,206,151 bytes**,
**46,649 bytes** of headroom, including the actual universal
0.12.1 helper. All existing caps are unchanged. The Node parser sharing
reduces archive duplication but increases activation plus parser by 22,911
raw bytes; the full source docs remain linked, with less offline history
in the package.

Validation at implementation `3e04f6f5d3fbf354db27338a5ec26321ceace154`: complete
`npm run quality` exits 0; 7,782 tests pass with 65 existing skips, coverage
clears all unchanged thresholds, and all 564 accessibility pages pass.
Audit, history secret scan, Semgrep, production/package guards and both ACP
package inventories pass. **20 deliberate regression drills** fail and restore
exactly. Hooks remain on. Manifest version is unchanged; fresh hosted/native
and pending M80 live acceptance remain external. Local commits only; no push
or publication.
