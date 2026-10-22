import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import process from 'node:process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { statfs } from 'node:fs/promises'
import { TreeTempRoots } from '../../host/resources/tempRoots'
import type { ResourceTempRoots, ResourceWindowsJob } from './launch'
import { ResourceDiskSampler, type ResourceDiskTarget } from './disk'
import { CreatedRegistry, type CreatedCleanup, type CreatedPathProof } from './createdRegistry'
import {
  BOUNDED_FILE_READ_CHUNK_BYTES,
  RESOURCE_HISTORY_FLUSH_TIMEOUT_MS,
  RESOURCE_SAMPLE_MS,
} from '../../shared/constants'
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
import type { ResourceAdmission, ResourceLaunchRequest } from './queue'
// POSTSPAWN: the launcher and helper preparation live in dist/resourceProcess.js.
export { createResources } from '../../runtime/resources/entry'
// M105 lanes V and VB: the converter's macOS RSS sampler reads through this
// bundle's policy modules, so it ships here and loads with it.
export { macRssSampler } from '../media/macRss'
export { resourceMachineStore } from '../../runtime/resources/settings'
// U–C1: the window's status item and pause notices load with the governor, never at activation.
export {
  createResourceStatus,
  createVsCodeResourceStatusItem,
} from '../../host/resources/resourceStatus'
import {
  resourceHistoryRecorder,
  type ResourceHistoryBinding,
  type ResourceHistoryRecorder,
} from '../../runtime/resources/history'
import { probeChildEnvironment } from '../executables'
import { windowsPowerShell } from '../execGuard'
import { runTreeProgram } from './trees/run'
import { powerShellQuoted } from '../shellQuote'
import {
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  darwinDictationHelperSegments,
} from '../../shared/constants'

import { isErrno } from '../fs/errno'

export interface ResourceHostSettings {
  /** Runtime shares its existing machine governor's queue with process launches. */
  readonly admission?: (
    request: ResourceLaunchRequest,
    signal?: AbortSignal,
  ) => Promise<ResourceAdmission>
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
  /** M107 J/M102: record this window's samples into the machine journal, with usage consent. */
  readonly history?: ResourceHistoryBinding | undefined
  readonly inspect: ResourceSettingsReader
  /** A failure the governor survives; the error, when there is one, names its cause. */
  readonly onError: (error?: unknown) => void
  readonly windowsJob?: (() => Promise<ResourceWindowsJob | undefined>) | undefined
}
const state: { host?: ResourceLaunchHost; recorder?: ResourceHistoryRecorder } = {}

/**
Window disposal (RVM107W2 P2): the open minute and any pending snapshot are
written, waiting at most RESOURCE_HISTORY_FLUSH_TIMEOUT_MS so shutdown never hangs.
*/
export async function flushResourceHistory(): Promise<void> {
  const recorder = state.recorder
  if (recorder === undefined) return
  let cancel: (() => void) | undefined
  try {
    await Promise.race([
      recorder.flush(),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, RESOURCE_HISTORY_FLUSH_TIMEOUT_MS)
        timer.unref()
        cancel = () => {
          clearTimeout(timer)
        }
      }),
    ])
  } finally {
    cancel?.()
  }
}

/**
The created-path registry's native file commands on this platform: the
Linux `muse-created` helper, the macOS helper's `--created-directory`, or
Windows PowerShell loading the job assembly's `MuseSparkCreated`. One
wiring for the product (its native root is `dist/../native`) and for the
tests that run the registry on each platform.
*/
export function createdPathCommands(
  nativeRoot: string,
  windowsJob: (() => Promise<ResourceWindowsJob | undefined>) | undefined,
  platform: NodeJS.Platform = process.platform,
): (args: readonly string[]) => Promise<string> {
  if (platform === 'linux')
    return (args) =>
      runTreeProgram(
        path.join(nativeRoot, 'linux', process.arch, 'muse-created'),
        args,
        probeChildEnvironment({ LC_ALL: 'C' }),
      )
  if (platform === 'darwin')
    return (args) =>
      runTreeProgram(
        path.join(nativeRoot, ...darwinDictationHelperSegments(process.arch)),
        ['--created-directory', ...args],
        probeChildEnvironment({ LC_ALL: 'C' }),
      )
  return async (args) => {
    const systemRoot = process.env['SystemRoot']
    const job = await windowsJob?.()
    if (systemRoot === undefined || job === undefined || platform !== 'win32')
      throw new Error('Native creation directory helper is required')
    const powershell = windowsPowerShell(systemRoot, { SystemRoot: systemRoot })
    return await runTreeProgram(
      powershell.file,
      [
        ...WINDOWS_POWERSHELL_COMMAND_ARGS,
        `try { [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(job.assemblyPath)}); [MuseSparkCreated]::Execute([string[]]@(${args.map((arg) => powerShellQuoted(arg)).join(',')})) } catch { exit 1 }`,
      ],
      powershell.env,
    )
  }
}

/** Loaded by the first governed launch; a CommonJS module is shared by all bundles. */
export function resourceGovernorHost(options: ResourceHostSettings): ResourceLaunchHost {
  if (options.localization !== undefined)
    setUiText(options.localization.table, options.localization.locale)
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
  const nativeCommands = createdPathCommands(
    path.join(__dirname, '..', 'native'),
    options.windowsJob,
  )
  const directories =
    options.createdDirectories ?? (process.platform === 'linux' ? undefined : nativeCommands)
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
              files: directories ?? nativeCommands,
              exited: (owner) => Promise.resolve(state.host?.hasRetired(owner) ?? false),
              archivedAndClean: () =>
                Promise.reject(new Error('Archive/clean proof is not installed')),
              freeBytes: async (file) => {
                try {
                  const stats = await statfs(path.dirname(file), { bigint: true })
                  const bytes = Number(stats.bsize * stats.bavail)
                  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null
                } catch (error) {
                  // A filesystem that cannot answer leaves unknown space. Only
                  // errno failures read that way.
                  if (!isErrno(error)) throw error
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
            // Only a confirmed ESRCH proves the group gone; anything else is
            // not a liveness answer.
            if (!isErrno(error)) throw error
            return Promise.resolve(error.code === 'ESRCH')
          }
        },
      }
    }
    // No guessed macOS start time or Windows membership: W/H bind remaining native scopes.
    return (await options.bindNativeTree?.(launch)) ?? null
  }
  state.host = new ResourceLaunchHost({
    ...(options.admission !== undefined && { admission: options.admission }),
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
    // POSTSPAWN: attested Windows launches are never tree-sampled; their final
    // job accounting is history's only record of them, kept while it is read.
    isSettledRead: options.history !== undefined,
  })
  if (options.history !== undefined) {
    // The governor's own sample and event streams; recording never gates admission.
    const host = state.host
    const recorder = (state.recorder = resourceHistoryRecorder(
      options.history,
      // Each read drains the settled rows, so an attested tree is recorded once.
      { read: () => Promise.resolve([...host.settled().rows, ...host.treeUsage()]) },
      options.onError,
    ))
    governor.onSample(() => {
      recorder.sample(governor.status([]))
    })
    events.subscribe((event) => {
      recorder.event(event)
    })
  }
  return state.host
}
