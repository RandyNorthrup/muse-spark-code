import type { UserPresence } from '../../core/maker/userPresence'
import path from 'node:path'
import type { MakerSecrets } from '../../core/maker/ports'
import type { MakerLanPolicy } from '../../core/maker/registry'
import type { MakerCommand } from './commandArgs'
import { createRuntimeMakerService, runtimeMakerLan } from './service'
import { stopRuntimeMachines, stopResultText } from './stop'
import { runMakerCommand, openMakerBrowser } from './commands'
import { RUNTIME_MAKER_AGENT_MARKERS, UI_TEXT } from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createAcpMakerRuntime } from './acpRuntime'
import { runtimeSerialPythonPath } from '../runtimeSerialPython'
import type { AcpMakerRuntime } from '../../acp/makerTools'

/** The native serial deps both maker entries build the same way. */
function makerNative(deps: RuntimeMakerEntryDeps) {
  return {
    platform: deps.platform,
    env: deps.env,
    packageRoot: path.dirname(deps.distDirectory),
    serialPython: () => runtimeSerialPythonPath(deps.dataDirectory),
  }
}

export function runtimeMakerAcp(deps: RuntimeMakerEntryDeps, isTrusted: boolean): AcpMakerRuntime {
  setUiText(deps.table, deps.locale)
  return createAcpMakerRuntime({
    dataDirectory: deps.dataDirectory,
    secrets: deps.secrets,
    ...(deps.presence !== undefined && { presence: deps.presence }),
    trusted: () => isTrusted,
    flagged: () => true,
    native: makerNative(deps),
  })
}

export interface RuntimeMakerEntryDeps {
  readonly dataDirectory: string
  readonly distDirectory: string
  readonly workspace: string
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly secrets: MakerSecrets
  readonly lan?: MakerLanPolicy
  readonly presence?: UserPresence
  readonly readSecret: () => Promise<string | undefined>
  readonly print: (line: string) => void
  readonly reportFailure?: (line: string) => void
  readonly done: AbortSignal
  readonly table: UiText
  readonly locale: string
}
export async function runRuntimeMaker(
  command: MakerCommand,
  deps: RuntimeMakerEntryDeps,
): Promise<number> {
  setUiText(deps.table, deps.locale)
  if (command.action === 'stop-machine') {
    const [stopped] = await Promise.allSettled([
      stopRuntimeMachines(
        {
          dataDirectory: deps.dataDirectory,
          platform: deps.platform,
          secrets: deps.secrets,
          lan: deps.lan ?? runtimeMakerLan,
        },
        command.operation,
      ),
    ])
    if (stopped.status === 'fulfilled') {
      deps.print(stopResultText(stopped.value))
      return 0
    }
    ;(deps.reportFailure ?? deps.print)(
      stopped.reason instanceof Error ? stopped.reason.message : UI_TEXT.makerPhysicalStopRequired,
    )
    return 1
  }
  const service = await createRuntimeMakerService({
    stopOnlyFallback: command.action === 'panel',
    dataDirectory: deps.dataDirectory,
    workspace: deps.workspace,
    secrets: deps.secrets,
    ...(deps.lan !== undefined && { lan: deps.lan }),
    ...(deps.presence !== undefined && { presence: deps.presence }),
    trusted: () => command.trusted,
    flagged: () => true,
    interactive: () => RUNTIME_MAKER_AGENT_MARKERS.every((key) => (deps.env[key] ?? '') === ''),
    native: makerNative(deps),
  })
  try {
    return await runMakerCommand(command, {
      ...deps,
      service,
      openBrowser: (url) => openMakerBrowser(url, deps.platform, deps.env),
    })
  } finally {
    await service.close()
  }
}
