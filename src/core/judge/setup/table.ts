// M125 lane H (D107): the judged-models table loader. The envelope
// must parse whole; rows validate individually, so one bad row never
// kills the table — each failure is reported with its reason instead.
// Synchronous: the host loads once at startup.
import { readFileSync } from 'node:fs'
import {
  judgeModelRowSchema,
  judgeModelsEnvelopeSchema,
  type JudgeModelRow,
  type JudgeModelsTable,
} from '../../../shared/judgeModels/schema'

export interface JudgeModelsLoad {
  readonly table: JudgeModelsTable | undefined
  readonly failures: Readonly<Record<string, string>>
}

function rowFailures(row: JudgeModelRow, today: string): string | undefined {
  if (row.checkDate > today) return 'future-date'
  if (row.accuracy !== undefined && row.accuracy.correct > row.accuracy.total) {
    return 'accuracy-overflow'
  }
  for (const latency of row.latency) {
    if (latency.p50Ms > latency.p95Ms) return 'p50-above-p95'
  }
  return undefined
}

/**
Load and validate the table. The file, its JSON and its envelope read
as one; every row then stands or fails on its own (source and date,
sane numbers, no future check). Unknown keys fail the row: the table
says exactly what the recommender proves.
*/
export function loadJudgeModelsTable(file: string, today: string): JudgeModelsLoad {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { table: undefined, failures: { [file]: 'missing-file' } }
    }
    throw new Error(`unreadable models table: ${file}`, { cause: error })
  }
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return { table: undefined, failures: { [file]: 'invalid-json' } }
  }
  const parsed = judgeModelsEnvelopeSchema.safeParse(input)
  if (!parsed.success) return { table: undefined, failures: { [file]: 'invalid-schema' } }
  const envelope = parsed.data
  if (envelope.checkedDate > today) {
    return { table: undefined, failures: { [file]: 'future-date' } }
  }
  const failures: Record<string, string> = {}
  const seen = new Set<string>()
  const rows: JudgeModelRow[] = []
  for (const candidate of envelope.rows) {
    const row = judgeModelRowSchema.safeParse(candidate)
    if (!row.success) {
      failures['<row>'] = 'invalid-row'
      continue
    }
    if (seen.has(row.data.model)) {
      failures[row.data.model] = 'duplicate-model'
      continue
    }
    seen.add(row.data.model)
    const reason = rowFailures(row.data, today)
    if (reason !== undefined) {
      failures[row.data.model] = reason
      continue
    }
    rows.push(row.data)
  }
  return {
    table: {
      version: envelope.version,
      checkedDate: envelope.checkedDate,
      runtime: envelope.runtime,
      rows,
    },
    failures,
  }
}
