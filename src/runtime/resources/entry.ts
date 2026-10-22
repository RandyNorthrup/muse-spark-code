import path from 'node:path'
import { createMachineResourceSampler } from '../../core/resources/sampler/system'
import type { ResourceLaunchHost } from '../../core/resources/launchHost'
import type { ResourceRunningWork } from '../../core/resources/queue'
import { BOUNDED_FILE_READ_CHUNK_BYTES, RESOURCE_SAMPLE_MS, UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import {
  resourceSettingsSchema,
  type ResourceSettings,
  type ResourceStatus,
} from '../../shared/resources'
import { resourceHistoryReader, resourceHistoryRecorder } from './history'
import {
  createRuntimeResourceHost,
  type RuntimeGovernorShare,
  type RuntimeResourceProcess,
} from './host'
import type { ResourceHistoryPort, ResourceMachineStore } from './port'
import { resourceMachineStore } from './settings'

/** H–C1: what the process's launch host borrows, plus whether history is read. */
export interface RuntimeLaunchShare extends RuntimeGovernorShare {
  /** Attested settlements require the process's flag and the shared history choice. */
  readonly isRecording: () => boolean
}

export interface ResourceEntryOptions {
  machineDir: string
  sleep: (ms: number) => Promise<void>
  onError: (error: unknown) => void
  /**
  A damaged usage-history choice, once per distinct damage with what the
  person is told. Absent, the sentence falls back to `onError` (the ACP
  agent's existing resource-error channel) instead of the generic line.
  */
  onDamagedChoice?: (text: string) => void
  machine?: ResourceMachineStore
  running?: ResourceRunningWork
  history?: ResourceHistoryPort
  /**
  The run's flags over the machine values. A function is read at every
  settings sync, so the process facade's later run flags apply (H–C1).
  */
  overrides?: Partial<ResourceSettings> | (() => Partial<ResourceSettings> | undefined)
  hasRelocationTarget?: () => boolean
  /**
  Long-lived hosts (the ACP agent) record their governor's samples into the
  machine journal with this usage-history consent. One-shot commands and
  headless runs leave it unset, or false, and only read.
  */
  isRecordingHistory?: () => boolean
  /** H–C1: builds the process's governed launches around this host's one governor. */
  launches?: ((share: RuntimeLaunchShare) => ResourceLaunchHost) | undefined
}

/** W builds this entry as dist/resourceGovernor.js and ships it beside acp.js. */
export async function createResources(
  options: ResourceEntryOptions,
  table: UiText,
  locale: string,
): Promise<RuntimeResourceProcess> {
  setUiText(table, locale)
  const machine =
    options.machine ??
    resourceMachineStore({
      settingsFile: path.join(options.machineDir, 'resources.json'),
      resumeFile: path.join(options.machineDir, 'resource-resume.json'),
      sleep: options.sleep,
    })
  const overrides = () =>
    typeof options.overrides === 'function' ? options.overrides() : options.overrides
  let settings = resourceSettingsSchema.parse({})
  const isRecordingHistory = options.isRecordingHistory
  // H–C1: the harness-work rows are the process's registered launches (none
  // before the first governed launch), never an estimate.
  const bound: { host?: RuntimeResourceProcess } = {}
  const recorder =
    isRecordingHistory === undefined
      ? undefined
      : resourceHistoryRecorder(
          {
            dataFolder: options.machineDir,
            isEnabled: isRecordingHistory,
            onDamagedChoice: (notice) => {
              if (options.onDamagedChoice === undefined) {
                options.onError(new Error(notice.text))
              } else {
                options.onDamagedChoice(notice.text)
              }
            },
          },
          { read: () => Promise.resolve(bound.host?.launchRows() ?? []) },
          () => {
            options.onError(new Error(UI_TEXT.resourceHistoryInvalid))
          },
        )
  const launches = options.launches
  const host = await createRuntimeResourceHost({
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
      async readSettings() {
        // The run's flags ride on the machine values, so every sync applies them.
        const merged = resourceSettingsSchema.parse({
          ...(await machine.readSettings()),
          ...overrides(),
        })
        settings = merged
        return merged
      },
      readResumeUntil: () => machine.readResumeUntil(),
      writeResumeUntil: (untilMs) => machine.writeResumeUntil(untilMs),
    },
    sampler: createMachineResourceSampler(() => settings, {
      timeoutMs: RESOURCE_SAMPLE_MS,
      maxOutputBytes: BOUNDED_FILE_READ_CHUNK_BYTES,
    }),
    // Before the first governed launch nothing is admitted, so the count
    // stays unknown rather than zero; missing T occupancy never holds work:
    // throttle still admits background work, one per kind, on this queue's
    // own held permits.
    running: options.running ?? { backgroundCount: () => null },
    onError: () => {
      // Settings/OS failures carry no free-text diagnostic across a resource surface.
      options.onError(new Error(UI_TEXT.resourceUnavailable))
    },
    history: options.history ?? recorder?.history ?? resourceHistoryReader(options.machineDir),
    ...(recorder !== undefined && {
      onSample: (status: ResourceStatus) => {
        recorder.sample(status)
      },
    }),
    ...(options.hasRelocationTarget !== undefined && {
      hasRelocationTarget: options.hasRelocationTarget,
    }),
    ...(launches !== undefined && {
      launches: (share: RuntimeGovernorShare) =>
        launches({ ...share, isRecording: recorder?.isConsented ?? (() => false) }),
    }),
  })
  bound.host = host
  if (recorder === undefined) return host
  const stopEvents = host.subscribeEvents((event) => {
    recorder.event(event)
  })
  return {
    ...host,
    dispose() {
      stopEvents()
      host.dispose()
      // Best effort: the open minute is written if the process lives long enough.
      void recorder.flush().catch((error: unknown) => {
        // A failed flush reaches the error port with its cause under fixed
        // words; disposal itself never throws.
        options.onError(new Error(UI_TEXT.resourceHistoryInvalid, { cause: error }))
      })
    },
  }
}
