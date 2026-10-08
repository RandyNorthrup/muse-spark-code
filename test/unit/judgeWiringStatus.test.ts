import { describe, expect, it, vi } from 'vitest'
import { judgeStatusSchema } from '../../src/shared/judge'
import { createJudgeUse } from '../../src/host/judge/judgeUse'
import { resolveJudgeMode2a } from '../../src/core/judge/resolve'
import { hasJudgeAdoptionEvidence } from '../../src/core/judge/adoption'
import type { JudgeEntryStore } from '../../src/core/judge/entries'
import type { JudgeUseJob } from '../../src/core/judge/use'
import { JUDGE_ACTION, RISK_QUESTION } from './helpers/judgeUseRig'
import { wiringFixture } from './helpers/judgeWiring'

function host() {
  const fixture = wiringFixture()
  let current = { ...fixture.context, engine: 'same' }
  const jobs: { entries: JudgeEntryStore; job: JudgeUseJob }[] = []
  const onStatus = vi.fn()
  const judge = createJudgeUse({
    backend: 'modelApi',
    context: () => current,
    allowsPaidJudge: () => Promise.resolve(true),
    createRunner: (entries) => ({
      judge: (job) => {
        jobs.push({ entries, job })
      },
    }),
    question: () => RISK_QUESTION,
    onStatus,
    onError: vi.fn(),
    notice: vi.fn(),
  })
  return {
    fixture,
    jobs,
    judge,
    onStatus,
    change: (value: Partial<typeof current>) => {
      current = { ...current, ...value }
    },
  }
}

describe('phase-2 status and host trigger wiring', () => {
  it('accepts both and separate status with every phase-2 reason across the shared boundary', () => {
    for (const reason of [
      'auto-both',
      'explicit-both',
      'explicit-separate',
      'source-untested',
      'profile-missing',
    ]) {
      expect(
        judgeStatusSchema.safeParse({
          mode: 'both',
          reason,
          modelId: 'chosen',
          billing: 'modelApi',
        }).success,
      ).toBe(true)
    }
  })
  it('keeps auto same when verified sources and profiles have no recorded held-out evidence', () => {
    const fixture = wiringFixture()
    expect(
      resolveJudgeMode2a({
        ...fixture.context,
        separate: { available: true, verified: true, profilesReady: true },
      }),
    ).toMatchObject({ mode: 'same', autoSameReason: 'evidence-missing' })
  })
  it('reaches both through the host resolver only with matched profiles and held-out paired M75 rows', async () => {
    const rig = host()
    rig.change({ engine: 'auto' })
    rig.judge.start(JUDGE_ACTION, 'state')
    await vi.waitFor(() => {
      expect(rig.jobs).toHaveLength(1)
    })
    expect(rig.onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'both', reason: 'auto-both' }),
    )
  })
  it.each(['endpoint', 'profileId', 'ownerId', 'turn'] as const)(
    'refuses a ready verdict after its %s identity changes',
    async (field) => {
      const rig = host()
      const fence = rig.judge.start(JUDGE_ACTION, 'state')
      await vi.waitFor(() => {
        expect(rig.jobs).toHaveLength(1)
      })
      const call = rig.jobs[0]
      if (call === undefined) throw new Error('missing job')
      expect(call.entries.settle(call.job.entryKey, 'caution')).toBe(true)
      rig.change({ [field]: 'replacement' })
      expect(fence?.read()).toBeUndefined()
    },
  )
  it('rejects forged evidence, overlapping groups, stale profiles and a worse cascade', () => {
    const fixture = wiringFixture()
    const { record, context } = fixture.adoption
    expect(hasJudgeAdoptionEvidence(record, context)).toBe(true)
    for (const bad of [
      {
        ...record,
        same: { ...record.same, dataset: { ...record.same.dataset, evidence: 'synthetic' } },
      },
      { ...record, rows: record.rows.map((row) => ({ ...row, taskGroup: 'fit-task' })) },
      {
        ...record,
        rows: record.rows.map((row) => ({
          ...row,
          both: { ...row.both, probability: 1 - row.both.probability },
        })),
      },
    ])
      expect(hasJudgeAdoptionEvidence(bad, context)).toBe(false)
    expect(hasJudgeAdoptionEvidence(record, { ...context, modelId: 'replacement' })).toBe(false)
  })
})
