// The portable half of the import dialogs (M84, PLAN.md D49): a picked
// file's text parsed without a throw.

import { describe, expect, it } from 'vitest'
import {
  decodeTransferBytes,
  readTransferDocument,
} from '../../src/host/conversation/sessionImport'
import { UI_TEXT } from '../../src/shared/constants'
import { CURRENT_SHAPE_KEYS } from './helpers/modelApiKeys'

describe('readTransferDocument', () => {
  it('reads a syntax error as a failed parse', () => {
    const parsed = readTransferDocument('{not json')
    expect(parsed.ok).toBe(false)
    expect(readTransferDocument('{}')).toEqual({ ok: false, reason: UI_TEXT.transferNotAnExport })
  })

  it('uses a fixed localized refusal when JSON syntax surrounds credentials', () => {
    const [key] = CURRENT_SHAPE_KEYS
    const input = `{"credential":"${key}", broken}`
    expect(readTransferDocument(input)).toEqual({ ok: false, reason: UI_TEXT.transferNotAnExport })
  })
})

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
