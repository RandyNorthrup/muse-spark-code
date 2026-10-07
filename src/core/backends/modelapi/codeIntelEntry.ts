import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'
export {
  applyRename,
  isProtectedRename,
  planRenameCall,
  renameCardPath,
  renameHookFiles,
  renameRefused,
  runCodeIntelRead,
} from './codeIntelCalls'
export { CodeIntelRefusal } from '../../codeIntel/codeIntelQuery'
export { repoMapSection } from '../../codeIntel/repoMap'
/** Node bundles each own their language state; install the caller before use. */
export function installLanguage(table: UiText, locale: string): void {
  setUiText(table, locale)
}
