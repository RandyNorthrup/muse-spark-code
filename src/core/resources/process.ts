import { spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { admitResource, resourceWindowsJob, stopResourceTree } from './admission'
import { resourceEnvironment } from './launch'

/** Portable payload launch; platform helpers stay behind the first-use boundary. */
export async function spawnResourceProcess(
  file: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
  extraDescriptors: readonly number[] = [],
) {
  const resource = await admitResource('other', options.signal)
  if (resource === undefined) throw new Error('Resource admission unavailable')
  let hasSpawned = false
  let jobName: string | undefined
  let assemblyPath: string | undefined
  try {
    options.signal?.throwIfAborted()
    let child
    if (process.platform === 'win32') {
      const job = await resourceWindowsJob()
      if (job === undefined || extraDescriptors.length > 0)
        throw new Error('Native governed process launch unavailable')
      const { spawnMcpJob } = await import('../../host/backend/mcpJobLaunch.js')
      assemblyPath = job.assemblyPath
      options.signal?.throwIfAborted()
      child = spawnMcpJob({
        executablePath: job.executablePath,
        resourceAssembly: job.assemblyPath,
        file,
        args,
        cwd: options.cwd?.toString() ?? process.cwd(),
        env: options.env ?? {},
        isVerbatim: false,
        resource: {
          ...resource,
          register: (launch) => {
            jobName = launch.job?.name
            resource.register(launch)
          },
        },
        log: () => {
          /* Callers report fixed failure words. */
        },
      })
    } else {
      const { observeResourceProcess } = await import('../../host/resources/resourceAdmission.js')
      options.signal?.throwIfAborted()
      const { signal: _signal, ...spawnOptions } = options
      child = spawn(file, [...args], {
        ...spawnOptions,
        env: resourceEnvironment(options.env ?? {}, resource),
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', ...extraDescriptors],
        windowsHide: true,
      })
      observeResourceProcess(resource, child)
    }
    hasSpawned = true
    const stop = async () => {
      await stopResourceTree(resource)
    }
    child.once('exit', () => {
      void stop().catch(() => resource.failed?.())
    })
    const { stdin, stdout, stderr } = child
    if (stdin === null || stdout === null || stderr === null) {
      await stop()
      throw new Error('Governed process pipes unavailable')
    }
    const pid = async () => {
      if (process.platform !== 'win32') return child.pid
      const systemRoot = process.env['SystemRoot']
      if (jobName === undefined || assemblyPath === undefined || systemRoot === undefined) return
      const { resourceJobRootPid } = await import('./resourceGovernorEntry.js')
      return await resourceJobRootPid(assemblyPath, systemRoot, jobName)
    }
    return { child: Object.assign(child, { stdin, stdout, stderr }), stop, pid }
  } catch (error: unknown) {
    resource.failed?.()
    resource.complete(!hasSpawned)
    throw error
  }
}
