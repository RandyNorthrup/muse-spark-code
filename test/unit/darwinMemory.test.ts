// DARWINMEMORY: the older-libuv headroom reader drives a real native helper
// and retires it on disposal. Every child here is real: the test compiles
// the shipped C source (`native/darwin/MuseSparkCreated.c`, the same file
// the signed helper builds from) and otherwise spawns real OS binaries with
// the reader's fixed `--memory-headroom` argument. No spawn, clock or
// platform value is stubbed, so a failure below is a real helper the reader
// mishandled. Darwin-only: the helper reads Mach VM counters.
import { execFile, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import { tmpdir, totalmem } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { DarwinMemoryReader } from '../../src/core/resources/sampler/darwinMemory'
import { MachineResourceSampler } from '../../src/core/resources/sampler/machineSampler'
import { createSamplerIo } from '../../src/core/resources/sampler/system'
import { createOptionalResourceProbes } from '../../src/core/resources/sampler/optionalProbes'
import {
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceSettings,
} from '../../src/shared/resources'

const limits = { timeoutMs: 1000, maxOutputBytes: 128 }
const helper = { folder: '', binary: '' }

function compileHelper() {
  execFileSync(
    '/usr/bin/cc',
    [
      '-Os',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-DMUSE_CREATED_STANDALONE',
      '-arch',
      'x86_64',
      '-arch',
      'arm64',
      '-mmacosx-version-min=12.0',
      path.resolve('native/darwin/MuseSparkCreated.c'),
      '-o',
      helper.binary,
    ],
    {
      env: {
        PATH: '/usr/bin:/bin',
        TMPDIR: helper.folder,
        // The toolchain lookup (not the helper) may need this: without it a
        // machine whose xcode-select names a missing Xcode cannot drive cc.
        ...(process.env['DEVELOPER_DIR'] !== undefined && {
          DEVELOPER_DIR: process.env['DEVELOPER_DIR'],
        }),
      },
    },
  )
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', helper.binary], { env: {} })
}

beforeAll(async () => {
  if (process.platform !== 'darwin') return
  helper.folder = await mkdtemp(path.join(tmpdir(), 'm107-memory-reader-'))
  helper.binary = path.join(helper.folder, 'memory')
  compileHelper()
})

afterAll(async () => {
  if (helper.folder) await rm(helper.folder, { recursive: true, force: true })
})

// Each case retires its own idle children, so the process table the next
// case observes names only the children that case started.
afterEach(async () => {
  for (const item of readers.splice(0)) item.dispose()
  await settledGone()
})

const readers: DarwinMemoryReader[] = []

function reader(binary = helper.binary): DarwinMemoryReader {
  const result = new DarwinMemoryReader(limits, binary)
  readers.push(result)
  return result
}

/** PIDs whose full command line names this run's helper binary. */
function helperPids(): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', helper.binary], (error, stdout) => {
      if (error !== null) {
        resolve([])
        return
      }
      resolve(
        stdout
          .split('\n')
          .map(Number)
          .filter((pid) => Number.isSafeInteger(pid) && pid > 0),
      )
    })
  })
}

async function settledGone(): Promise<void> {
  const startedAt = Date.now()
  for (;;) {
    const running = await helperPids()
    if (running.length === 0) return
    if (Date.now() - startedAt > 5000) throw new Error('helper child outlived disposal')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe.runIf(process.platform === 'darwin')('Darwin memory helper transport', () => {
  it('starts lazily, shares one in-flight request and reuses one idle child', async () => {
    expect(await helperPids()).toEqual([])
    const sample = reader()
    const first = sample.read()
    expect(sample.read()).toBe(first)
    const value = await first
    expect(value).toBeTypeOf('number')
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(totalmem())
    expect(await sample.read()).toBe(value)
    expect(await helperPids()).toHaveLength(1)
  })

  it.each([
    ['/bin/echo', 'prints its argument instead of a frame'],
    ['/bin/cat', 'writes its refusal to stderr'],
    ['/bin/false', 'exits without answering'],
  ])('returns unknown for a real %s helper: %s', async (binary) => {
    expect(await reader(binary).read()).toBeNull()
  })

  it('returns unknown for a missing helper and refuses relative executables', async () => {
    expect(await reader(path.join(helper.folder, 'absent')).read()).toBeNull()
    expect(await reader('relative-helper').read()).toBeNull()
  })

  it('settles an in-flight request on disposal and cannot restart', async () => {
    const sample = reader()
    const pending = sample.read()
    sample.dispose()
    await expect(pending).resolves.toBeNull()
    await expect(sample.read()).resolves.toBeNull()
  })

  it('starts a replacement after the previous failed child closes', async () => {
    const sample = reader('/bin/false')
    await expect(sample.read()).resolves.toBeNull()
    await expect(sample.read()).resolves.toBeNull()
  })

  it('retires the helper child when its governor disposes', async () => {
    const owned = new DarwinMemoryReader(limits, helper.binary)
    const io = createSamplerIo({ timeoutMs: 1000, maxOutputBytes: 64 * 1024 })
    const settings: ResourceSettings = resourceSettingsSchema.parse({})
    const sampler = new MachineResourceSampler(
      {
        platform: 'darwin',
        now: () => Date.now(),
        cpus: () => os.cpus().map((cpu) => cpu.times),
        totalMemory: () => os.totalmem(),
        freeMemory: () => os.freemem(),
        availableMemory: () => owned.read(),
        dispose: () => {
          owned.dispose()
        },
        read: io.read,
        loadOptionalProbes: () => Promise.resolve(createOptionalResourceProbes(io)),
      },
      () => settings,
    )
    const errors: unknown[] = []
    const events = new ResourceEvents((error) => {
      errors.push(error)
    })
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const clock: ResourceClock = {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        timers.add(timer)
        return () => {
          clearTimeout(timer)
          timers.delete(timer)
        }
      },
    }
    const governor = new ResourceGovernor({
      clock,
      sampler,
      settings,
      events,
      hasRelocationTarget: null,
      onError: (error) => {
        errors.push(error)
      },
    })
    try {
      await governor.refresh()
      const running = await helperPids()
      expect(running).toHaveLength(1)
      governor.dispose()
      await settledGone()
      expect(errors).toEqual([])
    } finally {
      for (const timer of timers) clearTimeout(timer)
      owned.dispose()
    }
  })
})
