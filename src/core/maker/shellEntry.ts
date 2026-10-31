// Same-build first-use shell parser/policy, shared by Node hosts and the guard.
export {
  hardwareAction,
  hardwareArgvAction,
  hardwareTargets,
  isHardwareStop,
  hardwareStop,
} from './guard/hardwareCommands'
export { parseShell } from './guard/shellParse'
export { isHardwareWorkspace, hardwareShellNote } from './guard/shellPolicy'
export { setUiText as setHardwareText } from '../../shared/l10n/text'
