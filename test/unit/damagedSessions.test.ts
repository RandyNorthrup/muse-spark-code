// B23: damaged-session markers are never forgotten past a cap. Marking
// appends the id, remarking changes nothing, and no count bound drops older
// markers. Pure through the real module, values passed in as data.
import { describe, expect, it } from 'vitest'
import { markedDamagedIds } from '../../src/host/conversation/damagedSessions'

describe('markedDamagedIds', () => {
  it('marks a newly damaged session', () => {
    expect(markedDamagedIds([], 's1')).toEqual(['s1'])
    expect(markedDamagedIds(['s1'], 's2')).toEqual(['s1', 's2'])
  })

  it('leaves a re-marked session where it is', () => {
    expect(markedDamagedIds(['s1', 's2'], 's1')).toEqual(['s1', 's2'])
  })

  it('keeps every marker past the old cap instead of forgetting the oldest', () => {
    const damaged = Array.from({ length: 50 }, (_, index) => `s${String(index)}`)
    const marked = markedDamagedIds(damaged, 's50')
    expect(marked).toHaveLength(51)
    expect(marked[0]).toBe('s0')
    expect(marked[50]).toBe('s50')
  })
})
