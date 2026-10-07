import type { ExecFileOptions } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { prepareLocalJudgeHelper } from '../../src/runtime/judge/localHelper'

const fixture = { root: '' }
beforeAll(async () => {
  await mkdir(path.resolve('temp/round4'), { recursive: true })
  fixture.root = await realpath(await mkdtemp(path.resolve('temp/round4/helper-')))
  for (const platform of ['darwin', 'linux', 'windows']) {
    await mkdir(path.join(fixture.root, 'native', platform), { recursive: true })
  }
})
afterAll(() => rm(fixture.root, { recursive: true, force: true }))
const paths = () => ({ packageRoot: fixture.root, storageRoot: path.join(fixture.root, 'storage') })

describe('same-build local helper preparation', () => {
  it('refuses an already canceled preparation before platform or file work', async () => {
    const stop = new AbortController()
    stop.abort(new Error('fixture canceled'))
    const run = vi.fn(() => Promise.resolve())
    await expect(prepareLocalJudgeHelper(paths(), 'freebsd', stop.signal, run)).rejects.toBe(
      stop.signal.reason,
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses unknown platforms and relative paths before invoking a compiler', async () => {
    const run = vi.fn(() => Promise.resolve())
    await expect(
      prepareLocalJudgeHelper(paths(), 'freebsd', new AbortController().signal, run),
    ).rejects.toThrow('unverified-platform')
    await expect(
      prepareLocalJudgeHelper(
        { ...paths(), packageRoot: '.' },
        'linux',
        new AbortController().signal,
        run,
      ),
    ).rejects.toThrow('unverified-helper-path')
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses symlinked packaged source before compiling', async () => {
    const target = path.join(fixture.root, 'target')
    const directory = path.join(fixture.root, 'native/linux')
    await mkdir(target)
    await writeFile(path.join(target, 'MuseSparkLocalJudgePeer.c'), 'fixture')
    await rm(directory, { recursive: true })
    await symlink(target, directory, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      await expect(prepareLocalJudgeHelper(paths(), 'linux')).rejects.toThrow(
        'unverified-helper-path',
      )
    } finally {
      await rm(directory)
      await mkdir(directory)
    }
  })

  it('refuses a directory in place of the packaged helper before spawning', async () => {
    const source = path.join(fixture.root, 'native/darwin/muse-local-judge-peer')
    const run = vi.fn(() => Promise.resolve())
    await mkdir(source)
    try {
      await expect(
        prepareLocalJudgeHelper(paths(), 'darwin', new AbortController().signal, run),
      ).rejects.toThrow('unverified-helper-path')
      expect(run).not.toHaveBeenCalled()
    } finally {
      await rm(source, { recursive: true })
    }
  })

  it('compiles only the packaged Linux source with an empty environment and no shell', async () => {
    const source = path.join(fixture.root, 'native/linux/MuseSparkLocalJudgePeer.c')
    await writeFile(source, 'synthetic C source')
    const run = vi.fn<(file: string, args: string[], options: ExecFileOptions) => Promise<void>>(
      async (file, args, options) => {
        expect(file).toBe('/usr/bin/cc')
        expect(options.env).toEqual({})
        expect(options.shell).toBeUndefined()
        const output = args.at(-1)
        if (typeof output !== 'string') throw new Error('missing compiler output')
        await writeFile(output, 'synthetic compiled helper')
      },
    )
    const helper = await prepareLocalJudgeHelper(
      paths(),
      'linux',
      new AbortController().signal,
      run,
    )
    expect(await readFile(helper, 'utf8')).toBe('synthetic compiled helper')
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[1]).toContain(source)
  })

  it('refuses relative storage with a valid packaged source before compiling', async () => {
    const run = vi.fn(() => Promise.reject(new Error('fixture compiler reached')))
    await expect(
      prepareLocalJudgeHelper(
        { ...paths(), storageRoot: '.' },
        'linux',
        new AbortController().signal,
        run,
      ),
    ).rejects.toThrow('unverified-helper-path')
    expect(run).not.toHaveBeenCalled()
  })

  it('verifies the packaged macOS helper and propagates signature failure', async () => {
    const source = path.join(fixture.root, 'native/darwin/muse-local-judge-peer')
    await writeFile(source, 'synthetic binary')
    const run = vi.fn(() => Promise.resolve())
    expect(
      await prepareLocalJudgeHelper(paths(), 'darwin', new AbortController().signal, run),
    ).toBe(source)
    expect(run).toHaveBeenCalledWith(
      '/usr/bin/codesign',
      ['--verify', '--strict', source],
      expect.objectContaining({ env: {} }),
    )
    const refusal = vi.fn(() => Promise.reject(new Error('signature refused')))
    await expect(
      prepareLocalJudgeHelper(paths(), 'darwin', new AbortController().signal, refusal),
    ).rejects.toThrow('signature refused')
  })

  it('compiles Windows source with only SystemRoot and the fixed framework compiler', async () => {
    const source = path.join(fixture.root, 'native/windows/MuseSparkLocalJudgePeer.cs')
    await writeFile(source, 'synthetic C# source')
    vi.stubEnv('SystemRoot', String.raw`C:\Windows`)
    const run = vi.fn<(file: string, args: string[], options: ExecFileOptions) => Promise<void>>(
      async (file, args, options) => {
        expect(file).toBe(String.raw`C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe`)
        expect(options.env).toEqual({ SystemRoot: String.raw`C:\Windows` })
        expect(options.shell).toBeUndefined()
        const output = args.find((arg) => arg.startsWith('/out:'))?.slice('/out:'.length)
        if (!output) throw new Error('missing compiler output')
        await writeFile(output, 'synthetic compiled helper')
      },
    )
    try {
      expect(
        await prepareLocalJudgeHelper(paths(), 'win32', new AbortController().signal, run),
      ).toMatch(/\.exe$/)
      expect(run).toHaveBeenCalledOnce()
      vi.stubEnv('SystemRoot', 'relative')
      await expect(
        prepareLocalJudgeHelper(paths(), 'win32', new AbortController().signal, run),
      ).rejects.toThrow('unverified-compiler-path')
      expect(run).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('refuses cancellation after compilation and removes the partial helper', async () => {
    const stop = new AbortController()
    let output: string | undefined
    const run = vi.fn<(file: string, args: string[], options: ExecFileOptions) => Promise<void>>(
      async (_file, args) => {
        output = args.at(-1)
        if (!output) throw new Error('missing compiler output')
        await writeFile(output, 'synthetic helper')
        stop.abort()
      },
    )
    await expect(prepareLocalJudgeHelper(paths(), 'linux', stop.signal, run)).rejects.toThrow()
    if (!output) throw new Error('missing partial helper')
    await expect(readFile(output)).rejects.toThrow('ENOENT')
  })
})
