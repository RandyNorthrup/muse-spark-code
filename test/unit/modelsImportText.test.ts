// The provider import/export text (src/host/models/modelsPanelEntry.ts) and
// the quick-pick origin (src/host/models/modelsQuickPick.ts): undecodable
// files fail with the panel's fixed words keeping the decoder's real
// failure as the cause, and an address the URL parser rejects shows raw.
import { expect, it } from 'vitest'
import { PROVIDER_IMPORT_MAX_BYTES, UI_TEXT } from '../../src/shared/constants'
import { decodeImportFile } from '../../src/host/models/providerImportText'
import { originOf } from '../../src/host/models/modelsQuickPick'

it('decodes valid import text as-is', () => {
  expect(decodeImportFile(new TextEncoder().encode('{"providers": []}'))).toBe('{"providers": []}')
})

it('fails an undecodable file with fixed words and the real cause', () => {
  let failure: unknown
  try {
    decodeImportFile(new Uint8Array([0xff, 0xfe, 0xfd]))
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  const thrown = failure as Error
  expect(thrown.message).toBe(UI_TEXT.textFileInvalid)
  expect(thrown.cause).toBeInstanceOf(TypeError)
})

it('fails an oversized file before decoding', () => {
  let failure: unknown
  try {
    decodeImportFile(new Uint8Array(PROVIDER_IMPORT_MAX_BYTES + 1))
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message).toBe(UI_TEXT.textFileTooLarge)
})

it('shows the URL origin, or the raw address the parser rejects', () => {
  expect(originOf('https://example.com:8443/x')).toBe('https://example.com:8443')
  for (const raw of ['', 'not a url', 'custom-scheme-value']) {
    expect(() => new URL(raw)).toThrow(TypeError)
    expect(originOf(raw)).toBe(raw)
  }
})
