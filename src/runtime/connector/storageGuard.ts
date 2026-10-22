// M124 (D106, RVM124 finding 15): the connector store's storage guard. It
// loads as its own lazy chunk (dist/connectorStoreGuard.js), reached only
// from the `mcp` command's startup and the store's creations: securing and
// verifying storage never happens per call, and no client input ever reaches
// a child process. Windows has no ACL API for Node, so two fixed PowerShell
// scripts (one securing a single path with a read-back receipt, one reading
// the whole tree's descriptors in one spawn) run through the system root's
// own PowerShell with a credential-free environment and a reset module path,
// exactly as the token file's routine does; POSIX uses mode and ownership
// checks with no child except macOS's fixed `ls` at securing time. No
// timeout of ours stands on those fixed OS calls. A refusal names its fixed
// reason word only, never a path.
import { Buffer } from 'node:buffer'
import { realpathSync } from 'node:fs'
import { chmod, lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { noWorkspaceChildEnvironment, windowsPowerShell } from '../../core/execGuard'
import type { GuardedChildEnv } from '../../core/executables'
import { execFileGuarded } from '../../core/guardedChildProcess'
import {
  CONNECTOR_FILE_MODE,
  CONNECTOR_FOLDER_MODE,
  MEDIA_PRIVATE_ROOT_TRUSTED_SIDS,
  POSIX_GROUP_OTHER_WRITE_BITS,
  POSIX_STICKY_BIT,
  WINDOWS_WRITE_CLASS_RIGHTS,
} from '../../shared/constants'
import {
  CONNECTOR_STORAGE_REFUSED,
  type ConnectorStorageGuard,
  type ConnectorStorageReason,
} from './storageGuardPort'

export class ConnectorStorageRefused extends Error {
  readonly code = CONNECTOR_STORAGE_REFUSED
  constructor(
    readonly reason: ConnectorStorageReason,
    options?: { cause?: unknown },
  ) {
    super(CONNECTOR_STORAGE_REFUSED, options)
  }
}

function refused(reason: ConnectorStorageReason, cause?: unknown): ConnectorStorageRefused {
  return new ConnectorStorageRefused(reason, cause === undefined ? undefined : { cause })
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** The low nine mode bits, the only ones a leaf may carry. */
const POSIX_MODE_MASK = 0o777
const POSIX_DIRECTORY_MODE = CONNECTOR_FOLDER_MODE
const POSIX_FILE_MODE = CONNECTOR_FILE_MODE
const POSIX_MACOS_DIRECTORY_MODE = 'drwx------'
const POSIX_MACOS_FILE_MODE = '-rw-------'

/** One fixed program run to completion; any failure is a storage refusal with its cause. */
function runFixed(file: string, args: readonly string[], env: GuardedChildEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFileGuarded(file, args, { env, windowsHide: true }, (failure, stdout) => {
      if (failure === null) resolve(stdout)
      else reject(refused('access', failure))
    })
  })
}

/**
The system root's own PowerShell, never PATH: the shared 5.1 launch
(windowsPowerShell), credential-free with Windows PowerShell's own module
path, as the token file's routine runs it.
*/
function windowsShell(): { readonly file: string; readonly env: GuardedChildEnv } {
  const systemRoot = process.env['SystemRoot'] ?? process.env['windir']
  if (systemRoot === undefined || !/^[a-z]:\\/iu.test(systemRoot)) throw refused('access')
  return windowsPowerShell(systemRoot)
}

// The single path arrives as base64 JSON in $inputPath; no caller text is
// ever interpolated into the script. Protection on, every grant removed,
// the current user set as owner with full control, then the live descriptor
// is read back. A reparse point is reported, never secured.
const WINDOWS_SECURE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User
$seen = [IO.File]::GetAttributes($inputPath.path)
if (($seen -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
  @{ reparse = $true } | ConvertTo-Json -Compress
  return
}
$acl = Get-Acl -LiteralPath $inputPath.path
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($rule) }
$acl.SetOwner($me)
$inherit = [Security.AccessControl.InheritanceFlags]::None
if ($inputPath.directory) { $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' }
$grant = [Security.AccessControl.FileSystemAccessRule]::new($me, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($grant)
Set-Acl -LiteralPath $inputPath.path -AclObject $acl
$read = Get-Acl -LiteralPath $inputPath.path
$grants = @($read.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; inherited = $_.IsInherited; allow = ($_.AccessControlType -eq 'Allow'); full = ($_.FileSystemRights -eq 'FullControl'); rights = [int]$_.FileSystemRights } })
@{ reparse = $false; owner = $read.GetOwner([Security.Principal.SecurityIdentifier]).Value; me = $me.Value; locked = $read.AreAccessRulesProtected; grants = $grants } | ConvertTo-Json -Compress -Depth 5
`

// Every path arrives as base64 JSON in $inputPaths; one spawn reads the
// whole tree through the CLR alone, with no module load. Rights stay
// numeric: the caller decides what is write-class.
const WINDOWS_READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$scanned = foreach ($candidate in $inputPaths.paths) {
  $seen = [IO.File]::GetAttributes($candidate)
  $reparse = ($seen -band [IO.FileAttributes]::ReparsePoint) -ne 0
  $folder = ($seen -band [IO.FileAttributes]::Directory) -ne 0
  if ($folder) { $acl = [IO.Directory]::GetAccessControl($candidate) } else { $acl = [IO.File]::GetAccessControl($candidate) }
  $grants = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { @{ sid = $_.IdentityReference.Value; inherited = $_.IsInherited; allow = ($_.AccessControlType -eq 'Allow'); full = ($_.FileSystemRights -eq 'FullControl'); rights = [int]$_.FileSystemRights } })
  @{ owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; folder = $folder; reparse = $reparse; grants = $grants }
}
@{ me = $me; scanned = $scanned } | ConvertTo-Json -Compress -Depth 6
`

async function runWindowsScript(body: string, payload: unknown): Promise<unknown> {
  const { file, env } = windowsShell()
  const envelope = `$inputPath = $null; $inputPaths = $null; $staged = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}')) | ConvertFrom-Json
if ($staged.paths) { $inputPaths = $staged } else { $inputPath = $staged }
${body}`
  const stdout = await runFixed(
    file,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(envelope, 'utf16le').toString('base64'),
    ],
    env,
  )
  try {
    return JSON.parse(stdout) as unknown
  } catch (error: unknown) {
    if (error instanceof SyntaxError) throw refused('access', error)
    throw error
  }
}

interface WindowsGrant {
  readonly sid: string
  readonly inherited: boolean
  readonly allow: boolean
  readonly full: boolean
  readonly rights: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asWindowsGrant(value: unknown): WindowsGrant {
  if (
    !isRecord(value) ||
    typeof value['sid'] !== 'string' ||
    typeof value['inherited'] !== 'boolean' ||
    typeof value['allow'] !== 'boolean' ||
    typeof value['full'] !== 'boolean' ||
    typeof value['rights'] !== 'number'
  )
    throw refused('access')
  return {
    sid: value['sid'],
    inherited: value['inherited'],
    allow: value['allow'],
    full: value['full'],
    rights: value['rights'],
  }
}

interface WindowsSecured {
  readonly owner: string
  readonly me: string
  readonly locked: boolean
  readonly grants: readonly WindowsGrant[]
}

function asWindowsSecured(value: unknown): WindowsSecured {
  if (!isRecord(value)) throw refused('access')
  if (value['reparse'] === true) throw refused('link')
  if (
    !isRecord(value) ||
    typeof value['owner'] !== 'string' ||
    typeof value['me'] !== 'string' ||
    typeof value['locked'] !== 'boolean' ||
    !Array.isArray(value['grants'])
  )
    throw refused('access')
  return {
    owner: value['owner'],
    me: value['me'],
    locked: value['locked'],
    grants: value['grants'].map((grant) => asWindowsGrant(grant)),
  }
}

interface WindowsScanned {
  readonly owner: string
  readonly folder: boolean
  readonly reparse: boolean
  readonly grants: readonly WindowsGrant[]
}

function asWindowsScanned(value: unknown): WindowsScanned {
  if (
    !isRecord(value) ||
    typeof value['owner'] !== 'string' ||
    typeof value['folder'] !== 'boolean' ||
    typeof value['reparse'] !== 'boolean' ||
    !Array.isArray(value['grants'])
  )
    throw refused('access')
  return {
    owner: value['owner'],
    folder: value['folder'],
    reparse: value['reparse'],
    grants: value['grants'].map((grant) => asWindowsGrant(grant)),
  }
}

interface WindowsTree {
  readonly me: string
  readonly scanned: readonly WindowsScanned[]
}

function asWindowsTree(value: unknown, expected: number): WindowsTree {
  if (!isRecord(value) || typeof value['me'] !== 'string' || !Array.isArray(value['scanned']))
    throw refused('access')
  const scanned = value['scanned'].map((entry) => asWindowsScanned(entry))
  if (scanned.length !== expected) throw refused('access')
  return { me: value['me'], scanned }
}

/** A leaf the store owns: the current user alone, full control, no inheritance. */
function windowsLeafVerdict(scanned: WindowsScanned, me: string): void {
  if (scanned.reparse) throw refused('link')
  if (scanned.owner !== me) throw refused('owner')
  if (
    scanned.grants.length === 0 ||
    scanned.grants.some(
      (grant) => grant.sid !== me || !grant.allow || grant.inherited || !grant.full,
    )
  )
    throw refused('access')
}

/** The trust anchor the store did not create: our owner, and no foreign write. */
function windowsAnchorVerdict(scanned: WindowsScanned, me: string): void {
  if (scanned.reparse) throw refused('link')
  const trusted = new Set<string>([me, ...MEDIA_PRIVATE_ROOT_TRUSTED_SIDS])
  if (!trusted.has(scanned.owner)) throw refused('owner')
  const hasForeignWrite = scanned.grants.some(
    (grant) =>
      grant.allow && !trusted.has(grant.sid) && (grant.rights & WINDOWS_WRITE_CLASS_RIGHTS) !== 0,
  )
  if (hasForeignWrite) throw refused('access')
}

async function windowsSecure(file: string, isDirectory: boolean): Promise<void> {
  const receipt = asWindowsSecured(
    await runWindowsScript(WINDOWS_SECURE_SCRIPT, { path: file, directory: isDirectory }),
  )
  if (receipt.owner !== receipt.me || !receipt.locked) throw refused('access')
  windowsLeafVerdict(
    { owner: receipt.owner, folder: isDirectory, reparse: false, grants: receipt.grants },
    receipt.me,
  )
}

async function windowsVerify(root: string, anchor: string): Promise<void> {
  let anchorInfo
  try {
    anchorInfo = await lstat(anchor)
  } catch (error: unknown) {
    if (isMissing(error)) return
    throw error
  }
  if (!anchorInfo.isDirectory() || anchorInfo.isSymbolicLink()) throw refused('kind')
  let entries: string[] | undefined
  try {
    entries = await readdir(root, { recursive: true })
  } catch (error: unknown) {
    if (isMissing(error)) entries = undefined
    else throw error
  }
  if (entries === undefined) {
    const tree = asWindowsTree(await runWindowsScript(WINDOWS_READ_SCRIPT, { paths: [anchor] }), 1)
    const [scannedAnchor] = tree.scanned
    if (scannedAnchor?.folder !== true) throw refused('kind')
    windowsAnchorVerdict(scannedAnchor, tree.me)
    return
  }
  const below = entries
    .map((entry) => path.join(root, entry))
    .toSorted((left, right) => {
      if (left === right) return 0
      return left < right ? -1 : 1
    })
  const tree = asWindowsTree(
    await runWindowsScript(WINDOWS_READ_SCRIPT, { paths: [root, anchor, ...below] }),
    below.length + 2,
  )
  const [scannedRoot, scannedAnchor, ...scannedBelow] = tree.scanned
  if (scannedRoot === undefined || scannedAnchor === undefined) throw refused('access')
  if (!scannedRoot.folder || !scannedAnchor.folder) throw refused('kind')
  windowsLeafVerdict(scannedRoot, tree.me)
  windowsAnchorVerdict(scannedAnchor, tree.me)
  for (const [index, scanned] of scannedBelow.entries()) {
    const candidate = below[index]
    if (candidate === undefined) throw refused('access')
    let info
    try {
      info = await lstat(candidate)
    } catch (error: unknown) {
      if (isMissing(error)) throw refused('access', error)
      throw error
    }
    if (info.isSymbolicLink()) throw refused('link')
    const isDirectory = info.isDirectory()
    if (!isDirectory && !info.isFile()) throw refused('kind')
    if (!isDirectory && info.nlink !== 1) throw refused('link')
    if (scanned.folder !== isDirectory) throw refused('kind')
    windowsLeafVerdict(scanned, tree.me)
  }
}

/** macOS only: the path carries no extended ACL, so the mode proves privacy. */
async function isMacosModeBare(file: string, expected: string): Promise<boolean> {
  const stdout = await runFixed(
    '/bin/ls',
    ['-ledn', file],
    noWorkspaceChildEnvironment(process.platform, withoutCredentials(process.env), realpathSync),
  )
  const lines = stdout.trimEnd().split('\n')
  const first = lines[0] ?? ''
  return lines.length === 1 && first.startsWith(expected) && !first.includes('+')
}

async function posixSecure(file: string, isDirectory: boolean): Promise<void> {
  const uid = process.getuid?.()
  if (uid === undefined) throw refused('owner')
  await chmod(file, isDirectory ? POSIX_DIRECTORY_MODE : POSIX_FILE_MODE)
  const info = await lstat(file)
  if (
    info.isSymbolicLink() ||
    info.uid !== uid ||
    (info.mode & POSIX_MODE_MASK) !== (isDirectory ? POSIX_DIRECTORY_MODE : POSIX_FILE_MODE) ||
    (!isDirectory && info.nlink !== 1)
  )
    throw refused('access')
  if (
    process.platform === 'darwin' &&
    !(await isMacosModeBare(file, isDirectory ? POSIX_MACOS_DIRECTORY_MODE : POSIX_MACOS_FILE_MODE))
  )
    throw refused('access')
}

async function posixVerify(root: string, anchor: string): Promise<void> {
  const uid = process.getuid?.()
  if (uid === undefined) throw refused('owner')
  // The anchor chain up to the filesystem root: every folder root's or
  // ours, and writable by no one else unless it is root's sticky folder
  // holding a folder of ours. A missing anchor is skipped: creations below
  // are secured, and the chain above still has to pass.
  let belowUid: number | undefined
  for (let folder = anchor; ; folder = path.dirname(folder)) {
    let info
    try {
      info = await lstat(folder)
    } catch (error: unknown) {
      if (isMissing(error) && folder !== path.dirname(folder)) continue
      throw error
    }
    if (!info.isDirectory() || info.isSymbolicLink()) throw refused('kind')
    if (info.uid !== uid && info.uid !== 0) throw refused('owner')
    const isWritable = (info.mode & POSIX_GROUP_OTHER_WRITE_BITS) !== 0
    const isStickyHeld = info.uid === 0 && (info.mode & POSIX_STICKY_BIT) !== 0 && belowUid === uid
    if (isWritable && !isStickyHeld) throw refused('access')
    belowUid = info.uid
    if (folder === path.dirname(folder)) break
  }
  let entries: string[]
  try {
    entries = await readdir(root, { recursive: true })
  } catch (error: unknown) {
    if (isMissing(error)) return
    throw error
  }
  const leaves = [root, ...entries.map((entry) => path.join(root, entry))]
  for (const leaf of leaves) {
    let info
    try {
      info = await lstat(leaf)
    } catch (error: unknown) {
      if (isMissing(error)) throw refused('access', error)
      throw error
    }
    if (info.isSymbolicLink()) throw refused('link')
    if (info.uid !== uid) throw refused('owner')
    const isDirectory = info.isDirectory()
    if (!isDirectory) {
      if (!info.isFile() || (info.mode & POSIX_MODE_MASK) !== POSIX_FILE_MODE)
        throw refused('access')
      if (info.nlink !== 1) throw refused('link')
    }
    if (isDirectory && (info.mode & POSIX_MODE_MASK) !== POSIX_DIRECTORY_MODE)
      throw refused('access')
  }
}

async function resolveAnchor(anchor: string): Promise<string> {
  try {
    return await realpath(anchor)
  } catch (error: unknown) {
    if (isMissing(error)) throw refused('access', error)
    throw error
  }
}

export function connectorStorageGuard(root: string): ConnectorStorageGuard {
  const anchor = path.dirname(root)
  const inside = async (file: string, pinned: string): Promise<string> => {
    let resolved: string
    try {
      resolved = await realpath(file)
    } catch (error: unknown) {
      if (isMissing(error)) throw refused('access', error)
      throw error
    }
    const relative =
      process.platform === 'win32'
        ? path.win32.relative(pinned.toLowerCase(), resolved.toLowerCase())
        : path.relative(pinned, resolved)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw refused('scope')
    return resolved
  }
  /** Links at or above the anchor are normal; the root itself is never one. */
  const rooted = async (): Promise<{ root: string; anchor: string }> => {
    let resolvedRoot: string | undefined
    try {
      resolvedRoot = await realpath(root)
    } catch (error: unknown) {
      if (!isMissing(error)) throw error
    }
    if (resolvedRoot === undefined) return { root, anchor }
    const resolvedAnchor = await resolveAnchor(anchor)
    const expected = path.join(resolvedAnchor, path.basename(root))
    const isRootMatch =
      process.platform === 'win32'
        ? resolvedRoot.toLowerCase() === expected.toLowerCase()
        : resolvedRoot === expected
    if (!isRootMatch) throw refused('link')
    return { root: resolvedRoot, anchor: resolvedAnchor }
  }
  return {
    secure: async (file, kind) => {
      const placed = await rooted()
      const target = await inside(file, placed.root)
      let info
      try {
        info = await lstat(target)
      } catch (error: unknown) {
        if (isMissing(error)) throw refused('access', error)
        throw error
      }
      if (info.isSymbolicLink()) throw refused('link')
      const isDirectory = kind === 'directory'
      if (isDirectory ? !info.isDirectory() : !info.isFile()) throw refused('kind')
      if (!isDirectory && info.nlink !== 1) throw refused('link')
      if (process.platform === 'win32') await windowsSecure(target, isDirectory)
      else await posixSecure(target, isDirectory)
    },
    verify: async () => {
      const placed = await rooted()
      if (process.platform === 'win32') await windowsVerify(placed.root, placed.anchor)
      else await posixVerify(placed.root, placed.anchor)
    },
  }
}
