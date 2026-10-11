// First-use native creation. The host retains the sole root-grant authority.
import path from 'node:path'
import * as z from 'zod/mini'
import { lstat } from 'node:fs/promises'
import { pathModule } from '../../workspaceRoot'
import { windowsPathProblem } from '../../windowsPathSpelling'
import { powerShellQuoted } from '../../shellQuote'
import { resourceWindowsJob, runResourceNativeProgram } from '../../resources/admission'
import { scrubWorkerEnv } from './workerEnv'
import type { WorkerPathInput, WorkerFileHandle } from './workerFence'
import type { UiText } from '../../../shared/l10n/en'
import { setUiText } from '../../../shared/l10n/text'

import type * as WorkerAuthority from './workerFence'

type Authority = Pick<
  typeof WorkerAuthority,
  'confineWorkerPath' | 'isCheckedWorkerWriteAllowed' | 'recheckWorkerRoot' | 'withWorkerFile'
>
import type { WorkerRolePolicy } from './workerTypes'
import {
  UI_TEXT,
  WORKER_FILE_PATH_TIMEOUT_MS,
  WORKER_NATIVE_REPLY_MAX_BYTES,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../shared/constants'

const receipt = z.strictObject({
  identity: z.string().check(z.regex(/^\d+:\d+$/)),
  createdFolders: z.number().check(z.int(), z.minimum(0)),
})

export interface WorkerCreateProof {
  readonly root: string
  readonly rootIdentity: string
  readonly ancestor: string
  readonly ancestorIdentity: string
  readonly remaining: string
}

/** Packaged helper only; no compiler, pathname fallback, credential or shell payload. */
async function nativeOperation(proof: WorkerCreateProof, op: string, identity = '') {
  const args = [
    op,
    proof.root,
    proof.rootIdentity,
    proof.ancestor,
    proof.ancestorIdentity,
    proof.remaining,
    identity,
  ]
  let file: string
  let command: readonly string[] = args
  let env: NodeJS.ProcessEnv = { LC_ALL: 'C' }
  if (process.platform === 'win32') {
    const job = await resourceWindowsJob()
    const systemRoot = process.env['SystemRoot'] ?? process.env['SYSTEMROOT']
    if (job === undefined || systemRoot === undefined)
      throw new Error(UI_TEXT.teamFileHelperMissing)
    await job.verify()
    file = path.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH)
    env = { SystemRoot: systemRoot }
    command = [
      ...WINDOWS_POWERSHELL_COMMAND_ARGS,
      `$ErrorActionPreference='Stop'; try { [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(job.assemblyPath)}); [MuseSparkCreated]::Execute([string[]]@(${args.map((arg) => powerShellQuoted(arg)).join(',')})) } catch { if ($_.Exception.GetBaseException().Message -eq 'worker file helper refused: target exists') { [Console]::Error.WriteLine('worker file helper refused: target exists') }; exit 1 }`,
    ]
  } else if (process.platform === 'darwin') {
    file = path.join(__dirname, '..', 'native', 'darwin', 'muse-dictate')
    command = ['--created-directory', ...args]
  } else if (process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) {
    file = path.join(__dirname, '..', 'native', 'linux', process.arch, 'muse-created')
  } else throw new Error(UI_TEXT.teamFileHelperMissing)
  try {
    const result = await runResourceNativeProgram(
      file,
      command,
      scrubWorkerEnv({ platform: process.platform, baseEnv: env }),
      {
        timeoutMs: WORKER_FILE_PATH_TIMEOUT_MS,
        maxBytes: WORKER_NATIVE_REPLY_MAX_BYTES,
      },
    )
    return receipt.parse(JSON.parse(result))
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr.includes('worker file helper refused: target exists')
    )
      throw new Error(UI_TEXT.teamFileExists, { cause: error })
    throw new Error(
      error instanceof Error &&
        error.cause instanceof Error &&
        'code' in error.cause &&
        error.cause.code === 'ENOENT'
        ? UI_TEXT.teamFileHelperMissing
        : UI_TEXT.teamFileNativeFailed,
      { cause: error },
    )
  }
}

/** A missing suffix is admitted against its existing ancestor before any creation. */
export async function createWorkerFile(
  input: WorkerPathInput,
  absolute: string,
  role: WorkerRolePolicy,
  rootIdentity: string,
  authority: Authority,
  table: UiText,
  locale: string,
): Promise<WorkerFileHandle> {
  setUiText(table, locale)
  if (input.grant === undefined || input.io.openFile === undefined)
    throw new Error(UI_TEXT.teamFileHelperMissing)
  const { confineWorkerPath, isCheckedWorkerWriteAllowed, recheckWorkerRoot, withWorkerFile } =
    authority
  const grant = input.grant
  const root = await recheckWorkerRoot(input, grant)
  const p = pathModule(input.platform)
  if (windowsPathProblem(absolute, input.platform, root) !== undefined)
    throw new Error(UI_TEXT.teamFileOutside)
  const relative = p.relative(root, absolute).split(p.sep).join('/')
  if (relative === '' || relative.split('/').includes('..') || p.isAbsolute(relative))
    throw new Error(UI_TEXT.teamFileOutside)
  let ancestor = p.dirname(absolute)
  for (;;) {
    const target = await confineWorkerPath(input, ancestor)
    if (target.ok) {
      if (p.relative(ancestor, target.checkedAbsolute) !== '')
        throw new Error(UI_TEXT.teamFileLinked)
      const remaining = p.relative(ancestor, absolute).split(p.sep).join('/')
      const canonical = [target.canonical, remaining].filter(Boolean).join('/')
      if (!isCheckedWorkerWriteAllowed(role, { ...target, relative, canonical }))
        throw new Error(UI_TEXT.teamFileRoleDenied)
      // A dangling symlink is not a missing path, and neither is a device.
      try {
        await lstat(absolute)
        throw new Error(UI_TEXT.teamFileExists)
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      let proof: WorkerCreateProof = {
        root,
        rootIdentity,
        ancestor: target.canonical,
        ancestorIdentity: await input.io.pathIdentity(target.checkedAbsolute),
        remaining,
      }
      const run = input.io.workerNativeOperation ?? nativeOperation
      let createdFolders = 0
      if (remaining.includes('/')) {
        const prepared = receipt.parse(await run(proof, 'worker-prepare'))
        createdFolders = prepared.createdFolders
        proof = {
          ...proof,
          ancestor: p.dirname(canonical).split(p.sep).join('/'),
          ancestorIdentity: prepared.identity,
          remaining: p.basename(absolute),
        }
      }
      await input.beforeCreate?.(createdFolders)
      await recheckWorkerRoot(input, grant)
      const created = receipt.parse(await run(proof, 'worker-create'))
      const opened = await input.io.openFile(absolute, true)
      let isReserved = false
      const check = async () => {
        const current = await opened.identify()
        if (current.identity !== created.identity || p.relative(current.absolute, absolute) !== '')
          throw new Error(UI_TEXT.teamFileChanged)
        await recheckWorkerRoot(input, grant)
        return current
      }
      try {
        await check()
      } catch (error: unknown) {
        await opened.close()
        throw error
      }
      const handle: WorkerFileHandle = {
        ...opened,
        identify: check,
        write: async (content) => {
          await check()
          await run(proof, 'worker-check', created.identity)
          await check()
          await opened.write(content)
        },
        close: async () => {
          if (!isReserved) await opened.close()
        },
        reserve: () => {
          isReserved = true
          let isFinished = false
          const finish = async () => {
            if (isFinished) return
            isFinished = true
            await opened.close()
          }
          return {
            fill: async (bytes) => {
              if (isFinished) return 'changed'
              try {
                try {
                  await check()
                } catch {
                  return 'changed'
                }
                return await withWorkerFile(
                  { ...input, io: { ...input.io, openFile: () => Promise.resolve(handle) } },
                  absolute,
                  false,
                  async (_file, target) => {
                    if (!isCheckedWorkerWriteAllowed(role, target))
                      throw new Error(UI_TEXT.teamFileRoleDenied)
                    if (opened.readBytes === undefined)
                      throw new Error(UI_TEXT.teamFileHelperMissing)
                    try {
                      await opened.readBytes(0)
                    } catch {
                      return 'changed'
                    }
                    // Binary bytes use a verified existing descriptor, never a path reopen.
                    if (opened.writeBytes === undefined)
                      throw new Error(UI_TEXT.teamFileHelperMissing)
                    await run(proof, 'worker-check', created.identity)
                    await check()
                    await opened.writeBytes(bytes)
                    return 'done'
                  },
                  role,
                )
              } finally {
                await finish()
              }
            },
            release: async () => {
              if (isFinished) return 'changed'
              try {
                try {
                  await check()
                  if (opened.readBytes === undefined) throw new Error(UI_TEXT.teamFileHelperMissing)
                  await opened.readBytes(0)
                } catch {
                  return 'changed'
                }
                await run(proof, 'worker-release', created.identity)
                return 'done'
              } finally {
                await finish()
              }
            },
          }
        },
      }
      return handle
    }
    const parent = p.dirname(ancestor)
    if (parent === ancestor || ancestor === root) throw new Error(UI_TEXT.teamFileOutside)
    ancestor = parent
  }
}
