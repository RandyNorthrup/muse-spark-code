import { access } from 'node:fs/promises'
import path from 'node:path'
import {
  compileJob,
  jobFileName,
  type JobBuild,
  removeStaleJobs,
} from '../../../host/backend/jobBuild'
import { realpathSync } from 'node:fs'
import { noWorkspaceChildEnvironment } from '../../execGuard'
import type { RunProgram } from '../../../host/processTree'

const SERIAL_BUILD: JobBuild = {
  stem: 'MuseSparkSerial-',
  extension: '.exe',
  outputType: 'exe',
  references: ['System.Web.Extensions.dll'],
  label: 'serial helper',
  isPresent: async (file) => {
    const [attempt] = await Promise.allSettled([access(file)])
    return attempt.status === 'fulfilled'
  },
}

/** Source comes from shipped native/windows/MuseSparkSerial.cs, never workspace. */
export async function prepareWindowsSerialHelper(deps: {
  readonly directory: string
  readonly systemRoot: string
  readonly readSource: () => Promise<string>
  readonly run: RunProgram
  readonly env: NodeJS.ProcessEnv
  readonly log: (message: string) => void
}): Promise<string> {
  const source = await deps.readSource()
  const target = path.join(deps.directory, jobFileName(SERIAL_BUILD, source))
  if (!(await SERIAL_BUILD.isPresent(target))) {
    const run: RunProgram = (file, args) =>
      deps.run(file, args, noWorkspaceChildEnvironment('win32', deps.env, realpathSync))
    await compileJob(SERIAL_BUILD, target, source, deps.systemRoot, run)
    await removeStaleJobs(SERIAL_BUILD, target, deps.log)
  }
  return target
}
