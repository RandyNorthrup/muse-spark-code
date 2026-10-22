import { describe, expect, it } from 'vitest'
import { judgeStatusSchema } from '../../src/shared/judge'
import { createJudgeUse } from '../../src/host/judge/judgeUse'
import { resolveJudgeMode2a } from '../../src/core/judge/resolve'
import type { JudgeStatus } from '../../src/shared/judge'
import type { JudgeEntryStore } from '../../src/core/judge/entries'
import type { JudgeUseJob } from '../../src/core/judge/use'
import type { JudgeQuestion } from '../../src/core/judge/schema'
import { wiringFixture } from './helpers/judgeWiring'

const JUDGE_ACTION = {
  backend: 'modelApi',
  sessionId: 's1',
  turnId: 't1',
  tool: 'bash',
  args: { command: 'npm test' },
} as const

const RISK_QUESTION: JudgeQuestion = {
  type: 'noul',
  instructions: 'Can this action irreversibly delete data or change shared state?',
}

function host() {
  const fixture = wiringFixture()
  let current = { ...fixture.context, engine: 'same' }
  const jobs: { entries: JudgeEntryStore; job: JudgeUseJob }[] = []
  const statuses: JudgeStatus[] = []
  const errors: unknown[] = []
  const notices: string[] = []
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
    onStatus: (status) => {
      statuses.push(status)
    },
    onError: (error) => {
      errors.push(error)
    },
    notice: (text) => {
      notices.push(text)
    },
  })
  return {
    fixture,
    jobs,
    judge,
    statuses,
    errors,
    notices,
    change: (value: Partial<typeof current>) => {
      current = { ...current, ...value }
    },
  }
}

/** Wait for the runner to take the started job, failing on a 2 s stall. */
async function waitForJobs(rig: ReturnType<typeof host>): Promise<void> {
  const started = Date.now()
  while (rig.jobs.length === 0) {
    if (Date.now() - started > 2000) throw new Error('judge runner never took the job')
    await new Promise((resolve) => setTimeout(resolve, 5))
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
    await waitForJobs(rig)
    expect(rig.statuses).toHaveLength(1)
    expect(rig.statuses[0]).toMatchObject({ mode: 'both', reason: 'auto-both' })
  })
  it.each(['endpoint', 'profileId', 'ownerId', 'turn'] as const)(
    'refuses a ready verdict after its %s identity changes',
    async (field) => {
      const rig = host()
      const fence = rig.judge.start(JUDGE_ACTION, 'state')
      await waitForJobs(rig)
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
    const resolved = (candidate: unknown) =>
      resolveJudgeMode2a({
        ...fixture.context,
        separate: {
          available: true,
          verified: true,
          profilesReady: true,
          adoption: { ...fixture.adoption, record: candidate, context },
        },
      }).mode
    expect(resolved(record)).toBe('both')
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
      expect(resolved(bad)).toBe('same')
    expect(
      resolveJudgeMode2a({
        ...fixture.context,
        separate: {
          available: true,
          verified: true,
          profilesReady: true,
          adoption: {
            ...fixture.adoption,
            record,
            context: { ...context, modelId: 'replacement' },
          },
        },
      }).mode,
    ).toBe('same')
  })
})
