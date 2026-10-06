import process from 'node:process'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, constants, mkdir, readFile, realpath } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'
import {
  RESOURCE_TREE_STOP_POLL_MS,
  RESOURCE_TREE_STOP_TIMEOUT_MS,
} from '../../../shared/constants'
import type { ResourceTicket } from '../../../shared/resources'
import { LinuxResourceTreeReader, type LinuxTreeDeps } from './linux'
import { ResourceTreeRegistry } from './registry'
import { parseLinuxStat } from './posixTable'
import { runTreeProgram } from './run'

/** Trusted launch site only. Scope gate runs before any workload instruction or fork. */
export async function launchLinuxResourceTree(
  command: string,
  args: readonly string[],
  metadata: Pick<ResourceTicket, 'kind' | 'class' | 'sessionId'>,
  options: {
    readonly ownedCgroupRoot?: string
    readonly cwd?: string
    readonly env?: NodeJS.ProcessEnv
    readonly deps?: LinuxTreeDeps
  } = {},
) {
  if (process.platform !== 'linux') throw new Error('Linux resource launch unavailable')
  const id = `muse-spark-${randomUUID()}`
  const env = options.env ?? {}
  const gate = [
    '-c',
    `IFS= read -r scope && { [ "$scope" = - ] || printf '%s' "$$" > "$scope/cgroup.procs"; } && IFS= read -r gate && [ "$gate" = GO ] && exec "$@" 3<&-`,
    'resource-launch',
    command,
    ...args,
  ]
  let parent = options.ownedCgroupRoot
  let isManaged = false
  if (parent === undefined) {
    try {
      await readFile('/sys/fs/cgroup/cgroup.controllers', 'utf8')
      const managerOutput = await runTreeProgram(
        '/usr/bin/systemctl',
        ['--user', 'show', '--property=ControlGroup', '--value'],
        { XDG_RUNTIME_DIR: `/run/user/${String(process.getuid?.())}` },
      )
      const manager = managerOutput.trim()
      const candidate = `/sys/fs/cgroup${manager}/app.slice/${id}.scope`
      if (manager.startsWith(`/user.slice/user-${String(process.getuid?.())}.slice/`)) {
        parent = candidate
        isManaged = true
      }
    } catch {
      /* No user delegation: checked PID/tick fallback below. */
    }
  }
  if (parent === undefined) {
    try {
      const current = /^0::(\/[^\r\n]*)$/m.exec(await readFile('/proc/self/cgroup', 'utf8'))?.[1]
      if (current === undefined) throw new Error('Missing current cgroup')
      const candidate = `/sys/fs/cgroup${current}`
      if (
        candidate.startsWith(`/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/`)
      ) {
        await access(`${candidate}/cgroup.procs`, constants.W_OK)
        parent = candidate
      }
    } catch {
      /* Undelegated harness: group fallback. */
    }
  }
  const child = isManaged
    ? spawn(
        '/usr/bin/systemd-run',
        [
          '--user',
          '--scope',
          '--quiet',
          '--expand-environment=no',
          `--unit=${id}.scope`,
          '--property=Delegate=yes',
          '--',
          '/bin/sh',
          '-c',
          '"$@"; status=$?; IFS= read -r finish <&3; exit "$status"',
          'resource-keeper',
          '/bin/sh',
          ...gate,
        ],
        {
          cwd: options.cwd,
          env: { ...env, XDG_RUNTIME_DIR: `/run/user/${String(process.getuid?.())}` },
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        },
      )
    : spawn('/bin/sh', gate, {
        cwd: options.cwd,
        env,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
  // Attach before the first await: startup failure must never escape as an unhandled event.
  let startupError: Error | undefined
  child.on('error', (error) => {
    startupError = error
  })
  const reader = new LinuxResourceTreeReader({
    ...options.deps,
    ...(parent !== undefined && { ownedCgroupRoot: parent }),
  })
  const registry = new ResourceTreeRegistry(reader)
  const { stdin, stdout, stderr } = child
  const control = child.stdio[3]
  const release = () => {
    if (control !== null && control !== undefined && 'end' in control) control.end()
  }
  let ticket: ResourceTicket | undefined
  try {
    if (isManaged && (control === null || control === undefined || !('end' in control)))
      throw new Error('Missing scope launch pipes')
    let pid = child.pid
    let boundRoot: ResourceTicket['root'] | null = null
    let scope: ResourceTicket['scope'] | undefined
    if (parent !== undefined) {
      const deadline = Date.now() + RESOURCE_TREE_STOP_TIMEOUT_MS
      while (isManaged) {
        if (startupError !== undefined) throw startupError
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error('Delegated scope launch failed')
        try {
          const text = await readFile(`${parent}/cgroup.procs`, 'utf8')
          const pids = text.trim().split(/\s+/).map(Number)
          for (const member of pids) {
            const row = parseLinuxStat(await readFile(`/proc/${String(member)}/stat`, 'utf8'), 1, 1)
            if (row !== null && pids.includes(row.parent)) pid = row.pid
          }
          if (pid !== child.pid) break
        } catch {
          /* Scope and its gated child may still be starting. */
        }
        if (Date.now() >= deadline) throw new Error('Delegated scope launch timed out')
        await setTimeout(RESOURCE_TREE_STOP_POLL_MS)
      }
      const canonical = await realpath(parent)
      if (
        canonical !== parent ||
        !parent.startsWith(`/sys/fs/cgroup/user.slice/user-${String(process.getuid?.())}.slice/`)
      )
        throw new Error('Unowned delegated root')
      if (pid === undefined) throw new Error('Resource process did not start')
      boundRoot = await reader.identity(pid)
      if (boundRoot === null) throw new Error('Resource launch identity unavailable')
      const directory = `${parent}/${id}`
      await mkdir(directory)
      scope = { type: 'cgroup', path: directory }
      ticket = { id, root: boundRoot, scope, ...metadata }
      await reader.pin(ticket)
      stdin.write(`${directory}\n`)
      const joinedDeadline = Date.now() + RESOURCE_TREE_STOP_TIMEOUT_MS
      let membership = await readFile(`/proc/${String(pid)}/cgroup`, 'utf8')
      while (membership.trim() !== `0::${directory.slice('/sys/fs/cgroup'.length)}`) {
        if (Date.now() >= joinedDeadline) throw new Error('Scope join unavailable')
        await setTimeout(RESOURCE_TREE_STOP_POLL_MS)
        membership = await readFile(`/proc/${String(pid)}/cgroup`, 'utf8')
      }
    }
    if (pid === undefined || startupError !== undefined)
      throw startupError ?? new Error('Resource process did not start')
    const identity = boundRoot ?? (await reader.identity(pid))
    if (identity === null) throw new Error('Resource launch identity unavailable')
    ticket = {
      id,
      root: identity,
      scope: scope ?? { type: 'group', pgid: pid },
      ...metadata,
    }
    if (scope === undefined) stdin.write('-\n')
    ticket = await registry.register(ticket)
    stdin.write('GO\n')
    const launch = ticket
    // A managed keeper remains alive after root exit; poll the pinned completion receipt.
    let isStopping = false
    let checking: Promise<boolean> | undefined
    const completion = setInterval(() => {
      if (isStopping || checking !== undefined || launch.scope.type !== 'cgroup') return
      checking = reader.completed(launch, () =>
        registry.tickets().some((entry) => entry.id === launch.id),
      )
      void checking.then((done) => {
        if (done) {
          registry.unregister(launch)
          release()
          stdin.end()
          clearInterval(completion)
        }
        checking = undefined
      })
    }, RESOURCE_TREE_STOP_POLL_MS)
    completion.unref()
    child.once('exit', () => {
      clearInterval(completion)
    })
    return {
      child,
      stdin,
      stdout,
      stderr,
      ticket: launch,
      registry,
      async stop() {
        isStopping = true
        await checking
        const result = await registry.kill(launch)
        isStopping = false
        if (result.status === 'done' || result.status === 'gone') {
          clearInterval(completion)
          if (launch.scope.type === 'cgroup') registry.unregister(launch)
          release()
          stdin.end()
        }
        return result
      },
    }
  } catch (error: unknown) {
    stdin.end()
    if (ticket?.scope.type === 'cgroup') await reader.killCgroup(ticket, 'SIGKILL', () => true)
    if (ticket !== undefined) registry.unregister(ticket)
    release()
    throw error
  }
}
