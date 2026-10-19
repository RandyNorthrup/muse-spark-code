// The picked-file byte decoder behind the import dialog (M84): valid
// UTF-8 decoded, anything else refused in fixed words with its cause,
// through the real TextDecoder.

import { describe, expect, it } from 'vitest'
import { decodeTransferBytes } from '../../src/host/backend/toolIo'
import { UI_TEXT } from '../../src/shared/constants'

describe('decodeTransferBytes', () => {
  it('decodes valid UTF-8, dropping a byte-order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])
    expect(decodeTransferBytes(bytes)).toBe('{}')
  })

  it('refuses invalid UTF-8 in fixed words carrying the decoder failure', () => {
    // A lone continuation byte: the real TextDecoder with fatal on refuses it.
    let caught: unknown
    try {
      decodeTransferBytes(new Uint8Array([0x7b, 0x80, 0x7d]))
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    const refused = caught as Error
    expect(refused.message).toBe(UI_TEXT.textFileInvalid)
    expect(refused.cause).toBeInstanceOf(TypeError)
  })
})
