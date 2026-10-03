// The best-of-N run (M77, PLAN.md D49): one paid-use popup for the whole
// run, N worktree-rooted conversations on the Model API backend, a
// side-by-side diff comparison, and applying/staging the selected immutable
// tree. Pure orchestration: git, the paid gate and the attempt
// conversations are injected, so unit tests drive it with fakes.
//
// One live run at a time per window: a second start while one runs is
// refused. Attempts follow the originating conversation's approval mode;
// anything that would ask the user is declined instead (no surface can
// ask), and a nested paid use is refused by the session itself (the run's
// popup covers only the attempts' own requests). The subscription never
// pays: the runner refuses any backend but the Model API, whose turns bill
// the key.

import type { BestOfNCoordinator } from './bestOfNCoordinator'
import type { ResponseAttemptGuard } from '../backends/modelapi/client'
import type { OwnedSessionBudgetScope } from '../backends/modelapi/sessionBudget'
import type {
  BestOfNAttempt,
  BestOfNAttemptStatus,
  BestOfNRun,
  BestOfNRunStatus,
} from '../../shared/bestOfN'
import { modelApiPaidTier, type PaidUseRequest } from '../../shared/paid'
import type { SubagentUsage } from '../../shared/paid'
import type { CoreLogger } from '../logging'
import { isSamePath } from '../paths'
import { pathModule } from '../workspaceRoot'
import { worktreeAddArgs, worktreeRemoveArgs } from '../worktrees'
import type { BestOfNRequest } from '../../shared/bestOfN'
import { validateBestOfNRequest } from '../../shared/bestOfN'
import {
  bestOfNBranch,
  bestOfNChangedLines,
  bestOfNDiffArgs,
  bestOfNDiffStatArgs,
  bestOfNPaidRequest,
  bestOfNTakeArgs,
  bestOfNWorktreeFolder,
  clipBestOfNDiff,
  isBestOfNRunId,
  parseBestOfNNumstat,
} from './bestOfN'

const HEAD_ARGS = ['rev-parse', '--verify', 'HEAD^{commit}']
const CLEAN_ARGS = ['status', '--porcelain=v1', '-z', '--untracked-files=normal']
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

import { BestOfNError, isBestOfNError } from './bestOfNError'
export { BestOfNError } from './bestOfNError'

/** An attempt's conversation, started by the host around a worktree. */
export interface BestOfNAttemptDriver {
  readonly sessionId: string | undefined
  cancel(): Promise<void>
  dispose(): void
}

export type BestOfNAttemptEvent =
  | { readonly type: 'requestCompleted'; readonly requestsMade: number }
  | { readonly type: 'approvalDenied' }
  | {
      readonly type: 'completed'
      readonly requestsMade: number
      readonly ceilingReached: boolean
      readonly approvalsDenied: number
      readonly terminal: string
      readonly reason?: string
    }
  | { readonly type: 'failed'; readonly reason: string }

export interface BestOfNAttemptStart {
  readonly attemptId: string
  readonly branch: string
  readonly worktreePath: string
  readonly prompt: string
  readonly modelId: string
  readonly requestCeilingPerAttempt: number
  /** The originating conversation's wire approval mode. */
  readonly approvalMode: string
  readonly onEvent: (event: BestOfNAttemptEvent) => void
  /** Synchronous admission at the actual POST boundary, including retries. */
  readonly admitRequest: ResponseAttemptGuard
  readonly signal: AbortSignal
  readonly noteUsage: (modelId: string, usage: SubagentUsage) => void
  readonly budgetScope: OwnedSessionBudgetScope | undefined
}

export interface BestOfNRunnerDeps {
  readonly coordinator: BestOfNCoordinator
  readonly openAttempt?: (attemptId: string, runId: string) => Promise<void>
  /** A branch-safe run id (`bon-â€¦`); validated before any branch names it. */
  readonly newRunId: () => string
  readonly isTrusted: () => boolean
  readonly backendKind: () => 'museCode' | 'modelApi'
  /** The paid gate: the `bestOfN` setting on and its price accepted. */
  readonly isBestOfNOn: () => boolean
  /** The one D48 popup for the whole run. */
  readonly allowsPaidUse: (request: PaidUseRequest) => Promise<boolean>
  /** Counts the run's attempts in the window's tally. */
  readonly notePaidUse: (attempts: number) => void
  readonly noteAttemptRequest?: () => void
  readonly noteAttemptUsage?: (modelId: string, usage: SubagentUsage) => void
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    input?: string,
    beforeRun?: BestOfNGitGuard,
  ) => Promise<string>
  readonly getAccountId: () => Promise<string | undefined>
  readonly getBudgetScope?: () => Promise<OwnedSessionBudgetScope | undefined>
  readonly hasDirtyEditors: () => boolean
  readonly validatePaths: (root: string, files: readonly string[]) => Promise<void>
  readonly validateWorktree: (root: string) => Promise<void>
  readonly realPath: (path: string) => Promise<string>
  readonly repositoryRoot: () => string | undefined
  readonly platform: NodeJS.Platform
  readonly startAttempt: (start: BestOfNAttemptStart) => Promise<BestOfNAttemptDriver>
  readonly onUpdate: (run: BestOfNRun) => void
  readonly log: CoreLogger
}

export interface BestOfNStart extends BestOfNRequest {
  readonly modelId: string
  readonly approvalMode: string
  readonly isCurrent: () => boolean
}

/** Final asynchronous path checks precede the synchronous process admission. */
export interface BestOfNGitGuard {
  (): void
  readonly prepare?: (() => Promise<void>) | undefined
}

/** One Take owns its captured conversation recorder and all pending write notices. */
type BeginBestOfNWorkspaceEdits = (
  root: string,
  paths: readonly string[],
) => Promise<(wasWritten: boolean) => void>

interface RunningAttempt {
  attempt: BestOfNAttempt
  driver: BestOfNAttemptDriver | undefined
  tree: string | undefined
  patch: string | undefined
  isCapturing: boolean
  gitDir: string | undefined
}

interface LiveRun {
  readonly ticket: object
  readonly controller: AbortController
  readonly root: string
  readonly isCurrent: () => boolean
  baseRef: string
  gitDir: string | undefined
  accountId: string | undefined
  budgetScope: OwnedSessionBudgetScope | undefined
  isStarting: boolean
  isTaking: boolean
  readonly runId: string
  readonly prompt: string
  readonly modelId: string
  readonly attemptsCount: number
  readonly requestCeilingPerAttempt: number
  takenBranch: string | undefined
  readonly running: RunningAttempt[]
}

const TERMINAL_STATUSES: ReadonlySet<BestOfNAttemptStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
])

function isTerminal(status: BestOfNAttemptStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

function statusesOf(run: LiveRun): readonly BestOfNAttemptStatus[] {
  return run.running.map((entry) => entry.attempt.status)
}

function runStatusOf(run: LiveRun): BestOfNRunStatus {
  const statuses = statusesOf(run)
  if (statuses.some((status) => !isTerminal(status))) {
    return 'running'
  }
  const settled: BestOfNRunStatus | undefined = (['completed', 'failed'] as const).find((status) =>
    statuses.includes(status),
  )
  return settled ?? 'cancelled'
}

function freshAttempt(
  runId: string,
  index: number,
  repositoryRoot: string,
  platform: NodeJS.Platform,
): RunningAttempt {
  const branch = bestOfNBranch(runId, index)
  return {
    attempt: {
      attemptId: `${runId}-${String(index)}`,
      branch,
      worktreePath: bestOfNWorktreeFolder(repositoryRoot, runId, index, platform),
      status: 'queued',
      requestsMade: 0,
      ceilingReached: false,
      approvalsDenied: 0,
      files: [],
      changedLines: 0,
    },
    driver: undefined,
    tree: undefined,
    patch: undefined,
    isCapturing: false,
    gitDir: undefined,
  }
}

function snapshotOf(run: LiveRun): BestOfNRun {
  return {
    runId: run.runId,
    prompt: run.prompt,
    modelId: run.modelId,
    baseRef: run.baseRef,
    attempts: run.attemptsCount,
    requestCeilingPerAttempt: run.requestCeilingPerAttempt,
    status: runStatusOf(run),
    ...(run.takenBranch !== undefined && { takenBranch: run.takenBranch }),
    runAttempts: run.running.map((entry) => entry.attempt),
  }
}

/**
 * One best-of-N run per window. `start` asks once and fans out; driver
 * events settle attempts; `take` applies and stages the frozen tree; `cancel`
 * stops whatever still runs. Every change posts the run through `onUpdate`.
 */
export class BestOfNRunner {
  private run: LiveRun | undefined

  public constructor(private readonly deps: BestOfNRunnerDeps) {}

  private publish(run: LiveRun): void {
    if (this.run !== run) {
      return
    }
    const snapshot = snapshotOf(run)
    this.deps.coordinator.update(run.ticket, snapshot, this.deps.openAttempt)
    this.deps.onUpdate(snapshot)
    if (!run.isStarting && runStatusOf(run) !== 'running') {
      this.deps.coordinator.release(run.ticket)
    }
  }

  private requireCurrent(run: LiveRun, canAllowStopped = false): void {
    if (
      (!canAllowStopped && run.controller.signal.aborted) ||
      this.run !== run ||
      !run.isCurrent() ||
      this.deps.repositoryRoot() !== run.root
    ) {
      throw new BestOfNError('contextChanged')
    }
    this.requireAvailable()
    if (run.accountId !== undefined && run.budgetScope?.isStillAllowed(run.accountId) === false) {
      throw new BestOfNError('contextChanged')
    }
  }

  private requireAvailable(): void {
    if (!this.deps.isTrusted()) {
      throw new BestOfNError('untrusted')
    }
    if (this.deps.backendKind() !== 'modelApi') {
      throw new BestOfNError('wrongBackend')
    }
    if (!this.deps.isBestOfNOn()) {
      throw new BestOfNError('paidOff')
    }
  }

  private async git(
    run: LiveRun,
    args: readonly string[],
    cwd: string,
    input?: string,
    canAllowStopped = false,
    entry?: RunningAttempt,
    prepare?: () => Promise<void>,
  ): Promise<string> {
    const rootGitDir = cwd === run.root ? run.gitDir : undefined
    const invocation =
      rootGitDir === undefined
        ? args
        : [`--git-dir=${rootGitDir}`, `--work-tree=${run.root}`, ...args]
    const finalPrepare =
      rootGitDir === undefined
        ? prepare
        : async () => {
            await prepare?.()
            const canonical = await this.deps.realPath(rootGitDir)
            if (!isSamePath(canonical, rootGitDir, this.deps.platform))
              throw new BestOfNError('contextChanged')
          }
    const beforeRun = Object.assign(
      (): void => {
        this.requireCurrent(run, canAllowStopped)
        if (entry !== undefined && isTerminal(entry.attempt.status)) {
          throw new BestOfNError('attemptNotDone')
        }
        if (input !== undefined && this.deps.hasDirtyEditors())
          throw new BestOfNError('targetChanged')
      },
      { prepare: finalPrepare },
    )
    beforeRun()
    return await this.deps.runGit(invocation, cwd, input, beforeRun)
  }

  private objectId(output: string): string {
    const value = output.trim()
    if (!OBJECT_ID.test(value)) {
      throw new BestOfNError('worktreeFailed')
    }
    return value
  }

  private entryOf(run: LiveRun, attemptId: string): RunningAttempt {
    const entry = run.running.find((candidate) => candidate.attempt.attemptId === attemptId)
    if (entry === undefined) {
      throw new BestOfNError('unknownAttempt')
    }
    return entry
  }

  private setAttempt(run: LiveRun, attemptId: string, attempt: BestOfNAttempt): void {
    this.entryOf(run, attemptId).attempt = attempt
    this.publish(run)
  }

  private disposeOf(entry: RunningAttempt): void {
    const driver = entry.driver
    entry.driver = undefined
    if (driver === undefined) {
      return
    }
    try {
      driver.dispose()
    } catch {
      this.deps.log.warn('A best-of-N attempt session was already gone')
    }
  }

  /** Mark every stopped entry before cancellation can yield to another driver. */
  private async stopEntries(entries: readonly RunningAttempt[]): Promise<void> {
    const active = entries.filter((entry) => !isTerminal(entry.attempt.status))
    for (const entry of active) entry.attempt = { ...entry.attempt, status: 'cancelled' }
    await Promise.all(
      active.map(async (entry) => {
        try {
          await entry.driver?.cancel()
        } catch {
          this.deps.log.warn('A best-of-N attempt cancellation settled elsewhere')
        } finally {
          this.disposeOf(entry)
        }
      }),
    )
  }

  private async launch(run: LiveRun, entry: RunningAttempt, start: BestOfNStart): Promise<void> {
    // A take or cancel may have settled the attempt while an earlier launch
    // was still awaiting the host: never resurrect it.
    if (isTerminal(entry.attempt.status)) {
      return
    }
    const { attempt } = entry
    try {
      this.requireCurrent(run)
      const driver = await this.deps.startAttempt({
        attemptId: attempt.attemptId,
        branch: attempt.branch,
        worktreePath: attempt.worktreePath,
        prompt: start.prompt,
        modelId: start.modelId,
        requestCeilingPerAttempt: start.requestCeilingPerAttempt,
        approvalMode: start.approvalMode,
        signal: run.controller.signal,
        budgetScope: run.budgetScope,
        noteUsage: (modelId, usage) => {
          if (
            this.run === run &&
            !run.controller.signal.aborted &&
            run.isCurrent() &&
            modelId === run.modelId
          ) {
            this.deps.noteAttemptUsage?.(modelId, usage)
          }
        },
        admitRequest: Object.assign(
          (keyDigest: string | undefined) => {
            this.requireCurrent(run)
            if (keyDigest === undefined || keyDigest !== run.accountId) {
              throw new BestOfNError('contextChanged')
            }
            if (run.budgetScope?.isStillAllowed(keyDigest) === false)
              throw new BestOfNError('contextChanged')
            if (isTerminal(entry.attempt.status) || entry.isCapturing)
              throw new BestOfNError('attemptNotDone')
            if (!(entry.attempt.requestsMade >= run.requestCeilingPerAttempt)) {
              return
            }

            entry.attempt = { ...entry.attempt, ceilingReached: true }
            this.publish(run)
            throw new BestOfNError('attemptNotDone')
          },
          {
            onRequestStarted: () => {
              this.requireCurrent(run)
              if (entry.attempt.requestsMade === 0) {
                this.deps.notePaidUse(1)
              }
              entry.attempt = { ...entry.attempt, requestsMade: entry.attempt.requestsMade + 1 }
              this.deps.noteAttemptRequest?.()
              this.publish(run)
            },
          },
        ),
        onEvent: (event) => {
          void this.onAttemptEvent(run, attempt.attemptId, event).catch(() => {
            this.deps.log.warn('A best-of-N attempt event arrived after its run ended')
          })
        },
      })
      // A cancel may have settled the attempt while the host started it.
      if (isTerminal(entry.attempt.status) || run.controller.signal.aborted) {
        try {
          driver.dispose()
        } catch {
          this.deps.log.warn('A best-of-N attempt session was already gone')
        }
        return
      }
      entry.driver = driver
      const { sessionId } = driver
      entry.attempt = {
        ...entry.attempt,
        status: 'running',
        ...(sessionId !== undefined && { sessionId }),
      }
    } catch (error: unknown) {
      if (!isTerminal(entry.attempt.status)) {
        const reason = error instanceof Error ? error.message : String(error)
        entry.attempt = { ...entry.attempt, status: 'failed', failureReason: reason }
      }
      this.disposeOf(entry)
    }
    this.publish(run)
  }

  private async onAttemptEvent(
    run: LiveRun,
    attemptId: string,
    event: BestOfNAttemptEvent,
  ): Promise<void> {
    // A superseded run's late events, and any event for a settled attempt
    // (a completion racing its cancel), change nothing.
    if (this.run !== run) {
      return
    }
    const entry = this.entryOf(run, attemptId)
    if (isTerminal(entry.attempt.status)) {
      return
    }
    switch (event.type) {
      case 'requestCompleted': {
        // Token usage is evidence of billing, not HTTP admission. The
        // synchronous request guard owns the ceiling and live count.
        break
      }
      case 'approvalDenied': {
        this.setAttempt(run, attemptId, {
          ...entry.attempt,
          approvalsDenied: entry.attempt.approvalsDenied + 1,
        })
        break
      }
      case 'completed': {
        if (event.terminal !== 'completed') {
          this.setAttempt(run, attemptId, {
            ...entry.attempt,
            status: event.terminal === 'cancelled' ? 'cancelled' : 'failed',
            failureReason: event.reason ?? event.terminal,
            approvalsDenied: event.approvalsDenied,
          })
          this.disposeOf(entry)
          break
        }
        await this.completeAttempt(run, entry, event)
        break
      }
      case 'failed': {
        this.setAttempt(run, attemptId, {
          ...entry.attempt,
          status: 'failed',
          failureReason: event.reason,
        })
        this.disposeOf(entry)
        break
      }
    }
  }

  private async completeAttempt(
    run: LiveRun,
    entry: RunningAttempt,
    event: Extract<BestOfNAttemptEvent, { type: 'completed' }>,
  ): Promise<void> {
    if (entry.isCapturing) {
      return
    }
    entry.isCapturing = true
    try {
      this.requireCurrent(run)
      // The attempt owns this worktree's index. Ordinary add/write-tree
      // captures tracked edits and unignored new files without a commit.
      await this.deps.validateWorktree(entry.attempt.worktreePath)
      this.requireCurrent(run)
      if (isTerminal(entry.attempt.status)) return
      if (entry.gitDir === undefined) {
        throw new BestOfNError('worktreeFailed')
      }
      const ownedGit = [`--git-dir=${entry.gitDir}`, `--work-tree=${entry.attempt.worktreePath}`]
      await this.git(
        run,
        [...ownedGit, 'add', '--all', '--'],
        entry.attempt.worktreePath,
        undefined,
        false,
        entry,
        async () => {
          await this.deps.validateWorktree(entry.attempt.worktreePath)
        },
      )
      const tree = this.objectId(
        await this.git(
          run,
          [...ownedGit, 'write-tree'],
          entry.attempt.worktreePath,
          undefined,
          false,
          entry,
        ),
      )
      const stat = await this.git(
        run,
        bestOfNDiffStatArgs(run.baseRef, tree),
        run.root,
        undefined,
        false,
        entry,
      )
      const files = [...parseBestOfNNumstat(stat)]
      await this.deps.validatePaths(
        run.root,
        files.map((file) => file.path),
      )
      this.requireCurrent(run)
      if (isTerminal(entry.attempt.status)) return
      const modes =
        files.length === 0
          ? ''
          : await this.git(
              run,
              ['ls-tree', '-r', '-z', tree, '--', ...files.map((file) => file.path)],
              run.root,
              undefined,
              false,
              entry,
            )
      if (
        modes
          .split('\0')
          .some((record) => record !== '' && !/^(?:100644|100755) blob [a-f0-9]+\t/.test(record))
      ) {
        throw new BestOfNError('targetChanged')
      }
      const full = await this.git(
        run,
        bestOfNDiffArgs(run.baseRef, tree),
        run.root,
        undefined,
        false,
        entry,
      )
      const patch = await this.git(
        run,
        [
          'diff',
          '--binary',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          run.baseRef,
          tree,
          '--',
        ],
        run.root,
        undefined,
        false,
        entry,
      )
      this.requireCurrent(run)
      if (isTerminal(entry.attempt.status)) {
        return
      }
      const clipped = clipBestOfNDiff(full)
      entry.tree = tree
      entry.patch = patch
      this.setAttempt(run, entry.attempt.attemptId, {
        ...entry.attempt,
        status: 'completed',
        approvalsDenied: event.approvalsDenied,
        files,
        changedLines: bestOfNChangedLines(files),
        diff: clipped.text,
        ...(clipped.isClipped && { isDiffClipped: true }),
      })
    } catch {
      if (!isTerminal(entry.attempt.status)) {
        this.setAttempt(run, entry.attempt.attemptId, { ...entry.attempt, status: 'failed' })
      }
      this.deps.log.warn("A best-of-N attempt's immutable comparison could not be captured")
    } finally {
      this.disposeOf(entry)
    }
  }

  private async removeWorktrees(
    run: LiveRun,
    entries: readonly RunningAttempt[],
    cwd: string,
  ): Promise<void> {
    for (const entry of entries) {
      try {
        await this.git(
          run,
          worktreeRemoveArgs(entry.attempt.worktreePath, false),
          cwd,
          undefined,
          true,
        )
        entry.attempt = { ...entry.attempt, hasWorktree: false }
      } catch {
        this.deps.log.warn('A best-of-N worktree stayed behind after a failed start')
      }
    }
  }

  /** Ask once, create N worktrees, start N conversations. */
  public async start(start: BestOfNStart): Promise<BestOfNRun> {
    if (this.run !== undefined && (runStatusOf(this.run) === 'running' || this.run.isTaking)) {
      throw new BestOfNError('alreadyRunning')
    }
    const repositoryRoot = this.deps.repositoryRoot()
    if (repositoryRoot === undefined) {
      throw new BestOfNError('noWorkspace')
    }
    this.requireAvailable()
    if (validateBestOfNRequest(start).length > 0) {
      throw new BestOfNError('invalid')
    }
    if (modelApiPaidTier(start.modelId) === undefined) {
      throw new BestOfNError('unknownModel')
    }
    const runId = this.deps.newRunId()
    if (!isBestOfNRunId(runId)) {
      throw new Error('The best-of-N run id was not branch-safe')
    }
    const run: LiveRun = {
      ticket: {},
      controller: new AbortController(),
      root: repositoryRoot,
      isCurrent: start.isCurrent,
      baseRef: 'HEAD',
      gitDir: undefined,
      accountId: undefined,
      budgetScope: undefined,
      isStarting: true,
      isTaking: false,
      runId,
      prompt: start.prompt,
      modelId: start.modelId,
      attemptsCount: start.attempts,
      requestCeilingPerAttempt: start.requestCeilingPerAttempt,
      takenBranch: undefined,
      running: [],
    }
    if (!this.deps.coordinator.acquire(run.ticket)) {
      throw new BestOfNError('alreadyRunning')
    }
    if (this.run !== undefined) {
      this.deps.coordinator.forget(this.run.ticket)
    }
    for (let index = 0; index < start.attempts; index += 1) {
      run.running.push(freshAttempt(runId, index, repositoryRoot, this.deps.platform))
    }
    this.run = run
    this.publish(run)
    const created: RunningAttempt[] = []
    try {
      this.requireCurrent(run)
      run.accountId = await this.deps.getAccountId()
      this.requireCurrent(run)
      if (run.accountId === undefined) {
        throw new BestOfNError('contextChanged')
      }
      run.budgetScope = await this.deps.getBudgetScope?.()
      this.requireCurrent(run)
      if (
        run.budgetScope !== undefined &&
        (run.budgetScope.accountId !== run.accountId ||
          !run.budgetScope.isStillAllowed(run.accountId))
      )
        throw new BestOfNError('contextChanged')
      const isAllowed = await this.deps.allowsPaidUse(
        bestOfNPaidRequest(
          start.modelId,
          start.prompt,
          start.attempts,
          start.requestCeilingPerAttempt,
        ),
      )
      this.requireCurrent(run)
      if (!isAllowed) {
        throw new BestOfNError('consentDeclined')
      }
      const accountId = await this.deps.getAccountId()
      this.requireCurrent(run)
      if (accountId !== run.accountId) {
        throw new BestOfNError('contextChanged')
      }
      if (run.budgetScope?.isStillAllowed(accountId) === false)
        throw new BestOfNError('contextChanged')
      await this.deps.validateWorktree(repositoryRoot)
      this.requireCurrent(run)
      const gitDirOutput = await this.git(run, ['rev-parse', '--absolute-git-dir'], repositoryRoot)
      const gitDir = gitDirOutput.trim()
      if (!pathModule(this.deps.platform).isAbsolute(gitDir))
        throw new BestOfNError('worktreeFailed')
      const canonicalGitDir = await this.deps.realPath(gitDir)
      this.requireCurrent(run)
      if (!pathModule(this.deps.platform).isAbsolute(canonicalGitDir))
        throw new BestOfNError('worktreeFailed')
      run.gitDir = canonicalGitDir
      run.baseRef = this.objectId(await this.git(run, HEAD_ARGS, repositoryRoot))
      this.requireCurrent(run)
      for (const entry of run.running) {
        this.requireCurrent(run)
        await this.git(
          run,
          worktreeAddArgs(entry.attempt.worktreePath, entry.attempt.branch, run.baseRef),
          repositoryRoot,
        )
        entry.attempt = { ...entry.attempt, hasWorktree: true }
        created.push(entry)
        this.requireCurrent(run)
        await this.deps.validateWorktree(entry.attempt.worktreePath)
        this.requireCurrent(run)
        const attemptGitDir = await this.git(
          run,
          ['rev-parse', '--absolute-git-dir'],
          entry.attempt.worktreePath,
        )
        entry.gitDir = attemptGitDir.trim()
        this.requireCurrent(run)
        if (entry.gitDir === '') {
          throw new BestOfNError('worktreeFailed')
        }
      }
      for (const entry of run.running) {
        this.requireCurrent(run)
        await this.launch(run, entry, start)
      }
    } catch (error: unknown) {
      // Never force-delete an attempt after a host could have written to
      // it. Failed setup removes only the empty worktrees made before launch.
      if (run.running.every((entry) => entry.attempt.status === 'queued')) {
        await this.removeWorktrees(run, created, repositoryRoot)
      }
      for (const entry of run.running) {
        if (isTerminal(entry.attempt.status)) {
          continue
        }

        entry.attempt = { ...entry.attempt, status: 'cancelled' }
        this.disposeOf(entry)
      }
      run.controller.abort()
      if (isBestOfNError(error)) {
        throw error
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new BestOfNError('worktreeFailed', detail)
    } finally {
      run.isStarting = false
      this.publish(run)
    }
    return snapshotOf(run)
  }

  public async take(
    attemptId: string,
    runId?: string,
    beginWorkspaceEdits?: BeginBestOfNWorkspaceEdits,
  ): Promise<BestOfNRun> {
    const run = this.run
    if (run === undefined || (runId !== undefined && runId !== run.runId)) {
      throw new BestOfNError('noRun')
    }
    if (run.takenBranch !== undefined || run.isTaking) {
      throw new BestOfNError('alreadyTaken', run.takenBranch)
    }
    const entry = this.entryOf(run, attemptId)
    if (
      entry.attempt.status !== 'completed' ||
      entry.tree === undefined ||
      entry.patch === undefined
    ) {
      throw new BestOfNError('attemptNotDone')
    }
    if (!this.deps.coordinator.acquire(run.ticket)) {
      throw new BestOfNError('alreadyRunning')
    }
    run.isTaking = true
    let completeEdit: ((wasWritten: boolean) => void) | undefined
    let wasWritten = false
    try {
      this.requireCurrent(run, true)
      const accountId = await this.deps.getAccountId()
      this.requireCurrent(run, true)
      if (accountId !== run.accountId) {
        throw new BestOfNError('contextChanged')
      }
      if (this.deps.hasDirtyEditors()) {
        throw new BestOfNError('targetChanged')
      }
      if (entry.patch !== '') {
        completeEdit = await beginWorkspaceEdits?.(
          run.root,
          entry.attempt.files.map((file) => file.path),
        )
        this.requireCurrent(run, true)
      }
      await this.deps.validatePaths(
        run.root,
        entry.attempt.files.map((file) => file.path),
      )
      this.requireCurrent(run, true)
      const status = await this.git(run, CLEAN_ARGS, run.root, undefined, true)
      const head = this.objectId(await this.git(run, HEAD_ARGS, run.root, undefined, true))
      await this.deps.validatePaths(
        run.root,
        entry.attempt.files.map((file) => file.path),
      )
      this.requireCurrent(run, true)
      if (status !== '' || head !== run.baseRef || this.deps.hasDirtyEditors()) {
        throw new BestOfNError('targetChanged')
      }
      // No await between the final ownership check and ordinary apply.
      // --index independently refuses changed indexed/working bytes.
      if (entry.patch !== '') {
        await this.git(run, bestOfNTakeArgs(), run.root, entry.patch, true, undefined, async () => {
          if ((await this.deps.getAccountId()) !== run.accountId)
            throw new BestOfNError('contextChanged')
          await this.deps.validateWorktree(run.root)
          await this.deps.validatePaths(
            run.root,
            entry.attempt.files.map((file) => file.path),
          )
        })
        wasWritten = true
      }
      run.takenBranch = entry.attempt.branch
    } catch (error: unknown) {
      if (isBestOfNError(error)) {
        throw error
      }
      const detail = error instanceof Error ? error.message : String(error)
      throw new BestOfNError('worktreeFailed', detail)
    } finally {
      try {
        completeEdit?.(wasWritten)
      } finally {
        run.isTaking = false
        if (runStatusOf(run) !== 'running') {
          this.deps.coordinator.release(run.ticket)
        }
      }
    }
    await this.stopEntries(run.running.filter((other) => other !== entry))
    this.publish(run)
    return snapshotOf(run)
  }

  /** Stop whatever still runs; finished attempts keep their diffs. */
  public async cancel(runId?: string): Promise<BestOfNRun> {
    const run = this.run
    if (run === undefined || (runId !== undefined && runId !== run.runId)) {
      throw new BestOfNError('noRun')
    }
    run.controller.abort()
    await this.stopEntries(run.running)
    this.publish(run)
    return snapshotOf(run)
  }

  public async worktreePathOf(attemptId: string, runId: string): Promise<string> {
    const run = this.run
    if (run?.runId !== runId) {
      throw new BestOfNError('noRun')
    }
    this.requireCurrent(run, true)
    const accountId = await this.deps.getAccountId()
    this.requireCurrent(run, true)
    if (accountId !== run.accountId) {
      throw new BestOfNError('contextChanged')
    }
    return this.entryOf(run, attemptId).attempt.worktreePath
  }

  public dispose(): void {
    const run = this.run
    this.run = undefined
    if (run === undefined) {
      return
    }

    run.controller.abort()
    for (const entry of run.running) {
      if (!isTerminal(entry.attempt.status)) {
        entry.attempt = { ...entry.attempt, status: 'cancelled' }
      }
      this.disposeOf(entry)
    }
    this.deps.coordinator.release(run.ticket)
    this.deps.coordinator.forget(run.ticket)
  }
}
