import type { ExecFileOptions } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_HELPER_MODE,
  LOCAL_JUDGE_PEER_BUILD,
  LOCAL_JUDGE_TIMEOUT_MS,
  WINDOWS_FRAMEWORK_RELATIVE_PATH,
} from '../../shared/constants'
import { isErrno } from '../../core/fs/errno'
import { executeGuarded } from '../../core/judge/local/guardedExec'
import { nativeHelperError } from '../../core/nativeHelper'

const execute = executeGuarded
/** How far down a failure's causes the exit status is looked for: wrappers are shallow. */
const HELPER_CAUSE_DEPTH = 8
export interface LocalJudgeHelperPaths {
  readonly packageRoot: string
  readonly storageRoot: string
}

/** Whether a guarded run failed by the program's own failing exit status (its cause carries a numeric `code`). */
function hasFailureExit(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < HELPER_CAUSE_DEPTH && current instanceof Error; depth++) {
    if ('code' in current && typeof current.code === 'number') return true
    current = current.cause
  }
  return false
}

/** Same-build native sources; callers never supply source or compiler arguments. */
export async function prepareLocalJudgeHelper(
  paths: LocalJudgeHelperPaths,
  platform: NodeJS.Platform = process.platform,
  signal: AbortSignal = AbortSignal.timeout(LOCAL_JUDGE_TIMEOUT_MS),
  run: (file: string, args: string[], options: ExecFileOptions) => Promise<unknown> = execute,
): Promise<string> {
  signal.throwIfAborted()
  if (!path.isAbsolute(paths.packageRoot) || !path.isAbsolute(paths.storageRoot))
    throw new Error('unverified-helper-path')
  if (platform !== 'win32' && platform !== 'linux' && platform !== 'darwin')
    throw new Error('unverified-platform')
  const source = path.join(
    paths.packageRoot,
    'native',
    platform === 'win32' ? 'windows' : platform,
    platform === 'darwin'
      ? 'muse-local-judge-peer'
      : `MuseSparkLocalJudgePeer.${platform === 'win32' ? 'cs' : 'c'}`,
  )
  // The macOS peer is a build output (build-local-judge.sh) that a source
  // checkout does not have until it is built: said with the command, as every
  // other shipped helper is. The sources the other platforms compile ship.
  let sourceStat
  try {
    sourceStat = await stat(source)
  } catch (error: unknown) {
    if (platform === 'darwin' && isErrno(error) && error.code === 'ENOENT')
      throw nativeHelperError('missing', source, platform, error, LOCAL_JUDGE_PEER_BUILD)
    throw error
  }
  if ((await realpath(source)) !== source || !sourceStat.isFile())
    throw new Error('unverified-helper-path')
  const options = {
    windowsHide: true,
    timeout: LOCAL_JUDGE_TIMEOUT_MS,
    maxBuffer: LOCAL_JUDGE_MAX_RESPONSE_BYTES,
    signal,
    env: platform === 'win32' ? { SystemRoot: process.env['SystemRoot'] } : {},
  }
  if (platform === 'darwin') {
    try {
      await run('/usr/bin/codesign', ['--verify', '--strict', source], options)
    } catch (error: unknown) {
      // codesign ran and refused the peer's signature (a failure exit): the
      // peer is there but this Mac will not trust it. Anything else (codesign
      // not starting, a stop) is not the peer's fault.
      if (signal.aborted || !hasFailureExit(error)) throw error
      throw nativeHelperError('unloadable', source, platform, error, LOCAL_JUDGE_PEER_BUILD)
    }
    return source
  }
  const contents = await readFile(source)
  const digest = createHash('sha256').update(contents).digest('hex')
  await mkdir(paths.storageRoot, { recursive: true })
  const directory = await realpath(paths.storageRoot)
  const suffix = platform === 'win32' ? '.exe' : ''
  const target = path.join(directory, `local-judge-peer-${digest}${suffix}`)
  const output = path.join(directory, `${randomUUID()}${suffix}`)
  try {
    if (platform === 'win32') {
      const systemRoot = process.env['SystemRoot']
      if (!systemRoot || !path.win32.isAbsolute(systemRoot))
        throw new Error('unverified-compiler-path')
      await run(
        path.win32.join(systemRoot, WINDOWS_FRAMEWORK_RELATIVE_PATH, 'csc.exe'),
        ['/nologo', '/target:exe', '/r:System.Runtime.Serialization.dll', `/out:${output}`, source],
        options,
      )
    } else {
      await run(
        '/usr/bin/cc',
        ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', source, '-o', output],
        options,
      )
      await chmod(output, LOCAL_JUDGE_HELPER_MODE)
    }
    signal.throwIfAborted()
    await rename(output, target)
    return target
  } finally {
    await rm(output, { force: true })
  }
}
