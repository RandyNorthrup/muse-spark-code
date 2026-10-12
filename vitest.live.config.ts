import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The opt-in live drills bill the owner's own accounts (subscription, Model
// API key) and need the real machine: the real sign-in, the installed CLI,
// its trace folder. There is deliberately NO setupFiles redirect here, and
// no shared-build global setup (they drive the real CLI, not fixtures).
export default defineConfig({
  resolve: {
    alias: {
      // `vscode` only exists inside the extension host. The drills get the
      // same hand-written mock the unit suite uses.
      vscode: fileURLToPath(new URL('test/unit/mocks/vscode.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/e2e/live.e2e.test.ts', 'test/e2e/*.live.e2e.test.ts'],
    environment: 'node',
    // One drill at a time: each spawns the real CLI and bills its own turn.
    maxWorkers: 1,
  },
})
