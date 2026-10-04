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
PR/main-push runs only, complete nonexpired artifacts, recorded hashes and both
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
The lead must finish these controls and the full/hosted gates before certification.
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
Fork/manual/wrong-tree runs must not be admitted. Original runs without the
receipt always rebuild. After any channel has published, preserve its original
bytes and follow the existing recovery guide instead of forcing a rebuild.
