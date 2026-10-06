# TRAIN15A — 0.15.0 release batch

Worktree `/home/randy/lanes/TRAIN15A`, branch `release/train-0.15.0`,
base `6a0207c1` (0.14.1 / PR #123). Integration runs directly on Kubuntu.
The brief authorizes the five ordered merges only; the two unfinished inputs
and full quality remain for the continuation. No push, rebase, live/paid model
call, credential access or gate/cap changes.

The CI-shaped VSIX uses the actual universal helper extracted from the shared
0.13.0 archive after verifying its adjacent SHA256SUMS. The helper is
289,568 bytes at SHA-256
`f42e757a0d78a6bc6a6af22c3bcf34fc7d082eb9e8130d9336024a55c19f0f36`;
it remains executable. Native compilation/runtime on macOS is external proof.
Local badge checks use the supported named network-only skip because shared
rules prohibit public network requests; all static and exact-stage checks run.

**Disposition: budget stop after M101; this batch is not release-certified.**
Steps 3–5 and both unfinished inputs remain unmerged. The integration brief
requires this stop; common.md stops the shared-browser recovery path after
two failed bounded fixes. Full quality is explicitly reserved for continuation.

## Stage 1 — VSIX diet and native exports

Merge `583e67a87`, input `perf/vsix-diet-2-fix` at `be00b1729`; seven conflicts:
`CHANGELOG.md`, `PLAN.md`, `README.md`, both product packagers,
`execStdio.e2e.test.ts` and `vsixPackaging.test.mjs`. Retain all plan records;
keep base released changelog bytes and incoming Unreleased fixes/changes.
Packagers keep static badge rendering/checks and both archives plus native
import/require export checks. Fixtures keep the release's fake badge renderer
and the diet's source-built English and archived-runtime inputs. README keeps
the npm landing-page/guide distinction and documents archive/export checks.
Host API inventory is regenerated. No new product guard is added;
inherited gate-fire drills remain in `vsix-diet-2.md` and `badgefix.md`.

Production package, original bundle/split/global caps, staged localization,
static badges and all 34 native VSIX module checks pass. Universal VSIX:
**2,027,388 bytes**, **225,412 bytes headroom**; startup/host/ACP byte counts
are identical to the base. Scoped validation is recorded after completion.

All five typecheck projects, scoped ESLint/Prettier, localization (14 tables,
zero problems) and regenerated host API checks pass. Six complete owning
files pass **156 tests**: VSIX packaging, English regions, localization,
headless stdio, fake-only launcher and badges. The initial headless batch
failed 23 cases because its fixture lacked the new native checker; the
fixture now verifies an actual ACP tar and its core members, and all 38
stdio tests pass. No assertion, deadline or skip was weakened.

Actual ACP packaging passes all **15 native module checks**. The archive
wrappers exposed a separate VM-checker compatibility gap: its intercepted
require lacked native `resolve` and `cache`. Forward both while retaining
English-load observation and the release's exact canonical combined CLI help
(the retired `acpUsageSetup` is not resurrected). The restored actual bundle/CLI
check passes. Two deliberate checker regressions fail and restore byte-exact:
remove native require metadata; duplicate the expected help block. SHA-256
receipts are in `train-0.15.0-drills.json`. A preliminary absent-key help
mutation was ineffective because join/trim discarded it; the corrected duplicate
block mutation exits 1. Existing input drills retain their provenance.

## Stage 2 — M101 candidate and budget stop

Input `m101/int` at `a2ac739f2`, including its provider ancestry. Twenty-five
conflicts are resolved: `.vscodeignore`, changelog, plan, manifest, all 17
manifest-language tables, bundle-size gate, Model API host/tools, constants,
App and Palette. Keep the runtime archive and shared validation allowlist;
union real translated manifest keys and the shell pass-through/provider/
automatic-compaction settings. Keep all decisions and milestones, released
changelog bytes and the two bounded Highlights. The shell's captured admission
origin remains alongside strict optional-argument restoration; both ToolContext
fields and every credential-name family remain. App keeps deferred handoff
and Setup; Palette keeps the shared list shell with provider groups and notes.
Keep the original aggregate deferred caps and the incoming independent bundle
caps. Regenerate host APIs and third-party notices with their scripts. No help
reference/catalogue generator is present on this tree. No wire shape is invented.

The initial build finds the two new raster packages missing from the rig install.
Run the merged lockfile's `npm ci --ignore-scripts` in an owned private prefix,
then install that fresh directory at the root so existing exact split paths
remain valid. Preserve the entire previous installation unchanged in ignored
`temp/train15a/original-node_modules`; no previous descendant is edited. The
fresh install adds 901 packages and reports the existing 11 advisories
(2 low, 9 high); this is an install receipt, not a new audit certification.
No package pin, peer range, dependency or policy exception is changed by this
integration beyond the exact reviewed input. Hooks remain installed and active.

Merged Model API initially measures **486,502**, **102 bytes** over its cap.
Sharing its existing build-generated model-text decoder saves **164 bytes**
and restores **486,338 / 486,400**. Exact values, literal keys and dead-block
elimination retain their existing owning tests. The Models size gate also counts
transitive static imports at its existing 475-KiB cap; a regression exercises
the exact bound and one byte over independently of the chat/deferred budgets.

The first universal VSIX is **2,368,627**, **115,827 bytes** over. Try the
existing ESM mechanism with chat and Models as independent entries sharing React,
English and helpers. Models' entry falls **391,260 → 43,205 bytes**, but the
readership guard rejects Review text reaching Models via constants. A generated
Review-only block keeps its exact canonical source with its actual reader; the
original deferred cohort then exceeds 50 KiB. Removing an extra module leaves
**51,257 (+57)**; sharing two identical unknown-paid-tally paragraphs leaves
**51,210 (+10)**. Common.md requires stopping after two bounded fixes to the
same failing path. Restore the separate build and original UI source, rather
than changing a cap, reader declaration, feature, threshold or package ignore.
The attempted shared build is not shipped or certified; its printed red receipts
remain in ignored `temp/train15a/` and the lane tool transcript.

Fresh restored `npm run package` passes production size/split/global/notices,
exact staged localization, static badges and **37 native module checks**; it
exits **1 only at VSIX size**, **2,368,747 / 2,252,800**, **115,947 bytes over**.
No live/paid model attempt occurs. This is the brief's explicit stop condition;
M96, its Windows fixture/publication follow-up and M97/NVDA are not merged.
The lead's next action is a further size-recovery decision, followed by the
remaining ordered inputs and the eventual full quality/platform gate.

All five typecheck projects pass. Changed-file ESLint and Prettier pass;
localization reports **14 tables, 172 manifest strings, 656 source files,
zero problems**; regenerated host API and versioned exec schemas pass.
All **92 complete owning files / 3,661 tests** pass, **zero skips**, in 31
sequential batches of at most three files with three workers and the brief's
120-second test admission. Exact filenames and counts are in the JSON receipt.
No full quality, coverage threshold or deadline change is made.

Initial diagnostics expose stale fixtures, not a reason to alter production
policy: add SearchJob's required character limit; import the shared credential
classifier from its current core location. The provider threat suite's old
`CI_TOKEN` allowance now asserts that both spellings are fenced, runtime children
lose it, and even a hook grant cannot expose it. The browser size fixture now
copies the real Models metafile. The 50-KiB aggregate fixture represents an
unclassified shared chunk, so it exercises that original allowance independently
of the inherited 25-KiB individual surface caps; both caps remain enforced.
Initial scoped failures are one provider assertion, three missing-metafile cases,
and one aggregate fixture; each complete owning batch passes after repair.
The initial lint error on an object-valued default is fixed in the test fixture;
no rule or ignore changes.

Three deliberate regressions each exit 1: corrupt the shared model-text decoder;
bypass Models' static-import counting; omit token suffixes from the shared
credential classifier. Restore each source byte-exact by SHA-256, then rerun
all three complete suites: **88 tests pass**. Combined with stage 1 there are
**five effective red/restored drills**, recorded in `train-0.15.0-drills.json`.
Inherited inputs retain their own original drill records.

Actual `npm run package:acp` passes its schema check, exact-stage localization,
static badges and **16 native module checks**, and the installed ACP bundle/CLI
shared-English check passes. Its notices contain seven runtime packages.
The final rebuild is byte-identical to the measured bundle rows; production
size, split/readership and host-global checks pass again. The separate VSIX
size failure remains exactly **115,947 bytes**. Packaging's public SVG-response
proof and macOS/Windows/hosted/live receipts remain external, as stated above.
The M101 merge keeps first parent `583e67a87` and second parent `a2ac739f2`;
its actual local commit is available from the branch history and final report.

## Exact per-stage bytes

All bundle counts are raw; startup includes every eager script/chunk. VSIX
counts are complete compressed archives with the verified universal helper.

| Stage                   | extension.js | modelApi.js | Chat startup |     ACP | Universal VSIX | VSIX headroom |
| ----------------------- | -----------: | ----------: | -----------: | ------: | -------------: | ------------: |
| Base 0.14.1             |      448,871 |     457,597 |      811,197 | 837,807 |      2,246,558 |         6,242 |
| Diet / step 1           |      448,871 |     457,597 |      811,197 | 837,807 |      2,027,388 |       225,412 |
| M101 / step 2 (blocked) |      456,846 |     486,338 |      797,553 | 843,696 |      2,368,747 |      -115,947 |
| Unchanged caps          |      614,400 |     486,400 |      921,600 | 870,400 |      2,252,800 |             — |

Steps 3–5 have no measurement because the explicit budget stop prevents them.
Current original deferred JavaScript is **51,114 / 51,200** bytes; highlighting
**95,366 / 128,000**, action dialogs **9,360 / 25,600**, Tasks **1,375 / 25,600**.
Models is **391,260 / 486,400**, including all static imports.

## Largest twenty current VSIX entries versus the base

Counts below are exact ZIP compressed payload bytes. Hash-named chunks are
compared by literal filename: renamed chunks appear as added/removed entries,
not inferred same-function matches. The JSON receipt includes every raw and
compressed literal-path delta, removed entries, both largest-entry/delta rankings,
complete archive bytes, hashes and ZIP overhead. Archived Node code must be read
together with its old individual modules when attributing feature growth.

| Entry                                         | Base compressed | M101 compressed |    Delta |
| --------------------------------------------- | --------------: | --------------: | -------: |
| `extension/dist/runtime.bundles.json.br`      |               0 |         493,453 | +493,453 |
| `extension/l10n/ui.tables.json.br`            |         434,950 |         480,293 |  +45,343 |
| `extension/dist/webview/models.js`            |               0 |         158,279 | +158,279 |
| `extension/dist/extension.js`                 |         143,562 |         145,920 |   +2,358 |
| `extension/dist/webview/main.js`              |         111,600 |         112,534 |     +934 |
| `extension/native/darwin/muse-dictate`        |          81,327 |          81,327 |       +0 |
| `extension/dist/webview/chunks/DBBHZL53.js`   |               0 |          74,235 |  +74,235 |
| `extension/dist/webview/chunks/JSHTFNK4.js`   |               0 |          50,324 |  +50,324 |
| `extension/resources/walkthrough/open.png`    |          59,085 |          41,302 |  -17,783 |
| `extension/dist/uiText.js`                    |          34,191 |          38,024 |   +3,833 |
| `extension/resources/walkthrough/chat.png`    |          46,165 |          36,961 |   -9,204 |
| `extension/dist/webview/chunks/BFLAA6JG.js`   |          30,649 |          30,649 |       +0 |
| `extension/dist/providerCatalog.json`         |               0 |          25,930 |  +25,930 |
| `extension/dist/webview/chunks/V5SDXEBW.js`   |               0 |          23,017 |  +23,017 |
| `extension/docs/PRIVACY.md`                   |          21,242 |          21,242 |       +0 |
| `extension/resources/walkthrough/sign-in.png` |          27,799 |          19,418 |   -8,381 |
| `extension/resources/walkthrough/welcome.png` |          25,286 |          17,744 |   -7,542 |
| `extension/changelog.md`                      |           9,863 |          16,991 |   +7,128 |
| `extension/package.nls.ru.json`               |          12,762 |          13,172 |     +410 |
| `extension/dist/validation.js`                |          11,978 |          11,993 |      +15 |

Exact machine-readable receipt: [train-0.15.0-artifacts.json](train-0.15.0-artifacts.json).
