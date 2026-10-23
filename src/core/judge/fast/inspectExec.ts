// Internal F1a API. F1b owns eligibility, reviewer racing and editor integration.
import { mkdir, mkdtemp, realpath, rm, writeFile, symlink, link } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileIdentityKey, statIdentity } from '../../fs/fileIdentity'
import { isErrno } from '../../fs/errno'
import * as z from 'zod/mini'
import type { ResourcePipedProcess, ResourceProcessOptions } from '../../resources/launch'
import { probeChildEnvironment } from '../../executables'
import {
  JUDGE_FAST_B1_DARWIN_ABI,
  JUDGE_FAST_B1_MAX_ABI,
  JUDGE_FAST_B1_MIN_ABI,
  JUDGE_FAST_B1_PROTOCOL_MAX_BYTES,
  JUDGE_FAST_B1_REFUSED_EXIT,
  SHELL_OUTPUT_MAX_CHARS,
} from '../../../shared/constants'
import { countSecretMatches } from '../../../shared/redact'
import { parseInspectCommand } from './inspectGrammar'

const abiSchema = z
  .number()
  .check(z.int(), z.minimum(JUDGE_FAST_B1_MIN_ABI), z.maximum(JUDGE_FAST_B1_MAX_ABI))
// The Seatbelt helper reports its own generation, below the Landlock range so
// a Linux helper can never pass a macOS check and vice versa.
const darwinAbiSchema = z.literal(JUDGE_FAST_B1_DARWIN_ABI)
const probeSchema = z.strictObject({ abi: abiSchema, confined: z.literal(true) })
const darwinProbeSchema = z.strictObject({ abi: darwinAbiSchema, confined: z.literal(true) })
const runSchema = z.strictObject({
  abi: abiSchema,
  confined: z.literal(true),
  excluded: z.number().check(z.int(), z.minimum(0)),
})
const darwinRunSchema = z.strictObject({
  abi: darwinAbiSchema,
  confined: z.literal(true),
  excluded: z.number().check(z.int(), z.minimum(0)),
})
const nativeRefusalSchema = z.strictObject({
  refused: z.enum([
    'file',
    'landlock',
    'walkBudget',
    'operand',
    'walk',
    'systemFile',
    'elf',
    'memory',
    'root',
    'landlockAbi',
    'limits',
    'seccomp',
    'selfTest',
    'postWalkRead',
    'processCreation',
    'network',
    'write',
    'program',
    'request',
    'workspace',
    'workspaceIdentity',
    'home',
    'privateOperand',
    'stdin',
    'descriptors',
    'protocol',
    'exec',
    'macosCaptureRequired',
  ]),
})
type Refusal =
  | 'platform'
  | 'root'
  | 'grammar'
  | 'selfTest'
  | 'confinement'
  | 'cancelled'
  | 'outputLimit'
  | 'secret'
  | z.infer<typeof nativeRefusalSchema>['refused']
export type InspectResult =
  | { readonly kind: 'refused'; readonly reason: Refusal }
  | {
      readonly kind: 'output'
      readonly stdout: string
      readonly stderr: string
      readonly exitCode: number
      readonly excluded: number
    }

export interface InspectExecOptions {
  readonly helper: string
  readonly storage: string
  /** F1b supplies the governed bootstrap launcher; there is no ambient spawn fallback. */
  readonly start: (
    file: string,
    args: readonly string[],
    options: ResourceProcessOptions,
  ) => Promise<ResourcePipedProcess>
}
/** Captured by the trusted host when the workspace/session binds, never from tool arguments. */
export interface InspectWorkspace {
  readonly root: string
  readonly identity: string
}
interface ProcessResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly refusal?: Refusal
}
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}
const refused = (reason: Refusal): InspectResult => ({ kind: 'refused', reason })

function json(line: string): unknown {
  if (Buffer.byteLength(line) > JUDGE_FAST_B1_PROTOCOL_MAX_BYTES) return undefined
  try {
    const value: unknown = JSON.parse(line)
    return value
  } catch (error: unknown) {
    // JSON.parse throws only SyntaxError for text input: a malformed
    // protocol line decodes to nothing, and anything else surfaces.
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
}

/** One instance per session. A failed self-test latches off until a new session. */
export class InspectRunner {
  private readonly lifetime = new AbortController()
  private readonly active = new Set<Promise<InspectResult>>()
  private readiness: Promise<boolean> | undefined
  private offReason: Refusal = 'selfTest'
  private verifiedAbi: number | undefined

  constructor(private readonly options: InspectExecOptions) {}

  private async stop(launched: ResourcePipedProcess): Promise<void> {
    try {
      await launched.stop()
    } catch {
      // A graceful stop that fails escalates to SIGKILL; the close handler
      // settles the outcome however stopping ends.
      try {
        launched.child.kill('SIGKILL')
      } catch {
        // Already exited: nothing to stop.
      }
    }
  }

  private async process(
    args: readonly string[],
    cwd: string,
    signal: AbortSignal,
  ): Promise<ProcessResult> {
    // D121: no default deadline of ours — the helper runs until it ends,
    // the caller stops it, or the runner's lifetime ends.
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    let process: ResourcePipedProcess | undefined
    try {
      if (isAborted(combined))
        return { stdout: '', stderr: '', exitCode: null, refusal: 'cancelled' }
      // The trusted inspect helper with a fixed PATH: absolute entries
      // only, links followed.
      process = await this.options.start(this.options.helper, args, {
        cwd,
        env: probeChildEnvironment({ PATH: '/usr/bin:/bin', LC_ALL: 'C', TZ: 'UTC0' }),
        signal: combined,
      })
      const launched = process
      return await new Promise<ProcessResult>((resolve) => {
        const stdout: Buffer[] = [],
          stderr: Buffer[] = []
        let bytes = 0
        let refusal: Refusal | undefined
        let isStopping = false
        const stop = (reason: Refusal) => {
          refusal ??= reason
          if (isStopping) return
          isStopping = true
          // stop's rejection does not make an unobserved process exit safe to deliver.
          void this.stop(launched)
        }
        const aborted = () => {
          stop('cancelled')
        }
        combined.addEventListener('abort', aborted, { once: true })
        const receive = (target: Buffer[], chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > SHELL_OUTPUT_MAX_CHARS) {
            stop('outputLimit')
            return
          }
          target.push(chunk)
        }
        launched.child.stdout.on('data', (chunk: Buffer) => {
          receive(stdout, chunk)
        })
        launched.child.stderr.on('data', (chunk: Buffer) => {
          receive(stderr, chunk)
        })
        launched.child.once('error', () => {
          refusal ??= isAborted(combined) ? 'cancelled' : 'confinement'
        })
        launched.child.once('close', (exitCode) => {
          combined.removeEventListener('abort', aborted)
          resolve({
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            exitCode,
            ...(refusal !== undefined && { refusal }),
          })
        })
        launched.child.stdin.end()
        if (isAborted(combined)) aborted()
      })
    } catch {
      if (process !== undefined) await this.stop(process)
      const refusal: Refusal = isAborted(combined) ? 'cancelled' : 'confinement'
      return {
        stdout: '',
        stderr: '',
        exitCode: null,
        refusal,
      }
    }
  }

  private async execute(
    command: string,
    workspace: InspectWorkspace,
    home: string,
    signal: AbortSignal,
  ): Promise<InspectResult> {
    const parsed = parseInspectCommand(command)
    if (parsed === undefined) return refused('grammar')
    const resolved = await realpath(workspace.root)
    const sample = await statIdentity(resolved)
    const identity = fileIdentityKey(sample)
    if (identity === undefined || identity !== workspace.identity || !sample.isDirectory())
      return refused('workspaceIdentity')
    const result = await this.process(
      [
        'run',
        resolved,
        identity,
        home,
        parsed.recursive ? 'recursive' : 'single',
        parsed.program,
        ...parsed.operands,
        '--',
        ...parsed.args,
      ],
      resolved,
      signal,
    )
    if (result.refusal !== undefined) return refused(result.refusal)
    if (result.exitCode === null) {
      // The started program was killed by a signal, so its stderr is its own:
      // it can print anything, including a JSON-looking line, and nothing on
      // stderr is read as the helper's verdict. The runner knows the program
      // and the signal. `du` dies here asking for a thread, which the
      // boundary denies, so it reports the existing process-creation refusal
      // ("du on this machine needs to start a thread, which the boundary
      // does not allow") instead of the generic one; anything else stays it.
      return refused(parsed.program === 'du' ? 'processCreation' : 'confinement')
    }
    const newline = result.stderr.indexOf('\n')
    if (newline === -1 || result.exitCode === JUDGE_FAST_B1_REFUSED_EXIT) {
      // The helper emits exactly one refusal line (a verification failure
      // before confinement), or the confined line followed by one refusal
      // line (a failed exec, or a report failure). Anything else — a lone
      // confined line, extra lines, a started program's own stderr — is the
      // runner's own generic refusal, never a verdict read from the program.
      const lines = result.stderr.split('\n').filter((line) => line.trim().length > 0)
      if (lines.length === 1) {
        const native = nativeRefusalSchema.safeParse(json(lines.at(0) ?? ''))
        return refused(native.success ? native.data.refused : 'confinement')
      }
      if (lines.length === 2 && runSchema.safeParse(json(lines.at(0) ?? '')).success) {
        const native = nativeRefusalSchema.safeParse(json(lines.at(1) ?? ''))
        return refused(native.success ? native.data.refused : 'confinement')
      }
      return refused('confinement')
    }
    const runSchemaForHost = process.platform === 'darwin' ? darwinRunSchema : runSchema
    const metadata = runSchemaForHost.safeParse(json(result.stderr.slice(0, newline)))
    if (!metadata.success) return refused('confinement')
    const stderr = result.stderr.slice(newline + 1)
    if (countSecretMatches(result.stdout, []) > 0 || countSecretMatches(stderr, []) > 0)
      return refused('secret')
    return {
      kind: 'output',
      stdout: result.stdout,
      stderr,
      exitCode: result.exitCode,
      excluded: metadata.data.excluded,
    }
  }

  private async selfTest(): Promise<boolean> {
    let root: string | undefined
    try {
      await mkdir(this.options.storage, { recursive: true, mode: 0o700 })
      root = await mkdtemp(path.join(this.options.storage, 'b1-test-'))
      const workspace = path.join(root, 'workspace')
      await mkdir(workspace, { mode: 0o700 })
      const identity = fileIdentityKey(await statIdentity(workspace))
      if (identity === undefined) return false
      const binding = { root: workspace, identity }
      const probe = await this.process(['probe'], root, this.lifetime.signal)
      const probeSchemaForHost = process.platform === 'darwin' ? darwinProbeSchema : probeSchema
      const verified = probeSchemaForHost.safeParse(json(probe.stdout.trim()))
      if (probe.refusal !== undefined || probe.exitCode !== 0 || !verified.success) {
        const native = nativeRefusalSchema.safeParse(json(probe.stderr.trim()))
        if (native.success) this.offReason = native.data.refused
        return false
      }
      this.verifiedAbi = verified.data.abi
      const allowed = 'B1_ALLOWED_CANARY',
        forbidden = 'B1_FORBIDDEN_CANARY'
      await writeFile(path.join(workspace, 'allowed.txt'), allowed)
      const outside = path.join(root, 'outside.txt')
      await writeFile(outside, forbidden)
      await symlink(outside, path.join(workspace, 'symlink'))
      await link(outside, path.join(workspace, 'hardlink'))
      await mkdir(path.join(workspace, '.git'))
      await writeFile(path.join(workspace, '.git', 'config'), forbidden)
      await writeFile(path.join(workspace, '.env'), forbidden)
      // The macOS helper consumes its home dir on every run (it writes
      // profile.sb there with O_EXCL and demands it empty), while the Linux
      // helper never writes there — so a shared self-test home always fails
      // the second check on a Mac. Each probe gets a fresh home, the same
      // fresh-home-per-run contract every session run already follows.
      const catHome = await mkdtemp(path.join(root, 'b1-self-home-'))
      const cat = await this.execute('cat allowed.txt', binding, catHome, this.lifetime.signal)
      if (cat.kind !== 'output' || cat.stdout !== allowed || cat.exitCode !== 0) {
        // The latched refusal names the failing probe's own reason. Probes
        // run in probe, cat, grep order and the first failure sticks, so the
        // reason plus that order identifies which probe failed and why.
        if (cat.kind === 'refused') this.offReason = cat.reason
        return false
      }
      const grepHome = await mkdtemp(path.join(root, 'b1-self-home-'))
      const grep = await this.execute(
        "grep -r -e 'B1_.*_CANARY' .",
        binding,
        grepHome,
        this.lifetime.signal,
      )
      if (
        grep.kind !== 'output' ||
        !grep.stdout.includes(allowed) ||
        grep.stdout.includes(forbidden) ||
        grep.excluded < 2
      ) {
        if (grep.kind === 'refused') this.offReason = grep.reason
        return false
      }
      return true
    } catch (error: unknown) {
      // A setup step the platform refuses (a link this account may not
      // create, a full disk) fails the self-test and B1 stays off, under
      // the self-test refusal; anything else is a fault and stays loud.
      if (!isErrno(error)) throw error
      return false
    } finally {
      if (root !== undefined) await rm(root, { recursive: true, force: true })
    }
  }

  private async inspect(
    command: string,
    workspace: InspectWorkspace,
    signal?: AbortSignal,
  ): Promise<InspectResult> {
    // Linux confines with Landlock/seccomp, macOS with a Seatbelt profile via
    // sandbox-exec. Windows has neither facility wired and stays refused.
    if (process.platform !== 'linux' && process.platform !== 'darwin') return refused('platform')
    if (process.getuid?.() === 0 || process.geteuid?.() === 0) return refused('root')
    if (parseInspectCommand(command) === undefined) return refused('grammar')
    const combined = AbortSignal.any([
      this.lifetime.signal,
      ...(signal === undefined ? [] : [signal]),
    ])
    if (isAborted(combined)) return refused('cancelled')
    const readiness = (this.readiness ??= this.selfTest())
    const isReady = await new Promise<boolean>((resolve, reject) => {
      const aborted = () => {
        combined.removeEventListener('abort', aborted)
        resolve(false)
      }
      combined.addEventListener('abort', aborted, { once: true })
      void (async () => {
        try {
          resolve(await readiness)
        } catch (error: unknown) {
          reject(error instanceof Error ? error : new Error('confinement', { cause: error }))
        } finally {
          combined.removeEventListener('abort', aborted)
        }
      })()
      if (isAborted(combined)) aborted()
    })
    if (!isReady) return refused(isAborted(combined) ? 'cancelled' : this.offReason)
    let home: string | undefined
    try {
      if (isAborted(combined)) return refused('cancelled')
      home = await mkdtemp(path.join(this.options.storage, 'b1-home-'))
      return await this.execute(command, workspace, home, combined)
    } catch {
      return refused('confinement')
    } finally {
      if (home !== undefined) await rm(home, { recursive: true, force: true })
    }
  }
  /**
  The confinement version the session's probe reported (F1b's audit):
  the Landlock ABI on Linux, 1 on macOS. Unknown until a probe passes;
  a failed probe leaves the last verified value alone.
  */
  public get probedAbi(): number | undefined {
    return this.verifiedAbi
  }

  run(command: string, workspace: InspectWorkspace, signal?: AbortSignal): Promise<InspectResult> {
    const task = (async () => {
      try {
        const binding = { root: workspace.root, identity: workspace.identity }
        return await this.inspect(command, binding, signal)
      } catch {
        return refused('confinement')
      }
    })()
    this.active.add(task)
    void task.finally(() => this.active.delete(task))
    return task
  }

  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled([
      ...this.active,
      ...(this.readiness === undefined ? [] : [this.readiness]),
    ])
  }
}

/** D107 §9.3: a session's B1 runner, its proven workspace, and its scratch. */
export interface InspectSessionBinding {
  readonly runner: InspectRunner
  readonly workspace: InspectWorkspace
  readonly confinement: 'landlock' | 'seatbelt'
  readonly storage: string
}

/**
D107 §9.3: open the session's B1 runner. Undefined keeps today's
reviewer: no helper, no confinement, no race. One binding per
session; the runner latches a failed self-test until a new session.
*/
export async function openInspectSession(
  helper: string | undefined,
  workspaceRoot: string,
  start: InspectExecOptions['start'],
): Promise<InspectSessionBinding | undefined> {
  if (helper === undefined) return undefined
  if (process.platform !== 'linux' && process.platform !== 'darwin') return undefined
  if (process.getuid?.() === 0 || process.geteuid?.() === 0) return undefined
  if (!existsSync(helper)) return undefined
  let storage: string
  try {
    storage = await mkdtemp(path.join(tmpdir(), 'b1-'))
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    return undefined
  }
  let identity: string | undefined
  try {
    identity = fileIdentityKey(await statIdentity(workspaceRoot))
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    identity = undefined
  }
  if (identity === undefined) {
    try {
      await rm(storage, { recursive: true, force: true })
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
    }
    return undefined
  }
  return {
    runner: new InspectRunner({ helper, storage, start }),
    workspace: { root: workspaceRoot, identity },
    confinement: process.platform === 'darwin' ? 'seatbelt' : 'landlock',
    storage,
  }
}

/** D107 §9.6: the audit's executable resolution over the real filesystem. */
export function b1Realpath(filePath: string): string {
  return realpathSync(filePath)
}

/** D107 §9.3: the session's B1 runner and its scratch go with it. */
export async function closeInspectSession(
  binding: InspectSessionBinding | undefined,
): Promise<void> {
  if (binding === undefined) return
  await binding.runner.dispose()
  await rm(binding.storage, { recursive: true, force: true })
}
