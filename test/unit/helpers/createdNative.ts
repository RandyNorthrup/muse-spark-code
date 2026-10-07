import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { powerShellQuoted } from '../../../src/core/shellQuote'
import { readJobSource } from './jobSource'

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
      const assembly = path.join(scratch, 'created.dll')
      const source = path.join(scratch, 'created.cs')
      await writeFile(source, await readJobSource('shellJob'))
      const prefix = ['-NoProfile', '-NonInteractive', '-Command']
      await run(
        powershell,
        [
          ...prefix,
          `$ErrorActionPreference='Stop'; Add-Type -Path ${powerShellQuoted(source)} -OutputAssembly ${powerShellQuoted(assembly)}`,
        ],
        { SystemRoot: systemRoot, TMP: scratch, TEMP: scratch },
      )
      state.call = (args) =>
        run(
          powershell,
          [
            ...prefix,
            `$ErrorActionPreference='Stop'; [void][Reflection.Assembly]::LoadFrom(${powerShellQuoted(assembly)}); [MuseSparkCreated]::Execute([string[]]@(${args.map((arg) => powerShellQuoted(arg)).join(',')}))`,
          ],
          { SystemRoot: systemRoot, TMP: scratch, TEMP: scratch },
        )
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
    if (state.scratch !== undefined) await rm(state.scratch, { recursive: true, force: true })
  })
}

export function nativeCreated(args: readonly string[]): Promise<string> {
  if (state.call === undefined) throw new Error('Native test helper is not prepared')
  return state.call(args)
}
export async function compileCreatedVariant(
  source: string,
): Promise<(args: readonly string[]) => Promise<string>> {
  if (state.scratch === undefined) throw new Error('Native test helper is not prepared')
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
