# RELFAST — reuse the CI release build (2026-10-04)

Base: `0be1d6c4dac91841508fa9b7689b7375ee3d4d74`, branch
`ci/release-reuse`, worktree `C:/Users/Randy/Coding/mx-relfast`.

## Readiness and scope

Reviewed RELFAST/common, AGENTS, PLAN D6/D29/M26, both workflows and their CI
caller, registry publishing/channel summary, release guide and owning tests.
The design was written into the release guide and the existing M26 section
before implementation. The existing reusable build, artifact names, publishing
steps, least-privilege environments and channel reporter are retained. One
release-only script is needed to validate API responses, find the actual checkout
tree receipt and compare downloaded bytes; no dependency or product UI changes.

Acceptance covers tag checks first, exact merge-tree identity, own successful CI
PR/merge-group/main-push runs only, complete nonexpired artifacts, recorded hashes and both
package versions, fallback on every miss, skipped-build dependency handling,
30-day retention and a forced rebuild. The lookup is bounded to 300 successful
runs and a two-minute request budget. Infrastructure failure while installing
tools or staging already-verified artifacts fails the job rather than publishing.

The feature skill's snapshot validator reported that the existing canonical
PLAN lacks its `quality-ledger` fence. Structured skill validation is deferred;
this bounded lane preserves the project's own plan/certification format and
records the manual readiness review here.

## Verification

No full quality, hosted workflow, publication or paid call is run by this lane;
the brief assigns aggregate and hosted proof to the lead.

Windows checks completed with exit 0:

- `npx tsc -p . --noEmit`, `npx tsc -p test/unit --noEmit`, and the webview,
  e2e and integration compiler projects (before dependency isolation).
- `npx eslint --max-warnings=0 scripts/release-reuse.mjs
test/unit/releasePublish.test.mjs test/unit/manifest.test.ts`.
- `npm run deadcode` (one existing `vendor/**` configuration hint), `npx jscpd`
  (zero clones), `npm run check:l10n` (14 tables, zero problems).
- `actionlint .github/workflows/build.yml .github/workflows/release.yml`.
- `npm run check:host-api` (zero problems), `npm run build` (all existing
  size/split/global/notice gates pass; 83 bundled dependency notices).

Build measurements: extension 590.6 KiB, Model API 430.1 KiB (the checkout's
existing 475 KiB budget), checkpoint store 135.7 KiB, ACP 800.9 KiB, webview
860.5 KiB. No budget changes and no local universal VSIX claimed.

The initial shared dependency junction pointed at another lane; its Prettier
Markdown plugin disappeared during the host API check. Only this worktree's
junction was removed, then `npm ci --ignore-scripts --no-audit --no-fund`
installed 898 local packages. Host API and build then passed. Observed local
pins: Node 24.20.0, TypeScript 6.0.3, Vitest 5.0.2, ESLint 10.11.0, Prettier 3.9.9.
No other worktree or dependency target was changed.

Synthetic ZIP/tar smoke checks exercised real `unzip`/`tar`, recorded all four
SHA-256 hashes and the independent Git tree, accepted matching manifests and
refused the wrong tag through the actual CLI. The tree-vs-commit and tag-version
guards each produced wrong behavior when deliberately removed, then passed
again after SHA-256-exact restoration. Both complete owning files pass after restoration: 78 release tests and 24
manifest tests (102 total), on Windows with the isolated pins. Fourteen isolated
unit guard removals and two independent real CLI controls passed; every changed
source SHA-256 was restored byte-exact. Receipts: [relfast-drills.json](relfast-drills.json).
Raw per-control logs remain in `dist/relfast-drills/`.

**Timebox remainder:** 19 deliberate controls remain: hash-inventory, directory-inventory, asset-hash, vsix-version, acp-version, vsix-identity, acp-identity, force-rebuild, verification-fallback, tag-first, cross-run, read-permission, download-fallback, verification-step, staging-guard, build-fallback, skipped-build, ci-receipt, retention.
All associated behavior tests pass, but these remaining guards are not yet
certified by deliberate removal. A further critical batch could not be counted:
its log writer failed on Windows encoding; its source was restored byte-exact.
This was the first RELFAST checkpoint; RELFAST2's results below supersede its
pending-control list. Full/hosted gates remain lead-owned.
Formatting and pre-commit lint/secret checks run with the commit hooks enabled.

The existing publishing/attestation/channel-summary workflow body is byte-exact
with the base, SHA-256
`db234f266f01e0f05b900f95e2343e5e47ef45148d6a11f8e89163b39c1c4123`.
Only the release dependency/condition changes so a deliberately skipped build
can feed the unchanged publishing steps.

## Hosted follow-up

The lead must observe a successful own-repository PR build with the new receipt,
release reuse of the same tree and matching downloaded package hashes, and a
forced or missing-artifact fallback running the complete three-platform build.
Fork/manual CI/wrong-tree runs must not be admitted to automatic reuse. Original CI runs without the
receipt always rebuild. After any channel has published, preserve its original
bytes and follow the existing recovery guide instead of forcing a rebuild.

## RELFAST2 readiness and combined design

Read RELFAST2/common, prior handoff and certification, local branch state,
PR #107's workflow/changelog changes, existing M26 plan and owning tests.
The feature skill inventory succeeded. Its snapshot validator again reports
`plan: expected exactly one quality-ledger fence`; structured skill validation
remains deferred because this lane preserves the canonical project format.
Manual review maps the requested merge/recovery, cancellation, merge-queue
admission and remaining drills to M26, both workflows, the existing script and
both owning test files. No new dependency, module or product/UI scope.

The local `origin/main` merged is `bd1aafd8` (PR #107). Resolve both conflicts by
retaining main's released 0.12.0 section and combining manual recovery with
automatic reuse. One reuse job validates the source, downloads, checks and stages
bytes. Publishers download current-run artifacts only, never the raw recovery
input. Tag pushes admit successful own-repository `ci.yml` PR, `merge_group` and
main-push runs by the recorded actual checkout tree; missed verification rebuilds.
Recovery pins a completed own-repository Release on the same version tag with
all seven successful build jobs. It checks the earlier commit's tree when a
receipt exists, so an intervening workflow/changelog-only fix can retain the
original bytes. Pre-receipt sources remain eligible with inventory and package
identity/version checks plus the download action's integrity reporting, without
claiming historical per-asset CI hashes. Recovery misses fail closed and cannot
trigger the build. Every publishing/summary job uses `!cancelled()`; the release
condition explicitly handles a skipped build and successful verified reuse.

The existing 19 pending controls and the added recovery/merge-queue/cancellation
drills are recorded separately in [relfast2-drills.json](relfast2-drills.json),
preserving the first checkpoint's historical hashes. Each mutation is restored
with its original bytes in `finally` and SHA-256 compared; complete owning files
run before and after the drill batch. Raw outputs remain in
`dist/relfast2-drills/`. These are local workflow/behavior checks; hosted automatic
reuse, legacy recovery, forced fallback and the CIFLOW merge-queue integration
still require the lead's proof. No push, tag, workflow dispatch or paid call.

## RELFAST2 final local results (2026-10-04)

All 19 original controls and 17 added controls passed: 36 total, zero pending.
The final restored complete suites pass on Windows: 93 release tests and 26
manifest tests (119 total). Workflow wiring uses the full owning Vitest file;
added recovery guards also use independent assertions through the actual module
or actual CLI, with each probe passing before mutation, rejecting the deliberate
defect, and passing after byte-exact restoration. No Vitest test is filtered or
skipped, no timeout or threshold changes. Actual argv, observed assertion
diagnostics, source/log digests and before/mutated/after hashes are in the JSON.

A contended Windows CLI deadline invalidated an early recovery drill; its raw
attempt is preserved and is not counted. Forced rebuild and bad-tag validation
now settle before invoking optional Git, proved by the CLI tests with an empty
PATH. An interrupted repository mutation was independently restored to the
recorded SHA-256 before resuming. Final restored suites and source digests are
verified after all controls. The private assertion harness is verification
material in `dist/`, not a new product module or shipped test package.

Main's 0.12.0 section and all older CHANGELOG sections are byte-identical in Git
text: SHA-256 `823f9ebac1240553b4284a46d8a8954f8980c4aa3d89127abbe05bdc8b9bb1c2`.
RELFAST2 uses the brief's scoped eslint/Prettier, release-test and actionlint
gates and enabled commit hooks. Fresh common.md aggregate compiler/dead-code/
duplication/localization/host-API/build checks are deferred to the lead under
the hard 60-minute box; unchanged production bundles are not recertified here.
The project-wide quality run and hosted releases remain explicitly unproved.
