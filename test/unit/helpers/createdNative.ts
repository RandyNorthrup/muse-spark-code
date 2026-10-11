import { execFile } from 'node:child_process'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { powerShellQuoted } from '../../../src/core/shellQuote'
import { shellJobAssembly } from '../../../src/host/backend/shellJob'
import { loadJobAssembly, runProgram } from '../../../src/host/processTree'
import { readJobSource } from './jobSource'
import { removeFolder } from './temporaryFolders'
import { windowsCreatedVariant } from './createdNativeWindows'

function run(file: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], { env, windowsHide: true }, (error, stdout) => {
      if (error === null) resolve(stdout)
      else reject(new Error(error.message, { cause: error }))
    })
  })
}
const state: {
  scratch?: string
  call?: (args: readonly string[]) => Promise<string>
  windows?: (assembly: string, args: readonly string[]) => Promise<string>
} = {}
export function useCreatedNative(): void {
  beforeAll(async () => {
    await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
    state.scratch = await mkdtemp(path.join(process.cwd(), 'temp', 'm107-native-'))
    const scratch = state.scratch
    if (process.platform === 'win32') {
      const systemRoot = process.env['SystemRoot']!
      const powershell = path.join(
        systemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
      const errors: string[] = []
      const assembly = await shellJobAssembly({
        storageDir: scratch,
        systemRoot,
        readJobSource,
        // This fixture tests created-path helpers; bootstrap admission has its own suite.
        run: runProgram,
        log: (message) => {
          errors.push(message)
        },
      })()
      if (assembly === undefined)
        throw new Error(`Native test helper unavailable: ${errors.join('\n')}`)
      const prefix = ['-NoProfile', '-NonInteractive', '-Command']
      const prepared = new Set<string>()
      const call = (assemblyPath: string, args: readonly string[]) =>
        run(
          powershell,
          [
            ...prefix,
            `$ErrorActionPreference='Stop'; ${prepareFixtureOwner(args, prepared)} ${loadJobAssembly(assemblyPath)}; [MuseSparkCreated]::Execute([string[]]@(${args.map((arg) => powerShellQuoted(arg)).join(',')}))`,
          ],
          { SystemRoot: systemRoot, TMP: scratch, TEMP: scratch },
        )
      state.windows = call
      state.call = (args) => call(assembly, args)
    } else {
      const binary = path.join(scratch, 'created')
      await run(
        '/usr/bin/cc',
        [
          '-Wall',
          '-Wextra',
          '-Werror',
          '-DMUSE_CREATED_STANDALONE',
          path.join(process.cwd(), 'native', 'darwin', 'MuseSparkCreated.c'),
          ...(process.platform === 'linux' ? ['-lcrypto'] : []),
          '-o',
          binary,
        ],
        { PATH: '/usr/bin:/bin', TMPDIR: scratch },
      )
      state.call = (args) => run(binary, args)
    }
  }, 30_000) // Building a native helper once is a genuinely long operation on Windows.
  afterAll(async () => {
    if (state.scratch !== undefined) await removeFolder(state.scratch)
  })
}

/** Fixture paths created by elevated Node default to Administrators, not this test's user. */
function prepareFixtureOwner(args: readonly string[], prepared: Set<string>): string {
  const files = args[0] === 'publish' ? [args[1]!, path.join(args[1]!, args[3]!)] : [args[1]!]
  return files
    .filter((file) => {
      if (prepared.has(file)) return false
      prepared.add(file)
      return true
    })
    .map((file) => {
      const type = file === args[1] ? 'DirectoryInfo' : 'FileInfo'
      return `$fixture = [IO.${type}]::new(${powerShellQuoted(file)}); $acl = $fixture.GetAccessControl(); $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User); $fixture.SetAccessControl($acl);`
    })
    .join(' ')
}

export function nativeCreated(args: readonly string[]): Promise<string> {
  if (state.call === undefined) throw new Error('Native test helper is not prepared')
  return state.call(args)
}
export async function compileCreatedVariant(
  source: string,
): Promise<(args: readonly string[]) => Promise<string>> {
  if (state.scratch === undefined) throw new Error('Native test helper is not prepared')
  if (process.platform === 'win32') {
    const call = state.windows
    if (call === undefined) throw new Error('Windows native fixture is not prepared')
    const assembly = await shellJobAssembly({
      storageDir: path.join(state.scratch, path.basename(source, '.c')),
      systemRoot: process.env['SystemRoot']!,
      readJobSource: async (helper) => windowsCreatedVariant(await readJobSource(helper), source),
      run: runProgram,
      log: () => undefined,
    })()
    if (assembly === undefined) throw new Error('Windows native fixture compilation failed')
    return (args) => call(assembly, args)
  }
  const binary = path.join(state.scratch, path.basename(source, '.c'))
  await run(
    '/usr/bin/cc',
    [
      '-Wall',
      '-Wextra',
      '-Werror',
      '-D_GNU_SOURCE',
      '-DMUSE_CREATED_STANDALONE',
      path.join(process.cwd(), source),
      ...(process.platform === 'linux' ? ['-lcrypto'] : []),
      '-o',
      binary,
    ],
    { PATH: '/usr/bin:/bin', TMPDIR: state.scratch },
  )
  return (args) => run(binary, args)
}
export function nativeScratch(): string {
  if (state.scratch === undefined) throw new Error('Native test helper is not prepared')
  return state.scratch
}
