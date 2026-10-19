// PARITYMAC: macOS GPU, disk and headroom readings are real IOKit/OS values,
// not unknown. The ioreg fixtures are recorded real exchanges captured on
// MacBookPro15,1 (Intel i9, AMD Radeon Pro + Intel UHD 630) on 2026-10-17:
//   ioreg -r -c IOAccelerator -d 1
//   ioreg -r -c IOBlockStorageDriver -d 1            (then again ~5 s later)
// The twodevices pair is a recorded real exchange captured on the macmini
// rig on 2026-10-18 with the same two commands ~5 s apart: two driver
// instances sharing the object name `IOBlockStorageDriver` under distinct
// registry entry ids.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { DarwinDiskDelta } from '../../src/core/resources/sampler/darwinDisk'
import {
  createOptionalResourceProbes,
  type ResourceProbePort,
} from '../../src/core/resources/sampler/optionalProbes'
import {
  createMachineResourceSampler,
  createSamplerIo,
} from '../../src/core/resources/sampler/system'

const fixtures = path.resolve('test/fixtures/resources')
const accelerator = readFileSync(path.join(fixtures, 'ioreg-ioaccelerator.txt'), 'utf8')
const diskFirst = readFileSync(path.join(fixtures, 'ioreg-blockstorage.txt'), 'utf8')
const diskLater = readFileSync(path.join(fixtures, 'ioreg-blockstorage-later.txt'), 'utf8')
const diskTwoFirst = readFileSync(path.join(fixtures, 'ioreg-blockstorage-twodevices.txt'), 'utf8')
const diskTwoLater = readFileSync(
  path.join(fixtures, 'ioreg-blockstorage-twodevices-later.txt'),
  'utf8',
)

/** The OS side of the probe port, replaying one recorded exchange per tool. */
function recordingPort(recordings: Record<string, string>): ResourceProbePort {
  let atMs = 1000
  return {
    platform: 'darwin',
    monotonicMs: () => (atMs += 15_000),
    read: () => Promise.resolve(undefined),
    list: () => Promise.resolve(null),
    executable: (name) => Promise.resolve(name === 'ioreg' ? '/usr/sbin/ioreg' : null),
    run: (executable, args) =>
      Promise.resolve(
        executable === '/usr/sbin/ioreg' && args[1] === '-c' && typeof args[2] === 'string'
          ? (recordings[args[2]] ?? null)
          : null,
      ),
  }
}

describe('macOS GPU probe', () => {
  it('reads the drivers’ Device Utilization % from the recorded exchange', async () => {
    const probes = createOptionalResourceProbes(recordingPort({ IOAccelerator: accelerator }))
    // Five 0 % readings on the recording rig (idle): the max, not unknown.
    expect(await probes.gpu()).toBe(0)
  })

  it('reports unknown when no accelerator reports utilization', async () => {
    const probes = createOptionalResourceProbes(recordingPort({ IOAccelerator: '' }))
    expect(await probes.gpu()).toBeNull()
  })
})

describe('macOS disk probe', () => {
  it('deltas the drivers’ Total Time between two recorded exchanges', () => {
    const delta = new DarwinDiskDelta()
    expect(delta.read(diskFirst, 0)).toBeNull()
    // Read 76,273,691,090 ns + write 252,221,394,700 ns over 5,000 ms of wall
    // time: (328,495,085,700 ns / 1e6) / 5,000 ms * 100 ≈ 65.7 % busy.
    expect(delta.read(diskLater, 5000)).toBeCloseTo(65.7, 0)
  })

  it('fails closed on regression, stillness of time and absent data', () => {
    const delta = new DarwinDiskDelta()
    expect(delta.read(diskLater, 0)).toBeNull()
    expect(delta.read(diskFirst, 5000)).toBeNull()
    const frozen = new DarwinDiskDelta()
    expect(frozen.read(diskFirst, 0)).toBeNull()
    expect(frozen.read(diskFirst, 0)).toBeNull()
    const missing = new DarwinDiskDelta()
    expect(missing.read(null, 0)).toBeNull()
    expect(missing.read(undefined, 0)).toBeNull()
  })

  it('establishes a baseline then reads idle through the probe', async () => {
    const probes = createOptionalResourceProbes(recordingPort({ IOBlockStorageDriver: diskFirst }))
    expect(await probes.disk()).toBeNull()
    // Same counters twice: no busy time elapsed, through the real port.
    expect(await probes.disk()).toBe(0)
  })

  it('tells same-named drivers apart by registry entry id', () => {
    const delta = new DarwinDiskDelta()
    expect(delta.read(diskTwoFirst, 0)).toBeNull()
    // The busy instance advanced ~14.4 s over 5,000 ms of wall time: capped.
    expect(delta.read(diskTwoLater, 5000)).toBe(100)
  })
})

describe.runIf(process.platform === 'darwin')('macOS probes live', () => {
  it('reads GPU, disk and headroom from this Mac', async () => {
    const io = createSamplerIo({ timeoutMs: 5000, maxOutputBytes: 64 * 1024 })
    const probes = createOptionalResourceProbes(io)
    const gpu = await probes.gpu()
    expect(gpu).not.toBeNull()
    expect(gpu).toBeGreaterThanOrEqual(0)
    expect(gpu).toBeLessThanOrEqual(100)
    expect(await probes.disk()).toBeNull()
    const disk = await new Promise<number | null>((resolve) => {
      setTimeout(() => {
        void probes.disk().then(resolve)
      }, 1200)
    })
    expect(disk).not.toBeNull()
    expect(disk).toBeGreaterThanOrEqual(0)
    expect(disk).toBeLessThanOrEqual(100)
  })

  it('reads headroom through the real sampler on a new enough runtime', async () => {
    const sampler = createMachineResourceSampler(() => resourceSettingsSchema.parse({}), {
      timeoutMs: 5000,
      maxOutputBytes: 64 * 1024,
    })
    const sample = await sampler.sample()
    const [uvMajor = 0, uvMinor = 0] = process.versions.uv.split('.').map(Number)
    if (
      (uvMajor > 1 || (uvMajor === 1 && uvMinor >= 52)) &&
      typeof process.availableMemory === 'function'
    ) {
      const available = sample.memoryAvailableBytes
      const total = sample.memoryTotalBytes
      if (available === null || total === null)
        throw new Error('Headroom must read on this runtime')
      expect(available).toBeGreaterThan(0)
      expect(available).toBeLessThanOrEqual(total)
    } else {
      // Stale runtimes under-report Darwin headroom (D87): unknown, honestly.
      expect(sample.memoryAvailableBytes).toBeNull()
    }
  })
})
