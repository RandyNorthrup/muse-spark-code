import * as z from 'zod/mini'
import {
  CHECK_NAME_MAX_CHARS,
  REPORT_CHECK_RUNS_MAX,
  REPORT_MAX_ID_CHARS,
  REPORT_SOURCE_TIMEOUT_MS,
  UI_TEXT,
} from '../../shared/constants'
import { reportsMethods } from '../../shared/hostApi/reports'
import { type ReportStorage } from './history'
import type { CheckRunRecord, ReportSourcePort, SourceResult } from './sources/types'

const checkRunSchema = z.strictObject({
  check: z.string().check(z.minLength(1), z.maxLength(CHECK_NAME_MAX_CHARS)),
  outcome: z.enum(['passed', 'failed', 'cancelled', 'skipped']),
  durationMs: z.number().check(z.nonnegative()),
  commit: z
    .string()
    .check(z.maxLength(REPORT_MAX_ID_CHARS), z.regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)),
  at: z.iso.datetime({ offset: true }),
})

function parsedRuns(text: string, scrub: (text: string) => string) {
  const entries: CheckRunRecord[] = []
  let skipped = 0
  let end = text.endsWith('\n') ? text.length - 1 : text.length
  let lines = 0
  // Inspect at most the journal's bound, including malformed lines. A corrupt
  // file cannot make one source synchronously parse millions of tiny records.
  while (end > 0 && lines < REPORT_CHECK_RUNS_MAX) {
    const start = text.lastIndexOf('\n', end - 1)
    const line = text.slice(start + 1, end)
    end = start
    lines += 1
    try {
      const entry = checkRunSchema.parse(JSON.parse(line))
      entries.push(checkRunSchema.parse({ ...entry, check: scrub(entry.check) }))
    } catch {
      skipped += 1
    }
  }
  if (end > 0) skipped += 1
  return { entries: entries.toReversed(), skipped }
}

/** Scrub the name before persisting; never accept a command line, output or hook detail. */
export class CheckRunJournal {
  public constructor(
    private readonly deps: {
      readonly storage: ReportStorage
      readonly scrub: (text: string) => string
    },
  ) {}

  public async append(workspaceKey: string, input: CheckRunRecord): Promise<void> {
    reportsMethods['reports/history'].params.parse({ workspaceKey, kind: 'quality' })
    const entry = checkRunSchema.parse({
      check: this.deps.scrub(input.check),
      outcome: input.outcome,
      durationMs: input.durationMs,
      commit: input.commit,
      at: input.at,
    })
    await this.deps.storage.transaction(['checks'], true, async (files) => {
      const name = `${workspaceKey}.jsonl`
      const text = await files.read(name)
      const prior = parsedRuns(text ?? '', this.deps.scrub).entries
      const entries = [...prior, entry].slice(-REPORT_CHECK_RUNS_MAX)
      await files.write(name, entries.map((row) => JSON.stringify(row)).join('\n') + '\n')
    })
  }

  /** K reads this exact normalized source; absent/corrupt storage is honest about its evidence. */
  public source(): ReportSourcePort<'checkRuns'> {
    return {
      kind: 'checkRuns',
      id: 'checkRuns',
      read: async ({ asOf, workspaceKey, signal }) => {
        try {
          signal.throwIfAborted()
          reportsMethods['reports/history'].params.parse({ workspaceKey, kind: 'quality' })
          return await this.deps.storage.transaction(
            ['checks'],
            false,
            async (files): Promise<SourceResult<readonly CheckRunRecord[]>> => {
              const text = await files.read(`${workspaceKey}.jsonl`)
              signal.throwIfAborted()
              if (text === undefined) throw new Error(UI_TEXT.reportUi.generationFailed)
              const parsed = parsedRuns(text, this.deps.scrub)
              const observedAt = parsed.entries.at(-1)?.at ?? asOf
              const ageMs = Math.max(0, Date.parse(asOf) - Date.parse(observedAt))
              return {
                record: {
                  id: 'checkRuns',
                  ...(parsed.skipped === 0
                    ? { status: 'ok' as const, reason: null }
                    : { status: 'partial' as const, reason: UI_TEXT.reportUi.generationFailed }),
                  observedAt,
                  freshness: { state: ageMs > REPORT_SOURCE_TIMEOUT_MS ? 'stale' : 'fresh', ageMs },
                },
                data: parsed.entries,
              }
            },
          )
        } catch {
          return {
            record: {
              id: 'checkRuns',
              status: 'unavailable',
              reason: UI_TEXT.reportUi.generationFailed,
              observedAt: null,
              freshness: { state: 'unknown', ageMs: null },
            },
            data: null,
          }
        }
      },
    }
  }
}
