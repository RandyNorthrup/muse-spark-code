// The shipped C# of the Windows job helpers (PLAN.md D6), as the tests hand
// it to the helpers: read from the repository through the production reader,
// where the extension reads it from its own folder.
import { jobSourceReader } from '../../../src/host/backend/jobSource'
import { runTreeProgram, type ResourceTreeRun } from '../../../src/core/resources/trees/run'

export const readJobSource = jobSourceReader(process.cwd())

/** Cold-runner qualification must never discover a PowerShell module during a stop. */
export const runJobWithoutAutoload: ResourceTreeRun = (file, args, env) =>
  runTreeProgram(
    file,
    [...args.slice(0, -1), `$PSModuleAutoloadingPreference='None'; ${args.at(-1)!}`],
    env,
  )
