// The lazy runtime binding lane X named for W/S: the real engine, no fakes.
// Loaded by the schedule CLI and the ACP agent through runtimeSchedulesBinding.
import { homedir } from 'node:os'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'
import { agentDataFolder, schedulesFolder } from '../dataFolder'
import { carryLegacyScheduleStore } from './storeRoot'
import { createNodeScheduleFs, createNodeScheduleQueue } from './nodeScheduleFs'
import type { RuntimeSchedulesBinding } from './binding'
import { createScheduleEngine } from './engine'
import {
  createScheduleDeliveryBinding,
  type ScheduleEditorDeliveryPorts,
} from '../../host/schedules/deliveryBinding'
import { agentFileBeside, createVerifyWake } from './wake'
import type { createScheduleBilling } from '../../host/schedules/paidBinding'
import type { ScheduleMigrationSource } from '../../core/schedules/migrate'

import type { RuntimeScheduleDeliveryPorts, RuntimeScheduleEngineModule } from './delivery'

export async function createRuntimeSchedules(
  table: UiText,
  locale: string,
  delivery?: ScheduleEditorDeliveryPorts,
  runtimeDelivery?: RuntimeScheduleDeliveryPorts,
  migration?: { source: ScheduleMigrationSource; zone: string },
  scheduleEngine?: RuntimeScheduleEngineModule,
): Promise<RuntimeSchedulesBinding> {
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
  const { runtime } = createScheduleEngine({
    fs: createNodeScheduleFs(root),
    ...(delivery !== undefined && { signal: delivery.signal }),
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
      delivery: (authority) => createScheduleDeliveryBinding(delivery, authority, billing),
    }),
    ...(migration !== undefined && { migration }),
  })
  return runtime
}
