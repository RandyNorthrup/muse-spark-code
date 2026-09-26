import { describe, expect, it, vi } from 'vitest'
import { AcpPaidFeatures } from '../../src/acp/paid'

// M63c (PLAN.md D30, D62): the agent's paid features, off until the flag and
// the accepted price, asked once however many prompts are waiting.

function logger() {
  return { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('AcpPaidFeatures', () => {
  it('asks once for prompts that arrive together, and keeps the answer', async () => {
    const paid = new AcpPaidFeatures(['webSearch'], logger())
    const answer = Promise.withResolvers<boolean>()
    const priceQuestion = vi.fn(() => answer.promise)
    const first = paid.settle(priceQuestion)
    const second = paid.settle(priceQuestion)
    expect(paid.isOn('webSearch')).toBe(false)
    answer.resolve(true)
    await Promise.all([first, second])
    await paid.settle(priceQuestion)
    expect(priceQuestion).toHaveBeenCalledTimes(1)
    expect(paid.isOn('webSearch')).toBe(true)
    expect(paid.isOn('imageGeneration')).toBe(false)
  })

  it('asks for nothing that was not flagged', async () => {
    const paid = new AcpPaidFeatures([], logger())
    const priceQuestion = vi.fn(() => Promise.resolve(true))
    await paid.settle(priceQuestion)
    expect(priceQuestion).not.toHaveBeenCalled()
    expect(paid.isOn('webSearch')).toBe(false)
  })

  it('tallies billed uses in the log', () => {
    const log = logger()
    const paid = new AcpPaidFeatures(['imageGeneration'], log)
    paid.noteUse('imageGeneration', 1)
    paid.noteUse('imageGeneration', 2)
    expect(log.info).toHaveBeenLastCalledWith(
      'Paid use of imageGeneration: 2, 3 since the agent started',
    )
  })
})
