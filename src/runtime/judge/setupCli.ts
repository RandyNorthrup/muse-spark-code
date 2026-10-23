// M125 lane W (D107 §8.1): the `judge scan|setup|remove` text steps
// for the ACP agent and headless runs. Scan is read-only; setup and
// remove print their plan first and change nothing without --yes.
// Progress runs on stderr, results on stdout; failures name their
// phase and reason codes, never paths or payloads.
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  EXEC_EXIT,
  HTTP_STATUS,
  ISO_DATE_LENGTH,
  JUDGE_SETUP_VERSION_POLL_MS,
  JUDGE_SETUP_VERSION_TIMEOUT_MS,
  UI_TEXT,
} from '../../shared/constants'
import type { JudgeModelsLoad } from '../../core/judge/setup/table'
import { loadJudgeModelsTable } from '../../core/judge/setup/table'
import {
  acquireRuntimeLock,
  findFreePort,
  runtimePaths,
  startRuntime,
} from '../../core/judge/setup/runtime'
import { fetchBlob } from '../../core/judge/setup/fetch'
import {
  readJudgeRegistration,
  writeJudgeRegistration,
  type JudgeSetupRecord,
} from '../../core/judge/setup/register'
import { removeJudgeInstall, type JudgeInstallPaths } from '../../core/judge/setup/remove'
import {
  planJudgeSetup,
  runJudgeSetupFlow,
  type JudgeSetupFlowPorts,
  type JudgeSetupPlan,
} from '../../core/judge/setup/flow'
import { scanHardware, type HardwareScanOptions } from '../../core/judge/hardware/scan'
import type { HardwareSummary } from '../../core/judge/hardware/types'
import { fill, formatList, formatNumber, numberFormat, plural } from '../../shared/l10n/text'

export interface JudgeSetupTextIo {
  readonly stdout: { readonly write: (line: string) => void }
  readonly stderr: { readonly write: (line: string) => void }
}

export interface JudgeSetupCliPaths {
  readonly storageRoot: string
  readonly tableFile: string
}

export interface JudgeSetupCliPorts {
  readonly scan: (options: HardwareScanOptions) => Promise<HardwareSummary>
  readonly loadTable: (file: string, today: string) => JudgeModelsLoad
  readonly flow: JudgeSetupFlowPorts
  readonly readRegistration: (file: string) => JudgeSetupRecord | undefined
  readonly removeInstall: (
    paths: JudgeInstallPaths,
  ) => Promise<{ readonly removed: readonly string[] }>
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
export function productionSetupCliPorts(): JudgeSetupCliPorts {
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

export interface JudgeSetupFlags {
  readonly cpuOnly: boolean
  readonly model: string | undefined
  readonly yes: boolean
}

type ParsedFlags = { readonly ok: true; readonly flags: JudgeSetupFlags } | { readonly ok: false }

/** The surface's own flags; anything else is a usage error, never a guess. */
export function parseSetupFlags(argv: readonly string[]): ParsedFlags {
  let isCpuOnly = false
  let model: string | undefined
  let hasConsent = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--cpu-only' || arg === '--yes') {
      if (arg === '--cpu-only') isCpuOnly = true
      else hasConsent = true
      continue
    }
    if (arg !== '--model') return { ok: false }
    const value = argv[index + 1]
    if (value === undefined || value.trim() === '') return { ok: false }
    model = value
    index += 1
  }
  return { ok: true, flags: { cpuOnly: isCpuOnly, model, yes: hasConsent } }
}

function writeLines(
  io: { readonly write: (line: string) => void },
  lines: readonly string[],
): void {
  for (const line of lines) io.write(`${line}\n`)
}

function scanLines(summary: HardwareSummary): string[] {
  const text = UI_TEXT.judgeSetupCli
  const lines = [
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
  return lines
}

async function scanAndRecommend(
  flags: JudgeSetupFlags,
  ports: JudgeSetupCliPorts,
  paths: JudgeSetupCliPaths,
): Promise<
  | { readonly ok: true; readonly summary: HardwareSummary; readonly plan: JudgeSetupPlan }
  | { readonly ok: false; readonly summary: HardwareSummary; readonly reason: string }
> {
  const summary = await ports.scan({ installPath: paths.storageRoot })
  const loaded = ports.loadTable(paths.tableFile, ports.today())
  const settled = planJudgeSetup(summary, loaded.table, {
    ...(flags.model !== undefined && { model: flags.model }),
    ...(flags.cpuOnly && { cpuOnly: true }),
  })
  return settled.ok
    ? { ok: true, summary, plan: settled.plan }
    : { ok: false, summary, reason: settled.reason }
}

/** `judge scan`: the hardware and the recommendation, read-only. */
export async function runJudgeScan(
  io: JudgeSetupTextIo,
  args: readonly string[],
  ports: JudgeSetupCliPorts,
  paths: JudgeSetupCliPaths,
): Promise<number> {
  const text = UI_TEXT.judgeSetupCli
  const parsed = parseSetupFlags(args)
  if (!parsed.ok || parsed.flags.model !== undefined || parsed.flags.yes) {
    io.stderr.write(`${text.setupUsage}\n`)
    return EXEC_EXIT.usage
  }
  const settled = await scanAndRecommend(parsed.flags, ports, paths)
  writeLines(io.stdout, scanLines(settled.summary))
  if (!settled.ok) {
    // Nothing fits is a scanned answer, not a failure; anything else refuses.
    if (settled.reason === 'fits-nothing') {
      io.stdout.write(`${text.scanFitsNothing}\n`)
      return EXEC_EXIT.ok
    }
    io.stderr.write(`${fill(text.cannotSetup, { reason: settled.reason })}\n`)
    return EXEC_EXIT.failed
  }
  const { plan } = settled
  const p95 = plan.recommendation.p95Ms
  const lines = [
    fill(text.scanPick, {
      model: plan.row.model,
      digest: plan.row.digest,
      backend: plan.recommendation.backend,
      p95: p95 === undefined ? text.unknownValue : `${formatNumber(p95)} ms`,
    }),
  ]
  if (plan.recommendation.classes.length > 0) {
    lines.push(fill(text.scanClasses, { classes: plan.recommendation.classes.join(', ') }))
  }
  const others = plan.recommendation.fitting.filter((model) => model !== plan.row.model)
  if (others.length > 0) lines.push(fill(text.scanFitting, { models: formatList(others) }))
  for (const reason of plan.recommendation.reasons) lines.push(reason)
  writeLines(io.stdout, lines)
  return EXEC_EXIT.ok
}

function planLines(plan: JudgeSetupPlan, paths: JudgeSetupCliPaths): string[] {
  const text = UI_TEXT.judgeSetupCli
  const lines = [
    fill(text.planModel, { model: plan.row.model, digest: plan.row.digest }),
    fill(text.planSize, { bytes: formatSetupBytes(plan.row.downloadBytes) }),
  ]
  if (plan.licence !== undefined) {
    lines.push(
      plan.licence.url === undefined
        ? fill(text.planLicenceNoUrl, { name: plan.licence.name })
        : fill(text.planLicence, { name: plan.licence.name, url: plan.licence.url }),
    )
  }
  lines.push(
    plan.archive === undefined
      ? fill(text.planNoRuntime, {
          platform: plan.summary.os,
          backend: plan.recommendation.backend,
        })
      : fill(text.planRuntime, { version: plan.runtimeVersion, url: plan.archive.url }),
    fill(text.planPath, { path: paths.storageRoot }),
  )
  return lines
}

/** `judge setup`: the plan, then the install with --yes. */
export async function runJudgeSetup(
  io: JudgeSetupTextIo,
  args: readonly string[],
  ports: JudgeSetupCliPorts,
  paths: JudgeSetupCliPaths,
  signal: AbortSignal,
): Promise<number> {
  const text = UI_TEXT.judgeSetupCli
  const parsed = parseSetupFlags(args)
  if (!parsed.ok) {
    io.stderr.write(`${text.setupUsage}\n`)
    return EXEC_EXIT.usage
  }
  const settled = await scanAndRecommend(parsed.flags, ports, paths)
  if (!settled.ok) {
    io.stderr.write(`${fill(text.cannotSetup, { reason: settled.reason })}\n`)
    return EXEC_EXIT.failed
  }
  writeLines(io.stdout, planLines(settled.plan, paths))
  if (!parsed.flags.yes) {
    io.stdout.write(`${text.needsYes}\n`)
    return EXEC_EXIT.failed
  }
  const result = await runJudgeSetupFlow({
    plan: settled.plan,
    paths,
    ports: ports.flow,
    join: (...parts: string[]) => path.join(...parts),
    onProgress: (progress) => {
      io.stderr.write(
        `${fill(text.setupProgress, {
          phase: progress.phase,
          done: progress.doneBytes === undefined ? '?' : formatSetupBytes(progress.doneBytes),
          total: progress.totalBytes === undefined ? '?' : formatSetupBytes(progress.totalBytes),
        })}\n`,
      )
    },
    signal,
    nowIso: ports.nowIso,
  })
  if (!result.ok) {
    io.stderr.write(`${fill(text.setupFailed, { phase: result.phase, reason: result.reason })}\n`)
    return EXEC_EXIT.failed
  }
  io.stdout.write(
    `${fill(text.setupDone, { model: result.record.model, correct: result.verdict.correct, total: result.verdict.total })}\n`,
  )
  return EXEC_EXIT.ok
}

/** `judge remove`: what setup added, with --yes, nothing else. */
export async function runJudgeRemove(
  io: JudgeSetupTextIo,
  args: readonly string[],
  ports: JudgeSetupCliPorts,
  paths: JudgeSetupCliPaths,
): Promise<number> {
  const text = UI_TEXT.judgeSetupCli
  const parsed = parseSetupFlags(args)
  if (!parsed.ok || parsed.flags.model !== undefined || parsed.flags.cpuOnly) {
    io.stderr.write(`${text.setupUsage}\n`)
    return EXEC_EXIT.usage
  }
  const layout = runtimePaths(paths.storageRoot, 'current')
  const record = ports.readRegistration(layout.record)
  if (record === undefined) {
    io.stdout.write(`${text.removeNone}\n`)
    return EXEC_EXIT.ok
  }
  if (!parsed.flags.yes) {
    io.stdout.write(
      `${fill(text.removePlan, { model: record.model, path: path.dirname(record.runtimePath) })}\n`,
    )
    return EXEC_EXIT.failed
  }
  const removed = await ports.removeInstall({
    runtimeRoot: path.dirname(record.runtimePath),
    modelsDir: record.modelsDir,
    lock: layout.lock,
    record: layout.record,
  })
  io.stdout.write(`${fill(text.removeDone, { paths: formatList([...removed.removed]) })}\n`)
  return EXEC_EXIT.ok
}
