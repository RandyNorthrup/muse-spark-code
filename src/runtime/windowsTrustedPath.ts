import { lstat, realpath } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import type { TrustedPathVerifier } from './trustedPathPort'

/** OpenSSH safe_path/StrictModes, with Windows replacement rights and SID owners.
 * https://github.com/openssh/openssh-portable/blob/master/misc.c (safe_path).
 * InheritOnly does not apply here. Only the drive root may grant folder-only
 * CreateDirectories/AppendData: it creates siblings, never replaces our child.
 * Scheduler objects further restrict trusted SIDs to user/SYSTEM/Administrators. */
export const WINDOWS_TRUSTED_ACL_SCRIPT = `function Test-TrustedAcl($acl, [bool]$isRoot, [bool]$isDirectory, [bool]$isTask = $false) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $trusted = @($identity.User.Value, 'S-1-5-18', 'S-1-5-32-544')
  if (-not $isTask) { $trusted += 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464' }
  if ($trusted -notcontains $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value) { return $false }
  foreach ($ace in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($ace.AccessControlType -ne 'Allow' -or $trusted -contains $ace.IdentityReference.Value) { continue }
    if (($ace.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    $rights = [int]$ace.FileSystemRights
    if (($rights -band 0x500D0152) -ne 0) { return $false }
    if (($rights -band 4) -ne 0 -and -not ($isRoot -and $isDirectory -and $ace.InheritanceFlags -eq 'None' -and $ace.PropagationFlags -eq 'None')) { return $false }
  }
  return $true
}`

function* components(file: string): Generator<string> {
  let component = file
  for (;;) {
    yield component
    const parent = path.win32.dirname(component)
    if (parent === component) return
    component = parent
  }
}

export function windowsTrustedPathVerifier(
  run: (file: string, args: readonly string[]) => Promise<{ exitCode: number; stdout: string }>,
  io?: {
    realpath: (file: string) => Promise<string>
    lstat: (file: string) => Promise<Pick<Stats, 'isFile' | 'isDirectory' | 'isSymbolicLink'>>
  },
): TrustedPathVerifier {
  const files = io ?? { lstat, realpath }
  return {
    async verify(file, { leafKind }) {
      let component = file
      try {
        if (!path.win32.isAbsolute(file) || /\p{Cc}/u.test(file))
          return { refused: true, component, reason: 'absolute path required' }
        const canonical = await files.realpath(file)
        const checked = new Set<string>()
        for (const initial of [path.win32.normalize(file), path.win32.normalize(canonical)]) {
          for (const candidate of components(initial)) {
            component = candidate
            const key = component.replaceAll('\\', '/').toLowerCase()
            if (checked.has(key)) continue
            checked.add(key)
            const info = await files.lstat(component)
            const isLeaf = component === initial
            if (
              info.isSymbolicLink() ||
              (isLeaf && leafKind === 'file' ? !info.isFile() : !info.isDirectory())
            )
              return { refused: true, component, reason: 'file kind or reparse point' }
            const literal = component.replaceAll("'", "''")
            const isRoot = path.win32.dirname(component) === component
            const script = `$ErrorActionPreference = 'Stop'; ${WINDOWS_TRUSTED_ACL_SCRIPT}; $item = Get-Item -Force -LiteralPath '${literal}'; $safe = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) -and (Test-TrustedAcl (Get-Acl -LiteralPath '${literal}') $${String(isRoot)} $${String(info.isDirectory())}); ConvertTo-Json -Compress -InputObject ([bool]$safe)`
            const result = await run('powershell.exe', [
              '-NoProfile',
              '-NonInteractive',
              '-EncodedCommand',
              Buffer.from(script, 'utf16le').toString('base64'),
            ])
            if (result.exitCode !== 0 || !z.boolean().parse(JSON.parse(result.stdout)))
              return {
                refused: true,
                component,
                reason: 'owner, replacement rights or reparse point',
              }
          }
        }
        return { ok: true, path: canonical }
      } catch {
        return { refused: true, component, reason: 'path or security query failed' }
      }
    },
  }
}
