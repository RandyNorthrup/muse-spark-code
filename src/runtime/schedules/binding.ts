// Named handoff to W/S. The lazy bundle must provide a real engine binding.
import type { UiText } from '../../shared/l10n/en'
import type { Logger } from '../../host/logger'
import { lazyBundleLoader } from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { ScheduleCommandOptions } from './args'
import type { ScheduleCommandResult } from './settle'
import type { AcpSchedulePort } from '../../acp/schedules'
import type { ScheduleEditorDeliveryPorts } from '../../host/schedules/deliveryBinding'
import type { RuntimeScheduleDeliveryPorts } from './delivery'
import type { AcpScheduleSession } from '../../acp/schedules'

export interface RuntimeSchedulesBinding extends AcpSchedulePort {
  command(
    options: ScheduleCommandOptions,
    cwd: string,
    isInteractive?: boolean,
  ): Promise<ScheduleCommandResult>
  /** ACP/native/companion workspace lifetime; S binds the polling engine here. */
  holdWorkspace(cwd: string, session?: AcpScheduleSession): Promise<() => Promise<void>>
  /** The VS Code panel's request port over the same workspace control. */
  message(input: unknown, cwd: string): Promise<unknown>
  close(): Promise<void>
}

interface RuntimeSchedulesModule {
  createRuntimeSchedules(
    table: UiText,
    locale: string,
    delivery?: ScheduleEditorDeliveryPorts,
    runtimeDelivery?: RuntimeScheduleDeliveryPorts,
  ): Promise<RuntimeSchedulesBinding>
}

function isSchedulesModule(value: unknown): value is RuntimeSchedulesModule {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createRuntimeSchedules' in value &&
    typeof value.createRuntimeSchedules === 'function'
  )
}

export function runtimeSchedulesBinding(
  bundlePath: string,
  log: Logger,
  loadBundle?: (file: string) => unknown,
  delivery?: ScheduleEditorDeliveryPorts,
  runtimeDelivery?: RuntimeScheduleDeliveryPorts,
): () => Promise<RuntimeSchedulesBinding> {
  const load = lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isSchedulesModule,
    label: 'schedules',
    unavailable: () => UI_TEXT.scheduleV2.runtime.unavailable,
    ...(loadBundle !== undefined && { loadBundle }),
  })
  let binding: Promise<RuntimeSchedulesBinding> | undefined
  return async () => {
    if (binding === undefined) {
      if (runtimeDelivery === undefined) {
        binding =
          delivery === undefined
            ? load().createRuntimeSchedules(UI_TEXT, uiLocale())
            : load().createRuntimeSchedules(UI_TEXT, uiLocale(), delivery)
      } else binding = load().createRuntimeSchedules(UI_TEXT, uiLocale(), delivery, runtimeDelivery)
    }
    try {
      return await binding
    } catch (error: unknown) {
      binding = undefined
      throw error
    }
  }
}
