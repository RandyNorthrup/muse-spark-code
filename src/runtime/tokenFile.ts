import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { constants, rmSync, rmdirSync } from 'node:fs'
import { chmod, lstat, mkdtemp, open, realpath, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'
import { isStoreErrorCode } from '../host/backend/storeErrors'
import { runProgram, windowsPowerShell } from '../host/processTree'
import * as z from 'zod/mini'
import { IDE_MCP_TOKEN_BYTES, UI_TEXT } from '../shared/constants'

const FILE_MODE = constants.S_IRUSR | constants.S_IWUSR
const DIRECTORY_MODE = FILE_MODE | constants.S_IXUSR
const MODE_MASK =
  DIRECTORY_MODE |
  constants.S_IRGRP |
  constants.S_IWGRP |
  constants.S_IXGRP |
  constants.S_IROTH |
  constants.S_IWOTH |
  constants.S_IXOTH
const windowsReceiptSchema = z.strictObject({
  ownerSid: z.string().check(z.minLength(1)),
  currentSid: z.string().check(z.minLength(1)),
  protected: z.boolean(),
  rules: z
    .array(
      z.strictObject({
        sid: z.string(),
        inherited: z.boolean(),
        allow: z.boolean(),
        fullControl: z.boolean(),
      }),
    )
    .check(z.minLength(1)),
})

/** A trusted OS adapter. It receives paths only, never the bearer token. */
export interface TokenWindowsAcl {
  secure(path: string, isDirectory: boolean): Promise<unknown>
}
export interface TokenAclReceipt {
  readonly platform: NodeJS.Platform
  readonly ownerOnly: true
  readonly mode?: number
  readonly extendedAcl?: false
  readonly windows?: z.infer<typeof windowsReceiptSchema>
}

// Get-Acl reads the Windows security descriptor. Remove inherited and explicit
// grants, install only the current SID, then read the effective DACL again.
// Only the path is encoded into the fixed script; no bearer reaches this child.
const WINDOWS_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $inputPath.path
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$acl.SetOwner($sid)
$inheritance = [System.Security.AccessControl.InheritanceFlags]::None
if ($inputPath.directory) { $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $inputPath.path -AclObject $acl
$verified = Get-Acl -LiteralPath $inputPath.path
$rules = @($verified.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; inherited = $_.IsInherited; allow = $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow; fullControl = $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl } })
@{ ownerSid = $verified.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; currentSid = $sid.Value; protected = $verified.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Compress -Depth 4
`

/**
One fixed ACL script over one path, in the Windows root's own PowerShell
(`SystemRoot`, then `windir`; never PATH and never an assumed drive). Only
the path and its kind are encoded into the script as `$inputPath`; the
credential-free environment carries no bearer or key. Returns the parsed
JSON receipt for the caller's schema.
*/
export async function runWindowsAclScript(
  body: string,
  file: string,
  isDirectory: boolean,
): Promise<unknown> {
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir']
  if (systemRoot === undefined || !/^[a-z]:\\/iu.test(systemRoot))
    throw new Error(UI_TEXT.windowsSystemRootMissing)
  const executable = windowsPowerShell(
    systemRoot,
    withoutKeyringRoutes(withoutCredentials(process.env)),
  )
  const payload = Buffer.from(
    JSON.stringify({ path: file, directory: isDirectory }),
    'utf8',
  ).toString('base64')
  const script = `$inputPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
${body}`
  const stdout = await runProgram(
    executable.file,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    executable.env,
  )
  const receipt: unknown = JSON.parse(stdout)
  return receipt
}

const windowsAcl: TokenWindowsAcl = {
  secure: (file, isDirectory) => runWindowsAclScript(WINDOWS_ACL_SCRIPT, file, isDirectory),
}

/**
macOS's mode string for one path when it carries no extended ACL (`ls
-led` prints exactly one line, with no `+` and no ACL entries), else
undefined. chmod does not remove macOS allow ACEs, so the mode alone
proves nothing there.
*/
export async function darwinModeWithoutAcl(file: string): Promise<string | undefined> {
  const output = await runProgram('/bin/ls', ['-ledn', file], {
    ...withoutKeyringRoutes(withoutCredentials(process.env)),
    LC_ALL: 'C',
  })
  const lines = output.trimEnd().split('\n')
  const modeReceipt = /^([d-][rwx-]{9})@?[ \t]/.exec(lines[0] ?? '')
  return lines.length === 1 ? modeReceipt?.[1] : undefined
}

/**
Owner-only access for one file or directory, read back before it is used:
the bearer token's folder and file (M104) and conversion's private folder
(M105, `privateDirectory.ts`). On Windows the DACL is protected and holds
only the current user's full-control grant (container and object inherit
on a directory), through the `%SystemRoot%` PowerShell, never PATH; on
POSIX the mode is 0700/0600, owned by this user, and macOS shows no ACL.
Any failure throws `EOWNER_ONLY`; callers keep their own refusal.
*/
export async function secureOwnerOnly(
  file: string,
  kind: 'file' | 'directory',
  acl?: TokenWindowsAcl,
): Promise<TokenAclReceipt> {
  const isDirectory = kind === 'directory'
  const own = await lstat(file)
  if ((!isDirectory && own.nlink !== 1) || (isDirectory ? !own.isDirectory() : !own.isFile()))
    throw new Error('EOWNER_ONLY')
  if (acl !== undefined || process.platform === 'win32') {
    const parsed = windowsReceiptSchema.safeParse(
      await (acl ?? windowsAcl).secure(file, isDirectory),
    )
    if (!parsed.success) throw new Error('EOWNER_ONLY')
    const receipt = parsed.data
    if (
      !receipt.protected ||
      receipt.ownerSid !== receipt.currentSid ||
      receipt.rules.some(
        (rule) =>
          rule.sid !== receipt.currentSid || rule.inherited || !rule.allow || !rule.fullControl,
      )
    )
      throw new Error('EOWNER_ONLY')
    return { platform: 'win32', ownerOnly: true, windows: receipt }
  }
  const mode = isDirectory ? DIRECTORY_MODE : FILE_MODE
  await chmod(file, mode)
  const verified = await lstat(file)
  const uid = process.getuid === undefined ? undefined : process.getuid()
  if (uid === undefined || verified.uid !== uid || (verified.mode & MODE_MASK) !== mode)
    throw new Error('EOWNER_ONLY')
  if (process.platform === 'darwin') {
    // Accept only a single mode receipt with no '+' marker or ACL entries;
    // even owner/deny ACLs refuse. The fixed system binary receives a path
    // and a credential-free env only.
    const expected = isDirectory ? 'drwx------' : '-rw-------'
    if ((await darwinModeWithoutAcl(file)) !== expected) throw new Error('EOWNER_ONLY')
    return { platform: 'darwin', ownerOnly: true, mode, extendedAcl: false }
  }
  return { platform: process.platform, ownerOnly: true, mode }
}

/** One private directory and one exclusive write per start; no reusable token. */
export async function createTokenFile(parent: string, acl?: TokenWindowsAcl) {
  const directory = await mkdtemp(path.join(await realpath(parent), 'muse-token-'))
  const file = path.join(directory, 'bearer')
  let isRemoved = false
  async function remove() {
    if (isRemoved) return
    await rm(file, { force: true })
    // A synchronous exit may have removed the directory during the await:
    // moot when it is already gone, rethrown otherwise.
    try {
      await rmdir(directory)
    } catch (error) {
      if (!isStoreErrorCode(error, 'ENOENT')) throw error
    }
    isRemoved = true
    process.off('exit', removeSync)
  }
  function removeSync() {
    if (isRemoved) return
    rmSync(file, { force: true })
    try {
      rmdirSync(directory)
    } catch (error) {
      if (!isStoreErrorCode(error, 'ENOENT')) throw error
    }
    isRemoved = true
    process.off('exit', removeSync)
  }
  // The bearer must never exist before fatal/ordinary exit cleanup is armed.
  process.once('exit', removeSync)
  try {
    await secureOwnerOnly(directory, 'directory', acl)
    const handle = await open(file, 'wx', FILE_MODE)
    try {
      let aclReceipt = await secureOwnerOnly(file, 'file', acl)
      const token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
      await handle.writeFile(token, 'utf8')
      await handle.sync()
      if (acl === undefined && process.platform === 'darwin') {
        await secureOwnerOnly(directory, 'directory')
        aclReceipt = await secureOwnerOnly(file, 'file')
      }
      return {
        token,
        path: file,
        aclReceipt,
        remove,
        removeSync,
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    await remove()
    throw new Error('ETOKEN_ACL', { cause: error })
  }
}
