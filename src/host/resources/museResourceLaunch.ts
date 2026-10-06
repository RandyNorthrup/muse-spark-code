import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnMspConnection } from '@muse-code/sdk'
import { posixQuoted } from '../../core/shellQuote'
import { resourceWindowsJob } from '../../core/resources/admission'
import type { ResourceLease } from '../../core/resources/launch'
import {
  RESOURCE_ID_MAX_LENGTH,
  RESOURCE_SAMPLE_MS,
  RESOURCE_LAUNCH_POLL_MS,
  RESOURCE_MUSE_SHUTDOWN_MS,
  RESOURCE_MUSE_CLOSE_GRACE_MS,
  RESOURCE_TIMER_MAX_MS,
} from '../../shared/constants'
import { prepareMcpJobLaunch } from '../backend/mcpJobLaunch'

interface MuseResourceCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly cwd?: string | undefined
}

/** The SDK owns the process group; its public child deliberately exposes no PID. */
async function museResourceLaunch(
  launch: MuseResourceCommand,
  resource: ResourceLease | undefined,
  assembly: string | undefined,
  systemRoot: string | undefined,
): Promise<
  MuseResourceCommand & {
    register(): Promise<void>
    dispose(): Promise<void>
    complete(isTreeGone: boolean): void
  }
> {
  const unchanged = {
    ...launch,
    register: () => {
      resource?.register({})
      return Promise.resolve()
    },
    dispose: () => Promise.resolve(),
    complete: (isTreeGone: boolean) => {
      resource?.complete(isTreeGone)
    },
  }
  if (resource === undefined) return unchanged
  if (process.platform === 'win32') {
    const helper = await resourceWindowsJob()
    if (assembly === undefined || systemRoot === undefined || helper === undefined)
      throw new Error('Windows Muse Code native job launcher unavailable')
    const prepared = prepareMcpJobLaunch({
      executablePath: helper.executablePath,
      file: launch.command,
      args: launch.args,
      cwd: launch.cwd ?? process.cwd(),
      env: launch.env ?? process.env,
      resource,
      resourceAssembly: assembly,
      isVerbatim: false,
      log: () => {
        /* Native control failures remain unknown in the resource reader. */
      },
    })
    prepared.stopWith(() => {
      void resource.kill?.().catch(() => {
        /* Failed proof cannot retire the tree. */
      })
    })
    return {
      command: helper.executablePath,
      args: [],
      env: prepared.env,
      register: () => {
        prepared.register()
        return Promise.resolve()
      },
      dispose: () => Promise.resolve(),
      complete: (isTreeGone) => {
        prepared.closeControl()
        resource.complete(isTreeGone)
      },
    }
  }
  // A private side file contains only the generated wrapper's PID, never CLI output.
  const folder = await mkdtemp(path.join(tmpdir(), 'muse-resource-'))
  const file = path.join(folder, 'root')
  return {
    command: '/bin/sh',
    complete: (isTreeGone) => {
      resource.complete(isTreeGone)
    },
    args: [
      '-c',
      `umask 077; printf '%s' "$$" > ${posixQuoted(file)}; exec ${posixQuoted(launch.command)} ${launch.args.map((arg) => posixQuoted(arg)).join(' ')}`,
    ],
    register: async () => {
      const deadline = Date.now() + RESOURCE_SAMPLE_MS
      while (Date.now() < deadline) {
        try {
          const text = await readFile(file, 'utf8')
          if (text.length > RESOURCE_ID_MAX_LENGTH || !/^\d+$/.test(text)) break
          const pid = Number(text)
          if (!Number.isSafeInteger(pid) || pid <= 0) break
          resource.register({ pid, group: true, parentPid: process.pid })
          return
        } catch {
          await delay(RESOURCE_LAUNCH_POLL_MS)
        }
      }
      resource.register({})
    },
    dispose: async () => {
      await rm(folder, { recursive: true, force: true })
    },
  }
}

/** Both SDK host paths share the same final spawn and registration boundary. */
export async function spawnResourceMuseConnection(
  options: Parameters<typeof spawnMspConnection>[0],
  resource: ResourceLease | undefined,
  assembly: () => Promise<string | undefined>,
  systemRoot: string | undefined,
  assertCanRun: () => Promise<void>,
): Promise<ReturnType<typeof spawnMspConnection>> {
  let launch: Awaited<ReturnType<typeof museResourceLaunch>> | undefined
  let handshake: ReturnType<typeof spawnMspConnection> | undefined
  try {
    const drainMs = options.shutdownTimeoutMs ?? RESOURCE_MUSE_SHUTDOWN_MS
    if (!Number.isSafeInteger(drainMs) || drainMs < 0 || drainMs > RESOURCE_TIMER_MAX_MS)
      throw new RangeError('Invalid Muse Code shutdown budget')
    const closeBoundMs = Math.min(RESOURCE_TIMER_MAX_MS, drainMs + RESOURCE_MUSE_CLOSE_GRACE_MS)
    launch = await museResourceLaunch(
      { command: options.command, args: options.args ?? [], env: options.env, cwd: options.cwd },
      resource,
      resource === undefined ? undefined : await assembly(),
      systemRoot,
    )
    await assertCanRun()
    // Windows' SDK ladder must not kill the launcher while the registry is
    // proving and stopping its job. Our deadline remains the caller's drain plus grace.
    handshake = spawnMspConnection({
      ...options,
      command: launch.command,
      args: [...launch.args],
      shutdownTimeoutMs:
        resource !== undefined && process.platform === 'win32' ? closeBoundMs : drainMs,
      ...(launch.env !== undefined && { env: launch.env }),
    })
    // All SDK close surfaces retain their actual exit evidence. A failed native
    // proof or pipes that remain open reject within the bound, never report success.
    const bounded = <T>(action: () => Promise<T>): (() => Promise<T>) => {
      let pending: Promise<T> | undefined
      return () =>
        (pending ??= (async () => {
          let forceTimer: NodeJS.Timeout | undefined
          let finalTimer: NodeJS.Timeout | undefined
          let wasForced = false
          let isExpired = false
          const force = async () => {
            wasForced = ((await resource?.kill?.()) ?? false) || wasForced
          }
          try {
            const stopped = new Promise<never>((_resolve, reject) => {
              forceTimer = setTimeout(() => {
                void force().catch(() => {
                  /* The final bound reports an unproved stop. */
                })
              }, drainMs)
              finalTimer = setTimeout(() => {
                isExpired = true
                reject(new Error('Muse Code shutdown did not prove process exit within its bound'))
              }, closeBoundMs)
            })
            const closing = async () => {
              let result: T
              try {
                result = await action()
              } catch (error: unknown) {
                await force()
                throw error
              }
              if (process.platform === 'win32' && resource?.isTreeGone !== undefined) {
                if (!(await resource.isTreeGone())) await force()
                while (!isExpired && !(await resource.isTreeGone()))
                  await delay(RESOURCE_LAUNCH_POLL_MS)
                if (isExpired)
                  throw new Error('Muse Code shutdown did not prove process exit within its bound')
                if (wasForced)
                  throw new Error('Muse Code shutdown force-stopped its registered tree')
              }
              return result
            }
            return await Promise.race([closing(), stopped])
          } finally {
            clearTimeout(forceTimer)
            clearTimeout(finalTimer)
          }
        })())
    }
    handshake.close = bounded(handshake.close.bind(handshake))
    handshake.child.close = bounded(handshake.child.close.bind(handshake.child))
    const initialize = handshake.initialize.bind(handshake)
    handshake.initialize = async (params) => {
      const spawned = await initialize(params)
      spawned.close = bounded(spawned.close.bind(spawned))
      return spawned
    }
    const ended = () => {
      launch?.complete(false)
    }
    void handshake.exited.then(ended).catch(ended)
    await launch.register()
    return handshake
  } catch (error: unknown) {
    if (handshake === undefined) {
      if (launch === undefined) resource?.complete(true)
      else launch.complete(true)
    } else {
      await handshake.close()
      launch?.complete(false)
    }
    throw error
  } finally {
    await launch?.dispose()
  }
}
