/** A row of the Windows orphan table, retained for the existing tree kill. */
export interface ProcessRow {
  readonly pid: number
  readonly parent: number
  /** FILETIME ticks, exactly as the table printed them. */
  readonly ticks: string
  readonly createdAt: number
  readonly name: string
}

// A FILETIME counts 100 ns ticks from 1601-01-01 UTC: past 2^53, so a BigInt.
const FILETIME_TICKS_PER_MS = 10_000n
const FILETIME_UNIX_EPOCH_MS = 11_644_473_600_000n
const DECIMAL = /^\d+$/
/** The script's rows; a line that is not one (an error, a blank) is skipped. */
export function parseProcessTable(stdout: string): readonly ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const [pid = '', parent = '', ticks = '', ...name] = line.trim().split(' ')
    if ([pid, parent, ticks].some((field) => !DECIMAL.test(field))) {
      continue
    }
    const createdAt = Number(BigInt(ticks) / FILETIME_TICKS_PER_MS - FILETIME_UNIX_EPOCH_MS)
    if (
      !Number.isSafeInteger(Number(pid)) ||
      Number(pid) <= 0 ||
      !Number.isSafeInteger(Number(parent)) ||
      !Number.isSafeInteger(createdAt)
    )
      continue
    rows.push({
      pid: Number(pid),
      parent: Number(parent),
      ticks,
      createdAt,
      name: name.join(' '),
    })
  }
  return rows
}
