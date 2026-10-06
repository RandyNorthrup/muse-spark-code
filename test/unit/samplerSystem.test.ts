import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import {
  createMachineResourceSampler,
  createSamplerIo,
  type ResourceProbeLimits,
} from '../../src/core/resources/sampler/system'
import { resourceSampleSchema, resourceSettingsSchema } from '../../src/shared/resources'

vi.mock('node:os', { spy: true })
vi.mock('node:child_process', { spy: true })

const limits: ResourceProbeLimits = { timeoutMs: 2000, maxOutputBytes: 65_536 }
const scratch: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    scratch.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('resource sampler OS adapter', () => {
  it('does no OS sampling on import/construction and provides validated real readings on demand', async () => {
    const cpus = vi.mocked(os.cpus)
    const total = vi.mocked(os.totalmem)
    const sampler = createMachineResourceSampler(() => resourceSettingsSchema.parse({}), limits)
    expect(cpus).not.toHaveBeenCalled()
    expect(total).not.toHaveBeenCalled()
    const first = await sampler.sample()
    expect(resourceSampleSchema.safeParse(first).success).toBe(true)
    expect(first.cpuPercent).toBeNull()
    expect(first.gpuPercent).toBeNull()
    expect(first.diskBusyPercent).toBeNull()
    expect(cpus).toHaveBeenCalledTimes(1)
    expect(total).toHaveBeenCalledTimes(1)
    expect(first.atMs).toBeGreaterThan(0)
  })

  it('enforces finite positive limits, the sample deadline and bounded output before any probe', () => {
    for (const timeoutMs of [0, -1, 0.5, 5001, NaN, Infinity])
      expect(() => createSamplerIo({ ...limits, timeoutMs })).toThrow()
    for (const maxOutputBytes of [0, -1, 0.5, 65_537, NaN, Infinity])
      expect(() => createSamplerIo({ ...limits, maxOutputBytes })).toThrow()
  })

  it('bounds file reads and distinguishes absence from unreadable or malformed content', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm107-sampler-'))
    scratch.push(directory)
    const file = path.join(directory, 'counter')
    const io = createSamplerIo({ ...limits, maxOutputBytes: 8 })
    expect(await io.read(file)).toBeUndefined()
    expect(await io.read(directory)).toBeNull()
    await writeFile(file, '12345678')
    expect(await io.read(file)).toBe('12345678')
    await writeFile(file, '123456789')
    expect(await io.read(file)).toBeNull()
    await writeFile(file, Buffer.from([255]))
    expect(await io.read(file)).toBeNull()
    expect(await io.list(file)).toBeNull()
    expect(await io.list(directory)).toContain('counter')
  })

  it('runs only absolute executables with literal arguments and a credential-free environment', async () => {
    const io = createSamplerIo(limits)
    const calls = vi.mocked(execFile).mock.calls.length
    expect(await io.run('node', ['-e', 'process.stdout.write("unexpected")'])).toBeNull()
    expect(vi.mocked(execFile).mock.calls).toHaveLength(calls)
    const code =
      'process.stdout.write(JSON.stringify({ args: process.argv.slice(1), env: Object.keys(process.env).filter(key => process.env[key] !== "") }))'
    const literal = '$(never-run); `never-run` " spaces'
    const text = await io.run(process.execPath, ['-e', code, literal])
    expect(text).not.toBeNull()
    const parsed: unknown = JSON.parse(text!)
    expect(parsed).toEqual({
      args: [literal],
      env: process.platform === 'win32' ? ['SystemRoot', 'windir'] : [],
    })
    expect(await io.run(process.execPath, ['-e', 'process.exit(1)'])).toBeNull()
    expect(await io.run(path.join(os.tmpdir(), 'm107-no-such-executable'), [])).toBeNull()
    const powershell = await io.executable('powershell')
    if (powershell !== null && process.platform === 'win32')
      expect(path.win32.isAbsolute(powershell)).toBe(true)
    else expect(powershell).toBeNull()
  })

  it('bounds child stdout, stderr and duration without leaking failed child output', async () => {
    const io = createSamplerIo({ timeoutMs: 200, maxOutputBytes: 64 })
    expect(
      await io.run(process.execPath, ['-e', 'process.stdout.write("x".repeat(65))']),
    ).toBeNull()
    expect(
      await io.run(process.execPath, ['-e', 'process.stderr.write("x".repeat(65))']),
    ).toBeNull()
    expect(await io.run(process.execPath, ['-e', 'setTimeout(() => {}, 800)'])).toBeNull()
  })
})
