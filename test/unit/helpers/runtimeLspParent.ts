// Real LSP/runtime factory and supervisor; only the store, logger and unused Git are fakes.
import path from 'node:path'
import process from 'node:process'
import { parseCommandLine } from '../../../src/runtime/cliArgs'
import { runLsp } from '../../../src/runtime/lsp/lspEntry'
import { superviseRuntime, stopWorkspace } from '../../../src/runtime/lsp/supervisor'
import { UI_TEXT } from '../../../src/shared/constants'

const workspace = process.cwd()
const registry = path.join(workspace, 'owners')
const command = parseCommandLine(process.argv.slice(2))
async function main(): Promise<number> {
  if (command.command === 'supervise')
    return await superviseRuntime({
      registry,
      cwd: workspace,
      file: process.execPath,
      args: [__filename, ...command.args],
      packageRoot: path.dirname(__filename),
      watchdogFile: path.join(path.dirname(__filename), 'watchdog.js'),
      env: process.env,
      stdin: process.stdin,
      stdout: process.stdout,
    })
  if (command.command === 'stop') {
    await stopWorkspace(registry, workspace)
    return 0
  }
  if (command.command !== 'lsp') throw new Error('fixture argv')
  return await runLsp(command.options, {
    stdin: process.stdin,
    stdout: process.stdout,
    executable: process.execPath,
    entry: __filename,
    packageRoot: path.dirname(__filename),
    watchdogFile: path.join(path.dirname(__filename), 'watchdog.js'),
    registry,
    dataFolder: path.join(workspace, 'data'),
    grantsFile: path.join(workspace, 'grants.json'),
    secrets: {
      get: () => {
        throw new Error('native store must remain untouched')
      },
      store: () => Promise.reject(new Error('no store writes')),
      delete: () => Promise.reject(new Error('no store deletes')),
    },
    env: process.env,
    log: {
      info: () => {
        /* private fixture */
      },
      warn: () => {
        /* private fixture */
      },
      error: () => {
        /* private fixture */
      },
      trace: () => {
        /* private fixture */
      },
    },
    table: UI_TEXT,
    locale: 'en',
    runGit: () => Promise.reject(new Error('no Git while Tab is off')),
  })
}
void main()
  .then((code) => {
    process.exitCode = code
  })
  .catch(() => {
    process.exitCode = 1
  })
