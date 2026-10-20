import path from 'node:path'
import type { RunProgram } from '../../processTree'
import {
  windowsVaultGuardScript,
  windowsVaultGuardSource,
  type WindowsVaultExecutable,
} from '../../../runtime/vault/slots/windowsVaultTransport'
import { noWorkspaceChildEnvironment } from '../../../core/execGuard'
import { runBootstrap } from '../../../core/bootstrapCommand'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { UI_TEXT } from '../../../shared/constants'
import { compileJob, jobFileName, type JobBuild } from '../../backend/jobBuild'
import { isResourcePaused } from '../../../core/resources/launch'

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
const runCompiler = (
  file: string,
  args: readonly string[],
  _env: NodeJS.ProcessEnv,
  publicSource?: string,
): Promise<string> =>
  runBootstrap(
    file,
    args,
    {},
    {
      cwd: path.dirname(file),
      ...(publicSource !== undefined && {
        input: Buffer.from(publicSource, 'utf8').toString('base64') + '\n',
      }),
    },
  )
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
    const guardSource = windowsVaultGuardSource(source)
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
          guardSource,
        )
        return directory
      }
      let directory: string
      try {
        // The storage folder is made on first use (inheriting its parent's
        // grants); the guard then refuses it unless it is safe. Without it
        // every build fell back to the temp tree below.
        await mkdir(deps.storageDir, { recursive: true })
        directory = await prepare(deps.storageDir)
      } catch (error: unknown) {
        if (isResourcePaused(error)) throw error
        // An unsafe cache parent is left untouched; use the current user's protected temp tree.
        directory = await prepare(tmpdir())
        deps.report?.()
      }
      const file = path.join(directory, name)
      await compileJob(build, file, source, deps.systemRoot, (compiler, args) =>
        (deps.run ?? runCompiler)(
          compiler,
          args,
          // The framework compiler builds a helper of its own: absolute entries only.
          noWorkspaceChildEnvironment('win32', {}, realpathSync),
        ),
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
      guardSource,
      report: () => {
        deps.report?.()
      },
      rebuild: async () => {
        Object.assign(helper, await compile())
      },
    }
    cache.set(cacheKey, helper)
    return helper
  } catch (error: unknown) {
    if (isResourcePaused(error)) throw error
    throw new Error(UI_TEXT.vault.noAccess, { cause: error })
  }
}

/**
The pipe helper: the shared guard region plus the pipe program, compiled
as one source. The digest names the composed bytes, so a slot helper and
a pipe helper never share a file.
*/
export async function windowsPipeExecutable(deps: {
  readonly storageDir: string
  readonly systemRoot: string
  readonly readSlotSource: () => Promise<string>
  readonly readPipeSource: () => Promise<string>
  readonly run?: RunProgram
  readonly report?: () => void
}): Promise<WindowsVaultExecutable> {
  const guardSource = windowsVaultGuardSource(await deps.readSlotSource())
  // The composed source keeps the guard's markers: windowsVaultExecutable
  // finds the same guard region in it to record beside the build.
  const source = `// BEGIN VAULT PATH GUARD${guardSource}// END VAULT PATH GUARD\n${await deps.readPipeSource()}`
  return await windowsVaultExecutable({
    ...deps,
    readSource: () => Promise.resolve(source),
  })
}
