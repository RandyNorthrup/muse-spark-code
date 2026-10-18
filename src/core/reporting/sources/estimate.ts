// The M117 estimate as a report source (M113, PLAN.md D93.4): the goal
// comes from the report scope (D97.2, as `/report estimate <goal>` passes
// it), `--by` carries the deadline and `--fleet` the fleet. The estimator's
// own run produces the section through the injected reader; this source
// validates that result against the owned schema, checks it answers the
// requested goal, scrubs it and projects the six D93.4 facets. A refused
// estimate stays a named engine failure (`failed`) carrying the estimator's
// own typed diagnostic (its code plus structured parameters, rendered in
// the report's language), never invented rows and never a guess: a refusal
// without a valid typed diagnostic stays the honest generic refusal.
import {
  estimateGoalSchema,
  estimateRequestSchema,
  estimateSectionSchema,
  parseEstimateGoal,
  type EstimateRequest,
} from '../../../shared/estimate'
import { ESTIMATE_MISSING_DETAIL_LIMIT } from '../../../shared/constants'
import { estimateDiagnostic } from '../../../shared/estimateDiagnostic'
import type { PluralForms } from '../../../shared/l10n/forms'
import { fill } from '../../../shared/l10n/text'
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
/**
 * The report language's refusal sentences, captured once when the report
 * request starts and carried on the reader: the reader factory snapshots
 * its own `table` argument, so the sentences are the report's even when
 * `setUiText` installs another generation's language while the estimator
 * runs. Rendered counts use `locale` with fresh `Intl` instances, never
 * the process-wide formatters. Nothing in this kind's files reads the
 * process-wide table after an await (RVCM1134G P2).
 */
export interface EstimateReportText {
  readonly failed: string
  readonly noCapacity: string
  readonly notFound: string
  readonly missingMore: PluralForms
  readonly locale: string
}

export interface ReportEstimateReader {
  read(
    request: EstimateRequest,
    context: SourceReadContext,
  ): Promise<{ section: unknown; observedAt: string; partial?: string } | null>
  /** The report language's refusal sentences; absent outside the wired hosts. */
  readonly text?: EstimateReportText | undefined
}

/** A lane identity the estimator names in a refusal, never a sentence. */
const ESTIMATE_LANE_ID = /^[\w.-]+(?::[\w.-]+)?$/

/** An `unknown-goal` reference: a milestone, number, release, kind or lane. */
const UNKNOWN_GOAL_REF = /^[\w.:-]+$/

/**
 * The request's own table, only for readers built without the factory.
 * This runs before the first await, so no interleaving generation can move
 * the language under it.
 */
function contextReportText(context: SourceReadContext): EstimateReportText {
  return {
    failed: context.reportText.estimateFailed,
    noCapacity: context.reportText.estimateNoCapacity,
    notFound: context.reportText.estimateNotFound,
    missingMore: context.reportText.estimateMissingMore,
    locale: context.locale,
  }
}

/**
 * The omitted-lane count in the report's language, from its number: fresh
 * `Intl` instances over the captured locale, never the installed state.
 */
function missingMoreText(missingMore: PluralForms, count: number, locale: string): string {
  const form = missingMore[new Intl.PluralRules(locale).select(count)] ?? missingMore.other
  return form.replaceAll('{count}', () => new Intl.NumberFormat(locale).format(count))
}

/**
 * The `missing-estimate` lanes and omitted count as data: the lane list
 * plus the trailing `and <n> more`, re-rendered in the report's language
 * (RVCM1134G P3). Anything outside the producer's shape stays the
 * estimator's own detail, as `/estimate` renders it — never a guess.
 */
function missingEstimateDetail(params: string, text: EstimateReportText): string {
  const more = /^(.*) and (\d+) more$/.exec(params)
  const lanes = (more?.[1] ?? params).split(', ')
  const omitted = more?.[2] === undefined ? 0 : Number(more[2])
  const isStrict =
    lanes.every((id) => ESTIMATE_LANE_ID.test(id)) &&
    Number.isSafeInteger(omitted) &&
    (more?.[2] === undefined || (omitted >= 1 && lanes.length === ESTIMATE_MISSING_DETAIL_LIMIT))
  if (!isStrict) return `missing-estimate: ${params}`
  const shown = lanes.join(', ')
  return omitted === 0
    ? `missing-estimate: ${shown}`
    : `missing-estimate: ${shown} ${missingMoreText(text.missingMore, omitted, text.locale)}`
}

/**
 * The estimator's typed refusal as the report-language reason: the shared
 * validated diagnostic's code plus its structured parameters, consumed
 * directly (RVCM1134G P1). The estimator's rendered message is never read,
 * attached guesses never consulted, and parameters are validated against
 * the diagnostic's own schema before use. `no-capacity` names the capacity
 * sentence; `unknown-goal` names the goal sentence with the diagnostic's
 * reference (or this request's goal when bare); any other valid code fails
 * with its detail. Anything without a valid typed diagnostic stays
 * undefined: the honest generic refusal, never a named one.
 */
function estimateRefusalDetail(
  error: unknown,
  goalJson: string,
  text: EstimateReportText,
): string | undefined {
  const { estimateDiagnostic: diagnostic } = estimateDiagnostic(error)
  if (diagnostic === 'estimate-unavailable') return undefined
  const colon = diagnostic.indexOf(':')
  const code = colon === -1 ? diagnostic : diagnostic.slice(0, colon)
  const params = colon === -1 ? '' : diagnostic.slice(colon + 1).replace(/^ /, '')
  switch (code) {
    case 'no-capacity': {
      return params === '' ? text.noCapacity : fill(text.failed, { detail: diagnostic })
    }
    case 'unknown-goal': {
      if (params === '') return fill(text.notFound, { goal: goalJson })
      return UNKNOWN_GOAL_REF.test(params)
        ? fill(text.notFound, { goal: params })
        : fill(text.failed, { detail: diagnostic })
    }
    case 'missing-estimate': {
      return fill(text.failed, { detail: missingEstimateDetail(params, text) })
    }
    default: {
      return fill(text.failed, { detail: diagnostic })
    }
  }
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
    // The report's refusal language, captured before the estimator runs:
    // the factory snapshots its own table onto the reader; anything else
    // snapshots the request's table here, synchronously, so a generation
    // that starts later cannot move the language under this one.
    const text = reader.text ?? contextReportText(context)
    let read: Awaited<ReturnType<ReportEstimateReader['read']>>
    try {
      read = await reader.read(request, context)
    } catch (error) {
      // A refused estimate stays a failed source naming the estimator's own
      // typed refusal in the report's language, never the generic sentence
      // and never a guess: run `/estimate` on the same goal only for a
      // fuller rendering of the same refusal.
      const detail = estimateRefusalDetail(
        error,
        JSON.stringify(estimateGoalSchema.parse(goal)),
        text,
      )
      throw new LocalSourceError('failed', detail === undefined ? undefined : scrub(detail))
    }
    if (read === null)
      throw new LocalSourceError(
        'failed',
        scrub(fill(text.failed, { detail: 'estimate-unavailable' })),
      )
    // Disclosure paths are JSON Pointers the estimator builds from fixed
    // field names and array indices: they carry no user text, but the
    // export scrubber reads multi-segment pointers as POSIX paths and
    // redacts them, breaking the schema. Scrub everything else, then
    // restore the disclosures whole; the parse below still validates them.
    const scrubbed = scrubSourceValue(read.section, scrub) as Record<string, unknown>
    const section = estimateSectionSchema.parse({
      ...scrubbed,
      disclosures: (read.section as { disclosures: unknown }).disclosures,
    })
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
