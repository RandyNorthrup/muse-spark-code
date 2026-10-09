import { lstat, realpath } from 'node:fs/promises'
import type { BigIntStats, Stats } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { sameFile, statIdentity } from '../core/fs/fileIdentity'
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

interface Refusal {
  readonly refused: true
  readonly component: string
  readonly reason: string
}

/** The components below `root` down to `file`, in order; undefined when `file` is not under it. */
function stepsBelow(root: string, file: string): string[] | undefined {
  const relative = path.win32.relative(root, file)
  if (relative === '') return []
  if (relative.startsWith('..') || path.win32.isAbsolute(relative)) return
  return relative.split('\\')
}

/**
 * Windows trusted-path verification against a trusted root (owner rule,
 * 2026-10-08: profile folders may be junctions, symlinks or redirected to
 * another drive). The root is the folder the caller owns; without one it is
 * the leaf's own folder (a file) or the leaf itself (a directory).
 * - At and above the root, links and redirection are normal: the root is
 *   resolved once and accepted by its resolved identity (volume serial and
 *   file id), never by a string prefix, on any drive.
 * - Below the root, every component must be a real file or folder: a link,
 *   junction or other reparse point is refused at the first such component,
 *   whether or not its target stays inside the tree (today's policy).
 * - Owner and ACL checks apply to the resolved root and everything below it;
 *   nothing above the root is checked beyond what the OS enforces.
 */
export function windowsTrustedPathVerifier(
  run: (file: string, args: readonly string[]) => Promise<{ exitCode: number; stdout: string }>,
  io?: {
    realpath: (file: string) => Promise<string>
    lstat: (file: string) => Promise<Pick<Stats, 'isFile' | 'isDirectory' | 'isSymbolicLink'>>
    stat?: (file: string) => Promise<Pick<BigIntStats, 'dev' | 'ino'>>
  },
): TrustedPathVerifier {
  const files = { lstat, realpath, stat: statIdentity, ...io }
  const isTrustedAcl = async (component: string, isDirectory: boolean) => {
    const literal = component.replaceAll("'", "''")
    const isDriveRoot = path.win32.dirname(component) === component
    const script = `$ErrorActionPreference = 'Stop'; ${WINDOWS_TRUSTED_ACL_SCRIPT}; $item = Get-Item -Force -LiteralPath '${literal}'; $safe = (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) -and (Test-TrustedAcl (Get-Acl -LiteralPath '${literal}') $${String(isDriveRoot)} $${String(isDirectory)}); ConvertTo-Json -Compress -InputObject ([bool]$safe)`
    const result = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ])
    return result.exitCode === 0 && z.boolean().parse(JSON.parse(result.stdout))
  }
  return {
    async verify(file, { leafKind, root: requestedRoot }) {
      let component = file
      const refuse = (reason: string): Refusal => ({ refused: true, component, reason })
      try {
        if (!path.win32.isAbsolute(file) || /\p{Cc}/u.test(file))
          return refuse('absolute path required')
        const leaf = path.win32.normalize(file)
        let root = leaf
        if (requestedRoot !== undefined) root = path.win32.normalize(requestedRoot)
        else if (leafKind === 'file') root = path.win32.dirname(leaf)
        if (!path.win32.isAbsolute(root) || /\p{Cc}/u.test(root)) {
          component = root
          return refuse('absolute root required')
        }
        const steps = stepsBelow(root, leaf)
        if (steps === undefined) return refuse('outside its trusted root')
        // Below the root, on the path as named: no links, and the leaf's kind.
        let below = root
        for (const [index, step] of steps.entries()) {
          below = path.win32.join(below, step)
          component = below
          const info = await files.lstat(below)
          if (info.isSymbolicLink()) return refuse('link below the trusted root')
          const isDirectory = index < steps.length - 1 || leafKind === 'directory'
          if (isDirectory ? !info.isDirectory() : !info.isFile()) return refuse('file kind')
        }
        // At the root: links at or above it are normal. What is trusted is the
        // folder it resolves to, by identity (volume serial and file id).
        component = root
        const resolvedRoot = path.win32.normalize(await files.realpath(root))
        if (!sameFile(await files.stat(root), await files.stat(resolvedRoot)))
          return refuse('root identity changed')
        const resolvedKind = await files.lstat(resolvedRoot)
        const isRootDirectory = steps.length > 0 || leafKind === 'directory'
        if (
          resolvedKind.isSymbolicLink() ||
          (isRootDirectory ? !resolvedKind.isDirectory() : !resolvedKind.isFile())
        )
          return refuse('file kind')
        // With no link below it, the leaf is the resolved root's own descendant.
        const expected = path.win32.join(resolvedRoot, ...steps)
        component = leaf
        if (!sameFile(await files.stat(expected), await files.stat(leaf)))
          return refuse('outside its trusted root')
        // Owner and ACL: the resolved root, then each component below it.
        let named = root
        let resolved = resolvedRoot
        for (let index = 0; index <= steps.length; index += 1) {
          if (index > 0) {
            const step = steps[index - 1] ?? ''
            named = path.win32.join(named, step)
            resolved = path.win32.join(resolved, step)
          }
          component = named
          const isDirectory = index < steps.length || leafKind === 'directory'
          if (!(await isTrustedAcl(resolved, isDirectory)))
            return refuse('owner, replacement rights or reparse point')
        }
        return { ok: true, path: expected }
      } catch {
        return refuse('path or security query failed')
      }
    },
  }
}
