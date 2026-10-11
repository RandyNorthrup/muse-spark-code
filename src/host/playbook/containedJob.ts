// Windows containment for the playbook's git and hook calls (M116, PLAN.md
// D96.15 and §9 FIXM116P3-Windows-job-binding). The policy is synchronous and
// asks for each call's whole tree to have ended before the call returns.
//
// One helper process serves one decision. It joins a fresh named job (the
// shipped MuseSparkJob type), so everything a call starts belongs to that job
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
  PLAYBOOK_JOB_ENVIRONMENT,
  PLAYBOOK_JOB_FLAGS,
  PLAYBOOK_JOB_FRAME_HEADER_BYTES,
  PLAYBOOK_JOB_IDLE_MS,
  PLAYBOOK_JOB_KILL_ON_CLOSE,
  PLAYBOOK_JOB_NAME_PREFIX,
  PLAYBOOK_JOB_PIPE_PREFIX,
  PLAYBOOK_JOB_PIPE_ROOT,
  PLAYBOOK_JOB_SWEEP_MS,
  POSIX_TREE_EXIT_POLL_MS,
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import type { PlaybookHookEffect } from '../../core/orchestration/playbook/outcomes'
import { powerShellQuoted } from '../../core/shellQuote'
import { loadJobAssembly, windowsPowerShell } from '../processTree'

const ENV = PLAYBOOK_JOB_ENVIRONMENT
const FLAGS = PLAYBOOK_JOB_FLAGS
const LIMIT = PLAYBOOK_JOB_KILL_ON_CLOSE
const MARSHAL = '[Runtime.InteropServices.Marshal]'
const NEWLINE = 10
const SEPARATOR = '\n'

/**
 * The helper's script. It names no cmdlet outside the engine's own (module
 * auto-loading can take a minute without an analysis cache, M51), and every
 * value it is given arrives in its environment or over the pipe, never in
 * its text.
 */
export function containedJobScript(): string {
  const job = SHELL_JOB_TYPE_NAME
  return [
    "$ErrorActionPreference = 'Stop'",
    `$j = $env:${ENV.job}`,
    'try {',
    `  [void][Reflection.Assembly]::LoadFrom($env:${ENV.assembly})`,
    `  [${job}]::Join($j)`,
    // Kill-on-close, on the one handle to the job, which this process holds: the
    // job cannot outlive it. Set through the loaded type's own Win32 binding;
    // a type without it fails here, before any pipe exists to serve a call on.
    '  $own = [Reflection.BindingFlags]::NonPublic -bor [Reflection.BindingFlags]::Static',
    `  $held = [${job}].GetField('held', $own).GetValue($null)`,
    `  $size = ${String(LIMIT.bytes32)}; if ([IntPtr]::Size -eq 8) { $size = ${String(LIMIT.bytes64)} }`,
    `  $info = ${MARSHAL}::AllocHGlobal($size)`,
    `  for ($i = 0; $i -lt $size; $i++) { ${MARSHAL}::WriteByte($info, $i, 0) }`,
    `  ${MARSHAL}::WriteInt32($info, ${String(LIMIT.flagOffset)}, ${String(LIMIT.flag)})`,
    `  $set = [${job}].GetMethod('SetInformationJobObject', $own, $null, [Type[]]@([IntPtr], [int], [IntPtr], [uint32]), $null)`,
    `  if (-not $set.Invoke($null, [object[]]@($held, ${String(LIMIT.informationClass)}, $info, [uint32]$size))) { throw 'limit' }`,
    `  ${MARSHAL}::FreeHGlobal($info)`,
    '  $self = [uint32][Diagnostics.Process]::GetCurrentProcess().Id',
    `  $idle = [int]$env:${ENV.idleMs}; $sweepMs = [int]$env:${ENV.sweepMs}`,
    `  $pipe = [IO.Pipes.NamedPipeServerStream]::new($env:${ENV.pipe}, [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous)`,
    ...Object.values(ENV).map((name) => `  $env:${name} = $null`),
    '  $wait = $pipe.BeginWaitForConnection($null, $null)',
    "  if (-not $wait.AsyncWaitHandle.WaitOne($idle)) { throw 'no caller' }",
    '  $pipe.EndWaitForConnection($wait)',
    '  $utf8 = [Text.UTF8Encoding]::new($false)',
    '  $exact = {',
    '    param([int]$count)',
    '    $buffer = [byte[]]::new($count); $done = 0',
    '    while ($done -lt $count) {',
    '      $task = $pipe.ReadAsync($buffer, $done, $count - $done)',
    "      if (-not $task.Wait($idle)) { throw 'idle' }",
    '      if ($task.Result -le 0) { return $null }',
    '      $done += $task.Result',
    '    }',
    '    return ,$buffer',
    '  }',
    '  $text = { param([string]$value) $utf8.GetString([Convert]::FromBase64String($value)) }',
    '  while ($true) {',
    `    $head = & $exact ${String(PLAYBOOK_JOB_FRAME_HEADER_BYTES)}`,
    '    if ($null -eq $head) { break }',
    '    $body = & $exact ([BitConverter]::ToInt32($head, 0))',
    '    if ($null -eq $body) { break }',
    `    $lines = $utf8.GetString($body).Split([char]${String(NEWLINE)})`,
    '    $psi = [Diagnostics.ProcessStartInfo]::new()',
    '    $psi.FileName = & $text $lines[0]',
    '    $psi.Arguments = & $text $lines[1]',
    '    $psi.WorkingDirectory = & $text $lines[2]',
    '    $limit = [int]$lines[3]; $max = [long]$lines[4]',
    '    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true',
    '    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.RedirectStandardInput = $true',
    '    $psi.Environment.Clear()',
    '    for ($i = 5; $i -lt $lines.Length; $i++) {',
    '      if ($lines[$i].Length -eq 0) { continue }',
    "      $pair = & $text $lines[$i]; $cut = $pair.IndexOf('=', 1)",
    '      $psi.Environment[$pair.Substring(0, $cut)] = $pair.Substring($cut + 1)',
    '    }',
    '    $flags = 0; $status = -1',
    '    $out = [IO.MemoryStream]::new(); $err = [IO.MemoryStream]::new()',
    '    $copies = @()',
    '    try {',
    '      $process = [Diagnostics.Process]::Start($psi)',
    '      $process.StandardInput.Close()',
    '      $copies = @($process.StandardOutput.BaseStream.CopyToAsync($out), $process.StandardError.BaseStream.CopyToAsync($err))',
    '      $clock = [Diagnostics.Stopwatch]::StartNew()',
    `      while (-not $process.WaitForExit(${String(POSIX_TREE_EXIT_POLL_MS)})) {`,
    `        if ($clock.ElapsedMilliseconds -ge $limit) { $flags = $flags -bor ${String(FLAGS.timedOut)}; break }`,
    `        if ($out.Length -gt $max -or $err.Length -gt $max) { $flags = $flags -bor ${String(FLAGS.overflowed)}; break }`,
    '      }',
    '      if ($flags -eq 0) { $process.WaitForExit(); $status = $process.ExitCode }',
    `    } catch { $flags = $flags -bor ${String(FLAGS.unstarted)} }`,
    '    $sweep = [Diagnostics.Stopwatch]::StartNew()',
    '    while ($true) {',
    '      $others = 0',
    String.raw`      foreach ($member in [regex]::Matches([${job}]::Query($j), '\{"pid":(\d+),"startTime":"(\d+)"\}')) {`,
    '        $id = [uint32]$member.Groups[1].Value',
    '        if ($id -eq $self) { continue }',
    '        $others++',
    `        [void][${job}]::Signal($j, $id, $member.Groups[2].Value, $true)`,
    '      }',
    '      if ($others -eq 0) { break }',
    `      if ($sweep.ElapsedMilliseconds -ge $sweepMs) { $flags = $flags -bor ${String(FLAGS.uncertain)}; break }`,
    `      [Threading.Thread]::Sleep(${String(PLAYBOOK_JOB_CONNECT_POLL_MS)})`,
    '    }',
    `    foreach ($copy in $copies) { if (-not $copy.Wait($sweepMs)) { $flags = $flags -bor ${String(FLAGS.uncertain)} } }`,
    `    if ($out.Length -gt $max -or $err.Length -gt $max) { $flags = $flags -bor ${String(FLAGS.overflowed)} }`,
    '    [byte[]]$outBytes = [byte[]]::new(0); [byte[]]$errBytes = [byte[]]::new(0)',
    `    if (($flags -band ${String(FLAGS.overflowed)}) -eq 0) { $outBytes = $out.ToArray(); $errBytes = $err.ToArray() }`,
    `    $header = $utf8.GetBytes("$status $flags $($outBytes.Length) $($errBytes.Length)" + [char]${String(NEWLINE)})`,
    '    $pipe.Write($header, 0, $header.Length)',
    '    $pipe.Write($outBytes, 0, $outBytes.Length)',
    '    $pipe.Write($errBytes, 0, $errBytes.Length)',
    '    $pipe.Flush()',
    `    if (($flags -band ${String(FLAGS.uncertain)}) -ne 0) { break }`,
    '  }',
    '} catch { }',
    `[void][${job}]::Terminate($j, 0)`,
  ].join(SEPARATOR)
}

/**
 * Ends a job by its name and exits 0 only once it has no member left (or no
 * longer exists). For a job whose helper cannot be asked any more.
 */
export function endJobScript(assemblyPath: string, name: string): string {
  const job = `[${SHELL_JOB_TYPE_NAME}]`
  const quoted = powerShellQuoted(name)
  return [
    "$ErrorActionPreference = 'Stop'",
    loadJobAssembly(assemblyPath),
    `try { [void]${job}::Terminate(${quoted}, 1) } catch { }`,
    '$clock = [Diagnostics.Stopwatch]::StartNew()',
    `while (${job}::Query(${quoted}) -match '"pid":') {`,
    `  if ($clock.ElapsedMilliseconds -ge ${String(PLAYBOOK_JOB_SWEEP_MS)}) { exit 1 }`,
    `  [Threading.Thread]::Sleep(${String(PLAYBOOK_JOB_CONNECT_POLL_MS)})`,
    '}',
    'exit 0',
  ].join(SEPARATOR)
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

/** The helper as this module starts it; a test stands in a process of its own. */
export type StartContainedHelper = (
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => { readonly pid?: number | undefined; unref(): void }

export interface ContainedJobDeps {
  /** The compiled MuseSparkJob assembly (`shellJob.ts`), prepared by the window. */
  readonly assemblyPath: string
  readonly systemRoot: string
  /**
   * Told the names of every job whose end has not been seen yet: a job's
   * name before its first call, and again without it only once it is known
   * to be over. The window ends by name whatever is still listed when its
   * worker stops.
   */
  readonly onJob: (names: readonly string[]) => void
  readonly start?: StartContainedHelper
  /**
   * Ends a job by name; true only when it was seen empty or gone. A test
   * stands in its own; by default a Windows PowerShell runs `endJobScript`.
   */
  readonly end?: (name: string) => boolean
  /** How long a live helper may take to serve its pipe; a test shortens it. */
  readonly connectMs?: number
  /** The base environment the helper itself runs in (credentials are scrubbed). */
  readonly env?: NodeJS.ProcessEnv
}

interface Session {
  readonly name: string
  readonly descriptor: number
  readonly pid: number | undefined
}

const startHelper: StartContainedHelper = (file, args, env) =>
  spawnProcess(file, [...args], { env, stdio: 'ignore', windowsHide: true })

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)), 0, 0, ms)
}

function isRunning(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function encoded(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

function failure(code: string): SpawnSyncReturns<Buffer> {
  const empty = Buffer.alloc(0)
  return {
    pid: 0,
    output: [null, empty, empty],
    stdout: empty,
    stderr: empty,
    status: null,
    signal: null,
    error: Object.assign(new Error(code), { code }),
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
 * The contained runner the policy's `PlaybookHookAdmission.runContained`
 * binds to on Windows. A decision's calls share one job; `close` ends it,
 * and is scheduled for the end of the synchronous stretch that used it.
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
    const powershell = windowsPowerShell(this.deps.systemRoot, this.deps.env)
    const ended = spawnSync(
      powershell.file,
      [...WINDOWS_POWERSHELL_COMMAND_ARGS, endJobScript(this.deps.assemblyPath, name)],
      { env: powershell.env, stdio: 'ignore', windowsHide: true, timeout: PLAYBOOK_JOB_CONNECT_MS },
    )
    return ended.status === 0
  }

  /**
   * Lets a job go and waits to see it end. Its helper ends the job on a
   * closed pipe, and the job is kill-on-close on the helper's handle, so a
   * helper that is gone is a job that is over. A helper that stays is ended
   * by name. Only a job seen to be over leaves the published names.
   */
  private retire(session: Session): void {
    try {
      closeSync(session.descriptor)
    } catch {
      // Already closed by a failed call; the helper sees the same end of its pipe.
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
    const powershell = windowsPowerShell(this.deps.systemRoot, this.deps.env)
    this.unended.add(name)
    this.publish()
    const helper = (this.deps.start ?? startHelper)(
      powershell.file,
      [...WINDOWS_POWERSHELL_COMMAND_ARGS, containedJobScript()],
      {
        ...powershell.env,
        [ENV.job]: name,
        [ENV.assembly]: this.deps.assemblyPath,
        [ENV.pipe]: pipe,
        [ENV.idleMs]: String(PLAYBOOK_JOB_IDLE_MS),
        [ENV.sweepMs]: String(PLAYBOOK_JOB_SWEEP_MS),
      },
    )
    helper.unref()
    const deadline = Date.now() + (this.deps.connectMs ?? PLAYBOOK_JOB_CONNECT_MS)
    for (;;) {
      try {
        return {
          name,
          descriptor: openSync(`${PLAYBOOK_JOB_PIPE_ROOT}\\${pipe}`, 'r+'),
          pid: helper.pid,
        }
      } catch (error) {
        // A helper that could not load the type, join a job or bind its
        // lifetime has gone, and its job with it. One that is still there
        // and never answered is ended by name before its name is let go.
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
        ...Object.entries(options.env ?? {}).flatMap(([name, value]) =>
          value === undefined ? [] : [encoded(`${name}=${value}`)],
        ),
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
    } catch (error) {
      // The pipe or the helper failed: nothing certifies this call's tree.
      // The call fails, and it does not return before the job was ended
      // (by the helper's own end, or by name) or its name kept for the
      // window to end.
      this.close()
      return failure(error instanceof Error ? error.message : 'EPIPE')
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
