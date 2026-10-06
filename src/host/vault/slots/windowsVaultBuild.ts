import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { UI_TEXT, PROCESS_TABLE_TIMEOUT_MS } from '../../../shared/constants'
import { compileJob, jobFileName, type JobBuild } from '../../backend/jobBuild'
import type { RunProgram } from '../../processTree'

async function isPresent(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}
const build: JobBuild = {
  stem: 'MuseSparkVault-',
  extension: '.exe',
  outputType: 'exe',
  references: [
    'System.Security.dll',
    'System.Web.Extensions.dll',
    'System.Windows.Forms.dll',
    'System.Drawing.dll',
  ],
  label: 'vault helper',
  isPresent,
}
const runCompiler: RunProgram = (file, args) =>
  new Promise((resolve, reject) => {
    // compileJob's normal process environment is intentionally replaced here.
    execFile(
      file,
      [...args],
      { env: {}, windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS },
      (error) => {
        if (error === null) resolve('')
        else reject(new Error(UI_TEXT.vault.noAccess))
      },
    )
  })

/** B/W supply packaged C# joined in source order; identical to M27's digest cache. */
export async function windowsVaultExecutable(deps: {
  readonly storageDir: string
  readonly systemRoot: string
  readonly readSource: () => Promise<string>
  readonly run?: RunProgram
}): Promise<string> {
  try {
    if (!path.isAbsolute(deps.storageDir) || !path.isAbsolute(deps.systemRoot))
      throw new Error(UI_TEXT.vault.noAccess)
    const source = await deps.readSource()
    const target = path.join(deps.storageDir, 'vault-helper', jobFileName(build, source))
    if (!(await isPresent(target)))
      await compileJob(build, target, source, deps.systemRoot, (file, args) =>
        (deps.run ?? runCompiler)(file, args, {}),
      )
    return target
  } catch {
    throw new Error(UI_TEXT.vault.noAccess)
  }
}
