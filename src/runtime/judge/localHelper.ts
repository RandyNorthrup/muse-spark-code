import { execFile, type ExecFileOptions } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_HELPER_MODE,
  LOCAL_JUDGE_TIMEOUT_MS,
  WINDOWS_FRAMEWORK_RELATIVE_PATH,
} from '../../shared/constants'

const execute = promisify(execFile)
export interface LocalJudgeHelperPaths {
  readonly packageRoot: string
  readonly storageRoot: string
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
  const sourceStat = await stat(source)
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
    await run('/usr/bin/codesign', ['--verify', '--strict', source], options)
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
