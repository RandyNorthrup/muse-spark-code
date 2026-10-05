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
  guard: (job: CheckJob) => Promise<string>,
): Promise<CheckResult> {
  const admittedJob = { ...job, command: await guard(job) }
  if (admittedJob.command.trim() === '') throw new Error(UI_TEXT.hookInputNoCommand)
  const admit = () => {
    admittedJob.signal.throwIfAborted()
    if (!deps.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
  }
  admit()
  const rank = (runner: Runner) => {
    const index = admittedJob.preferredRunners.indexOf(runner.id)
    return index === -1 ? admittedJob.preferredRunners.length : index
  }
  const candidates = runners
    .filter((runner) => {
      const platform = runner.os === 'win32' ? 'windows' : runner.os
      const label = `os:${platform === 'darwin' ? 'macos' : platform}`
      return (
        runner.commandClasses.includes(admittedJob.commandClass) &&
        admittedJob.labels.every((wanted) => runner.labels.includes(wanted) || wanted === label)
      )
    })
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
    const answer = await deps.remote(runner, admittedJob)
    admit()
    if (answer.kind === 'finished' && answer.result.runId === admittedJob.runId)
      return answer.result
  }
  admit()
  if (admittedJob.labels.some((label) => !deps.localLabels.includes(label)))
    throw new Error(UI_TEXT.teamRunners.offline)
  const result = await deps.local(admittedJob)
  admit()
  if (result.runId !== admittedJob.runId) throw new Error(UI_TEXT.teamRunners.testFailed)
  return result
}
