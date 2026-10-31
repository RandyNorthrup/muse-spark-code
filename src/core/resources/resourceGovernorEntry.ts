import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import process from 'node:process'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { statfs } from 'node:fs/promises'
import { TreeTempRoots } from '../../host/resources/tempRoots'
import type { ResourceTempRoots, ResourceWindowsJob } from './launch'
import { ResourceDiskSampler, type ResourceDiskTarget } from './disk'
import { CreatedRegistry, type CreatedCleanup, type CreatedPathProof } from './createdRegistry'
import { agentDataFolder } from '../../runtime/dataFolder'
import { createdTreeCreator, isCreatedTreeCreatorGone } from './createdOwner'
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
import type { WindowsResourceTreeReader } from './trees/windows'
import type { ResourceAdmission, ResourceLaunchRequest } from './queue'
// POSTSPAWN: the launcher and helper preparation live in dist/resourceProcess.js.
import {
  createResources as createRuntimeResources,
  type ResourceEntryOptions,
  type RuntimeLaunchShare,
} from '../../runtime/resources/entry'
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
  /**
  M96c's cached approved runner routes; registering does no discovery or
  probing. Null declares no relocation route at all, so pressure goes
  throttle to pause and the UI explains that relocation is unavailable.
  */
  readonly hasRelocationTarget?: (() => boolean) | null | undefined
  /** Runtime shares its existing machine governor's queue with process launches. */
  readonly admission?: (
    request: ResourceLaunchRequest,
    signal?: AbortSignal,
  ) => Promise<ResourceAdmission>
  /**
  H–C1: the runtime's one governor host builds this process's launches;
  undefined (an embedding without them) falls back to this host's own.
  */
  readonly runtime?: (() => Promise<ResourceLaunchHost | undefined>) | undefined
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
const state: { recorder?: ResourceHistoryRecorder } = {}

/**
The runtime's entry (H–C1). With `spawns`, the process's governed launches
are built around the runtime host's one governor, so their occupancy, their
events and their harness-work rows are that governor's: never a second one.
*/
export async function createResources(
  options: ResourceEntryOptions & { readonly spawns?: ResourceHostSettings | undefined },
  table: UiText,
  locale: string,
): ReturnType<typeof createRuntimeResources> {
  const { spawns, ...entry } = options
  return await createRuntimeResources(
    spawns === undefined
      ? entry
      : { ...entry, launches: (share) => resourceGovernorHost(spawns, share) },
    table,
    locale,
  )
}

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

/**
Loaded by the first governed launch; a CommonJS module is shared by all bundles.
The window owns its governor; the runtime passes `share`, its own (H–C1).
*/
export function resourceGovernorHost(
  options: ResourceHostSettings,
  share?: RuntimeLaunchShare,
): ResourceLaunchHost {
  if (options.localization !== undefined)
    setUiText(options.localization.table, options.localization.locale)
  const settings = share?.settings ?? (() => readResourceSettings(options.inspect))
  // This call's own host: the registry's exit proof asks it, never a later one.
  const launched: { host?: ResourceLaunchHost } = {}
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
  // The installation identity lives beside the registry, never in a
  // caller's home by default from a test.
  const creatorData = agentDataFolder({
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
  })
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
              exited: (owner) => Promise.resolve(launched.host?.hasRetired(owner) ?? false),
              // Entries name this process with exact evidence, so a later
              // start can prove it exited and reclaim what a kill, crash
              // or power loss left behind. A pid absent from this
              // namespace is not that proof (RLF-TEMPLEAK, RVTEMPLEAK).
              creator: () => createdTreeCreator(creatorData),
              creatorExited: (creator) => isCreatedTreeCreatorGone(creator, creatorData),
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
  // H–C1: the runtime lends its one governor and its events; the window owns its own.
  const events = share?.events ?? new ResourceEvents(options.onError)
  const governor =
    share?.governor ??
    new ResourceGovernor({
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
      // R: the join switch (resourceRunnerRoutesJoin) and the M100/M96c
      // bindings decide whether a relocation route exists; without one,
      // pressure goes from throttle to pause and status says why.
      hasRelocationTarget: options.hasRelocationTarget ?? null,
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
        // The Windows reader rides its own bundle beside the governor's
        // (dist/resourceGovernorWindows.js): the deferred cohort
        // externalises this import the way admission's reaches the
        // governor, so only a Windows job launch loads it.
        const windows = await import('./trees/windowsEntry')
        reader = windows.createWindowsResourceTreeReader({
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
  // The same effective consent gates collection and buffering, including shared settings.
  const recorder =
    share === undefined && options.history !== undefined
      ? resourceHistoryRecorder(
          options.history,
          { read: () => Promise.resolve(launched.host?.workRows() ?? []) },
          options.onError,
        )
      : undefined
  const host = new ResourceLaunchHost({
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
    isSettledRead: share?.isRecording ?? recorder?.isConsented,
    // H–C1: the runtime host owns the governor; its queue reads this occupancy.
    ...(share !== undefined && { isGovernorShared: true, onWorkChanged: share.workChanged }),
  })
  launched.host = host
  // Start sweep (RLF-TEMPLEAK): every host reclaims what earlier starts
  // left behind — trees whose creator is provably gone are ended and,
  // past their keep period, removed. It rides the registry's own queue
  // behind nothing of this start's, and reports like every other clean.
  void created
    .clean()
    .then((result) => options.onCleanup?.(result))
    .catch(options.onError)
  // The runtime's own recorder reads these launches (H–C1); the window records here.
  if (recorder !== undefined) {
    // The governor's own sample and event streams; recording never gates admission.
    state.recorder = recorder
    governor.onSample(() => {
      recorder.sample(governor.status([]))
    })
    events.subscribe((event) => {
      recorder.event(event)
    })
  }
  return host
}
