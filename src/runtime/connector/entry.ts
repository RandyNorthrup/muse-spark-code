// M124 (D106): dist/connector.js, loaded only by `muse-spark-code-acp mcp`.
// ACP stays its own protocol mode; this entry serves MCP over stdio. No
// login, model call, key access or effect happens because a client
// initializes or lists tools. The runtime took its credential variables out
// of its environment before this loads; nothing here starts a child process
// except the fixed browser opener for our approval page and the storage
// guard's fixed OS scripts, which run only at startup and when the store
// creates a file, never for a call.
import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import path from 'node:path'
import { CONNECTOR_FOLDER } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { fill, setUiText } from '../../shared/l10n/text'
import { ConnectorProtocol } from '../../core/connector/protocol'
import type { ReportsPort } from '../../core/connector/registry'
import type { SchedulesPort } from '../../core/connector/tools/schedules'
import { isRemoteCommand, parseConnectorCommand, runConnectorCommand } from './command'
import { ConnectorRegistryHost } from './registryHost'
import { serveStdio } from './stdio'
import { ConnectorStore } from './store'
import { isStorageRefused, type ConnectorStorageGuard } from './storageGuardPort'

export interface ConnectorRuntimeDeps {
  readonly argv: readonly string[]
  readonly table: UiText
  readonly locale: string
  readonly dataFolder: string
  readonly homeDir: string
  readonly version: string
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
  readonly isInteractive: boolean
  /** Credential values the runtime took from its environment, for redaction only. */
  readonly registered: () => readonly string[]
  /** The fixed OS opener, given only our checked loopback URL. */
  readonly openBrowser: (url: string) => Promise<void>
  readonly schedules: SchedulesPort
  readonly reports: ReportsPort
  /** The storage guard (RVM124 finding 15), loaded with the `mcp` command. */
  readonly storageGuard: ConnectorStorageGuard
}

function line(stream: Writable, text: string): void {
  stream.write(`${text}\n`)
}

/** The process's exit code: 0 after a clean disconnect or a command that succeeded. */
export async function runConnector(deps: ConnectorRuntimeDeps): Promise<number> {
  setUiText(deps.table, deps.locale)
  const command = parseConnectorCommand(deps.argv)
  const store = new ConnectorStore(deps.dataFolder, deps.storageGuard)
  if (command === undefined) {
    line(deps.stderr, deps.table.acpConnector.usage)
    return 2
  }
  if (['serve', 'grant', 'resume', 'status'].includes(command.kind)) {
    try {
      await deps.storageGuard.verify()
      // Serving writes receipts from the first frame: their storage is
      // created and secured now, never inside a receipt's timeout.
      if (command.kind === 'serve') await store.prepareAudit(command.connectionId)
    } catch (error: unknown) {
      if (!isStorageRefused(error)) throw error
      line(
        deps.stderr,
        fill(deps.table.acpConnector.storageRefused, {
          folder: path.join(deps.dataFolder, CONNECTOR_FOLDER),
        }),
      )
      return 1
    }
  }
  // The remote bundle owns these; the runtime routes them there. If this
  // bundle is handed one anyway, it refuses with usage, never serves.
  if (isRemoteCommand(command)) {
    line(deps.stderr, deps.table.acpConnector.usage)
    return 2
  }
  if (command.kind !== 'serve')
    return await runConnectorCommand(store, command, {
      isInteractive: deps.isInteractive,
      now: Date.now,
      print: (text) => {
        line(deps.stdout, text)
      },
      printError: (text) => {
        line(deps.stderr, text)
      },
      confirm: async (question) => {
        const input = createInterface({ input: deps.stdin, output: deps.stderr })
        try {
          const answer = await input.question(`${question} `)
          return answer.trim().toLowerCase() === 'y'
        } catch {
          // Ctrl+C or Ctrl+D at the prompt is a no, never a crash.
          return false
        } finally {
          input.close()
        }
      },
    })
  const host = new ConnectorRegistryHost({
    connectionId: command.connectionId,
    dataFolder: deps.dataFolder,
    homeDir: deps.homeDir,
    version: deps.version,
    registered: deps.registered,
    openBrowser: deps.openBrowser,
    schedules: deps.schedules,
    reports: deps.reports,
    store,
  })
  const registry = host.create(store.authority(command.connectionId))
  try {
    await serveStdio({ input: deps.stdin, output: deps.stdout }, new ConnectorProtocol(registry))
    return 0
  } finally {
    // The transport has disconnected the registry (its own finally): every
    // call is stopped. Done only once pending work and the page's own
    // start-up have settled.
    await host.close()
  }
}
