// How a Windows job helper's C# (`jobSource.ts`) becomes a file in the
// extension's storage: named by the source's digest, compiled once by
// Windows' .NET Framework compiler, moved into place, and the builds of
// earlier sources removed. M27's shell job assembly and M50's MCP launcher
// take the same steps with their own names and compiler options.

import { execFile } from 'node:child_process'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PROCESS_TABLE_TIMEOUT_MS, WINDOWS_FRAMEWORK_RELATIVE_PATH } from '../../shared/constants'
import type { RunProgram } from '../processTree'

const SOURCE_EXTENSION = '.cs'
const DIGEST_LENGTH = 16

/** One helper's build. */
export interface JobBuild {
  /** The file name before the source's digest. */
  readonly stem: string
  /** The compiled file's extension. */
  readonly extension: string
  /** The compiler's output type. */
  readonly outputType: 'exe' | 'library'
  /** Additional framework assemblies, resolved only under Windows' framework directory. */
  readonly references: readonly string[]
  /** Inbox WinRT metadata; never a downloaded SDK or a workspace assembly. */
  readonly windowsMetadata?: readonly string[]
  /** Recorder compilation receives only the OS root, never credentials. */
  readonly compilerEnvironment?: NodeJS.ProcessEnv
  /** What the log calls the built file. */
  readonly label: string
  /** Whether a built file is already at a path. */
  readonly isPresent: (file: string) => Promise<boolean>
}

// Add-Type starts PowerShell and discovers its Utility module before running
// this same compiler. On loaded Windows runners that startup can consume the
// process deadline. Compile directly, keeping that deadline and reporting
// stdout (where csc writes diagnostics), stderr and termination metadata.
const runCompiler: RunProgram = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { windowsHide: true, timeout: PROCESS_TABLE_TIMEOUT_MS, env },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout)
          return
        }
        reject(
          new Error(
            `job compiler failed (code=${String(error.code)}, killed=${String(error.killed ?? false)}, signal=${String(error.signal)}): ${error.message}\n${stdout}${stderr}`,
            { cause: error },
          ),
        )
      },
    )
  })

/** The built file's name for this source (the whole C#, the shared half included). */
export function jobFileName(build: JobBuild, csharp: string): string {
  const digest = createHash('sha256').update(csharp).digest('hex').slice(0, DIGEST_LENGTH)
  return `${build.stem}${digest}${build.extension}`
}

/** Compiles `csharp` to `target`. */
export async function compileJob(
  build: JobBuild,
  target: string,
  csharp: string,
  systemRoot: string,
  run: RunProgram = runCompiler,
): Promise<void> {
  const directory = path.dirname(target)
  await mkdir(directory, { recursive: true })
  // Unique names, so two windows compiling at once never share a file.
  const stem = path.join(directory, randomUUID())
  const source = `${stem}${SOURCE_EXTENSION}`
  const output = `${stem}${build.extension}`
  const framework = path.win32.join(systemRoot, WINDOWS_FRAMEWORK_RELATIVE_PATH)
  try {
    await writeFile(source, csharp, 'utf8')
    await run(
      path.win32.join(framework, 'csc.exe'),
      [
        '/nologo',
        '/noconfig',
        '/utf8output',
        `/target:${build.outputType}`,
        ...['System.dll', 'System.Core.dll', ...build.references].map(
          (reference) => `/reference:${path.win32.join(framework, reference)}`,
        ),
        ...(build.windowsMetadata ?? []).map(
          (reference) =>
            `/reference:${path.win32.join(systemRoot, 'System32', 'WinMetadata', reference)}`,
        ),
        `/out:${output}`,
        source,
      ],
      build.compilerEnvironment ?? withoutCredentials(process.env),
    )
    try {
      await rename(output, target)
    } catch (error: unknown) {
      // Another window put the same file in place first.
      if (!(await build.isPresent(target))) {
        throw error
      }
    }
  } finally {
    await rm(source, { force: true })
    await rm(output, { force: true })
  }
}

/** M105 R2's lazy entry; callers read the shipped C# only on first recording use. */
export function screenRecordExecutable(deps: {
  readonly storageDir: string
  readonly systemRoot: string
  readonly readSource: () => Promise<string>
  readonly verifyTrustedPath: (file: string) => Promise<boolean>
  readonly run?: RunProgram
}): () => Promise<string | undefined> {
  const build: JobBuild = {
    stem: 'MuseSparkScreenRecord-',
    extension: '.exe',
    outputType: 'exe',
    references: [
      'System.Drawing.dll',
      'System.Windows.Forms.dll',
      'System.Runtime.dll',
      'System.Runtime.InteropServices.WindowsRuntime.dll',
    ],
    windowsMetadata: [
      'Windows.Foundation.winmd',
      'Windows.Graphics.winmd',
      'Windows.Media.winmd',
      'Windows.Storage.winmd',
    ],
    label: 'screen recorder',
    compilerEnvironment: { SystemRoot: deps.systemRoot },
    isPresent: async (file) => {
      try {
        const info = await stat(file)
        return info.isFile()
      } catch {
        return false
      }
    },
  }
  let ready: Promise<string | undefined> | undefined
  return () =>
    (ready ??= (async () => {
      try {
        const source = await deps.readSource()
        const target = path.join(deps.storageDir, jobFileName(build, source))
        const compiler = path.win32.join(
          deps.systemRoot,
          WINDOWS_FRAMEWORK_RELATIVE_PATH,
          'csc.exe',
        )
        if (!(await deps.verifyTrustedPath(compiler))) return
        if (!(await build.isPresent(target))) {
          await compileJob(build, target, source, deps.systemRoot, deps.run)
        }
        if (!(await deps.verifyTrustedPath(target))) return
        // This identity check does not request a screen or open a microphone.
        // Recording availability is probed separately: latest-file import still
        // works on machines whose capture service is unavailable.
        const answer = await (deps.run ?? runCompiler)(target, ['--self-test'], {
          SystemRoot: deps.systemRoot,
        })
        return answer.trim() === 'muse-spark-screen-record-ready' ? target : undefined
      } catch {
        return
      }
    })())
}

/**
 * Removes the builds of earlier sources beside `current`. One that another
 * window still has loaded cannot go and stays until a later start; that is
 * logged.
 */
export async function removeStaleJobs(
  build: JobBuild,
  current: string,
  log: (message: string) => void,
): Promise<void> {
  const directory = path.dirname(current)
  const currentName = path.basename(current)
  try {
    const names = await readdir(directory)
    for (const name of names) {
      if (name !== currentName && name.startsWith(build.stem) && name.endsWith(build.extension)) {
        await rm(path.join(directory, name), { force: true })
      }
    }
  } catch (error: unknown) {
    log(`an earlier ${build.label} could not be removed yet (${String(error)})`)
  }
}
