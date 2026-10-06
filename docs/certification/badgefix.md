# BADGEFIX — exact package-version badges

Kubuntu rig, `fix/store-badges`, base `2d4d72bd` (0.14.0), 2026-10-05.
No dependencies, runtime UI, model calls or credentials were added. The next
release bump needs no landing-page badge edit: packaging fills `{version}`
from the manifest; the unit fixture also verifies 0.99.2.

## Behavior and changed files

- `docs/marketplace-readme.md` has static Marketplace/Open VSX version templates.
  `scripts/package-vsix.mjs` fills and checks the staged README before VSCE packs it.
- `docs/npm-readme.md` has static npm and GitHub release version templates.
  `scripts/package-acp.mjs` fills and checks the staged README before npm packs it.
  npm weekly downloads remain dynamic.
- `README.md` keeps all dynamic versions/counts; its content images now have
  absolute HTTPS targets. `scripts/refresh-badges.mjs` discovers all 11 badges,
  including CI, and supports HTML, Markdown/reference images and new trusted
  services. Every badge GET precedes the existing camo PURGE pass. The release
  job and `docs/ci.md` describe that discovery; refresh still warns only.
- `scripts/check-badges.mjs` validates all three pages and exact staged bytes:
  HTTPS, pinned vsce trust policy even for extensionless SVG URLs, required
  static labels, no dynamic store versions and matching manifest versions.
  Public responses must be SVG XML with the SVG namespace, no error badge,
  and exact rendered static label/version. Raster images remain images and
  require an image content type. The existing jsdom XML parser supplies strict
  XML validation; no SVG parser or trust-list dependency was added.
- `package.json` and `.github/workflows/build.yml` run `check:badges` with quality
  and static CI. Local network skips require a printed, nonempty reason;
  the actual CI check and both packagers reject skips in CI.
- Owning regressions: `test/unit/checkBadges.test.mjs`,
  `test/unit/refreshBadges.test.mjs`, `test/unit/vsixPackaging.test.mjs`,
  `test/unit/acpNpmReadme.test.ts`. Documentation moves in README, CI guide,
  CHANGELOG and PLAN. No editor-specific runtime behavior changes.

## Focused gates and red drills

- Three owning files: 83 tests passed; ACP npm landing page: 3 tests passed.
  Runs used at most three files and `--maxWorkers=3 --testTimeout=120000`.
- All five `npm run typecheck` projects passed. Scoped ESLint, localization
  (14 tables, 0 problems) and host API inventory (0 problems) passed.
- Local `npm run check:badges` checks 34 unique HTTPS images. Network-only
  requests were skipped with the printed reason
  `rig lane public-network restriction; CI verifies SVG responses`.
- 23 red drills each failed and restored the changed file byte-exact, with
  matching SHA-256 before/after. [Machine-readable receipt](badgefix-drills.json).
  Real source mutations restored a dynamic Marketplace version badge and an
  old static Marketplace/npm version. Implementation mutations independently
  bypassed skip-reason/CI policy, HTTPS credentials, vsce trust, dynamic/static
  versions, required labels, HTTP status, HTTPS redirects, SVG content type,
  SVG namespace/root, doctype, error text and rendered version/label, raster
  content type, manifest rendering, reference discovery, complete refresh,
  exact staged README checking and staged manifest matching.
- The first namespace drill exposed masked fixtures: namespace/root/error/doctype
  cases also lacked the required static label/version. The fixtures now carry
  a valid label/version, so bypassing each individual guard fails its test.
  XML-malformation tests exercise jsdom's strict XML parse directly.

## Artifact/static gate receipt

- `npm run package` passed, including `npm run build`, all unchanged bundle
  size/split/model-text/host-global gates, staged localization (0 problems),
  the staged badge policy check and VSCE packaging. VSIX: **2,168,278 bytes**,
  below the unchanged **2,252,800-byte** limit.
- `node scripts/exec-schema.mjs --check` passed; `node scripts/package-acp.mjs`
  passed from that production build. ACP tarball: **1,295,446 bytes**, 37 files.
- Python zipfile/tarfile inspected the actual archive READMEs and manifests:
  both versions are **0.14.0**. VSIX badges are **Marketplace v0.14.0** and
  **Open VSX v0.14.0**; npm badges are **npm v0.14.0** and
  **GitHub release v0.14.0**. No unresolved token or dynamic version endpoint
  remains in either archived README. npm weekly downloads remain dynamic.
  [Artifact URLs, sizes and SHA-256 receipts](badgefix-artifacts.json).
- `npm run deadcode` exited 0 (two existing configuration hints);
  `npx jscpd` exited 0 with 0 clones; scoped Prettier passed.
- Measured build sizes: activation **436.7 KiB / 600 KiB**, Model API
  **446.6 KiB / 475 KiB**, checkpoint store **76.9 KiB / 225 KiB**,
  webview startup **893.2 KiB / 900 KiB**, ACP **816.8 KiB / 850 KiB**.
- Both package badge checks printed the same named network-only skip as the
  source check. All source/staged HTTPS, trust and version checks ran.
- Implementation commit `5b01b727` ran lint-staged and gitleaks with hooks on;
  formatting/lint passed and gitleaks found no leaks. No push, merge or rebase.

The shared lane brief prohibits aggregate quality; full integrated quality,
coverage and actual hosted SVG/cache responses remain the lead's release proof.
No existing threshold, timeout, retry or gate was lowered. The compiled universal
macOS helper is not available in this Kubuntu worktree.

## Release-train repair (0.14.1 PR #123, 2026-10-06)

The first hosted run of the 0.14.1 train was the first time the check read
real shields.io SVGs (the lane ran with the named network skip). Two defects
surfaced; both are fixed in this commit.

- **Rendered version never matched.** shields.io writes the label and the
  value as adjacent `<text>` nodes with no separator, so the SVG's joined
  `textContent` read `Marketplacev0.14.1v0.14.1` and the `\bv?\d+\.\d+\.\d+\b`
  scan found no version standing alone. `check:badges`, both packagers and every
  test shard that packs failed with "Badge rendered label/version mismatch".
  The check now reads each text node apart (a DOM tree walker) and joins them
  with spaces. The unit fake had a space-bearing `<title>` and `<text>`, which
  hid the defect; a new test uses shields.io's own layout (captured
  2026-10-06) and must also reject the same layout at the wrong version.
- **Semgrep blocked the hand-escaped trust-guard markup.** The `<img>` lines
  fed to vsce's `ReadmeProcessor` were escaped with `replaceAll`
  (`detect-replaceall-sanitization`, 2 blocking findings). They are now built
  with `createElement('img')`/`setAttribute('src', …)` and `outerHTML`, so the
  DOM serialiser escapes the attribute. A Markdown image with an angle-bracket
  destination was tried first and rejected: vsce read `<…>` as a relative path.

Evidence (Kubuntu, `~/lanes/TRAIN14A`):

- `npx vitest run test/unit/checkBadges.test.mjs`: 32/32 passed.
- **Break-on-purpose:** with the walker reverted to `svg.textContent`, the new
  test failed (1 failed, 31 passed); restored, 32/32.
- `node scripts/check-badges.mjs` against the live services:
  "Badges: 34 HTTPS images; SVG badges and content images verified".
- `semgrep scan --config auto --error` (1.177.0) on both files: no findings.
- Scoped eslint `--max-warnings=0` and Prettier: clean.
