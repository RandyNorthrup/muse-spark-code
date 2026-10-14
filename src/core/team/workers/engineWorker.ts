import {
  routeChecks,
  type CheckJob,
  type CheckResult,
  type CheckRoutingDeps,
} from '../../runners/routing'
import { type Runner } from '../../../shared/team'
// M96c lane O's test-command routing (PLAN.md D75): `testShell`, detected
// test scripts, `run_checks` and `then_run` route through here after
// classification.

// --- M96c lane O: test-command routing region. ---

export interface WorkerCheckRouting {
  readonly runners: () => readonly Runner[]
  readonly routing: CheckRoutingDeps
  /** Every ordinary shell guard, including hooks, ref/path fences and permissions. */
  readonly guard: (job: CheckJob) => Promise<string>
}

/** testShell, detected test scripts, run_checks and then_run use this after classification. */
export async function routeWorkerCheck(
  job: CheckJob,
  deps: WorkerCheckRouting,
): Promise<CheckResult> {
  return await routeChecks(
    job,
    deps.runners(),
    deps.routing,
    async (value) => await deps.guard(value),
  )
}
// --- End M96c lane O region. Engine lifetime and ordinary tools are M96 lane W. ---
