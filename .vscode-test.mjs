import { tmpdir } from 'node:os'
import { defineConfig } from '@vscode/test-cli'
import { minimumVsCodeVersion } from './scripts/lib/vscode-engine.mjs'
import { launchArgsFor } from './scripts/lib/vscodeTestProfile.mjs'

// Integration tests run inside a real VS Code (Extension Development Host).
// `npm run build:dev` bundles test/integration/**/*.test.ts to
// dist/test/integration first. On Linux CI this runs under xvfb-run.
//
// Two runs (M26, PLAN.md D29): the latest stable release, and the oldest
// release the manifest accepts (`engines.vscode`), so an API newer than the
// floor fails here rather than on a user's machine. `vscode-test` runs both;
// `--label stable` or `--label minimum` runs one. The downloads live in
// .vscode-test/vscode-*, which CI caches.
const MOCHA_TIMEOUT_MS = 20_000

const shared = {
  files: 'dist/test/integration/**/*.test.js',
  workspaceFolder: './test/fixtures/workspace',
  mocha: { ui: 'tdd', timeout: MOCHA_TIMEOUT_MS, color: true },
}

// Under a long checkout path (macOS caps a Unix socket path at 104 bytes) each
// run gets a short user-data directory; see scripts/lib/vscodeTestProfile.mjs.
function run(label, version) {
  const launchArgs = launchArgsFor({
    base: ['--disable-extensions'],
    label,
    checkout: process.cwd(),
    platform: process.platform,
    tmp: tmpdir(),
  })
  return { ...shared, label, version, launchArgs }
}

export default defineConfig([run('stable', 'stable'), run('minimum', minimumVsCodeVersion())])
