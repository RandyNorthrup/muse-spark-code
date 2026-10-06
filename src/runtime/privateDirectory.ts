// Shared with companion token storage: refuse unsafe namespaces, never repair them.
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdir, open, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { JOB_SOURCE_FILES } from '../host/backend/jobSource'
import { powerShellQuoted } from '../core/shellQuote'
import { runProgram, windowsPowerShell } from '../host/processTree'
import { handleIdentity, sameFile } from '../core/fs/fileIdentity'
import { LSP_LIMITS, RUNTIME_STOP } from '../shared/constants'
import { withoutCredentials, withoutKeyringRoutes } from './credentialVariables'

const MODE_MASK = constants.S_IRWXU | constants.S_IRWXG | constants.S_IRWXO

const receiptSchema = z.strictObject({
  isNew: z.boolean(),
  volume: z.string().check(z.regex(/^\d+$/u)),
  index: z.string().check(z.regex(/^\d+$/u)),
})

export async function privateDirectory(
  directory: string,
  shouldCreate = false,
  packageRoot = path.resolve(__dirname, '..'),
): Promise<{ isNew: boolean }> {
  const env = withoutKeyringRoutes(withoutCredentials(process.env))
  if (process.platform === 'win32') {
    const input = Buffer.from(JSON.stringify({ directory })).toString('base64')
    const sources = [JOB_SOURCE_FILES.shellJob, JOB_SOURCE_FILES.shared]
      .map((file) => powerShellQuoted(path.join(packageRoot, file)))
      .join(', ')
    const script = `$ErrorActionPreference = 'Stop'
$inputData = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${input}')) | ConvertFrom-Json
Add-Type -Path ${sources}
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
      return { isNew: receipt.isNew }
    } catch (error: unknown) {
      throw new Error('ELSP_PRIVATE', { cause: error })
    }
  }
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
    const info = await handleIdentity(handle)
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
    if (
      uid === undefined ||
      !info.isDirectory() ||
      info.uid !== BigInt(uid) ||
      (info.mode & BigInt(MODE_MASK)) !== BigInt(LSP_LIMITS.directoryMode)
    )
      throw new Error('ELSP_PRIVATE')
    if (process.platform === 'darwin') {
      // The native ACL receipt is bound to the same directory fd as fstat.
      const text = await new Promise<string>((resolve, reject) => {
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- installed native fd ACL probe, held directory fd, sanitized environment; no workspace command (PLAN §8).
        const child = spawn(
          path.join(packageRoot, 'native', 'darwin', 'muse-dictate'),
          ['private-directory', String(RUNTIME_STOP.launchFd)],
          {
            env: { ...env, LC_ALL: 'C' },
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
      const receipt = z
        .strictObject({ device: z.string(), inode: z.string() })
        .parse(JSON.parse(text))
      if (!sameFile({ dev: BigInt(receipt.device), ino: BigInt(receipt.inode) }, info))
        throw new Error('ELSP_PRIVATE')
    }
    return { isNew }
  } finally {
    await handle.close()
  }
}
