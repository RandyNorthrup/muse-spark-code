import { defineConfig } from '@vscode/test-cli'

// Integration tests run inside a real VS Code (Extension Development Host).
// `npm run build:dev` bundles test/integration/**/*.test.ts to
// dist/test/integration first. On Linux CI this runs under xvfb-run.
const MOCHA_TIMEOUT_MS = 20_000

export default defineConfig({
  files: 'dist/test/integration/**/*.test.js',
  version: 'stable',
  workspaceFolder: './test/fixtures/workspace',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: MOCHA_TIMEOUT_MS, color: true },
})
