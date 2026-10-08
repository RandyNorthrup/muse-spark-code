import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Coverage thresholds are gates. When a threshold flags a branch as
// unreachable, the branch is probably dead: delete it rather than lowering the
// number. Entry points (extension.ts, webview/main.tsx) are exercised by the
// integration tests instead and excluded here.
const COVERAGE_THRESHOLDS = {
  statements: 90,
  branches: 85,
  functions: 90,
  lines: 90,
} as const

// V8 coverage and the native Git/process suites contend with large DOM/PDF
// fixtures on macOS. Bound simultaneous files; deadlines and gates stay intact.
// Hosted macOS runners have 3 vCPUs: four workers plus coverage oversubscribed
// them and test times swung past deadlines between runs (2026-10-07). Leave
// one core to the main process; rigs keep the measured cap of four.
const MACOS_MAX_TEST_WORKERS = 4
const MACOS_TEST_WORKERS = Math.max(1, Math.min(MACOS_MAX_TEST_WORKERS, availableParallelism() - 1))
// Windows runs files one at a time (below), and its tests that do real OS work
// start PowerShell, icacls or job helpers, each a cold process start. Hosted
// Windows shards varied from 456 s to 727 s between runs (2026-10-07), so
// such cases passed 5 s in one run and not the next. Windows gets a wider
// default for every case and hook; assertions are unchanged. PLAN.md §8.
const WINDOWS_TEST_TIMEOUT_MS = 15_000
const WINDOWS_HOOK_TIMEOUT_MS = 30_000

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` only exists inside the extension host. Unit tests get a
      // hand-written mock that is type-checked against @types/vscode.
      vscode: fileURLToPath(new URL('test/unit/mocks/vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/unit/**/*.test.{ts,tsx,mjs}', 'test/e2e/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/unit/setup.ts'],
    // Windows MCP process suites start PowerShell job helpers. On the small
    // hosted runner, concurrent files delayed launches past real MCP deadlines.
    fileParallelism: process.platform !== 'win32',
    // Spread, not `maxWorkers: undefined`: exactOptionalPropertyTypes rejects it.
    ...(process.platform === 'darwin' && { maxWorkers: MACOS_TEST_WORKERS }),
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
      // A shard collects a partial map; the mandatory --merge-reports job
      // applies these unchanged thresholds once to the complete map per OS.
      ...(process.argv.every((arg) => arg !== '--shard' && !arg.startsWith('--shard=')) && {
        thresholds: COVERAGE_THRESHOLDS,
      }),
      reporter: ['text', 'lcov'],
    },
  },
})
