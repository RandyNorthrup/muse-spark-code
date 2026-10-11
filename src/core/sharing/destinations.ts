import type { ChatSharePreview, ChatShareReleasePort } from './shareRelease'
import { UI_TEXT } from '../../shared/constants'

/** Host adapters supply their real clipboard, guarded writer and local browser opener. */
export interface ChatShareLocalDestinations {
  readonly copy: (content: string, admit: () => void) => Promise<void>
  readonly chooseFile: (fileName: string) => Promise<string | undefined>
  /** Choose a private local destination without creating it during preparation. */
  readonly browserFile: (fileName: string) => Promise<string>
  /** Recheck `admit` after any internal async guard, immediately before writing. */
  readonly writeFile: (path: string, content: string, admit: () => void) => Promise<void>
  /** Only a local file, with another admission after the file write settles. */
  readonly openBrowser: (path: string, admit: () => void) => Promise<void>
}

/** Prepare only after the final click; every actual sink starts after a fresh admission. */
export function chatShareDestination(
  port: ChatShareLocalDestinations,
): ChatShareReleasePort['prepare'] {
  return async (preview: ChatSharePreview) => {
    switch (preview.request.destination) {
      case 'copy': {
        return async (admit) => {
          admit()
          await port.copy(preview.content, admit)
        }
      }
      case 'file': {
        const path = await port.chooseFile(preview.fileName)
        if (path === undefined) return
        return async (admit) => {
          admit()
          await port.writeFile(path, preview.content, admit)
        }
      }
      case 'browser': {
        const path = await port.browserFile(preview.fileName)
        return async (admit) => {
          admit()
          await port.writeFile(path, preview.content, admit)
          admit()
          await port.openBrowser(path, admit)
        }
      }
      default: {
        throw new Error(UI_TEXT.sharePreviewExpired)
      }
    }
  }
}
