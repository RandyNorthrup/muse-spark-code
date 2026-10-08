// Refuse ambiguous Win32 names; never turn a model spelling into a guessed target.
// The held-tree list is deliberately conservative (including spaces before extensions).
import { MODEL_TEXT } from '../shared/constants'

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[\d¹²³]|lpt[\d¹²³]) *(?:\..*)?$/iu
const WINDOWS_TRAILING = /[. ]$/u
const WINDOWS_PREFIX = /^(?:\/\/[?.](?:\/|$)|\/\?\?\/)/u

export function isUncPath(given: string): boolean {
  const forward = given.replaceAll('\\', '/')
  return forward.startsWith('//') && !WINDOWS_PREFIX.test(forward)
}

/** UNC is admitted only when the caller also proves ancestry in a UNC workspace. */
export function windowsPathProblem(
  given: string,
  platform: NodeJS.Platform,
  workspaceRoot?: string,
): string | undefined {
  if (platform !== 'win32') return undefined
  const forward = given.replaceAll('\\', '/')
  if (WINDOWS_PREFIX.test(forward)) return MODEL_TEXT.windowsDeviceNamespace
  if (isUncPath(given) && (workspaceRoot === undefined || !isUncPath(workspaceRoot))) {
    return MODEL_TEXT.windowsUncOutsideWorkspace
  }
  const withoutDrive = forward.replace(/^[a-z]:/iu, '')
  if (withoutDrive.includes(':')) return MODEL_TEXT.windowsAlternateStream
  for (const segment of withoutDrive.split('/')) {
    // Navigation components are resolved by the caller's containment check.
    if (segment === '.' || segment === '..') continue
    if (WINDOWS_DEVICE.test(segment)) return MODEL_TEXT.windowsReservedDevice
    if (WINDOWS_TRAILING.test(segment)) return MODEL_TEXT.windowsTrailingName
  }
  return undefined
}
