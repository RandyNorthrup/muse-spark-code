// Broker and Stop records are authority only inside a verified owner-only namespace.
import { constants, type BigIntStats } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import * as z from 'zod/mini'
import { runProgram, windowsPowerShell } from '../../host/processTree'
import { LSP_LIMITS } from '../../shared/constants'
import { lstatIdentity, handleIdentity, sameFile } from '../../core/fs/fileIdentity'
import { withoutCredentials, withoutKeyringRoutes } from '../credentialVariables'

const aclSchema = z.strictObject({
  owner: z.string(),
  current: z.string(),
  protected: z.boolean(),
  rules: z
    .array(z.strictObject({ sid: z.string(), allow: z.boolean(), full: z.boolean() }))
    .check(z.minLength(1)),
})
const MODE_MASK = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO

async function privatePath(
  file: string,
  isDirectory: boolean,
  isNew = false,
): Promise<BigIntStats> {
  const info = await lstatIdentity(file)
  if (
    isDirectory ? !info.isDirectory() : !info.isFile() || info.nlink !== LSP_LIMITS.recordLinkCount
  )
    throw new Error('ELSP_PRIVATE')
  if (process.platform === 'win32') {
    const payload = Buffer.from(JSON.stringify({ path: file, directory: isDirectory })).toString(
      'base64',
    )
    const script = `$ErrorActionPreference = 'Stop'
$inputPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = Get-Acl -LiteralPath $inputPath.path
${
  isNew
    ? `$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$acl.SetOwner($sid)
$inheritance = [System.Security.AccessControl.InheritanceFlags]::None
if ($inputPath.directory) { $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $inputPath.path -AclObject $acl
$acl = Get-Acl -LiteralPath $inputPath.path`
    : ''
}
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; allow = $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow; full = $_.FileSystemRights -eq [System.Security.AccessControl.FileSystemRights]::FullControl } })
@{ owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; current = $sid.Value; protected = $acl.AreAccessRulesProtected; rules = $rules } | ConvertTo-Json -Compress -Depth 4`
    const executable = windowsPowerShell(
      process.env['SystemRoot'] ?? String.raw`C:\Windows`,
      withoutKeyringRoutes(withoutCredentials(process.env)),
    )
    const receipt = aclSchema.safeParse(
      JSON.parse(
        await runProgram(
          executable.file,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ],
          executable.env,
        ),
      ),
    )
    if (
      !receipt.success ||
      !receipt.data.protected ||
      receipt.data.owner !== receipt.data.current ||
      receipt.data.current === '' ||
      receipt.data.rules.some(
        (rule) => rule.sid !== receipt.data.current || !rule.allow || !rule.full,
      )
    )
      throw new Error('ELSP_PRIVATE')
    return info
  }
  const mode = isDirectory ? LSP_LIMITS.directoryMode : LSP_LIMITS.fileMode
  const uid = process.getuid?.()
  if (
    uid === undefined ||
    info.uid !== BigInt(uid) ||
    (info.mode & BigInt(MODE_MASK)) !== BigInt(mode)
  )
    throw new Error('ELSP_PRIVATE')
  if (process.platform !== 'darwin') return info
  let output: string
  try {
    output = await runProgram('/bin/ls', ['-ledn', file], {
      ...withoutKeyringRoutes(withoutCredentials(process.env)),
      LC_ALL: 'C',
    })
  } catch {
    // A departing owner/recovery lock can vanish during the OS ACL read.
    await lstatIdentity(file)
    throw new Error('ELSP_PRIVATE')
  }
  const lines = output.trimEnd().split('\n')
  const expected = isDirectory ? 'drwx------' : '-rw-------'
  if (lines.length !== 1 || /^([d-][rwx-]{9})@?[ \t]/u.exec(lines[0] ?? '')?.[1] !== expected)
    throw new Error('ELSP_PRIVATE')
  return info
}

export async function privateDirectory(
  directory: string,
  shouldCreate = false,
): Promise<{ isNew: boolean }> {
  let isNew = false
  if (shouldCreate) {
    try {
      await mkdir(directory, { mode: LSP_LIMITS.directoryMode })
      isNew = true
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  await privatePath(directory, true, isNew)
  return { isNew }
}
export async function writePrivateRecord(file: string, text: string): Promise<void> {
  await writeFile(file, text, { flag: 'wx', mode: LSP_LIMITS.fileMode })
  await privatePath(file, false, true)
}
export async function openPrivateRecord(file: string) {
  const before = await privatePath(file, false)
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const actual = await handleIdentity(handle)
    if (
      !actual.isFile() ||
      actual.nlink !== LSP_LIMITS.recordLinkCount ||
      !sameFile(actual, before) ||
      actual.uid !== before.uid ||
      actual.mode !== before.mode
    )
      throw new Error('ELSP_PRIVATE')
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}
