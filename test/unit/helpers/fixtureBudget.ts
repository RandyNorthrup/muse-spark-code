// The time a hook has to build its fixtures: bundles (esbuild), compiled
// helpers and the real processes it starts. That is work, and it grows with
// the product; it is not a wait for something to become ready, so it does
// not belong under Vitest's default hook limit of 10 s.
//
// test/e2e/acpStdio.e2e.test.ts is the measure: its hook lays out the ACP
// package (seven bundle builds and the created-path helper). On the Mac mini
// at load 26 to 64 those builds took 1.3 to 2.2 s (four runs). On hosted
// macOS (3 vCPU, coverage on) the same hook passed 10 s in three of four
// attempts of 0.17.1's pull request, before any assertion ran.
//
// One budget for every such hook, the figure this repository's build and
// real-git hooks already use (REAL_GIT_TIMEOUT_MS). Cases keep their own
// deadlines and no assertion depends on it. PLAN.md §8.
export const FIXTURE_HOOK_TIMEOUT_MS = 120_000
