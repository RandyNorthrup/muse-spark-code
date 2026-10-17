import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { screenRecordExecutable } from '../../src/host/backend/jobBuild'
import type { RunProgram } from '../../src/host/processTree'
import { removeFolder } from './helpers/temporaryFolders'

const paths = { root: '' }
const SYSTEM_ROOT = String.raw`C:\Windows`

beforeAll(async () => {
  paths.root = await mkdtemp(path.join(tmpdir(), 'muse-screen-build-'))
})
afterAll(() => removeFolder(paths.root))

async function setup() {
  const storageDir = await mkdtemp(path.join(paths.root, 'build-'))
  const run = vi.fn<RunProgram>(async (_file, args) => {
    if (args[0] === '--self-test') return 'muse-spark-screen-record-ready\n'
    const output = args.find((arg) => arg.startsWith('/out:'))?.slice('/out:'.length)
    if (output === undefined) throw new Error('compiler output missing')
    await writeFile(output, 'test-only binary')
    return ''
  })
  const deps = {
    storageDir,
    systemRoot: SYSTEM_ROOT,
    readSource: vi.fn(() => Promise.resolve('test-only native source')),
    verifyTrustedPath: vi.fn(() => Promise.resolve(true)),
    run,
  }
  return { deps, ready: screenRecordExecutable(deps) }
}

describe('M105 R2 lazy recorder build entry', () => {
  it('reads and compiles on first use, caches, and references only inbox assemblies/metadata', async () => {
    const { deps, ready } = await setup()
    expect(deps.readSource).not.toHaveBeenCalled()
    const executable = await ready()
    expect(executable).toBeDefined()
    expect(await ready()).toBe(executable)
    expect(deps.readSource).toHaveBeenCalledOnce()
    expect(deps.run).toHaveBeenCalledTimes(2)
    const compiler = vi.mocked(deps.run).mock.calls[0]
    expect(compiler?.[0]).toBe(String.raw`C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe`)
    expect(compiler?.[1]).toContain(
      String.raw`/reference:C:\Windows\System32\WinMetadata\Windows.Graphics.winmd`,
    )
    expect(compiler?.[1]).toContain(
      String.raw`/reference:C:\Windows\System32\WinMetadata\Windows.Media.winmd`,
    )
    expect(compiler?.[1]).toContain(
      String.raw`/reference:C:\Windows\Microsoft.NET\Framework\v4.0.30319\System.Runtime.InteropServices.WindowsRuntime.dll`,
    )
    expect(compiler?.[1].some((arg) => arg.includes('Windows Kits'))).toBe(false)
    for (const call of vi.mocked(deps.run).mock.calls)
      expect(call[2]).toEqual({ SystemRoot: SYSTEM_ROOT })
    expect(deps.verifyTrustedPath).toHaveBeenNthCalledWith(1, compiler?.[0])
    expect(deps.verifyTrustedPath).toHaveBeenNthCalledWith(2, executable)
    expect(await readdir(deps.storageDir)).toEqual([path.basename(executable ?? '')])
  })

  it('verifies the compiler before spawning it', async () => {
    const { deps } = await setup()
    deps.verifyTrustedPath.mockResolvedValue(false)
    expect(await screenRecordExecutable(deps)()).toBeUndefined()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('verifies the built helper before its identity check', async () => {
    const { deps } = await setup()
    deps.verifyTrustedPath.mockResolvedValueOnce(true).mockResolvedValue(false)
    expect(await screenRecordExecutable(deps)()).toBeUndefined()
    expect(deps.run).toHaveBeenCalledOnce()
  })

  it('refuses an incorrect identity reply', async () => {
    const { deps } = await setup()
    const compile = deps.run
    const run: RunProgram = (file, args, env) =>
      args[0] === '--self-test' ? Promise.resolve('different helper') : compile(file, args, env)
    expect(await screenRecordExecutable({ ...deps, run })()).toBeUndefined()
  })

  it('cleans partial compiler output and fails closed', async () => {
    const { deps } = await setup()
    const run: RunProgram = vi.fn().mockRejectedValue(new Error('compiler unavailable'))
    expect(await screenRecordExecutable({ ...deps, run })()).toBeUndefined()
    expect(await readdir(deps.storageDir)).toEqual([])
  })
})
