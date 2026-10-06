// Shared with companion token storage: refuse unsafe namespaces, never repair them.
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdir, realpath, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import process from 'node:process'
import * as z from 'zod/mini'
import { JOB_SOURCE_FILES } from '../host/backend/jobSource'
import { powerShellQuoted } from '../core/shellQuote'
import { runProgram, windowsPowerShell } from '../host/processTree'
import { handleIdentity, sameFile } from '../core/fs/fileIdentity'
import { LSP_LIMITS, RUNTIME_STOP } from '../shared/constants'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'

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
        withoutKeyringRoutes(withoutCredentials(process.env)),
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
