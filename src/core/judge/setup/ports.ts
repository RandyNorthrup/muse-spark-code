// M125 lane W (D107 §8.1): the setup kit the CLI text steps and the
// wizard's host controller share: the ports, their production
// implementation over H's modules, and the shared formatting (bytes
// and the scan's plain-words lines). Paths stay parameters, so the
// agent's data folder and the window's storage root both fit.
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  HTTP_STATUS,
  ISO_DATE_LENGTH,
  JUDGE_SETUP_VERSION_POLL_MS,
  JUDGE_SETUP_VERSION_TIMEOUT_MS,
  UI_TEXT,
} from '../../../shared/constants'
import { fill, formatNumber, numberFormat, plural } from '../../../shared/l10n/text'
import type { HardwareScanOptions } from '../hardware/scan'
import { scanHardware } from '../hardware/scan'
import type { HardwareSummary } from '../hardware/types'
import { fetchBlob } from './fetch'
import type { JudgeSetupFlowPorts } from './flow'
import { readJudgeRegistration, writeJudgeRegistration, type JudgeSetupRecord } from './register'
import { removeJudgeInstall, type JudgeInstallPaths, type RemoveResult } from './remove'
import { loadJudgeModelsTable, type JudgeModelsLoad } from './table'
import { acquireRuntimeLock, findFreePort, startRuntime } from './runtime'

export interface JudgeSetupPaths {
  readonly storageRoot: string
  readonly tableFile: string
}

export interface JudgeSetupPorts {
  readonly scan: (options: HardwareScanOptions) => Promise<HardwareSummary>
  readonly loadTable: (file: string, today: string) => JudgeModelsLoad
  readonly flow: JudgeSetupFlowPorts
  readonly readRegistration: (file: string) => JudgeSetupRecord | undefined
  readonly removeInstall: (paths: JudgeInstallPaths) => Promise<RemoveResult>
  readonly today: () => string
  readonly nowIso: () => string
}

const BYTES_PER_KB = 1000
const BYTES_FRACTION_DIGITS = 1

/** Bytes in the display language: B, MB or GB by size, one fraction digit. */
export function formatSetupBytes(bytes: number): string {
  if (bytes < BYTES_PER_KB) return `${formatNumber(bytes)} B`
  const mb = bytes / (BYTES_PER_KB * BYTES_PER_KB)
  if (mb < BYTES_PER_KB) {
    return numberFormat('judge:setup-megabyte', {
      style: 'unit',
      unit: 'megabyte',
      unitDisplay: 'short',
      maximumFractionDigits: BYTES_FRACTION_DIGITS,
    }).format(mb)
  }
  return numberFormat('judge:setup-gigabyte', {
    style: 'unit',
    unit: 'gigabyte',
    unitDisplay: 'short',
    maximumFractionDigits: BYTES_FRACTION_DIGITS,
  }).format(mb / BYTES_PER_KB)
}

/** The scan step's plain-words lines, most important first. */
export function scanSummaryLines(summary: HardwareSummary): string[] {
  const text = UI_TEXT.judgeSetupCli
  return [
    fill(text.scanOs, { os: summary.os, arch: summary.arch, version: summary.osVersion }),
    fill(text.scanRam, {
      total: formatSetupBytes(summary.ramBytes),
      free: formatSetupBytes(summary.freeRamBytes),
    }),
    fill(text.scanCpu, {
      model: summary.cpu.model,
      cores: plural(text.scanCores, summary.cpu.cores),
      features:
        summary.cpu.features.length > 0 ? summary.cpu.features.join(', ') : text.unknownValue,
    }),
    fill(text.scanGpu, {
      vendor: summary.gpu.vendor,
      backend: summary.gpu.backend,
      reason: summary.gpu.reason,
    }),
    summary.diskFreeBytes === undefined
      ? fill(text.scanDiskUnknown, { path: summary.installPath })
      : fill(text.scanDiskFree, {
          free: formatSetupBytes(summary.diskFreeBytes),
          path: summary.installPath,
        }),
    summary.ollama.installed
      ? fill(text.scanOllama, {
          version: summary.ollama.version ?? text.unknownValue,
          path: summary.ollama.path ?? text.unknownValue,
          state: summary.ollama.running ? text.ollamaRunning : text.ollamaStopped,
        })
      : text.scanOllamaAbsent,
  ]
}

async function canReachVersion(port: number, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + JUDGE_SETUP_VERSION_TIMEOUT_MS
  for (;;) {
    if (signal.aborted) return false
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/api/version`, { signal })
      if (response.status === HTTP_STATUS.ok) return true
    } catch (error: unknown) {
      // NARROW: refused or aborted while starting; anything else is not ours.
      if (error instanceof TypeError) {
        // The server is not up yet; fall through to the wait below.
      } else if (error instanceof DOMException) {
        return false
      } else {
        throw error
      }
    }
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, JUDGE_SETUP_VERSION_POLL_MS))
  }
}

async function fetchText(url: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal })
    return response.ok ? await response.text() : undefined
  } catch (error: unknown) {
    // NARROW: refused or aborted reads as missing; anything else is not ours.
    if (error instanceof TypeError) {
      return undefined
    }
    if (error instanceof DOMException) {
      return undefined
    }
    throw error
  }
}

const BLOB_FILE_PREFIX = 'sha256-'

async function presentSizes(dir: string): Promise<ReadonlyMap<string, number>> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    // NARROW: no blobs yet reads as none present; anything else is not ours.
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return new Map()
    }
    throw error
  }
  const sizes = new Map<string, number>()
  for (const name of names) {
    if (!name.startsWith(BLOB_FILE_PREFIX)) continue
    try {
      const sized = await stat(path.join(dir, name))
      sizes.set(name.slice(BLOB_FILE_PREFIX.length), sized.size)
    } catch (error: unknown) {
      // NARROW: a blob vanishing mid-listing reads as absent; anything else is not ours.
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
  }
  return sizes
}

/** The production ports: H's modules, the loopback waiter and the loud asker gap. */
export function productionSetupPorts(): JudgeSetupPorts {
  const flow: JudgeSetupFlowPorts = {
    fetchText,
    fetchBlob: (url, file, digest, totalBytes, signal) =>
      fetchBlob(url, file, digest, totalBytes, { signal }),
    presentSizes,
    mkdir: async (dir) => {
      await mkdir(dir, { recursive: true })
    },
    writeFile: async (file, bytes) => {
      await writeFile(file, bytes)
    },
    readFile: async (file) => {
      try {
        return await readFile(file)
      } catch (error: unknown) {
        // NARROW: a missing file reads as missing; anything else is not ours.
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
        throw error
      }
    },
    findFreePort,
    runtimeFree: async (lockPath) => {
      const lock = await acquireRuntimeLock(lockPath)
      if (lock === undefined) return false
      await lock.release()
      return true
    },
    startRuntime: (binary, port, modelsDir) => startRuntime(binary, port, modelsDir),
    waitForVersion: canReachVersion,
    readRegistration: readJudgeRegistration,
    writeRegistration: writeJudgeRegistration,
    askSmoke: () => Promise.reject(new Error('judge smoke asker wire uncaptured')),
  }
  return {
    scan: scanHardware,
    loadTable: loadJudgeModelsTable,
    flow,
    readRegistration: readJudgeRegistration,
    removeInstall: removeJudgeInstall,
    today: () => new Date().toISOString().slice(0, ISO_DATE_LENGTH),
    nowIso: () => new Date().toISOString(),
  }
}
