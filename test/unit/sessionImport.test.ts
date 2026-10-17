// The portable half of the import dialogs (M84, PLAN.md D49): a picked
// file's text parsed without a throw.

import { describe, expect, it } from 'vitest'
import { readTransferDocument } from '../../src/host/conversation/sessionImport'
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
