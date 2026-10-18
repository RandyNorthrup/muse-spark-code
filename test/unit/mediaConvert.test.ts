// convertToMp4's failure handling (D119 catch burn-down): a conversion that
// fails with no output keeps the fixed sentence for the person and carries
// the failure itself on the result for the caller. The missing input below
// is a real absent file, so the read fails for real in node:fs.
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertToMp4 } from '../../src/core/media/convert'

describe('convertToMp4 failures', () => {
  it('carries a missing input with its cause instead of dropping it', async () => {
    const missing = path.join(tmpdir(), 'muse-convert-missing-input.mp4')
    const result = await convertToMp4(missing, { kind: 'ffmpeg', command: '/usr/bin/ffmpeg' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toEqual(expect.any(String))
    expect(result.cause).toMatchObject({ code: 'ENOENT' })
  })
})
