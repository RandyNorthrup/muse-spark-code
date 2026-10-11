// The lazy runtime binding lane X named for W/S: the real engine, no fakes.
// Loaded by the schedule CLI and the ACP agent through runtimeSchedulesBinding.
import { homedir } from 'node:os'
import path from 'node:path'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { SCHEDULE_STORE_SUBFOLDER, UI_TEXT } from '../../shared/constants'
import { agentDataFolder } from '../dataFolder'
import { createNodeScheduleFs, createNodeScheduleQueue } from './nodeScheduleFs'
import type { RuntimeSchedulesBinding } from './binding'
import { createScheduleEngine } from './engine'
import {
  createScheduleDeliveryBinding,
  type ScheduleEditorDeliveryPorts,
} from '../../host/schedules/deliveryBinding'
import { agentFileBeside, createVerifyWake } from './wake'
import type { createScheduleBilling } from '../../host/schedules/paidBinding'

import type { RuntimeScheduleDeliveryPorts } from './delivery'

export async function createRuntimeSchedules(
  table: UiText,
  locale: string,
  delivery?: ScheduleEditorDeliveryPorts,
  runtimeDelivery?: RuntimeScheduleDeliveryPorts,
): Promise<RuntimeSchedulesBinding> {
  setUiText(table, locale)
  const platform = process.platform
  const homeDir = homedir()
  const dataDir = agentDataFolder({ platform, env: process.env, homeDir })
  const root = path.join(dataDir, SCHEDULE_STORE_SUBFOLDER)
  const agentFile = agentFileBeside(__filename)
  const runtimeModule =
    runtimeDelivery === undefined ? undefined : await import('../runtimeEngineEntry.js')
  runtimeModule?.setUiText(table, locale)
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
      runtimeModule !== undefined && {
        runtimeDelivery,
        runtimeDeliveryFactory: runtimeModule.createRuntimeScheduleDelivery,
      }),
    ...(delivery !== undefined && {
      delivery: (authority) => createScheduleDeliveryBinding(delivery, authority, billing),
    }),
  })
  return runtime
}
