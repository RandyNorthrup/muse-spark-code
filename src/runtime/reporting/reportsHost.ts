import { reportsMethods, type ReportsHostPort } from '../../shared/hostApi/reports'
import { fill } from '../../shared/l10n/text'
import { verifyReport } from '../../core/reporting/render/canonical'
import { createReportRenderers } from '../../core/reporting/render'
import { reportScrubber, scrubFields } from '../../core/reporting/render/redaction'
import type { ReportsCommandDeps } from './reportsCommand'

/** MHP/companion/TUI/desktop call this same scoped facade after their transport negotiation. */
export function createReportsHost(
  deps: ReportsCommandDeps & {
    readonly workspaceKey: string
    readonly authorize: (workspaceKey: string) => Promise<boolean>
    readonly open: (text: string, format: 'md' | 'html' | 'json' | 'text') => Promise<void>
  },
): ReportsHostPort {
  const failed = (error: unknown) => {
    if (deps.signal?.aborted)
      return { status: 'failed' as const, reason: deps.text.reportUi.generationFailed }
    const reason =
      error instanceof Error && error.message !== ''
        ? reportScrubber(deps.redaction)(error.message)
        : deps.text.reportUi.generationFailed
    return {
      status: 'failed' as const,
      reason:
        reason === deps.text.reportUi.generationFailed
          ? reason
          : fill(deps.text.reportUi.generationReason, { reason }),
    }
  }
  const redacted = (value: object) => {
    // Scrub decoded values, not serialized JSON: escaping introduces
    // backslashes that read as secret shapes around already-safe marks.
    const clean = structuredClone(value)
    scrubFields(clean, reportScrubber(deps.redaction))
    return JSON.stringify(clean) === JSON.stringify(value)
  }
  const authorized = async (key: string) => {
    deps.signal?.throwIfAborted()
    if (key !== deps.workspaceKey || !(await deps.authorize(key)))
      throw new Error('this report history belongs to another workspace')
    deps.signal?.throwIfAborted()
  }
  const saved = async (kind: Parameters<ReportsHostPort['get']>[0]['kind'], id: string) => {
    const history = deps.services.history
    if (history === undefined) throw new Error('report history is unavailable')
    const document = verifyReport(await history.get(kind, id), deps.redaction)
    if (document.header.kind !== kind) throw new Error('the saved report is not the requested kind')
    return document
  }
  return {
    capability: 'reports',
    async run(input) {
      try {
        const { workspaceKey, options } = reportsMethods['reports/run'].params.parse(input)
        await authorized(workspaceKey)
        const generate = deps.services.generate
        if (generate === undefined) return failed(new Error('report generation is unavailable'))
        const result = await generate(options, deps.signal)
        await authorized(workspaceKey)
        if (result.status !== 'generated')
          return failed(new Error(`the report scope was not found: ${result.id}`))
        const document = verifyReport(result.document, deps.redaction)
        if (
          document.header.kind !== options.kind ||
          document.header.scope !== reportScrubber(deps.redaction)(options.scope) ||
          document.header.asOf !== options.asOf
        )
          return failed(new Error('the generated report does not match the request'))
        if (deps.keepHistory) {
          if (deps.services.history === undefined)
            return failed(new Error('report history is unavailable'))
          await deps.services.history.save(document)
          await authorized(workspaceKey)
        }
        return reportsMethods['reports/run'].result.parse({ status: 'generated', document })
      } catch (error) {
        return failed(error)
      }
    },
    async history(input) {
      try {
        const { workspaceKey, kind } = reportsMethods['reports/history'].params.parse(input)
        await authorized(workspaceKey)
        const history = deps.services.history
        if (history === undefined) return failed(new Error('report history is unavailable'))
        const result = reportsMethods['reports/history'].result.parse({
          status: 'listed',
          entries: await history.list(kind),
        })
        if (
          result.status === 'listed' &&
          result.entries.some(
            ({ id, header: { contentHash: _contentHash, ...header } }) =>
              header.kind !== kind ||
              !redacted({ ...(!/^[a-f0-9]{64}$/.test(id) && { id }), header }),
          )
        )
          return failed(new Error('report history entries do not match the requested kind'))
        await authorized(workspaceKey)
        return result
      } catch (error) {
        return failed(error)
      }
    },
    async get(input) {
      try {
        const { workspaceKey, kind, id } = reportsMethods['reports/get'].params.parse(input)
        await authorized(workspaceKey)
        const document = await saved(kind, id)
        await authorized(workspaceKey)
        return reportsMethods['reports/get'].result.parse({ status: 'retrieved', document })
      } catch (error) {
        return failed(error)
      }
    },
    async compare(input) {
      try {
        const { workspaceKey, kind, fromId, toId } =
          reportsMethods['reports/compare'].params.parse(input)
        await authorized(workspaceKey)
        const compare = deps.services.compare
        if (compare === undefined) return failed(new Error('report comparison is unavailable'))
        const before = await saved(kind, fromId)
        await authorized(workspaceKey)
        const after = await saved(kind, toId)
        if (before.header.scope !== after.header.scope)
          return failed(new Error('the compared reports are from different scopes'))
        await authorized(workspaceKey)
        const result = reportsMethods['reports/compare'].result.parse({
          status: 'compared',
          diff: compare(before, after),
        })
        return result.status === 'compared' &&
          (JSON.stringify(result.diff.from) !== JSON.stringify(before.header) ||
            JSON.stringify(result.diff.to) !== JSON.stringify(after.header) ||
            !redacted(result.diff.sections))
          ? failed(new Error('the compared report changed during the comparison'))
          : result
      } catch (error) {
        return failed(error)
      }
    },
    async open(input) {
      try {
        const { document: value, format } = reportsMethods['reports/open'].params.parse(input)
        await authorized(deps.workspaceKey)
        const document = verifyReport(value, deps.redaction)
        const text = createReportRenderers(deps.localePort, deps.redaction)[format](
          document,
          deps.locale,
          deps.theme,
        )
        await authorized(deps.workspaceKey)
        await deps.open(text, format)
        return { status: 'opened' }
      } catch (error) {
        return failed(error)
      }
    },
  }
}
