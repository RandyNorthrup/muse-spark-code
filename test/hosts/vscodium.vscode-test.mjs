// The integration tests in VSCodium (hosts.yml, PLAN.md M62): the same suite
// as .vscode-test.mjs, run in the VSCodium build VSCODIUM_BIN names (the
// floor's and the latest). Paths are relative to this file.
import process from 'node:process'

const executable = process.env.VSCODIUM_BIN
if (executable === undefined) {
  throw new Error('VSCODIUM_BIN names the VSCodium executable to test in')
}
const MOCHA_TIMEOUT_MS = 20_000

export default [
  {
    label: 'vscodium',
    files: '../../dist/test/integration/**/*.test.js',
    workspaceFolder: '../fixtures/workspace',
    extensionDevelopmentPath: '../..',
    useInstallation: { fromPath: executable },
    // VSCodium's archive leaves chrome-sandbox without its setuid bit.
    launchArgs: ['--disable-extensions', '--no-sandbox', '--disable-gpu'],
    mocha: { ui: 'tdd', timeout: MOCHA_TIMEOUT_MS, color: true },
  },
]
