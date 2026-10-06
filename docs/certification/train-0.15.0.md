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

Merge, scoped-check and size receipts are filled as each stage finishes.

## Stage 1 — VSIX diet and native exports

Input `perf/vsix-diet-2-fix` at `be00b1729`; seven conflicts:
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
