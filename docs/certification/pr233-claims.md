# PR #233 follow-up (lane PR233W2) — review-thread triage and fixes

Branch `docs/claims-truth-w2` from PR #233 (`docs/claims-truth`) at `bfdd2698ea`.
Each thread below is fixed at its cause on this branch unless noted. The lane
brief lists no hosted CI failures after the threads, so there is no CI-failure
line to answer beyond the gates the lane names.

## First result — one line per thread (recorded before the fixes landed)

- README.md:5381 (fake-backed tests): confirmed — `test/unit/marketplaceHook.test.mjs`
  drives the real badge Worker against a hand-written KV object, the fourth case of
  `test/e2e/schedulesStdio.e2e.test.ts` writes a hand-written scheduler bundle, and
  `test/packaging/moduleExports.test.mjs` exercises dist bundles with hand-written
  services; none is caught by the `vi`-only eslint gate. Fix: delete the fakes.
- PLAN.md:24547 (M100 sender side): confirmed — `src/core/team/remotePool.ts` holds the
  complete unwired sender-side `RemoteAccountPool` (offer/placement validation, route
  selection, claim admission, dispatch, sticky/limit state), not just the request
  contract. Fix: status names both unwired halves, in PLAN.md, entries.json and the
  regenerated roadmap.
- CHANGELOG.md:185 (oversized Retry-After): confirmed — `providerWaitMs` returns the
  provider value unbounded, `backoffMs` adds jitter to it whole, and every production
  `sleep` passes it straight to one `setTimeout`, which overflows past 2,147,483,647 ms
  to ~1 ms. Fix: chunk the transport wait so the full delay is honoured.
- docs/roadmap/entries.json:458 (ACP editors as shipped): confirmed — the M63 entry
  keeps `release: "0.10.0"` plus the `preview` ("usable, with documented limits") label,
  so the generator lists it under Shipped, while its own summary says no named editor
  has held a real conversation. Fix: drop the release/Preview metadata so the item
  leaves Shipped; it returns only after a real conversation is certified.
- Hosted CI failures: none listed in the lane brief; the lane gates (format, eslint
  zero warnings on changed files, typecheck, check:plan, check:l10n, build, touched
  suites) are run on the final tree and recorded below.

## Fixes

- README.md:5381: `test/unit/marketplaceHook.test.mjs` deleted (the whole file drove
  the badge Worker against a hand-written KV object; the Workers runtime KV it needs
  does not run in the unit suite). The fourth case of
  `test/e2e/schedulesStdio.e2e.test.ts` deleted (it wrote a hand-written scheduler
  bundle; the three remaining cases run the real built CLI). `exercise()` and every
  hand-written service deleted from `test/packaging/moduleExports.test.mjs`: the test
  now only loads each dist bundle by import and by require and asserts the packaged
  exports equal the freshly built baseline's. `infra/marketplace-hook/README.md` no
  longer claims the counter routes are unit-tested.
- PLAN.md:24547: the M100 status names both unwired halves — the receiving admission
  check (`src/host/devices/deviceReceiver.ts`) and the sender-side `RemoteAccountPool`
  (`src/core/team/remotePool.ts`, validated against the class: offer/placement
  validation, route selection, claim admission, dispatch, sticky/limit state) — and
  the M100 roadmap entry says the same; `ROADMAP.md` regenerated.
- CHANGELOG.md:185: `RequestTransport.pause` (`src/core/backends/modelapi/transport.ts`)
  now sleeps delays past Node's timer maximum (`NODE_MAX_TIMEOUT_MS` in
  `src/shared/constants.ts`) in whole pieces, so the full provider wait is honoured;
  ordinary delays still sleep once and an already-cancelled wait still refuses at once.
  Both retry sleeps and the pacing wait funnel through `pause`, so every production
  `sleep` supplier is covered. The changelog claim stands as written.
- docs/roadmap/entries.json:458: the M63 entry drops `release: "0.10.0"` and the
  `preview` label, so the generator lists ACP-editor support under In progress instead
  of Shipped; it returns only after a real conversation through the packed agent is
  certified. M62 keeps its release: VSCodium, Cursor, Devin Desktop, Kiro and Positron
  integration tests prove the feature there; only Theia/code-server are qualified.

## Drills

- `test/unit/modelApiRetryWait.test.ts` (new, 3 tests) ran against the unchanged
  transport first: the oversized-wait case failed (single unbounded sleep), the other
  two passed. After the fix all three pass. It uses a recording `sleep` and never
  waits real time.
- `test/e2e/schedulesStdio.e2e.test.ts`: 3 passed after the fake-bundle case was cut.
- `test/packaging/moduleExports.test.mjs` (`vsix .` against the fresh `dist/`): 90
  passed, 0 failed after the fake services were cut.

## Gates (final tree, repo timeout throughout)

- prettier `--check` on every changed file: clean.
- eslint `--max-warnings=0` on every changed code file: clean (the hook also refused
  an intermediate commit on `unicorn/consistent-class-member-order`; the helper moved
  with the other private methods and the commit landed after).
- `npm run typecheck` (all five projects): exit 0.
- `npm run check:plan`: 218 milestones, 0 drift. `node scripts/check-l10n.mjs`:
  0 problems. `npm run check:roadmap`: current.
- `npm run build`: exit 0.
- vitest `test/unit/modelApiRetryWait.test.ts` + `test/e2e/schedulesStdio.e2e.test.ts`:
  2 files, 6 tests, all passed.

Boundary: `test/` still mentions "fake" elsewhere (fixture names, refusal inputs);
only the three thread-named fakes were in scope. A full hand-written-double audit of
`test/` was not attempted.
