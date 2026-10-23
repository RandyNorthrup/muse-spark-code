// Reading the machine's model hardware (M110g lane L, D90.7): what the
// node runs its sidecars on. The readings are honest platform facts (no
// spawn, no guesses); the classification maps them to the recipe to run.
// Apple Silicon, NVIDIA through CDI and AMD through ROCm each get their
// own answer, and anything else runs on the CPU.
import { statSync } from 'node:fs'
import { arch, platform } from 'node:os'
import * as z from 'zod/mini'

export const hardwareReadingsSchema = z.strictObject({
  platform: z.string().check(z.minLength(1)),
  arch: z.string().check(z.minLength(1)),
  nvidiaPresent: z.boolean(),
  rocmPresent: z.boolean(),
})
export type HardwareReadings = z.infer<typeof hardwareReadingsSchema>

function isPresent(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false }) !== undefined
}

/** The machine's own facts: platform, architecture and GPU devices. */
export function readLocalHardware(): HardwareReadings {
  return hardwareReadingsSchema.parse({
    platform: platform(),
    arch: arch(),
    nvidiaPresent: isPresent('/dev/nvidia0') || isPresent('/dev/nvidiactl'),
    rocmPresent: isPresent('/dev/kfd') && isPresent('/dev/dri'),
  })
}

export const modelBackendSchema = z.enum(['apple', 'cuda', 'rocm', 'cpu'])
export type ModelBackend = z.infer<typeof modelBackendSchema>

export interface BackendVerdict {
  readonly backend: ModelBackend
  readonly reason: string
}

/* The sidecar recipe this machine runs, with its reason. */
export function classifyHardware(readings: HardwareReadings): BackendVerdict {
  const parsed = hardwareReadingsSchema.parse(readings)
  if (parsed.platform === 'darwin' && parsed.arch === 'arm64')
    return { backend: 'apple', reason: 'Apple Silicon runs the native sidecar' }
  if (parsed.nvidiaPresent) return { backend: 'cuda', reason: 'an NVIDIA device is present' }
  return parsed.rocmPresent
    ? { backend: 'rocm', reason: 'a ROCm device is present' }
    : { backend: 'cpu', reason: 'no GPU device found, the CPU serves' }
}
