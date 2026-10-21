import { jobSourceReader } from '../../host/backend/jobSource'
import { shellJobAssembly } from '../../host/backend/shellJob'
import { sealedMcpJobExecutable } from '../../host/backend/mcpJobExecutable'
import { runBootstrap } from '../../core/bootstrapCommand'

/**
Compile only on first Windows process use, under bootstrap admission.
Ships with the runtime (dist/acp.js), which already carries the job
builders: it launches through the lazy launcher, so it is not part of it.
*/
export async function runtimeResourceJobs(storageDir: string, packageRoot: string) {
  const systemRoot = process.env['SystemRoot']
  if (systemRoot === undefined || process.platform !== 'win32') return
  const deps = {
    storageDir,
    systemRoot,
    readJobSource: jobSourceReader(packageRoot),
    run: (file: string, args: readonly string[], env: NodeJS.ProcessEnv) =>
      runBootstrap(file, args, env),
    log: () => {
      /* Caller reports fixed unavailable text. */
    },
  }
  const assemblyPath = await shellJobAssembly(deps)()
  const helper = await sealedMcpJobExecutable(deps)()
  return assemblyPath === undefined || helper === undefined
    ? undefined
    : { assemblyPath, executablePath: helper.path, verify: helper.verify }
}

/**
The governor's `windowsJob` for a process outside the extension host (the
runtime and the vault broker): both Windows job helpers are prepared once
per process, and a failure is retried on the next launch. Each launch
verifies the sealed helper; a changed one prepares again next time.
*/
export function runtimeWindowsJob(storageDir: string, packageRoot: string) {
  let jobs: ReturnType<typeof runtimeResourceJobs> | undefined
  return async () => {
    jobs ??= runtimeResourceJobs(storageDir, packageRoot)
    const current = jobs
    try {
      const ready = await current
      if (ready === undefined) {
        if (jobs === current) jobs = undefined
        return
      }
      return {
        ...ready,
        verify: async () => {
          try {
            await ready.verify()
          } catch (error: unknown) {
            if (jobs === current) jobs = undefined
            throw error
          }
        },
      }
    } catch (error: unknown) {
      if (jobs === current) jobs = undefined
      throw error
    }
  }
}
