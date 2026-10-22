// M120 lane 0 contracts (PLAN.md D103, D212): one preference model, built
// on D75's pool entry and role config, never beside them.

import { describe, expect, it } from 'vitest'
import { teamRoleConfigSchema } from '../../src/shared/team'
import {
  isTaskAuthor,
  canMeetTaskConditions,
  teamAreaHintsSchema,
  teamCandidateSchema,
  teamHandoffRecordSchema,
  teamOutcomeStatsSchema,
  teamPreferenceListSchema,
  teamRoleAssignmentSchema,
  teamSkipSchema,
  type TeamAvailabilityProbe,
  type TeamCandidate,
} from '../../src/shared/teamPreference'

const work = { commits: ['abc123'], diffRef: 'diff-1', newFiles: ['src/new.ts'], noteRef: 'note-1' }

describe('preference list and candidate', () => {
  const d75Role = {
    role: 'engineering',
    workspace: 'own-branch',
    continueOnNext: false,
    pool: [
      {
        id: 'muse',
        agent: {
          kind: 'museCode',
          agentId: 'muse-plan',
          model: 'muse-spark-1.3',
          pays: 'subscription',
        },
        concurrent: 2,
        caps: [{ measure: 'tokens', window: 'day', amount: 1000 }],
      },
      { id: 'default', concurrent: 1, caps: [] },
    ],
  } as const

  it('a D75 role config is a preference list unchanged, pool order kept', () => {
    expect(teamPreferenceListSchema.parse(d75Role)).toStrictEqual(
      teamRoleConfigSchema.parse(d75Role),
    )
  })

  it('a candidate adds its node and capability conditions to the entry', () => {
    const candidate = teamCandidateSchema.parse({
      ...d75Role.pool[0],
      node: 'mac-mini',
      conditions: { platforms: ['macos', 'linux'], features: ['tools.write'] },
    })
    expect(candidate.node).toBe('mac-mini')
    expect(
      teamCandidateSchema.safeParse({ ...d75Role.pool[0], conditions: { platforms: ['beos'] } })
        .success,
    ).toBe(false)
    const list = teamPreferenceListSchema.parse({
      ...d75Role,
      pool: [candidate],
      areaHints: { globs: ['src/webview/**', '**/*.css'], kinds: ['UI layout'] },
      borrow: {},
    })
    expect(list.borrow?.demandWaitMs).toBe(60_000)
    expect(list.areaHints?.globs).toStrictEqual(['src/webview/**', '**/*.css'])
    expect(teamAreaHintsSchema.safeParse({ globs: [''], kinds: [] }).success).toBe(false)
    expect(
      teamPreferenceListSchema.safeParse({ ...d75Role, borrow: { demandWaitMs: 30_000 } }).success,
    ).toBe(false)
  })

  it('conditions are capability facts; unknown facts never meet a requirement', () => {
    expect(canMeetTaskConditions(undefined, undefined)).toBe(true)
    expect(canMeetTaskConditions(undefined, { platform: 'windows' })).toBe(false)
    expect(canMeetTaskConditions({ platforms: ['windows'] }, { platform: 'windows' })).toBe(true)
    expect(
      canMeetTaskConditions({ features: ['vision'] }, { features: ['vision', 'tools.write'] }),
    ).toBe(false)
    expect(
      canMeetTaskConditions({ features: ['vision', 'tools.write'] }, { features: ['vision'] }),
    ).toBe(true)
    expect(isTaskAuthor('codex', 'codex-cli', { authorCandidates: ['codex'] })).toBe(true)
    expect(isTaskAuthor('codex-2', 'codex-cli', { authorEngines: ['codex-cli'] })).toBe(true)
    expect(
      isTaskAuthor('muse', 'muse-code', {
        authorCandidates: ['codex'],
        authorEngines: ['codex-cli'],
      }),
    ).toBe(false)
  })

  it('the probe interface answers available or a skip with its reason', () => {
    const probe: TeamAvailabilityProbe = {
      probe: (candidate: TeamCandidate, nowMs: number) =>
        candidate.node === 'offline'
          ? {
              available: false,
              skip: { candidateId: candidate.id, reason: 'nodeOffline', untilMs: nowMs + 1 },
            }
          : { available: true },
    }
    expect(
      probe.probe(teamCandidateSchema.parse({ ...d75Role.pool[1], node: 'offline' }), 5),
    ).toStrictEqual({
      available: false,
      skip: { candidateId: 'default', reason: 'nodeOffline', untilMs: 6 },
    })
    expect(teamSkipSchema.safeParse({ candidateId: 'x', reason: 'vendorSaysNo' }).success).toBe(
      false,
    )
  })
})

describe('D212 role assignment', () => {
  it('one main role and ordered, distinct secondary roles that exclude it', () => {
    expect(
      teamRoleAssignmentSchema.parse({
        candidateId: 'codex',
        mainRole: 'code-review',
        secondaryRoles: ['engineering', 'qa'],
      }).secondaryRoles,
    ).toStrictEqual(['engineering', 'qa'])
    expect(
      teamRoleAssignmentSchema.safeParse({
        candidateId: 'c',
        mainRole: 'qa',
        secondaryRoles: ['qa'],
      }).success,
    ).toBe(false)
    expect(
      teamRoleAssignmentSchema.safeParse({
        candidateId: 'c',
        mainRole: 'qa',
        secondaryRoles: ['docs', 'docs'],
      }).success,
    ).toBe(false)
  })
})

describe('handoff record and chain', () => {
  it('records moves, borrows and recalls in time order', () => {
    const record = {
      taskId: 'code-1',
      roleId: 'engineering',
      chain: [
        {
          kind: 'borrow',
          atMs: 10,
          candidateId: 'codex',
          mainRole: 'code-review',
          borrowingRole: 'engineering',
        },
        {
          kind: 'recall',
          atMs: 20,
          candidateId: 'codex',
          mainRole: 'code-review',
          ending: 'safePoint',
          work,
        },
        {
          kind: 'move',
          atMs: 20,
          trigger: 'returnToPreferred',
          fromCandidateId: 'codex',
          toCandidateId: 'muse',
          work,
        },
      ],
    }
    expect(teamHandoffRecordSchema.parse(record)).toStrictEqual(record)
    expect(
      teamHandoffRecordSchema.safeParse({ ...record, chain: record.chain.toReversed() }).success,
    ).toBe(false)
    expect(
      teamHandoffRecordSchema.safeParse({
        ...record,
        chain: [{ ...record.chain[2], trigger: 'whim' }],
      }).success,
    ).toBe(false)
    expect(
      teamHandoffRecordSchema.safeParse({
        ...record,
        chain: [{ ...record.chain[1], ending: 'abandoned' }],
      }).success,
    ).toBe(false)
  })
})

describe('outcome stats', () => {
  it('counts per role and candidate, with findings by every review severity', () => {
    const stats = {
      roleId: 'frontend',
      candidateId: 'muse',
      tasks: 5,
      firstReviewAccepted: 4,
      findings: { critical: 0, high: 1, medium: 2, low: 3, info: 0 },
      roundsToAcceptance: 6,
      durationMs: 3_600_000,
      redesigns: 0,
    }
    expect(teamOutcomeStatsSchema.parse(stats)).toStrictEqual(stats)
    expect(teamOutcomeStatsSchema.safeParse({ ...stats, tasks: -1 }).success).toBe(false)
    expect(teamOutcomeStatsSchema.safeParse({ ...stats, findings: { high: 1 } }).success).toBe(
      false,
    )
  })
})
