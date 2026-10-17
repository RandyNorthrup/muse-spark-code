import { type ChildProcess } from 'node:child_process'
import { Writable } from 'node:stream'
import { constants } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  UI_TEXT,
  VAULT_LIMITS,
  PROCESS_TABLE_TIMEOUT_MS,
  SHELL_DRAIN_GRACE_MS,
} from '../../shared/constants'
import { type ShellTimeLimit } from '../../core/backends/modelapi/tools'
import { type ShellResult, unstartedShell, refusedShellEntry } from '../../core/shellResult'
import {
  vaultExecEnvelopeSchema,
  vaultExecResultSchema,
  type VaultExecEnvelope,
} from '../../core/vault/exec/schema'
import { vaultFenceEnvironment } from '../../core/vault/exec/fence'
import { type VaultExecFeederPort } from '../../core/vault/exec/feeder'
import { runCommand } from '../backend/toolIo'
import { vaultPrivateDirectory } from '../../core/vault/broker/files'
import { posixQuoted } from '../../core/shellQuote'
import { killTree, type ProcessTreeDeps, type ShellJob } from '../processTree'

export interface VaultExecSpawnDeps {
  readonly nodePath: string
  /** W's composed executable, including authenticated B transport and T streaming scrub. */
  readonly feederPath: string
  readonly env: () => NodeJS.ProcessEnv
  readonly tree: ProcessTreeDeps
  readonly job?: ShellJob
  readonly timeoutMs: number
  readonly limit?: ShellTimeLimit
  readonly runAsNode?: boolean
  /** Windows must bind the feeder's job before releasing its pipe (M27/M50's GO fence). */
  /** Required on every platform: terminate the complete registered tree after root exit too. */
  readonly terminateContained?: (child: ChildProcess) => Promise<void>
  readonly spawnContained?: (
    file: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ) => ChildProcess
}

/** The ticket is sent only on the last inherited stdio pipe, never argv or environment. */
export async function spawnVaultFeeder(
  deps: VaultExecSpawnDeps,
  input: VaultExecEnvelope,
  signal: AbortSignal,
  assertCanRun: () => void,
): Promise<ShellResult> {
  if (signal.aborted) return refusedShellEntry()
  const spawnContained = deps.spawnContained
  const terminateContained = deps.terminateContained
  if (!spawnContained || !terminateContained || (deps.tree.platform === 'win32' && !deps.job))
    return unstartedShell(UI_TEXT.vault.brokerBlocked)
  const envelope = vaultExecEnvelopeSchema.parse(input)
  const bytes = Buffer.alloc(Buffer.byteLength(JSON.stringify(envelope)))
  bytes.write(JSON.stringify(envelope))
  if (bytes.length > VAULT_LIMITS.frameBytes) {
    bytes.fill(0)
    return unstartedShell(UI_TEXT.vault.noAccess)
  }
  const env = vaultFenceEnvironment(deps.env())
  if (deps.runAsNode) env['ELECTRON_RUN_AS_NODE'] = '1'
  let child: ChildProcess
  const startedAt = Date.now()
  try {
    assertCanRun()
    signal.throwIfAborted()
    child = spawnContained(deps.nodePath, [deps.feederPath], env)
  } catch {
    bytes.fill(0)
    return unstartedShell(UI_TEXT.vault.noAccess)
  }
  return await new Promise<ShellResult>((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let hasSettled = false
    let isTimedOut = false
    let hasInvalidFrame = false
    let drain: ReturnType<typeof setTimeout> | undefined
    let kill: Promise<void> | undefined
    let hasTerminationFailed = false
    const stop = () => {
      kill ??= (async () => {
        let deadline: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            terminateContained(child),
            new Promise<void>((_resolve, reject) => {
              deadline = setTimeout(() => {
                reject(new Error(UI_TEXT.vault.noAccess))
              }, PROCESS_TABLE_TIMEOUT_MS)
            }),
          ])
        } catch {
          hasTerminationFailed = true
          // Best effort ends the root's group/job; only the native port can prove the compound tree.
          await killTree(child, deps.tree, startedAt, deps.job)
        } finally {
          clearTimeout(deadline)
        }
      })()
      void (async () => {
        await kill
        if (!hasSettled) settle(child.exitCode)
      })()
    }
    const settle = (code: number | null) => {
      if (hasSettled) return
      hasSettled = true
      clearTimeout(timer)
      clearTimeout(drain)
      signal.removeEventListener('abort', stop)
      child.stdout?.destroy()
      child.stderr?.destroy()
      const collected = Buffer.alloc(total)
      let offset = 0
      for (const chunk of chunks) {
        collected.set(chunk, offset)
        offset += chunk.length
        chunk.fill(0)
      }
      let result: ShellResult = {
        stdout: '',
        stderr: UI_TEXT.vault.noAccess,
        exitCode: null,
        isTimedOut,
        isCancelled: signal.aborted,
      }
      try {
        if (!hasInvalidFrame && !isTimedOut && code === 0 && !signal.aborted) {
          const { isOutputTooLarge, ...parsed } = vaultExecResultSchema.parse(
            JSON.parse(collected.toString('utf8')),
          )
          result = { ...parsed, ...(isOutputTooLarge !== undefined && { isOutputTooLarge }) }
        }
      } catch {
        /* No unvalidated feeder output or exception text reaches the tool. */
      } finally {
        collected.fill(0)
        bytes.fill(0)
      }
      stop()
      void (kill ?? Promise.resolve()).then(() => {
        resolve(
          hasTerminationFailed
            ? { ...result, stdout: '', stderr: UI_TEXT.vault.noAccess, exitCode: null }
            : result,
        )
      })
    }
    const timer = setTimeout(() => {
      isTimedOut = true
      stop()
    }, deps.timeoutMs)
    deps.limit?.bind(() => {
      clearTimeout(timer)
    })
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    child.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > VAULT_LIMITS.frameBytes) {
        hasInvalidFrame = true
        total -= chunk.length
        chunk.fill(0)
        stop()
        return
      }
      const copy = Buffer.alloc(chunk.length)
      copy.set(chunk)
      chunks.push(copy)
      chunk.fill(0)
    })
    child.stderr?.on('data', (chunk: Buffer) => chunk.fill(0))
    child.once('error', () => {
      settle(null)
    })
    child.once('exit', (code) => {
      if (hasSettled) return
      drain = setTimeout(() => {
        settle(code)
      }, SHELL_DRAIN_GRACE_MS)
    })
    child.once('close', (code) => {
      settle(code)
    })
    const pipe = child.stdio.at(-1)
    if (!(pipe instanceof Writable) || !child.stdout || !child.stderr) {
      stop()
      settle(null)
      return
    }
    pipe.once('error', () => {
      stop()
    })
    pipe.end(bytes, () => bytes.fill(0))
  })
}

/** Runs inside the feeder's inherited Windows job, or its own POSIX process group. */
export function vaultExecProcessRunner(
  tree: ProcessTreeDeps,
  timeoutMs: number,
  terminateTree: (child: ChildProcess) => Promise<void>,
  job?: ShellJob,
): VaultExecFeederPort['run'] {
  return async (invocation, signal, onStdout, onStderr) => {
    if (!job && tree.platform === 'win32') throw new Error(UI_TEXT.vault.brokerBlocked)
    const {
      stdout: _stdout,
      stderr: _stderr,
      ...result
    } = await runCommand({
      file: invocation.file,
      args: invocation.args,
      cwd: invocation.cwd,
      env: invocation.env,
      timeoutMs: invocation.cleanup ? Math.min(timeoutMs, PROCESS_TABLE_TIMEOUT_MS) : timeoutMs,
      signal,
      tree,
      job,
      stdin: invocation.stdin ?? undefined,
      onStdout,
      onStderr,
      killOnExit: true,
      terminateTree,
      hasExternalTimeout: invocation.cleanup !== true,
    })
    return result
  }
}

/** Wrappers contain only executable/endpoint paths. Values and tickets are never written. */
export async function prepareVaultExecHelperPaths(
  root: string,
  nodePath: string,
  entryPath: string,
  endpoint: string,
  platform: NodeJS.Platform,
  /** P supplies owner-only DACL verification on Windows; never POSIX mode-bit inference. */
  secureDirectory?: (path: string) => Promise<void>,
) {
  if (!secureDirectory && process.platform === 'win32') throw new Error(UI_TEXT.vault.noAccess)
  const protect = secureDirectory ?? vaultPrivateDirectory
  await protect(root)
  const folder = await mkdtemp(path.join(root, 'helper-'))
  const refusingHelper = path.join(folder, platform === 'win32' ? 'refuse.cmd' : 'refuse')
  const askpassPath = path.join(folder, 'askpass')
  const command = `${posixQuoted(nodePath)} ${posixQuoted(entryPath)} helper`
  const gitHelper = `!${command} git ${posixQuoted(endpoint)}`
  try {
    await protect(folder)
    const mode = constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR
    await writeFile(
      refusingHelper,
      platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n',
      { flag: 'wx', mode },
    )
    if (platform !== 'win32')
      await writeFile(
        askpassPath,
        `#!/bin/sh\nexec ${command} askpass ${posixQuoted(endpoint)}\n`,
        { flag: 'wx', mode },
      )
    return {
      gitHelper,
      askpassPath: platform === 'win32' ? refusingHelper : askpassPath,
      refusingHelper,
      close: async () => {
        await rm(folder, { recursive: true, force: true })
      },
    }
  } catch (error: unknown) {
    await rm(folder, { recursive: true, force: true })
    throw error
  }
}
