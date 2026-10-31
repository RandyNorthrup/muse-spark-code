// Windows containment for the playbook's git and hook calls (M116, PLAN.md
// D96.15 and §9 FIXM116P3-Windows-job-binding). The policy is synchronous and
// asks for each call's whole tree to have ended before the call returns.
//
// One helper process serves one decision: the shipped job helper run as a
// program of its own (MuseSparkJobHost's `contained`, no PowerShell start).
// It joins a fresh named job, so everything a call starts belongs to that job
// from its creation. After each call it ends every other member of the job,
// each checked by its start identity, and answers only once it is the job's
// only member; a tree it cannot end within the bound fails the call and ends
// the job. When the decision's pipe closes, or no call arrives in time, the
// helper terminates the job, itself included.
//
// The job is kill-on-close and the helper holds its only handle: a helper
// that dies, however it dies, takes its whole job with it, by the operating
// system's own rule and with nobody left to ask. And nothing here forgets a
// job before its end was seen: a job's name stays published until its
// helper is gone or a termination by name has confirmed that it is empty.
// A lost helper is a refused call and a kill, never a forgotten job.
//
// The caller blocks on the pipe with synchronous reads, which is why this
// runs on the playbook's worker thread and never on the extension host.

import {
  spawn as spawnProcess,
  spawnSync,
  type SpawnSyncOptions,
  type SpawnSyncReturns,
} from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, readSync, writeSync } from 'node:fs'
import {
  GIT_OUTPUT_MAX_BYTES,
  GIT_TIMEOUT_MS,
  PLAYBOOK_JOB_CONNECT_MS,
  PLAYBOOK_JOB_CONNECT_POLL_MS,
  PLAYBOOK_JOB_FLAGS,
  PLAYBOOK_JOB_FRAME_HEADER_BYTES,
  PLAYBOOK_JOB_IDLE_MS,
  PLAYBOOK_JOB_NAME_PREFIX,
  PLAYBOOK_JOB_PIPE_PREFIX,
  PLAYBOOK_JOB_PIPE_ROOT,
  PLAYBOOK_JOB_SWEEP_MS,
  POSIX_TREE_EXIT_POLL_MS,
} from '../../shared/constants'
import type { PlaybookHookEffect } from '../../core/orchestration/playbook/outcomes'
import { windowsJobHost } from '../../core/execGuard'

const FLAGS = PLAYBOOK_JOB_FLAGS
const NEWLINE = 10
const SEPARATOR = '\n'

/**
The job helper's arguments to serve one decision (MuseSparkJobHost's
`contained` in native/windows/MuseSparkJob.cs): the job's name, the pipe's,
and the bounds it serves by. Every value a call needs arrives over the pipe.
*/
function serveArgs(name: string, pipe: string): readonly string[] {
  return [
    'contained',
    name,
    pipe,
    String(PLAYBOOK_JOB_IDLE_MS),
    String(PLAYBOOK_JOB_SWEEP_MS),
    String(POSIX_TREE_EXIT_POLL_MS),
    String(PLAYBOOK_JOB_CONNECT_POLL_MS),
  ]
}

/**
The job helper's arguments to end a job by its name (`end-job`): it exits 0
only once the job has no member left, or no longer exists. For a job whose
helper cannot be asked any more.
*/
export function endJobArgs(name: string): readonly string[] {
  return ['end-job', name, String(PLAYBOOK_JOB_SWEEP_MS), String(PLAYBOOK_JOB_CONNECT_POLL_MS)]
}

/** One argument as the Microsoft C runtime (and git) reads a command line. */
export function windowsArgument(argument: string): string {
  if (argument !== '' && !/[\s"]/u.test(argument)) return argument
  let quoted = '"'
  let slashes = 0
  for (const character of argument) {
    if (character === '\\') {
      slashes += 1
      continue
    }
    quoted +=
      character === '"' ? `${'\\'.repeat(slashes * 2 + 1)}"` : `${'\\'.repeat(slashes)}${character}`
    slashes = 0
  }
  return `${quoted}${'\\'.repeat(slashes * 2)}"`
}

/** The helper as this module starts it, in its own folder; a test stands in a process of its own. */
export type StartContainedHelper = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
) => { readonly pid?: number | undefined; unref(): void }

export interface ContainedJobDeps {
  /** The compiled job helper (`shellJob.ts`), prepared by the window: an absolute path. */
  readonly assemblyPath: string
  readonly systemRoot: string
  /**
  Told the names of every job whose end has not been seen yet: a job's
  name before its first call, and again without it only once it is known
  to be over. The window ends by name whatever is still listed when its
  worker stops.
  */
  readonly onJob: (names: readonly string[]) => void
  readonly start?: StartContainedHelper
  /**
  Ends a job by name; true only when it was seen empty or gone. A test
  stands in its own; by default the job helper's `end-job` runs.
  */
  readonly end?: (name: string) => boolean
  /** How long a live helper may take to serve its pipe; a test shortens it. */
  readonly connectMs?: number
}

interface Session {
  readonly name: string
  readonly descriptor: number
  readonly pid: number | undefined
}

const startHelper: StartContainedHelper = (file, args, env, cwd) => {
  const helper = spawnProcess(file, [...args], { env, cwd, stdio: 'ignore', windowsHide: true })
  helper.once('error', () => {
    // A helper that could not start has no process: the open below sees no
    // pipe and no process, and fails the call closed.
  })
  return helper
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms)
}

/** Whether the signal's failure says the process is gone (`ESRCH`), and nothing else. */
function isGone(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH'
}

/** Whether closing failed only because the descriptor is already closed. */
function isClosed(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EBADF'
}

/** Whether a failed look says what it looked for is not there, and nothing else. */
function isAbsent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isRunning(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    // Anything but gone is not an answer: a process that cannot be signalled
    // is not one known to be over.
    if (!isGone(error)) throw error
    return false
  }
}

function encoded(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

function failure(code: string, cause?: unknown): SpawnSyncReturns<Buffer> {
  const empty = Buffer.alloc(0)
  return {
    pid: 0,
    output: [null, empty, empty],
    stdout: empty,
    stderr: empty,
    status: null,
    signal: null,
    error: Object.assign(new Error(code, { cause }), { code }),
  }
}

function answered(
  pid: number | undefined,
  status: number,
  flags: number,
  streams: { readonly stdout: Buffer; readonly stderr: Buffer },
): SpawnSyncReturns<Buffer> {
  // A tree the helper could not end certifies nothing: the job goes with it.
  if ((flags & FLAGS.uncertain) !== 0) throw new Error('EPIPE')
  if ((flags & FLAGS.timedOut) !== 0) return failure('ETIMEDOUT')
  if ((flags & FLAGS.overflowed) !== 0) return failure('ENOBUFS')
  if ((flags & FLAGS.unstarted) !== 0) return failure('ENOENT')
  return {
    pid: pid ?? 0,
    output: [null, streams.stdout, streams.stderr],
    stdout: streams.stdout,
    stderr: streams.stderr,
    status,
    signal: null,
  }
}

/**
The contained runner the policy's `PlaybookHookAdmission.runContained`
binds to on Windows. A decision's calls share one job; `close` ends it,
and is scheduled for the end of the synchronous stretch that used it.
*/
export class ContainedJob {
  private session: Session | undefined
  private closing: ReturnType<typeof setImmediate> | undefined
  /** Jobs whose end has not been seen: the one in use, and any that could not be confirmed over. */
  private readonly unended = new Set<string>()

  constructor(private readonly deps: ContainedJobDeps) {}

  private publish(): void {
    this.deps.onJob([...this.unended])
  }

  /** Ends a job by name and says whether its end was seen. */
  private endByName(name: string): boolean {
    if (this.deps.end !== undefined) return this.deps.end(name)
    const host = windowsJobHost(this.deps.assemblyPath, this.deps.systemRoot)
    const ended = spawnSync(host.file, [...endJobArgs(name)], {
      env: host.env,
      cwd: host.cwd,
      stdio: 'ignore',
      windowsHide: true,
      timeout: PLAYBOOK_JOB_CONNECT_MS,
    })
    return ended.status === 0
  }

  /**
  Lets a job go and waits to see it end. Its helper ends the job on a
  closed pipe, and the job is kill-on-close on the helper's handle, so a
  helper that is gone is a job that is over. A helper that stays is ended
  by name. Only a job seen to be over leaves the published names.
  */
  private retire(session: Session): void {
    try {
      closeSync(session.descriptor)
    } catch (error: unknown) {
      // Already closed by a failed call; the helper sees the same end of its pipe.
      if (!isClosed(error)) throw error
    }
    const deadline = Date.now() + PLAYBOOK_JOB_SWEEP_MS
    while (isRunning(session.pid) && Date.now() < deadline) pause(PLAYBOOK_JOB_CONNECT_POLL_MS)
    if (!isRunning(session.pid) || this.endByName(session.name)) this.unended.delete(session.name)
    this.publish()
  }

  private open(): Session {
    // A job that could not be confirmed over is tried again before another opens.
    for (const name of this.unended) if (this.endByName(name)) this.unended.delete(name)
    const id = randomUUID()
    const name = `${PLAYBOOK_JOB_NAME_PREFIX}${id}`
    const pipe = `${PLAYBOOK_JOB_PIPE_PREFIX}${id}`
    const host = windowsJobHost(this.deps.assemblyPath, this.deps.systemRoot)
    this.unended.add(name)
    this.publish()
    let helper: ReturnType<StartContainedHelper>
    try {
      helper = (this.deps.start ?? startHelper)(
        host.file,
        serveArgs(name, pipe),
        host.env,
        host.cwd,
      )
    } catch (error: unknown) {
      // The system refused to start the helper at all (a file that is not a
      // program): no process ever existed, so no job did, and its name goes.
      this.unended.delete(name)
      this.publish()
      throw error
    }
    helper.unref()
    const deadline = Date.now() + (this.deps.connectMs ?? PLAYBOOK_JOB_CONNECT_MS)
    for (;;) {
      try {
        return {
          name,
          descriptor: openSync(`${PLAYBOOK_JOB_PIPE_ROOT}\\${pipe}`, 'r+'),
          pid: helper.pid,
        }
      } catch (error: unknown) {
        // A pipe the helper has not made yet is tried again; anything else
        // cannot heal by waiting. A helper that could not load the type, join
        // a job or bind its lifetime has gone, and its job with it. One that
        // is still there and never answered is ended by name before its name
        // is let go.
        if (!isAbsent(error)) throw error
        if (Date.now() >= deadline || !isRunning(helper.pid)) {
          if (!isRunning(helper.pid) || this.endByName(name)) this.unended.delete(name)
          this.publish()
          throw error
        }
        pause(PLAYBOOK_JOB_CONNECT_POLL_MS)
      }
    }
  }

  private exact(session: Session, count: number): Buffer {
    const buffer = Buffer.alloc(count)
    let done = 0
    while (done < count) {
      const read = readSync(session.descriptor, buffer, done, count - done, null)
      if (read <= 0) throw new Error('EPIPE')
      done += read
    }
    return buffer
  }

  private call(
    session: Session,
    effect: PlaybookHookEffect,
    options: SpawnSyncOptions,
  ): SpawnSyncReturns<Buffer> {
    const body = Buffer.from(
      [
        encoded(effect.command),
        encoded(effect.args.map((argument) => windowsArgument(argument)).join(' ')),
        encoded(typeof options.cwd === 'string' ? options.cwd : effect.cwd),
        String(options.timeout ?? GIT_TIMEOUT_MS),
        String(options.maxBuffer ?? GIT_OUTPUT_MAX_BYTES),
        ...Object.entries(options.env ?? {})
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
          .map(([name, value]) => encoded(`${name}=${value}`)),
      ].join(SEPARATOR),
      'utf8',
    )
    const head = Buffer.alloc(PLAYBOOK_JOB_FRAME_HEADER_BYTES)
    head.writeInt32LE(body.length)
    writeSync(session.descriptor, Buffer.concat([head, body]))
    const line: number[] = []
    for (;;) {
      const byte = this.exact(session, 1).readUInt8(0)
      if (byte === NEWLINE) break
      line.push(byte)
    }
    const [status, flags, outLength, errLength] = Buffer.from(line)
      .toString('utf8')
      .split(' ')
      .map(Number)
    if (
      status === undefined ||
      flags === undefined ||
      outLength === undefined ||
      errLength === undefined ||
      [status, flags, outLength, errLength].some((value) => !Number.isSafeInteger(value))
    )
      throw new Error('EPROTO')
    // Both streams are read before the flags are judged: the frame is whole.
    return answered(session.pid, status, flags, {
      stdout: this.exact(session, outLength),
      stderr: this.exact(session, errLength),
    })
  }

  /** `PlaybookHookAdmission.runContained`: the call, then its whole tree ended. */
  run(effect: PlaybookHookEffect, options: SpawnSyncOptions): SpawnSyncReturns<Buffer> {
    try {
      this.session ??= this.open()
      this.closing ??= setImmediate(() => {
        this.close()
      })
      return this.call(this.session, effect, options)
    } catch (error: unknown) {
      // The pipe or the helper failed: nothing certifies this call's tree.
      // The call fails, and it does not return before the job was ended
      // (by the helper's own end, or by name) or its name kept for the
      // window to end.
      this.close()
      return failure(error instanceof Error ? error.message : 'EPIPE', error)
    }
  }

  /** Ends the decision's job, and returns once its end was seen or its name kept. */
  close(): void {
    if (this.closing !== undefined) clearImmediate(this.closing)
    this.closing = undefined
    const session = this.session
    this.session = undefined
    if (session !== undefined) this.retire(session)
  }
}
