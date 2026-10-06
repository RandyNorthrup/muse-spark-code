import path from 'node:path'
import type { MakerSecrets } from '../../core/maker/ports'
import type { MakerCommand } from './commandArgs'
import { createRuntimeMakerService, runtimeMakerLan } from './service'
import { stopRuntimeMachines, stopResultText } from './stop'
import { runMakerCommand, openMakerBrowser } from './commands'
import {
  RUNTIME_MAKER_LAUNCH_CODE_MS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatUnit, setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { createAcpMakerRuntime } from './acpRuntime'
import type { AcpMakerRuntime } from '../../acp/maker'
import { isMakerTerminalAttended } from './attended'

export function runtimeMakerAcp(deps: RuntimeMakerEntryDeps, isTrusted: boolean): AcpMakerRuntime {
  setUiText(deps.table, deps.locale)
  return createAcpMakerRuntime({
    dataDirectory: deps.dataDirectory,
    secrets: deps.secrets,
    trusted: () => isTrusted,
    flagged: () => true,
    native: {
      platform: deps.platform,
      env: deps.env,
      packageRoot: path.dirname(deps.distDirectory),
    },
  })
}

export interface RuntimeMakerEntryDeps {
  readonly dataDirectory: string
  readonly distDirectory: string
  readonly workspace: string
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  readonly secrets: MakerSecrets
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
    try {
      const result = await stopRuntimeMachines(
        {
          dataDirectory: deps.dataDirectory,
          platform: deps.platform,
          secrets: deps.secrets,
          lan: runtimeMakerLan,
        },
        command.operation,
      )
      deps.print(stopResultText(result))
      return 0
    } catch (error) {
      ;(deps.reportFailure ?? deps.print)(
        error instanceof Error ? error.message : UI_TEXT.makerPhysicalStopRequired,
      )
      return 1
    }
  }
  const terminal = { requiresPanelConfirmation: false }
  const isAttended = await isMakerTerminalAttended({
    stdinTty: process.stdin.isTTY,
    stdoutTty: process.stdout.isTTY,
    parentPid: process.ppid,
    platform: deps.platform,
    env: deps.env,
    onMultiplexer: () => {
      terminal.requiresPanelConfirmation = true
    },
  })
  if (
    !isAttended &&
    (command.action === 'panel' ||
      (command.action === 'hardware' && command.operation === 'enable') ||
      (command.action === 'machines' && command.operation === 'add'))
  )
    throw new Error(UI_TEXT.makerUnattendedDenied)
  if (
    terminal.requiresPanelConfirmation &&
    (command.action === 'panel' ||
      (command.action === 'hardware' && command.operation === 'enable') ||
      (command.action === 'machines' && command.operation === 'add'))
  )
    throw new Error(UI_TEXT.makerMultiplexerDenied)
  const service = await createRuntimeMakerService({
    stopOnlyFallback: command.action === 'panel',
    dataDirectory: deps.dataDirectory,
    workspace: deps.workspace,
    secrets: deps.secrets,
    trusted: () => command.trusted,
    flagged: () => true,
    interactive: () => isAttended,
    native: {
      platform: deps.platform,
      env: deps.env,
      packageRoot: path.dirname(deps.distDirectory),
    },
  })
  try {
    return await runMakerCommand(command, {
      ...deps,
      service,
      requiresPanelConfirmation: terminal.requiresPanelConfirmation,
      printLaunchCode: (code) => {
        if (!isAttended || !process.stdin.isTTY || !process.stdout.isTTY)
          throw new Error(UI_TEXT.makerUnattendedDenied)
        process.stdout.write(
          `${fill(UI_TEXT.makerLaunchCode, {
            code,
            duration: formatUnit(RUNTIME_MAKER_LAUNCH_CODE_MS / MILLISECONDS_PER_SECOND, 'second'),
          })}\n`,
        )
      },
      openBrowser: (url) => openMakerBrowser(url, deps.platform, deps.env),
    })
  } finally {
    await service.close()
  }
}
