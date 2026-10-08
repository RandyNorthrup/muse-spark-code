// Windows name aliases are compared conservatively even on other platforms
// when a protocol must not depend on the receiver's file system.
import path from 'node:path'

/** The name Windows opens after dropping trailing dots and spaces. */
export function windowsName(name: string): string {
  return name.replace(/[. ]+$/u, '')
}

/** Separator, segment and case identity for a Windows path; never resolves links. */
export function windowsPathIdentity(value: string): string {
  return path.win32
    .normalize(value)
    .replaceAll('\\', '/')
    .split('/')
    .map((name) => windowsName(name))
    .join('/')
    .toLowerCase()
}
