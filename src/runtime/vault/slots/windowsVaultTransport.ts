import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import {
  UI_TEXT,
  VAULT_APPROVAL_TTL_MS,
  VAULT_KEY_BYTES,
  VAULT_LIMITS,
} from '../../../shared/constants'
import { windowsVaultRequestSchema, type WindowsVaultTransport } from './windowsVaultProtocol'

const INTEGRITY_REFUSED_EXIT = 23

/** The compiler supplies the digest; it never comes from the mutable cache. */
export interface WindowsVaultExecutable {
  readonly file: string
  readonly sha256: string
  readonly powershell: string
  readonly rebuild: () => Promise<void>
  readonly report: () => void
}

/** Trusted inline script, executed only by the absolute system PowerShell. */
export function windowsVaultGuardScript(file: string, digest?: string): string {
  const quoted = `'${file.replaceAll("'", "''")}'`
  return `
$ErrorActionPreference = 'Stop'
$target = ${quoted}
$allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
function Assert-Path([string]$name, [bool]$strict) {
  if (([IO.File]::GetAttributes($name) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'refused' }
  $acl = Get-Acl -LiteralPath $name
  $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  # Only the OS volume root permits Windows' servicing owner; private files/directories never do.
  $isOsRoot = -not $strict -and $name -eq [IO.Path]::GetPathRoot([Environment]::GetFolderPath('Windows')) -and $owner -eq 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
  if (-not $isOsRoot -and $allowed -notcontains $owner) { throw 'refused' }
  $rights = [Security.AccessControl.FileSystemRights]::Write -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  if (-not $strict) { $rights = $rights -band (-bnot [int][Security.AccessControl.FileSystemRights]::CreateDirectories) }
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
    if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and $allowed -notcontains $rule.IdentityReference.Value -and ($rule.FileSystemRights -band $rights) -ne 0) { throw 'refused' }
  }
}
function Assert-Parents([string]$name) {
  $parent = [IO.Path]::GetDirectoryName($name)
  while ($parent) {
    Assert-Path $parent $false
    $next = [IO.Directory]::GetParent($parent)
    if ($null -eq $next) { break }
    $parent = $next.FullName
  }
}
$held = $null
try {
  Assert-Parents $target
  ${
    digest === undefined
      ? `
  if ([IO.Directory]::Exists($target) -or [IO.File]::Exists($target)) { throw 'refused' }
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in $allowed) {
    $identity = New-Object Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  [void][IO.Directory]::CreateDirectory($target, $acl)
  Assert-Path $target $true
  `
      : `
  Assert-Path ([IO.Path]::GetDirectoryName($target)) $true
  Assert-Path $target $true
  $held = New-Object IO.FileStream($target, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $actual = [BitConverter]::ToString($hash.ComputeHash($held)).Replace('-', '').ToLowerInvariant() } finally { $hash.Dispose() }
  if ($actual -ne '${digest}') { throw 'refused' }
  Assert-Parents $target
  Assert-Path ([IO.Path]::GetDirectoryName($target)) $true
  Assert-Path $target $true
  $entry = [Reflection.Assembly]::LoadFile($target).EntryPoint
  $output = [Console]::OpenStandardOutput()
  $output.WriteByte(1); $output.Flush()
  $result = $entry.Invoke($null, [object[]]@(,[string[]]@()))
  exit ([int]$result)
  `
  }
} catch { exit ${String(INTEGRITY_REFUSED_EXIT)} } finally { if ($null -ne $held) { $held.Dispose() } }
`
}

/** One private helper per use; screen-lock waits last until the broker cancels. */
export function windowsVaultTransport(
  helper: WindowsVaultExecutable,
  signal?: AbortSignal,
): WindowsVaultTransport {
  if (
    !path.isAbsolute(helper.file) ||
    !helper.file.toLowerCase().endsWith('.exe') ||
    !path.isAbsolute(helper.powershell) ||
    !/^[a-f0-9]{64}$/u.test(helper.sha256)
  )
    throw new Error(UI_TEXT.vault.noAccess)
  return {
    exchange: (header, key) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted || header.length > VAULT_LIMITS.text) {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        let request: unknown
        try {
          request = JSON.parse(Buffer.from(header).toString('utf8'))
        } catch {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        const parsed = windowsVaultRequestSchema.safeParse(request)
        if (
          !parsed.success ||
          key.length !== (parsed.data.operation === 'wrap' ? VAULT_KEY_BYTES : 0)
        ) {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        // Do not inherit credentials, a shell, or a visible console window.
        let child: ChildProcessWithoutNullStreams
        try {
          child = spawn(
            helper.powershell,
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-EncodedCommand',
              Buffer.from(windowsVaultGuardScript(helper.file, helper.sha256), 'utf16le').toString(
                'base64',
              ),
            ],
            {
              cwd: path.dirname(helper.powershell),
              env: {},
              stdio: 'pipe',
              shell: false,
              windowsHide: true,
            },
          )
        } catch {
          reject(new Error(UI_TEXT.vault.noAccess))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        let isSettled = false
        let isReady = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = (isOk: boolean) => {
          if (isSettled) return
          isSettled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', abort)
          if (isOk) {
            const output = Buffer.alloc(size)
            let offset = 0
            for (const chunk of chunks) {
              output.set(chunk, offset)
              offset += chunk.length
            }
            resolve(output)
          } else {
            child.kill('SIGKILL')
            reject(new Error(UI_TEXT.vault.noAccess))
          }
          for (const chunk of chunks) chunk.fill(0)
        }
        const abort = () => {
          finish(false)
        }
        if (parsed.data.operation !== 'screenLock') timer = setTimeout(abort, VAULT_APPROVAL_TTL_MS)
        signal?.addEventListener('abort', abort, { once: true })
        child.on('error', abort)
        child.stdin.on('error', abort)
        child.stdout.on('data', (chunk: Buffer) => {
          if (isSettled) {
            chunk.fill(0)
            return
          }
          if (!isReady) {
            if (chunk[0] !== 1) {
              chunk.fill(0)
              finish(false)
              return
            }
            isReady = true
            const length = Buffer.alloc(Uint32Array.BYTES_PER_ELEMENT)
            length.writeUInt32BE(header.length)
            try {
              child.stdin.write(length)
              child.stdin.write(header)
              child.stdin.end(key)
            } catch {
              chunk.fill(0)
              finish(false)
              return
            }
            chunk[0] = 0
            chunk = chunk.subarray(1)
          }
          size += chunk.length
          if (size > VAULT_LIMITS.text + VAULT_KEY_BYTES + Uint32Array.BYTES_PER_ELEMENT) {
            chunk.fill(0)
            finish(false)
            return
          }
          chunks.push(chunk)
        })
        child.stderr.on('data', (chunk: Buffer) => {
          chunk.fill(0)
        })
        child.on('close', (code) => {
          if (code === INTEGRITY_REFUSED_EXIT && !isReady && !isSettled) {
            try {
              helper.report()
            } catch {
              // A diagnostic sink cannot prevent the rebuild or the explicit refusal.
            }
            let rebuilding: Promise<void>
            try {
              rebuilding = helper.rebuild()
            } catch {
              finish(false)
              return
            }
            void rebuilding
              .then(() => {
                finish(false)
              })
              .catch(() => {
                finish(false)
              })
          } else finish(code === 0 && isReady)
        })
        if (signal?.aborted) abort()
      }),
  }
}
