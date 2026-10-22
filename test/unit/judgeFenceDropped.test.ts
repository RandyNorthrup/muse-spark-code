// The judge fence's dropped answer: a run that settled `failed`, or never
// settled at all, reads dropped, even after read or discard — so a late
// result is never attached afterwards and the person is told instead. Real
// JudgeUse over the real entry store; the runner settles through the store
// the use hands it, or never settles.
import { describe, expect, it } from 'vitest'
import type { JudgeEntryStore } from '../../src/core/judge/entries'
import { JudgeUse } from '../../src/core/judge/use'
import type { JudgeAdvisory } from '../../src/core/judge/use'

const ACTION = {
  backend: 'modelApi',
  sessionId: 'session-1',
  turnId: 'turn-1',
  tool: 'read_file',
  args: { path: 'a.txt' },
}

function advisory(settle: 'failed' | 'caution' | 'never'): {
  judge: JudgeAdvisory
  errors: unknown[]
} {
  const errors: unknown[] = []
  const judge = new JudgeUse({
    isOn: () => true,
    createRunner: (entries: JudgeEntryStore) => ({
      judge: (job) => {
        if (settle !== 'never') entries.settle(job.entryKey, settle)
      },
    }),
    prepare: () => Promise.resolve(true),
    question: () => ({ id: 'risk', kind: 'noul', text: 'Is this risky?' }),
    onError: (error) => {
      errors.push(error)
    },
  })
  return { judge, errors }
}

describe('the judge fence', () => {
  it('reads dropped while the run never settles', () => {
    const { judge } = advisory('never')
    const fence = judge.start(ACTION, 'state')
    expect(fence?.dropped()).toBe(true)
    fence?.discard()
    expect(fence?.dropped()).toBe(true)
  })

  it('reads dropped after a failed settle, even after read', async () => {
    const { judge } = advisory('failed')
    const fence = judge.start(ACTION, 'state')
    expect(fence?.dropped()).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fence?.dropped()).toBe(true)
    fence?.read()
    expect(fence?.dropped()).toBe(true)
  })

  it('reads kept after a caution settle', async () => {
    const { judge } = advisory('caution')
    const fence = judge.start(ACTION, 'state')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fence?.dropped()).toBe(false)
    expect(fence?.read()).toBe('caution')
    expect(fence?.dropped()).toBe(false)
  })
})
