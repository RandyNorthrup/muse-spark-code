import { REPORT_MAX_ROWS, REPORT_MAX_TEXT_CHARS } from '../../../shared/constants'
import * as z from 'zod/mini'
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
    const parsed = z
      .array(questionSchema)
      .check(z.maxLength(REPORT_MAX_ROWS))
      .parse(result.questions)
    if (new Set(parsed.map((row) => row.id)).size !== parsed.length)
      throw new LocalSourceError('invalid')
    return {
      data: parsed
        .map((row) => ({
          ...row,
          id: scrub(row.id),
          text: scrub(row.text),
          milestoneIds: row.milestoneIds.map((id) => scrub(id)).toSorted(codeUnitCompare),
        }))
        .toSorted((a, b) => codeUnitCompare(a.id, b.id)),
      observedAt: result.observedAt,
    }
  })
}
