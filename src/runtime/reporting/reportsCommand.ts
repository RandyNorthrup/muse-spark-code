import type * as z from 'zod/mini'
import type { UiText } from '../../shared/l10n/en'
import {
  REPORT_EXIT_CODES,
  REPORT_KINDS,
  type REPORT_FAIL_ON,
  type REPORT_FORMATS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  reportDiffSchema,
  reportOptionsSchema,
  type ReportDocument,
  type ReportOptions,
  type ReportTheme,
} from '../../shared/reportSchema'
import { reportHistoryEntrySchema, reportsMethods } from '../../shared/hostApi/reports'
import { verifyReport } from '../../core/reporting/render/canonical'
import { createReportRenderers } from '../../core/reporting/render'
import { printable, type ReportLocalePort } from '../../core/reporting/render/display'
import { reportScrubber, type ReportRedaction } from '../../core/reporting/render/redaction'
import { parseReportsArguments, reportsUsage, type ReportsRequest } from './reportsArgs'

type Format = (typeof REPORT_FORMATS)[number]
type Condition = (typeof REPORT_FAIL_ON)[number]
type HistoryEntry = z.infer<typeof reportHistoryEntrySchema>
type ReportDiff = z.infer<typeof reportDiffSchema>

function newestFirst(a: HistoryEntry, b: HistoryEntry): number {
  // Stable sort retains the port's newest-saved-first sequence for equal timestamps.
  return Date.parse(b.header.asOf) - Date.parse(a.header.asOf)
}

async function historyEntries(
  history: NonNullable<ReportsServices['history']>,
  kind: ReportOptions['kind'],
  deps: ReportsCommandDeps,
) {
  const result = reportsMethods['reports/history'].result.parse({
    status: 'listed',
    entries: await history.list(kind),
  })
  if (result.status !== 'listed' || result.entries.some((entry) => entry.header.kind !== kind))
    throw new Error(deps.text.reportUi.generationFailed)
  return result.entries
}

/** K/S and H supply these ports at integration; absence is an explicit error. */
export interface ReportsServices {
  readonly generate?: (
    options: ReportOptions,
    signal?: AbortSignal,
  ) => Promise<
    | { readonly status: 'generated'; readonly document: ReportDocument }
    | { readonly status: 'notFound'; readonly id: string; readonly nearest: readonly string[] }
  >
  readonly history?: {
    /** Newest saved first; array order carries the saved sequence for equal asOf stamps. */
    list(kind: ReportOptions['kind']): Promise<readonly HistoryEntry[]>
    get(kind: ReportOptions['kind'], id: string): Promise<ReportDocument>
    save(document: ReportDocument): Promise<void>
  }
  /** K evaluates semantic facts, never translated strings or substring guesses. */
  readonly conditions?: (document: ReportDocument) => readonly Condition[]
  readonly compare?: (before: ReportDocument, after: ReportDocument) => ReportDiff
  readonly renderDiff?: (
    diff: ReportDiff,
    format: Format,
    locale: string,
    theme: ReportTheme,
  ) => string
}

export interface ReportsCommandDeps {
  readonly text: Pick<UiText, 'reportUi' | 'reportCliUsage'>
  readonly services: ReportsServices
  readonly now: () => string
  readonly locale: string
  readonly theme: ReportTheme
  readonly localePort: ReportLocalePort
  readonly redaction?: ReportRedaction
  readonly keepHistory: boolean
  readonly readSaved: (file: string) => Promise<unknown>
  readonly writeOut: (file: string, text: string) => Promise<void>
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  readonly signal?: AbortSignal
}

function checkCancelled(deps: ReportsCommandDeps): void {
  deps.signal?.throwIfAborted()
}

function checkedSaved(value: unknown, request: ReportsRequest, deps: ReportsCommandDeps) {
  const document = verifyReport(value, deps.redaction)
  if (request.kind !== undefined && document.header.kind !== request.kind)
    throw new Error(deps.text.reportUi.generationFailed)
  return document
}

async function listHistory(request: ReportsRequest, deps: ReportsCommandDeps): Promise<string> {
  const history = deps.services.history
  if (history === undefined) throw new Error(deps.text.reportUi.generationFailed)
  const entries: HistoryEntry[] = []
  const kinds = request.kind === undefined ? REPORT_KINDS : [request.kind]
  for (const kind of kinds) {
    checkCancelled(deps)
    const listed = await historyEntries(history, kind, deps)
    for (const value of listed) {
      const entry = reportHistoryEntrySchema.parse(value)
      if (entry.header.kind !== kind) throw new Error(deps.text.reportUi.generationFailed)
      entries.push(entry)
    }
  }
  const scrub = reportScrubber(deps.redaction)
  const rows = entries.toSorted(newestFirst).map((entry) => ({
    id: scrub(entry.id),
    kind: entry.header.kind,
    asOf: entry.header.asOf,
    scope: scrub(entry.header.scope),
  }))
  if (request.format === 'json') return `${JSON.stringify(rows, undefined, 2)}\n`
  const text =
    rows.length === 0
      ? deps.text.reportUi.noHistory
      : rows.map((row) => `${row.kind} ${row.id} ${row.asOf} ${row.scope}`).join('\n')
  const clean = printable(scrub(text))
  return `${request.format === 'md' ? clean.replaceAll(/[\\`*_{}[\]()#!|<>~&]/g, (char) => `&#${String(char.codePointAt(0))};`) : clean}\n`
}

async function comparison(
  request: ReportsRequest,
  document: ReportDocument,
  locale: string,
  deps: ReportsCommandDeps,
): Promise<string> {
  const { history, compare, renderDiff } = deps.services
  if (compare === undefined || renderDiff === undefined)
    throw new Error(deps.text.reportUi.generationFailed)
  let before: ReportDocument
  if (request.diff === 'previous') {
    if (history === undefined) throw new Error(deps.text.reportUi.generationFailed)
    const listed = await historyEntries(history, document.header.kind, deps)
    const entries = listed
      .filter(
        (entry) =>
          entry.header.kind === document.header.kind &&
          entry.header.scope === document.header.scope &&
          Date.parse(entry.header.asOf) <= Date.parse(document.header.asOf),
      )
      .toSorted(newestFirst)
    const entry = entries[0]
    if (entry === undefined) throw new Error(deps.text.reportUi.noHistory)
    before = checkedSaved(await history.get(document.header.kind, entry.id), request, deps)
  } else {
    if (request.diff === undefined) throw new Error(deps.text.reportUi.generationFailed)
    before = checkedSaved(await deps.readSaved(request.diff), request, deps)
  }
  if (before.header.kind !== document.header.kind || before.header.scope !== document.header.scope)
    throw new Error(deps.text.reportUi.generationFailed)
  const diff = reportDiffSchema.parse(compare(before, document))
  if (
    diff.from.contentHash !== before.header.contentHash ||
    diff.to.contentHash !== document.header.contentHash
  )
    throw new Error(deps.text.reportUi.generationFailed)
  return renderDiff(diff, request.format, locale, deps.theme)
}

/** stdout contains only the exact rendered artifact; diagnostics are fixed, localized words. */
export async function runReportsCommand(
  argv: readonly string[],
  deps: ReportsCommandDeps,
): Promise<number> {
  let request: ReportsRequest
  try {
    if (argv.includes('--help') || argv.includes('-h')) {
      deps.stdout(reportsUsage(deps.text))
      return REPORT_EXIT_CODES.generated
    }
    request = parseReportsArguments(argv)
  } catch {
    deps.stderr(reportsUsage(deps.text))
    return REPORT_EXIT_CODES.usage
  }
  let output: string
  let code: number = REPORT_EXIT_CODES.generated
  let document: ReportDocument | undefined
  try {
    checkCancelled(deps)
    const locale = request.locale ?? deps.locale
    if (request.history) {
      output = await listHistory(request, deps)
    } else {
      if (request.from === undefined) {
        const kind = request.kind
        const generate = deps.services.generate
        if (kind === undefined || generate === undefined) {
          deps.stderr(
            kind === undefined
              ? deps.text.reportUi.generationFailed
              : fill(deps.text.reportUi.unsupportedKind, { kind }),
          )
          return REPORT_EXIT_CODES.failed
        }
        const options = reportOptionsSchema.parse({
          ...request.options,
          kind,
          asOf: request.asOf ?? deps.now(),
        })
        const result = await generate(options, deps.signal)
        checkCancelled(deps)
        if (result.status === 'notFound') {
          deps.stderr(
            reportScrubber(deps.redaction)(
              fill(deps.text.reportUi.notFound, {
                id: result.id,
                nearest: result.nearest.join(', '),
              }),
            ),
          )
          return REPORT_EXIT_CODES.notFound
        }
        document = checkedSaved(result.document, request, deps)
        if (document.header.scope !== options.scope || document.header.asOf !== options.asOf)
          throw new Error(deps.text.reportUi.generationFailed)
      } else {
        document = checkedSaved(await deps.readSaved(request.from), request, deps)
      }
      checkCancelled(deps)
      output =
        request.diff === undefined
          ? createReportRenderers(deps.localePort, deps.redaction)[request.format](
              document,
              locale,
              deps.theme,
            )
          : await comparison(request, document, locale, deps)
      const failOn = request.options.failOn
      if (failOn.length > 0) {
        const conditions = deps.services.conditions
        if (conditions === undefined && failOn.some((condition) => condition !== 'unavailable'))
          throw new Error(deps.text.reportUi.generationFailed)
        const held = new Set(conditions?.(document))
        if (document.sources.some((source) => source.status === 'unavailable'))
          held.add('unavailable')
        if (failOn.some((condition) => held.has(condition))) code = REPORT_EXIT_CODES.conditionHeld
      }
      checkCancelled(deps)
      if ((deps.keepHistory && request.from === undefined) || request.save) {
        if (deps.services.history === undefined) throw new Error(deps.text.reportUi.saveFailed)
        await deps.services.history.save(document)
      }
    }
    checkCancelled(deps)
  } catch {
    deps.stderr(deps.text.reportUi.generationFailed)
    return REPORT_EXIT_CODES.failed
  }
  try {
    if (request.out === undefined) deps.stdout(output)
    else await deps.writeOut(request.out, output)
    return code
  } catch {
    deps.stderr(
      request.out === undefined
        ? deps.text.reportUi.generationFailed
        : deps.text.reportUi.saveFailed,
    )
    return REPORT_EXIT_CODES.failed
  }
}
