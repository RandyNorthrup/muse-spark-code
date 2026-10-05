import { vi, expect } from 'vitest'
import type { JudgeEntryStore, JudgeEntryParts } from '../../../src/core/judge/entries'
import { JudgeUse, type JudgeUseJob, type JudgeFence } from '../../../src/core/judge/use'

export const JUDGE_ACTION = {
  backend: 'modelApi',
  sessionId: 's1',
  turnId: 't1',
  tool: 'bash',
  args: { command: 'npm test' },
}
export const RISK_QUESTION = {
  id: 'risk',
  kind: 'noul' as const,
  text: 'Can this action irreversibly delete data or change shared state?',
}

export function judgeUseRig(
  options: {
    on?: () => boolean
    prepare?: () => Promise<boolean>
    outcome?: 'caution' | 'none' | 'failed' | undefined
  } = {},
) {
  const jobs: { job: JudgeUseJob; entries: JudgeEntryStore; signal: AbortSignal }[] = []
  const onFence = vi.fn()
  const onError = vi.fn()
  const prepare = vi.fn(options.prepare ?? (() => Promise.resolve(true)))
  const createRunner = vi.fn(
    (entries: JudgeEntryStore, _action: JudgeEntryParts, signal: AbortSignal) => ({
      judge: (job: JudgeUseJob) => {
        jobs.push({ job, entries, signal })
        if (options.outcome !== undefined) entries.settle(job.entryKey, options.outcome)
      },
    }),
  )
  const judge = new JudgeUse({
    isOn: options.on ?? (() => true),
    prepare,
    createRunner,
    question: () => RISK_QUESTION,
    onFence,
    onError,
  })
  const settle = (outcome: 'caution' | 'none' | 'failed', index = 0) => {
    const call = jobs[index]
    if (call === undefined) throw new Error('No judge job')
    return call.entries.settle(call.job.entryKey, outcome)
  }
  const showCard = async (fence: JudgeFence | undefined) => {
    const note = vi.fn()
    fence?.card(note)
    await vi.waitFor(() => {
      expect(jobs).toHaveLength(1)
    })
    return note
  }
  return { judge, jobs, prepare, createRunner, onFence, onError, settle, showCard }
}

/** Ordinary choices on an extension-owned card, never a guessed MSP parser field. */
export const JUDGE_CARD_CHOICES = [
  { choiceId: 'allow_once', label: 'Allow once', decision: 'approved', scope: 'once' },
  { choiceId: 'abort', label: 'Reject', decision: 'abort', scope: 'once' },
] as const
