import { spawn } from 'node:child_process'
import type * as ChildProcess from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DarwinMemoryReader } from '../../src/core/resources/sampler/darwinMemory'

vi.mock('node:child_process', { spy: true })
const { spawn: realSpawn } = await vi.importActual<typeof ChildProcess>('node:child_process')
const readers: DarwinMemoryReader[] = []
const closures: Promise<unknown>[] = []
const limits = { timeoutMs: 500, maxOutputBytes: 128 }

function reader(mode = 'normal', file = process.execPath): DarwinMemoryReader {
  vi.mocked(spawn).mockImplementation((_file, _args, options) => {
    const child = realSpawn(
      process.execPath,
      [fileURLToPath(new URL('../fixtures/darwin-memory.mjs', import.meta.url)), mode],
      options,
    )
    closures.push(once(child, 'close'))
    return child
  })
  const result = new DarwinMemoryReader(limits, file)
  readers.push(result)
  return result
}

afterEach(async () => {
  for (const item of readers.splice(0)) item.dispose()
  await Promise.all(closures.splice(0))
  vi.restoreAllMocks()
})

describe('Darwin memory helper transport', () => {
  it('starts lazily, shares concurrent requests and reuses one idle child across samples', async () => {
    const sample = reader()
    expect(spawn).not.toHaveBeenCalled()
    const first = sample.read()
    expect(sample.read()).toBe(first)
    expect(await first).toBe(6000)
    expect(await sample.read()).toBe(6000)
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['--memory-headroom'],
      expect.objectContaining({ shell: false, stdio: 'pipe', env: expect.any(Object) }),
    )
    const options = vi.mocked(spawn).mock.calls[0]?.[2]
    expect(Object.values(options?.env ?? {}).every((value) => value === '')).toBe(true)
  })

  it('preserves a genuine zero counter', async () => {
    expect(await reader('{"availableBytes":0}\n').read()).toBe(0)
  })

  it.each([
    '{"availableBytes":-1}\n',
    '{"availableBytes":0.5}\n',
    '{"availableBytes":9007199254740992}\n',
    '{"availableBytes":null}\n',
    '{"availableBytes":6000,"unexpected":true}\n',
    '{"availableBytes":"6000"}\n',
    'not JSON\n',
    'invalid-utf8',
    'x'.repeat(129),
    ' '.repeat(129) + '{"availableBytes":6000}\n',
    '{"availableBytes":6000}\n{"availableBytes":6000}\n',
    '{"availableBytes":6000}',
    'stderr',
    'exit',
    'stall',
  ])('returns unknown and retires malformed/failed helper: %s', async (mode) => {
    const sample = reader(mode)
    expect(await sample.read()).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('returns unknown for a missing helper and refuses relative executables', async () => {
    const sample = new DarwinMemoryReader(limits, path.resolve('temp/no-memory-helper'))
    readers.push(sample)
    expect(await sample.read()).toBeNull()
    vi.mocked(spawn).mockClear()
    expect(await reader('normal', 'relative-helper').read()).toBeNull()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('settles an in-flight request on disposal and cannot restart', async () => {
    const sample = reader('stall')
    const pending = sample.read()
    sample.dispose()
    expect(await Promise.race([pending, Promise.resolve('still pending')])).toBeNull()
    expect(await sample.read()).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('starts a replacement only after the previous failed child closes', async () => {
    const sample = reader('exit')
    expect(await sample.read()).toBeNull()
    await Promise.all(closures)
    expect(await sample.read()).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
