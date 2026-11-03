// What the M96c recovery proofs hand the real window scheduler, in the test
// process and in a real window process (teamWindowChild.entry.ts): the board's
// journal as a real JSON file, and the host's port adapters (admission and
// launch), the boundary the production host supplies.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import type { TeamStatePort } from '../../../src/core/team/teamHostService'
import type {
  TeamAttemptRef,
  TeamRetirementPort,
  TeamSchedulingDeps,
} from '../../../src/core/team/teamScheduling'
import type {
  ContainedTeamChild,
  LaunchConfirmation,
  TeamProcessDriver,
} from '../../../src/host/team/processLifetime'

export function stateFile(file: string): TeamStatePort {
  let values: Record<string, unknown> = {}
  const load = (): void => {
    try {
      values = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      values = {}
    }
  }
  load()
  return {
    get: (key) => values[key],
    update: async (key, value) => {
      values =
        value === undefined
          ? Object.fromEntries(Object.entries(values).filter(([name]) => name !== key))
          : { ...values, [key]: value }
      await writeFile(file, JSON.stringify(values))
    },
  }
}

export const submission = (id: string) => ({
  id,
  sessionId: 's1',
  roleId: 'engineering',
  fields: { priority: 'normal' as const, size: 'M' as const, overlap: 'serialize' as const },
})

/** The product's Windows launch: confirmed in its job, then released. */
export async function launchInTeamJob(
  driver: TeamProcessDriver,
  input: {
    readonly command: string
    readonly args: readonly string[]
    readonly cwd: string
    readonly taskId: string
    readonly systemRoot: string
  },
): Promise<{ readonly launch: ContainedTeamChild; readonly confirmation: LaunchConfirmation }> {
  const launch = driver.launch(
    {
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      taskId: input.taskId,
      env: { SystemRoot: input.systemRoot, PATH: process.env['PATH'] },
      priority: 'normal',
    },
    randomUUID(),
  )
  const confirmation = await launch.confirmation
  await launch.resume?.(confirmation)
  return { launch, confirmation }
}

/** One engineering entry with room for everything; the launch contract is start-only. */
export function windowSchedulerDeps(input: {
  readonly windowInstanceId: string
  readonly state: TeamStatePort
  readonly kind: 'engine' | 'external'
  readonly launch: (ref: TeamAttemptRef) => Promise<void>
  readonly retirement?: TeamRetirementPort
}): TeamSchedulingDeps {
  return {
    workspaceId: 'ws',
    windowInstanceId: input.windowInstanceId,
    state: input.state,
    now: () => Date.now(),
    sharedFiles: () => [],
    limits: () => ({
      workers: 4,
      processWorkers: 4,
      role: () => 4,
      entry: () => 4,
      agent: () => 4,
    }),
    entries: () => [
      {
        id: 'e1',
        roleId: 'engineering',
        agentProfileId: 'agent-1',
        modelId: 'model-1',
        kind: input.kind,
        poolFit: 1,
        remainingDayTokens: Number.MAX_SAFE_INTEGER,
        eligible: () => true,
      },
    ],
    mode: () => 'own-branch',
    report: () => '',
    canStart: () => true,
    admit: () => true,
    refund: () => undefined,
    authorize: () => Promise.resolve(true),
    launch: (task) => input.launch({ taskId: task.id, attempt: task.currentAttempt }),
    changed: () => undefined,
    failure: () => undefined,
    ...(input.retirement !== undefined && { retirement: input.retirement }),
  }
}
