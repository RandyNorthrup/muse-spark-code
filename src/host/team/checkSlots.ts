import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CheckJob, CheckResult } from '../../core/runners/routing'
import { runnerEnvironment } from '../../core/runners/runnerConfig'
import { isSamePath } from '../../core/paths'
import { GIT_METADATA_OPTIONS, GIT_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { gitFilterOptions } from '../git'

/** Inject the window's journalled process-lifetime launcher (M96 lane K). */
export type CheckProcess = (request: {
  readonly file: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly input?: string
  readonly signal?: AbortSignal
  readonly onOutput?: (text: string) => void
}) => Promise<{
  readonly exitCode: number
  readonly output: string
  /** True only with the window launcher's container proof, never a PID, group exit or user decision. */
  readonly descendantsEnded: boolean
  /** Collected separately; never log as received. */
  readonly stderr?: string
}>
export interface CheckGit {
  readonly file: string
  readonly run: CheckProcess
  readonly env: NodeJS.ProcessEnv
}

/** Whole working tree through a private index; the caller's index is never opened for writing. */
export async function captureCheckSnapshot(
  cwd: string,
  scratch: string,
  git: CheckGit,
  admit: () => void,
): Promise<string> {
  admit()
  await mkdir(scratch, { recursive: true })
  const folder = await mkdtemp(path.join(scratch, 'snapshot-'))
  const env = {
    ...runnerEnvironment(git.env),
    GIT_INDEX_FILE: path.join(folder, 'index'),
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_AUTHOR_NAME: 'Muse Spark Code',
    GIT_AUTHOR_EMAIL: 'snapshot@localhost',
    GIT_COMMITTER_NAME: 'Muse Spark Code',
    GIT_COMMITTER_EMAIL: 'snapshot@localhost',
  }
  const options = [...GIT_METADATA_OPTIONS, '-c', 'core.hooksPath=/dev/null']
  const run = async (args: readonly string[], input?: string) => {
    admit()
    const result = await git.run({
      file: git.file,
      args: [...options, ...args],
      cwd,
      env,
      timeoutMs: GIT_TIMEOUT_MS,
      ...(input !== undefined && { input }),
    })
    if (!result.descendantsEnded) throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
    if (result.exitCode !== 0) throw new Error(UI_TEXT.teamRunners.testFailed)
    return result.output.trim()
  }
  try {
    const names = await run(['config', '--null', '--name-only', '--list'])
    const filterNames = names
      .split('\0')
      .filter((name) => /^filter\..+\.(?:clean|process|required)$/u.test(name))
    options.push(...gitFilterOptions(filterNames.join('\0')))
    const head = await run(['rev-parse', '--verify', 'HEAD^{commit}'])
    await run(['read-tree', head])
    await run(['add', '--all', '--', '.'])
    const tree = await run(['write-tree'])
    return await run([
      '-c',
      'commit.gpgSign=false',
      'commit-tree',
      tree,
      '-p',
      head,
      '-m',
      'check snapshot',
    ])
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

export interface CheckSlotDeps extends CheckGit {
  readonly root: string
  readonly repositoryRoot: string
  readonly platform: NodeJS.Platform
  readonly count: number
  readonly setupCommand: string
  readonly cacheKey: string
  readonly installPaths: readonly string[]
  readonly shell: string
  readonly shellArgs: (command: string) => readonly string[]
  readonly isTrusted: () => boolean
  readonly isHostBusy: () => boolean
}
interface Slot {
  readonly id: number
  busy: boolean
  uncertain: boolean
}

export class CheckSlots {
  private readonly slots: Slot[]
  public constructor(private readonly deps: CheckSlotDeps) {
    if (!Number.isSafeInteger(deps.count) || deps.count < 1)
      throw new Error(UI_TEXT.teamRunners.testFailed)
    for (const name of deps.installPaths) {
      if (
        name === '' ||
        name === '.' ||
        name === '..' ||
        name.toLowerCase() === '.git' ||
        name.includes('/') ||
        name.includes('\\') ||
        path.isAbsolute(name)
      )
        throw new Error(UI_TEXT.teamRunners.testFailed)
    }
    this.slots = Array.from({ length: deps.count }, (_, id) => ({
      id,
      busy: false,
      uncertain: false,
    }))
  }
  private admit(job: CheckJob): void {
    job.signal.throwIfAborted()
    if (!this.deps.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
  }
  private async copyGuard(cwd: string): Promise<void> {
    const [copy, user, storage] = await Promise.all([
      realpath(cwd),
      realpath(this.deps.repositoryRoot),
      canonicalPath(this.deps.root),
    ])
    const relative = path.relative(user, storage)
    const isInside =
      relative !== '..' && !path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`)
    if (isInside || isSamePath(copy, user, this.deps.platform)) {
      throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
    }
  }

  private async git(
    args: readonly string[],
    cwd: string,
    job: CheckJob,
    slot: Slot,
  ): Promise<string> {
    this.admit(job)
    slot.uncertain = true
    const result = await this.deps.run({
      file: this.deps.file,
      args: [...GIT_METADATA_OPTIONS, '-c', 'core.hooksPath=/dev/null', ...args],
      cwd,
      env: {
        ...runnerEnvironment(this.deps.env),
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
      },
      timeoutMs: GIT_TIMEOUT_MS,
      signal: job.signal,
    })
    if (!result.descendantsEnded) throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
    slot.uncertain = false
    if (result.exitCode !== 0) throw new Error(UI_TEXT.teamRunners.testFailed)
    return result.output
  }
  private async command(
    command: string,
    cwd: string,
    job: CheckJob,
    slot: Slot,
  ): Promise<CheckResult> {
    this.admit(job)
    await this.copyGuard(cwd)
    this.admit(job)
    slot.uncertain = true
    const result = await this.deps.run({
      file: this.deps.shell,
      args: this.deps.shellArgs(command),
      cwd,
      env: runnerEnvironment(this.deps.env),
      timeoutMs: job.timeoutMs,
      signal: job.signal,
      onOutput: job.onOutput,
    })
    slot.uncertain = !result.descendantsEnded
    if (slot.uncertain) throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
    return {
      runId: job.runId,
      exitCode: result.exitCode,
      output: result.output,
      location: `local:${String(slot.id)}`,
    }
  }
  private async copyInstall(from: string, to: string): Promise<void> {
    for (const name of this.deps.installPaths) {
      const source = path.join(from, name)
      const target = path.join(to, name)
      await rm(target, { recursive: true, force: true })
      await cp(source, target, {
        recursive: true,
        dereference: false,
        mode: constants.COPYFILE_FICLONE,
      })
    }
  }
  private async prepare(
    slot: Slot,
    job: CheckJob,
  ): Promise<{ readonly cwd: string } | { readonly failure: CheckResult }> {
    await this.copyGuard(job.cwd)
    const home = path.join(this.deps.root, String(slot.id))
    const cwd = path.join(home, 'copy')
    await mkdir(home, { recursive: true })
    slot.uncertain = true
    const snapshot = await captureCheckSnapshot(
      job.cwd,
      path.join(this.deps.root, 'snapshots'),
      this.deps,
      () => {
        this.admit(job)
      },
    )
    slot.uncertain = false
    try {
      await realpath(path.join(cwd, '.git'))
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error
      await this.git(['clone', '--shared', '--no-checkout', '--', job.cwd, cwd], home, job, slot)
      await this.git(['remote', 'remove', 'origin'], cwd, job, slot)
    }
    await this.copyGuard(cwd)
    await this.git(['fetch', '--no-tags', '--', job.cwd, snapshot], cwd, job, slot)
    await this.git(['checkout', '--force', '--detach', snapshot], cwd, job, slot)
    await this.git(['clean', '-ffdx'], cwd, job, slot)
    const hash = createHash('sha256')
      .update(this.deps.cacheKey)
      .update('\0')
      .update(this.deps.setupCommand)
    for (const file of job.lockfiles) {
      if (file.startsWith('-') || path.isAbsolute(file) || file.split(/[\\/]/u).includes('..'))
        throw new Error(UI_TEXT.teamRunners.testFailed)
      hash
        .update('\0')
        .update(file)
        .update(await this.git(['show', `${snapshot}:${file}`], cwd, job, slot))
    }
    const cache = path.join(home, 'installs', hash.digest('hex'))
    let isReady = true
    try {
      await readFile(path.join(cache, 'ready'))
    } catch (error: unknown) {
      if (!isMissingPath(error)) throw error
      isReady = false
    }
    if (isReady) {
      await this.copyInstall(cache, cwd)
    } else {
      const result = await this.command(this.deps.setupCommand, cwd, job, slot)
      if (result.exitCode !== 0) return { failure: result }
      const staging = `${cache}.${randomUUID()}`
      await mkdir(staging, { recursive: true })
      await this.copyInstall(cwd, staging)
      await writeFile(path.join(staging, 'ready'), snapshot)
      // A slot has one owner in this window; publication is still whole-file/whole-folder.
      await rename(staging, cache)
    }
    return { cwd }
  }
  public states(): readonly { id: number; busy: boolean; uncertain: boolean }[] {
    return this.slots.map((slot) => ({ ...slot }))
  }
  /** Called only after the caller's shell guards (routeChecks), including then_run. */
  public async run(job: CheckJob): Promise<CheckResult> {
    this.admit(job)
    if (this.deps.isHostBusy()) throw new Error(UI_TEXT.teamRunners.busy)
    const slot = this.slots.find((candidate) => !candidate.busy)
    if (slot === undefined) throw new Error(UI_TEXT.teamRunners.busy)
    slot.busy = true
    try {
      const prepared = await this.prepare(slot, job)
      return 'failure' in prepared
        ? prepared.failure
        : await this.command(job.command, prepared.cwd, job, slot)
    } finally {
      if (!slot.uncertain) slot.busy = false
    }
  }
  /** The optional per-copy install never shares mutable files with the cached install. */
  public async installInCopy(job: CheckJob): Promise<void> {
    this.admit(job)
    const slot = this.slots.find((candidate) => !candidate.busy)
    if (slot === undefined || this.deps.isHostBusy()) throw new Error(UI_TEXT.teamRunners.busy)
    slot.busy = true
    try {
      const prepared = await this.prepare(slot, job)
      if ('failure' in prepared)
        throw new Error(UI_TEXT.teamRunners.testFailed, { cause: prepared.failure })
      await this.copyGuard(job.cwd)
      this.admit(job)
      await this.copyInstall(prepared.cwd, job.cwd)
    } finally {
      if (!slot.uncertain) slot.busy = false
    }
  }
}
