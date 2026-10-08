// Windows name aliases are compared conservatively even on other platforms
// when a protocol must not depend on the receiver's file system.
import path from 'node:path'

/** Conservative final-name policy for workspace/held-tree name refusals. */
export function windowsName(name: string): string {
  return name.replace(/[. ]+$/u, '')
}

/** Ordinary Win32 lexical identity; links and short names require a realpath first.
 * GetFullPathName drops a single intermediate period, but retains multiple
 * periods and spaces there. Only a path without a final separator loses all
 * trailing periods/spaces. Exact extended paths bypass that normalization.
 * https://learn.microsoft.com/en-us/dotnet/standard/io/file-path-formats#path-normalization
 */
export function windowsPathIdentity(value: string): string {
  if (value.startsWith('\\\\?\\')) {
    const extended = value.slice('\\\\?\\'.length).replaceAll('\\', '/')
    return (
      extended.startsWith('UNC/') ? `//${extended.slice('UNC/'.length)}` : extended
    ).toLowerCase()
  }
  const segments = path.win32.normalize(value).replaceAll('\\', '/').split('/')
  const normalized = segments.map((name, index) =>
    index === segments.length - 1 ? windowsName(name) : name.replace(/(?<=[^.])\.$/u, ''),
  )
  // Windows 11 redirects an exact terminal DOS device name independently of
  // its directory. Extensions remain file names (workspace policy refuses both).
  const device = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/iu.exec(
    normalized.at(-1) ?? '',
  )
  const deviceName = device?.[1]
  return deviceName === undefined
    ? normalized
        .join('/')
        .replace(/(?<=[^:])\/$/u, '')
        .toLowerCase()
    : `//./${deviceName.toLowerCase()}`
}
