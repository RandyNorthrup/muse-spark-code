// The M117 estimate as a report source (M113, PLAN.md D93.4): the goal
// comes from the report scope (D97.2, as `/report estimate <goal>` passes
// it), `--by` carries the deadline and `--fleet` the fleet. The estimator's
// own run produces the section through the injected reader; this source
// validates that result against the owned schema, checks it answers the
// requested goal, scrubs it and projects the six D93.4 facets. A refused
// estimate stays a named engine failure (`failed`) carrying the estimator's
// own typed reason, never invented rows and never the generic sentence.
import {
  estimateRequestSchema,
  estimateSectionSchema,
  parseEstimateGoal,
  type EstimateRequest,
} from '../../../shared/estimate'
import { UI_TEXT, fill } from '../../../shared/l10n/text'
import { reportSectionSchema } from '../../../shared/reportSchema'
import { redactSecrets } from '../../redact'
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

/**
 * The estimator's own typed refusal, or undefined for anything else. The
 * typed `estimateDiagnostic` channel carries every plan/snapshot refusal;
 * the engine's own failure sentence (prefix read from the installed table,
 * so it holds in every language) carries entry, schedule and recommendation
 * refusals; the capacity and not-found sentences are fixed table text. The
 * diagnostic grammar is mirrored from `estimateFailureText`
 * (`src/runtime/estimator/command.ts`): anything outside it stays the
 * generic failed code, never a forged refusal.
 */
function estimateRefusalDetail(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'estimateDiagnostic' in error) {
    const candidate: unknown = error.estimateDiagnostic
    if (
      typeof candidate === 'string' &&
      /^(?:missing-associations|missing-plan|unknown-goal|unknown-prerequisite|unknown-release-member|unknown-rig|duplicate-lane|malformed-starts|missing-estimate|source-unavailable|source-incomplete|invalid-lane|plan-drift|lane-limit):?[\w .,:;-]*$/.test(
        candidate,
      ) &&
      redactSecrets(candidate) === candidate
    )
      return fill(UI_TEXT.estimateFailed, { detail: candidate })
  }
  if (error instanceof Error) {
    const failedPrefix = UI_TEXT.estimateFailed.split('{detail}', 1)[0] ?? ''
    if (
      failedPrefix !== '' &&
      error.message.startsWith(failedPrefix) &&
      error.message.length > failedPrefix.length
    )
      return error.message
    if (error.message === UI_TEXT.estimateNoCapacity) return error.message
    const notFoundPrefix = UI_TEXT.estimateNotFound.split('{goal}', 1)[0] ?? ''
    if (
      notFoundPrefix !== '' &&
      error.message.startsWith(notFoundPrefix) &&
      error.message.length > notFoundPrefix.length
    )
      return error.message
  }
  return undefined
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
    let read: Awaited<ReturnType<ReportEstimateReader['read']>>
    try {
      read = await reader.read(request, context)
    } catch (error) {
      // A refused estimate stays a failed source with the estimator's own
      // typed reason, never the generic sentence: run `/estimate` on the
      // same goal only for a fuller rendering of the same refusal.
      const detail = estimateRefusalDetail(error)
      throw new LocalSourceError('failed', detail === undefined ? undefined : scrub(detail))
    }
    if (read === null)
      throw new LocalSourceError(
        'failed',
        fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }),
      )
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
