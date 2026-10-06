import path from 'node:path'
import { createMachineResourceSampler } from '../../core/resources/sampler/system'
import type { ResourceRunningWork } from '../../core/resources/queue'
import { BOUNDED_FILE_READ_CHUNK_BYTES, RESOURCE_SAMPLE_MS, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { resourceSettingsSchema, type ResourceSettings } from '../../shared/resources'
import { createRuntimeResourceHost } from './host'
import type { ResourceHistoryPort, ResourceMachineStore, RuntimeResources } from './port'
import { resourceMachineStore } from './settings'

export interface ResourceEntryOptions {
  machineDir: string
  sleep: (ms: number) => Promise<void>
  onError: (error: unknown) => void
  machine?: ResourceMachineStore
  running?: ResourceRunningWork
  history?: ResourceHistoryPort
  overrides?: Partial<ResourceSettings>
  hasRelocationTarget?: () => boolean
}

/** W builds this entry as dist/resourceGovernor.js and ships it beside acp.js. */
export async function createResources(
  options: ResourceEntryOptions,
  table: UiText,
  locale: string,
): Promise<RuntimeResources> {
  setUiText(table, locale)
  const machine =
    options.machine ??
    resourceMachineStore({
      settingsFile: path.join(options.machineDir, 'resources.json'),
      resumeFile: path.join(options.machineDir, 'resource-resume.json'),
      sleep: options.sleep,
    })
  let settings = resourceSettingsSchema.parse({})
  return await createRuntimeResourceHost({
    clock: {
      now: () => Date.now(),
      setTimeout(callback, delayMs) {
        const timer = setTimeout(callback, delayMs)
        timer.unref()
        return () => {
          clearTimeout(timer)
        }
      },
    },
    machine: {
      ...machine,
      async readSettings() {
        const raw = await machine.readSettings()
        settings = resourceSettingsSchema.parse({ ...raw, ...options.overrides })
        return raw
      },
    },
    sampler: createMachineResourceSampler(() => settings, {
      timeoutMs: RESOURCE_SAMPLE_MS,
      maxOutputBytes: BOUNDED_FILE_READ_CHUNK_BYTES,
    }),
    // Missing T occupancy is explicitly unknown: throttle admits no background work.
    running: options.running ?? { backgroundCount: () => null },
    onError: () => {
      // Settings/OS failures carry no free-text diagnostic across a resource surface.
      options.onError(new Error(UI_TEXT.resourceUnavailable))
    },
    ...(options.history !== undefined && { history: options.history }),
    ...(options.overrides !== undefined && { overrides: options.overrides }),
    ...(options.hasRelocationTarget !== undefined && {
      hasRelocationTarget: options.hasRelocationTarget,
    }),
  })
}
