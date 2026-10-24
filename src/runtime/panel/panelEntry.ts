// dist/runtimePanel.js (M104 lane B, PLAN.md D84): `muse-spark-code-acp panel
// --stdio`, the runtime's side of an editor's Muse panel over MHP 1.5 on
// standard I/O, one newline-delimited JSON frame per line. Loaded only by
// `panel`. It serves the handshake and this agent's settings and storage
// (the same files the runtime itself reads, src/runtime/settingsStore.ts),
// bound to the one workspace the process was started in.
import { realpath } from 'node:fs/promises'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { isSamePath } from '../../core/paths'
import type { Logger } from '../../host/logger'
import { MHP_ERROR_CODES, MHP_PANEL } from '../../shared/constants'
import { MHP_METHODS, type MhpRequestMethod } from '../../shared/hostApi/methods'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { PanelOptions } from '../cliArgs'
import { RuntimeSettingsStore, RuntimeStateError } from '../settingsStore'
import { MhpServiceError, PanelConnection } from './connection'

export interface PanelRuntimeDeps {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly table: UiText
  readonly locale: string
  readonly log: Logger
  /** The agent's data folder: its settings files and the panel's storage. */
  readonly dataFolder: string
}

/** A store refusal as the MHP failure the host gets: its contract code and the stable message. */
function stateFailure(error: RuntimeStateError): MhpServiceError {
  const code = {
    unknownSetting: MHP_ERROR_CODES.invalidParams,
    invalidValue: MHP_ERROR_CODES.invalidParams,
    machineSetting: MHP_ERROR_CODES.permissionDenied,
    credential: MHP_ERROR_CODES.permissionDenied,
    damaged: MHP_ERROR_CODES.internalError,
  }[error.kind]
  return new MhpServiceError(code, error.message)
}

/** `settings/*` and `storage/*` against the store; any other request is not served here. */
async function answerState(
  store: RuntimeSettingsStore,
  method: MhpRequestMethod,
  value: unknown,
): Promise<unknown> {
  switch (method) {
    case 'settings/get': {
      const params = MHP_METHODS[method].params.parse(value)
      return { value: await store.getSetting(params.key) }
    }
    case 'settings/update': {
      const params = MHP_METHODS[method].params.parse(value)
      await store.updateSetting(params.key, params.value, params.scope)
      return null
    }
    case 'storage/global.get':
    case 'storage/workspace.get': {
      const params = MHP_METHODS[method].params.parse(value)
      const scope = method === 'storage/global.get' ? 'user' : 'workspace'
      return { value: await store.getStorage(params.key, scope) }
    }
    case 'storage/global.set':
    case 'storage/workspace.set': {
      const params = MHP_METHODS[method].params.parse(value)
      const scope = method === 'storage/global.set' ? 'user' : 'workspace'
      await store.setStorage(params.key, params.value, scope)
      return null
    }
    default: {
      throw new MhpServiceError(MHP_ERROR_CODES.unsupportedCapability, 'MHP_UNSUPPORTED_CAPABILITY')
    }
  }
}

/**
The host's folder as this process's workspace: a `file:` folder whose real
path is the one the runtime was started in, or no folder at all.
*/
async function boundWorkspace(
  folders: readonly { readonly uri: string }[],
  workspace: string,
): Promise<void> {
  const [folder] = folders
  if (folder === undefined) return
  const mismatch = new MhpServiceError(
    MHP_ERROR_CODES.invalidParams,
    'MHP_WORKSPACE_BINDING_MISMATCH',
  )
  if (new URL(folder.uri).protocol !== 'file:') throw mismatch
  let root: string
  try {
    root = await realpath(fileURLToPath(folder.uri))
  } catch (error: unknown) {
    // NARROW: a folder that does not exist here is not this workspace.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw mismatch
    throw error
  }
  if (!isSamePath(root, workspace, process.platform)) throw mismatch
}

// MHP's stdio framing: one JSON frame per line.
const LINE_END = '\n'

/**
Splits the host's bytes into lines, each bounded by MHP's envelope size
before it is decoded: a longer line ends the connection instead of growing
without end.
*/
function readLines(stdin: Readable, onLine: (line: string) => void, onOversized: () => void): void {
  let parts: Buffer[] = []
  let length = 0
  stdin.on('data', (chunk: Buffer) => {
    let start = 0
    for (let end = chunk.indexOf(LINE_END); end !== -1; end = chunk.indexOf(LINE_END, start)) {
      parts.push(chunk.subarray(start, end))
      const line = Buffer.concat(parts).toString('utf8').replace(/\r$/u, '')
      parts = []
      length = 0
      start = end + 1
      if (Buffer.byteLength(line) > MHP_PANEL.maximumEnvelopeBytes) {
        onOversized()
        return
      }
      if (line.trim().length > 0) onLine(line)
    }
    const rest = chunk.subarray(start)
    length += rest.length
    if (length > MHP_PANEL.maximumEnvelopeBytes) {
      onOversized()
      return
    }
    parts.push(rest)
  })
}

/** Serves one host until it shuts down (exit 0) or the connection ends otherwise (exit 1). */
export async function runPanel(options: PanelOptions, deps: PanelRuntimeDeps): Promise<number> {
  setUiText(deps.table, deps.locale)
  const { log } = deps
  const workspace = await realpath(path.resolve(options.workspace))
  const store = new RuntimeSettingsStore({
    dataFolder: deps.dataFolder,
    workspaceRoot: workspace,
    log,
    sleep: (ms) => delay(ms),
  })
  return await new Promise<number>((resolve) => {
    const connection = new PanelConnection(
      {
        // The runtime answers the host's handshake and its settings and storage.
        capabilities: ['lifecycle', 'settings', 'storage'],
        initialize: async (params, signal) => {
          await boundWorkspace(params.folders, workspace)
          signal.throwIfAborted()
        },
        request: async (method, value) => {
          try {
            return await answerState(store, method, value)
          } catch (error: unknown) {
            // NARROW: a store refusal answers with its contract code; anything else is reported as failed.
            if (error instanceof RuntimeStateError) throw stateFailure(error)
            throw error
          }
        },
        notify: (method) => {
          // The store reads the files at every request, so a host's own
          // settings change needs nothing here; other capabilities are not served.
          if (method === 'settings/didChange') log.trace('MHP settings/didChange')
          else log.warn(`MHP_NOTIFICATION_UNSUPPORTED ${method}`)
        },
        closed: (isFatal) => {
          resolve(isFatal ? 1 : 0)
        },
      },
      log,
    )
    connection.delivery.connect(deps.stdout)
    readLines(
      deps.stdin,
      (line) => {
        connection.receive(line)
      },
      () => {
        log.error('MHP_PANEL_TOO_LARGE')
        connection.close(true)
      },
    )
    deps.stdin.once('end', () => {
      // The host went away: after shutdown the connection already ended (exit 0).
      connection.close(!connection.hasShutDown)
    })
  })
}
