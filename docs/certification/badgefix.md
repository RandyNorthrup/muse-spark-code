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

Production build, archive inspection, deadcode, duplication and final format
verification follow this implementation commit and will be recorded here.
The shared lane brief prohibits aggregate quality; full integrated quality,
coverage and actual hosted SVG/cache responses remain the lead's release proof.
No existing threshold, timeout, retry or gate was lowered. The compiled universal
macOS helper is not available in this Kubuntu worktree.
