import type { AgentEvent } from '../../src/shared/agentEvents'
import { describe, expect, it, vi } from 'vitest'
import { JudgeUsageRows } from '../../src/host/judge/judgeUsage'
import { FakeLogOutputChannel } from './helpers/fakes'
import { PaidUsage } from '../../src/core/paid/paidFeatures'

function rows(billing: 'subscription' | 'modelApi') {
  const usage = new PaidUsage(new FakeLogOutputChannel())
  const emit = vi.fn<(event: AgentEvent) => void>()
  return { usage, emit, rows: new JudgeUsageRows({ billing, usage, emit }) }
}

const USAGE = { inputTokens: 1000, cachedTokens: 500, outputTokens: 100, reasoningTokens: 0 }

describe('admitted Judge usage rows', () => {
  it('marks a paid dispatch separately and counts its known receipt once', () => {
    const rig = rows('modelApi')
    rig.rows.started('j1', 't1', 'muse-spark-1.3')
    expect(rig.emit).toHaveBeenCalledWith({
      type: 'itemStarted',
      item: expect.objectContaining({ tool: 'judge', paid: 'judge', status: 'inProgress' }),
    })
    expect(rig.usage.current).toMatchObject({ judgeCalls: 1, judgeUnknownRequests: 1 })
    rig.rows.finished('j1', USAGE)
    rig.rows.finished('j1', USAGE)
    expect(rig.usage.current).toMatchObject({
      judgeCalls: 1,
      judgeTokens: 1100,
      judgeCostUsd: 0.001125,
      judgeUnknownRequests: 0,
    })
    expect(rig.emit).toHaveBeenCalledTimes(2)
    expect(rig.emit).toHaveBeenLastCalledWith({
      type: 'itemCompleted',
      item: expect.objectContaining({ status: 'completed', usage: USAGE }),
    })
  })

  it('retains unknown liability for missing, failed or malformed receipts', () => {
    const rig = rows('modelApi')
    for (const id of ['j1', 'j2', 'j3']) rig.rows.started(id, 't1', 'muse-spark-1.3')
    rig.rows.finished('j1', undefined)
    rig.rows.failed('j2')
    expect(() => {
      rig.rows.finished('j3', { ...USAGE, inputTokens: -1 })
    }).toThrow()
    rig.rows.failed('j3')
    rig.rows.failed('j2')
    expect(rig.usage.current).toMatchObject({ judgeCalls: 3, judgeUnknownRequests: 3 })
    expect(rig.usage.current.judgeCostUsd).toBeUndefined()
    expect(rig.emit).toHaveBeenCalledTimes(6)
    expect(() => {
      rig.rows.started('j4', 't1', 'muse-spark-1.3')
    }).not.toThrow()
    expect(() => {
      rig.rows.started('j4', 't1', 'muse-spark-1.3')
    }).toThrow('already started')
  })

  it('shows subscription dispatches without paid markings or key billing', () => {
    const rig = rows('subscription')
    rig.rows.started('j1', 't1', 'muse-spark-1.3')
    rig.rows.finished('j1', USAGE)
    const start = rig.emit.mock.calls[0]?.[0]
    if (start?.type !== 'itemStarted') throw new Error('No started row')
    expect(start.item).not.toHaveProperty('paid')
    expect(rig.usage.current.judgeCalls).toBeUndefined()
    expect(rig.usage.current.judgeTokens).toBeUndefined()
  })
})
