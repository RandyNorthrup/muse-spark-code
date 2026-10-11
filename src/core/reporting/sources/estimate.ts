// The M117 estimate as a report source (M113, PLAN.md D93.4): the goal
// comes from the report scope (D97.2, as `/report estimate <goal>` passes
// it), `--by` carries the deadline and `--fleet` the fleet. The estimator's
// own run produces the section through the injected reader; this source
// validates that result against the owned schema, checks it answers the
// requested goal, scrubs it and projects the six D93.4 facets. A refused
// estimate stays a named engine failure (`failed`), never invented rows:
// run `/estimate` on the same goal for the refusal's detail.
import {
  estimateRequestSchema,
  estimateSectionSchema,
  parseEstimateGoal,
  type EstimateRequest,
} from '../../../shared/estimate'
import { reportSectionSchema } from '../../../shared/reportSchema'
import { estimateReportSections } from '../collect/estimate'
import type { ReportSourcePayloads, SourceReadContext } from './types'
import { localSource, LocalSourceError, scrubSourceValue, type SourceScrub } from './local'

/**
 * The estimator binding, supplied by the estimate owner through the report
 * inputs: VS Code runs its lazy estimator bundle, ACP and the terminal run
 * the headless one for the report's workspace root. Resolves the validated
 * request or throws the engine's named failure.
 */
export interface ReportEstimateReader {
  read(
    request: EstimateRequest,
    context: SourceReadContext,
  ): Promise<{ section: unknown; observedAt: string; partial?: string } | null>
}

export function estimateSource(reader: ReportEstimateReader | undefined, scrub: SourceScrub) {
  return localSource('estimate', async (context) => {
    if (context.options.kind !== 'estimate') throw new LocalSourceError('disabled')
    if (reader === undefined) throw new LocalSourceError('unbound')
    const goal = parseEstimateGoal(context.options.scope)
    if (goal === undefined) throw new LocalSourceError('invalid')
    // The estimator's instants end in Z while report stamps may carry an
    // explicit offset (`--by` always builds `+00:00`): normalize to the same
    // UTC instant so every documented report flag reaches the engine. Both
    // stamps are validated timestamps, so the conversion cannot fail.
    const asOf = new Date(context.asOf).toISOString()
    const deadline =
      context.options.deadline === undefined
        ? undefined
        : new Date(context.options.deadline).toISOString()
    // Reports carry no optimize flag: every editor forecasts cost, like the
    // headless estimate under its budget posture, so the numbers match.
    const request = estimateRequestSchema.parse({
      goal,
      asOf,
      fleet: context.options.fleet ?? 'current',
      optimize: 'cost',
      ...(deadline !== undefined && { deadline }),
    })
    const read = await reader.read(request, context)
    if (read === null) throw new LocalSourceError('failed')
    const section = estimateSectionSchema.parse(scrubSourceValue(read.section, scrub))
    // The run must answer this generation's request, not a stale one.
    if (
      JSON.stringify(estimateRequestSchema.parse(section.inputs.request)) !==
      JSON.stringify(request)
    )
      throw new LocalSourceError('invalid')
    const data: ReportSourcePayloads['estimate'] = estimateReportSections(
      section,
      context.options,
    ).map((entry) => reportSectionSchema.parse(entry))
    return {
      data,
      observedAt: read.observedAt,
      ...(read.partial !== undefined && { partial: scrub(read.partial) }),
    }
  })
}
