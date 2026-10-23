// M125 lane H test fixtures: one hardware summary per acceptance
// class (D107 acceptance 9). Constructed domain values over the scan's
// own types — the shapes probes return, with class-defining readings —
// never recordings; the live scan test proves the real readings.
import type { HardwareSummary } from '../../../../src/core/judge/hardware/types'

const GIB = 1024 * 1024 * 1024

function base(): HardwareSummary {
  return {
    os: 'linux',
    arch: 'x64',
    osVersion: 'test-os',
    ramBytes: 16 * GIB,
    freeRamBytes: 9 * GIB,
    cpu: { model: 'test-cpu', cores: 8, features: ['avx2'] },
    gpu: { vendor: 'none', backend: 'cpu', reason: 'test: no GPU' },
    diskFreeBytes: 100 * GIB,
    installPath: '/test/judge',
    ollama: { installed: false, running: false },
  }
}

export interface NamedDescriptor {
  readonly name: string
  readonly summary: HardwareSummary
}

/** The seven acceptance classes, from too small to Apple silicon. */
export const JUDGE_HARDWARE_DESCRIPTORS: readonly NamedDescriptor[] = [
  { name: 'noGpu16GB', summary: base() },
  {
    name: 'noGpu8GB',
    summary: { ...base(), ramBytes: 8 * GIB, freeRamBytes: 5 * GIB },
  },
  {
    name: 'nvidia8GB',
    summary: {
      ...base(),
      gpu: {
        vendor: 'nvidia',
        model: 'test-geforce',
        vramBytes: 8 * GIB,
        backend: 'cuda',
        reason: 'test: usable through CUDA',
      },
    },
  },
  {
    name: 'oldDriver',
    summary: {
      ...base(),
      gpu: {
        vendor: 'nvidia',
        backend: 'cpu',
        reason: 'test: NVIDIA card without a driver',
      },
    },
  },
  {
    // Hypothetical future: probes report AMD as CPU-only today (VRAM
    // unreadable), but the recommender already speaks the class.
    name: 'amdRocm',
    summary: {
      ...base(),
      gpu: {
        vendor: 'amd',
        model: 'test-radeon',
        vramBytes: 16 * GIB,
        backend: 'rocm',
        reason: 'test: usable through ROCm',
      },
    },
  },
  {
    name: 'appleSilicon',
    summary: {
      ...base(),
      os: 'darwin',
      arch: 'arm64',
      cpu: { model: 'Apple test', cores: 8, features: ['neon'] },
      gpu: {
        vendor: 'apple',
        model: 'Apple silicon',
        vramBytes: 16 * GIB,
        backend: 'metal',
        reason: 'test: unified memory',
      },
    },
  },
  {
    name: 'tooSmall',
    summary: { ...base(), ramBytes: 4 * GIB, freeRamBytes: 1 * GIB, diskFreeBytes: 1 * GIB },
  },
]

export function descriptorByName(name: string): HardwareSummary {
  const found = JUDGE_HARDWARE_DESCRIPTORS.find((descriptor) => descriptor.name === name)
  if (found === undefined) throw new Error(`unknown hardware descriptor: ${name}`)
  return found.summary
}
