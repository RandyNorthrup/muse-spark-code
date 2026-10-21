import { describe, expect, it } from 'vitest'
import { usableReply } from '../../src/core/turns/usableReply'

describe('usableReply', () => {
  it('yields the reply only for a turn that completed without a limit', () => {
    expect(usableReply({ terminal: 'completed' }, 'answer')).toEqual({
      usable: true,
      reply: 'answer',
    })
  })

  it('withholds a capped turn reply as capped, never as the answer', () => {
    expect(
      usableReply({ terminal: 'completed', errorKind: 'max_turn_requests' }, 'what is done'),
    ).toEqual({ usable: false, capped: true })
  })

  it('withholds any other ending as not capped', () => {
    expect(usableReply({ terminal: 'cancelled' }, 'answer')).toEqual({
      usable: false,
      capped: false,
    })
    expect(usableReply({ terminal: 'failed', errorKind: 'modelApi' }, 'answer')).toEqual({
      usable: false,
      capped: false,
    })
    expect(usableReply({}, 'answer')).toEqual({ usable: false, capped: false })
  })

  it('withholds a missing reply even on a clean completion', () => {
    expect(usableReply({ terminal: 'completed' }, undefined)).toEqual({
      usable: false,
      capped: false,
    })
  })

  it('carries non-string replies for structured consumers', () => {
    const block = { findings: [] as const }
    const usable = usableReply({ terminal: 'completed' }, block)
    expect(usable).toEqual({ usable: true, reply: block })
  })
})
