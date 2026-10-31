import { realpath } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { FileMachineStorage, MachineRegistry, type MakerLanPolicy } from '../../core/maker/registry'
import { MachineHttp } from '../../core/maker/machines/http'
import {
  didStopHardwareLease,
  leaseIdentity,
  stopAllHardwareLeases,
  type LeaseDependencies,
} from '../../core/maker/lease'
import type { MakerSecrets } from '../../core/maker/ports'
import { environmentValue, windowsPowerShell } from '../../core/execGuard'
import { runProgram, type RunProgram } from '../../host/processTree'
import { RUNTIME_MAKER_TIMEOUT_MS, RUNTIME_MAKER_MAX_BYTES, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/**
The runtime's lease identity: Windows needs SystemRoot's PowerShell, or every
answer is unknown. Its name ignores case, as Windows does, in any copied env.
*/
export function runtimeLeaseIdentity(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  run: RunProgram = runProgram,
) {
  const systemRoot = environmentValue(env, platform, 'SystemRoot')
  return leaseIdentity({
    platform,
    run,
    powershell:
      platform === 'win32' && systemRoot !== undefined
        ? windowsPowerShell(systemRoot, env)
        : undefined,
  })
}

export interface RuntimeStopDeps {
  readonly dataDirectory: string
  readonly platform: NodeJS.Platform
  readonly secrets: MakerSecrets
  readonly lan: MakerLanPolicy
}
export interface RuntimeStopResult {
  readonly physicalStopRequired: readonly string[]
}
/** Only reads user registries. No workspace, grant, helper, mutex or log is opened. */
export async function stopRuntimeMachines(
  deps: RuntimeStopDeps,
  id?: string,
): Promise<RuntimeStopResult> {
  const failures: string[] = []
  const physical: string[] = []
  let root = path.join(deps.dataDirectory, 'maker')
  try {
    root = await realpath(root)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw new Error(fill(UI_TEXT.makerStopFailed, { machine: id ?? UI_TEXT.makerDevicesTitle }), {
        cause: error,
      })
  }
  const lease: LeaseDependencies = {
    directory: path.join(root, 'leases'),
    platform: deps.platform,
    timeoutMs: RUNTIME_MAKER_TIMEOUT_MS,
    maxRecordBytes: RUNTIME_MAKER_MAX_BYTES,
    ...runtimeLeaseIdentity(deps.platform, process.env),
  }
  const registry = new MachineRegistry(new FileMachineStorage(root), deps.secrets, deps.lan)
  const results = await Promise.allSettled([
    ...(id === undefined ? [stopAllHardwareLeases(lease)] : []),
    (async () => {
      const records = id === undefined ? await registry.list() : [await registry.get(id)]
      await Promise.all(
        records.map(async (record) => {
          const results = await Promise.allSettled([
            didStopHardwareLease(lease, `machine:${record.registrationId}`),
            (async () => {
              if (record.kind !== 'moonraker' && record.kind !== 'octoprint') {
                // PrusaLink has no emergency-stop API. Serial requires a live leased owner.
                return
              }
              const http = new MachineHttp(record, deps.lan, deps.secrets, {
                timeoutMs: RUNTIME_MAKER_TIMEOUT_MS,
                maxResponseBytes: RUNTIME_MAKER_MAX_BYTES,
              })
              if (record.kind === 'moonraker')
                z.object({ result: z.literal('ok') }).parse(
                  await http.json('POST', '/printer/emergency_stop'),
                )
              else
                z.null().parse(
                  await http.json('POST', '/api/printer/command', { commands: ['M112'] }),
                )
            })(),
          ])
          if (results.some((result) => result.status === 'rejected')) failures.push(record.name)
          else if (
            record.kind === 'prusalink' ||
            (!['moonraker', 'octoprint'].includes(record.kind) &&
              results[0].status === 'fulfilled' &&
              !results[0].value)
          )
            physical.push(record.name)
        }),
      )
    })(),
  ])
  if (results.some((result) => result.status === 'rejected'))
    failures.push(id ?? UI_TEXT.makerDevicesTitle)
  if (failures.length > 0)
    throw new Error(fill(UI_TEXT.makerStopFailed, { machine: failures.join(', ') }))
  return { physicalStopRequired: physical }
}
export function stopResultText(result: RuntimeStopResult): string {
  return result.physicalStopRequired.length === 0
    ? UI_TEXT.makerSoftwareStopWarning
    : fill(UI_TEXT.makerStopPhysicalRequired, { machine: result.physicalStopRequired.join(', ') })
}
