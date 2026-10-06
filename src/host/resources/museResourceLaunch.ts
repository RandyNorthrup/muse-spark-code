import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawnMspConnection } from '@muse-code/sdk'
import { powerShellQuoted, posixQuoted } from '../../core/shellQuote'
import type { ResourceLease } from '../../core/resources/launch'
import {
  RESOURCE_ID_MAX_LENGTH,
  RESOURCE_SAMPLE_MS,
  RESOURCE_LAUNCH_POLL_MS,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
} from '../../shared/constants'
import { windowsPowerShell } from '../processTree'
import { joinStatement, newShellJob } from '../backend/shellJob'
import { holdResourceJob } from './resourceJobHolder'

interface MuseResourceCommand {
  readonly command: string
  readonly args: readonly string[]
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
    if (assembly === undefined || systemRoot === undefined) return unchanged
    const job = newShellJob(assembly)
    const held = await holdResourceJob(resource, job, systemRoot)
    return {
      command: windowsPowerShell(systemRoot).file,
      args: [
        ...WINDOWS_POWERSHELL_COMMAND_ARGS,
        `${joinStatement(job, true)}& ${powerShellQuoted(launch.command)} ${launch.args.map((arg) => powerShellQuoted(arg)).join(' ')}; exit $LASTEXITCODE`,
      ],
      register: () => {
        held.register({ job })
        return Promise.resolve()
      },
      dispose: () => Promise.resolve(),
      complete: (isTreeGone) => {
        held.complete(isTreeGone)
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
    launch = await museResourceLaunch(
      { command: options.command, args: options.args ?? [] },
      resource,
      resource === undefined ? undefined : await assembly(),
      systemRoot,
    )
    await assertCanRun()
    handshake = spawnMspConnection({ ...options, command: launch.command, args: [...launch.args] })
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
