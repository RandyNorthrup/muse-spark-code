// The activation side of the window's maker stack (RLF-M103WIRE): one shared
// assembly behind dist/makerHost.js, loaded on the first maker command or
// `ide` tools request. Ships in the activation bundle; only types come from
// the maker side, and values cross only through the lazy require/import.
import * as vscode from 'vscode'
import { errorNameForLog } from '../../../core/logging'
import type { McpTool } from '../../../core/mcp'
import { MAKER_HOST_STATE_KEY, MAKER_STORAGE_PREFIX, UI_TEXT } from '../../../shared/constants'
import { namedBundleLoader } from '../../lazyBundle'
import type { Logger } from '../../logger'
import type { UiTable } from '../../l10n'
import type * as MakerEntry from '../../maker/makerEntry'
import type { MakerAssembly, MakerAssemblyDeps } from './makerAssembly'

export interface MakerLoaderDeps {
  readonly context: Pick<
    vscode.ExtensionContext,
    | 'storageUri'
    | 'globalStorageUri'
    | 'workspaceState'
    | 'globalState'
    | 'secrets'
    | 'extensionUri'
    | 'extensionPath'
  >
  readonly log: Logger
  readonly l10n: UiTable
  readonly workspaceRoot: string | undefined
  /** dist/makerHost.js beside the running bundle. */
  readonly bundlePath: string
}

export interface MakerLoader extends vscode.Disposable {
  /** The shared assembly, loaded on first use; a failed load retries on the next use. */
  readonly assembly: () => Promise<MakerAssembly>
  /** The `ide` tools, built synchronously behind a sync require. */
  readonly ideTools: () => readonly McpTool[]
}

export function makerLoader(deps: MakerLoaderDeps): MakerLoader {
  let loaded: MakerAssembly | undefined
  let loading: Promise<MakerAssembly> | undefined
  let isDisposed = false
  const assemblyDeps = (): MakerAssemblyDeps => ({
    context: deps.context,
    log: deps.log,
    l10n: deps.l10n,
    workspaceRoot: deps.workspaceRoot,
    env: process.env,
    packageRoot: deps.context.extensionPath,
    dataDirectory: deps.context.globalStorageUri.fsPath,
  })
  const assembly = (): Promise<MakerAssembly> => {
    loading ??= (async () => {
      let made: MakerAssembly
      try {
        const entry = await import('../../maker/makerEntry')
        made = await entry.createMakerAssembly(assemblyDeps())
      } catch (error: unknown) {
        loading = undefined
        deps.log.error(`The maker bundle could not be loaded: ${errorNameForLog(error)}`)
        throw new Error(UI_TEXT.makerUnavailable, { cause: error })
      }
      if (isDisposed) {
        made.dispose()
        loading = undefined
        throw new Error(UI_TEXT.makerUnavailable)
      }
      loaded = made
      return made
    })()
    return loading
  }
  const toolsBundle = namedBundleLoader<typeof MakerEntry>({
    bundlePath: deps.bundlePath,
    log: deps.log,
    names: ['createMakerTools'],
    label: 'maker bundle',
    unavailable: () => UI_TEXT.makerUnavailable,
  })
  const isLatchOn = (): boolean => {
    const stored: unknown = deps.context.workspaceState.get(
      `${MAKER_STORAGE_PREFIX}${MAKER_HOST_STATE_KEY}`,
    )
    return (
      typeof stored === 'object' &&
      stored !== null &&
      'enabled' in stored &&
      stored.enabled === true
    )
  }
  const ideTools = (): readonly McpTool[] => {
    if (isDisposed) return []
    let create: typeof MakerEntry.createMakerTools
    try {
      create = toolsBundle().createMakerTools
    } catch (error: unknown) {
      deps.log.error(`Maker tools unavailable: ${errorNameForLog(error)}`)
      return []
    }
    return create(
      {
        host: {
          isTrusted: () => !isDisposed && vscode.workspace.isTrusted,
          hardwareEnabled: () => loaded?.engine.isHardwareEnabled() ?? isLatchOn(),
          // A person at this window's keyboard answers every modal: the
          // window is the attended top-level session (see the assembly).
          isInteractive: () => true,
          notify: (notice) => {
            void (async () => {
              try {
                const made = await assembly()
                await made.host.notify(notice)
              } catch (error: unknown) {
                deps.log.error(`Maker notice failed: ${errorNameForLog(error)}`)
              }
            })()
          },
        },
        // The `ide` server lists for the session, not a model: the session's
        // model either calls the tools or does not. Trust and hardware gate.
        canUseTools: () => true,
        // Stop is never gated: offered like the runtime's unconditional stop.
        hasMachines: () => true,
        action: async (message, signal) => {
          const made = await assembly()
          return await made.engine.action(message, signal)
        },
        listDevices: async () => {
          const made = await assembly()
          return await made.engine.listDevices()
        },
        stop: async (machineId) => {
          const made = await assembly()
          await made.engine.stop(machineId)
        },
      },
      deps.l10n.table,
      deps.l10n.locale,
    )
  }
  return {
    assembly,
    ideTools,
    dispose: () => {
      isDisposed = true
      loading = undefined
      const made = loaded
      loaded = undefined
      made?.dispose()
    },
  }
}
