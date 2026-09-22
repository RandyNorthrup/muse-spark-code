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

export default defineConfig({
  resolve: {
    alias: {
      // `vscode` only exists inside the extension host. Unit tests get a
      // hand-written mock that is type-checked against @types/vscode.
      vscode: fileURLToPath(new URL('test/unit/mocks/vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['test/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      // Source files only: a bare `src/**` also feeds src/webview/tsconfig.json
      // to the coverage remapper, which cannot parse JSON.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/extension.ts', 'src/webview/main.tsx', 'src/**/*.d.ts'],
      thresholds: COVERAGE_THRESHOLDS,
      reporter: ['text', 'lcov'],
    },
  },
})
