import path from 'node:path'
import * as z from 'zod/mini'
import { powerShellQuoted } from '../../shellQuote'
import {
  SHELL_JOB_TYPE_NAME,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../shared/constants'
import {
  resourceProcessIdentitySchema,
  resourceTreeUsageSchema,
  type ResourceProcessIdentity,
  type ResourceTicket,
  type ResourceTreeReader,
  type ResourceTreeUsage,
} from '../../../shared/resources'
import { runTreeProgram, type ResourceTreeRun } from './run'
import {
  resourceActionResultSchema,
  type ResourceActionResult,
  type ResourceSignal,
} from './actions'

const querySchema = z.strictObject({
  members: z.array(resourceProcessIdentitySchema),
  usage: resourceTreeUsageSchema,
})

export interface WindowsTreeDeps {
  /** M27's compiled, source-digested assembly, acquired lazily by the spawning adapter. */
  readonly assemblyPath: string
  readonly systemRoot: string
  readonly run?: ResourceTreeRun
}

export class WindowsResourceTreeReader implements ResourceTreeReader {
  private readonly known = new Map<string, { members: readonly ResourceProcessIdentity[] }>()
  constructor(private readonly deps: WindowsTreeDeps) {
    if (!path.win32.isAbsolute(deps.assemblyPath) || !path.win32.isAbsolute(deps.systemRoot))
      throw new Error('Resource helper paths must be absolute')
  }

  private async call(body: string): Promise<unknown> {
    const script = `try { [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(this.deps.assemblyPath)}); ${body} } catch { exit 1 }`
    const text = await (this.deps.run ?? runTreeProgram)(
      path.win32.join(this.deps.systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
      [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
      { SystemRoot: this.deps.systemRoot },
    )
    const value: unknown = JSON.parse(text)
    return value
  }

  private epoch(id: string): { members: readonly ResourceProcessIdentity[] } {
    let state = this.known.get(id)
    if (state === undefined) {
      state = { members: [] }
      this.known.set(id, state)
    }
    return state
  }

  private async query(ticket: ResourceTicket): Promise<z.infer<typeof querySchema> | null> {
    if (ticket.scope.type !== 'job') return null
    const state = this.epoch(ticket.id)
    const answer = await this.call(
      `[${SHELL_JOB_TYPE_NAME}]::Query(${powerShellQuoted(ticket.scope.name)})`,
    )
    if (answer === null || this.known.get(ticket.id) !== state) return null
    const parsed = querySchema.parse(answer)
    const hasAnchor = parsed.members.some(
      (member) =>
        (member.pid === ticket.root.pid && member.startTime === ticket.root.startTime) ||
        state.members.some(
          (known) => known.pid === member.pid && known.startTime === member.startTime,
        ),
    )
    if (!hasAnchor && !(parsed.members.length === 0 && state.members.length > 0)) {
      this.known.delete(ticket.id)
      return null
    }
    for (const member of parsed.members) {
      if (
        state.members.every(
          (known) => !(known.pid === member.pid && known.startTime === member.startTime),
        )
      )
        state.members = [...state.members, structuredClone(member)]
    }
    return parsed
  }

  forget(ticket: ResourceTicket): void {
    this.known.delete(ticket.id)
  }

  async identity(pid: number): Promise<ResourceProcessIdentity | null> {
    if (!resourceProcessIdentitySchema.safeParse({ pid, startTime: '0' }).success) return null
    try {
      const answer = await this.call(`[${SHELL_JOB_TYPE_NAME}]::Identity(${String(pid)})`)
      if (answer === null) return null
      const identity = resourceProcessIdentitySchema.parse(answer)
      return identity.pid === pid ? identity : null
    } catch {
      return null
    }
  }

  /** A private named launch job, never a process discovered outside our launch boundary. */
  async rootOfJob(name: string): Promise<ResourceProcessIdentity | null> {
    const answer = await this.call(`[${SHELL_JOB_TYPE_NAME}]::Query(${powerShellQuoted(name)})`)
    if (answer === null) return null
    const { members } = querySchema.parse(answer)
    return (
      members.toSorted((left, right) =>
        BigInt(left.startTime) < BigInt(right.startTime) ? -1 : 1,
      )[0] ?? null
    )
  }

  /** Only a successful native query can prove retirement; failed probes throw. */
  async jobGone(name: string): Promise<boolean> {
    const answer = await this.call(`[${SHELL_JOB_TYPE_NAME}]::Query(${powerShellQuoted(name)})`)
    return answer === null || querySchema.parse(answer).members.length === 0
  }

  async contains(ticket: ResourceTicket, identity: ResourceProcessIdentity): Promise<boolean> {
    if (ticket.scope.type !== 'job' || !resourceProcessIdentitySchema.safeParse(identity).success)
      return false
    const state = this.epoch(ticket.id)
    try {
      const isRoot =
        identity.pid === ticket.root.pid && identity.startTime === ticket.root.startTime
      if (!isRoot) {
        const query = await this.query(ticket)
        if (
          !query?.members.some(
            (member) => member.pid === identity.pid && member.startTime === identity.startTime,
          )
        )
          return false
      }
      const answer = await this.call(
        `if ([${SHELL_JOB_TYPE_NAME}]::Contains(${powerShellQuoted(ticket.scope.name)}, ${String(identity.pid)}, ${powerShellQuoted(identity.startTime)})) { 'true' } else { 'false' }`,
      )
      if (this.known.get(ticket.id) !== state) return false
      const isMember = z.boolean().parse(answer)
      if (isRoot && isMember && state.members.length === 0)
        state.members = [structuredClone(ticket.root)]
      return isMember
    } catch {
      return false
    }
  }

  async members(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[]> {
    try {
      const query = await this.query(ticket)
      return query?.members ?? []
    } catch {
      return []
    }
  }

  async usage(ticket: ResourceTicket): Promise<ResourceTreeUsage | null> {
    try {
      const query = await this.query(ticket)
      return query?.usage ?? null
    } catch {
      return null
    }
  }

  async actionMembers(ticket: ResourceTicket): Promise<readonly ResourceProcessIdentity[] | null> {
    try {
      const state = this.known.get(ticket.id)
      const query = await this.query(ticket)
      // A missing job is a gone result for already observed identities, not new authority.
      return state !== undefined && this.known.get(ticket.id) === state
        ? structuredClone(state.members)
        : (query?.members ?? null)
    } catch {
      return null
    }
  }

  async signal(
    ticket: ResourceTicket,
    identity: ResourceProcessIdentity,
    signal: ResourceSignal,
    isRegistered: () => boolean,
  ): Promise<ResourceActionResult> {
    if (ticket.scope.type !== 'job' || identity.pid === process.pid) return 'refused'
    const state = this.known.get(ticket.id)
    if (state === undefined) return 'refused'
    try {
      if (
        state.members.every(
          (member) => !(member.pid === identity.pid && member.startTime === identity.startTime),
        )
      ) {
        const query = await this.query(ticket)
        if (
          !query?.members.some(
            (member) => member.pid === identity.pid && member.startTime === identity.startTime,
          )
        )
          return 'refused'
      }
      if (this.known.get(ticket.id) !== state || !isRegistered()) return 'refused'
      const answer = await this.call(
        `ConvertTo-Json -Compress -InputObject ([${SHELL_JOB_TYPE_NAME}]::Signal(${powerShellQuoted(ticket.scope.name)}, ${String(identity.pid)}, ${powerShellQuoted(identity.startTime)}, ${signal === 'SIGKILL' ? '$true' : '$false'}))`,
      )
      // Once dispatched, the native handle-bound action cannot be revoked; report its real result.
      return resourceActionResultSchema.parse(answer)
    } catch {
      return 'refused'
    }
  }
}
