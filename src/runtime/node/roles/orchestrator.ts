// The orchestrator host (M110c lane R2, D90.2): a node that plans, reviews
// and merges, alone or beside working itself. Roles, the worker registry
// with liveness derived from the person's own thresholds, and the duty
// cycle, which orders the merge queue with M96c's own ordering and assigns
// each item to a live worker that holds its capabilities. Relocation
// across nodes (M107's lane R), account pools (M108's lane D) and the
// vault on a node (M109) are the legs that wait.
import * as z from 'zod/mini'
import { orderMergeQueue, type MergeCandidate } from '../../../core/team/mergeQueue'

export const nodeRoleSchema = z.strictObject({
  mode: z.enum(['worker', 'orchestrator', 'both']),
})
export type NodeRole = z.infer<typeof nodeRoleSchema>

export function setNodeRole(role: NodeRole, mode: NodeRole['mode']): NodeRole {
  nodeRoleSchema.parse(role)
  return nodeRoleSchema.parse({ mode })
}

export const nodeWorkerSchema = z.strictObject({
  nodeId: z.string().check(z.minLength(1)),
  capabilities: z.array(z.string().check(z.minLength(1))),
  lastHeartbeat: z.int().check(z.gte(0)),
})
export type NodeWorker = z.infer<typeof nodeWorkerSchema>

export type NodeWorkerLiveness = 'live' | 'quiet' | 'gone'

/* Liveness from the person's own thresholds: quiet past the first, gone
 * past the second. A worker from the future counts as live, never gone. */
export function nodeWorkerLiveness(
  worker: NodeWorker,
  now: number,
  thresholds: { readonly quietAfterMs: number; readonly goneAfterMs: number },
): NodeWorkerLiveness {
  if (thresholds.quietAfterMs < 0 || thresholds.goneAfterMs < thresholds.quietAfterMs)
    throw new Error('liveness thresholds rise from zero')
  const silent = now - nodeWorkerSchema.parse(worker).lastHeartbeat
  if (silent >= thresholds.goneAfterMs) return 'gone'
  return silent >= thresholds.quietAfterMs ? 'quiet' : 'live'
}

/** Register or refresh a worker; the registry holds one row per node. */
export function registerNodeWorker(
  registry: readonly NodeWorker[],
  worker: NodeWorker,
): readonly NodeWorker[] {
  const parsed = nodeWorkerSchema.parse(worker)
  return [...registry.filter((entry) => entry.nodeId !== parsed.nodeId), parsed]
}

export interface OrchestratorDuty {
  readonly candidate: MergeCandidate
  readonly needs: readonly string[]
}

export interface OrchestratorPlan {
  readonly assignments: ReadonlyMap<string, string>
  readonly unassigned: readonly string[]
  readonly held: readonly string[]
}

/* Order the queue with M96c's ordering, then give each ready item to the
 * first live worker holding every capability it needs. */
export function planOrchestratorDuties(options: {
  readonly duties: readonly OrchestratorDuty[]
  readonly merged: ReadonlySet<string>
  readonly workers: readonly NodeWorker[]
}): OrchestratorPlan {
  const { ordered, held } = orderMergeQueue(
    options.duties.map((duty) => duty.candidate),
    options.merged,
  )
  const needs = new Map(options.duties.map((duty) => [duty.candidate.id, duty.needs]))
  const assignments = new Map<string, string>()
  const unassigned: string[] = []
  for (const candidate of ordered) {
    const required = needs.get(candidate.id) ?? []
    const worker = options.workers.find((entry) =>
      required.every((capability) => entry.capabilities.includes(capability)),
    )
    if (worker === undefined) unassigned.push(candidate.id)
    else assignments.set(candidate.id, worker.nodeId)
  }
  return { assignments, unassigned, held: held.map((candidate) => candidate.id) }
}
