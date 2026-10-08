import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveExecutable } from '../executables'
import { environmentValue } from '../backends/musecode/launch'
import { CLI_OUTPUT_MAX_BYTES, PROCESS_TABLE_TIMEOUT_MS } from '../../shared/constants'
import { spawnResourceCommand } from './process'

/** execFile-compatible bounded results, using the ordinary governed command runner. */
export async function execResourceFile(
  command: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  const env = options.env ?? process.env
  const file = path.isAbsolute(command)
    ? command
    : resolveExecutable(command, {
        platform: process.platform,
        pathVariable: environmentValue(env, process.platform, 'PATH'),
        fileExists: existsSync,
      })
  if (file === undefined || !existsSync(file)) throw new Error('Governed command unavailable')
  const { child, stop } = await spawnResourceCommand(file, args, {
    env,
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    ...(options.signal !== undefined && { signal: options.signal }),
  })
  child.stdin.end()
  return await new Promise((resolve, reject) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    const max = options.maxBuffer ?? CLI_OUTPUT_MAX_BYTES
    let outBytes = 0
    let errBytes = 0
    let isFailed = false
    let stopping: Promise<void> | undefined
    const abort = () => {
      isFailed = true
      stopping ??= stop()
      void stopping.catch(() => {
        reject(new Error('Governed command tree stop failed'))
      })
    }
    const timer = setTimeout(abort, options.timeout ?? PROCESS_TABLE_TIMEOUT_MS)
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    child.stdout.on('data', (bytes: Buffer) => {
      outBytes += bytes.length
      if (outBytes > max) abort()
      else out.push(bytes)
    })
    child.stderr.on('data', (bytes: Buffer) => {
      errBytes += bytes.length
      if (errBytes > max) abort()
      else err.push(bytes)
    })
    child.once('error', () => {
      abort()
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      void (async () => {
        await stopping
        const result = {
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
        }
        if (code === 0 && !isFailed) resolve(result)
        else
          reject(
            Object.assign(new Error('Governed command failed'), {
              ...result,
              code: isFailed ? -1 : code,
            }),
          )
      })().catch(reject)
    })
  })
}
