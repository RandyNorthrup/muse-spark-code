import { describe, expect, it } from 'vitest'
import {
  assembleSnapshot,
  dispatchRecord,
  liveAvailabilityProbe,
  orderCandidatesByProviders,
} from '../../../src/core/team/liveWiring'
import { TeamAgentMarks, type TeamAgentProfile } from '../../../src/core/team/teamPool'
import { TeamMeter } from '../../../src/core/team/teamMeter'
import { teamPreferenceListSchema } from '../../../src/shared/teamPreference'

const agent: TeamAgentProfile = {
  key: 'coder',
  kind: 'engine',
  billing: 'key',
  modelId: 'engine-coder',
  label: 'Coder',
}

function sources() {
  return {
    nowMs: 0,
    defaultAgent: agent,
    meter: new TeamMeter({ rows: () => [], openReservations: () => [] }),
    marks: new TeamAgentMarks(),
    teamBudget: undefined,
    agentLimit: () => 8,
    isAgentAvailable: () => true,
    global: { running: 0, limit: 20 },
    process: { running: 0, limit: 4 },
    runningByEntry: new Map(),
    runningByAgent: new Map(),
    startedThisTurn: 0,
    taskId: 'coding',
    signedIn: () => true,
    healthy: () => true,
    nodeOnline: () => true,
    governorAdmitted: () => true,
    coolingUntilMs: () => undefined,
  }
}

describe('M120 lane W live wiring', () => {
  it('probes sign-in, health, node and admission through the host facts', () => {
    const f = sources()
    const probe = liveAvailabilityProbe(f)
    const candidate = { id: 'a', concurrent: 1, caps: [] }
    expect(probe.probe(candidate, 0)).toEqual({ available: true })
    const signedOut = liveAvailabilityProbe({ ...f, signedIn: (id) => id !== 'a' })
    expect(signedOut.probe(candidate, 0)).toMatchObject({ available: false })
    const offline = liveAvailabilityProbe({ ...f, nodeOnline: () => false })
    expect(offline.probe(candidate, 0)).toMatchObject({ available: false })
  })

  it('assembles the snapshot from the ledger, marks and facts', () => {
    const snapshot = assembleSnapshot(sources())
    expect(snapshot.nowMs).toBe(0)
    expect(snapshot.taskId).toBe('coding')
    expect(snapshot.defaultAgent).toBe(agent)
    expect(snapshot.marks).toBeInstanceOf(TeamAgentMarks)
  })

  it('orders engine candidates by the M95 provider file order', () => {
    const pool = teamPreferenceListSchema.parse({
      role: 'engineering',
      pool: [
        {
          id: 'b',
          concurrent: 1,
          caps: [],
          agent: { kind: 'engine', agentId: 'b', model: 'm', provider: 'second', pays: 'local' },
        },
        {
          id: 'a',
          concurrent: 1,
          caps: [],
          agent: { kind: 'engine', agentId: 'a', model: 'm', provider: 'first', pays: 'local' },
        },
        {
          id: 'z',
          concurrent: 1,
          caps: [],
          agent: { kind: 'engine', agentId: 'z', model: 'm', pays: 'local' },
        },
      ],
    }).pool
    expect(orderCandidatesByProviders(pool, ['first', 'second']).map((item) => item.id)).toEqual([
      'a',
      'b',
      'z',
    ])
    expect(orderCandidatesByProviders(pool, []).map((item) => item.id)).toEqual(['b', 'a', 'z'])
  })

  it('records a dispatch the playbook reads', () => {
    const record = dispatchRecord(
      { id: 'coding', roleId: 'engineering' },
      {
        kind: 'selected',
        entry: { id: 'coder', concurrent: 1, caps: [], agent: { ...agent, key: 'coder' } },
        agent: { ...agent, key: 'coder' },
        skips: [{ candidateId: 'other', reason: 'busy' }],
      },
      60_000,
    )
    expect(record).toMatchObject({
      taskId: 'coding',
      roleId: 'engineering',
      candidateId: 'coder',
      atMs: 60_000,
      reasons: ['other:busy'],
    })
  })
})
