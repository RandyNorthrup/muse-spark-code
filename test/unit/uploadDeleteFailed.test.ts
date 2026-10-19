// The delete-failure notice reads the ledger's explicit failure by its fixed
// name: the ledger rides in another bundle, so the panel cannot rely on
// instanceof across the bundle's own copy of the class.
import { describe, expect, it } from 'vitest'
import { UploadDeleteFailedError } from '../../src/core/media/uploadLedger'
import { isUploadDeleteFailed } from '../../src/host/conversation/conversationController'

describe('upload delete failure notice', () => {
  it('names the display name from the ledger failure itself', () => {
    const error = new UploadDeleteFailedError('clip.mp4')
    expect(isUploadDeleteFailed(error)).toBe(true)
    if (isUploadDeleteFailed(error)) expect(error.fileName).toBe('clip.mp4')
  })

  it('still matches another bundle copy carrying the fixed name', () => {
    // Another bundle's own copy of the class: a different identity with the
    // same fixed name and display-name shape.
    class ForeignUploadDeleteFailedError extends Error {
      public override readonly name = 'UploadDeleteFailedError'
      public constructor(public readonly fileName: string) {
        super('Upload deletion failed')
      }
    }
    expect(isUploadDeleteFailed(new ForeignUploadDeleteFailedError('clip.mp4'))).toBe(true)
  })

  it('falls back for anything else the delete can throw', () => {
    expect(isUploadDeleteFailed(new Error('nope'))).toBe(false)
    class NamelessUploadDeleteFailedError extends Error {
      public override readonly name = 'UploadDeleteFailedError'
    }
    expect(isUploadDeleteFailed(new NamelessUploadDeleteFailedError('nope'))).toBe(false)
    expect(isUploadDeleteFailed(undefined)).toBe(false)
    expect(isUploadDeleteFailed('UploadDeleteFailedError')).toBe(false)
  })
})
