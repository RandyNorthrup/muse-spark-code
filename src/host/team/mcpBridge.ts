// --- M96c lane O: bridge run_checks region. ---
import * as z from 'zod/mini'
import {
  CHECK_COMMANDS_MAX,
  CHECK_NAME_MAX_CHARS,
  GIT_PATH_MAX_DEFAULT,
  TEAM_WRITE_SET_MAX,
  MODEL_TEXT,
  MODEL_API_MODEL_TEXT,
  CHECK_DEFAULT_TIMEOUT_SECONDS,
  UI_TEXT,
  type CheckCommandSetting,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  checkCommandLine,
  checkCommandsSchema,
  checkTimeoutMs,
} from '../../core/verify/checkCommands'
import { runChecksDefinition } from '../../core/backends/modelapi/verifyTools'
import { routeWorkerCheck, type WorkerCheckRouting } from '../../core/team/workers/engineWorker'
import type { CheckJob, CheckResult } from '../../core/runners/routing'

const argsSchema = z.strictObject({
  names: z.optional(
    z
      .array(z.string().check(z.minLength(1), z.maxLength(CHECK_NAME_MAX_CHARS)))
      .check(z.maxLength(CHECK_COMMANDS_MAX)),
  ),
  paths: z.optional(
    z
      .array(z.string().check(z.minLength(1), z.maxLength(GIT_PATH_MAX_DEFAULT)))
      .check(z.maxLength(TEAM_WRITE_SET_MAX)),
  ),
})
export interface BridgeChecksDeps extends WorkerCheckRouting {
  readonly checks: () => readonly CheckCommandSetting[]
  readonly platform: NodeJS.Platform
  /** The authenticated endpoint's current task/attempt and checks tool policy. */
  readonly isCurrentAndAllowed: () => boolean
  readonly makeJob: (command: string, timeoutMs: number) => CheckJob
  /** Resolve existing files inside this caller's copy; omitted paths are its edited files. */
  readonly pathsFor: (paths: readonly string[] | undefined) => Promise<readonly string[]>
  /** M73 packing after the caller's hooks; no output is silently clipped. */
  readonly pack: (results: readonly CheckResult[]) => Promise<unknown>
}

export function bridgeRunChecks(deps: BridgeChecksDeps): {
  readonly definition: ReturnType<typeof runChecksDefinition>
  readonly call: (input: unknown) => Promise<unknown>
} {
  const checks = checkCommandsSchema.parse(deps.checks()).map((check) => ({
    name: check.name,
    command: check.command,
    changedFiles: check.changedFiles ?? false,
    timeoutSeconds: check.timeoutSeconds ?? CHECK_DEFAULT_TIMEOUT_SECONDS,
  }))
  return {
    definition: runChecksDefinition(checks),
    call: async (input) => {
      const args = argsSchema.parse(input)
      const admit = () => {
        if (!deps.isCurrentAndAllowed()) throw new Error(MODEL_TEXT.agentToolNotOffered)
      }
      admit()
      if (checks.length === 0) throw new Error(MODEL_API_MODEL_TEXT.runChecksNone)
      const names = args.names ?? checks.map((check) => check.name)
      const paths = await deps.pathsFor(args.paths)
      admit()
      const chosen = names.map((name) => {
        const check = checks.find((candidate) => candidate.name === name)
        if (check === undefined)
          throw new Error(
            fill(MODEL_API_MODEL_TEXT.runChecksUnknown, {
              name,
              names: checks.map((candidate) => candidate.name).join(', '),
            }),
          )
        const line = checkCommandLine(check, paths, 'linux')
        if (!line.ok) throw new Error(line.reason)
        return check
      })
      if (chosen.length === 0) throw new Error(MODEL_API_MODEL_TEXT.runChecksNone)
      const results: CheckResult[] = []
      for (const check of chosen) {
        admit()
        const scopedJob = async (job: CheckJob, platform: NodeJS.Platform) => {
          admit()
          const scoped = checkCommandLine({ ...check, command: job.command }, paths, platform)
          if (!scoped.ok) throw new Error(scoped.reason)
          const command = await deps.guard({ ...job, command: scoped.line })
          admit()
          job.signal.throwIfAborted()
          if (!deps.routing.isTrusted()) throw new Error(UI_TEXT.teamRunners.trustNotice)
          if (command.trim() === '') throw new Error(UI_TEXT.hookInputNoCommand)
          return { ...job, command }
        }
        results.push(
          await routeWorkerCheck(deps.makeJob(check.command, checkTimeoutMs(check)), {
            runners: deps.runners,
            routing: {
              ...deps.routing,
              isTrusted: () => deps.routing.isTrusted() && deps.isCurrentAndAllowed(),
              remote: async (runner, job) =>
                await deps.routing.remote(runner, await scopedJob(job, runner.os)),
              local: async (job) => await deps.routing.local(await scopedJob(job, deps.platform)),
            },
            guard: async (job) => {
              admit()
              const line = await deps.guard(job)
              admit()
              return line
            },
          }),
        )
      }
      admit()
      const packed = await deps.pack(results)
      admit()
      return packed
    },
  }
}
// --- End M96c lane O region. Tokens, transports, leases and MCP ownership are lane B. ---
