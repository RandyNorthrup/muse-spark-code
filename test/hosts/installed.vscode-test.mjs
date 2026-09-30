// The integration tests in an installed editor built on VS Code (hosts.yml,
// forks.yml, PLAN.md M62): the same suite as .vscode-test.mjs, run in the
// executable HOST_BIN names (VSCodium, Cursor, Kiro, ...). HOST_LABEL names
// the run. Paths are relative to this file.
import process from 'node:process'

const executable = process.env.HOST_BIN
if (executable === undefined) {
  throw new Error('HOST_BIN names the editor executable to test in')
}
const MOCHA_TIMEOUT_MS = 20_000

export default [
  {
    label: process.env.HOST_LABEL ?? 'installed',
    files: '../../dist/test/integration/**/*.test.js',
    workspaceFolder: '../fixtures/workspace',
    extensionDevelopmentPath: '../..',
    useInstallation: { fromPath: executable },
    // An unpacked archive leaves chrome-sandbox without its setuid bit.
    launchArgs: ['--disable-extensions', '--no-sandbox', '--disable-gpu'],
    mocha: { ui: 'tdd', timeout: MOCHA_TIMEOUT_MS, color: true },
  },
]
