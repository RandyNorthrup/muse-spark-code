import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { UI_TEXT, PROCESS_TABLE_TIMEOUT_MS } from '../../../shared/constants'
import { compileJob, jobFileName, type JobBuild } from '../../backend/jobBuild'
import type { RunProgram } from '../../processTree'
import {
  windowsVaultGuardScript,
  type WindowsVaultExecutable,
} from '../../../runtime/vault/slots/windowsVaultTransport'

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
  // A fresh private directory is never shared with another builder.
  isPresent: () => Promise.resolve(false),
}
const runCompiler: RunProgram = (file, args, _env) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { cwd: path.dirname(file), env: {}, windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS },
      (error) => {
        if (error === null) resolve('')
        else reject(new Error(UI_TEXT.vault.noAccess))
      },
    )
  })
const cache = new Map<string, WindowsVaultExecutable>()

/** Only this process's completed build supplies a trusted digest, never a cache sidecar. */
export async function windowsVaultExecutable(deps: {
  readonly storageDir: string
  readonly systemRoot: string
  readonly readSource: () => Promise<string>
  readonly run?: RunProgram
  readonly report?: () => void
}): Promise<WindowsVaultExecutable> {
  try {
    if (!path.isAbsolute(deps.storageDir) || !path.isAbsolute(deps.systemRoot))
      throw new Error(UI_TEXT.vault.noAccess)
    const source = await deps.readSource()
    const name = jobFileName(build, source)
    const cacheKey = `${deps.storageDir}\0${deps.systemRoot}\0${name}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached
    const powershell = path.win32.join(
      deps.systemRoot,
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    )
    const compile = async () => {
      const prepare = async (parent: string) => {
        const directory = path.join(parent, `vault-helper-${randomUUID()}`)
        await runCompiler(
          powershell,
          [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(windowsVaultGuardScript(directory), 'utf16le').toString('base64'),
          ],
          {},
        )
        return directory
      }
      let directory: string
      try {
        directory = await prepare(deps.storageDir)
      } catch {
        // An unsafe cache parent is left untouched; use the current user's protected temp tree.
        directory = await prepare(tmpdir())
        deps.report?.()
      }
      const file = path.join(directory, name)
      await compileJob(build, file, source, deps.systemRoot, (compiler, args) =>
        (deps.run ?? runCompiler)(compiler, args, {}),
      )
      const sha256 = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
      return { file, sha256 }
    }
    const identity = await compile()
    const helper = {
      ...identity,
      powershell,
      report: () => {
        deps.report?.()
      },
      rebuild: async () => {
        Object.assign(helper, await compile())
      },
    }
    cache.set(cacheKey, helper)
    return helper
  } catch {
    throw new Error(UI_TEXT.vault.noAccess)
  }
}
