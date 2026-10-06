import type { MakerCommand } from './commandArgs'
import type { createRuntimeMakerService } from './service'
import { makerSurfaceMessageSchema } from '../../shared/makerProtocol'
import { UI_TEXT } from '../../shared/constants'
import { startCompanion } from './companionServer'
import { startThonnyServer } from './thonnyServer'
import { companionAssets } from './assets'

export interface MakerCommandDeps {
  readonly service: Awaited<ReturnType<typeof createRuntimeMakerService>>
  readonly readSecret: () => Promise<string | undefined>
  readonly print: (line: string) => void
  readonly distDirectory: string
  readonly done: AbortSignal
}
export async function runMakerCommand(
  command: MakerCommand,
  deps: MakerCommandDeps,
): Promise<number> {
  const { service, print } = deps
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
      await service.stop(command.operation)
      print(UI_TEXT.makerSoftwareStopWarning)
      return 0
    }
    case 'panel': {
      const companion = await startCompanion({
        host: service.host,
        dispatch: service.dispatch,
        tools: service.tools,
        assets: await companionAssets(deps.distDirectory),
      })
      const thonny = await startThonnyServer(service.serial)
      // Owner's private launcher pipe only. Never send these capabilities to a log/model.
      print(`MUSE_SPARK_COMPANION_URL ${companion.url}/`)
      print(`MUSE_SPARK_COMPANION_LAUNCH ${companion.launch}`)
      print(`MUSE_SPARK_PROVIDER ${thonny.host} ${String(thonny.port)} ${thonny.token}`)
      try {
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
        await thonny.close()
        await companion.close()
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
