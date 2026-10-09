# BADGE017 — download badges and the badge Worker in the repository

Scope: `rel017/badges` from `fad4ddaef`. Owner request (2026-10-09): "put
download badges on the repo". README gains a total downloads badge and a
GitHub app installs badge, both badgen.net `/https` badges over the project's
Cloudflare Worker; the Worker source moves into `infra/marketplace-hook/`.
Nothing was deployed and no secret is in the repository.

## Decisions

- The app installs badge links to `#git-and-pull-requests`, the README section
  that describes the GitHub app; no link to the Marketplace listing while it
  awaits GitHub's review.
- `scripts/refresh-badges.mjs` discovers every non-raster README image and every
  camo image on the repository page, so the release refresh re-fetches and
  purges the two new badges without a code change. Count badges are not version
  badges, so they are fetched, never cache-busted. Only the pinned README badge
  counts in `refreshBadges.test.mjs` change (12 → 14 images, 6 → 8 badgen).
- The Worker is linted by the repository's ESLint as plain ESM with the Workers
  globals (`eslint.config.mjs`, no type-aware rules). The lint fixes are
  behaviour-preserving (`Response.json`, `else if`, awaited values in locals,
  numeric separators). knip's project includes `infra/**/*.js`. jscpd scans
  only `src` and `test` TypeScript, unchanged.
- Packaging: `.vscodeignore` is an allowlist (`**` then `!dist/...`), the npm
  ACP package (`scripts/package-acp.mjs`) copies named files into its stage, and no tsconfig includes `infra`, so the
  folder ships nowhere. `npm run build` passes with sizes unchanged (no `src`
  change; `dist/extension.js` 573.4 KiB).

## Tests and drills (kubuntu, repository default timeout)

- `test/unit/marketplaceHook.test.mjs` (new, 3 tests): the counter routes run
  against a fake KV in Node. The webhook (needs the Workers runtime's
  `crypto.subtle.timingSafeEqual`) and the downloads route (public APIs) are
  not unit-tested.
- Drill 1: `appInstalls` returned `n` instead of `Math.max(0, n)`; the test
  failed (`expected '-2' to be '0'`); restored, SHA-256 matched.
- Drill 2: removed the app installs badge from README; `refreshBadges.test.mjs`
  failed (`expected [ …(13) ] to have a length of 14 but got 13`); restored,
  SHA-256 matched.
- `readmeVersion`, `whatsNewContent`, `checkBadges`, `refreshBadges`,
  `vsixPackaging`, `marketplaceHook`: all pass.
- `npm run check:badges` with network: `Badges: 41 HTTPS images; SVG badges and
content images verified`. Live renders: `downloads: 4.1k`,
  `GitHub app installs: 0`.
- `npm run deadcode` (knip): exit 0. `npx jscpd`: one clone in the untouched
  `test/unit/modelApiLoopGuarantees.test.ts` (741–750 vs 890–899), present on
  the base; not from this lane.
