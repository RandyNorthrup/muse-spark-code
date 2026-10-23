// M125 lane H (D107 §8.1 step 2): the setup recommender. Pure: a
// hardware summary and the judged-models table in, the pick with its
// plain-words reasons out. A row contends only with verified-path
// latency on this machine's backend and platform, a digest, room in
// memory with headroom to spare and room on disk. The most accurate
// contends first, a tie going to the faster; a speed-only row is the
// pick only when no full row fits. The classes named are exactly
// those eligible admits, class by class — never a blanket claim.
import { UI_TEXT, JUDGE_MEMORY_HEADROOM_GIB } from '../../../shared/constants'
import { fill, formatList, numberFormat } from '../../../shared/l10n/text'
import { eligible, FAST_TIMING_CLASSES, type FastTimingClass } from '../fast/classes'
import type { HardwareSummary, JudgeGpuBackend } from '../hardware/types'
import type { JudgeModelRow, JudgeModelsTable } from '../../../shared/judgeModels/schema'

const BYTES_PER_GB = 1_000_000_000
const BYTES_PER_KIB = 1024
const KIB_PER_MIB = 1024
const MIB_PER_GIB = 1024
const BYTES_PER_GIB = BYTES_PER_KIB * KIB_PER_MIB * MIB_PER_GIB
const MS_PER_SECOND = 1000
const LATENCY_FRACTION_DIGITS = 2

function formatModelSize(bytes: number): string {
  return numberFormat('judge:gigabyte', {
    style: 'unit',
    unit: 'gigabyte',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(bytes / BYTES_PER_GB)
}

function formatLatency(p95Ms: number): string {
  return numberFormat('judge:latency-second', {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: LATENCY_FRACTION_DIGITS,
  }).format(p95Ms / MS_PER_SECOND)
}

export interface RecommendOptions {
  /** Judge CPU-only options even with a usable GPU. */
  readonly cpuOnly?: boolean
}

export interface JudgeRecommendation {
  /** The pick, when one row contends; absent fits nothing. */
  readonly model?: string | undefined
  readonly digest?: string | undefined
  readonly backend: JudgeGpuBackend
  /** The pick's verified-path p95, the worst measured. */
  readonly p95Ms?: number | undefined
  /** Exactly the classes eligible admits for the pick. */
  readonly classes: readonly FastTimingClass[]
  readonly servesSpeedOnly: boolean
  /** Every fitting model, most accurate first. */
  readonly fitting: readonly string[]
  readonly reasons: readonly string[]
}

interface Contender {
  readonly row: JudgeModelRow
  readonly p95Ms: number
}

function verifiedP95(
  row: JudgeModelRow,
  backend: JudgeGpuBackend,
  platform: NodeJS.Platform,
): number | undefined {
  let worst: number | undefined
  for (const latency of row.latency) {
    if (
      latency.backend !== backend ||
      latency.platform !== platform ||
      latency.path !== 'verified'
    ) {
      continue
    }
    if (worst === undefined || latency.p95Ms > worst) worst = latency.p95Ms
  }
  return worst
}

function accuracyOf(row: JudgeModelRow): number {
  return row.accuracy === undefined ? 0 : row.accuracy.correct / row.accuracy.total
}

function compareContenders(left: Contender, right: Contender): number {
  const accuracy = accuracyOf(right.row) - accuracyOf(left.row)
  if (accuracy !== 0) return accuracy > 0 ? 1 : -1
  if (left.p95Ms === right.p95Ms) return left.row.model < right.row.model ? -1 : 1
  return left.p95Ms < right.p95Ms ? -1 : 1
}

const CLASS_NAME_KEYS = {
  I: 'classInline',
  S: 'classSlack',
  B: 'classBoundary',
  P: 'classPost',
} as const

/** The timing class's display name; the Done step reuses it for its rows. */
export function className(timingClass: FastTimingClass): string {
  return UI_TEXT.judgeRecommend[CLASS_NAME_KEYS[timingClass]]
}

export function recommendJudgeModel(
  summary: HardwareSummary,
  table: Pick<JudgeModelsTable, 'rows'>,
  options: RecommendOptions = {},
): JudgeRecommendation {
  const backend: JudgeGpuBackend = options.cpuOnly === true ? 'cpu' : summary.gpu.backend
  const headroomBytes = JUDGE_MEMORY_HEADROOM_GIB * BYTES_PER_GIB
  const names = UI_TEXT.judgeRecommend
  const reasons: string[] = []
  if (summary.gpu.backend === 'cpu') reasons.push(names.cpuOnly)
  const isInstallable = (row: JudgeModelRow): boolean => {
    if (row.digest === undefined) return false
    const resident = backend === 'cpu' ? row.residentBytesCpu : row.residentBytesGpu
    return (
      resident !== undefined &&
      resident + headroomBytes <= summary.ramBytes &&
      summary.diskFreeBytes !== undefined &&
      row.downloadBytes <= summary.diskFreeBytes
    )
  }
  let hasVerified = false
  let isBlockedByCalibration = false
  const contenders: Contender[] = []
  for (const row of table.rows) {
    const p95Ms = verifiedP95(row, backend, summary.os)
    if (p95Ms === undefined) continue
    hasVerified = true
    if (!isInstallable(row) || !eligible('S', p95Ms, 'real')) continue
    if (row.requiresCalibration === true && row.profiledFamilies.length === 0) {
      isBlockedByCalibration = true
      continue
    }
    contenders.push({ row, p95Ms })
  }
  if (!hasVerified) {
    reasons.push(names.noneUnmeasured)
    return { backend, classes: [], servesSpeedOnly: false, fitting: [], reasons }
  }
  if (contenders.length === 0) {
    reasons.push(isBlockedByCalibration ? names.noneUncalibrated : names.noneUnfit)
    return { backend, classes: [], servesSpeedOnly: false, fitting: [], reasons }
  }
  const ordered = contenders.toSorted(compareContenders)
  const fitting = ordered.map((contender) => contender.row.model)
  const full = ordered.filter((contender) => contender.row.speedOnly !== true)
  const pick = (full.length > 0 ? full : ordered)[0]
  if (pick === undefined) {
    reasons.push(names.noneUnfit)
    return { backend, classes: [], servesSpeedOnly: false, fitting: [], reasons }
  }
  const classes = FAST_TIMING_CLASSES.filter((timingClass) =>
    eligible(timingClass, pick.p95Ms, 'real'),
  )
  reasons.push(
    fill(names.pick, { model: pick.row.model, size: formatModelSize(pick.row.downloadBytes) }),
    backend === 'cpu' ? names.fitCpu : names.fitGpu,
    fill(names.latency, { latency: formatLatency(pick.p95Ms) }),
    fill(names.classesOn, {
      classes: formatList(classes.map((timingClass) => className(timingClass))),
    }),
  )
  const off = FAST_TIMING_CLASSES.filter((timingClass) => !classes.includes(timingClass))
  if (off.length > 0) {
    reasons.push(
      fill(names.classesOff, {
        classes: formatList(off.map((timingClass) => className(timingClass))),
      }),
    )
  }
  if (pick.row.speedOnly === true) reasons.push(names.lowerQuality)
  reasons.push(
    pick.row.profiledFamilies.length > 0
      ? fill(names.calibrated, { families: formatList(pick.row.profiledFamilies) })
      : names.uncalibrated,
  )
  return {
    model: pick.row.model,
    digest: pick.row.digest,
    backend,
    p95Ms: pick.p95Ms,
    classes,
    servesSpeedOnly: pick.row.speedOnly === true,
    fitting,
    reasons,
  }
}
