// The window's maker assembly (RLF-M103WIRE): the native host, the engine,
// the six commands, the preview panel and the `ide` tools, composed on the
// first maker use. Runs in dist/makerHost.js; the engine loads behind it in
// dist/makerEngine.js, the preview panel in dist/makerPreviewHost.js.
import type * as vscode from 'vscode'
import { UI_TEXT } from '../../../shared/constants'
import { setUiText } from '../../../shared/l10n/text'
import type { MakerEngine } from '../../maker/makerEngine'
import type { Logger } from '../../logger'
import type { UiTable } from '../../l10n'
import { MakerCommands } from './makerCommands'
import { openMakerAuthDialog, openMakerDeviceLog, openMakerDevices } from './makerDevicesUi'
import type { MakerPreviewPanel } from './makerPreviewPanel'
import { createVscodeMakerHost, type VscodeMakerHost } from './vscodeMakerHost'

export interface MakerAssemblyDeps {
  readonly context: Pick<
    vscode.ExtensionContext,
    | 'storageUri'
    | 'globalStorageUri'
    | 'workspaceState'
    | 'globalState'
    | 'secrets'
    | 'extensionUri'
  >
  readonly log: Logger
  readonly l10n: UiTable
  readonly workspaceRoot: string | undefined
  readonly env: NodeJS.ProcessEnv
  /** The extension root: the native helpers ship under it. */
  readonly packageRoot: string
  /** The global storage root: the machine registry and leases live under it. */
  readonly dataDirectory: string
}

export interface MakerAssembly extends vscode.Disposable {
  readonly host: VscodeMakerHost
  readonly commands: MakerCommands
  readonly engine: MakerEngine
}

export async function createMakerAssembly(deps: MakerAssemblyDeps): Promise<MakerAssembly> {
  setUiText(deps.l10n.table, deps.l10n.locale)
  const holder: { engine?: MakerEngine } = {}
  const needEngine = (): MakerEngine => {
    if (holder.engine === undefined) throw new Error(UI_TEXT.makerUnavailable)
    return holder.engine
  }
  let preview: MakerPreviewPanel | undefined
  const needPreview = async (): Promise<MakerPreviewPanel> => {
    if (preview === undefined) {
      const previewEntry = await import('../../maker/makerPreviewEntry')
      preview = previewEntry.createPreviewPanel({
        extensionUri: deps.context.extensionUri,
        globalStoragePath: deps.dataDirectory,
        l10n: deps.l10n,
        log: deps.log,
        stop: (machineId) => needEngine().stop(machineId),
      })
    }
    return preview
  }
  const host = await createVscodeMakerHost({
    context: deps.context,
    log: deps.log,
    hardwareEnabled: () => needEngine().isHardwareEnabled(),
    // A person at this window's keyboard answers every modal: the window is
    // the attended top-level session. Plan, tasks and workers are CLI-side
    // states the window cannot see; each approval still meets the person.
    isInteractive: () => true,
    stop: (machineId) => needEngine().stop(machineId),
    openPreview: async (previewMessage) => {
      const panel = await needPreview()
      await panel.open(previewMessage)
    },
    openApprovalPreview: async (request, signal) => {
      const panel = await needPreview()
      return await panel.openApproval(request, signal)
    },
  })
  const engineEntry = await import('../../maker/makerEngineEntry')
  const engine = await engineEntry.createMakerEngine(
    {
      storage: host.storage,
      secrets: host.secrets,
      host,
      log: deps.log,
      platform: process.platform,
      env: deps.env,
      packageRoot: deps.packageRoot,
      dataDirectory: deps.dataDirectory,
      workspaceRoot: deps.workspaceRoot,
      openAuthDialog: (url) => openMakerAuthDialog(url),
    },
    deps.l10n.table,
    deps.l10n.locale,
  )
  holder.engine = engine
  const commands: MakerCommands = new MakerCommands({
    host,
    changeHardware: (isEnabled, reason) => needEngine().setHardware(isEnabled, reason),
    listMachines: () => needEngine().listMachines(),
    registerMachine: (message, key) => needEngine().registerMachine(message, key),
    registerOctoprintReadOnly: (message) => needEngine().registerOctoprintReadOnly(message),
    removeMachine: (message) => needEngine().removeMachine(message),
    openDevices: () =>
      openMakerDevices({
        listMachines: () => needEngine().listMachines(),
        listPorts: () => needEngine().listPorts(),
        addMachine: (message) => commands.addMachine(message),
        readDeviceLog: () => needEngine().readDeviceLog(),
      }),
    openDeviceLog: () => openMakerDeviceLog({ readDeviceLog: () => needEngine().readDeviceLog() }),
  })
  return {
    host,
    commands,
    engine,
    dispose: () => {
      host.dispose()
      preview?.dispose()
      void engine.close()
    },
  }
}
