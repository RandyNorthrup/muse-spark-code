import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveExecutable } from '../executables'
import { environmentValue } from '../backends/musecode/launch'
import { CLI_OUTPUT_MAX_BYTES, PROCESS_TABLE_TIMEOUT_MS } from '../../shared/constants'
import { spawnResourceProcess } from './process'
import {
  ResourceCapRefusedError,
  ResourceMemoryLimitError,
  type ResourceHandoffUntil,
} from './launch'

function resolveCommand(command: string, env: NodeJS.ProcessEnv): string {
  const file = path.isAbsolute(command)
    ? command
    : resolveExecutable(command, {
        platform: process.platform,
        pathVariable: environmentValue(env, process.platform, 'PATH'),
        fileExists: existsSync,
      })
  if (file === undefined || !existsSync(file)) throw new Error('Governed command unavailable')
  return file
}

/**
 * Hand a URL, file or text to a fixed OS adapter (opener, clipboard). Waits for
 * the adapter's own exit inside RESOURCE_HANDOFF_TIMEOUT_MS; one still running
 * then is detached and counts as launched. Never waits for, or stops, what the
 * OS started for the user. `until: 'spawn'` is for a foreground handler
 * (xdg-open), launched once started; it takes no input.
 */
export async function handoffResourceFile(
  command: string,
  args: readonly string[],
  options: {
    readonly env: NodeJS.ProcessEnv
    readonly input?: string
    signal?: AbortSignal
    readonly until?: ResourceHandoffUntil
  },
): Promise<void> {
  const file = resolveCommand(command, options.env)
  const { child, handedOff } = await spawnResourceProcess('handoff', file, args, {
    env: options.env,
    ...(options.signal !== undefined && { signal: options.signal }),
    ...(options.until !== undefined && { handoffUntil: options.until }),
  })
  const { stdin } = child
  if (stdin === null) {
    await handedOff
    return
  }
  await new Promise<void>((resolve, reject) => {
    stdin.once('error', () => {
      reject(new Error('Governed handoff failed'))
    })
    void (async () => {
      try {
        await handedOff
        resolve()
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error('Governed handoff failed'))
      }
    })()
    stdin.end(options.input ?? '')
  })
}

/** execFile-compatible bounded results, using the ordinary governed command runner. */
export async function execResourceFile(
  profile: 'contained' | 'probe',
  command: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  const env = options.env ?? process.env
  const file = resolveCommand(command, env)
  const deadline = AbortSignal.timeout(options.timeout ?? PROCESS_TABLE_TIMEOUT_MS)
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
  const launched = await spawnResourceProcess(profile, file, args, {
    env,
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    signal,
  })
  const { child, stop } = launched
  child.stdin.end()
  return await new Promise((resolve, reject) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    const max = options.maxBuffer ?? CLI_OUTPUT_MAX_BYTES
    let bytesRead = 0
    let isFailed = false
    let stopping: Promise<void> | undefined
    const abort = () => {
      isFailed = true
      stopping ??= stop()
      void stopping.catch(() => {
        reject(new Error('Governed command tree stop failed'))
      })
    }
    // One named deadline covers admission and the run (the launch also stops on it).
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.stdout.on('data', (bytes: Buffer) => {
      bytesRead += bytes.length
      if (bytesRead > max) abort()
      else out.push(bytes)
    })
    child.stderr.on('data', (bytes: Buffer) => {
      bytesRead += bytes.length
      if (bytesRead > max) abort()
      else err.push(bytes)
    })
    child.once('error', () => {
      abort()
    })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      void (async () => {
        await stopping
        const outcome = await launched.outcome()
        // A refused child or an enforced memory cap is a typed failure, even after exit 0.
        const memory = outcome?.limits.find((limit) => limit !== 'activeProcess')
        if (memory !== undefined) throw new ResourceMemoryLimitError(memory)
        if (outcome !== undefined && outcome.capRefusals > 0)
          throw new ResourceCapRefusedError(outcome.capRefusals)
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

/**
 * Binary-safe bounded helper commands through the same governed boundary:
 * stdout stays a Buffer (git reads blobs and arbitrary filenames), stderr is
 * text for the typed failure. Same admission, deadline and combined cap.
 */
export async function execResourceFileBytes(
  profile: 'contained' | 'probe',
  command: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding & { readonly input?: string | undefined },
): Promise<{ stdout: Buffer; stderr: string }> {
  const file = resolveCommand(command, options.env ?? process.env)
  return await new Promise((resolve, reject) => {
    void (async () => {
      const { input, ...spawnOptions } = options
      const launched = await spawnResourceProcess(profile, file, args, spawnOptions)
      const { child, stop } = launched
      child.stdin.end(input)
      const out: Buffer[] = []
      const err: Buffer[] = []
      const cap = options.maxBuffer ?? CLI_OUTPUT_MAX_BYTES
      let bytes = 0
      let isFailed = false
      let stopping: Promise<void> | undefined
      const abort = (): void => {
        if (isFailed) return
        isFailed = true
        stopping ??= stop()
        void stopping.catch(() => {
          reject(new Error('Governed command tree stop failed'))
        })
      }
      const push = (chunk: Buffer, to: Buffer[]): void => {
        bytes += chunk.length
        if (bytes > cap) abort()
        else to.push(chunk)
      }
      child.stdout.on('data', (chunk: Buffer) => {
        push(chunk, out)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        push(chunk, err)
      })
      child.once('error', abort)
      child.once('close', (code) => {
        void (async () => {
          await stopping
          let report: Awaited<ReturnType<typeof launched.outcome>> | undefined
          try {
            report = await launched.outcome()
          } catch {
            report = undefined
          }
          const memory = report?.limits.find((limit) => limit !== 'activeProcess')
          if (memory !== undefined) throw new ResourceMemoryLimitError(memory)
          if (report !== undefined && report.capRefusals > 0)
            throw new ResourceCapRefusedError(report.capRefusals)
          const result = {
            stdout: Buffer.concat(out),
            stderr: Buffer.concat(err).toString('utf8'),
          }
          if (code === 0 && !isFailed) resolve(result)
          else
            reject(
              Object.assign(new Error('Governed command failed'), {
                ...result,
                code,
              }),
            )
        })().catch(reject)
      })
    })().catch(reject)
  })
}
