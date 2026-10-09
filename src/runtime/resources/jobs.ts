import { jobSourceReader } from '../../host/backend/jobSource'
import { shellJobAssembly } from '../../host/backend/shellJob'
import { sealedMcpJobExecutable } from '../../host/backend/mcpJobExecutable'
import { runBootstrap } from '../../core/bootstrapCommand'

/**
 * Compile only on first Windows process use, under bootstrap admission.
 * POSTSPAWN: ships in the launcher's bundle (dist/resourceProcess.js), not
 * with the governor's policy.
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
