import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import * as z from 'zod/mini'
import { runnerSchema, type Runner } from '../../shared/team'
import {
  RUNNER_CONNECT_TIMEOUT_MS,
  RUNNER_SELFTEST_TIMEOUT_MS,
  RUNNER_WINDOWS_COMMAND_MAX_CHARS,
  MILLISECONDS_PER_SECOND,
  GIT_TIMEOUT_MS,
  GIT_METADATA_OPTIONS,
  UI_TEXT,
  TEAM_SCHED_ID_MAX_CHARS,
  GIT_OUTPUT_MAX_BYTES,
  TEAM_SCHED_TICK_MS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { runnerHealthSchema, type RunnerHealth, RunnerHealthStore } from '../../core/runners/health'
import { runnerEnvironment } from '../../core/runners/runnerConfig'
import type { CheckJob, RunnerDispatch } from '../../core/runners/routing'
import { posixQuoted, powerShellQuoted } from '../../core/shellQuote'
import { captureCheckSnapshot, type CheckGit } from '../team/checkSlots'

const runIdSchema = z
  .string()
  .check(z.maxLength(TEAM_SCHED_ID_MAX_CHARS), z.regex(/^[a-z0-9][a-z0-9-]*$/u))
const runStateSchema = z.union([
  z.strictObject({
    runId: runIdSchema,
    state: z.literal('refused'),
    reason: z.literal('commandTooLong'),
  }),
  z.strictObject({ runId: runIdSchema, state: z.enum(['running', 'busy', 'missing']) }),
  z.strictObject({
    runId: runIdSchema,
    state: z.literal('ended'),
    exitCode: z.int(),
    reason: z.optional(z.literal('cacheBusy')),
  }),
])
export interface SshRunnerDeps extends CheckGit {
  readonly ssh: string
  readonly helperFolder: string
  readonly scratch: string
  readonly isTrusted: () => boolean
  readonly assertWorkingCopy: (cwd: string) => Promise<void>
  readonly now: () => number
  readonly wait: (ms: number) => Promise<void>
}

class WindowsCommandTooLongError extends Error {
  public constructor() {
    super(UI_TEXT.teamRunners.commandTooLong)
  }
}

/** The same fixed policy is used by health, upload, run, end checks and Git's SSH. */
export function runnerSshArgs(runner: Runner): string[] {
  return [
    '-n',
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ForwardAgent=no',
    '-o',
    `ConnectTimeout=${String(RUNNER_CONNECT_TIMEOUT_MS / MILLISECONDS_PER_SECOND)}`,
    ...(runner.port === undefined ? [] : ['-p', String(runner.port)]),
    runner.destination,
  ]
}
function remoteCommand(runner: Runner, script: string): string {
  const command =
    runner.os === 'win32'
      ? `powershell.exe -NoProfile -NonInteractive -InputFormat None -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')} < NUL`
      : script
  if (runner.os === 'win32' && command.length >= RUNNER_WINDOWS_COMMAND_MAX_CHARS)
    throw new WindowsCommandTooLongError()
  return command
}

export class SshRunner {
  private readonly health: RunnerHealthStore
  private readonly active = new Set<string>()
  public constructor(private readonly deps: SshRunnerDeps) {
    this.health = new RunnerHealthStore(deps.now)
  }
  private admit(signal?: AbortSignal): void {
    signal?.throwIfAborted()
    if (!this.deps.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
  }
  private async ssh(runner: Runner, script: string, signal?: AbortSignal): Promise<string> {
    this.admit(signal)
    const args = [...runnerSshArgs(runner), remoteCommand(runner, script)]
    if (process.platform === 'win32') {
      // Bound the local SSH launch too, including quoted argv[0] and escaping.
      const line = [this.deps.ssh, ...args]
        .map(
          (value) =>
            `"${value.replaceAll(/(\\*)"/gu, String.raw`$1$1\"`).replace(/(\\+)$/u, '$1$1')}"`,
        )
        .join(' ')
      if (line.length >= RUNNER_WINDOWS_COMMAND_MAX_CHARS) throw new WindowsCommandTooLongError()
    }
    const result = await this.deps.run({
      file: this.deps.ssh,
      args,
      cwd: this.deps.scratch,
      env: runnerEnvironment(this.deps.env, undefined, true),
      timeoutMs: RUNNER_SELFTEST_TIMEOUT_MS,
      ...(signal !== undefined && { signal }),
    })
    this.admit(signal)
    if (!result.descendantsEnded || result.exitCode !== 0)
      throw new Error(UI_TEXT.teamRunners.offline)
    return result.output
  }
  private async install(runner: Runner, signal?: AbortSignal): Promise<string> {
    this.admit(signal)
    await mkdir(this.deps.scratch, { recursive: true })
    const suffix = runner.os === 'win32' ? 'ps1' : 'sh'
    const bytes = await readFile(path.join(this.deps.helperFolder, `runner-helper.${suffix}`))
    const version = createHash('sha256').update(bytes).digest('hex')
    const separator = runner.os === 'win32' ? path.win32 : path.posix
    const target = separator.join(runner.workFolder, `helper-${version}.${suffix}`)
    const temporary = `${target}.${randomUUID()}.new`
    const script =
      runner.os === 'win32'
        ? `$ErrorActionPreference='Stop';$root=${powerShellQuoted(runner.workFolder)};[IO.Directory]::CreateDirectory($root)|Out-Null;$temporary=Join-Path $root '${separator.basename(temporary)}';$source=[IO.MemoryStream]::new([Convert]::FromBase64String('${gzipSync(bytes).toString('base64')}'));$zip=[IO.Compression.GZipStream]::new($source,[IO.Compression.CompressionMode]::Decompress);$file=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew);try{$zip.CopyTo($file)}finally{$file.Dispose();$zip.Dispose();$source.Dispose()};Move-Item -Force -LiteralPath $temporary -Destination (Join-Path $root '${separator.basename(target)}')`
        : `mkdir -p ${posixQuoted(runner.workFolder)} && printf '%s' ${posixQuoted(bytes.toString('utf8'))} > ${posixQuoted(temporary)} && mv -f ${posixQuoted(temporary)} ${posixQuoted(target)}`
    await this.ssh(runner, script, signal)
    return target
  }
  private invocation(
    runner: Runner,
    helper: string,
    action: string,
    args: readonly string[],
  ): string {
    const quote = runner.os === 'win32' ? powerShellQuoted : posixQuoted
    return `${runner.os === 'win32' ? '&' : 'bash'} ${quote(helper)} ${[action, runner.workFolder, ...args].map((value) => quote(value)).join(' ')}`
  }
  public async test(
    runnerValue: Runner,
  ): Promise<{ readonly ok: boolean; readonly notice?: string; readonly fingerprint?: string }> {
    const runner = runnerSchema.parse(runnerValue)
    this.admit()
    await mkdir(this.deps.scratch, { recursive: true })
    let fingerprint: string | undefined
    try {
      // Inspect only the public fingerprint, never retain or log OpenSSH's verbose text.
      const options = runnerSshArgs(runner)
      const answer = await this.deps.run({
        file: this.deps.ssh,
        args: [
          ...options.slice(0, -1),
          '-v',
          runner.destination,
          remoteCommand(runner, runner.os === 'win32' ? 'exit 0' : 'true'),
        ],
        cwd: this.deps.scratch,
        env: runnerEnvironment(this.deps.env, undefined, true),
        timeoutMs: RUNNER_SELFTEST_TIMEOUT_MS,
      })
      this.admit()
      fingerprint = /\bSHA256:[A-Za-z0-9+/]+={0,2}/u.exec(answer.stderr ?? '')?.[0]
      if (!answer.descendantsEnded || answer.exitCode !== 0)
        return {
          ok: false,
          notice:
            fingerprint === undefined
              ? UI_TEXT.teamRunners.testFailed
              : fill(UI_TEXT.teamRunners.hostKeyNotice, { fingerprint }),
          ...(fingerprint !== undefined && { fingerprint }),
        }
    } catch {
      this.admit()
      return {
        ok: false,
        notice:
          runner.os === 'win32'
            ? UI_TEXT.teamRunners.inputHangNotice
            : UI_TEXT.teamRunners.testFailed,
      }
    }
    if (runner.os === 'win32') {
      try {
        const helper = await this.install(runner)
        const answer: unknown = JSON.parse(
          await this.ssh(
            runner,
            this.invocation(runner, helper, 'selftest', [String(RUNNER_SELFTEST_TIMEOUT_MS)]),
          ),
        )
        z.strictObject({ inputReady: z.literal(true) }).parse(answer)
      } catch {
        this.admit()
        return { ok: false, notice: UI_TEXT.teamRunners.inputHangNotice }
      }
    }
    const health = await this.sample(runner)
    return health === undefined
      ? {
          ok: false,
          notice:
            runner.os === 'win32'
              ? UI_TEXT.teamRunners.inputHangNotice
              : UI_TEXT.teamRunners.testFailed,
          ...(fingerprint !== undefined && { fingerprint }),
        }
      : { ok: true, ...(fingerprint !== undefined && { fingerprint }) }
  }
  public async sample(runnerValue: Runner): Promise<RunnerHealth | undefined> {
    const runner = runnerSchema.parse(runnerValue)
    this.admit()
    try {
      const helper = await this.install(runner)
      const text = await this.ssh(
        runner,
        this.invocation(runner, helper, 'health', [String(runner.maxJobs)]),
      )
      const value: unknown = JSON.parse(text)
      return this.health.record(runner.id, runnerHealthSchema.parse(value))
    } catch {
      this.admit()
      return this.health.record(runner.id, undefined)
    }
  }
  /** Checking a marker never infers remote exit from the local connection's exit. */
  public async end(
    runnerValue: Runner,
    helper: string,
    runId: string,
  ): Promise<z.infer<typeof runStateSchema>> {
    const runner = runnerSchema.parse(runnerValue)
    runIdSchema.parse(runId)
    const value: unknown = JSON.parse(
      await this.ssh(runner, this.invocation(runner, helper, 'status', [runId])),
    )
    const result = runStateSchema.parse(value)
    if (result.runId !== runId) throw new Error(UI_TEXT.teamRunners.testFailed)
    return result
  }
  public async run(runnerValue: Runner, job: CheckJob): Promise<RunnerDispatch> {
    const runner = runnerSchema.parse(runnerValue)
    runIdSchema.parse(job.runId)
    this.admit(job.signal)
    await this.deps.assertWorkingCopy(job.cwd)
    this.admit(job.signal)
    if (this.active.has(job.runId)) throw new Error(UI_TEXT.teamRunners.busy)
    this.active.add(job.runId)
    let isDispatched = false
    let pushCopy: string | undefined
    let hasPushProof = false
    try {
      const helper = await this.install(runner, job.signal)
      await this.ssh(runner, this.invocation(runner, helper, 'init', []), job.signal)
      const snapshot = await captureCheckSnapshot(job.cwd, this.deps.scratch, this.deps, () => {
        this.admit(job.signal)
      })
      // A source repository's url.*.insteadOf must never redirect a runner push.
      pushCopy = await mkdtemp(path.join(this.deps.scratch, 'push-'))
      const gitEnvironment = {
        ...runnerEnvironment(this.deps.env),
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_TERMINAL_PROMPT: '0',
      }
      this.admit(job.signal)
      const cloned = await this.deps.run({
        file: this.deps.file,
        args: [
          ...GIT_METADATA_OPTIONS,
          '-c',
          'core.hooksPath=/dev/null',
          'clone',
          '--bare',
          '--shared',
          '--',
          job.cwd,
          pushCopy,
        ],
        cwd: this.deps.scratch,
        env: gitEnvironment,
        timeoutMs: GIT_TIMEOUT_MS,
        signal: job.signal,
      })
      hasPushProof = cloned.descendantsEnded
      if (!hasPushProof || cloned.exitCode !== 0) throw new Error(UI_TEXT.teamRunners.testFailed)
      const sshCommand = [this.deps.ssh, ...runnerSshArgs(runner).slice(1, -1)]
        .map((value) => posixQuoted(value))
        .join(' ')
      this.admit(job.signal)
      const remote = `${runner.destination}:${runner.workFolder.replaceAll('\\', '/')}/repository.git`
      hasPushProof = false
      const pushed = await this.deps.run({
        file: this.deps.file,
        args: [
          ...GIT_METADATA_OPTIONS,
          '-c',
          'core.hooksPath=/dev/null',
          'push',
          '--',
          remote,
          `${snapshot}:refs/muse-spark/runs/${job.runId}`,
        ],
        cwd: pushCopy,
        env: {
          ...gitEnvironment,
          ...runnerEnvironment(this.deps.env, undefined, true),
          GIT_SSH_COMMAND: sshCommand,
          GIT_TERMINAL_PROMPT: '0',
        },
        timeoutMs: GIT_TIMEOUT_MS,
        signal: job.signal,
      })
      hasPushProof = pushed.descendantsEnded
      if (!hasPushProof || pushed.exitCode !== 0) return { kind: 'offline' }
      const key = createHash('sha256')
        .update(runner.cacheKey)
        .update('\0')
        .update(runner.setupCommand)
      for (const file of job.lockfiles) {
        if (path.isAbsolute(file) || file.split(/[\\/]/u).includes('..'))
          throw new Error(UI_TEXT.teamRunners.testFailed)
        this.admit(job.signal)
        const blob = await this.deps.run({
          file: this.deps.file,
          args: [...GIT_METADATA_OPTIONS, 'rev-parse', '--verify', `${snapshot}:${file}`],
          cwd: job.cwd,
          env: runnerEnvironment(this.deps.env),
          timeoutMs: GIT_TIMEOUT_MS,
          signal: job.signal,
        })
        if (!blob.descendantsEnded || blob.exitCode !== 0)
          throw new Error(UI_TEXT.teamRunners.testFailed)
        key.update('\0').update(file).update(blob.output)
      }
      const environment = runnerEnvironment(this.deps.env, runner.environmentNames)
      const prefix = Object.entries(environment)
        .map(([name, value]) =>
          runner.os === 'win32'
            ? `$env:${name}=${powerShellQuoted(value ?? '')}`
            : `export ${name}=${posixQuoted(value ?? '')}`,
        )
        .join(runner.os === 'win32' ? ';' : '\n')
      const encode = (command: string) => Buffer.from(`${prefix}\n${command}`).toString('base64')
      const start = this.invocation(runner, helper, 'start', [
        job.runId,
        String(runner.maxJobs),
        snapshot,
        key.digest('hex'),
        encode(runner.setupCommand),
        encode(job.command),
        String(Math.ceil(job.timeoutMs / MILLISECONDS_PER_SECOND)),
      ])
      // Check before dispatch uncertainty: every Windows transport command is bounded.
      remoteCommand(runner, start)
      isDispatched = true
      const started: unknown = JSON.parse(await this.ssh(runner, start, job.signal))
      const initial = runStateSchema.parse(started)
      if (initial.runId !== job.runId) throw new Error(UI_TEXT.teamRunners.testFailed)
      if (initial.state === 'busy') return { kind: 'busy' }
      if (initial.state === 'refused') throw new WindowsCommandTooLongError()
      const deadline = this.deps.now() + job.timeoutMs + RUNNER_CONNECT_TIMEOUT_MS
      let output = ''
      let bytes = Buffer.alloc(0)
      const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
      do {
        this.admit(job.signal)
        const state = await this.end(runner, helper, job.runId)
        const text = await this.ssh(
          runner,
          this.invocation(runner, helper, 'output', [job.runId]),
          job.signal,
        )
        const value: unknown = JSON.parse(text)
        const encoded = z.strictObject({ bytes: z.string() }).parse(value).bytes
        if (Buffer.byteLength(encoded, 'base64') > GIT_OUTPUT_MAX_BYTES)
          throw new Error(UI_TEXT.teamRunners.testFailed)
        const next = Buffer.from(encoded, 'base64')
        if (next.toString('base64') !== encoded || next.length > GIT_OUTPUT_MAX_BYTES)
          throw new Error(UI_TEXT.teamRunners.testFailed)
        if (next.length < bytes.length || !next.subarray(0, bytes.length).equals(bytes))
          throw new Error(UI_TEXT.teamRunners.testFailed)
        const appended = decoder.decode(next.subarray(bytes.length), {
          stream: state.state !== 'ended',
        })
        if (appended !== '') job.onOutput(appended)
        output += appended
        bytes = next
        if (state.state === 'ended' && state.reason === 'cacheBusy') return { kind: 'busy' }
        if (state.state === 'ended')
          return {
            kind: 'finished',
            result: { runId: job.runId, exitCode: state.exitCode, output, location: runner.id },
          }
        if (state.state === 'missing') return { kind: 'uncertain' }
        await this.deps.wait(TEAM_SCHED_TICK_MS)
      } while (this.deps.now() < deadline)
      return { kind: 'uncertain' }
    } catch (error: unknown) {
      this.admit(job.signal)
      if (error instanceof WindowsCommandTooLongError) throw error
      return { kind: isDispatched ? 'uncertain' : 'offline' }
    } finally {
      this.active.delete(job.runId)
      if (pushCopy !== undefined && hasPushProof)
        await rm(pushCopy, { recursive: true, force: true })
    }
  }
}
