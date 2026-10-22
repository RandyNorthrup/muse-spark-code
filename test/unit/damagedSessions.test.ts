// Damaged-session markers are never forgotten: every marker is kept, and
// remarking changes nothing — forgetting one only bought its next message
// Muse Code's own error again. Pure through the real marker function.
import { describe, expect, it } from 'vitest'
import { markedDamagedIds } from '../../src/host/conversation/damagedSessions'

describe('markedDamagedIds', () => {
  it('adds the session and keeps every marker', () => {
    const marked = markedDamagedIds(['a', 'b'], 'c')
    expect(marked).toEqual(['a', 'b', 'c'])
    expect(markedDamagedIds(marked, 'd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('changes nothing when the session is already marked', () => {
    const marked = markedDamagedIds(['a'], 'a')
    expect(marked).toEqual(['a'])
  })
})
