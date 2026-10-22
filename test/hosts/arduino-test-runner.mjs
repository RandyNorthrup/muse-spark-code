// Theia 1.57's actual extensionTestsPath hook calls run(path, callback).
// Bundled into the installed plugin by run-arduino.mjs; never shipped.
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as vscode from 'vscode'

export async function run(testsPath, callback) {
  const result = process.env.MUSE_ARDUINO_RESULT
  if (!result) throw new Error('MUSE_ARDUINO_RESULT is required')
  const tests = path.join(path.dirname(testsPath), '../integration')
  const files = readdirSync(tests)
    .filter((file) => file.endsWith('.test.js'))
    .toSorted((a, b) => a.localeCompare(b))
  // Use the repository's already pinned test-cli runner and its Mocha;
  // no new direct dependency or separately implemented test framework.
  const runnerPath = process.env.MUSE_ARDUINO_TEST_CLI_RUNNER
  if (!runnerPath) throw new Error('MUSE_ARDUINO_TEST_CLI_RUNNER is required')
  process.env.VSCODE_TEST_OPTIONS = JSON.stringify({
    files: files.map((file) => path.join(tests, file)),
    preload: [],
    colorDefault: false,
    mochaOpts: { ui: 'tdd', timeout: 20_000, reporter: 'json', reporterOption: { output: result } },
  })
  const capture = () => {
    const provider = vscode.extensions.getExtension('dankeboy36.vscode-arduino-api')
    const api = provider?.exports
    writeFileSync(
      path.join(path.dirname(result), 'board-api-capture.json'),
      JSON.stringify(
        {
          provider: provider?.id,
          providerVersion: provider?.packageJSON.version,
          sketchPath: api?.sketchPath,
          fqbn: api?.fqbn,
          port: api?.port,
          vscode: vscode.version,
          node: process.versions.node,
        },
        null,
        2,
      ),
    )
  }
  try {
    if (files.length === 0) throw new Error('No Arduino integration tests discovered')
    capture()
    const { run: runTests } = createRequire(testsPath)(runnerPath)
    await runTests()
    callback()
  } catch (error) {
    if (!existsSync(result)) writeFileSync(result, JSON.stringify({ error: String(error) }))
    callback(error)
  }
}
