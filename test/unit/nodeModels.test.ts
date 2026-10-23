// M110g lane L: the loopback guard refuses any sidecar off the machine
// (plain HTTP off loopback by its own name), and hardware detection maps
// honest platform readings to the sidecar recipe the machine runs.
import { arch, platform } from 'node:os'
import { describe, expect, it } from 'vitest'
import { classifyHardware, readLocalHardware } from '../../src/runtime/node/models/detect'
import { checkSidecarUrl } from '../../src/runtime/node/models/loopback'

describe('model sidecar loopback guard', () => {
  it('allows loopback and refuses the network by name', () => {
    expect(checkSidecarUrl('http://127.0.0.1:11434')).toEqual({ ok: true })
    expect(checkSidecarUrl('http://localhost:11434')).toEqual({ ok: true })
    expect(checkSidecarUrl('http://[::1]:11434')).toEqual({ ok: true })
    expect(checkSidecarUrl('http://192.168.1.2:11434')).toEqual({
      ok: false,
      reason: 'plain HTTP reaches a sidecar only on loopback',
    })
    expect(checkSidecarUrl('https://models.example.com')).toEqual({
      ok: false,
      reason: 'a sidecar answers on loopback, nowhere else',
    })
    expect(checkSidecarUrl('http://user@127.0.0.1:11434')).toEqual({
      ok: false,
      reason: 'a sidecar URL carries no credentials',
    })
    expect(checkSidecarUrl('not a url')).toEqual({
      ok: false,
      reason: 'a sidecar URL parses first',
    })
  })
})

describe('model hardware detection', () => {
  it('maps honest readings to the recipe the machine runs', () => {
    expect(
      classifyHardware({
        platform: 'darwin',
        arch: 'arm64',
        nvidiaPresent: false,
        rocmPresent: false,
      }),
    ).toEqual({ backend: 'apple', reason: 'Apple Silicon runs the native sidecar' })
    expect(
      classifyHardware({ platform: 'linux', arch: 'x64', nvidiaPresent: true, rocmPresent: false }),
    ).toEqual({ backend: 'cuda', reason: 'an NVIDIA device is present' })
    expect(
      classifyHardware({ platform: 'linux', arch: 'x64', nvidiaPresent: false, rocmPresent: true }),
    ).toEqual({ backend: 'rocm', reason: 'a ROCm device is present' })
    expect(
      classifyHardware({
        platform: 'linux',
        arch: 'x64',
        nvidiaPresent: false,
        rocmPresent: false,
      }),
    ).toEqual({ backend: 'cpu', reason: 'no GPU device found, the CPU serves' })
  })

  it('reads this machine without spawning or guessing', () => {
    const readings = readLocalHardware()
    expect(readings.platform).toBe(platform())
    expect(readings.arch).toBe(arch())
    const verdict = classifyHardware(readings)
    expect(['apple', 'cuda', 'rocm', 'cpu']).toContain(verdict.backend)
  })
})
