// Refuse ambiguous Win32 names; never turn a model spelling into a guessed target.
// Every rule is drive-letter generic: Windows, the profile, the workspace and
// the extension's storage may each be on any letter.
import { MODEL_TEXT } from '../shared/constants'

const DEVICE_STEM = String.raw`(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])`
// A reserved device: the bare name, or the name followed only by dots or
// spaces (a colon or stream is refused as a stream). `con.d`, `aux.js` and
// `nul.txt` are ordinary names on Windows 11, judged by their identity.
const WINDOWS_DEVICE = new RegExp(String.raw`^${DEVICE_STEM}[. ]*$`, 'iu')
// Pull-request trees stay conservative (any extension, a space before it, COM0):
// older Windows and Git for Windows still refuse those names.
const WINDOWS_DEVICE_LIKE =
  /^(?:con|prn|aux|nul|conin\$|conout\$|com[\d¹²³]|lpt[\d¹²³]) *(?:\..*)?$/iu
const WINDOWS_TRAILING = /[. ]$/u
const WINDOWS_PREFIX = /^(?:\/\/[?.](?:\/|$)|\/\?\?\/)/u
// `X:` with no separator after it resolves against that drive's current folder.
const DRIVE_RELATIVE = /^[a-z]:(?!\/)/iu
const LOCAL_VERBATIM = /^\\\\\?\\([a-z]:\\)/iu

/**
 * Muse Code names local files `\\?\X:\…`: the same file as `X:\…`, the
 * prefix only turning off Win32 normalization, so the segment rules still
 * apply after it. `\\?\UNC\`, `\\?\Volume{…}`, `\\?\GLOBALROOT`, `\\.\` and
 * `\??\` keep their prefix and stay refused.
 */
export function normalWindowsPath(given: string): string {
  return given.replace(LOCAL_VERBATIM, '$1')
}

/** A pull-request tree name that some Windows or Git release treats as a device. */
export function isWindowsDeviceLike(name: string): boolean {
  return WINDOWS_DEVICE_LIKE.test(name)
}

export function isUncPath(given: string): boolean {
  const forward = normalWindowsPath(given).replaceAll('\\', '/')
  return forward.startsWith('//') && !WINDOWS_PREFIX.test(forward)
}

/** UNC is admitted only when the caller also proves ancestry in a UNC workspace. */
export function windowsPathProblem(
  given: string,
  platform: NodeJS.Platform,
  workspaceRoot?: string,
): string | undefined {
  if (platform !== 'win32') return undefined
  const forward = normalWindowsPath(given).replaceAll('\\', '/')
  if (WINDOWS_PREFIX.test(forward)) return MODEL_TEXT.windowsDeviceNamespace
  if (DRIVE_RELATIVE.test(forward)) return MODEL_TEXT.windowsDriveRelative
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
