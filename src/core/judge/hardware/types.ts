// M125 lane H (D107): the hardware scan's shapes. The summary carries
// measurements only — capacities, versions, digests — never content,
// serial numbers or account names. Every "no" carries its reason.
export type JudgeGpuVendor = 'nvidia' | 'amd' | 'intel' | 'apple' | 'unknown' | 'none'

/** The backend the pinned Ollama can use on this GPU, or CPU only. */
export type JudgeGpuBackend = 'cuda' | 'rocm' | 'metal' | 'cpu'

export interface JudgeGpuInfo {
  readonly vendor: JudgeGpuVendor
  /** The card's own name when a probe reported one. */
  readonly model?: string | undefined
  /** Usable VRAM in bytes, when a probe measured it. */
  readonly vramBytes?: number | undefined
  readonly backend: JudgeGpuBackend
  /** Why this backend (or why no better one was proven). */
  readonly reason: string
}

export interface JudgeCpuInfo {
  readonly model: string
  readonly cores: number
  /** Probed instruction features: AVX2/AVX-512 on x86-64, NEON on ARM64. */
  readonly features: readonly string[]
}

export interface JudgeOllamaModel {
  readonly name: string
  readonly digest: string
}

export interface JudgeOllamaInfo {
  readonly installed: boolean
  /** The binary's path, when found. */
  readonly path?: string | undefined
  readonly version?: string | undefined
  readonly running: boolean
  /** Models the running server reports, when it answers. */
  readonly models?: readonly JudgeOllamaModel[] | undefined
}

export interface JudgeBenchmarkResult {
  /** Measured rate only: no verified-path mapping exists yet, so no class. */
  readonly kind: 'unmapped'
  readonly iterations: number
  readonly elapsedMs: number
  readonly ratePerSec: number
}

export interface HardwareSummary {
  readonly os: NodeJS.Platform
  readonly arch: NodeJS.Architecture
  readonly osVersion: string
  readonly ramBytes: number
  readonly freeRamBytes: number
  readonly cpu: JudgeCpuInfo
  readonly gpu: JudgeGpuInfo
  /** Free bytes on the install volume; absent when unreadable, never zero. */
  readonly diskFreeBytes?: number | undefined
  /** Where the install would go; the free space above is its volume's. */
  readonly installPath: string
  readonly ollama: JudgeOllamaInfo
  readonly benchmark?: JudgeBenchmarkResult | undefined
}
