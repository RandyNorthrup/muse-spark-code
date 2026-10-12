import type { ResourceEvent, ResourceLevel, ResourceSettings } from '../../shared/resources'
import type { ResourceLaunchHost } from '../resources/launchHost'
import type {
  ResourceRelocationAttempt,
  ResourceRelocationOptions,
  ResourceRelocationTarget,
  ResourceRelocationWork,
} from '../resources/relocate'
import { runnerHealthSchema } from './health'

export interface ResourceRunnerRouting<T> {
  level: ResourceLevel
  relocation: ResourceSettings['relocate']
  queued: boolean
  keepHere: boolean
  /** M96c's approved, matching SSH runners only; this port confers no new authority. */
  approvedRunner(): T | undefined
}

/** A routing proposal only. R owns confirmation, admission, rows and dispatch.
@unwired M96c SSH runner routing preference
*/
export function resourceRunnerPreference<T>(routing: ResourceRunnerRouting<T>) {
  if (
    !routing.queued ||
    routing.keepHere ||
    routing.relocation === 'off' ||
    (routing.level !== 'relocate' && routing.level !== 'pause')
  )
    return
  const runner = routing.approvedRunner()
  if (runner === undefined) return
  return {
    runner,
    level: routing.level,
    reason: 'machineBusy' as const,
    requiresConfirmation: routing.relocation === 'ask',
  }
}

import type { Runner } from '../../shared/team'
import type { RunnerHealth } from './health'
import { UI_TEXT } from '../../shared/constants'

export interface CheckJob {
  readonly runId: string
  readonly cwd: string
  readonly command: string
  readonly timeoutMs: number
  readonly commandClass: Runner['commandClasses'][number]
  readonly labels: readonly string[]
  readonly preferredRunners: readonly string[]
  readonly lockfiles: readonly string[]
  readonly signal: AbortSignal
  readonly onOutput: (text: string) => void
  /** Receiver's existing durable start receipt; never inferred from SSH exit. */
  readonly onAdmitted?: (() => void) | undefined
  /**
  Fired exactly once, immediately before the start command is written to the
  transport, after every pre-send refusal has thrown. The router's only
  sent fact; pre-send stops must never read uncertain.
  */
  readonly onSent?: (() => void) | undefined
  readonly relocation?:
    { readonly reason: 'machineBusy'; readonly level: ResourceLevel } | undefined
}
export interface CheckResult {
  readonly runId: string
  readonly exitCode: number
  readonly output: string
  readonly location: string
}
export type RunnerDispatch =
  | { readonly kind: 'finished'; readonly result: CheckResult }
  | { readonly kind: 'busy' | 'offline' | 'uncertain' }

export interface CheckRoutingDeps {
  readonly isTrusted: () => boolean
  readonly localLabels: readonly string[]
  /** Must sample immediately before dispatch, with a bounded transport timeout. */
  readonly sample: (runner: Runner) => Promise<RunnerHealth | undefined>
  readonly remote: (runner: Runner, job: CheckJob) => Promise<RunnerDispatch>
  readonly local: (job: CheckJob) => Promise<CheckResult>
  /** One binding per conversation, supplied by the existing runner/scheduler owner. */
  readonly resources?: ResourceRunnerRouter | undefined
}

export interface ResourceRunnerRouteOptions {
  readonly port: Pick<ResourceLaunchHost, 'status' | 'createRelocator'>
  readonly headless: boolean
  /** Only cached, user-approved routes; this must not discover or probe. */
  readonly hasTarget: () => boolean
  readonly isHeavy: (job: CheckJob) => boolean
  readonly phase: (job: CheckJob) => 'queued' | 'running'
  /** Includes current attempt/tool, repository, snapshot and runner approval. */
  readonly isApproved: (runner: Runner, job: CheckJob) => boolean
  readonly claim: (job: CheckJob) => boolean
  readonly settle: (job: CheckJob, result: 'kept' | 'admitted' | 'uncertain') => void
  readonly ask: (job: CheckJob, runner: Runner, signal: AbortSignal) => Promise<boolean>
  readonly row: (
    job: CheckJob,
    runner: Runner,
    metadata: NonNullable<CheckJob['relocation']>,
    keepHere: ResourceRelocationAttempt['keepHere'],
  ) => void
  readonly notice: (runner: Runner) => void
  readonly traffic: (
    job: CheckJob,
    runner: Runner,
    event: Extract<ResourceEvent, { type: 'relocated' }>,
  ) => void
  readonly onError: ResourceRelocationOptions['onError']
}

/** Relocation does not apply: the caller runs ordinary runner routing. */
const DECLINED: unique symbol = Symbol('resourceRoutingDeclined')

/** R's policy over M96c's existing ownership, approval, health and dispatch ports. */
export class ResourceRunnerRouter {
  private readonly relocator
  private readonly work = new Map<
    ResourceRelocationWork,
    {
      job: CheckJob
      targets: readonly ResourceRelocationTarget[]
      attempt: ResourceRelocationAttempt
    }
  >()
  private readonly runners = new WeakMap<
    ResourceRelocationTarget,
    { runner: Runner; job: CheckJob }
  >()
  private readonly active = new Map<string, Promise<CheckResult>>()
  private readonly cancel = new AbortController()

  constructor(
    private readonly options: ResourceRunnerRouteOptions,
    private readonly unregister?: () => void,
  ) {
    this.relocator = options.port.createRelocator({
      headless: options.headless,
      devicesEnabled: () => false,
      devices: () => [],
      runnersEnabled: () => !this.cancel.signal.aborted && options.hasTarget(),
      runners: (work) => this.work.get(work)?.targets ?? [],
      ask: async (work, target, signal) => {
        const item = this.work.get(work)
        const context = this.runners.get(target)
        const runner = context?.runner
        return (
          item !== undefined &&
          runner !== undefined &&
          (await options.ask(item.job, runner, signal))
        )
      },
      row: (work, target, metadata) => {
        const item = this.work.get(work)
        const context = this.runners.get(target)
        const runner = context?.runner
        if (item === undefined || runner === undefined) throw new Error(UI_TEXT.teamRunners.busy)
        options.row(item.job, runner, metadata, async () => await item.attempt.keepHere())
      },
      notice: (target) => {
        const context = this.runners.get(target)
        const runner = context?.runner
        if (runner !== undefined) options.notice(runner)
      },
      traffic: (target, event) => {
        const context = this.runners.get(target)
        const runner = context?.runner
        if (runner !== undefined && context !== undefined)
          options.traffic(context.job, runner, event)
      },
      onError: options.onError,
    })
  }

  private async move(
    job: CheckJob,
    runners: readonly Runner[],
    deps: CheckRoutingDeps,
  ): Promise<CheckResult | typeof DECLINED | undefined> {
    // Publish the shared promise before an injected ownership or surface port can re-enter.
    await Promise.resolve()
    const signal = AbortSignal.any([job.signal, this.cancel.signal])
    signal.throwIfAborted()
    if (this.options.phase(job) !== 'queued') throw new Error(UI_TEXT.teamRunners.busy)
    const status = this.options.port.status()
    if (
      this.options.headless ||
      !status.settings.enabled ||
      !this.options.isHeavy(job) ||
      status.settings.relocate === 'off'
    )
      // Relocation adds a route; it never removes one. The caller runs the
      // ordinary runner routing exactly as before this binding.
      return DECLINED
    if (
      resourceRunnerPreference({
        level: status.level,
        relocation: status.settings.relocate,
        queued: this.options.phase(job) === 'queued',
        keepHere: false,
        approvedRunner: () => runners.find((runner) => this.options.isApproved(runner, job)),
      }) === undefined
    )
      // No approved runner (or pressure recovered): kept locally, no probes.
      return undefined
    const state: { completion?: Promise<RunnerDispatch>; isClaimRefused: boolean } = {
      isClaimRefused: false,
    }
    const work: ResourceRelocationWork = {
      repository: job.cwd,
      kind: 'check',
      heavy: this.options.isHeavy(job),
      phase: () => this.options.phase(job),
      claim: () => {
        state.isClaimRefused = !this.options.claim(job)
        return !state.isClaimRefused
      },
      settle: (result) => {
        this.options.settle(job, result)
      },
    }
    const targets = runners.map((runner): ResourceRelocationTarget => {
      const target: ResourceRelocationTarget = {
        id: runner.id,
        type: 'ssh',
        hasOffer: (repository, kind) =>
          repository.replaceAll('\\', '/') === job.cwd.replaceAll('\\', '/') &&
          kind === 'check' &&
          !signal.aborted &&
          deps.isTrusted() &&
          this.options.phase(job) === 'queued' &&
          this.options.isHeavy(job) &&
          this.options.isApproved(runner, job),
        resource: async () => {
          const parsed = runnerHealthSchema.safeParse(await deps.sample(runner))
          if (!parsed.success) throw new Error(UI_TEXT.teamRunners.offline)
          const isReady =
            parsed.data.inputReady &&
            parsed.data.freeSlots > 0 &&
            parsed.data.load < parsed.data.cores
          return { level: isReady ? 'normal' : 'pause', headroom: isReady ? 'some' : 'none' }
        },
        dispatch: async (metadata, relocationSignal) =>
          await new Promise<'admitted' | 'refused' | 'uncertain'>((resolve) => {
            state.completion = this.dispatch(
              job,
              runner,
              target,
              deps,
              metadata,
              signal,
              relocationSignal,
              resolve,
            )
          }),
      }
      this.runners.set(target, { runner, job })
      return target
    })
    const attempt = this.relocator.create(work)
    const keep = () => {
      void attempt.keepHere().catch(this.options.onError)
    }
    signal.addEventListener('abort', keep, { once: true })
    this.work.set(work, { job, targets, attempt })
    try {
      const result = await attempt.run()
      if (state.isClaimRefused) throw new Error(UI_TEXT.teamRunners.busy)
      if (result === 'uncertain') throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
      if (result === 'kept') {
        signal.throwIfAborted()
        if (this.options.phase(job) !== 'queued') throw new Error(UI_TEXT.teamRunners.busy)
        return
      }
      const answer = await state.completion
      if (answer?.kind !== 'finished' || answer.result.runId !== job.runId) {
        throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
      }
      return answer.result
    } finally {
      signal.removeEventListener('abort', keep)
      this.work.delete(work)
    }
  }

  private async dispatch(
    job: CheckJob,
    runner: Runner,
    target: ResourceRelocationTarget,
    deps: CheckRoutingDeps,
    metadata: NonNullable<CheckJob['relocation']>,
    signal: AbortSignal,
    relocationSignal: AbortSignal,
    receipt: (result: 'admitted' | 'refused' | 'uncertain') => void,
  ): Promise<RunnerDispatch> {
    const withdrawal = new AbortController()
    const withdraw = () => {
      withdrawal.abort()
    }
    relocationSignal.addEventListener('abort', withdraw, { once: true })
    if (relocationSignal.aborted) withdraw()
    const detach = () => {
      relocationSignal.removeEventListener('abort', withdraw)
    }
    const dispatchSignal = AbortSignal.any([signal, withdrawal.signal])
    const sendState = { sent: false }
    try {
      dispatchSignal.throwIfAborted()
      const relocation = this.options.port.status().settings.relocate
      const isOffered = target.hasOffer(job.cwd, 'check')
      dispatchSignal.throwIfAborted()
      const final = this.options.port.status()
      if (
        !isOffered ||
        !final.settings.enabled ||
        final.level !== metadata.level ||
        final.settings.relocate === 'off' ||
        final.settings.relocate !== relocation
      ) {
        receipt('refused')
        return { kind: 'offline' }
      }
      // The only sent fact: fired immediately before the start command is
      // written, by the transport itself. Every stop before it reads refused.
      const answer = await deps.remote(runner, {
        ...job,
        signal: dispatchSignal,
        relocation: metadata,
        onSent: () => {
          sendState.sent = true
          job.onSent?.()
        },
        onAdmitted: () => {
          detach()
          receipt('admitted')
          job.onAdmitted?.()
        },
      })
      if (answer.kind === 'finished' && answer.result.runId === job.runId) receipt('admitted')
      else receipt(answer.kind === 'offline' || answer.kind === 'busy' ? 'refused' : 'uncertain')
      return answer
    } catch (error: unknown) {
      receipt(sendState.sent ? 'uncertain' : 'refused')
      this.options.onError(error)
      return { kind: sendState.sent ? 'uncertain' : 'offline' }
    } finally {
      detach()
    }
  }

  isBusy(runId: string): boolean {
    if (this.active.has(runId) || this.cancel.signal.aborted) return true
    const level = this.options.port.status().level
    return level === 'relocate' || level === 'pause'
  }

  /** Hold the shared attempt through remote completion or the existing local admission. */
  async route(
    job: CheckJob,
    runners: readonly Runner[],
    deps: CheckRoutingDeps,
    local: () => Promise<CheckResult>,
    ordinary?: () => Promise<CheckResult>,
  ) {
    const previous = this.active.get(job.runId)
    if (previous !== undefined) return await previous
    const pending = (async () => {
      const moved = await this.move(job, runners, deps)
      // Declined relocation keeps the ordinary route: a label-bound check
      // still reaches its runner; nothing fails Offline because of the binding.
      if (moved === DECLINED) return ordinary === undefined ? await local() : await ordinary()
      return moved ?? (await local())
    })()
    this.active.set(job.runId, pending)
    try {
      return await pending
    } finally {
      if (this.active.get(job.runId) === pending) this.active.delete(job.runId)
    }
  }

  async keepHere(runId: string): Promise<boolean> {
    for (const item of this.work.values()) {
      if (item.job.runId === runId) return await item.attempt.keepHere()
    }
    return false
  }

  dispose(): void {
    this.cancel.abort()
    this.unregister?.()
  }
}

/** Caller admission runs before any snapshot, install, health probe or dispatch. */
export async function routeChecks(
  job: CheckJob,
  runners: readonly Runner[],
  deps: CheckRoutingDeps,
  guard: (job: CheckJob) => Promise<string>,
): Promise<CheckResult> {
  const admittedJob = { ...job, command: await guard(job) }
  if (admittedJob.command.trim() === '') throw new Error(UI_TEXT.hookInputNoCommand)
  const admit = () => {
    admittedJob.signal.throwIfAborted()
    if (!deps.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
  }
  admit()
  const rank = (runner: Runner) => {
    const index = admittedJob.preferredRunners.indexOf(runner.id)
    return index === -1 ? admittedJob.preferredRunners.length : index
  }
  const candidates = runners
    .filter((runner) => {
      const platform = runner.os === 'win32' ? 'windows' : runner.os
      const label = `os:${platform === 'darwin' ? 'macos' : platform}`
      return (
        runner.commandClasses.includes(admittedJob.commandClass) &&
        admittedJob.labels.every((wanted) => {
          return wanted.startsWith('os:') ? wanted === label : runner.labels.includes(wanted)
        })
      )
    })
    .toSorted((a, b) => rank(a) - rank(b))
  const isResourceRouting = deps.resources?.isBusy(admittedJob.runId) === true
  const local = async () => {
    admit()
    if (admittedJob.labels.some((label) => !deps.localLabels.includes(label)))
      throw new Error(UI_TEXT.teamRunners.offline)
    const result = await deps.local(admittedJob)
    admit()
    if (result.runId !== admittedJob.runId) throw new Error(UI_TEXT.teamRunners.testFailed)
    return result
  }
  // Ordinary M96c runner routing, unchanged by the relocation binding: a
  // declined relocation runs exactly this, never straight to local.
  const ordinary = async () => {
    for (const runner of candidates) {
      admit()
      const health = await deps.sample(runner)
      admit()
      if (
        health === undefined ||
        !health.inputReady ||
        health.freeSlots === 0 ||
        health.load >= health.cores
      )
        continue
      const answer = await deps.remote(runner, admittedJob)
      admit()
      if (
        answer.kind === 'uncertain' ||
        (answer.kind === 'finished' && answer.result.runId !== admittedJob.runId)
      )
        throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
      if (answer.kind === 'finished') return answer.result
    }
    return await local()
  }
  if (isResourceRouting) {
    const result = await deps.resources.route(admittedJob, candidates, deps, local, ordinary)
    admit()
    return result
  }
  return await ordinary()
}
