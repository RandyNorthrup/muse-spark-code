import * as z from 'zod/mini'
import {
  AGENT_SCHEDULE_MAX_DEPTH,
  AGENT_SCHEDULE_MIN_INTERVAL_MS,
  AGENT_SCHEDULES_MAX_ACTIVE,
  SCHEDULE_ID_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  scheduleDraftSchema,
  schedulePaidConsentSchema,
  scheduleV2Schema,
  scheduleViewV2Of,
  type ScheduleCreator,
  type ScheduleDraft,
  type ScheduleGrant,
  type ScheduleStoreV2,
  type ScheduleTarget,
  type ScheduleV2,
} from '../../shared/scheduleV2'
import type { McpTool } from '../mcp'
import type { FunctionToolDefinition } from '../backends/modelapi/schemas'
import { AgentScheduleNoEscalation } from './noEscalation'
import promptParameters from './agentPromptSchema.json'

export interface AgentScheduleAuthority {
  readonly creator: Extract<ScheduleCreator, { kind: 'agent' }>
  readonly workspaceKey: string
  readonly role: 'lead' | 'teamLead' | 'role' | 'worker' | 'nodeOrchestrator'
  readonly charterAllowsScheduling: boolean
  readonly execution: 'interactive' | 'unattended' | 'headless'
  readonly enabled: boolean
  readonly active: boolean
  readonly mode: ScheduleV2['mode']
  readonly grant: ScheduleGrant
  readonly paidCapUsd: number
  readonly depth: number
  readonly sourceScheduleId?: string
  /** Host-owned explicit user permission for this source schedule only.
   * A child's schema flag is never itself a new rescheduling permission. */
  readonly reschedulePermissionFor?: string
}

export type AgentSchedulePolicy = { readonly revision: number } & (
  { readonly choice: 'ask' | 'never' } | { readonly choice: 'always'; readonly paidCapUsd: number }
)
export type AgentScheduleRefusal =
  | 'unavailable'
  | 'charter'
  | 'expired'
  | 'depth'
  | 'target'
  | 'invalid'
  | 'never'
  | 'unattended'
  | 'count'
  | 'interval'
  | 'budget'
  | 'paidConsent'
  | 'changed'
  | 'missing'
type AgentScheduleResult =
  | { readonly outcome: 'refused'; readonly reason: AgentScheduleRefusal }
  | { readonly outcome: 'created'; readonly schedule: ReturnType<typeof scheduleViewV2Of> }
  | {
      readonly outcome: 'listed'
      readonly schedules: readonly ReturnType<typeof scheduleViewV2Of>[]
    }
  | { readonly outcome: 'cancelled'; readonly id: string }

/** S/U implement a durable cross-process transaction. Every agent admission,
 * policy edit, creator-cap allocation and pin/expiry mutation shares it.
 * commit atomically allocates out of the creator's remaining daily cap and
 * persists via store.create, or refuses without a record/allocation. Recheck
 * live authority, target and paid model/account/tier immediately before the
 * commit; failures retain their actual reason. Crash recovery retains
 * allocations for any committed schedule, including uncertain spent money. */
export interface AgentScheduleAdmission {
  readonly store: ScheduleStoreV2
  exclusive<T>(workspaceKey: string, operation: () => Promise<T>): Promise<T>
  policy(authority: AgentScheduleAuthority): Promise<AgentSchedulePolicy>
  /** CAS against policy.revision; increment only on a match. Never replace a
   * newer revocation or cap edit with an older open consent's decision. */
  remember(authority: AgentScheduleAuthority, policy: AgentSchedulePolicy): Promise<boolean>
  commit(
    schedule: ScheduleV2,
    authority: AgentScheduleAuthority,
    signal: AbortSignal,
  ): Promise<
    | { readonly committed: true }
    | { readonly committed: false; readonly reason: AgentScheduleRefusal }
  >
}

export interface AgentScheduleToolsDeps {
  readonly admission: AgentScheduleAdmission
  /** Re-read the authenticated caller's host identity, charter, permissions
   * and lifetime. Bind to its session, never the currently visible panel. */
  authority(): Promise<AgentScheduleAuthority>
  canTarget(authority: AgentScheduleAuthority, target: ScheduleTarget): Promise<boolean>
  /** U applies mode, canonical paths, protected paths and hard denials before intersection. */
  effectiveGrant(authority: AgentScheduleAuthority): Promise<ScheduleGrant>
  /** T proves the minimum occurrence spacing, E's event coalescing included.
   * undefined means unavailable/unprovable; Never substitute a guessed floor. */
  minimumSpacing(draft: ScheduleDraft): Promise<number | undefined>
  consent(
    request: {
      readonly authority: AgentScheduleAuthority
      readonly draft: ScheduleDraft
      readonly message: string
      readonly always: string
      readonly never: string
    },
    signal: AbortSignal,
  ): Promise<'allow' | 'never' | { readonly alwaysPaidCapUsd: number }>
  /** U uses D48, price/shared budget and schedule scope; no popup unattended.
   * commit revalidates model/account/tier and reserves against D78 as well. */
  paidConsent(
    draft: ScheduleDraft,
    authority: AgentScheduleAuthority,
    signal: AbortSignal,
  ): Promise<ScheduleV2['paidConsent']>
  ownerActive(creator: Extract<ScheduleCreator, { kind: 'agent' }>): Promise<boolean>
  transcript(row: {
    readonly creator: AgentScheduleAuthority['creator']
    readonly outcome: 'created' | 'refused' | 'expired'
    readonly reason?: AgentScheduleRefusal
    readonly scheduleId?: string
    readonly text?: string
  }): void
  now(): number
  /** W supplies SCHEDULE_AGENT_MODEL_TEXT from its guarded lazy bundle. */
  readonly descriptions: { readonly prompt: string; readonly list: string; readonly cancel: string }
}

const promptArgs = z.strictObject({ draft: scheduleDraftSchema })
const listArgs = z.strictObject({})
const cancelArgs = z.strictObject({
  id: z
    .string()
    .check(z.minLength(1), z.maxLength(SCHEDULE_ID_MAX_CHARS), z.regex(/^[\w-][\w.-]*$/)),
})

function eligibility(authority: AgentScheduleAuthority): AgentScheduleRefusal | undefined {
  if (!authority.enabled || authority.execution === 'headless') return 'unavailable'
  if (!authority.active) return 'expired'
  return (authority.role === 'worker' || authority.role === 'role') &&
    !authority.charterAllowsScheduling
    ? 'charter'
    : undefined
}

function isOwned(schedule: ScheduleV2, authority: AgentScheduleAuthority): boolean {
  return (
    schedule.creator.kind === 'agent' &&
    schedule.creator.orchestratorId === authority.creator.orchestratorId &&
    schedule.creator.sessionId === authority.creator.sessionId &&
    schedule.creator.teamId === authority.creator.teamId
  )
}

function hasEnded(schedule: ScheduleV2, now: number): boolean {
  return (
    (schedule.end?.atMs !== undefined && schedule.end.atMs <= now) ||
    (schedule.end?.afterRuns !== undefined && schedule.fireCount >= schedule.end.afterRuns) ||
    (schedule.trigger.kind === 'once' && schedule.fireCount > 0)
  )
}

/** Both transports call this one admission path. Model arguments never supply
 * identity, consent, pinning, permission mode or rescheduling authority. */
export class AgentScheduleTools {
  private readonly intersection = new AgentScheduleNoEscalation()
  public constructor(private readonly deps: AgentScheduleToolsDeps) {}

  private refuse(
    authority: AgentScheduleAuthority,
    reason: AgentScheduleRefusal,
  ): AgentScheduleResult {
    this.deps.transcript({
      creator: authority.creator,
      outcome: 'refused',
      reason,
      text: `${UI_TEXT.scheduleV2.outcomes.refused}: ${reason}`,
    })
    return { outcome: 'refused', reason }
  }

  private sameOwner(before: AgentScheduleAuthority, after: AgentScheduleAuthority): boolean {
    return (
      before.workspaceKey === after.workspaceKey &&
      JSON.stringify(before.creator) === JSON.stringify(after.creator)
    )
  }

  private async create(
    draft: ScheduleDraft,
    initial: AgentScheduleAuthority,
    signal: AbortSignal,
  ): Promise<AgentScheduleResult> {
    const depth = initial.depth + 1
    const hasDepthPermission =
      initial.sourceScheduleId !== undefined &&
      initial.reschedulePermissionFor === initial.sourceScheduleId
    if (!hasDepthPermission && depth > AGENT_SCHEDULE_MAX_DEPTH)
      return this.refuse(initial, 'depth')
    if (!(await this.deps.canTarget(initial, draft.target))) return this.refuse(initial, 'target')
    const initialGrant = this.intersection.bounded(
      draft.grant,
      await this.deps.effectiveGrant(initial),
    )
    draft = {
      ...draft,
      mode: initial.mode,
      grant: initialGrant,
      paidCapUsd: Math.min(draft.paidCapUsd, initialGrant.paidCapUsd, initial.paidCapUsd),
    }
    const policy = await this.deps.admission.policy(initial)
    if (policy.choice === 'never') return this.refuse(initial, 'never')
    let acceptedPolicy = policy
    if (policy.choice === 'ask') {
      if (initial.execution !== 'interactive') return this.refuse(initial, 'unattended')
      const decision = await this.deps.consent(
        {
          authority: initial,
          draft,
          message: fill(UI_TEXT.scheduleV2.messages.agentConsent, {
            agent: initial.creator.agentId,
          }),
          always: UI_TEXT.scheduleV2.messages.agentAlways,
          never: UI_TEXT.scheduleV2.messages.agentNever,
        },
        signal,
      )
      signal.throwIfAborted()
      if (decision === 'never') acceptedPolicy = { choice: 'never', revision: policy.revision }
      else if (decision !== 'allow')
        acceptedPolicy = {
          choice: 'always',
          paidCapUsd: decision.alwaysPaidCapUsd,
          revision: policy.revision,
        }
    }
    const paidConsent =
      draft.paidCapUsd === 0 || acceptedPolicy.choice === 'never'
        ? undefined
        : await this.deps.paidConsent(draft, initial, signal)
    return await this.deps.admission.exclusive(initial.workspaceKey, async () => {
      signal.throwIfAborted()
      const authority = await this.deps.authority()
      if (!this.sameOwner(initial, authority)) return this.refuse(authority, 'changed')
      const blocked = eligibility(authority)
      if (blocked !== undefined) return this.refuse(authority, blocked)
      const latestPolicy = await this.deps.admission.policy(authority)
      if (latestPolicy.choice === 'never') return this.refuse(authority, 'never')
      if (latestPolicy.revision !== policy.revision) return this.refuse(authority, 'changed')
      if (
        acceptedPolicy.choice === 'always' &&
        (!Number.isFinite(acceptedPolicy.paidCapUsd) || acceptedPolicy.paidCapUsd < 0)
      )
        return this.refuse(authority, 'budget')
      if (
        policy.choice === 'ask' &&
        acceptedPolicy.choice !== 'ask' &&
        !(await this.deps.admission.remember(authority, acceptedPolicy))
      )
        return this.refuse(authority, 'changed')
      if (acceptedPolicy.choice === 'never') return this.refuse(authority, 'never')
      const limits = latestPolicy.choice === 'always' ? latestPolicy : acceptedPolicy
      const depth = authority.depth + 1
      const isExplicitDepth =
        authority.sourceScheduleId !== undefined &&
        authority.reschedulePermissionFor === authority.sourceScheduleId
      if (!isExplicitDepth && depth > AGENT_SCHEDULE_MAX_DEPTH)
        return this.refuse(authority, 'depth')
      if (!(await this.deps.canTarget(authority, draft.target)))
        return this.refuse(authority, 'target')
      const jobs = await this.deps.admission.store.list(authority.workspaceKey)
      const schedules = jobs.map((job) => scheduleV2Schema.parse(job))
      const siblings = schedules.filter(
        (job) =>
          job.creator.kind === 'agent' &&
          job.creator.orchestratorId === authority.creator.orchestratorId,
      )
      if (limits.choice === 'always') {
        // Paused jobs retain authority and can resume; count them too.
        if (
          siblings.filter((job) => !hasEnded(job, this.deps.now())).length >=
          AGENT_SCHEDULES_MAX_ACTIVE
        )
          return this.refuse(authority, 'count')
        const spacing = await this.deps.minimumSpacing(draft)
        if (
          spacing === undefined ||
          !Number.isFinite(spacing) ||
          spacing < AGENT_SCHEDULE_MIN_INTERVAL_MS
        )
          return this.refuse(authority, 'interval')
        if (
          !Number.isFinite(limits.paidCapUsd) ||
          limits.paidCapUsd < 0 ||
          siblings.reduce((sum, job) => sum + job.paidCapUsd, draft.paidCapUsd) > limits.paidCapUsd
        )
          return this.refuse(authority, 'budget')
      }
      const grant = this.intersection.bounded(
        draft.grant,
        await this.deps.effectiveGrant(authority),
      )
      const paidCapUsd = Math.min(draft.paidCapUsd, grant.paidCapUsd, authority.paidCapUsd)
      if (paidCapUsd < 0 || !Number.isFinite(paidCapUsd)) return this.refuse(authority, 'budget')
      if (paidConsent === undefined && paidCapUsd > 0) return this.refuse(authority, 'paidConsent')
      const now = this.deps.now()
      const schedule = scheduleV2Schema.safeParse({
        ...draft,
        version: 2,
        revision: 0,
        id: globalThis.crypto.randomUUID(),
        workspaceKey: authority.workspaceKey,
        mode: authority.mode,
        grant: { ...grant, paidCapUsd },
        paidCapUsd,
        paidConsent:
          paidConsent === undefined ? undefined : schedulePaidConsentSchema.parse(paidConsent),
        creator: authority.creator,
        depth,
        allowAgentReschedule: depth > AGENT_SCHEDULE_MAX_DEPTH && isExplicitDepth,
        pinned: false,
        paused: false,
        createdAtMs: now,
        updatedAtMs: now,
        fireCount: 0,
        consecutiveFailures: 0,
      })
      if (!schedule.success) return this.refuse(authority, 'changed')
      signal.throwIfAborted()
      const result = await this.deps.admission.commit(schedule.data, authority, signal)
      if (!result.committed) return this.refuse(authority, result.reason)
      this.deps.transcript({
        creator: authority.creator,
        outcome: 'created',
        scheduleId: schedule.data.id,
        text: fill(UI_TEXT.scheduleV2.messages.setBy, {
          agent: authority.creator.agentId,
          session: authority.creator.sessionId,
        }),
      })
      return { outcome: 'created', schedule: scheduleViewV2Of(schedule.data) }
    })
  }

  public async definitions(): Promise<readonly FunctionToolDefinition[]> {
    const authority = await this.deps.authority()
    if (eligibility(authority) !== undefined) return []
    // Our interface, not a guessed Muse Code wire shape. The strict Zod
    // boundary is authoritative, including nested trigger/grant validation.
    return [
      {
        type: 'function',
        name: 'schedule_prompt',
        description: this.deps.descriptions.prompt,
        parameters: structuredClone(promptParameters),
        strict: false,
      },
      {
        type: 'function',
        name: 'schedule_list',
        description: this.deps.descriptions.list,
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        strict: false,
      },
      {
        type: 'function',
        name: 'schedule_cancel',
        description: this.deps.descriptions.cancel,
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
          additionalProperties: false,
        },
        strict: false,
      },
    ]
  }

  public async mcpTools(): Promise<readonly McpTool[]> {
    const definitions = await this.definitions()
    return definitions.map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.parameters,
      annotations: { readOnlyHint: definition.name === 'schedule_list', openWorldHint: false },
      call: async (args, signal) => JSON.stringify(await this.call(definition.name, args, signal)),
    }))
  }

  public async call(
    name: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<AgentScheduleResult> {
    signal.throwIfAborted()
    const authority = await this.deps.authority()
    const refusal = eligibility(authority)
    if (refusal !== undefined) return this.refuse(authority, refusal)
    if (name === 'schedule_prompt') {
      const args = promptArgs.safeParse(input)
      return !args.success || args.data.draft.action.kind !== 'prompt' || args.data.draft.pinned
        ? this.refuse(authority, 'invalid')
        : await this.create(args.data.draft, authority, signal)
    }
    const cancel = name === 'schedule_cancel' ? cancelArgs.safeParse(input) : undefined
    if (name === 'schedule_list' ? !listArgs.safeParse(input).success : !cancel?.success)
      return this.refuse(authority, 'invalid')
    const id = cancel?.success ? cancel.data.id : undefined
    return await this.deps.admission.exclusive(authority.workspaceKey, async () => {
      signal.throwIfAborted()
      const current = await this.deps.authority()
      if (!this.sameOwner(authority, current)) return this.refuse(current, 'changed')
      const blocked = eligibility(current)
      if (blocked !== undefined) return this.refuse(current, blocked)
      const jobs = await this.deps.admission.store.list(current.workspaceKey)
      const schedules = jobs
        .map((job) => scheduleV2Schema.parse(job))
        .filter((job) => isOwned(job, current))
      if (id === undefined)
        return { outcome: 'listed', schedules: schedules.map((job) => scheduleViewV2Of(job)) }
      if (schedules.every((job) => job.id !== id)) return this.refuse(current, 'missing')
      signal.throwIfAborted()
      return (await this.deps.admission.store.remove(current.workspaceKey, id))
        ? { outcome: 'cancelled', id }
        : this.refuse(current, 'missing')
    })
  }

  /** S invokes this before due admission, and on session/team disposal.
   * The shared transaction also covers user pinning: no remove-after-pin race. */
  public async expire(workspaceKey: string): Promise<readonly string[]> {
    return await this.deps.admission.exclusive(workspaceKey, async () => {
      const expired: string[] = []
      const jobs = await this.deps.admission.store.list(workspaceKey)
      for (const raw of jobs) {
        const schedule = scheduleV2Schema.parse(raw)
        if (
          schedule.creator.kind !== 'agent' ||
          schedule.pinned ||
          (await this.deps.ownerActive(schedule.creator)) ||
          !(await this.deps.admission.store.remove(workspaceKey, schedule.id))
        ) {
          continue
        }

        expired.push(schedule.id)
        this.deps.transcript({
          creator: schedule.creator,
          outcome: 'expired',
          scheduleId: schedule.id,
          text: UI_TEXT.scheduleV2.messages.expiredOwner,
        })
      }
      return expired
    })
  }
}
