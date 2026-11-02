// The window process for test/unit/teamSchedulerRecovery.test.ts, bundled with
// esbuild by that suite. It runs the product's window scheduler through the
// entry the product loads, over a journal on disk, launches one worker (in a
// Windows job when the plan names a helper's folder, as a plain child
// otherwise), and stays alive until the parent kills it. Knip does not trace
// the esbuild bundle, so this file is a declared entry in knip.jsonc.
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import * as z from 'zod/mini'
import { createTeamWindowRuntime } from '../../src/core/team/scheduler/teamWindowEntry'
import { runProgram } from '../../src/host/processTree'
import { createNativeTeamProcessDriver } from '../../src/host/team/processLifetime'
import { EN } from '../../src/shared/l10n/en'
import { readJobSource } from './helpers/jobSource'
import {
  launchInTeamJob,
  stateFile,
  submission,
  windowSchedulerDeps,
} from './helpers/teamWindowRig'

const planSchema = z.strictObject({
  windowInstanceId: z.string(),
  stateFile: z.string(),
  readyFile: z.string(),
  taskId: z.string(),
  worker: z.tuple([z.string()], z.string()),
  cwd: z.string(),
  jobHelperFolder: z.optional(z.string()),
  systemRoot: z.string(),
})

const planFile = process.argv[2]
if (planFile === undefined) throw new Error('plan file argument missing')
const plan = planSchema.parse(JSON.parse(await readFile(planFile, 'utf8')))
const [command, ...args] = plan.worker

const driver =
  plan.jobHelperFolder === undefined
    ? undefined
    : await createNativeTeamProcessDriver({
        killGraceMs: 2000,
        windows: {
          storageDir: plan.jobHelperFolder,
          systemRoot: plan.systemRoot,
          log: () => undefined,
          readJobSource,
          run: runProgram,
        },
      })

const worker: { pid?: number | undefined } = {}
const runtime = await createTeamWindowRuntime(EN, 'en')
const scheduler = runtime.createWindowTeamScheduler(
  windowSchedulerDeps({
    windowInstanceId: plan.windowInstanceId,
    state: stateFile(plan.stateFile),
    kind: driver === undefined ? 'engine' : 'external',
    launch: async (ref) => {
      if (driver === undefined) {
        worker.pid = spawn(command, args, { stdio: 'ignore', cwd: plan.cwd }).pid
        return
      }
      const { confirmation } = await launchInTeamJob(driver, {
        command,
        args,
        cwd: plan.cwd,
        taskId: ref.taskId,
        systemRoot: plan.systemRoot,
      })
      worker.pid = confirmation.pid
    },
  }),
)
await scheduler.takeoverBoard()
await scheduler.resume()
await scheduler.submit([submission(plan.taskId)])
await scheduler.wake()
await writeFile(plan.readyFile, JSON.stringify({ workerPid: worker.pid }))
// A window lives until it closes or is killed.
setInterval(() => undefined, 1000)
