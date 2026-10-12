import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import * as z from 'zod/mini'
import { duplicateProblem, joinPartialReasons, readReportRows } from './boundary'
import { codeUnitCompare, localSource, LocalSourceError, type SourceScrub } from './local'
import type { ReportQuestion, SourceReadContext } from './types'

/** M112 owns the registry; reporting gets only its normalized question projection. */
export interface ReportQuestionsReader {
  read(
    context: SourceReadContext,
  ): Promise<{ questions: readonly ReportQuestion[]; observedAt: string }>
}
const questionSchema = z.object({
  id: z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS)),
  text: z.string().check(z.minLength(1), z.maxLength(REPORT_MAX_TEXT_CHARS)),
  state: z.enum(['open', 'answered', 'dismissed']),
  milestoneIds: z.array(z.string()).check(z.maxLength(REPORT_MAX_ROWS)),
})
export function questionsSource(reader: ReportQuestionsReader | undefined, scrub: SourceScrub) {
  return localSource('questions', async (context) => {
    if (reader === undefined) throw new LocalSourceError('unbound')
    const result = await reader.read(context)
    // Each question parses on its own: one damaged entry is a named problem
    // beside the good rows, never a lost registry (RVREPORTJOIN P2-1). A
    // repeated id keeps its first row; the later one is the problem.
    const recovered = readReportRows(
      context.reportText,
      'questions',
      'questions',
      result.questions,
      questionSchema,
    )
    const seen = new Set<string>()
    const rows: ReportQuestion[] = []
    const problems = [...recovered.problems]
    for (const row of recovered.rows) {
      if (seen.has(row.id)) {
        problems.push(duplicateProblem(context.reportText, 'questions', `questions/${row.id}`))
        continue
      }
      seen.add(row.id)
      rows.push(row)
    }
    const partial = joinPartialReasons(
      context.reportText,
      problems.map((problem) => problem.reason),
    )
    return {
      data: rows
        .map((row) => ({
          ...row,
          id: scrub(row.id),
          text: scrub(row.text),
          milestoneIds: row.milestoneIds.map((id) => scrub(id)).toSorted(codeUnitCompare),
        }))
        .toSorted(
          (a, b) =>
            codeUnitCompare(a.id, b.id) || codeUnitCompare(JSON.stringify(a), JSON.stringify(b)),
        ),
      observedAt: result.observedAt,
      ...(partial !== undefined && { partial }),
    }
  })
}
