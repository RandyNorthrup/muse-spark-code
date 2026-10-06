// Shared with companion token storage: refuse unsafe namespaces, never repair them.
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdir, open, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import process from 'node:process'
import * as z from 'zod/mini'
import { JOB_SOURCE_FILES } from '../host/backend/jobSource'
import { powerShellQuoted } from '../core/shellQuote'
import { runProgram, windowsPowerShell } from '../host/processTree'
import { handleIdentity, lstatIdentity, sameFile } from '../core/fs/fileIdentity'
import { LSP_LIMITS, RUNTIME_STOP, WORKSPACE_IDENTITY_ZERO } from '../shared/constants'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'

const MODE_MASK = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO

const receiptSchema = z.strictObject({
  isNew: z.boolean(),
  volume: z.string().check(z.regex(/^\d+$/u)),
  index: z.string().check(z.regex(/^\d+$/u)),
})

/** Private IPC never uses a shared temporary parent. */
export function trustedPrivateRoot(): string {
  if (process.platform === 'win32')
    return process.env['LOCALAPPDATA'] ?? path.join(homedir(), 'AppData', 'Local')
  return process.platform === 'darwin'
    ? path.join(homedir(), 'Library', 'Caches')
    : (process.env['XDG_RUNTIME_DIR'] ??
        process.env['XDG_CACHE_HOME'] ??
        path.join(homedir(), '.cache'))
}

async function windowsReceipt(
  directory: string,
  shouldCreate: boolean,
  packageRoot: string,
  trustedRoot: string,
) {
  const env = withoutKeyringRoutes(withoutCredentials(process.env))
  const input = Buffer.from(JSON.stringify({ directory, trustedRoot })).toString('base64')
  const sources = [JOB_SOURCE_FILES.shellJob, JOB_SOURCE_FILES.shared]
    .map((file) => powerShellQuoted(path.join(packageRoot, file)))
    .join(', ')
  const script = `$ErrorActionPreference = 'Stop'
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json
Add-Type -Path ${sources}
[MuseSparkPrivateDirectory]::VerifyParents($inputData.directory, $inputData.trustedRoot)
[MuseSparkPrivateDirectory]::Verify($inputData.directory, ${shouldCreate ? '$true' : '$false'})`
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
    return receipt
  } catch (error: unknown) {
    throw new Error('ELSP_PRIVATE', { cause: error })
  }
}

async function verifyParents(directory: string, trustedRoot: string, packageRoot: string) {
  const root = path.resolve(trustedRoot)
  let parent = path.dirname(path.resolve(directory))
  const relative = path.relative(root, parent)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('ELSP_PRIVATE')
  for (;;) {
    const handle = await open(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      const info = await handleIdentity(handle)
      const uid = process.getuid?.()
      if (
        uid === undefined ||
        !info.isDirectory() ||
        (info.uid !== BigInt(uid) && info.uid !== WORKSPACE_IDENTITY_ZERO) ||
        ((info.mode & BigInt(constants.S_IWGRP | constants.S_IWOTH)) !== WORKSPACE_IDENTITY_ZERO &&
          (info.mode & BigInt(LSP_LIMITS.stickyMode)) === WORKSPACE_IDENTITY_ZERO)
      )
        throw new Error('ELSP_PRIVATE')
      if (process.platform === 'darwin')
        await darwinReceipt(handle, info, 'private-ancestor', packageRoot)
      if (!sameFile(await lstatIdentity(parent), info)) throw new Error('ELSP_PRIVATE')
    } finally {
      await handle.close()
    }
    if (parent === root) return
    parent = path.dirname(parent)
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
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- installed native fd ACL probe, held fd, sanitized environment; no workspace command (PLAN §8).
    const child = spawn(
      path.join(packageRoot, 'native', 'darwin', 'muse-dictate'),
      [command, String(RUNTIME_STOP.launchFd)],
      { env: { ...env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore', handle.fd] },
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
  trustedRoot = trustedPrivateRoot(),
): Promise<{ isNew: boolean }> {
  if (process.platform === 'win32') {
    const receipt = await windowsReceipt(directory, shouldCreate, packageRoot, trustedRoot)
    return { isNew: receipt.isNew }
  }
  await verifyParents(directory, trustedRoot, packageRoot)
  let isNew = false
  if (shouldCreate) {
    try {
      await mkdir(directory, { mode: LSP_LIMITS.directoryMode })
      isNew = true
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    }
  }
  let handle: FileHandle
  try {
    handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ELOOP' || error.code === 'ENOTDIR')
    )
      throw new Error('ELSP_PRIVATE', { cause: error })
    throw error
  }
  try {
    const info = await verifyPrivateHandle(handle, true, packageRoot)
    if (!sameFile(await lstatIdentity(directory), info)) throw new Error('ELSP_PRIVATE')
    return { isNew }
  } finally {
    await handle.close()
  }
}

/** Windows CREATE_NEW/no-reparse is the native exclusive/no-follow file open. */
export async function writeWindowsPrivateRecord(
  file: string,
  text: string,
  packageRoot = path.resolve(__dirname, '..'),
  trustedRoot = trustedPrivateRoot(),
) {
  const env = withoutKeyringRoutes(withoutCredentials(process.env))
  const sources = [JOB_SOURCE_FILES.shellJob, JOB_SOURCE_FILES.shared]
    .map((name) => powerShellQuoted(path.join(packageRoot, name)))
    .join(', ')
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -Path ${sources}
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
[MuseSparkPrivateDirectory]::WriteRecord($data.file, $data.text, $data.root)`
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
    child.stdin.end(JSON.stringify({ file, text, root: trustedRoot }))
  })
}
