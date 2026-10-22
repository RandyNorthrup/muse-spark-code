// A rejected journal append names its failing field (RLUSAGE, branch 02's
// loud validation errors): the real store over a real folder, an entry no
// schema accepts, and the once-only write diagnostic. Its own file because
// the store's once-per-run gate spends itself on the first failure.
import { describe, expect, it } from 'vitest'
import { captureWriteErrors } from './helpers/writeErrorCapture'

describe('usage journal append rejection', () => {
  it('names the failing field when an appended entry is rejected', async () => {
    const { store, errors } = captureWriteErrors('usage-append-invalid-')
    store.append({ v: 1, type: 'usage', id: '' })
    await store.flush()
    expect(errors).toHaveLength(1)
    expect(errors[0]?.code).toBe('usageWriteFailed')
    expect(errors[0]?.reason).toContain('id')
  })
})
