// The lazy runtime binding lane X named for W/S: the real engine, no fakes.
// Loaded by the schedule CLI and the ACP agent through runtimeSchedulesBinding.
import { homedir } from 'node:os'
import { eitherSignal } from '../../shared/scheduleV2'
import { setUiText } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
import { agentDataFolder, schedulesFolder } from '../dataFolder'
import { carryLegacyScheduleStore } from './storeRoot'
import { createNodeScheduleFs, createNodeScheduleQueue } from './nodeScheduleFs'
import type { CreateRuntimeSchedulesArgs, RuntimeSchedulesBinding } from './binding'
import { createScheduleEngine } from './engine'
import type * as ScheduleDelivery from '../../host/schedules/scheduleDeliveryEntry'
import { agentFileBeside, createVerifyWake } from './wake'
import type { createScheduleBilling } from '../../host/schedules/paidBinding'

export async function createRuntimeSchedules(
  ...args: CreateRuntimeSchedulesArgs
): Promise<RuntimeSchedulesBinding> {
  const [
    table,
    locale,
    log,
    delivery,
    runtimeDelivery,
    migration,
    scheduleEngine,
    pauseAfterFailures,
    callerSignal,
    isWorkspaceTrusted,
  ] = args
  // The engine module lives on the ACP side (main.ts installs it); the
  // schedules bundle never loads it from VS Code, so the VSIX need not
  // carry the runtime engine for schedules.
  if (runtimeDelivery !== undefined && scheduleEngine === undefined)
    throw new Error(UI_TEXT.scheduleV2.runtime.unavailable)
  setUiText(table, locale)
  scheduleEngine?.setUiText(table, locale)
  const platform = process.platform
  const homeDir = homedir()
  const dataDir = agentDataFolder({ platform, env: process.env, homeDir })
  const root = schedulesFolder({ platform, env: process.env, homeDir })
  await carryLegacyScheduleStore(dataDir)
  const agentFile = agentFileBeside(__filename)
  let pendingBilling: Promise<ReturnType<typeof createScheduleBilling>> | undefined
  const loadBilling = async () => {
    pendingBilling ??= (async () => {
      const module = await import('../../core/backends/modelapi/reviewerEntry.js')
      module.setUiText(table, locale)
      if (delivery?.billing === undefined) throw new Error(UI_TEXT.schedulePaidOff)
      return module.createScheduleBilling(delivery.billing)
    })()
    try {
      return await pendingBilling
    } catch (error: unknown) {
      pendingBilling = undefined
      throw error
    }
  }
  const billing =
    delivery?.billing === undefined
      ? undefined
      : {
          consent: async (
            schedule: Parameters<ReturnType<typeof createScheduleBilling>['consent']>[0],
          ) => {
            const billing = await loadBilling()
            return await billing.consent(schedule)
          },
          paid: async (...args: Parameters<ReturnType<typeof createScheduleBilling>['paid']>) => {
            const billing = await loadBilling()
            return await billing.paid(...args)
          },
        }
  /**
  The deferred editor delivery (dist/scheduleDelivery.js, D6): the
  workspace targets, run dispatch and grant checks, loaded on the first
  delivery. Each caller fails its own safe way: a bundle that cannot load
  refuses the run with the chunk named, never an undelivered run and never
  a default target.
  */
  let pendingDelivery: Promise<typeof ScheduleDelivery> | undefined
  const loadDelivery = async () => {
    pendingDelivery ??= (async () => {
      try {
        return await import('../../host/schedules/scheduleDeliveryEntry.js')
      } catch (error: unknown) {
        throw new Error(
          'the scheduleDelivery.js bundle could not be loaded; schedule delivery is unavailable',
          { cause: error },
        )
      }
    })()
    try {
      return await pendingDelivery
    } catch (error: unknown) {
      pendingDelivery = undefined
      throw error
    }
  }
  // Either stop ends an engine wait: the editor delivery's, the caller's, or neither.
  const engineSignal = eitherSignal(delivery?.signal, callerSignal)
  const { runtime } = await createScheduleEngine({
    log,
    fs: createNodeScheduleFs(root),
    ...(pauseAfterFailures !== undefined && { pauseAfterFailures }),
    ...(engineSignal !== undefined && { signal: engineSignal }),
    ...(isWorkspaceTrusted !== undefined && { isWorkspaceTrusted }),
    locale,
    queue: createNodeScheduleQueue(root),
    platform,
    homeDir,
    dataDir,
    executable: process.execPath,
    agentFile,
    verifyWake: createVerifyWake(process.execPath, agentFile),
    ...(delivery?.caller !== undefined && { caller: delivery.caller }),
    ...(billing !== undefined && { consent: (schedule) => billing.consent(schedule) }),

    ...(runtimeDelivery !== undefined &&
      scheduleEngine !== undefined && {
        runtimeDelivery,
        runtimeDeliveryFactory: scheduleEngine.createRuntimeScheduleDelivery,
      }),
    ...(delivery !== undefined && {
      delivery: async (authority) => {
        const module = await loadDelivery()
        return module.createScheduleDeliveryBinding(delivery, authority, billing)
      },
    }),
    ...(migration !== undefined && { migration }),
  })
  return runtime
}
