// M125 lane H (D107 §8.1): the hardware scan. Local only: no network
// call, no file written. It reads the OS and architecture, RAM, the
// GPU's vendor and usable backend, CPU features, free disk where the
// judge would be installed, and any existing Ollama — plus the
// micro-benchmark when asked. Unknown readings stay unknown with
// their reasons; the summary never guesses.
import * as os from 'node:os'
import { runCpuBenchmark } from './benchmark'
import { probeCpu, probeDiskFree, probeGpu, probeOllama } from './probes'
import type { HardwareSummary } from './types'

export interface HardwareScanOptions {
  /** Where the judge would be installed; free space is its volume's. */
  readonly installPath: string
  /** Also run the micro-benchmark within its budget. */
  readonly runBenchmark?: boolean | undefined
  /** The benchmark's deadline; the scan budget by default. */
  readonly benchmarkMs?: number | undefined
}

export async function scanHardware(options: HardwareScanOptions): Promise<HardwareSummary> {
  const diskFreeBytes = probeDiskFree(options.installPath)
  const [cpu, gpu, ollama] = await Promise.all([probeCpu(), probeGpu(), probeOllama()])
  return {
    os: process.platform,
    arch: process.arch,
    osVersion: os.version(),
    ramBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    cpu: { model: cpu.model, cores: cpu.cores, features: cpu.features },
    gpu,
    ...(diskFreeBytes !== undefined && { diskFreeBytes }),
    installPath: options.installPath,
    ollama,
    ...(options.runBenchmark === true && { benchmark: await runCpuBenchmark(options.benchmarkMs) }),
  }
}
