// Named handoff to W/S. The lazy bundle must provide a real engine binding.
import type { UiText } from '../../shared/l10n/en'
import type { Logger } from '../../host/logger'
import { lazyBundleLoader } from '../../host/lazyBundle'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type { ScheduleCommandOptions } from './args'
import type { ScheduleCommandResult } from './settle'
import type { AcpSchedulePort } from '../../acp/schedules'

export interface RuntimeSchedulesBinding extends AcpSchedulePort {
  command(
    options: ScheduleCommandOptions,
    cwd: string,
    isInteractive?: boolean,
  ): Promise<ScheduleCommandResult>
  /** ACP/native/companion workspace lifetime; S binds the polling engine here. */
  holdWorkspace(cwd: string): Promise<() => Promise<void>>
  close(): Promise<void>
}

interface RuntimeSchedulesModule {
  createRuntimeSchedules(table: UiText, locale: string): Promise<RuntimeSchedulesBinding>
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
    binding ??= load().createRuntimeSchedules(UI_TEXT, uiLocale())
    try {
      return await binding
    } catch (error: unknown) {
      binding = undefined
      throw error
    }
  }
}
