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
