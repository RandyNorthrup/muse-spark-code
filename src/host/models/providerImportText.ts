// A picked provider file's text, shared by the Models panel and the
// provider quick pick (both read provider JSON): too-large and undecodable
// files fail with the panel's fixed words, keeping the decoder's real
// failure as the cause. VS Code-free, so the unit tests can drive it.
import { PROVIDER_IMPORT_MAX_BYTES, UI_TEXT } from '../../shared/constants'

/**
 * The picked file's text: too-large and undecodable files fail with the
 * panel's fixed words, keeping the decoder's real failure as the cause.
 */
export function decodeImportFile(bytes: Uint8Array): string {
  if (bytes.length > PROVIDER_IMPORT_MAX_BYTES) {
    throw new Error(UI_TEXT.textFileTooLarge)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error: unknown) {
    throw new Error(UI_TEXT.textFileInvalid, { cause: error })
  }
}
