import { describe, expect, it } from 'vitest'
import type { PlaybookLane } from '../../src/shared/playbook'
import { FakePlaybookBoard, fakePlaybookLanes } from './helpers/playbook/fakes'
import { policyFixture } from './playbookPolicyFixture'

describe('M116 planning admission', () => {
  it('requires reviewed, merged contracts and audits each wave prerequisite', () => {
    const { policy } = policyFixture()
    const board = new FakePlaybookBoard()
    const lane = board.readBoard().lanes.find((entry) => entry.id === 'I')!
    expect(policy.beforeDispatch(lane, board.readBoard()).note.code).toBe('contractsPending')
    board.merge('0', false)
    expect(policy.beforeDispatch(lane, board.readBoard()).note.code).toBe('contractsPending')
    board.merge('0', true)
    expect(policy.beforeDispatch(lane, board.readBoard())).toMatchObject({
      kind: 'refuse',
      note: { code: 'prerequisiteMissing', missing: ['P'] },
    })
    board.merge('P', true)
    expect(policy.beforeDispatch(lane, board.readBoard()).kind).toBe('allow')
    expect(
      policy.beforeDispatch(
        board.readBoard().lanes.find((entry) => entry.id === '0')!,
        new FakePlaybookBoard().readBoard(),
      ).kind,
    ).toBe('allow')
  })

  it('scopes bare lane dependencies to their milestone and requires qualified external merges', () => {
    const { policy } = policyFixture()
    const board = new FakePlaybookBoard()
    board.merge('0', true)
    const lane = { ...board.readBoard().lanes[0]!, starts: ['M95:R'] }
    expect(
      policy.beforeDispatch(lane, { ...board.readBoard(), mergedPrerequisites: ['R'] }).kind,
    ).toBe('refuse')
    expect(
      policy.beforeDispatch(lane, { ...board.readBoard(), mergedPrerequisites: ['M95:R'] }).kind,
    ).toBe('allow')
    const wrongContracts = {
      ...board.readBoard(),
      lanes: board
        .readBoard()
        .lanes.map((entry) =>
          entry.kind === 'contracts' ? { ...entry, milestoneId: 'M95' } : entry,
        ),
    }
    expect(policy.beforeDispatch(lane, wrongContracts).kind).toBe('refuse')
  })

  it('uses dependency then estimate then id, independently of plan delivery-order text', () => {
    const { policy } = policyFixture()
    expect(policy.order(fakePlaybookLanes())).toMatchObject({
      kind: 'allow',
      queue: ['0', 'K', 'U', 'P', 'I', 'W'].map((id) => ({ id })),
      notes: [{ code: 'reordered' }],
    })
    const lanes = fakePlaybookLanes().map((lane) => ({ ...lane, starts: [], estimateHours: 1 }))
    expect(policy.order(lanes)).toMatchObject({
      queue: lanes.toSorted((a, b) => a.id.localeCompare(b.id)),
    })
  })

  it('orders generated DAGs by the smallest ready lane and never breaks an edge', () => {
    const { policy } = policyFixture()
    const base = fakePlaybookLanes()[0]!
    for (let seed = 0; seed < 32; seed += 1) {
      const lanes: PlaybookLane[] = Array.from({ length: 8 }, (_, index) => ({
        ...base,
        id: String(index),
        estimateHours: (seed + index * 7) % 9,
        starts: Array.from({ length: index }, (_, prior) => prior)
          .filter((prior) => (seed + index + prior) % 3 === 0)
          .map(String),
      })).toReversed()
      const result = policy.order(lanes)
      expect(result.kind).toBe('allow')
      if (result.kind !== 'allow') throw new Error('Expected DAG order')
      const done = new Set<string>()
      for (const lane of result.queue) {
        const ready = lanes
          .filter(
            (candidate) => !done.has(candidate.id) && candidate.starts.every((id) => done.has(id)),
          )
          .toSorted((a, b) => a.estimateHours - b.estimateHours || (a.id < b.id ? -1 : 1))
        expect(lane.id).toBe(ready[0]?.id)
        expect(lane.starts.every((id) => done.has(id))).toBe(true)
        done.add(lane.id)
      }
    }
  })

  it('refuses cycles, unknown dependencies, duplicate lane ids and dishonest estimates', () => {
    const { policy } = policyFixture()
    const base = fakePlaybookLanes()[0]!
    expect(policy.order([{ ...base, starts: ['missing'] }])).toMatchObject({
      kind: 'refuse',
      note: { laneId: base.id, missing: ['missing'] },
    })
    for (const queue of [
      [{ ...base, starts: ['missing'] }],
      [{ ...base, starts: [base.id] }],
      [base, base],
      [{ ...base, starts: [], estimateHours: NaN }],
    ])
      expect(policy.order(queue).kind).toBe('refuse')
  })

  it('offloads heavy work, chooses CI for the full gate, and returns the local governor handoff without a worker', () => {
    const { policy } = policyFixture()
    const board = new FakePlaybookBoard().readBoard()
    expect(policy.beforeCheck({ id: 'unit', heavy: true, fullGate: false }, board)).toMatchObject({
      target: { kind: 'worker', id: 'macmini' },
      note: { code: 'offloaded', workerId: 'macmini' },
    })
    expect(policy.beforeCheck({ id: 'quality', heavy: true, fullGate: true }, board)).toMatchObject(
      { target: { kind: 'ci' } },
    )
    expect(
      policy.beforeCheck({ id: 'unit', heavy: true, fullGate: false }, { ...board, workers: [] }),
    ).toMatchObject({ target: { kind: 'local' }, note: { code: 'localCheck' } })
    expect(
      policy.beforeCheck({ id: 'format', heavy: false, fullGate: false }, board),
    ).toMatchObject({ target: { kind: 'local' } })
  })

  it('requires a real failing drill with matching hashes and the rolling trunk before merging', () => {
    const { policy } = policyFixture()
    const base = fakePlaybookLanes()[0]!
    expect(policy.beforeMerge(base).note.code).toBe('drillMissing')
    const drill = {
      guard: 'rounds',
      mutation: 'Raise the limit.',
      test: 'playbookRounds.test.ts',
      observedFailure: 'Expected refuse.',
      beforeSha256: 'a'.repeat(64),
      restoredSha256: 'a'.repeat(64),
    }
    const lane = { ...base, drills: [drill] }
    for (const broken of [
      { ...drill, observedFailure: '' },
      { ...drill, restoredSha256: 'b'.repeat(64) },
      { ...drill, beforeSha256: 'a', restoredSha256: 'a' },
    ])
      expect(policy.beforeMerge({ ...lane, drills: [broken] }).note.code).toBe('drillMissing')
    expect(policy.beforeMerge(lane).note.code).toBe('integrationRequired')
    expect(policy.beforeMerge({ ...lane, mergedTrunks: [lane.integrationTrunk] }).kind).toBe(
      'allow',
    )
  })

  it('puts needs-user items first, then failures, preserving each group order', () => {
    const { policy } = policyFixture()
    const items = [
      { id: 'progress', needsUser: false, failing: false },
      { id: 'failed', needsUser: false, failing: true },
      { id: 'question', needsUser: true, failing: false },
      { id: 'another-failed', needsUser: false, failing: true },
    ]
    expect(policy.orderReport(items)).toMatchObject({
      items: ['question', 'failed', 'another-failed', 'progress'].map((id) => ({ id })),
      note: { code: 'ownerFirst' },
    })
    expect(items[0]?.id).toBe('progress')
  })

  it('checks actual governor admission on the selected worker, CI or local target', () => {
    const fixture = policyFixture()
    const board = new FakePlaybookBoard().readBoard()
    fixture.options.checkAdmission.admit.mockReturnValue(false)
    const check = { id: 'unit', heavy: true, fullGate: false }
    expect(fixture.policy.beforeCheck(check, board)).toMatchObject({
      kind: 'refuse',
      note: { missing: ['resourceGovernor'] },
    })
    expect(fixture.options.checkAdmission.admit).toHaveBeenCalledWith(check, {
      kind: 'worker',
      id: 'macmini',
    })
  })

  it('requires a matching drill for every guard in the trusted inventory', () => {
    const fixture = policyFixture()
    const base = fakePlaybookLanes()[0]!
    fixture.options.drillRequirements.guards.mockReturnValue(['rounds', 'another-guard'])
    const drill = {
      guard: 'rounds',
      mutation: 'Raise the limit.',
      test: 'rounds',
      observedFailure: 'Expected refusal.',
      beforeSha256: 'a'.repeat(64),
      restoredSha256: 'a'.repeat(64),
    }
    const lane = { ...base, mergedTrunks: [base.integrationTrunk], drills: [drill] }
    expect(fixture.policy.beforeMerge(lane).note.code).toBe('drillMissing')
    expect(
      fixture.policy.beforeMerge({ ...lane, drills: [drill, { ...drill, guard: 'another-guard' }] })
        .kind,
    ).toBe('allow')
  })
})
