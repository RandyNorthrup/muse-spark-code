import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { constants, rmSync, rmdirSync } from 'node:fs'
import { chmod, lstat, mkdtemp, open, realpath, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'
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

const windowsAcl: TokenWindowsAcl = {
  async secure(file, isDirectory) {
    // Windows sets both to its real directory, on whatever drive; never guess `C:`.
    const root = process.env['SystemRoot'] ?? process.env['windir']
    if (root === undefined || !/^[a-z]:\\/iu.test(root)) {
      throw new Error(UI_TEXT.windowsSystemRootMissing)
    }
    const executable = windowsPowerShell(
      root,
      withoutKeyringRoutes(withoutCredentials(process.env)),
    )
    const payload = Buffer.from(
      JSON.stringify({ path: file, directory: isDirectory }),
      'utf8',
    ).toString('base64')
    const script = `$inputPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
${WINDOWS_ACL_SCRIPT}`
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
  },
}

async function secure(
  file: string,
  isDirectory: boolean,
  acl?: TokenWindowsAcl,
): Promise<TokenAclReceipt> {
  const own = await lstat(file)
  if ((!isDirectory && own.nlink !== 1) || (isDirectory ? !own.isDirectory() : !own.isFile()))
    throw new Error('ETOKEN_ACL')
  if (acl !== undefined || process.platform === 'win32') {
    const parsed = windowsReceiptSchema.safeParse(
      await (acl ?? windowsAcl).secure(file, isDirectory),
    )
    if (!parsed.success) throw new Error('ETOKEN_ACL')
    const receipt = parsed.data
    if (
      !receipt.protected ||
      receipt.ownerSid !== receipt.currentSid ||
      receipt.rules.some(
        (rule) =>
          rule.sid !== receipt.currentSid || rule.inherited || !rule.allow || !rule.fullControl,
      )
    )
      throw new Error('ETOKEN_ACL')
    return { platform: 'win32', ownerOnly: true, windows: receipt }
  }
  const mode = isDirectory ? DIRECTORY_MODE : FILE_MODE
  await chmod(file, mode)
  const verified = await lstat(file)
  const uid = process.getuid === undefined ? undefined : process.getuid()
  if (uid === undefined || verified.uid !== uid || (verified.mode & MODE_MASK) !== mode)
    throw new Error('ETOKEN_ACL')
  if (process.platform === 'darwin') {
    // chmod does not remove macOS allow ACEs. Accept only a single mode
    // receipt with no '+' marker or ACL entries; even owner/deny ACLs refuse.
    // The fixed system binary receives a path and a credential-free env only.
    const output = await runProgram('/bin/ls', ['-ledn', file], {
      ...withoutKeyringRoutes(withoutCredentials(process.env)),
      LC_ALL: 'C',
    })
    const lines = output.trimEnd().split('\n')
    const expected = isDirectory ? 'drwx------' : '-rw-------'
    const modeReceipt = /^([d-][rwx-]{9})@?[ \t]/.exec(lines[0] ?? '')
    if (lines.length !== 1 || modeReceipt?.[1] !== expected) throw new Error('ETOKEN_ACL')
    return { platform: 'darwin', ownerOnly: true, mode, extendedAcl: false }
  }
  return { platform: process.platform, ownerOnly: true, mode }
}

function refuseUnlessMissing(error: unknown): void {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
  throw error
}

/** One private directory and one exclusive write per start; no reusable token. */
export async function createTokenFile(parent: string, acl?: TokenWindowsAcl) {
  const directory = await mkdtemp(path.join(await realpath(parent), 'muse-token-'))
  const file = path.join(directory, 'bearer')
  let isRemoved = false
  async function remove() {
    if (isRemoved) return
    await rm(file, { force: true })
    // A synchronous exit may have removed the directory during the await.
    try {
      await rmdir(directory)
    } catch (error) {
      refuseUnlessMissing(error)
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
      refuseUnlessMissing(error)
    }
    isRemoved = true
    process.off('exit', removeSync)
  }
  // The bearer must never exist before fatal/ordinary exit cleanup is armed.
  process.once('exit', removeSync)
  try {
    await secure(directory, true, acl)
    const handle = await open(file, 'wx', FILE_MODE)
    try {
      let aclReceipt = await secure(file, false, acl)
      const token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
      await handle.writeFile(token, 'utf8')
      await handle.sync()
      if (acl === undefined && process.platform === 'darwin') {
        await secure(directory, true)
        aclReceipt = await secure(file, false)
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
  } catch {
    await remove()
    throw new Error('ETOKEN_ACL')
  }
}
