import type { MakerCommand } from './commandArgs'
import type { createRuntimeMakerService } from './service'
import { makerSurfaceMessageSchema } from '../../shared/makerProtocol'
import { UI_TEXT } from '../../shared/constants'
import { startThonnyServer } from './thonnyServer'
import { startCompanion } from './companionServer'
import { companionAssets } from './assets'
import { stopResultText } from './stop'
import { runProgram, windowsPowerShell } from '../../host/processTree'
import { WINDOWS_POWERSHELL_COMMAND_ARGS } from '../../shared/constants'
import { powerShellQuoted } from '../../core/shellQuote'
import { environmentValue } from '../../core/backends/musecode/launch'

export interface MakerCommandDeps {
  readonly service: Awaited<ReturnType<typeof createRuntimeMakerService>>
  readonly readSecret: () => Promise<string | undefined>
  readonly print: (line: string) => void
  readonly distDirectory: string
  readonly openBrowser: (url: string) => Promise<void>
  readonly done: AbortSignal
}
export async function runMakerCommand(
  command: MakerCommand,
  deps: MakerCommandDeps,
): Promise<number> {
  const { service, print } = deps
  if (
    !service.host.isInteractive() &&
    (command.action === 'panel' ||
      (command.action === 'hardware' && command.operation === 'enable') ||
      (command.action === 'machines' && command.operation === 'add'))
  )
    throw new Error(UI_TEXT.makerUnattendedDenied)
  switch (command.action) {
    case 'hardware': {
      if (command.operation === 'enable') await service.host.setHardware(true, command.reason)
      else if (command.operation === 'disable') await service.host.setHardware(false)
      await service.host.refresh()
      print(
        service.host.hardwareEnabled()
          ? UI_TEXT.makerHardwareEnabled
          : UI_TEXT.makerHardwareDisabled,
      )
      return 0
    }
    case 'machines': {
      if (command.operation === 'add') {
        if (!service.host.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
        const raw: unknown = JSON.parse(command.registration ?? '')
        const message = makerSurfaceMessageSchema.parse({
          v: 1,
          type: 'makerAddMachine',
          ...rawObject(raw),
        })
        if (message.type !== 'makerAddMachine') throw new Error(UI_TEXT.makerAddMachine)
        await service.host.requirePresence(UI_TEXT.makerAddMachine, message, message.machine.name)
        if (!service.host.isTrusted() || !service.host.isInteractive())
          throw new Error(UI_TEXT.makerUnattendedDenied)
        const secret = { value: command.keyStdin ? await deps.readSecret() : undefined }
        try {
          if (command.keyStdin && secret.value === undefined)
            throw new Error(UI_TEXT.makerAddMachine)
          await service.registry.register(
            { ...message.machine, allowPlainHttp: message.allowPlainHttp },
            secret.value,
          )
        } finally {
          secret.value = undefined
        }
      } else if (command.operation === 'remove') {
        if (!service.host.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
        if (command.id === undefined) throw new Error(UI_TEXT.makerRemoveMachine)
        await service.registry.remove(command.id)
      }
      print(JSON.stringify(await service.registry.list()))
      return 0
    }
    case 'stop-machine': {
      print(stopResultText(await service.stop(command.operation)))
      return 0
    }
    case 'panel': {
      const assets = await companionAssets(deps.distDirectory)
      const thonny = await startThonnyServer(service.serial)
      try {
        const companion = await startCompanion({
          host: service.host,
          dispatch: service.dispatch,
          tools: service.tools,
          assets,
          provider: { host: thonny.host, port: thonny.port, token: thonny.token },
        })
        try {
          await deps.openBrowser(await companion.open())
          await new Promise<void>((resolve) => {
            if (deps.done.aborted) resolve()
            else
              deps.done.addEventListener(
                'abort',
                () => {
                  resolve()
                },
                { once: true },
              )
          })
        } finally {
          await companion.close()
        }
      } finally {
        await thonny.close()
      }

      return 0
    }
  }
}
function rawObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new Error(UI_TEXT.makerAddMachine)
  return Object.fromEntries(Object.entries(raw))
}

/** Fixed OS launcher, public URL only; the page exchanges its code over loopback. */
export async function openMakerBrowser(
  url: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const page = new URL(url)
  if (
    page.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(page.hostname) ||
    page.username !== '' ||
    page.password !== '' ||
    page.pathname !== '/' ||
    page.search !== '' ||
    page.hash !== ''
  )
    throw new Error(UI_TEXT.makerUnattendedDenied)
  if (platform === 'win32') {
    const root = environmentValue(env, platform, 'SystemRoot')
    if (root === undefined) throw new Error(UI_TEXT.makerUnattendedDenied)
    const shell = windowsPowerShell(root)
    await runProgram(
      shell.file,
      [...WINDOWS_POWERSHELL_COMMAND_ARGS, `Start-Process -FilePath ${powerShellQuoted(url)}`],
      shell.env,
    )
  } else await runProgram(platform === 'darwin' ? '/usr/bin/open' : '/usr/bin/xdg-open', [url], env)
}
