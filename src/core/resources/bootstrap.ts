import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { admitBootstrap } from './admission'
import { withoutCredentials } from '../credentialEnvironment'
import {
  CLI_OUTPUT_MAX_BYTES,
  PROCESS_TABLE_TIMEOUT_MS,
  WINDOWS_TASKKILL_RELATIVE_PATH,
} from '../../shared/constants'

/** Bootstrap tier: the compiler builds the containment helper it cannot yet use. */
export async function runBootstrap(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal; input?: string; cwd?: string; timeoutMs?: number } = {},
): Promise<string> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? PROCESS_TABLE_TIMEOUT_MS)
  const signal =
    options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline])
  const lease = await admitBootstrap(signal)
  let child
  try {
    signal.throwIfAborted()
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Admitted bootstrap compiler, bounded output/deadline and OS tree termination; no compiled job exists yet (PLAN SPAWN017B).
    child = spawn(file, [...args], {
      env: withoutCredentials(env),
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: 'pipe',
    })
  } catch (error: unknown) {
    lease.failed?.()
    lease.complete(true)
    throw error
  }
  lease.register({ pid: child.pid, group: process.platform !== 'win32' })
  const root = child
  return await new Promise<string>((resolve, reject) => {
    const output: Buffer[] = []
    let size = 0
    let isFailed = false
    let isOutputTooLarge = false
    let stopping: Promise<void> | undefined
    const stop = () => {
      isFailed = true
      stopping ??= (async () => {
        if (root.pid === undefined) return
        if (process.platform !== 'win32') {
          try {
            process.kill(-root.pid, 'SIGKILL')
          } catch (error: unknown) {
            if (!(
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'ESRCH'
            ))
              throw error
          }
          return
        }
        const systemRoot = process.env['SystemRoot']
        if (systemRoot === undefined) throw new Error('Bootstrap tree termination unavailable')
        await new Promise<void>((done, fail) => {
          // OS termination infrastructure must remain usable while admission is paused.
          // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Fixed SystemRoot taskkill, numeric owned root PID, bounded output/deadline, credential-free environment; emergency termination cannot queue behind pause (PLAN SPAWN017B, section 8).
          execFile(
            path.win32.join(systemRoot, WINDOWS_TASKKILL_RELATIVE_PATH),
            ['/PID', String(root.pid), '/T', '/F'],
            {
              env: { SystemRoot: systemRoot },
              windowsHide: true,
              timeout: PROCESS_TABLE_TIMEOUT_MS,
              maxBuffer: CLI_OUTPUT_MAX_BYTES,
            },
            (error) => {
              if (error === null || root.exitCode !== null || root.signalCode !== null) done()
              else fail(new Error('Bootstrap tree termination failed'))
            },
          )
        })
      })()
      void stopping.catch(reject)
    }
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const read = (bytes: Buffer, shouldKeep: boolean) => {
      size += bytes.length
      if (size > CLI_OUTPUT_MAX_BYTES) {
        isOutputTooLarge = true
        stop()
      } else if (shouldKeep) output.push(bytes)
    }
    root.stdout.on('data', (bytes: Buffer) => {
      read(bytes, true)
    })
    root.stderr.on('data', (bytes: Buffer) => {
      read(bytes, false)
    })
    root.stdin.on('error', stop)
    root.once('error', stop)
    root.once('close', (code) => {
      signal.removeEventListener('abort', stop)
      void (async () => {
        await stopping
        if (isFailed || code !== 0) {
          lease.failed?.()
          throw Object.assign(new Error('Bootstrap command failed'), {
            code: isOutputTooLarge ? 'outputLimit' : 'commandFailed',
          })
        }
        return Buffer.concat(output).toString('utf8')
      })()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          lease.complete(true)
        })
    })
    root.stdin.end(options.input)
  })
}
