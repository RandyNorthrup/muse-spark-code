// convertToMp4's failure handling (D119 catch burn-down): a conversion that
// fails with no output keeps the fixed sentence for the person and carries
// the failure itself on the result for the caller. The missing input below
// is a real absent file, so the read fails for real in node:fs. The
// conversion runs with the product's own bindings (a private folder inside
// a verified private root), which Windows requires before it converts.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertToMp4 } from '../../src/core/media/convert'
import { conversionBindings } from '../../src/host/backend/productionAudioEntry'
import { openPrivateRoot } from '../../src/runtime/privateDirectory'
import { usingTempDir } from './helpers/temporaryFolders'

describe('convertToMp4 failures', () => {
  it('carries a missing input with its cause instead of dropping it', async () => {
    await usingTempDir('muse-convert-', async (folder) => {
      const options = await conversionBindings(undefined, () =>
        openPrivateRoot(path.join(folder, 'media')),
      )
      const missing = path.join(folder, 'muse-convert-missing-input.mp4')
      const result = await convertToMp4(
        missing,
        { kind: 'ffmpeg', command: '/usr/bin/ffmpeg' },
        options,
      )
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.reason).toEqual(expect.any(String))
      expect(result.cause).toMatchObject({ code: 'ENOENT' })
    })
  })
})
