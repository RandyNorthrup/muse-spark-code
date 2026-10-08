import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import process from 'node:process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { statfs } from 'node:fs/promises'
import { TreeTempRoots } from '../../host/resources/tempRoots'
import type { ResourceTempRoots } from './launch'
import { ResourceDiskSampler, type ResourceDiskTarget } from './disk'
import { CreatedRegistry, type CreatedCleanup, type CreatedPathProof } from './createdRegistry'
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
export { spawnResourceProcess } from './process'
export { execResourceFile } from './commands'
import { runTreeProgram } from './trees/run'
import { powerShellQuoted } from '../shellQuote'
import {
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../shared/constants'

export interface ResourceHostSettings {
  /** W/H supply T's remaining native identity ports; absence is explicitly unknown. */
  readonly bindNativeTree?:
    ((launch: ResourceProcessLaunch) => Promise<ResourceTreeBinding | null>) | undefined
  /** W/U/H supply workspace/worktree, data/log and optional node-state roots. */
  readonly diskTargets?: (() => readonly ResourceDiskTarget[]) | undefined
  /** Portable TreeTempRoots adapter, shared by every editor/runtime. */
  readonly tempRoots?: ResourceTempRoots | undefined
  readonly created?: CreatedRegistry | undefined
  /** Foreign-platform directory helper; absence refuses temp allocation and deletion. */
  readonly createdDirectories?: CreatedPathProof['directories']
  /** W supplies a per-harness persisted manifest in app data for recovery. */
  readonly registryFile?: string | undefined
  readonly onCleanup?: ((result: CreatedCleanup) => void) | undefined
  readonly localization?: { readonly table: UiText; readonly locale: string } | undefined
  readonly inspect: ResourceSettingsReader
  readonly onError: () => void
  readonly windowsJob?:
    | (() => Promise<
        { readonly assemblyPath: string; readonly executablePath: string } | undefined
      >)
    | undefined
}
const state: { host?: ResourceLaunchHost } = {}

/** Query the native payload identity through the existing lazy governor bundle. */
export async function resourceJobRootPid(
  assemblyPath: string,
  systemRoot: string,
  jobName: string,
): Promise<number | undefined> {
  const reader = new WindowsResourceTreeReader({ assemblyPath, systemRoot })
  const root = await reader.rootOfJob(jobName)
  return root?.pid
}

/** Loaded by the first governed launch; a CommonJS module is shared by all bundles. */
export function resourceGovernorHost(options: ResourceHostSettings): ResourceLaunchHost {
  if (options.localization !== undefined)
    setUiText(options.localization.table, options.localization.locale)
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
  const directories =
    options.createdDirectories ??
    (process.platform === 'linux'
      ? undefined
      : async (args: readonly string[]) => {
          if (process.platform === 'darwin')
            return await runTreeProgram(
              path.join(__dirname, '..', 'native', 'darwin', 'muse-dictate'),
              ['--created-directory', ...args],
            )
          const systemRoot = process.env['SystemRoot']
          const job = await options.windowsJob?.()
          if (systemRoot === undefined || job === undefined || process.platform !== 'win32')
            throw new Error('Native creation directory helper is required')
          return await runTreeProgram(
            path.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
            [
              ...WINDOWS_POWERSHELL_COMMAND_ARGS,
              `try { [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(job.assemblyPath)}); [MuseSparkCreated]::Execute([string[]]@(${args.map((arg) => powerShellQuoted(arg)).join(',')})) } catch { exit 1 }`,
            ],
            { SystemRoot: systemRoot },
          )
        })
  let registryPending: Promise<CreatedRegistry> | undefined
  const registry = (): Promise<CreatedRegistry> => {
    registryPending ??=
      options.created === undefined
        ? CreatedRegistry.open(
            options.registryFile ??
              path.join(tmpdir(), 'muse-spark-code-resources', `${randomUUID()}.json`),
            () => clock.now(),
            {
              directories,
              files:
                directories ??
                ((args) =>
                  runTreeProgram(
                    path.join(__dirname, '..', 'native', 'linux', process.arch, 'muse-created'),
                    args,
                  )),
              exited: (owner) => Promise.resolve(state.host?.hasRetired(owner) ?? false),
              archivedAndClean: () =>
                Promise.reject(new Error('Archive/clean proof is not installed')),
              freeBytes: async (file) => {
                try {
                  const stats = await statfs(path.dirname(file), { bigint: true })
                  const bytes = Number(stats.bsize * stats.bavail)
                  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null
                } catch {
                  return null
                }
              },
            },
          )
        : Promise.resolve(options.created)
    return registryPending
  }
  const created = options.created ?? {
    finish: async (owner: string, isFailed: boolean) => {
      const store = await registry()
      await store.finish(owner, isFailed)
    },
    clean: async () => {
      const store = await registry()
      return await store.clean()
    },
  }
  const disks = new ResourceDiskSampler(
    options.diskTargets?.() ?? [{ role: 'temp', path: tmpdir() }],
    settings,
  )
  const tempRoots = options.tempRoots ?? {
    create: async (owner: string) => {
      const store = await registry()
      return await new TreeTempRoots(store.base, store, disks).create(owner)
    },
  }
  const events = new ResourceEvents(options.onError)
  const governor = new ResourceGovernor({
    clock,
    events,
    settings: settings(),
    sampler: createMachineResourceSampler(
      settings,
      {
        timeoutMs: RESOURCE_SAMPLE_MS,
        maxOutputBytes: BOUNDED_FILE_READ_CHUNK_BYTES,
      },
      disks,
    ),
    // No relocation route exists on this build: M100's paired-device offers and
    // M96c/C2's attempt claim/retirement are not joined, and nothing constructs
    // R's relocator. Pressure goes from throttle to pause and status says why.
    hasRelocationTarget: null,
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
    disks,
    tempRoots,
    created,
    onCleanup: options.onCleanup,
    onError: options.onError,
  })
  return state.host
}
