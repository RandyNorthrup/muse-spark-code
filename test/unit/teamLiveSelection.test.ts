import { describe, expect, it } from 'vitest'
import { selectTeamEntry, TeamLiveAvailability } from '../../src/core/team/selection'
import { pickReviewer } from '../../src/core/team/reviewerPick'
import { answerExhausted } from '../../src/core/team/teamPool'
import { reviewGate } from '../../src/core/team/reviewGate'
import { TaskPicker } from '../../src/core/team/scheduler/pick'
import type { TeamSelection } from '../../src/core/team/teamPool'
import type { TeamBoardTask } from '../../src/shared/team'
import { teamPreferenceListSchema, type TeamCandidate } from '../../src/shared/teamPreference'
import { TEAM_TASKS_PER_TURN_DEFAULT } from '../../src/shared/constants'
import { isSameTeamModel } from '../../src/core/team/sameModel'
import {
  keyAgent,
  pickContext,
  poolEntry,
  readyTask,
  rolePool,
  schedulerEntry,
  selectionSnapshot,
  tapped,
} from './helpers/teamFixtures'
import { legacySelectionCases } from './helpers/teamSelectionCases'
import legacy from '../fixtures/teamSelection.legacy.json'

function preference(ids = ['preferred', 'fallback']) {
  return teamPreferenceListSchema.parse({
    role: 'engineering',
    pool: ids.map((id) => ({
      id,
      concurrent: 1,
      caps: [],
      agent: { kind: 'engine', agentId: id, model: `model-${id}`, pays: 'local' },
      conditions: { platforms: ['windows'], features: ['tools.write'] },
    })),
  })
}
function live() {
  const facts = { signedIn: true, healthy: true, nodeOnline: true, admitted: true }
  return { facts, availability: new TeamLiveAvailability(() => facts) }
}
function select(snapshot: ReturnType<typeof selectionSnapshot>) {
  return selectTeamEntry(rolePool('engineering', []), snapshot, TEAM_TASKS_PER_TURN_DEFAULT)
}
describe('M120 live preference selection', () => {
  it.each(['signedOut', 'unhealthy', 'nodeOffline', 'conditions', 'author', 'capped'] as const)(
    'asks for a non-recoverable %s in both pool and reviewer selection',
    (reason) => {
      const list = preference(['reviewer'])
      list.exhausted = 'queue'
      const snapshot = {
        ...selectionSnapshot(),
        preference: list,
        availability: {
          probe: () => ({ available: false as const, skip: { candidateId: 'reviewer', reason } }),
        },
      }
      const pool = { ...rolePool('engineering', []), policy: 'queue' as const }
      const selection = selectTeamEntry(pool, snapshot, TEAM_TASKS_PER_TURN_DEFAULT)
      if (selection.kind !== 'exhausted') throw new Error('test:exhaustion')
      expect(answerExhausted(pool, selection.reasons, 0).decision).toBe('ask')
      expect(
        pickReviewer(
          [],
          [{ entryId: 'reviewer', modelId: 'model-reviewer', hasHeadroom: true }],
          isSameTeamModel,
          { snapshot },
        ),
      ).toMatchObject({ kind: 'noneEligible', exhausted: { decision: 'ask' } })
    },
  )

  it.each(['coolingDown', 'notAdmitted', 'rateLimited', 'capped'] as const)(
    'queues recoverable %s identically for the pool and reviewer gate',
    (reason) => {
      const list = preference(['reviewer'])
      list.exhausted = 'queue'
      const snapshot = {
        ...selectionSnapshot({ nowMs: 0 }),
        preference: list,
        availability: {
          probe: () => ({
            available: false as const,
            skip: { candidateId: 'reviewer', reason, untilMs: 120_000 },
          }),
        },
      }
      const pool = { ...rolePool('engineering', []), policy: 'queue' as const }
      const selection = selectTeamEntry(pool, snapshot, TEAM_TASKS_PER_TURN_DEFAULT)
      expect(selection.kind).toBe('exhausted')
      if (selection.kind !== 'exhausted') throw new Error('test:exhaustion')
      const exhausted = answerExhausted(pool, selection.reasons, 0)
      expect(exhausted.decision).toBe('queue')
      const reviewer = pickReviewer(
        [],
        [{ entryId: 'reviewer', modelId: 'model-reviewer', hasHeadroom: true }],
        isSameTeamModel,
        { snapshot },
      )
      expect(reviewer).toMatchObject({ kind: 'noneEligible', exhausted })
      expect(
        reviewGate({
          reviewer,
          reviewedHead: undefined,
          branchHead: 'head',
          requireDifferentModel: true,
        }),
      ).toMatchObject({ ok: false, exhausted })
    },
  )

  it.each(['ask', 'queue', 'self'] as const)(
    'blocks an author-only reviewer preference through the review gate under %s policy',
    (exhausted) => {
      const list = preference(['author'])
      list.exhausted = exhausted
      const reviewer = pickReviewer(
        ['model-author'],
        [{ entryId: 'author', modelId: 'model-author', hasHeadroom: true }],
        isSameTeamModel,
        {
          snapshot: {
            ...selectionSnapshot(),
            preference: list,
            availability: live().availability,
            conditions: { authorEngines: ['model-author'] },
          },
        },
      )
      expect(reviewer).toMatchObject({
        kind: 'noneEligible',
        skips: [{ candidateId: 'author', reason: 'author' }],
        exhausted: { decision: 'ask' },
      })
      for (const requiresDifferentModel of [false, true]) {
        expect(
          reviewGate({
            reviewer,
            reviewedHead: undefined,
            branchHead: 'head',
            requireDifferentModel: requiresDifferentModel,
          }),
        ).toMatchObject({
          ok: false,
          reason: 'noneEligible',
          skips: [{ candidateId: 'author', reason: 'author' }],
          exhausted: { decision: 'ask' },
        })
      }
    },
  )

  it('waits for busy preferred reviewers and asks when the configured pool is empty', () => {
    const list = preference(['reviewer'])
    list.exhausted = 'queue'
    const snapshot = {
      ...selectionSnapshot({ nowMs: 0 }),
      preference: list,
      availability: live().availability,
    }
    const reviewer = pickReviewer(
      [],
      [{ entryId: 'reviewer', modelId: 'model-reviewer', hasHeadroom: true }],
      isSameTeamModel,
      { snapshot: { ...snapshot, runningByEntry: new Map([['reviewer', 1]]) } },
    )
    expect(
      reviewGate({
        reviewer,
        reviewedHead: undefined,
        branchHead: 'head',
        requireDifferentModel: true,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'noneEligible',
      exhausted: { decision: 'queue', untilMs: 0 },
      skips: [{ candidateId: 'reviewer', reason: 'busy' }],
    })
    list.pool.length = 0
    expect(pickReviewer([], [], isSameTeamModel, { snapshot })).toMatchObject({
      kind: 'noneEligible',
      skips: [],
      exhausted: { decision: 'ask' },
    })
  })

  it('matches fourteen byte-exact D75 selection receipts captured from the accepted base', () => {
    expect(legacy.source).toBe('6c8d14348')
    const cases = legacySelectionCases()
    expect(cases.map((item) => item.name)).toEqual(legacy.results.map((item) => item.name))
    for (const item of cases) {
      expect(
        JSON.stringify(selectTeamEntry(item.pool, item.snapshot, TEAM_TASKS_PER_TURN_DEFAULT)),
      ).toBe(legacy.results.find((row) => row.name === item.name)?.selectedJson)
    }
  })
  it('keeps existing D75 selection bytes with the same parsed preference', () => {
    const list = preference()
    const pool = rolePool(
      'engineering',
      list.pool.map((candidate) =>
        poolEntry(
          candidate.id,
          keyAgent({ key: candidate.id, modelId: `model-${candidate.id}`, billing: 'local' }),
          [],
          1,
        ),
      ),
    )
    const snapshot = selectionSnapshot({ runningByEntry: new Map([['preferred', 1]]) })
    const legacySelection = selectTeamEntry(pool, snapshot, TEAM_TASKS_PER_TURN_DEFAULT)
    const modern = selectTeamEntry(
      pool,
      { ...snapshot, preference: list, availability: live().availability },
      TEAM_TASKS_PER_TURN_DEFAULT,
    )
    const { skips, ...withoutSkips } =
      modern.kind === 'selected' ? modern : { ...modern, skips: [] }
    expect(JSON.stringify(withoutSkips)).toBe(JSON.stringify(legacySelection))
    expect(skips).toEqual([{ candidateId: 'preferred', reason: 'busy' }])
  })

  it.each([
    ['signedIn', 'signedOut'],
    ['healthy', 'unhealthy'],
    ['nodeOnline', 'nodeOffline'],
    ['admitted', 'notAdmitted'],
  ] as const)('checks %s live and exposes %s', (fact, reason) => {
    const f = live()
    const availability = new TeamLiveAvailability((candidate) =>
      candidate.id === 'preferred' ? { ...f.facts, [fact]: false } : f.facts,
    )
    const snapshot = { ...selectionSnapshot(), preference: preference(), availability }
    expect(select(snapshot)).toMatchObject({
      kind: 'selected',
      entry: { id: 'fallback' },
      skips: [{ candidateId: 'preferred', reason }],
    })
    f.facts[fact] = true
    expect(select({ ...snapshot, availability: f.availability })).toMatchObject({
      entry: { id: 'preferred' },
      skips: [],
    })
  })

  it('respects caps, rate marks and cooldown boundaries with reasons', () => {
    const f = live()
    const snapshot = {
      ...selectionSnapshot({ nowMs: 0 }),
      preference: preference(),
      availability: f.availability,
    }
    snapshot.marks.markRateLimited('preferred', 100)
    expect(select(snapshot)).toMatchObject({
      skips: [{ reason: 'rateLimited', untilMs: 100 }],
      entry: { id: 'fallback' },
    })
    expect(select({ ...snapshot, nowMs: 100 })).toMatchObject({ entry: { id: 'preferred' } })
    const availability = new TeamLiveAvailability((candidate) => ({
      ...f.facts,
      ...(candidate.id === 'preferred' && { coolingUntilMs: 100 }),
    }))
    expect(select({ ...snapshot, availability })).toMatchObject({
      skips: [{ reason: 'coolingDown', untilMs: 100 }],
    })
    expect(select({ ...snapshot, availability, nowMs: 100 })).toMatchObject({
      entry: { id: 'preferred' },
    })
    const list = preference()
    list.pool[0]?.caps.push({ measure: 'tokens', window: 'day', amount: 1 })
    expect(select({ ...snapshot, nowMs: 100, preference: list })).toMatchObject({
      skips: [{ reason: 'capped' }],
    })
  })

  it('never treats unknown capability facts as meeting a requirement', () => {
    const list = preference()
    const first = list.pool[0]
    if (first) delete first.conditions
    expect(
      select({
        ...selectionSnapshot(),
        preference: list,
        availability: live().availability,
        conditions: { platform: 'windows', features: ['tools.write'] },
      }),
    ).toMatchObject({ entry: { id: 'fallback' }, skips: [{ reason: 'conditions' }] })
  })

  it('excludes every handoff and borrowed author and their engines, with no same-engine fallback', () => {
    const list = preference(['preferred', 'borrowed', 'same-engine', 'independent'])
    const same = list.pool.find((candidate) => candidate.id === 'same-engine')
    if (same?.agent) same.agent.model = ' model-borrowed '
    const snapshot = {
      ...selectionSnapshot(),
      preference: list,
      availability: live().availability,
      authorship: {
        startedOn: 'preferred',
        record: {
          taskId: 'coded',
          roleId: 'engineering',
          chain: [
            {
              kind: 'borrow' as const,
              candidateId: 'borrowed',
              mainRole: 'review',
              borrowingRole: 'engineering',
              atMs: 0,
            },
          ],
        },
        engines: new Map([
          ['preferred', 'model-preferred'],
          ['borrowed', 'model-borrowed'],
        ]),
      },
    }
    const candidates = list.pool.map((candidate: TeamCandidate) => ({
      entryId: candidate.id,
      modelId: candidate.agent?.model ?? '',
      hasHeadroom: true,
    }))
    expect(pickReviewer([], candidates, isSameTeamModel, { snapshot })).toEqual({
      entryId: 'independent',
      modelId: 'model-independent',
      sameModel: false,
      skips: [
        { candidateId: 'preferred', reason: 'author' },
        { candidateId: 'borrowed', reason: 'author' },
        { candidateId: 'same-engine', reason: 'author' },
      ],
    })
    const selected = tapped((_selection: TeamSelection) => undefined)
    expect(
      pickReviewer([], candidates, isSameTeamModel, {
        snapshot: { ...snapshot, preference: { ...list, pool: list.pool.slice(0, -1) } },
        selected,
      }),
    ).toMatchObject({ kind: 'noneEligible' })
    expect(selected.calls).toHaveLength(1)
    expect(selected.calls[0]?.[0]).toMatchObject({ kind: 'exhausted' })
    expect(() =>
      select({ ...snapshot, authorship: { ...snapshot.authorship, engines: new Map() } }),
    ).toThrow('authorEngineMissing')
  })

  it('uses preference order ahead of score or entry-id ordering in the real picker', () => {
    const selected = tapped((_task: TeamBoardTask, _selection: TeamSelection) => undefined)
    const snapshot = {
      ...selectionSnapshot(),
      preference: preference(['z-preferred', 'a-fallback']),
      availability: live().availability,
    }
    const context = pickContext({
      entries: [
        schedulerEntry({
          id: 'a-fallback',
          agentProfileId: 'a-fallback',
          modelId: 'model-a-fallback',
        }),
        schedulerEntry({
          id: 'z-preferred',
          agentProfileId: 'z-preferred',
          modelId: 'model-z-preferred',
          poolFit: 1 / 2,
        }),
      ],
      selection: () => snapshot,
      selected,
    })
    expect(new TaskPicker().pick([readyTask('work')], context)?.entry.id).toBe('z-preferred')
    expect(
      new TaskPicker().pick([readyTask('work')], {
        ...context,
        canStart: (_task, candidate) => candidate.id !== 'z-preferred',
      })?.entry.id,
    ).toBe('a-fallback')
    expect(selected.calls.at(-1)?.[1]).toMatchObject({
      skips: [{ candidateId: 'z-preferred', reason: 'notAdmitted' }],
    })
  })

  it('refuses preference selection without a live probe', () => {
    expect(() => select({ ...selectionSnapshot(), preference: preference() })).toThrow(
      'availabilityMissing',
    )
  })

  it('refuses a scheduler candidate whose live worker identity differs from the preference', () => {
    const selected = tapped((_task: TeamBoardTask, _selection: TeamSelection) => undefined)
    const snapshot = {
      ...selectionSnapshot(),
      preference: preference(),
      availability: live().availability,
    }
    const context = pickContext({
      selection: () => snapshot,
      selected,
      entries: [
        schedulerEntry({ id: 'preferred', agentProfileId: 'preferred', modelId: 'stale-model' }),
        schedulerEntry({ id: 'fallback', agentProfileId: 'fallback', modelId: 'model-fallback' }),
      ],
    })
    expect(new TaskPicker().pick([readyTask('work')], context)?.entry.id).toBe('fallback')
    expect(selected.calls.at(-1)?.[1]).toMatchObject({
      skips: [{ candidateId: 'preferred', reason: 'unhealthy' }],
    })
  })

  it('excludes an authoring engine even when another candidate reports a different model', () => {
    const snapshot = {
      ...selectionSnapshot(),
      preference: preference(),
      availability: live().availability,
      conditions: { authorEngines: ['author-engine'] },
      engine: (candidate: TeamCandidate) =>
        candidate.id === 'preferred' ? 'author-engine' : 'independent-engine',
    }
    expect(select(snapshot)).toMatchObject({
      entry: { id: 'fallback' },
      skips: [{ candidateId: 'preferred', reason: 'author' }],
    })
  })

  it('refuses a stale reviewer model before it can review an earlier author engine', () => {
    const selected = tapped((_selection: TeamSelection) => undefined)
    const snapshot = {
      ...selectionSnapshot(),
      preference: preference(),
      availability: live().availability,
      conditions: { authorEngines: ['stale-author-model'] },
    }
    expect(
      pickReviewer(
        [],
        [
          { entryId: 'preferred', modelId: 'stale-author-model', hasHeadroom: true },
          { entryId: 'fallback', modelId: 'model-fallback', hasHeadroom: true },
        ],
        isSameTeamModel,
        { snapshot, selected },
      ),
    ).toMatchObject({
      entryId: 'fallback',
      skips: [{ candidateId: 'preferred', reason: 'unhealthy' }],
    })
    expect(selected.calls).toHaveLength(1)
    expect(selected.calls[0]?.[0]).toMatchObject({ kind: 'selected' })
  })

  it('honours zero caps, role turn limits and a changed candidate identity', () => {
    const list = preference()
    list.pool[0]?.caps.push({ measure: 'tokens', window: 'day', amount: 0 })
    const snapshot = { ...selectionSnapshot(), preference: list, availability: live().availability }
    expect(select(snapshot)).toMatchObject({
      entry: { id: 'fallback' },
      skips: [{ reason: 'capped' }],
    })
    list.tasksPerTurn = 1
    expect(select({ ...snapshot, startedThisTurn: 1 })).toMatchObject({
      kind: 'exhausted',
      skips: [{ reason: 'capped' }, { reason: 'capped' }],
    })
    list.pool[0]?.caps.splice(0)
    const pool = rolePool('engineering', [
      poolEntry('preferred', keyAgent({ key: 'stale', modelId: 'old' })),
    ])
    expect(selectTeamEntry(pool, snapshot, TEAM_TASKS_PER_TURN_DEFAULT)).toMatchObject({
      agent: { key: 'preferred', modelId: 'model-preferred', billing: 'local' },
    })
  })
})
