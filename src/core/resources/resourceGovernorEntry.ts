import process from 'node:process'
import { BOUNDED_FILE_READ_CHUNK_BYTES, RESOURCE_SAMPLE_MS } from '../../shared/constants'
import {
  readResourceSettings,
  type ResourceClock,
  type ResourceSettingsReader,
} from '../../shared/resources'
import { ResourceGovernor } from './governor'
import { ResourceEvents } from './events'
import { ResourceLaunchHost } from './launchHost'
import type { ResourceProcessLaunch, ResourceTreeBinding } from './launch'
import { createMachineResourceSampler } from './sampler/system'
import { LinuxResourceTreeReader } from './trees/linux'
import { WindowsResourceTreeReader } from './trees/windows'
export { createResources } from '../../runtime/resources/entry'

export interface ResourceHostSettings {
  /** W/H supply T's remaining native identity ports; absence is explicitly unknown. */
  readonly bindNativeTree?:
    ((launch: ResourceProcessLaunch) => Promise<ResourceTreeBinding | null>) | undefined
  readonly inspect: ResourceSettingsReader
  readonly onError: () => void
  readonly windowsJob?:
    | (() => Promise<
        { readonly assemblyPath: string; readonly executablePath: string } | undefined
      >)
    | undefined
}
const state: { host?: ResourceLaunchHost } = {}

/** Loaded by the first governed launch; a CommonJS module is shared by all bundles. */
export function resourceGovernorHost(options: ResourceHostSettings): ResourceLaunchHost {
  if (state.host !== undefined) return state.host
  const settings = () => readResourceSettings(options.inspect)
  const clock: ResourceClock = {
    now: () => Date.now(),
    setTimeout: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timer.unref()
      return () => {
        clearTimeout(timer)
      }
    },
  }
  const events = new ResourceEvents(options.onError)
  const governor = new ResourceGovernor({
    clock,
    events,
    settings: settings(),
    sampler: createMachineResourceSampler(settings, {
      timeoutMs: RESOURCE_SAMPLE_MS,
      maxOutputBytes: BOUNDED_FILE_READ_CHUNK_BYTES,
    }),
    hasRelocationTarget: () => false,
    onError: options.onError,
  })
  const linux = process.platform === 'linux' ? new LinuxResourceTreeReader() : undefined
  const readers = new Map<string, WindowsResourceTreeReader>()
  const bindTree = async (launch: ResourceProcessLaunch): Promise<ResourceTreeBinding | null> => {
    if (process.platform === 'win32' && launch.job !== undefined) {
      const systemRoot = process.env['SystemRoot']
      if (systemRoot === undefined) return null
      let reader = readers.get(launch.job.assemblyPath)
      if (reader === undefined) {
        reader = new WindowsResourceTreeReader({
          assemblyPath: launch.job.assemblyPath,
          systemRoot,
        })
        readers.set(launch.job.assemblyPath, reader)
      }
      const root =
        launch.pid === undefined
          ? await reader.rootOfJob(launch.job.name)
          : await reader.identity(launch.pid)
      const name = launch.job.name
      const isRetired = launch.job.isRetired
      return {
        reader,
        root,
        scope: { type: 'job', name },
        gone: async () => (isRetired?.() ?? true) && (await reader.jobGone(name)),
      }
    }
    if (linux !== undefined && launch.pid !== undefined && launch.group === true) {
      const root =
        launch.parentPid === undefined
          ? await linux.identity(launch.pid)
          : await linux.childIdentity(launch.pid, launch.parentPid)
      if (root === null && launch.parentPid !== undefined) return null
      const pgid = launch.pid
      return {
        reader: linux,
        root,
        scope: { type: 'group', pgid },
        gone: () => {
          try {
            process.kill(-pgid, 0)
            return Promise.resolve(false)
          } catch (error: unknown) {
            return Promise.resolve(
              typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 'ESRCH',
            )
          }
        },
      }
    }
    // No guessed macOS start time or Windows membership: W/H bind remaining native scopes.
    return (await options.bindNativeTree?.(launch)) ?? null
  }
  state.host = new ResourceLaunchHost({
    governor,
    events,
    clock,
    settings,
    bindTree,
    onError: options.onError,
  })
  return state.host
}
