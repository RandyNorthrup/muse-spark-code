import type { DeviceOffer } from '../../shared/devices'
import type {
  ResourceEvent,
  ResourceLevel,
  ResourceSettings,
  ResourceStatus,
} from '../../shared/resources'
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
  /** M100-R: the paired-device leg is bound; the relocator matches offers exactly. */
  hasDeviceOffer: () => boolean
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
  if (runner === undefined && !routing.hasDeviceOffer()) return
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
/** Why a receiver proved it admitted nothing: the same reason travels the dispatch, the refusal port and the notice. */
export type RunnerRefusalReason = 'commandTooLong' | 'executionPolicy'

/** A receiver that forbids scripts by policy answered and said so: the run reports the policy sentence, never offline. */
export class RunnerPolicyRefusedError extends Error {
  public constructor() {
    super(UI_TEXT.teamRunners.executionPolicy)
  }
}

/** The runner never answered: the run reports the offline sentence, never silent. */
export class RunnerOfflineError extends Error {
  public constructor() {
    super(UI_TEXT.teamRunners.offline)
  }
}

/** The runner answered wrong: a self-test, snapshot or protocol reply the runner does not recognise. */
export class RunnerTestFailedError extends Error {
  public constructor(options?: ErrorOptions) {
    super(UI_TEXT.teamRunners.testFailed, options)
  }
}

/** The receiver is not trusted: the run never reaches it. */
export class RunnerUntrustedError extends Error {
  public constructor() {
    super(UI_TEXT.teamRunners.trustNotice)
  }
}

/** A Windows transport command proved too long before anything was sent. */
export class WindowsCommandTooLongError extends Error {
  public constructor() {
    super(UI_TEXT.teamRunners.commandTooLong)
  }
}

/** The source observer's sentence for a proved receiver refusal, else the busy sentence. */
function refusalSentence(reason: RunnerRefusalReason | undefined): string {
  if (reason === 'commandTooLong') return UI_TEXT.teamRunners.commandTooLong
  return reason === 'executionPolicy'
    ? UI_TEXT.teamRunners.executionPolicy
    : UI_TEXT.teamRunners.busy
}

export type RunnerDispatch =
  | { readonly kind: 'finished'; readonly result: CheckResult }
  | {
      readonly kind: 'busy'
      /**
      A proved receiver refusal keeps its true reason instead of becoming
      a bare busy: the source can say why the receiver refused. The check
      still runs locally once.
      */
      readonly reason?: RunnerRefusalReason
    }
  | { readonly kind: 'offline' | 'uncertain' }

/**
A paired device's usable offer for a relocated check (M100-R): the
offer's lanes/checks cover the kind, the sender's repository path
matches the offer's repository, and the resource bucket is read after
the person approves the move. The dispatch itself is M100's own send,
bound by the caller; the router adds only the relocation metadata.
*/
export interface DeviceCheckLink {
  readonly pairId: string
  readonly label: string
  readonly offer: DeviceOffer
  /** The sender's local repository path this offer's repositoryId covers. */
  readonly repositoryPath: string
  /** The offer-status resource bucket; validated without acquiring offer authority. */
  readonly resource: () => Promise<unknown>
}

/** A paired-device send: admission, plus the finished check on admission. */
export type DeviceCheckSend =
  | { readonly admission: 'admitted'; readonly result: CheckResult }
  | { readonly admission: 'refused' | 'uncertain' }

/**
M100-R: whether the linked offer covers this repository and kind. Paths
match across separators, so a Windows sender and a POSIX offer agree.
*/
export function hasDeviceLinkOffer(
  link: Pick<DeviceCheckLink, 'offer' | 'repositoryPath'>,
  repository: string,
  kind: 'worker' | 'check',
): boolean {
  return (
    repository.replaceAll('\\', '/') === link.repositoryPath.replaceAll('\\', '/') &&
    ((kind === 'worker' && link.offer.lanes) || (kind === 'check' && link.offer.checks))
  )
}

export interface CheckRoutingDeps {
  readonly isTrusted: () => boolean
  readonly localLabels: readonly string[]
  /** Must sample immediately before dispatch, with a bounded transport timeout. */
  readonly sample: (runner: Runner) => Promise<RunnerHealth | undefined>
  readonly remote: (runner: Runner, job: CheckJob) => Promise<RunnerDispatch>
  readonly local: (job: CheckJob) => Promise<CheckResult>
  /** One binding per conversation, supplied by the existing runner/scheduler owner. */
  readonly resources?: ResourceRunnerRouter | undefined
  /**
  A proved receiver refusal on the ordinary route keeps its true reason
  for the source observer. Called at most once per item, only when every
  runner is exhausted and the check falls back to local.
  */
  readonly onRefusal?: ((reason: RunnerRefusalReason) => void) | undefined
}

export interface ResourceRunnerRouteOptions {
  readonly port: Pick<ResourceLaunchHost, 'status' | 'createRelocator'>
  readonly headless: boolean
  /** Only cached, user-approved routes; this must not discover or probe. */
  readonly hasTarget: () => boolean
  /** M100-R: the paired-device leg is bound and allowed for this binding. */
  readonly devicesEnabled: () => boolean
  /** M100-R: this work's linked offers; cached, approved offers only, never probed. */
  readonly deviceLinks: (work: ResourceRelocationWork) => readonly DeviceCheckLink[]
  readonly isHeavy: (job: CheckJob) => boolean
  readonly phase: (job: CheckJob) => 'queued' | 'running'
  /** Includes current attempt/tool, repository, snapshot and runner approval. */
  readonly isApproved: (runner: Runner, job: CheckJob) => boolean
  readonly claim: (job: CheckJob) => boolean
  readonly settle: (job: CheckJob, result: 'kept' | 'admitted' | 'uncertain') => void
  readonly ask: (job: CheckJob, runner: Runner, signal: AbortSignal) => Promise<boolean>
  /** M100-R: the Ask question for a paired-device move. */
  readonly deviceAsk: (
    job: CheckJob,
    link: DeviceCheckLink,
    signal: AbortSignal,
  ) => Promise<boolean>
  readonly row: (
    job: CheckJob,
    runner: Runner,
    metadata: NonNullable<CheckJob['relocation']>,
    keepHere: ResourceRelocationAttempt['keepHere'],
  ) => void
  /** M100-R: installs the task row with target and reason before returning. */
  readonly deviceRow: (
    job: CheckJob,
    link: DeviceCheckLink,
    metadata: NonNullable<CheckJob['relocation']>,
    keepHere: ResourceRelocationAttempt['keepHere'],
  ) => void
  readonly notice: (runner: Runner) => void
  /** M100-R: the once-per-conversation notice for a paired-device move. */
  readonly deviceNotice: (link: DeviceCheckLink) => void
  readonly traffic: (
    job: CheckJob,
    runner: Runner,
    event: Extract<ResourceEvent, { type: 'relocated' }>,
  ) => void
  /** M100-R: the Traffic record for a paired-device move. */
  readonly deviceTraffic: (
    job: CheckJob,
    link: DeviceCheckLink,
    event: Extract<ResourceEvent, { type: 'relocated' }>,
  ) => void
  /** M100-R: M100's own send of the relocated check. */
  readonly deviceSend: (
    job: CheckJob,
    link: DeviceCheckLink,
    metadata: NonNullable<CheckJob['relocation']>,
    signal: AbortSignal,
  ) => Promise<DeviceCheckSend>
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
      deviceTargets: readonly ResourceRelocationTarget[]
      attempt: ResourceRelocationAttempt
    }
  >()
  private readonly runners = new WeakMap<
    ResourceRelocationTarget,
    { runner: Runner; job: CheckJob }
  >()
  private readonly deviceBindings = new WeakMap<
    ResourceRelocationTarget,
    { link: DeviceCheckLink; job: CheckJob }
  >()
  private readonly active = new Map<string, Promise<CheckResult>>()
  private readonly cancel = new AbortController()

  constructor(
    private readonly options: ResourceRunnerRouteOptions,
    private readonly unregister?: () => void,
  ) {
    this.relocator = options.port.createRelocator({
      headless: options.headless,
      devicesEnabled: () => !this.cancel.signal.aborted && options.devicesEnabled(),
      devices: (work) => this.work.get(work)?.deviceTargets ?? [],
      runnersEnabled: () => !this.cancel.signal.aborted && options.hasTarget(),
      runners: (work) => this.work.get(work)?.targets ?? [],
      ask: async (work, target, signal) => {
        const item = this.work.get(work)
        if (item === undefined) return false
        const bound = this.deviceBindings.get(target)
        if (bound !== undefined) return await options.deviceAsk(bound.job, bound.link, signal)
        const context = this.runners.get(target)
        const runner = context?.runner
        return runner !== undefined && (await options.ask(item.job, runner, signal))
      },
      row: (work, target, metadata) => {
        const item = this.work.get(work)
        if (item === undefined) throw new Error(UI_TEXT.teamRunners.busy)
        const bound = this.deviceBindings.get(target)
        if (bound !== undefined) {
          options.deviceRow(
            bound.job,
            bound.link,
            metadata,
            async () => await item.attempt.keepHere(),
          )
          return
        }
        const context = this.runners.get(target)
        const runner = context?.runner
        if (runner === undefined) throw new Error(UI_TEXT.teamRunners.busy)
        options.row(item.job, runner, metadata, async () => await item.attempt.keepHere())
      },
      notice: (target) => {
        const bound = this.deviceBindings.get(target)
        if (bound !== undefined) {
          options.deviceNotice(bound.link)
          return
        }
        const context = this.runners.get(target)
        const runner = context?.runner
        if (runner !== undefined) options.notice(runner)
      },
      traffic: (target, event) => {
        const bound = this.deviceBindings.get(target)
        if (bound !== undefined) {
          options.deviceTraffic(bound.job, bound.link, event)
          return
        }
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
    if (status.level !== 'relocate' && status.level !== 'pause')
      // Pressure recovered after the busy decision: the route decision is
      // taken once from this snapshot, so the ordinary route runs. A check
      // whose labels live only on its runner still reaches it; pressure
      // recovery never fails a check Offline on a machine that is online.
      return DECLINED
    if (
      resourceRunnerPreference({
        level: status.level,
        relocation: status.settings.relocate,
        queued: this.options.phase(job) === 'queued',
        keepHere: false,
        approvedRunner: () => runners.find((runner) => this.options.isApproved(runner, job)),
        hasDeviceOffer: this.options.devicesEnabled,
      }) === undefined
    )
      // No approved runner or device leg: kept locally, no probes.
      return undefined
    const state: {
      completion?: Promise<RunnerDispatch>
      deviceCompletion?: Promise<RunnerDispatch>
      isClaimRefused: boolean
      /** A target proved busy (receiver refusal or no headroom); the check stays. */
      sawBusy: boolean
      /** The proved refusal reason when one said why; the hand-over reports its sentence. */
      refusedReason?: RunnerRefusalReason
      /** The busy reason already reached the source observer. */
      reportedBusy: boolean
    } = {
      isClaimRefused: false,
      sawBusy: false,
      reportedBusy: false,
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
          let health: RunnerHealth | undefined
          try {
            health = await deps.sample(runner)
          } catch (error: unknown) {
            // A proved policy refusal is a busy target that said why, not an
            // unreachable one: the check stays on the source with its sentence.
            if (error instanceof RunnerPolicyRefusedError) {
              state.sawBusy = true
              state.refusedReason ??= 'executionPolicy'
              return { level: 'pause' as const, headroom: 'none' as const }
            }
            throw error
          }
          const parsed = runnerHealthSchema.safeParse(health)
          if (!parsed.success) throw new RunnerOfflineError()
          const isReady =
            parsed.data.inputReady &&
            parsed.data.freeSlots > 0 &&
            parsed.data.load < parsed.data.cores
          // No headroom is a proved busy target, not an unreachable one:
          // remembered so the hand-over stays on the source and says why.
          if (!isReady) state.sawBusy = true
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
              state,
            )
          }),
      }
      this.runners.set(target, { runner, job })
      return target
    })
    // M100-R: one target per linked offer. The offer covers the kind, the
    // sender's repository path matches the offer's repository, and the
    // resource bucket is read only after the person approves the move.
    const deviceTargets = this.options.devicesEnabled()
      ? this.options.deviceLinks(work).map((link): ResourceRelocationTarget => {
          const target: ResourceRelocationTarget = {
            id: `${link.pairId}:${link.offer.deviceId}`,
            type: 'paired',
            hasOffer: (repository, kind) => hasDeviceLinkOffer(link, repository, kind),
            resource: link.resource,
            dispatch: async (metadata, relocationSignal) =>
              await new Promise<'admitted' | 'refused' | 'uncertain'>((resolve) => {
                state.deviceCompletion = this.dispatchDevice(
                  job,
                  link,
                  target,
                  metadata,
                  signal,
                  relocationSignal,
                  resolve,
                )
              }),
          }
          this.deviceBindings.set(target, { link, job })
          return target
        })
      : []
    const attempt = this.relocator.create(work)
    const keep = () => {
      void attempt.keepHere().catch(this.options.onError)
    }
    signal.addEventListener('abort', keep, { once: true })
    this.work.set(work, { job, targets, deviceTargets, attempt })
    try {
      const result = await attempt.run()
      if (state.isClaimRefused) throw new Error(UI_TEXT.teamRunners.busy)
      if (result === 'uncertain') throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
      if (result === 'kept') {
        signal.throwIfAborted()
        if (this.options.phase(job) !== 'queued') throw new Error(UI_TEXT.teamRunners.busy)
        return this.handOver(job, deps, status, state)
      }
      const answer = await (state.completion ?? state.deviceCompletion)
      if (answer?.kind !== 'finished' || answer.result.runId !== job.runId) {
        throw new Error(UI_TEXT.teamTrafficNotices.uncertainAttempt)
      }
      return answer.result
    } finally {
      signal.removeEventListener('abort', keep)
      this.work.delete(work)
    }
  }

  /**
  The hand-over under the decision snapshot: one synchronous step, so no
  later pressure change can strand a check. Awaits between the decision
  (`move`'s status read) and here, each already closed: the Ask answer and
  every headroom probe (the relocator re-reads status and phase before
  each), the row (the offer and level are rechecked right after it), and
  the dispatch (offer, setting and level rechecked before sending;
  admission wins over a late abort). This re-read closes the last window:
  a changed level or relocation setting runs the ordinary route, so a
  label-bound check reaches its runner instead of failing Offline on a
  machine that is online. An unchanged snapshot stays on the source and
  says why when a target proved busy.
  */
  private handOver(
    job: CheckJob,
    deps: CheckRoutingDeps,
    decided: Pick<ResourceStatus, 'level' | 'settings'>,
    state: { sawBusy: boolean; refusedReason?: RunnerRefusalReason; reportedBusy: boolean },
  ): typeof DECLINED | undefined {
    const current = this.options.port.status()
    if (
      current.level !== decided.level ||
      current.settings.relocate !== decided.settings.relocate ||
      current.settings.enabled !== decided.settings.enabled
    )
      return DECLINED
    if (state.sawBusy) {
      if (!state.reportedBusy) {
        this.options.onError(new Error(refusalSentence(state.refusedReason)))
        state.reportedBusy = true
      }
      // Local admission cannot take labels that live only on a runner, and
      // the runner just proved reachable: retry the ordinary route instead
      // of failing Offline for a busy machine.
      if (job.labels.some((label) => !deps.localLabels.includes(label))) return DECLINED
    }
    return undefined
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
    state: { sawBusy: boolean; reportedBusy: boolean },
  ): Promise<RunnerDispatch> {
    return await this.dispatchLeg(
      job,
      target,
      metadata,
      signal,
      relocationSignal,
      receipt,
      (error) => {
        // The length refusal is always pre-send: refused, reported, offline.
        if (error instanceof WindowsCommandTooLongError) return { kind: 'offline' } as const
        return
      },
      async (dispatchSignal, sendState, detach) => {
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
        // A target that became busy keeps the check on the source and says
        // why: the known refusal reason reaches the source observer while the
        // proved refusal still runs locally once. A reason-less busy (a full
        // receiver, a busy cache) reports the busy sentence itself.
        if (answer.kind === 'busy') {
          state.sawBusy = true
          this.options.onError(new Error(refusalSentence(answer.reason)))
          state.reportedBusy = true
        }
        return answer
      },
    )
  }

  /**
  The send skeleton both legs share: the withdrawal scope, the
  decision-snapshot recheck, the leg's send and the outcome mapping. A
  pressure or setting change before sending is a refusal, never an
  unreachable target: Offline is produced only by the transport. The
  leg maps its own thrown failures first; cancel reads refused before
  sending, uncertain after.
  */
  private async dispatchLeg(
    job: CheckJob,
    target: ResourceRelocationTarget,
    metadata: NonNullable<CheckJob['relocation']>,
    signal: AbortSignal,
    relocationSignal: AbortSignal,
    receipt: (result: 'admitted' | 'refused' | 'uncertain') => void,
    mapError: (error: unknown) => RunnerDispatch | undefined,
    send: (
      dispatchSignal: AbortSignal,
      sendState: { sent: boolean },
      detach: () => void,
    ) => Promise<RunnerDispatch>,
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
        return { kind: 'busy' }
      }
      return await send(dispatchSignal, sendState, detach)
    } catch (error: unknown) {
      receipt(sendState.sent ? 'uncertain' : 'refused')
      const mapped = mapError(error)
      if (mapped !== undefined) {
        this.options.onError(error)
        return mapped
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.options.onError(error)
        return { kind: sendState.sent ? 'uncertain' : 'offline' }
      }
      // The transport proves only the above by throw; anything else is not
      // a dispatch outcome.
      throw error
    } finally {
      detach()
    }
  }

  /**
  M100-R: the paired-device send. An admitted send carries the finished
  check: M100 owns the attempt from admission, so the result arrives
  with it, never inferred.
  */
  private async dispatchDevice(
    job: CheckJob,
    link: DeviceCheckLink,
    target: ResourceRelocationTarget,
    metadata: NonNullable<CheckJob['relocation']>,
    signal: AbortSignal,
    relocationSignal: AbortSignal,
    receipt: (result: 'admitted' | 'refused' | 'uncertain') => void,
  ): Promise<RunnerDispatch> {
    return await this.dispatchLeg(
      job,
      target,
      metadata,
      signal,
      relocationSignal,
      receipt,
      // The device send maps no error: anything it throws is not a
      // dispatch outcome, so dispatchLeg rethrows.
      () => {
        return
      },
      async (dispatchSignal, sendState) => {
        const answer = await this.options.deviceSend(job, link, metadata, dispatchSignal)
        sendState.sent = answer.admission !== 'refused'
        if (answer.admission === 'admitted') {
          receipt('admitted')
          job.onSent?.()
          job.onAdmitted?.()
          return { kind: 'finished', result: answer.result }
        }
        receipt(answer.admission)
        return { kind: answer.admission === 'refused' ? 'busy' : 'uncertain' }
      },
    )
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
    let refusedReason: RunnerRefusalReason | undefined
    for (const runner of candidates) {
      admit()
      let health: RunnerHealth | undefined
      try {
        health = await deps.sample(runner)
      } catch (error: unknown) {
        // A proved policy refusal keeps its reason while the loop moves on;
        // it is reported only when every runner is exhausted (below).
        if (error instanceof RunnerPolicyRefusedError) {
          refusedReason ??= 'executionPolicy'
          continue
        }
        throw error
      }
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
      // A proved receiver refusal keeps its true reason instead of being
      // dropped while the loop moves on; it is reported only when every
      // runner is exhausted and the check falls back to local.
      if (answer.kind === 'busy' && answer.reason !== undefined) refusedReason ??= answer.reason
    }
    if (refusedReason !== undefined) deps.onRefusal?.(refusedReason)
    return await local()
  }
  if (isResourceRouting) {
    const result = await deps.resources.route(admittedJob, candidates, deps, local, ordinary)
    admit()
    return result
  }
  return await ordinary()
}
