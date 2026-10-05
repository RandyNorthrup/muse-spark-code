import type { Runner } from '../../shared/team'
import type { RunnerHealth } from './health'
import { UI_TEXT } from '../../shared/constants'

export interface CheckJob {
  readonly runId: string
  readonly cwd: string
  readonly command: string
  readonly timeoutMs: number
  readonly commandClass: Runner['commandClasses'][number]
  readonly labels: readonly string[]
  readonly preferredRunners: readonly string[]
  readonly lockfiles: readonly string[]
  readonly signal: AbortSignal
  readonly onOutput: (text: string) => void
}
export interface CheckResult {
  readonly runId: string
  readonly exitCode: number
  readonly output: string
  readonly location: string
}
export type RunnerDispatch =
  | { readonly kind: 'finished'; readonly result: CheckResult }
  | { readonly kind: 'busy' | 'offline' | 'uncertain' }

export interface CheckRoutingDeps {
  readonly isTrusted: () => boolean
  readonly localLabels: readonly string[]
  /** Must sample immediately before dispatch, with a bounded transport timeout. */
  readonly sample: (runner: Runner) => Promise<RunnerHealth | undefined>
  readonly remote: (runner: Runner, job: CheckJob) => Promise<RunnerDispatch>
  readonly local: (job: CheckJob) => Promise<CheckResult>
}

/** Caller admission runs before any snapshot, install, health probe or dispatch. */
export async function routeChecks(
  job: CheckJob,
  runners: readonly Runner[],
  deps: CheckRoutingDeps,
  guard: () => Promise<void>,
): Promise<CheckResult> {
  await guard()
  const admit = () => {
    job.signal.throwIfAborted()
    if (!deps.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
  }
  admit()
  const rank = (runner: Runner) => {
    const index = job.preferredRunners.indexOf(runner.id)
    return index === -1 ? job.preferredRunners.length : index
  }
  const candidates = runners
    .filter(
      (runner) =>
        runner.commandClasses.includes(job.commandClass) &&
        job.labels.every(
          (label) =>
            runner.labels.includes(label) ||
            label ===
              `os:${runner.os === 'win32' ? 'windows' : runner.os === 'darwin' ? 'macos' : 'linux'}`,
        ),
    )
    .toSorted((a, b) => rank(a) - rank(b))
  for (const runner of candidates) {
    admit()
    const health = await deps.sample(runner)
    admit()
    if (
      health === undefined ||
      !health.inputReady ||
      health.freeSlots === 0 ||
      health.load >= health.cores
    )
      continue
    const answer = await deps.remote(runner, job)
    admit()
    if (answer.kind === 'finished' && answer.result.runId === job.runId) return answer.result
  }
  admit()
  if (job.labels.some((label) => !deps.localLabels.includes(label)))
    throw new Error(UI_TEXT.teamRunners.offline)
  const result = await deps.local(job)
  admit()
  if (result.runId !== job.runId) throw new Error(UI_TEXT.teamRunners.testFailed)
  return result
}
