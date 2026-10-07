import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nodeProjectDetectIo } from '../../src/core/maker/detect/projectIo'
import { windowsProjectIo } from '../../src/core/maker/detect/projectIoWindows'
import {
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_FILES,
  MAKER_DETECT_IO_TIMEOUT_MS,
} from '../../src/shared/constants'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    open: vi.fn(actual.open),
    opendir: vi.fn(actual.opendir),
    realpath: vi.fn(actual.realpath),
    lstat: vi.fn(actual.lstat),
  }
})
vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
const native = await vi.importActual<typeof fs>('node:fs/promises')
const child = await import('node:child_process')
const nativeChild = await vi.importActual<typeof child>('node:child_process')
const state = { fixture: '', root: '', outside: '', dummy: '' }

beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubEnv('SystemRoot', String.raw`C:\Windows`)
  vi.mocked(fs.open).mockImplementation(native.open)
  vi.mocked(fs.opendir).mockImplementation(native.opendir)
  vi.mocked(fs.realpath).mockImplementation(native.realpath)
  vi.mocked(fs.lstat).mockImplementation(native.lstat)
  state.fixture = await native.realpath(await native.mkdtemp(path.join(tmpdir(), 'm103-d-io-')))
  state.root = path.join(state.fixture, 'ws')
  state.outside = path.join(state.fixture, 'outside')
  state.dummy = path.join(state.fixture, 'descriptor')
  const { root, outside, dummy } = state
  await native.mkdir(path.join(root, 'sub', 'nested'), { recursive: true })
  await native.mkdir(path.join(outside, 'nested'), { recursive: true })
  await native.writeFile(dummy, '')
  await native.writeFile(path.join(root, 'sub', 'main.py'), 'inside')
  await native.writeFile(path.join(outside, 'main.py'), 'outside')
  await native.writeFile(path.join(root, 'sub', 'nested', 'inside.scad'), '')
  await native.writeFile(path.join(outside, 'nested', 'outside.scad'), '')
})
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await native.rm(state.fixture, { recursive: true, force: true })
})

/** Real owned handles/fixtures; only path resolution and the swap schedule are faked. */
function schedule(
  platform: 'linux' | 'darwin',
  swapAt: 'file-open' | 'directory-open' | 'listing' | 'root-replacement' | 'root-move',
) {
  const { root, outside, dummy } = state
  vi.stubGlobal('process', { ...process, platform })
  let isSwapped = false
  const held = new Map<number, string>()
  const reads = vi.fn()
  const closes: (() => boolean)[] = []
  const nested = path.join(root, 'sub', 'nested')
  const target = path.join(root, 'sub', 'main.py')
  const movedRoot = path.join(state.fixture, 'moved-ws')
  const current = (name: string) => {
    if (!isSwapped) return name
    if (swapAt === 'root-replacement' && name === root) return outside
    if (name === target) return path.join(outside, 'main.py')
    return name === nested ? path.join(outside, 'nested') : name
  }
  vi.mocked(fs.realpath).mockImplementation(async (name) => {
    const text = String(name)
    if (text.startsWith('/proc/self/fd/')) {
      const resolved = held.get(Number(path.posix.basename(text)))
      if (resolved === undefined) throw new Error('Unknown descriptor')
      return (swapAt === 'root-replacement' || swapAt === 'root-move') &&
        resolved === path.join(outside, 'main.py')
        ? target
        : resolved
    }
    if (swapAt === 'root-move' && isSwapped && text === root) return movedRoot
    if (swapAt === 'root-move' && text === target) return text
    return swapAt === 'root-replacement' && (text === root || text === target)
      ? text
      : await native.realpath(current(text))
  })
  vi.mocked(fs.lstat).mockImplementation(
    async (name, options) =>
      await native.lstat(String(name) === movedRoot ? root : current(String(name)), options),
  )
  vi.mocked(fs.open).mockImplementation(async (name, flags, mode) => {
    const text = String(name)
    if (
      (swapAt === 'file-open' && text === target) ||
      (swapAt === 'root-replacement' && text === target) ||
      (swapAt === 'root-move' && text === target) ||
      (swapAt === 'directory-open' && text === nested)
    )
      isSwapped = true
    if (swapAt === 'root-move' && isSwapped)
      for (const [fd, heldName] of held) if (heldName === root) held.set(fd, movedRoot)
    const selected = current(text)
    const info = await native.lstat(selected, { bigint: true })
    const handle = info.isDirectory()
      ? await native.open(dummy, 'r')
      : await native.open(selected, flags, mode)
    held.set(handle.fd, selected)
    if (info.isDirectory()) vi.spyOn(handle, 'stat').mockResolvedValue(info)
    const handleRead = handle.read.bind(handle)
    if (!info.isDirectory())
      vi.spyOn(handle, 'read').mockImplementation(async (...args) => {
        reads()
        return await handleRead(...args)
      })
    const close = vi.spyOn(handle, 'close')
    closes.push(() => close.mock.calls.length === 1)
    return handle
  })
  vi.mocked(fs.opendir).mockImplementation(async (name, options) => {
    const text = String(name)
    if (
      text === nested ||
      ((text.startsWith('/proc/self/fd/') || text.startsWith('/dev/fd/')) &&
        held.get(Number(path.posix.basename(text))) === nested)
    ) {
      isSwapped = true
    }
    const selected =
      text.startsWith('/proc/self/fd/') || text.startsWith('/dev/fd/')
        ? held.get(Number(path.posix.basename(text)))
        : current(text)
    if (selected === undefined) throw new Error('Unknown descriptor')
    return await native.opendir(selected, options)
  })
  return { reads, wereClosed: () => closes.every((check) => check()), didSwap: () => isSwapped }
}

describe('opened-handle workspace confinement', () => {
  const refusedReads = [
    {
      description: 'refuses an object at the old pathname after the workspace root moves',
      phase: 'root-move',
    },
    {
      description: 'rejects a replacement workspace root with a different native identity',
      phase: 'root-replacement',
    },
    { description: 'refuses bytes from an ancestor swapped before file open', phase: 'file-open' },
  ] as const
  it.each(
    refusedReads.flatMap((row) =>
      (['linux', 'darwin'] as const).map((platform) => ({ ...row, platform })),
    ),
  )('$description on $platform', async ({ platform, phase }) => {
    const world = schedule(platform, phase)
    expect(
      await nodeProjectDetectIo.read(state.root, 'sub/main.py', MAKER_DETECT_MAX_BYTES),
    ).toBeUndefined()
    expect(world.didSwap()).toBe(true)
    expect(world.reads).not.toHaveBeenCalled()
    expect(world.wereClosed()).toBe(true)
  })
  it.each(['linux', 'darwin'] as const)(
    'reads an unchanged regular file through its checked handle on %s',
    async (platform) => {
      const world = schedule(platform, 'listing')
      expect(
        await nodeProjectDetectIo.read(state.root, 'sub/main.py', MAKER_DETECT_MAX_BYTES),
      ).toEqual(Buffer.from('inside'))
      expect(world.reads).toHaveBeenCalled()
      expect(world.wereClosed()).toBe(true)
    },
  )

  it.each(['linux', 'darwin'] as const)(
    'refuses outside names after an ancestor swap before directory open on %s',
    async (platform) => {
      const world = schedule(platform, 'directory-open')
      const names = await Array.fromAsync(
        nodeProjectDetectIo.files(state.root, MAKER_DETECT_MAX_FILES),
      )
      expect(world.didSwap()).toBe(true)
      expect(names).not.toContain('sub/nested/outside.scad')
      expect(world.wereClosed()).toBe(true)
    },
  )
  it.each(['linux', 'darwin'] as const)(
    'lists the checked directory handle when its ancestor swaps after validation on %s',
    async (platform) => {
      const world = schedule(platform, 'listing')
      const names = await Array.fromAsync(
        nodeProjectDetectIo.files(state.root, MAKER_DETECT_MAX_FILES),
      )
      expect(world.didSwap()).toBe(true)
      expect(names).toContain('sub/nested/inside.scad')
      expect(names).not.toContain('sub/nested/outside.scad')
      expect(world.wereClosed()).toBe(true)
    },
  )
})

function output(value: unknown) {
  vi.mocked(child.execFile).mockImplementation((_file, _args, _options, callback) => {
    if (typeof callback !== 'function') throw new Error('Missing callback')
    callback(null, JSON.stringify(value), '')
    return new nativeChild.ChildProcess()
  })
}

describe('Windows native helper boundary', () => {
  it('refuses a missing or relative system directory without launching a helper', async () => {
    output([])
    for (const systemRoot of [undefined, 'relative']) {
      vi.stubEnv('SystemRoot', systemRoot)
      await expect(windowsProjectIo.files('E:\\', 1)).rejects.toThrow('system-directory')
      expect(await nodeProjectDetectIo.volumeLabel?.('E:\\', 'win32')).toBeUndefined()
    }
    expect(child.execFile).not.toHaveBeenCalled()
  })
  it('uses bounded credential-free native reads and validates names and bytes', async () => {
    output(['app/CMakeLists.txt'])
    expect(await windowsProjectIo.files('E:\\', 1)).toEqual(['app/CMakeLists.txt'])
    const call = vi.mocked(child.execFile).mock.calls[0]
    expect(call?.[0]).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`)
    // Compare names before values: a regression must never print an inherited credential.
    expect(Object.keys(call?.[2]?.env ?? {})).toEqual(['PSModulePath'])
    expect(call?.[2]?.env?.['PSModulePath']).toBe(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\Modules`,
    )
    expect(call?.[2]).toMatchObject({
      timeout: MAKER_DETECT_IO_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
    output(Buffer.from('inside').toString('base64'))
    expect(await windowsProjectIo.read('E:\\', 'code.py', MAKER_DETECT_MAX_BYTES)).toEqual(
      Buffer.from('inside'),
    )
    output(null)
    expect(await windowsProjectIo.read('E:\\', 'code.py', MAKER_DETECT_MAX_BYTES)).toBeUndefined()
    output(['one', 'two'])
    await expect(windowsProjectIo.files('E:\\', 1)).rejects.toThrow()
    output('not base64')
    await expect(windowsProjectIo.read('E:\\', 'code.py', MAKER_DETECT_MAX_BYTES)).rejects.toThrow()
    output(Buffer.from('outside').toString('base64'))
    await expect(windowsProjectIo.read('E:\\', 'code.py', 1)).rejects.toThrow('byte limit')
    output(null)
    vi.mocked(child.execFile).mockClear()
    expect(await windowsProjectIo.read('E:\\', '../code.py', 1)).toBeUndefined()
    expect(await windowsProjectIo.read('E:\\', 'COM1.py', 1)).toBeUndefined()
    expect(child.execFile).not.toHaveBeenCalled()
  })
})

describe('OS volume metadata', () => {
  it('reads Windows drive labels without shell-interpolating the path or inheriting an environment', async () => {
    vi.mocked(child.execFile).mockImplementation((_file, _args, _options, callback) => {
      callback?.(null, 'CIRCUITPY', '')
      return new nativeChild.ChildProcess()
    })
    expect(await nodeProjectDetectIo.volumeLabel?.('E:\\', 'win32')).toBe('CIRCUITPY')
    expect(await nodeProjectDetectIo.volumeLabel?.('E:/', 'win32')).toBe('CIRCUITPY')
    expect(child.execFile).toHaveBeenCalledWith(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      expect.arrayContaining(['-EncodedCommand']),
      expect.objectContaining({ env: {} }),
      expect.any(Function),
    )
    vi.mocked(child.execFile).mockClear()
    expect(await nodeProjectDetectIo.volumeLabel?.(String.raw`E:\project`, 'win32')).toBeUndefined()
    expect(child.execFile).not.toHaveBeenCalled()
  })
  it('uses macOS volume names and validates the exact Linux mount root', async () => {
    expect(await nodeProjectDetectIo.volumeLabel?.('/Volumes/CIRCUITPY', 'darwin')).toBe(
      'CIRCUITPY',
    )
    expect(
      await nodeProjectDetectIo.volumeLabel?.('/Volumes/CIRCUITPY/app', 'darwin'),
    ).toBeUndefined()
    output({ filesystems: [{ target: '/media/board', label: 'CIRCUITPY' }] })
    expect(await nodeProjectDetectIo.volumeLabel?.('/media/board', 'linux')).toBe('CIRCUITPY')
    expect(child.execFile).toHaveBeenCalledWith(
      '/usr/bin/findmnt',
      ['--json', '--output', 'TARGET,LABEL', '--target', '/media/board'],
      expect.objectContaining({ env: {} }),
      expect.any(Function),
    )
    expect(await nodeProjectDetectIo.volumeLabel?.('/media/board/project', 'linux')).toBeUndefined()
    output({ filesystems: [{ target: '/media/board', label: {} }] })
    expect(await nodeProjectDetectIo.volumeLabel?.('/media/board', 'linux')).toBeUndefined()
  })
})
