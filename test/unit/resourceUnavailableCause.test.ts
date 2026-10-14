import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { resourceUnavailableCause, warnResourceUnavailable } from '../../src/shared/resourceCause'

describe('resource unavailable cause', () => {
  it('keeps the reason a sampler or admission check gave', () => {
    expect(resourceUnavailableCause(new Error('device journal is not writable: EACCES'))).toContain(
      'EACCES',
    )
    expect(resourceUnavailableCause('gone')).toBe('gone')
  })

  it('says nothing instead of inventing a reason', () => {
    expect(resourceUnavailableCause(new DOMException(''))).toBeUndefined()
    expect(resourceUnavailableCause(undefined)).toBeUndefined()
  })

  it('redacts secrets from the cause', () => {
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345'
    expect(resourceUnavailableCause(new Error(`read failed for ${secret}`))).not.toContain(secret)
  })

  it('warns with the cause when there is one', () => {
    const lines: string[] = []
    warnResourceUnavailable(
      (message) => {
        lines.push(message)
      },
      EN,
      new Error('device journal is not writable: EACCES'),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('unavailable on this machine')
    expect(lines[0]).toContain('EACCES')
  })
})
