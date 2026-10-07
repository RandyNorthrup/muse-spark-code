import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import {
  AgentScheduleTools,
  type AgentScheduleAdmission,
  type AgentScheduleAuthority,
  type AgentSchedulePolicy,
  type AgentScheduleToolsDeps,
} from '../../src/core/schedules/agentTools'
import { handleMcpMessage } from '../../src/core/mcp'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'
import {
  AGENT_SCHEDULE_MIN_INTERVAL_MS,
  AGENT_SCHEDULES_MAX_ACTIVE,
} from '../../src/shared/constants'
import {
  scheduleDraftSchema,
  type ScheduleDraft,
  type ScheduleFireRecord,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { fakeSchedule } from './helpers/schedules/fixtures'
import { FakeScheduleDisk } from './helpers/schedules/store'
import promptParameters from '../../src/core/schedules/agentPromptSchema.json'

const signal = new AbortController().signal
const now = fakeSchedule().createdAtMs
const grant = {
  rules: [{ id: 'read', kind: 'tool', name: 'read_file' }],
  destinationIds: [],
  paidCapUsd: 2,
} satisfies ScheduleV2['grant']
const draftKeys = [
  'name',
  'action',
  'trigger',
  'target',
  'delivery',
  'whenClosed',
  'catchUp',
  'mode',
  'grant',
  'paidCapUsd',
  'parallel',
  'zone',
  'end',
  'pinned',
] as const
function draft(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  const schedule = fakeSchedule()
  return scheduleDraftSchema.parse({
    ...Object.fromEntries(
      draftKeys.filter((key) => schedule[key] !== undefined).map((key) => [key, schedule[key]]),
    ),
    grant,
    trigger: { kind: 'interval', everyMs: AGENT_SCHEDULE_MIN_INTERVAL_MS, anchorMs: now },
    ...overrides,
  })
}
function consentFor(dailyCapUsd: number): NonNullable<ScheduleV2['paidConsent']> {
  return {
    modelId: 'muse-spark-1.3',
    accountId: 'digest-not-a-key',
    priceTier: 'contributor',
    grantedAtMs: now,
    dailyCapUsd,
    sharedDailyBudgetUsd: 2,
    extras: [],
  }
}
function harness() {
  const disk = new FakeScheduleDisk()
  const store = disk.client()
  let clock = now
  const dailyLedger = new Map<
    string,
    { readonly settledUsd: number; readonly uncertainUsd: number }
  >()
  let authority: AgentScheduleAuthority = {
    creator: {
      kind: 'agent',
      agentId: 'lead-1',
      sessionId: 'session-1',
      orchestratorId: 'orchestrator-1',
    },
    workspaceKey: 'workspace-1',
    role: 'lead',
    charterAllowsScheduling: false,
    execution: 'interactive',
    enabled: true,
    active: true,
    mode: 'manual',
    grant,
    paidCapUsd: 2,
    depth: 0,
  }
  let policy: AgentSchedulePolicy = { choice: 'ask', revision: 0 }
  let serial: Promise<undefined> = Promise.resolve(undefined)
  const admission: AgentScheduleAdmission = {
    store,
    exclusive: async (_workspace, operation) => {
      const previous = serial
      const next = Promise.withResolvers<undefined>()
      serial = next.promise
      try {
        await previous
        return await operation()
      } finally {
        next.resolve(undefined)
      }
    },
    policy: () => Promise.resolve(policy),
    dailyUsage: vi.fn<AgentScheduleAdmission['dailyUsage']>((_authority, atMs) =>
      Promise.resolve(
        dailyLedger.get(new Date(atMs).toDateString()) ?? { settledUsd: 0, uncertainUsd: 0 },
      ),
    ),
    remember: (_authority, decision) => {
      if (policy.revision !== decision.revision) return Promise.resolve(false)
      policy = { ...decision, revision: policy.revision + 1 }
      return Promise.resolve(true)
    },
    commit: async (schedule, creator, currentSignal) => {
      currentSignal.throwIfAborted()
      const committed = await store.list(creator.workspaceKey)
      const allocated = committed
        .filter(
          (job) => job.creator.kind === 'agent' && job.creator.agentId === creator.creator.agentId,
        )
        .reduce((sum, job) => sum + job.paidCapUsd, 0)
      if (allocated + schedule.paidCapUsd > creator.paidCapUsd)
        return { committed: false, reason: 'budget' }
      await store.create(schedule)
      return { committed: true }
    },
  }
  const deps: AgentScheduleToolsDeps = {
    admission,
    authority: () => Promise.resolve(structuredClone(authority)),
    canTarget: vi.fn(() => Promise.resolve(true)),
    effectiveGrant: vi.fn<AgentScheduleToolsDeps['effectiveGrant']>((creator) =>
      Promise.resolve(creator.grant),
    ),
    minimumSpacing: vi.fn<AgentScheduleToolsDeps['minimumSpacing']>((request) =>
      Promise.resolve(
        request.trigger.kind === 'interval'
          ? request.trigger.everyMs
          : AGENT_SCHEDULE_MIN_INTERVAL_MS,
      ),
    ),
    consent: vi.fn<AgentScheduleToolsDeps['consent']>(() => Promise.resolve('allow')),
    paidConsent: vi.fn<AgentScheduleToolsDeps['paidConsent']>((request) =>
      Promise.resolve(consentFor(request.paidCapUsd)),
    ),
    ownerActive: vi.fn(() => Promise.resolve(false)),
    transcript: vi.fn(),
    now: () => clock,
    descriptions: {
      prompt:
        'Create an unattended prompt schedule with a draft: name, prompt action, trigger, target, delivery, whenClosed, catchUp, mode, grant, paidCapUsd, parallel, zone, optional end and pinned:false. Host permission mode and grant intersection apply.',
      list: 'List schedules created by your orchestrator in this session or team.',
      cancel: 'Cancel one of your orchestrator’s schedules by id.',
    },
  }
  const tools = new AgentScheduleTools(deps)
  return {
    deps,
    tools,
    store,
    setNow: (atMs: number) => {
      clock = atMs
    },
    setDailyUsage: (
      atMs: number,
      usage: { readonly settledUsd: number; readonly uncertainUsd: number },
    ) => {
      dailyLedger.set(new Date(atMs).toDateString(), usage)
    },
    setAuthority: (change: Partial<AgentScheduleAuthority>) => {
      authority = { ...authority, ...change }
    },
    setPolicy: (
      change:
        | { readonly choice: 'ask' | 'never' }
        | { readonly choice: 'always'; readonly paidCapUsd: number },
    ) => {
      policy = { ...change, revision: policy.revision + 1 }
    },
    create: (request = draft(), currentSignal = signal) =>
      tools.call('schedule_prompt', { draft: request }, currentSignal),
  }
}

describe('agent scheduling admission', () => {
  it('intersects the effective creator grant and paid cap before asking for consent', async () => {
    const h = harness()
    h.setAuthority({ paidCapUsd: 1 })
    vi.mocked(h.deps.effectiveGrant).mockResolvedValue({
      rules: [],
      destinationIds: [],
      paidCapUsd: 1,
    })
    const created = await h.create(draft({ paidCapUsd: 2 }))
    expect(created.outcome).toBe('created')
    if (created.outcome !== 'created') throw new Error('Expected bounded creation')
    expect(created.schedule).toMatchObject({ paidCapUsd: 1, grant: { rules: [], paidCapUsd: 1 } })
    expect(h.deps.paidConsent).toHaveBeenCalledWith(
      expect.objectContaining({ paidCapUsd: 1 }),
      expect.objectContaining({ paidCapUsd: 1 }),
      signal,
    )
  })
  it('creates, lists and cancels with host creator attribution and no leaked paid identity', async () => {
    const h = harness()
    const created = await h.create(draft({ mode: 'auto', paidCapUsd: 1 }))
    expect(created.outcome).toBe('created')
    if (created.outcome !== 'created') throw new Error('Expected creation')
    expect(created.schedule).toMatchObject({
      creator: { agentId: 'lead-1', sessionId: 'session-1' },
      depth: 1,
      mode: 'manual',
      pinned: false,
      allowAgentReschedule: false,
    })
    expect(created.schedule).not.toHaveProperty('paidConsent')
    expect(h.deps.transcript).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Set by lead-1 in session-1' }),
    )
    expect(await h.tools.call('schedule_list', {}, signal)).toEqual({
      outcome: 'listed',
      schedules: [created.schedule],
    })
    expect(await h.tools.call('schedule_cancel', { id: created.schedule.id }, signal)).toEqual({
      outcome: 'cancelled',
      id: created.schedule.id,
    })
    expect(await h.tools.call('schedule_list', {}, signal)).toEqual({
      outcome: 'listed',
      schedules: [],
    })
  })

  it.each(['role', 'worker'] as const)(
    'refuses %s without its charter, then offers it with permission',
    async (role) => {
      const h = harness()
      h.setAuthority({ role })
      expect(await h.tools.definitions()).toEqual([])
      expect(await h.create()).toEqual({ outcome: 'refused', reason: 'charter' })
      expect(h.deps.consent).not.toHaveBeenCalled()
      h.setAuthority({ charterAllowsScheduling: true })
      expect(await h.tools.definitions()).toHaveLength(3)
      expect(await h.create()).toMatchObject({ outcome: 'created' })
    },
  )

  it.each(['lead', 'teamLead', 'nodeOrchestrator'] as const)(
    'offers tools to a %s',
    async (role) => {
      const h = harness()
      h.setAuthority({ role })
      expect(await h.tools.mcpTools()).toHaveLength(3)
    },
  )

  it('refuses disabled, expired and headless callers even with stale tool declarations', async () => {
    for (const change of [
      { enabled: false },
      { active: false },
      { execution: 'headless' as const },
    ]) {
      const h = harness()
      h.setAuthority(change)
      expect(await h.tools.definitions()).toEqual([])
      expect(await h.create()).toMatchObject({ outcome: 'refused' })
      expect(h.deps.transcript).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'refused' }),
      )
      expect(await h.store.list('workspace-1')).toEqual([])
    }
  })

  it('strictly validates arguments, refuses pinning and reports, and never accepts model authority', async () => {
    const h = harness()
    for (const input of [
      null,
      { draft: draft(), creator: 'forged' },
      { draft: { ...draft(), creator: { kind: 'user' } } },
      { draft: { ...draft(), allowAgentReschedule: true } },
      {
        draft: {
          ...draft(),
          grant: {
            ...grant,
            rules: [{ id: 'escape', kind: 'path', glob: '../**', access: 'edit' }],
          },
        },
      },
      { draft: { ...draft(), pinned: true } },
      {
        draft: {
          ...draft(),
          action: {
            kind: 'report',
            reportKind: 'status',
            args: {},
            format: 'text',
            destinations: [
              { id: 'browser', kind: 'browser', location: 'local', whenInactive: 'wait' },
            ],
          },
          grant: { ...grant, paidCapUsd: 0 },
        },
      },
    ]) {
      expect(await h.tools.call('schedule_prompt', input, signal)).toEqual({
        outcome: 'refused',
        reason: 'invalid',
      })
    }
    for (const [name, input] of [
      ['schedule_list', { workspaceKey: 'other' }],
      ['schedule_cancel', { id: '../../other' }],
      ['schedule_other', {}],
    ] as const)
      expect(await h.tools.call(name, input, signal)).toEqual({
        outcome: 'refused',
        reason: 'invalid',
      })
    expect(h.deps.consent).not.toHaveBeenCalled()
  })

  it('uses Ask once per schedule with runtime-localized choices, and remembers Never', async () => {
    const h = harness()
    await h.create()
    await h.create()
    expect(h.deps.consent).toHaveBeenCalledTimes(2)
    expect(h.deps.consent).toHaveBeenCalledWith(
      expect.objectContaining({
        always: 'Always for this orchestrator',
        never: 'Never for this orchestrator',
      }),
      signal,
    )
    vi.mocked(h.deps.consent).mockResolvedValue('never')
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'never' })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'never' })
    expect(h.deps.consent).toHaveBeenCalledTimes(3)
  })

  it('refuses Ask immediately unattended with a transcript row and no human prompt', async () => {
    const h = harness()
    h.setAuthority({ execution: 'unattended' })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'unattended' })
    expect(h.deps.consent).not.toHaveBeenCalled()
    expect(h.deps.paidConsent).not.toHaveBeenCalled()
    expect(h.deps.transcript).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'unattended' }),
    )
    h.setPolicy({ choice: 'always', paidCapUsd: 0 })
    expect(await h.create()).toMatchObject({ outcome: 'created' })
  })

  it('remembers Always within caps and shares admission across concurrent tool instances', async () => {
    const h = harness()
    vi.mocked(h.deps.consent).mockResolvedValue({ alwaysPaidCapUsd: 2 })
    await h.create()
    expect(h.deps.admission.policy).toBeDefined()
    await new AgentScheduleTools(h.deps).call('schedule_prompt', { draft: draft() }, signal)
    expect(h.deps.consent).toHaveBeenCalledTimes(1)
    h.setPolicy({ choice: 'always', paidCapUsd: 2 })
    const outcomes = await Promise.all(
      Array.from({ length: AGENT_SCHEDULES_MAX_ACTIVE }, () =>
        new AgentScheduleTools(h.deps).call('schedule_prompt', { draft: draft() }, signal),
      ),
    )
    expect(outcomes.filter((result) => result.outcome === 'created')).toHaveLength(
      AGENT_SCHEDULES_MAX_ACTIVE - 2,
    )
    expect(outcomes.filter((result) => result.outcome === 'refused')).toHaveLength(2)
    expect(await h.store.list('workspace-1')).toHaveLength(AGENT_SCHEDULES_MAX_ACTIVE)
  })

  it('counts paused schedules against Always rather than allowing later resumption to exceed caps', async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 0 })
    for (let index = 0; index < AGENT_SCHEDULES_MAX_ACTIVE; index++) {
      await h.store.create(
        fakeSchedule({
          id: `paused-${String(index)}`,
          paused: true,
          creator: {
            kind: 'agent',
            agentId: 'lead-1',
            sessionId: 'session-1',
            orchestratorId: 'orchestrator-1',
          },
        }),
      )
    }
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'count' })
  })

  it('enforces the interval floor and refuses unavailable proofs for event and custom kinds', async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 0 })
    expect(
      await h.create(
        draft({
          trigger: { kind: 'interval', everyMs: AGENT_SCHEDULE_MIN_INTERVAL_MS - 1, anchorMs: now },
        }),
      ),
    ).toEqual({ outcome: 'refused', reason: 'interval' })
    vi.mocked(h.deps.minimumSpacing).mockResolvedValue(undefined)
    for (const trigger of [
      { kind: 'cron', expression: '* * * * *' },
      { kind: 'event', source: 'manual', event: 'manual', conditions: [] },
    ] satisfies ScheduleDraft['trigger'][]) {
      expect(await h.create(draft({ trigger: structuredClone(trigger) }))).toEqual({
        outcome: 'refused',
        reason: 'interval',
      })
    }
    vi.mocked(h.deps.minimumSpacing).mockResolvedValue(AGENT_SCHEDULE_MIN_INTERVAL_MS)
    expect(await h.create()).toMatchObject({ outcome: 'created' })
    for (const value of [NaN, Infinity]) {
      vi.mocked(h.deps.minimumSpacing).mockResolvedValue(value)
      expect(await h.create()).toEqual({ outcome: 'refused', reason: 'interval' })
    }
  })

  it.each([
    { end: { atMs: now } },
    { end: { afterRuns: 1 }, fireCount: 1, trigger: draft().trigger },
    { fireCount: 1 },
  ] satisfies Partial<ScheduleV2>[])(
    'releases active slots after end condition %#, keeping paid liability',
    async (ending) => {
      const h = harness()
      h.setPolicy({ choice: 'always', paidCapUsd: 0 })
      const authority = await h.deps.authority()
      for (let index = 0; index < AGENT_SCHEDULES_MAX_ACTIVE; index++) {
        await h.store.create(
          fakeSchedule({
            id: `ended-${String(index)}`,
            creator: authority.creator,
            ...ending,
          }),
        )
      }
      expect(await h.create()).toMatchObject({ outcome: 'created' })
      h.setPolicy({ choice: 'always', paidCapUsd: 1 })
      await h.store.create(
        fakeSchedule({
          id: 'paid-ended',
          creator: authority.creator,
          end: { atMs: now },
          paidCapUsd: 1,
          grant,
        }),
      )
      h.setDailyUsage(now, { settledUsd: 0, uncertainUsd: 1 })
      expect(await h.create(draft({ paidCapUsd: 1 }))).toEqual({
        outcome: 'refused',
        reason: 'budget',
      })
    },
  )

  it('recovers Always allowance two local days after an exact ended settlement', async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 1 })
    const authority = await h.deps.authority()
    const ended = fakeSchedule({
      id: 'paid-ended',
      creator: authority.creator,
      end: { afterRuns: 1 },
      fireCount: 1,
      trigger: draft().trigger,
      paidCapUsd: 1,
      grant,
    })
    await h.store.create(ended)
    const fire = {
      runId: `${ended.id}:${String(now)}`,
      scheduleId: ended.id,
      workspaceKey: ended.workspaceKey,
      occurrenceMs: now,
      observedAtMs: now,
      target: ended.target,
      delivery: ended.delivery,
      outcome: 'ran',
      refusedActions: [],
      cost: { usd: 0.1, certainty: 'exact', retainedLiabilityUsd: 0 },
    } satisfies ScheduleFireRecord
    await h.store.record(fire)
    h.setDailyUsage(now, {
      settledUsd: fire.cost.usd,
      uncertainUsd: fire.cost.retainedLiabilityUsd,
    })
    const later = new Date(now)
    later.setDate(later.getDate() + 2)
    h.setNow(later.getTime())
    const commit = vi.spyOn(h.deps.admission, 'commit')
    expect(await h.create(draft({ paidCapUsd: 1 }))).toMatchObject({ outcome: 'created' })
    expect(h.deps.admission.dailyUsage).toHaveBeenCalledWith(authority, later.getTime())
    expect(commit).toHaveBeenCalledOnce()
    expect(await h.store.fires(authority.workspaceKey)).toEqual([fire])
    expect(await h.store.list(authority.workspaceKey)).toContainEqual(ended)
  })

  it("counts only an ended schedule's same-day settled spend in Always allowance", async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 1 })
    const authority = await h.deps.authority()
    await h.store.create(
      fakeSchedule({
        creator: authority.creator,
        end: { atMs: now },
        paidCapUsd: 1,
        grant,
      }),
    )
    h.setDailyUsage(now, { settledUsd: 0.1, uncertainUsd: 0 })
    const commit = vi.spyOn(h.deps.admission, 'commit')
    expect(await h.create(draft({ paidCapUsd: 1 }))).toEqual({
      outcome: 'refused',
      reason: 'budget',
    })
    expect(commit).not.toHaveBeenCalled()
    expect(await h.create(draft({ paidCapUsd: 0.9 }))).toMatchObject({ outcome: 'created' })
    expect(h.deps.admission.dailyUsage).toHaveBeenCalledWith(authority, now)
  })

  it.each([false, true])('reserves the full active cap with paused=%s', async (paused) => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 1 })
    const { creator } = await h.deps.authority()
    await h.store.create(
      fakeSchedule({
        creator,
        paused,
        paidCapUsd: 0.75,
        grant,
      }),
    )
    const commit = vi.spyOn(h.deps.admission, 'commit')
    expect(await h.create(draft({ paidCapUsd: 0.5 }))).toEqual({
      outcome: 'refused',
      reason: 'budget',
    })
    expect(commit).not.toHaveBeenCalled()
    expect(await h.create(draft({ paidCapUsd: 0.25 }))).toMatchObject({ outcome: 'created' })
  })

  it('counts ledger spend and uncertain liability after a schedule is removed', async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 1 })
    const authority = await h.deps.authority()
    const ended = fakeSchedule({
      creator: authority.creator,
      end: { atMs: now },
      paidCapUsd: 1,
      grant,
    })
    await h.store.create(ended)
    h.setDailyUsage(now, { settledUsd: 0.25, uncertainUsd: 0.25 })
    expect(await h.store.remove(authority.workspaceKey, ended.id)).toBe(true)
    const commit = vi.spyOn(h.deps.admission, 'commit')
    expect(await h.store.list('workspace-1')).toEqual([])
    expect(await h.create(draft({ paidCapUsd: 0.75 }))).toEqual({
      outcome: 'refused',
      reason: 'budget',
    })
    expect(commit).not.toHaveBeenCalled()
    expect(await h.create(draft({ paidCapUsd: 0.5 }))).toMatchObject({ outcome: 'created' })
  })

  it('refuses invalid daily ledger amounts before commit', async () => {
    for (const field of ['settledUsd', 'uncertainUsd'] as const) {
      for (const amount of [-1, NaN, Infinity]) {
        const h = harness()
        h.setPolicy({ choice: 'always', paidCapUsd: 1 })
        h.setDailyUsage(now, { settledUsd: 0, uncertainUsd: 0, [field]: amount })
        const commit = vi.spyOn(h.deps.admission, 'commit')
        expect(await h.create()).toEqual({ outcome: 'refused', reason: 'budget' })
        expect(commit).not.toHaveBeenCalled()
      }
    }
  })

  it('propagates an unavailable daily ledger without committing a schedule', async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 1 })
    vi.mocked(h.deps.admission.dailyUsage).mockRejectedValue(new Error('Ledger unavailable'))
    const commit = vi.spyOn(h.deps.admission, 'commit')
    await expect(h.create()).rejects.toThrow('Ledger unavailable')
    expect(commit).not.toHaveBeenCalled()
    expect(await h.store.list('workspace-1')).toEqual([])
  })

  it('bounds Always total paid cap across siblings before commit', async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 1 })
    expect(await h.create(draft({ paidCapUsd: 1 }))).toMatchObject({ outcome: 'created' })
    expect(await h.create(draft({ paidCapUsd: 1 }))).toEqual({
      outcome: 'refused',
      reason: 'budget',
    })
    h.setPolicy({ choice: 'always', paidCapUsd: NaN })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'budget' })
  })

  it('refuses malformed Always caps before remembering any permission', async () => {
    for (const alwaysPaidCapUsd of [-1, NaN, Infinity]) {
      const h = harness()
      const remember = vi.spyOn(h.deps.admission, 'remember')
      vi.mocked(h.deps.consent).mockResolvedValue({ alwaysPaidCapUsd })
      expect(await h.create()).toEqual({ outcome: 'refused', reason: 'budget' })
      expect(remember).not.toHaveBeenCalled()
    }
  })

  it('allocates paid caps out of creator budget under concurrent Ask approvals', async () => {
    const h = harness()
    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () => h.create(draft({ paidCapUsd: 1 }))),
    )
    expect(outcomes.filter((result) => result.outcome === 'created')).toHaveLength(2)
    expect(outcomes).toContainEqual({ outcome: 'refused', reason: 'budget' })
    const jobs = await h.store.list('workspace-1')
    expect(jobs.reduce((sum, job) => sum + job.paidCapUsd, 0)).toBe(2)
  })

  it('does not create paid authority without schedule consent or after consent changes', async () => {
    const h = harness()
    vi.mocked(h.deps.paidConsent).mockResolvedValue(undefined)
    expect(await h.create(draft({ paidCapUsd: 1 }))).toEqual({
      outcome: 'refused',
      reason: 'paidConsent',
    })
    vi.mocked(h.deps.paidConsent).mockImplementation((request) => {
      h.setAuthority({ paidCapUsd: 0 })
      return Promise.resolve(consentFor(request.paidCapUsd))
    })
    expect(await h.create(draft({ paidCapUsd: 1 }))).toEqual({
      outcome: 'refused',
      reason: 'changed',
    })
    expect(await h.store.list('workspace-1')).toEqual([])
  })

  it('refuses depth two except explicit permission for the creating run, never propagated to its child', async () => {
    const h = harness()
    h.setAuthority({ depth: 1, sourceScheduleId: 'parent' })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'depth' })
    h.setAuthority({ reschedulePermissionFor: 'parent' })
    const created = await h.create()
    expect(created.outcome).toBe('created')
    if (created.outcome !== 'created') throw new Error('Expected permitted creation')
    expect(created.schedule.depth).toBe(2)
    h.setAuthority({ depth: 2, sourceScheduleId: created.schedule.id })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'depth' })
  })

  it.each<ScheduleV2['target']>([
    { kind: 'conversation', backend: 'modelApi', sessionId: 'session-1' },
    { kind: 'worker', workerId: 'worker-1' },
    { kind: 'role', teamId: 'team-1', roleId: 'reviewer' },
    { kind: 'team', teamId: 'team-1' },
    { kind: 'node', nodeId: 'node-1' },
  ])('checks target authorization for $kind', async (target) => {
    const h = harness()
    vi.mocked(h.deps.canTarget).mockResolvedValue(false)
    expect(await h.create(draft({ target }))).toEqual({ outcome: 'refused', reason: 'target' })
    vi.mocked(h.deps.canTarget).mockResolvedValue(true)
    expect(await h.create(draft({ target }))).toMatchObject({ outcome: 'created' })
  })

  it('re-reads permission and mode after consent rather than replaying stale authority', async () => {
    const h = harness()
    vi.mocked(h.deps.consent).mockImplementation(() => {
      h.setAuthority({ grant: { rules: [], destinationIds: [], paidCapUsd: 0 }, mode: 'plan' })
      return Promise.resolve('allow')
    })
    const created = await h.create(draft({ mode: 'auto' }))
    expect(created.outcome).toBe('created')
    if (created.outcome !== 'created') throw new Error('Expected creation')
    expect(created.schedule.grant.rules).toEqual([])
    expect(created.schedule.mode).toBe('plan')
  })

  it('refuses owner identity, charter, Never or lifetime changes while consent is open', async () => {
    for (const change of ['identity', 'charter', 'never', 'lifetime'] as const) {
      const h = harness()
      vi.mocked(h.deps.consent).mockImplementation(() => {
        switch (change) {
          case 'identity': {
            h.setAuthority({ workspaceKey: 'other' })
            break
          }
          case 'charter': {
            h.setAuthority({ role: 'worker', charterAllowsScheduling: false })
            break
          }
          case 'never': {
            h.setPolicy({ choice: 'never' })
            break
          }
          case 'lifetime': {
            h.setAuthority({ active: false })
            break
          }
        }
        return Promise.resolve('allow')
      })
      expect(await h.create()).toMatchObject(
        change === 'never' ? { outcome: 'refused', reason: 'never' } : { outcome: 'refused' },
      )
      expect(await h.store.list('workspace-1')).toEqual([])
    }
  })

  it('rechecks depth and target authorization after consent', async () => {
    for (const change of ['depth', 'target'] as const) {
      const h = harness()
      vi.mocked(h.deps.consent).mockImplementation(() => {
        if (change === 'depth') h.setAuthority({ depth: 1 })
        else vi.mocked(h.deps.canTarget).mockResolvedValue(false)
        return Promise.resolve('allow')
      })
      expect(await h.create()).toEqual({ outcome: 'refused', reason: change })
      expect(await h.store.list('workspace-1')).toEqual([])
    }
  })

  it('refuses every creator identity change while consent is open', async () => {
    for (const key of ['agentId', 'sessionId', 'orchestratorId', 'teamId'] as const) {
      const h = harness()
      const initial = await h.deps.authority()
      vi.mocked(h.deps.consent).mockImplementation(() => {
        h.setAuthority({ creator: { ...initial.creator, [key]: 'other' } })
        return Promise.resolve('allow')
      })
      expect(await h.create()).toEqual({ outcome: 'refused', reason: 'changed' })
    }
  })

  it('never asks about an unauthorized target or depth', async () => {
    const h = harness()
    vi.mocked(h.deps.canTarget).mockResolvedValue(false)
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'target' })
    h.setAuthority({ depth: 1 })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'depth' })
    expect(h.deps.consent).not.toHaveBeenCalled()
  })

  it('refuses stale Always decisions after a policy revision and does not overwrite the new cap', async () => {
    const h = harness()
    vi.mocked(h.deps.consent).mockImplementation(() => {
      h.setPolicy({ choice: 'always', paidCapUsd: 0 })
      return Promise.resolve({ alwaysPaidCapUsd: 2 })
    })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'changed' })
    const authority = await h.deps.authority()
    expect(await h.deps.admission.policy(authority)).toMatchObject({
      choice: 'always',
      paidCapUsd: 0,
    })
    expect(await h.store.list('workspace-1')).toEqual([])
    h.setPolicy({ choice: 'ask' })
    vi.spyOn(h.deps.admission, 'remember').mockResolvedValue(false)
    vi.mocked(h.deps.consent).mockResolvedValue({ alwaysPaidCapUsd: 2 })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'changed' })
  })

  it('does not use revoked Always authority when the current policy becomes Ask', async () => {
    const h = harness()
    h.setPolicy({ choice: 'always', paidCapUsd: 2 })
    vi.mocked(h.deps.paidConsent).mockImplementation((request) => {
      h.setPolicy({ choice: 'ask' })
      return Promise.resolve(consentFor(request.paidCapUsd))
    })
    expect(await h.create(draft({ paidCapUsd: 1 }))).toEqual({
      outcome: 'refused',
      reason: 'changed',
    })
    expect(h.deps.consent).not.toHaveBeenCalled()
  })

  it('isolates list and cancellation by workspace, orchestrator, session and team', async () => {
    const h = harness()
    for (const [id, creator, workspaceKey] of [
      ['user', { kind: 'user' }, 'workspace-1'],
      [
        'other-orch',
        { kind: 'agent', agentId: 'lead-1', sessionId: 'session-1', orchestratorId: 'other' },
        'workspace-1',
      ],
      [
        'other-session',
        { kind: 'agent', agentId: 'lead-1', sessionId: 'other', orchestratorId: 'orchestrator-1' },
        'workspace-1',
      ],
      [
        'other-team',
        {
          kind: 'agent',
          agentId: 'lead-1',
          sessionId: 'session-1',
          teamId: 'other',
          orchestratorId: 'orchestrator-1',
        },
        'workspace-1',
      ],
      [
        'other-workspace',
        {
          kind: 'agent',
          agentId: 'lead-1',
          sessionId: 'session-1',
          orchestratorId: 'orchestrator-1',
        },
        'other',
      ],
    ] satisfies [string, ScheduleV2['creator'], string][]) {
      await h.store.create(fakeSchedule({ id, creator, workspaceKey }))
      expect(await h.tools.call('schedule_cancel', { id }, signal)).toEqual({
        outcome: 'refused',
        reason: 'missing',
      })
    }
    expect(await h.tools.call('schedule_list', {}, signal)).toEqual({
      outcome: 'listed',
      schedules: [],
    })
  })

  it('expires with the session or team while preserving user-pinned and live-owner jobs', async () => {
    const h = harness()
    await h.create()
    h.setAuthority({
      creator: {
        kind: 'agent',
        agentId: 'lead-1',
        sessionId: 'session-1',
        teamId: 'team-1',
        orchestratorId: 'orchestrator-1',
      },
    })
    await h.create()
    const jobs = await h.store.list('workspace-1')
    const job = jobs[0]
    if (job === undefined) throw new Error('Expected job')
    await h.store.update({ ...job, pinned: true })
    expect(await h.tools.expire('workspace-1')).toHaveLength(1)
    expect(await h.store.list('workspace-1')).toMatchObject([{ pinned: true }])
    expect(h.deps.transcript).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'expired',
        text: 'This schedule ended with its creator’s session or team.',
      }),
    )
    vi.mocked(h.deps.ownerActive).mockResolvedValue(true)
    await h.create()
    expect(await h.tools.expire('workspace-1')).toEqual([])
  })

  it('propagates storage failure and cancelled consent without success or leftover jobs', async () => {
    const h = harness()
    const commit = vi.spyOn(h.deps.admission, 'commit')
    const controller = new AbortController()
    vi.mocked(h.deps.consent).mockImplementation(() => {
      controller.abort()
      return Promise.resolve('allow')
    })
    await expect(h.create(draft(), controller.signal)).rejects.toThrow()
    expect(commit).not.toHaveBeenCalled()
    vi.mocked(h.deps.consent).mockResolvedValue('allow')
    vi.spyOn(h.store, 'create').mockRejectedValue(new Error('Disk unavailable'))
    await expect(h.create()).rejects.toThrow('Disk unavailable')
    expect(await h.store.list('workspace-1')).toEqual([])
  })

  it('retains the final admission refusal reason and never reports an uncommitted success', async () => {
    const h = harness()
    vi.spyOn(h.deps.admission, 'commit').mockResolvedValue({ committed: false, reason: 'expired' })
    expect(await h.create()).toEqual({ outcome: 'refused', reason: 'expired' })
    expect(await h.store.list('workspace-1')).toEqual([])
    expect(h.deps.transcript).not.toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'created' }),
    )
  })
})

describe('agent schedule transports', () => {
  it('keeps the generated model schema synchronized with the frozen draft contract', () => {
    const expected = z.toJSONSchema(z.strictObject({ draft: scheduleDraftSchema }), {
      unrepresentable: 'any',
    })
    const expectedDraft = expected.properties?.['draft']
    if (typeof expectedDraft !== 'object' || expectedDraft.properties === undefined)
      throw new Error('Expected draft schema')
    const action = expectedDraft.properties['action']
    if (typeof action !== 'object') throw new Error('Expected action schema')
    const prompt = action.oneOf?.find((choice) => {
      const kind = choice.properties?.['kind']
      return typeof kind === 'object' && kind.const === 'prompt'
    })
    if (prompt === undefined) throw new Error('Expected prompt action')
    expectedDraft.properties['action'] = prompt
    expectedDraft.properties['pinned'] = { type: 'boolean', const: false }
    expect(promptParameters).toEqual(expected)
  })
  it('declares nested draft fields, all triggers and targets, and excludes report actions and agent pinning', async () => {
    const h = harness()
    const definitions = await h.tools.definitions()
    expect(definitions[0]?.parameters).toEqual(promptParameters)
    expect(promptParameters.properties.draft.required).toEqual(
      draftKeys.filter((key) => key !== 'end'),
    )
    expect(promptParameters.properties.draft.properties.action).toMatchObject({
      properties: { kind: { const: 'prompt' }, prompt: { maxLength: 4000 } },
    })
    expect(promptParameters.properties.draft.properties.pinned).toEqual({
      type: 'boolean',
      const: false,
    })
    expect(promptParameters.properties.draft.properties.trigger.anyOf).toHaveLength(3)
    expect(promptParameters.properties.draft.properties.target.oneOf).toHaveLength(6)
    const before = structuredClone(promptParameters)
    const parameters = definitions[0]?.parameters
    if (parameters === undefined) throw new Error('Expected declaration')
    parameters['properties'] = {}
    const again = await h.tools.definitions()
    expect(again[0]?.parameters).toEqual(before)
  })
  it('keeps the default Model API request tool list byte-identical and appends only admitted declarations', async () => {
    const h = harness()
    const baseline = toolDefinitions('win32')
    const before = JSON.stringify(baseline)
    const additions = await h.tools.definitions()
    expect(
      toolDefinitions('win32', { hasShell: true, hasSkills: false, scheduleTools: additions }),
    ).toEqual([...baseline, ...additions])
    expect(JSON.stringify(toolDefinitions('win32'))).toBe(before)
    expect(baseline.some((tool) => tool.name === 'schedule_prompt')).toBe(false)
  })

  it('serves all three tools through the captured MCP envelope and refuses malformed calls', async () => {
    const h = harness()
    const tools = await h.tools.mcpTools()
    const request = (name: string, args: unknown) =>
      handleMcpMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
        tools,
        { name: 'schedules-test', version: '1' },
        signal,
      )
    expect(await request('schedule_prompt', { draft: draft() })).toMatchObject({
      kind: 'response',
      body: {
        result: {
          content: [{ type: 'text', text: expect.stringContaining('"outcome":"created"') }],
        },
      },
    })
    const jobs = await h.store.list('workspace-1')
    const id = jobs[0]?.id
    if (id === undefined) throw new Error('Expected MCP creation')
    expect(await request('schedule_list', {})).toMatchObject({
      body: { result: { content: [{ text: expect.stringContaining(id) }] } },
    })
    expect(await request('schedule_cancel', { id })).toMatchObject({
      body: { result: { content: [{ text: JSON.stringify({ outcome: 'cancelled', id }) }] } },
    })
    expect(await request('schedule_prompt', { draft: {}, creator: 'forged' })).toMatchObject({
      body: {
        result: { content: [{ text: JSON.stringify({ outcome: 'refused', reason: 'invalid' }) }] },
      },
    })
    h.setAuthority({ enabled: false })
    expect(await request('schedule_list', {})).toMatchObject({
      body: {
        result: {
          content: [{ text: JSON.stringify({ outcome: 'refused', reason: 'unavailable' }) }],
        },
      },
    })
  })
})
