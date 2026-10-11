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
/**
 * The estimator bundle's refusal templates, snapshotted from the table that
 * bundle installed (its process language) and carried on the reader. Three
 * template strings only, never a table: the source decodes a refusal the
 * estimator rendered in another language than the report back to a code
 * plus parameters, then renders the sentence from the report's own
 * installed table at the point of writing (RVCM1134E P2). Snapshotted
 * because `setUiText` mutates the shared table in place. Absent outside
 * the wired hosts (tests, unwired surfaces): the installed-table fallback
 * in `estimateRefusalDetail` still covers the same-language estimator.
 */
export interface EstimateRefusalTemplates {
  readonly failed: string
  readonly noCapacity: string
  readonly notFound: string
}

export interface ReportEstimateReader {
  read(
    request: EstimateRequest,
    context: SourceReadContext,
  ): Promise<{ section: unknown; observedAt: string; partial?: string } | null>
  /** The estimator bundle's refusal templates; absent outside the wired hosts. */
  readonly refusalTemplates?: EstimateRefusalTemplates | undefined
}

/**
 * The estimator's typed refusal: the code plus its parameters, rendered by
 * the report in the report's language. Both the `estimateDiagnostic`
 * channel (the integration seam for c/m117-1, whose diagnostic travels to
 * every surface unchanged) and the template decode below land here; a
 * rendered sentence never crosses the boundary as anything but input to
 * that decode. `failed` carries the estimator's detail code
 * (`no-feasible-setup`, `unschedulable:<lane>`, a diagnostic-grammar code,
 * …); `noCapacity` carries none; `notFound` carries the goal text.
 */
export interface EstimateRefusal {
  readonly kind: 'failed' | 'noCapacity' | 'notFound'
  readonly detail?: string | undefined
  readonly goal?: string | undefined
}

/** The diagnostic grammar, mirrored from `estimateFailureText`
 * (`src/runtime/estimator/command.ts`). */
const ESTIMATE_DIAGNOSTIC_GRAMMAR =
  /^(?:missing-associations|missing-plan|unknown-goal|unknown-prerequisite|unknown-release-member|unknown-rig|duplicate-lane|malformed-starts|missing-estimate|source-unavailable|source-incomplete|invalid-lane|plan-drift|lane-limit):?[\w .,:;-]*$/

/**
 * Engine refusal codes the estimator renders after its failure prefix,
 * enumerated from the estimator's `refuse`/`invalid`/`calibrationFailure`
 * sites (`no-feasible-setup`, `missing-fit`, `snapshot-asOf`, …): kebab or
 * camel codes with colon parameters, never paths or sentences. Anything
 * outside this shape stays the generic failed code, never a forged refusal
 * (`Estimate failed: ../../etc/passwd` has no place here).
 */
const ESTIMATE_ENGINE_DETAIL = /^[a-z][\w-]*(?::[\w .,:;-]+)?$/

function isRefusalTemplates(value: unknown): value is EstimateRefusalTemplates {
  if (typeof value !== 'object' || value === null) return false
  const templates = value as Record<string, unknown>
  return (
    typeof templates['failed'] === 'string' &&
    typeof templates['noCapacity'] === 'string' &&
    typeof templates['notFound'] === 'string'
  )
}

/** The seam c/m117-1 fills: capacity refuses as `no-capacity`, a missing
 * goal as `goal-not-found: <goal-json>` (the `JSON.stringify(goal)` text
 * `resolveEstimateGoal` renders today), engine codes bare. */
function refusalFromDiagnostic(candidate: unknown): EstimateRefusal | undefined {
  if (typeof candidate !== 'string' || redactSecrets(candidate) !== candidate) return undefined
  if (ESTIMATE_DIAGNOSTIC_GRAMMAR.test(candidate)) return { kind: 'failed', detail: candidate }
  if (candidate === 'no-capacity') return { kind: 'noCapacity' }
  const notFound = /^goal-not-found: (.*)$/.exec(candidate)
  if (notFound?.[1] !== undefined && notFound[1] !== '') {
    try {
      const goal: unknown = JSON.parse(notFound[1])
      if (
        typeof goal === 'object' &&
        goal !== null &&
        'kind' in goal &&
        typeof goal.kind === 'string'
      )
        return { kind: 'notFound', goal: notFound[1] }
    } catch {
      // Not a goal rendering: generic below.
    }
    return undefined
  }
  return ESTIMATE_ENGINE_DETAIL.test(candidate) ? { kind: 'failed', detail: candidate } : undefined
}

/** A seam-shaped refusal the estimator attached itself, validated the same
 * way the template decode is: a code plus parameters, never a sentence. */
function refusalFromAttached(error: object): EstimateRefusal | undefined {
  if (!('estimateRefusal' in error)) return undefined
  const attached: unknown = error.estimateRefusal
  if (typeof attached !== 'object' || attached === null) return undefined
  const refusal = attached as { kind?: unknown; detail?: unknown; goal?: unknown }
  if (refusal.kind === 'noCapacity') return { kind: 'noCapacity' }
  if (
    refusal.kind === 'failed' &&
    typeof refusal.detail === 'string' &&
    ESTIMATE_ENGINE_DETAIL.test(refusal.detail) &&
    redactSecrets(refusal.detail) === refusal.detail
  )
    return { kind: 'failed', detail: refusal.detail }
  return refusal.kind === 'notFound' && typeof refusal.goal === 'string' && refusal.goal !== ''
    ? { kind: 'notFound', goal: refusal.goal }
    : undefined
}

/** The template half of a `{slot}` template, or undefined when the slot is
 * absent or repeated: translators own the words, the slot shape is fixed. */
function templateHalves(template: string, slot: string): readonly [string, string] | undefined {
  const halves = template.split(slot)
  return halves.length === 2 && halves[0] !== undefined && halves[1] !== undefined
    ? [halves[0], halves[1]]
    : undefined
}

/** A refusal the estimator rendered with `templates`, decoded to its code
 * plus parameters. The templates are the estimator bundle's own, so this
 * holds in every report language; the detail shape check keeps forged
 * sentences generic in every language too. */
function refusalFromMessage(
  message: string,
  templates: EstimateRefusalTemplates,
): EstimateRefusal | undefined {
  if (message === templates.noCapacity) return { kind: 'noCapacity' }
  const notFound = templateHalves(templates.notFound, '{goal}')
  if (
    notFound !== undefined &&
    message.startsWith(notFound[0]) &&
    message.endsWith(notFound[1]) &&
    message.length > notFound[0].length + notFound[1].length
  )
    return {
      kind: 'notFound',
      goal: message.slice(notFound[0].length, message.length - notFound[1].length),
    }
  const failed = templateHalves(templates.failed, '{detail}')
  if (
    failed !== undefined &&
    message.startsWith(failed[0]) &&
    message.endsWith(failed[1]) &&
    message.length > failed[0].length + failed[1].length
  ) {
    const detail = message.slice(failed[0].length, message.length - failed[1].length)
    if (
      (ESTIMATE_DIAGNOSTIC_GRAMMAR.test(detail) || ESTIMATE_ENGINE_DETAIL.test(detail)) &&
      redactSecrets(detail) === detail
    )
      return { kind: 'failed', detail }
  }
  return undefined
}

function renderRefusal(refusal: EstimateRefusal): string {
  switch (refusal.kind) {
    case 'noCapacity': {
      return UI_TEXT.estimateNoCapacity
    }
    case 'notFound': {
      return fill(UI_TEXT.estimateNotFound, { goal: refusal.goal ?? '' })
    }
    case 'failed': {
      return fill(UI_TEXT.estimateFailed, { detail: refusal.detail ?? 'estimate-unavailable' })
    }
  }
}

/**
 * The estimator's own typed refusal, or undefined for anything else. Typed
 * channels first (`estimateDiagnostic`, an attached `estimateRefusal`):
 * their code plus parameters render from the report's installed table, so
 * the sentence is always in the report's language. Rendered messages decode
 * through the estimator bundle's templates when the reader carries them,
 * else through the installed table for the same-language estimator; a
 * message no template explains stays the generic failed code, never a
 * forged refusal.
 */
function estimateRefusalDetail(
  error: unknown,
  templates: EstimateRefusalTemplates | undefined,
): string | undefined {
  if (typeof error === 'object' && error !== null) {
    if ('estimateDiagnostic' in error) {
      const refusal = refusalFromDiagnostic(error.estimateDiagnostic)
      if (refusal !== undefined) return renderRefusal(refusal)
    }
    const attached = refusalFromAttached(error)
    if (attached !== undefined) return renderRefusal(attached)
  }
  if (error instanceof Error) {
    if (templates !== undefined && isRefusalTemplates(templates)) {
      const refusal = refusalFromMessage(error.message, templates)
      if (refusal !== undefined) return renderRefusal(refusal)
    }
    const installed: EstimateRefusalTemplates = {
      failed: UI_TEXT.estimateFailed,
      noCapacity: UI_TEXT.estimateNoCapacity,
      notFound: UI_TEXT.estimateNotFound,
    }
    const legacy = refusalFromMessage(error.message, installed)
    if (legacy !== undefined) return renderRefusal(legacy)
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
      // typed reason, rendered in the report's language, never the generic
      // sentence: run `/estimate` on the same goal only for a fuller
      // rendering of the same refusal.
      const detail = estimateRefusalDetail(error, reader.refusalTemplates)
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
