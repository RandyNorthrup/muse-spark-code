import { NODE_MAX_PAGE_ITEMS } from '../../../shared/constants'
import {
  nodeMethods,
  type NodeMethodParams,
  type NodeMethodResult,
} from '../../../shared/hostApi/nodeMethods'
import { type NodeAudit, type NodeDashboard } from '../../../shared/node'
import { type NodeSession } from '../../../shared/nodeAuth'
import { guardNodeMethod } from '../listenerGuard'

/** The machine's readings for one dashboard read. */
export interface NodeDashboardReadings {
  readonly cpuPercent: number
  readonly memory: NodeDashboard['memory']
  readonly disk: NodeDashboard['disk']
}

/** N supplies the service's state and the machine's readings. U2 assembles
and pages; the schema's refinement (attendance, lock, sizes) fails closed. */
export interface NodeDashboardPagePort {
  nodeId: string
  version: string
  startedAtMs: number
  now: () => number
  sessions(signal: AbortSignal): Promise<NodeSession[]>
  locked(signal: AbortSignal): Promise<boolean>
  keyStoreSealed(signal: AbortSignal): Promise<boolean>
  pendingChallenges(signal: AbortSignal): Promise<number>
  readings(signal: AbortSignal): Promise<NodeDashboardReadings>
  workspaces(signal: AbortSignal): Promise<NodeDashboard['workspaces']>
  /** The full bounded trail, chain order; U2 pages it newest-first. */
  audit(signal: AbortSignal): Promise<NodeAudit[]>
  /** Files an unexpected method failure with the serve log. The report
  carries the raw error for the record; implementations print a fixed
  sentence, never its text (paths and prompts stay out of the log). */
  report(error: unknown): void
}

export function createNodeDashboardMethods(port: NodeDashboardPagePort) {
  const read = async (
    input: NodeMethodParams<'node/dashboard/read'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/dashboard/read'>> => {
    nodeMethods['node/dashboard/read'].params.parse(input)
    signal.throwIfAborted()
    const sessions = await port.sessions(signal)
    signal.throwIfAborted()
    const isLocked = await port.locked(signal)
    const isSealed = await port.keyStoreSealed(signal)
    const challenges = await port.pendingChallenges(signal)
    const readings = await port.readings(signal)
    const workspaces = await port.workspaces(signal)
    signal.throwIfAborted()
    // One container, two users until M110b's sandboxes (D90.23): the page
    // says plainly that the workspaces share this sandbox.
    return nodeMethods['node/dashboard/read'].result.parse({
      nodeId: port.nodeId,
      version: port.version,
      uptimeMs: Math.max(0, port.now() - port.startedAtMs),
      sandbox: 'shared',
      locked: isLocked,
      keyStoreSealed: isSealed,
      attendance: sessions.length > 0 ? 'attended' : 'unattended',
      sessions,
      pendingChallenges: challenges,
      cpuPercent: readings.cpuPercent,
      memory: readings.memory,
      disk: readings.disk,
      workspaces,
    })
  }

  const list = async (
    input: NodeMethodParams<'node/audit/list'>,
    signal: AbortSignal,
  ): Promise<NodeMethodResult<'node/audit/list'>> => {
    const params = nodeMethods['node/audit/list'].params.parse(input)
    signal.throwIfAborted()
    const trail = await port.audit(signal)
    signal.throwIfAborted()
    // Newest first: the sign-in audit and the logs read backwards from now.
    const ordered = trail.toSorted((left, right) => right.seq - left.seq)
    let start = 0
    if (params.cursor !== null) {
      const at = ordered.findIndex((entry) => String(entry.seq) === params.cursor)
      // A cursor the trail no longer holds (retention pruned it, or it was
      // forged) restarts the read rather than guessing its place: the page
      // reads from null again. Fail closed, without a refusal round-trip.
      start = at === -1 ? 0 : at + 1
    }
    const page = ordered.slice(start, start + NODE_MAX_PAGE_ITEMS)
    const last = page.at(-1)
    const hasMore = start + NODE_MAX_PAGE_ITEMS < ordered.length
    const nextCursor = last !== undefined && hasMore ? String(last.seq) : null
    return nodeMethods['node/audit/list'].result.parse({
      entries: page,
      nextCursor,
    })
  }

  // Every handler crosses the typed boundary: no raw TypeError or Error
  // from the port or a result parse escapes. Unexpected failures are
  // reported to the serve log before the typed `unavailable` refusal
  // reaches the person.
  const guard = <I, O>(work: (input: I, signal: AbortSignal) => Promise<O>) =>
    guardNodeMethod(work, (error) => {
      port.report(error)
    })

  return {
    read: guard(read),
    list: guard(list),
  }
}
