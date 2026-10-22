// DARWINMEMORY: the older-libuv headroom reader drives a real native helper
// and retires it on disposal. Every child here is real: the test compiles
// the shipped C source (`native/darwin/MuseSparkCreated.c`, the same file
// the signed helper builds from) and otherwise spawns real OS binaries with
// the reader's fixed `--memory-headroom` argument. No spawn, clock or
// platform value is stubbed, so a failure below is a real helper the reader
// mishandled. Darwin-only: the helper reads Mach VM counters.
import { rm } from 'node:fs/promises'
import { totalmem } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { ResourceEvents } from '../../src/core/resources/events'
import { ResourceGovernor } from '../../src/core/resources/governor'
import { DarwinMemoryReader } from '../../src/core/resources/sampler/darwinMemory'
import { createMachineResourceSampler } from '../../src/core/resources/sampler/system'
import {
  resourceSettingsSchema,
  type ResourceClock,
  type ResourceSettings,
} from '../../src/shared/resources'
import { compileHelper, helperPids, settledGone } from './resourceHarness'

const limits = { timeoutMs: 1000, maxOutputBytes: 128 }
const helper = { folder: '', binary: '' }

beforeAll(async () => {
  if (process.platform !== 'darwin') return
  const built = await compileHelper('m107-memory-reader-')
  helper.folder = built.folder
  helper.binary = built.binary
})

afterAll(async () => {
  if (helper.folder) await rm(helper.folder, { recursive: true, force: true })
})

// Each case retires its own idle children, so the process table the next
// case observes names only the children that case started.
afterEach(async () => {
  for (const item of readers.splice(0)) item.dispose()
  await settledGone(helper.binary)
})

const readers: DarwinMemoryReader[] = []

function reader(binary = helper.binary): DarwinMemoryReader {
  const result = new DarwinMemoryReader(limits, binary)
  readers.push(result)
  return result
}

describe.runIf(process.platform === 'darwin')('Darwin memory helper transport', () => {
  it('starts lazily, shares one in-flight request and reuses one idle child', async () => {
    expect(await helperPids(helper.binary)).toEqual([])
    const sample = reader()
    const first = sample.read()
    expect(sample.read()).toBe(first)
    const value = await first
    expect(value).toBeTypeOf('number')
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(totalmem())
    // A later read runs live memory again, so it is only bounded, never
    // equal: the assertion below it proves the same idle child answered.
    const second = await sample.read()
    expect(second).toBeTypeOf('number')
    expect(second).toBeGreaterThanOrEqual(0)
    expect(second).toBeLessThanOrEqual(totalmem())
    expect(await helperPids(helper.binary)).toHaveLength(1)
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
    const settings: ResourceSettings = resourceSettingsSchema.parse({})
    const sampler = createMachineResourceSampler(
      () => settings,
      { timeoutMs: 1000, maxOutputBytes: 64 * 1024 },
      undefined,
      owned,
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
      const running = await helperPids(helper.binary)
      expect(running).toHaveLength(1)
      governor.dispose()
      await settledGone(helper.binary)
      expect(errors).toEqual([])
    } finally {
      for (const timer of timers) clearTimeout(timer)
      owned.dispose()
    }
  })
})
