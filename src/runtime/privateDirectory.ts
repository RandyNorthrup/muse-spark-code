// The converter's fresh owner-only folders (M105 lane VB): `convert.ts`'s
// `createPrivateDirectory` port. They are made only inside a verified
// private root (RVMEDIAVB 1), never in a shared temporary folder: a new
// folder then inherits an already-private DACL or sits under a 0700 root, so
// no other user has a moment in which to open a handle to it. Each folder is
// still made owner-only explicitly (`secureOwnerOnly`, the token file's
// routine) and read back, as defence in depth.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants, realpathSync, type BigIntStats } from 'node:fs'
import { mkdir, readdir, realpath, rm, rmdir, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import * as z from 'zod/mini'
import { noWorkspaceChildEnvironment, windowsPowerShell } from '../core/execGuard'
import {
  handleIdentity,
  identityOf,
  lstatIdentity,
  sameFile,
  type FileIdentity,
} from '../core/fs/fileIdentity'
import { powerShellQuoted } from '../core/shellQuote'
import { JOB_SOURCE_FILES } from '../host/backend/jobSource'
import { runProgram } from '../host/processTree'
import {
  LSP_LIMITS,
  MEDIA_PRIVATE_DIRECTORY_NAME_BYTES,
  MEDIA_PRIVATE_DIRECTORY_PREFIX,
  MEDIA_PRIVATE_ROOT_TRUSTED_SIDS,
  POSIX_GROUP_OTHER_BITS,
  POSIX_GROUP_OTHER_WRITE_BITS,
  POSIX_STICKY_BIT,
  RUNTIME_STOP,
  WINDOWS_WRITE_CLASS_RIGHTS,
} from '../shared/constants'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'
import {
  darwinModeWithoutAcl,
  runWindowsAclScript,
  secureOwnerOnly,
  type TokenWindowsAcl,
} from './tokenFile'

const OWNER_DIRECTORY_MODE = 0o700
/** One plain path component: no separator of either platform, no drive or stream. */
const FOLDER_NAME = /^[\w.-]+$/u

/** Every folder failure, whatever the OS said: no path or OS output in the message. */
export class PrivateDirectoryRefused extends Error {
  readonly code = 'EPRIVATE_DIRECTORY'
  constructor() {
    super('The private conversion folder could not be created owner-only')
  }
}

/** The root is not private, or could not be made so; there is no fallback folder. */
export class PrivateRootRefused extends Error {
  readonly code = 'EPRIVATE_ROOT'
  constructor() {
    super('The private media root is not owner-only')
  }
}

/** A verified root: its resolved path and the identity every use re-checks. */
export interface PrivateRoot {
  readonly path: string
  readonly identity: FileIdentity
  /**
  This opening's owner token: every folder made in the root carries it,
  and `privateRootLease.ts`'s lease of the same name says whether its owner
  still lives (RVMEDIAV3 3).
  */
  readonly owner: string
}

/** Reads one path's owner and grants (tests); production uses `%SystemRoot%`'s PowerShell. */
export interface WindowsAclReader {
  read(path: string): Promise<unknown>
}

export interface PrivateRootOptions {
  readonly reader?: WindowsAclReader
  /** The Windows ACL adapter that secures a root this call creates (tests). */
  readonly acl?: TokenWindowsAcl
}

export interface PrivateDirectoryOptions {
  /** The Windows ACL adapter (tests); production uses `%SystemRoot%`'s PowerShell. */
  readonly acl?: TokenWindowsAcl
  /** The new folder's name (tests); production draws random bytes. */
  readonly name?: () => string
}

const aclReadingSchema = z.strictObject({
  ownerSid: z.string().check(z.minLength(1)),
  currentSid: z.string().check(z.minLength(1)),
  rules: z.array(
    z.strictObject({ sid: z.string(), allow: z.boolean(), rights: z.number().check(z.int()) }),
  ),
})

// Get-Acl only: the owner, the current user and every grant, inherited or not.
const WINDOWS_ACL_READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.SecurityIdentifier]
$acl = Get-Acl -LiteralPath $inputPath.path
$rules = @($acl.GetAccessRules($true, $true, $sid) | ForEach-Object { @{ sid = $_.IdentityReference.Value; allow = $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow; rights = [int64]$_.FileSystemRights } })
@{ ownerSid = $acl.GetOwner($sid).Value; currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; rules = $rules } | ConvertTo-Json -Compress -Depth 4
`

const windowsAclReader: WindowsAclReader = {
  read: (directory) => runWindowsAclScript(WINDOWS_ACL_READ_SCRIPT, directory, true),
}

/**
Windows: the owner is the current user, SYSTEM or Administrators. On the
root nobody else holds any grant; on its parent nobody else holds a
write-class grant (reading, as some sandbox groups do, is allowed).
*/
async function verifyWindows(
  directory: string,
  reader: WindowsAclReader,
  isRoot: boolean,
): Promise<void> {
  const reading = aclReadingSchema.parse(await reader.read(directory))
  const trusted = new Set<string>([reading.currentSid, ...MEDIA_PRIVATE_ROOT_TRUSTED_SIDS])
  const isForeign = (rule: (typeof reading.rules)[number]) =>
    rule.allow &&
    !trusted.has(rule.sid) &&
    (isRoot || (rule.rights & WINDOWS_WRITE_CLASS_RIGHTS) !== 0)
  if (!trusted.has(reading.ownerSid) || reading.rules.some((rule) => isForeign(rule)))
    throw new Error('EPRIVATE_ROOT')
}

function currentUid(): number {
  if (process.getuid === undefined) throw new Error('EPRIVATE_ROOT')
  return process.getuid()
}

/** POSIX: every folder from the parent up is root's or this user's, and not writable by others unless sticky. */
async function verifyPosixAncestors(parent: string): Promise<void> {
  const uid = currentUid()
  for (let folder = parent; ; folder = path.dirname(folder)) {
    const info = await lstatIdentity(folder)
    const mode = Number(info.mode)
    const owner = Number(info.uid)
    if (
      !info.isDirectory() ||
      (owner !== 0 && owner !== uid) ||
      ((mode & POSIX_GROUP_OTHER_WRITE_BITS) !== 0 && (mode & POSIX_STICKY_BIT) === 0)
    )
      throw new Error('EPRIVATE_ROOT')
    if (path.dirname(folder) === folder) return
  }
}

/** POSIX root: this user's, no group/other bits; on macOS also no extended ACL. */
async function verifyPosixRoot(root: string, info: BigIntStats): Promise<void> {
  if (Number(info.uid) !== currentUid() || (Number(info.mode) & POSIX_GROUP_OTHER_BITS) !== 0)
    throw new Error('EPRIVATE_ROOT')
  if (
    process.platform === 'darwin' &&
    !/^d[rwx-]{3}-{6}$/u.test((await darwinModeWithoutAcl(root)) ?? '')
  )
    throw new Error('EPRIVATE_ROOT')
}

/**
The private root for conversion folders, verified once: on Windows its
owner and grants are only the user's, SYSTEM's and Administrators'; on
POSIX it is this user's with mode 0700 or stricter, and every folder above
it is root's or this user's and writable by no one else (unless sticky).

`directory` is a dedicated folder, normally `media` in the host's own
per-user storage. When it is absent, its parent is checked first (Windows:
no other principal holds a write-class grant; POSIX: the ancestor rule),
then the folder is made and made owner-only before any check passes it.
An existing folder is only checked, never repaired. Any failure throws
`PrivateRootRefused`; nothing falls back to a temporary folder.
*/
export async function openPrivateRoot(
  directory: string,
  options: PrivateRootOptions = {},
): Promise<PrivateRoot> {
  const isWindows = options.reader !== undefined || process.platform === 'win32'
  const reader = options.reader ?? windowsAclReader
  let made: string | undefined
  try {
    const leaf = path.basename(directory)
    if (leaf === '.' || leaf === '..' || !FOLDER_NAME.test(leaf)) throw new Error('EPRIVATE_ROOT')
    // Links above the root are normal (a relocated profile); the root itself is never one.
    const parent = await realpath(path.dirname(directory))
    const root = path.join(parent, leaf)
    if (isWindows) await verifyWindows(parent, reader, false)
    else await verifyPosixAncestors(parent)
    try {
      await mkdir(root, { mode: OWNER_DIRECTORY_MODE })
      made = root
      await secureOwnerOnly(root, 'directory', options.acl)
    } catch (error: unknown) {
      if (
        made !== undefined ||
        !(error instanceof Error && 'code' in error && error.code === 'EEXIST')
      )
        throw error
    }
    const info = await lstatIdentity(root)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('EPRIVATE_ROOT')
    if (isWindows) await verifyWindows(root, reader, true)
    else await verifyPosixRoot(root, info)
    return {
      path: root,
      identity: identityOf(info),
      owner: randomBytes(MEDIA_PRIVATE_DIRECTORY_NAME_BYTES).toString('hex'),
    }
  } catch {
    if (made !== undefined) await removeMadeRoot(made)
    throw new PrivateRootRefused()
  }
}

/** A root this call made but could not verify goes again; it is still empty. */
async function removeMadeRoot(root: string): Promise<void> {
  try {
    await rmdir(root)
  } catch {
    // Something arrived or it is already gone; the refusal stands either way.
  }
}

/** Remove only the folder this call made, never one swapped in for it. */
async function removeOwn(directory: string, own: BigIntStats): Promise<void> {
  try {
    const now = await lstatIdentity(directory)
    if (now.isDirectory() && !now.isSymbolicLink() && sameFile(now, own))
      await rm(directory, { recursive: true, force: true })
  } catch {
    // Already gone, or no longer ours to remove.
  }
}

/** The root is still the one verified: same identity, and on POSIX still 0700 and ours. */
async function currentRoot(root: PrivateRoot): Promise<BigIntStats> {
  const info = await lstatIdentity(root.path)
  if (!info.isDirectory() || info.isSymbolicLink() || !sameFile(info, root.identity))
    throw new Error('EPRIVATE_DIRECTORY')
  if (
    process.platform !== 'win32' &&
    (Number(info.uid) !== currentUid() || (Number(info.mode) & POSIX_GROUP_OTHER_BITS) !== 0)
  )
    throw new Error('EPRIVATE_DIRECTORY')
  return info
}

/**
A fresh folder that only this user can open, for one conversion, inside a
verified root; the caller owns its removal. Its name carries the root's
owner token (`muse-media-<owner>-<random>`), so a folder a crash left
behind is reclaimed once its owner is gone (RVMEDIAV3 3). The root's
identity is checked again first. The folder never claims an existing one (an exclusive mkdir),
inherits the root's private DACL, is secured owner-only and read back, and
is empty when returned. Any failure removes what this call made and throws
`PrivateDirectoryRefused`.
*/
export async function createPrivateDirectory(
  root: PrivateRoot,
  options: PrivateDirectoryOptions = {},
): Promise<string> {
  let made: { readonly directory: string; readonly own: BigIntStats } | undefined
  try {
    const rootInfo = await currentRoot(root)
    const leaf =
      options.name?.() ??
      `${MEDIA_PRIVATE_DIRECTORY_PREFIX}${root.owner}-${randomBytes(MEDIA_PRIVATE_DIRECTORY_NAME_BYTES).toString('hex')}`
    if (leaf === '.' || leaf === '..' || !FOLDER_NAME.test(leaf))
      throw new Error('EPRIVATE_DIRECTORY')
    const directory = path.join(root.path, leaf)
    await mkdir(directory, { mode: OWNER_DIRECTORY_MODE })
    const own = await lstatIdentity(directory)
    made = { directory, own }
    if (!own.isDirectory() || own.isSymbolicLink()) throw new Error('EPRIVATE_DIRECTORY')
    const resolved = await realpath(directory)
    const [resolvedSelf, resolvedParent] = await Promise.all([
      lstatIdentity(resolved),
      lstatIdentity(path.dirname(resolved)),
    ])
    if (!sameFile(resolvedSelf, own) || !sameFile(resolvedParent, rootInfo))
      throw new Error('EPRIVATE_DIRECTORY')
    await secureOwnerOnly(directory, 'directory', options.acl)
    // Nothing may have arrived before the owner-only DACL or mode landed.
    const entries = await readdir(directory)
    const after = await lstatIdentity(directory)
    if (entries.length > 0 || !sameFile(after, own)) throw new Error('EPRIVATE_DIRECTORY')
    return directory
  } catch {
    if (made !== undefined) await removeOwn(made.directory, made.own)
    throw new PrivateDirectoryRefused()
  }
}

// M104 lane H: the LSP runtime roots below share this module with the
// converter folders above: refuse unsafe namespaces, never repair them.
const MODE_MASK = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO

const receiptSchema = z.union([
  z.strictObject({
    isNew: z.boolean(),
    volume: z.string().check(z.regex(/^\d+$/u)),
    index: z.string().check(z.regex(/^\d+$/u)),
  }),
  z.strictObject({ refusal: z.string() }),
])

/** Choose only a verified full-path platform root; refusals remain in diagnostics. */
export async function trustedPrivateRoot(
  packageRoot = path.resolve(__dirname, '..'),
  diagnostic: (message: string) => void = () => {
    /* Callers may inspect the thrown refusals. */
  },
): Promise<string> {
  for await (const root of trustedPrivateRoots(packageRoot, diagnostic, true)) return root
  throw new Error('ELSP_PRIVATE: no verified runtime root')
}

/** Stop visits every candidate; startup alone may create the stable fallback. */
export async function* trustedPrivateRoots(
  packageRoot: string,
  diagnostic: (message: string) => void,
  shouldCreate = false,
): AsyncGenerator<string> {
  const home = homedir()
  const candidates: { directory: string; mayCreate: boolean }[] = []
  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local')
    candidates.push({ directory: path.join(local, 'Muse Spark'), mayCreate: true })
  } else if (process.platform === 'darwin') {
    try {
      const output = await runProgram(
        path.join(packageRoot, 'native', 'darwin', 'muse-dictate'),
        ['private-temp'],
        noWorkspaceChildEnvironment(
          process.platform,
          withoutKeyringRoutes(withoutCredentials(process.env)),
          realpathSync,
        ),
      )
      candidates.push({
        directory: z.strictObject({ directory: z.string() }).parse(JSON.parse(output)).directory,
        mayCreate: false,
      })
    } catch (error: unknown) {
      diagnostic(`ELSP_PRIVATE: Darwin user temp: ${String(error)}`)
    }
    candidates.push({
      directory: path.join(home, 'Library', 'Application Support', 'Muse Spark'),
      mayCreate: true,
    })
  } else {
    for (const name of ['XDG_RUNTIME_DIR', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
      const directory = process.env[name]
      if (directory !== undefined) candidates.push({ directory, mayCreate: false })
    }
    candidates.push({
      directory: path.join(home, '.local', 'state', 'muse-spark'),
      mayCreate: true,
    })
  }
  const verified = new Set<string>()
  for (const candidate of candidates) {
    try {
      if (!path.isAbsolute(candidate.directory)) throw new Error('ELSP_PRIVATE: relative root')
      if (shouldCreate && candidate.mayCreate)
        await createTrustedRoot(candidate.directory, packageRoot)
      await privateDirectory(candidate.directory, false, packageRoot)
      const chosen = await realpath(candidate.directory)
      diagnostic(`ELSP_PRIVATE_ROOT: ${chosen}`)
      if (!verified.has(chosen)) {
        verified.add(chosen)
        yield chosen
      }
    } catch (error: unknown) {
      const reason =
        error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error)
      const refusal = `${candidate.directory}: ${reason}`
      diagnostic(refusal)
    }
  }
}

/** Environment-independent discovery namespace, verified before use. */
export async function stablePrivateRoot(packageRoot: string, shouldCreate = false) {
  const home = homedir()
  let root = path.join(home, '.local', 'state', 'muse-spark')
  if (process.platform === 'win32') root = path.join(home, 'AppData', 'Local', 'Muse Spark')
  else if (process.platform === 'darwin')
    root = path.join(home, 'Library', 'Application Support', 'Muse Spark')
  if (shouldCreate) await createTrustedRoot(root, packageRoot)
  await privateDirectory(root, false, packageRoot)
  return await realpath(root)
}

async function createTrustedRoot(root: string, packageRoot: string) {
  const { verifyTrustedPath } = await import('./trustedPath')
  const missing: string[] = []
  let existing = root
  for (;;) {
    try {
      await realpath(existing)
      break
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      missing.unshift(existing)
      existing = path.dirname(existing)
    }
  }
  if (process.platform !== 'win32')
    await verifyTrustedPath(existing, false, undefined, undefined, packageRoot)
  for (const directory of missing) await privateDirectory(directory, true, packageRoot)
}

async function windowsReceipt(directory: string, shouldCreate: boolean, packageRoot: string) {
  const env = withoutKeyringRoutes(withoutCredentials(process.env))
  const input = Buffer.from(JSON.stringify({ directory })).toString('base64')
  const sources = [JOB_SOURCE_FILES.shellJob, JOB_SOURCE_FILES.shared]
    .map((file) => powerShellQuoted(path.join(packageRoot, file)))
    .join(', ')
  const script = `$ErrorActionPreference = 'Stop'
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json
Add-Type -Path ${sources}
try { [MuseSparkPrivateDirectory]::Verify($inputData.directory, ${shouldCreate ? '$true' : '$false'}) } catch { @{ refusal = $_.Exception.Message } | ConvertTo-Json -Compress }`
  const executable = windowsPowerShell(env['SystemRoot'] ?? String.raw`C:\Windows`, env)
  try {
    const output = await runProgram(
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
    const receipt = receiptSchema.parse(JSON.parse(output))
    if ('refusal' in receipt)
      throw new Error('ELSP_PRIVATE', { cause: new Error(`${directory}: ${receipt.refusal}`) })
    return receipt
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'ELSP_PRIVATE') throw error
    throw new Error('ELSP_PRIVATE', { cause: error })
  }
}

async function darwinReceipt(
  handle: FileHandle,
  info: Awaited<ReturnType<typeof handleIdentity>>,
  command: string,
  packageRoot: string,
) {
  const env = withoutKeyringRoutes(withoutCredentials(process.env))
  const text = await new Promise<string>((resolve, reject) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- installed native fd ACL probe, held fd, branded no-workspace environment; no workspace command (PLAN §8).
    const child = spawn(
      path.join(packageRoot, 'native', 'darwin', 'muse-dictate'),
      [command, String(RUNTIME_STOP.launchFd)],
      {
        env: noWorkspaceChildEnvironment(process.platform, { ...env, LC_ALL: 'C' }, realpathSync),
        stdio: ['ignore', 'pipe', 'ignore', handle.fd],
      },
    )
    if (child.stdout === null) throw new Error('ELSP_PRIVATE')
    const chunks: Buffer[] = []
    child.stdout.on('data', (bytes: Buffer) => {
      chunks.push(bytes)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8'))
      else reject(new Error('ELSP_PRIVATE'))
    })
  })
  const receipt = z.strictObject({ device: z.string(), inode: z.string() }).parse(JSON.parse(text))
  if (!sameFile({ dev: BigInt(receipt.device), ino: BigInt(receipt.inode) }, info))
    throw new Error('ELSP_PRIVATE')
}

/** Verify the empty record's held fd before its first content write. */
export async function verifyPrivateHandle(
  handle: FileHandle,
  isDirectory: boolean,
  packageRoot = path.resolve(__dirname, '..'),
) {
  const info = await handleIdentity(handle)
  if (
    isDirectory ? !info.isDirectory() : !info.isFile() || info.nlink !== LSP_LIMITS.recordLinkCount
  )
    throw new Error('ELSP_PRIVATE')
  const uid = process.getuid?.()
  const mode = isDirectory ? LSP_LIMITS.directoryMode : LSP_LIMITS.fileMode
  if (
    uid === undefined ||
    info.uid !== BigInt(uid) ||
    (info.mode & BigInt(MODE_MASK)) !== BigInt(mode)
  )
    throw new Error('ELSP_PRIVATE')
  if (process.platform === 'darwin')
    await darwinReceipt(
      handle,
      info,
      isDirectory ? 'private-directory' : 'private-record',
      packageRoot,
    )
  return info
}

export async function privateDirectory(
  directory: string,
  shouldCreate = false,
  packageRoot = path.resolve(__dirname, '..'),
): Promise<{ isNew: boolean }> {
  const { verifyTrustedPath } = await import('./trustedPath')
  if (process.platform === 'win32') {
    let isNew = false
    await verifyTrustedPath(directory, true, undefined, async () => {
      const receipt = await windowsReceipt(directory, shouldCreate, packageRoot)
      isNew = receipt.isNew
    })
    return { isNew }
  }
  let isNew = false
  if (shouldCreate) {
    await verifyTrustedPath(path.dirname(directory), false, undefined, undefined, packageRoot)
    try {
      await mkdir(directory, { mode: LSP_LIMITS.directoryMode })
      isNew = true
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  await verifyTrustedPath(
    directory,
    true,
    async (handle) => {
      await verifyPrivateHandle(handle, true, packageRoot)
    },
    undefined,
    packageRoot,
  )
  return { isNew }
}

/** Windows CREATE_NEW/no-reparse is the native exclusive/no-follow file open. */
export async function writeWindowsPrivateRecord(
  file: string,
  text: string,
  packageRoot = path.resolve(__dirname, '..'),
) {
  const { verifyTrustedPath } = await import('./trustedPath')
  await verifyTrustedPath(path.dirname(file), true, undefined, async () => {
    const env = withoutKeyringRoutes(withoutCredentials(process.env))
    const sources = [JOB_SOURCE_FILES.shellJob, JOB_SOURCE_FILES.shared]
      .map((name) => powerShellQuoted(path.join(packageRoot, name)))
      .join(', ')
    const script = `$ErrorActionPreference = 'Stop'
Add-Type -Path ${sources}
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
[MuseSparkPrivateDirectory]::WriteRecord($data.file, $data.text)`
    const executable = windowsPowerShell(env['SystemRoot'] ?? String.raw`C:\Windows`, env)
    await new Promise<void>((resolve, reject) => {
      // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- trusted installed ACL helper writes only after held-handle proof; record payload on private stdin, sanitized environment (PLAN §8).
      const child = spawn(
        executable.file,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { env: executable.env, stdio: ['pipe', 'ignore', 'ignore'] },
      )
      child.once('error', reject)
      child.stdin.on('error', reject)
      child.once('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error('ELSP_PRIVATE'))
      })
      child.stdin.end(JSON.stringify({ file, text }))
    })
  })
}
