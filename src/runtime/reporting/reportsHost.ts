import { reportsMethods, type ReportsHostPort } from '../../shared/hostApi/reports'
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
  const failed = () => ({ status: 'failed' as const, reason: deps.text.reportUi.generationFailed })
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
      throw new Error(deps.text.reportUi.generationFailed)
    deps.signal?.throwIfAborted()
  }
  const saved = async (kind: Parameters<ReportsHostPort['get']>[0]['kind'], id: string) => {
    const history = deps.services.history
    if (history === undefined) throw new Error(deps.text.reportUi.generationFailed)
    const document = verifyReport(await history.get(kind, id), deps.redaction)
    if (document.header.kind !== kind) throw new Error(deps.text.reportUi.generationFailed)
    return document
  }
  return {
    capability: 'reports',
    async run(input) {
      try {
        const { workspaceKey, options } = reportsMethods['reports/run'].params.parse(input)
        await authorized(workspaceKey)
        const generate = deps.services.generate
        if (generate === undefined) return failed()
        const result = await generate(options, deps.signal)
        await authorized(workspaceKey)
        if (result.status !== 'generated') return failed()
        const document = verifyReport(result.document, deps.redaction)
        if (
          document.header.kind !== options.kind ||
          document.header.scope !== reportScrubber(deps.redaction)(options.scope) ||
          document.header.asOf !== options.asOf
        )
          return failed()
        if (deps.keepHistory) {
          if (deps.services.history === undefined) return failed()
          await deps.services.history.save(document)
          await authorized(workspaceKey)
        }
        return reportsMethods['reports/run'].result.parse({ status: 'generated', document })
      } catch {
        return failed()
      }
    },
    async history(input) {
      try {
        const { workspaceKey, kind } = reportsMethods['reports/history'].params.parse(input)
        await authorized(workspaceKey)
        const history = deps.services.history
        if (history === undefined) return failed()
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
          return failed()
        await authorized(workspaceKey)
        return result
      } catch {
        return failed()
      }
    },
    async get(input) {
      try {
        const { workspaceKey, kind, id } = reportsMethods['reports/get'].params.parse(input)
        await authorized(workspaceKey)
        const document = await saved(kind, id)
        await authorized(workspaceKey)
        return reportsMethods['reports/get'].result.parse({ status: 'retrieved', document })
      } catch {
        return failed()
      }
    },
    async compare(input) {
      try {
        const { workspaceKey, kind, fromId, toId } =
          reportsMethods['reports/compare'].params.parse(input)
        await authorized(workspaceKey)
        const compare = deps.services.compare
        if (compare === undefined) return failed()
        const before = await saved(kind, fromId)
        await authorized(workspaceKey)
        const after = await saved(kind, toId)
        if (before.header.scope !== after.header.scope) return failed()
        await authorized(workspaceKey)
        const result = reportsMethods['reports/compare'].result.parse({
          status: 'compared',
          diff: compare(before, after),
        })
        return result.status === 'compared' &&
          (JSON.stringify(result.diff.from) !== JSON.stringify(before.header) ||
            JSON.stringify(result.diff.to) !== JSON.stringify(after.header) ||
            !redacted(result.diff.sections))
          ? failed()
          : result
      } catch {
        return failed()
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
      } catch {
        return failed()
      }
    },
  }
}
