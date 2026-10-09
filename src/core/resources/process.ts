import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { admitBootstrap, admitResource, resourceWindowsJob, stopResourceTree } from './admission'
import {
  resourceEnvironment,
  type ResourceLaunchProfile,
  type ResourceProcessOptions,
  type ResourcePipedProcess,
  type ResourceHandoffProcess,
  type ResourceInteractiveProcess,
  type ResourceLease,
} from './launch'
import type { AttestedJobControl, JobRecord } from '../../host/backend/mcpJobLaunch'
import type { ResourceProcessIdentity } from '../../shared/resources'
import { withoutCredentials } from '../credentialEnvironment'
import {
  CLI_OUTPUT_MAX_BYTES,
  MILLISECONDS_PER_SECOND,
  PROCESS_TABLE_TIMEOUT_MS,
  RESOURCE_HANDOFF_TIMEOUT_MS,
  RESOURCE_JOB_EMPTY_MS,
  RESOURCE_JOB_SAMPLE_MS,
  RESOURCE_TREE_PROCESS_CAP,
  RESOURCE_TREE_SPAWN_CAP,
  RESOURCE_TREE_SPAWN_WINDOW_MS,
  TREE_EXIT_WAIT_MS,
  WINDOWS_TASKKILL_RELATIVE_PATH,
} from '../../shared/constants'

/** Ends only this caller's wait at its deadline or cancellation; shared work keeps running. */
async function untilAborted<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return await pending
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        abort = () => {
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new DOMException('Resource admission cancelled', 'AbortError'),
          )
        }
        signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort)
  }
}

/** The job's caps, enforced by the job object and the helper, never by a reader process. */
const ATTESTED_JOB = {
  activeProcessLimit: RESOURCE_TREE_PROCESS_CAP,
  spawnLimit: RESOURCE_TREE_SPAWN_CAP,
  spawnWindowMs: RESOURCE_TREE_SPAWN_WINDOW_MS,
  sampleMs: RESOURCE_JOB_SAMPLE_MS,
  emptyTimeoutMs: RESOURCE_JOB_EMPTY_MS,
}

/**
 * After the helper's observed exit the tree is gone: the helper ended and
 * drained the job, or the kernel ended it when the helper's only handle closed.
 * A missing record leaves usage uncertain; it never refuses the completion.
 */
async function settleAttested(
  resource: ResourceLease,
  control: AttestedJobControl,
  code: number | null,
): Promise<void> {
  let answers: [ResourceProcessIdentity | undefined, JobRecord | undefined]
  try {
    answers = await Promise.all([control.root, control.record])
  } catch {
    // An unreadable answer is the same as a missing one: usage uncertain, never refused.
    answers = [undefined, undefined]
  }
  const [root, record] = answers
  if (root !== undefined)
    resource.settle?.({
      root,
      scope: `attested-${String(root.pid)}-${root.startTime}`,
      usage:
        record === undefined
          ? null
          : {
              cpuSeconds: record.cpuMs / MILLISECONDS_PER_SECOND,
              residentBytes: record.peakJobMemoryBytes,
            },
    })
  if (code !== 0 || record?.ending === 'spawnRate') resource.failed?.()
  resource.complete(true)
}

/** Emergency bootstrap termination cannot depend on the helper being compiled. */
async function stopBootstrap(root: ChildProcess): Promise<void> {
  const { pid } = root
  if (pid === undefined) return
  if (process.platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ESRCH'
      ))
        throw error
    }
    return
  }
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined) throw new Error('Bootstrap tree termination unavailable')
  await new Promise<void>((resolve, reject) => {
    // OS termination infrastructure must remain usable while admission is paused.
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Fixed SystemRoot taskkill, numeric owned root PID, bounded output/deadline, credential-free environment; emergency termination cannot queue behind pause (PLAN SPAWN017B/SPAWN017C, section 8).
    execFile(
      path.win32.join(systemRoot, WINDOWS_TASKKILL_RELATIVE_PATH),
      ['/PID', String(pid), '/T', '/F'],
      {
        env: { SystemRoot: systemRoot },
        windowsHide: true,
        timeout: PROCESS_TABLE_TIMEOUT_MS,
        maxBuffer: CLI_OUTPUT_MAX_BYTES,
      },
      (error) => {
        // taskkill refuses a root that already exited; that root needs no stop.
        if (error === null || root.exitCode !== null || root.signalCode !== null) resolve()
        else reject(new Error('Bootstrap tree termination failed'))
      },
    )
  })
}

/** Root-only stop: a handoff or terminal program never owns what it handed to the user. */
function stopRoot(root: ChildProcess): Promise<void> {
  if (root.exitCode === null && root.signalCode === null) root.kill('SIGKILL')
  return Promise.resolve()
}

/** Profiles whose whole tree the launcher owns: a job or group, retired by the registry. */
const isTreeOwned = (profile: ResourceLaunchProfile) =>
  profile === 'contained' || profile === 'probe'

function admitProfile(
  profile: ResourceLaunchProfile,
  signal: AbortSignal | undefined,
): Promise<ResourceLease | undefined> {
  if (profile === 'bootstrap') return admitBootstrap(signal)
  // A read-only probe keeps admission and containment but writes nothing, so it
  // owns no temp root (D87.14's dated narrowing). Everything else gets one.
  if (profile === 'probe')
    return admitResource('other', signal, undefined, undefined, undefined, true)
  // Handoff is background work: at pause it is refused at once, never queued.
  return admitResource('other', signal, profile === 'handoff' ? 'background' : undefined)
}

/** Cancel or deadline stops what the profile owns, until the root's `until` event. */
function stopOnAbort(
  child: ChildProcess,
  resource: ResourceLease,
  signal: AbortSignal | undefined,
  stop: () => Promise<void>,
  until: 'exit' | 'close',
): void {
  const abort = () => {
    resource.failed?.()
    void stop().catch(() => resource.failed?.())
  }
  signal?.addEventListener('abort', abort, { once: true })
  child.once(until, () => signal?.removeEventListener('abort', abort))
  if (signal?.aborted === true) abort()
}

/** Observe a root-only profile's exit; abort stops that root. */
function observe(
  child: ChildProcess,
  resource: ResourceLease,
  signal: AbortSignal | undefined,
  stop: () => Promise<void>,
  isTreeGoneAtExit: boolean,
): void {
  child.once('exit', (code) => {
    if (code !== 0) resource.failed?.()
    resource.complete(isTreeGoneAtExit)
  })
  child.once('error', () => {
    resource.failed?.()
    resource.complete(isTreeGoneAtExit || child.pid === undefined)
  })
  stopOnAbort(child, resource, signal, stop, 'exit')
}

function spawnInteractive(
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
  resource: ResourceLease,
  signal: AbortSignal | undefined,
): ResourceInteractiveProcess {
  // Inherited stdio, no new session or group: the terminal's Ctrl+C and TTY reach it.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Admitted foreground terminal program (`muse login`): argument array, no shell, inherited session, owned root shutdown (PLAN SPAWN017C, section 8).
  const child = spawn(file, [...args], {
    ...options,
    signal: undefined,
    detached: false,
    stdio: 'inherit',
    shell: false,
  })
  const stop = () => stopRoot(child)
  resource.register({ pid: child.pid, profile: 'interactive', stop })
  observe(child, resource, signal, stop, true)
  return { child, stop, pid: () => Promise.resolve(child.pid) }
}

function spawnHandoff(
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
  resource: ResourceLease,
  signal: AbortSignal,
): ResourceHandoffProcess {
  // The caller's own environment, never the lease's temporary root: a browser the
  // OS starts outlives this lease and must not keep TMPDIR under governed cleanup.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Admitted fixed OS hand-off adapter: argument array, no shell, output to the null device, named deadline, root-only stop (PLAN SPAWN017C, section 8).
  const child = spawn(file, [...args], {
    ...options,
    signal: undefined,
    detached: false,
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true,
    shell: false,
  })
  const stop = () => stopRoot(child)
  resource.register({ pid: child.pid, profile: 'handoff', stop })
  observe(child, resource, signal, stop, true)
  return { child, stop, pid: () => Promise.resolve(child.pid) }
}

async function spawnPiped(
  profile: 'contained' | 'probe' | 'bootstrap',
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
  extraDescriptors: readonly number[],
  resource: ResourceLease,
  signal: AbortSignal | undefined,
  spawned: { value: boolean },
): Promise<ResourcePipedProcess> {
  let child: ChildProcess
  let stop: () => Promise<void>
  let payloadPid: (() => Promise<number | undefined>) | undefined
  if (isTreeOwned(profile) && process.platform === 'win32') {
    const job = await untilAborted(resourceWindowsJob(), signal)
    if (job === undefined || extraDescriptors.length > 0) {
      signal?.throwIfAborted()
      throw new Error('Native governed process launch unavailable')
    }
    const { spawnAttestedJob } = await import('../../host/backend/mcpJobLaunch.js')
    signal?.throwIfAborted()
    const { child: launcher, control } = spawnAttestedJob({
      executablePath: job.executablePath,
      file,
      args,
      cwd: options.cwd?.toString() ?? process.cwd(),
      env: options.env ?? {},
      isVerbatim: false,
      resource,
      attestation: ATTESTED_JOB,
      log: () => {
        /* Callers report fixed failure words. */
      },
    })
    spawned.value = true
    child = launcher
    // STOP asks the helper to end and drain the job; if it cannot answer, ending
    // the helper closes the job's only handle and the kernel ends the tree.
    stop = async () => {
      if (launcher.exitCode !== null || launcher.signalCode !== null) return
      const exited = (async () => {
        await once(launcher, 'exit')
        return true
      })()
      control.stop()
      if (!(await Promise.race([exited, delay(TREE_EXIT_WAIT_MS, false)]))) launcher.kill()
    }
    resource.register({ pid: launcher.pid, profile, attested: true, stop })
    launcher.once('exit', (code) => {
      void settleAttested(resource, control, code)
    })
    launcher.once('error', () => {
      resource.failed?.()
      if (launcher.pid === undefined) resource.complete(true)
    })
    payloadPid = async () => {
      const root = await control.root
      return root?.pid
    }
  } else {
    const isGroup = process.platform !== 'win32'
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Admitted payload or bootstrap compiler: argument array, no shell, pipes, its own POSIX group, owned whole-tree stop (PLAN SPAWN017C, section 8).
    const root = spawn(file, [...args], {
      ...options,
      signal: undefined,
      env:
        profile === 'bootstrap'
          ? withoutCredentials(options.env ?? {})
          : resourceEnvironment(options.env ?? {}, resource),
      detached: isGroup,
      stdio: ['pipe', 'pipe', 'pipe', ...extraDescriptors],
      windowsHide: true,
      shell: false,
    })
    spawned.value = true
    child = root
    stop =
      profile === 'bootstrap'
        ? () => {
            resource.failed?.()
            return stopBootstrap(root)
          }
        : () => stopResourceTree(resource)
    resource.register({ pid: root.pid, group: isGroup, profile, stop })
    if (isTreeOwned(profile)) {
      root.once('exit', (code) => {
        if (code !== 0) resource.failed?.()
        resource.complete(false)
      })
      root.once('error', () => {
        resource.failed?.()
        resource.complete(root.pid === undefined)
      })
    } else {
      // Bootstrap retires on close: its result is read only after every pipe ended.
      root.once('exit', (code) => {
        if (code !== 0) resource.failed?.()
      })
      root.once('error', () => resource.failed?.())
      root.once('close', () => {
        resource.complete(true)
      })
    }
  }
  if (isTreeOwned(profile)) {
    // A contained root's exit never leaves its descendants running.
    child.once('exit', () => {
      void stop().catch(() => resource.failed?.())
    })
    stopOnAbort(child, resource, signal, stop, 'close')
  }
  const { stdin, stdout, stderr } = child
  if (stdin === null || stdout === null || stderr === null) {
    await stop()
    throw new Error('Governed process pipes unavailable')
  }
  // The helper reported the payload root's PID before resuming it.
  const pid = payloadPid ?? (() => Promise.resolve(child.pid))
  return { child: Object.assign(child, { stdin, stdout, stderr }), stop, pid }
}

export function spawnResourceProcess(
  profile: 'interactive',
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
): Promise<ResourceInteractiveProcess>
export function spawnResourceProcess(
  profile: 'handoff',
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
): Promise<ResourceHandoffProcess>
export function spawnResourceProcess(
  profile: 'contained' | 'probe' | 'bootstrap',
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
  extraDescriptors?: readonly number[],
): Promise<ResourcePipedProcess>
/** The one governed launch: every caller names its profile (PLAN SPAWN017C). */
export async function spawnResourceProcess(
  profile: ResourceLaunchProfile,
  file: string,
  args: readonly string[],
  options: ResourceProcessOptions,
  extraDescriptors: readonly number[] = [],
): Promise<ResourceInteractiveProcess | ResourceHandoffProcess | ResourcePipedProcess> {
  if (profile === 'handoff') {
    // The named deadline covers the handoff's admission and the adapter's run.
    const deadline = AbortSignal.timeout(RESOURCE_HANDOFF_TIMEOUT_MS)
    const signal =
      options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
    return await withLease(profile, signal, (resource, spawned) => {
      spawned.value = true
      return Promise.resolve(spawnHandoff(file, args, options, resource, signal))
    })
  }
  const { signal } = options
  if (profile === 'interactive')
    return await withLease(profile, signal, (resource, spawned) => {
      spawned.value = true
      return Promise.resolve(spawnInteractive(file, args, options, resource, signal))
    })
  return await withLease(profile, signal, (resource, spawned) =>
    spawnPiped(profile, file, args, options, extraDescriptors, resource, signal, spawned),
  )
}

/** Admission first; a launch that fails before its spawn returns the lease unused. */
async function withLease<T>(
  profile: ResourceLaunchProfile,
  signal: AbortSignal | undefined,
  launch: (resource: ResourceLease, spawned: { value: boolean }) => Promise<T>,
): Promise<T> {
  const resource = await admitProfile(profile, signal)
  if (resource === undefined) throw new Error('Resource admission unavailable')
  const spawned = { value: false }
  try {
    signal?.throwIfAborted()
    return await launch(resource, spawned)
  } catch (error: unknown) {
    resource.failed?.()
    resource.complete(!spawned.value)
    throw error
  }
}
