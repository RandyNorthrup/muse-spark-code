import { availableParallelism } from 'node:os'
import { defineConfig } from 'vitest/config'

// The coverage number measured fake-driven tests, so the gate is gone with
// the overhauled suite: test:unit runs without --coverage and no threshold
// applies. Entry points (extension.ts, webview/main.tsx) are exercised by the
// integration tests instead and stay excluded from collection below.

// V8 coverage and the native Git/process suites contend with large DOM/PDF
// fixtures. Bound simultaneous files; deadlines and gates stay intact.
// Hosted macOS runners have 3 vCPUs: four workers plus coverage oversubscribed
// them and test times swung past deadlines between runs (2026-10-07). Leave
// one core to the main process; rigs keep the measured cap of three.
const MAX_TEST_WORKERS = 3
const TEST_WORKERS = Math.max(1, Math.min(MAX_TEST_WORKERS, availableParallelism() - 1))
// Windows runs files one at a time (below), and its tests that do real OS work
// start PowerShell, icacls or job helpers, each a cold process start. Hosted
// Windows shards varied from 456 s to 727 s between runs (2026-10-07), so
// such cases passed 5 s in one run and not the next. Windows gets a wider
// default for every case and hook; assertions are unchanged. PLAN.md §8.
const WINDOWS_TEST_TIMEOUT_MS = 15_000
const WINDOWS_HOOK_TIMEOUT_MS = 30_000
// Hosted macOS (3 vCPU arm64) ran two files at once beside their Chrome
// processes and coverage. 0.17's rounds 3-5 failed there only on deadlines in
// browser/process suites, a different case each run (CIFIX017). It runs one
// file at a time like Windows, over six shards: the per-file total of run
// 38022741513 was 2,239 s, about eight minutes a shard. Rigs keep parallel files.
const IS_HOSTED_MAC = process.platform === 'darwin' && process.env['GITHUB_ACTIONS'] === 'true'

export default defineConfig({
  test: {
    include: [
      'test/unit/**/*.test.{ts,tsx,mjs}',
      'test/e2e/**/*.test.ts',
      'test/m104/{runtime,engines,ui}/**/*.test.{ts,tsx,mjs}',
    ],
    environment: 'node',
    setupFiles: ['test/unit/setup.ts'],
    // Once-per-run artefacts shared by suites (inject()), built before workers start.
    globalSetup: ['test/unit/globalSetup.mjs'],
    // Windows MCP process suites start PowerShell job helpers. On the small
    // hosted runner, concurrent files delayed launches past real MCP deadlines.
    fileParallelism: process.platform !== 'win32' && !IS_HOSTED_MAC,
    // Spread, not `maxWorkers: undefined`: exactOptionalPropertyTypes rejects it.
    maxWorkers: TEST_WORKERS,
    ...(process.platform === 'win32' && {
      testTimeout: WINDOWS_TEST_TIMEOUT_MS,
      hookTimeout: WINDOWS_HOOK_TIMEOUT_MS,
    }),
    coverage: {
      provider: 'v8',
      // Source files only: a bare `src/**` also feeds src/webview/tsconfig.json
      // to the coverage remapper, which cannot parse JSON.
      include: ['src/**/*.{ts,tsx}'],
      // Entry points are exercised by the integration run (a real VS Code),
      // not by unit tests; the process adapter that spawns `muse serve` is
      // covered by the e2e suite against a real child process (test/e2e),
      // and the ACP agent's entry by the e2e suite over its stdio (M63).
      exclude: ['src/extension.ts', 'src/webview/main.tsx', 'src/runtime/main.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov'],
    },
  },
})
