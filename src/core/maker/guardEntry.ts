// Same-build lazy guard shared by the extension, Model API and ACP packages.
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { configureHardwareSecrets, type HardwareSecretReaders } from './guardSecrets'

export { HardwareApproval } from './ports'
export { SessionHardwareGuard } from './sessionGuard'
export { isDeviceAction, isPhysicalTool } from './guard/actionClass'
export {
  hardwareAction,
  hardwareArgvAction,
  hardwareTarget,
  isHardwareStop,
} from './guard/hardwareCommands'
export { parseShell } from './guard/shellParse'
export { approvalHardwareAction, scrubHardwareApproval } from '../agent/approvalHardware'
export {
  childPermissionMode,
  allowOnceChoice,
  isReviewableApproval,
  editAutomaticallyChoice,
} from '../agent/approvalRules'
export {
  shellSecretText,
  hasApprovalSecret,
  scrubSecretSubject,
  scrubSecretChoices,
  scrubSecretApproval,
} from '../agent/approvalSecrets'

export function setHardwareText(
  table: UiText,
  locale: string,
  readers?: HardwareSecretReaders,
): void {
  setUiText(table, locale)
  if (readers !== undefined) configureHardwareSecrets(readers)
}
