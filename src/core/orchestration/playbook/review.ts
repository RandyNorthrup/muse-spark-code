import { randomUUID } from 'node:crypto'
import { PLAYBOOK_FINDING_CLASSES, PLAYBOOK_ID_MAX_CHARS } from '../../../shared/constants'
import { redactSecrets } from '../../../shared/redact'
import {
  knownFindingClass,
  playbookRoundSchema,
  type PlaybookModule,
  type PlaybookReviewAgents,
  type PlaybookRound,
  type PlaybookWhyNote,
} from '../../../shared/playbook'
import {
  knownSeverity,
  type ReviewBlock,
  type ReviewFinding,
  type ReviewResolution,
} from '../../../shared/reviewFindings'
import { modulePath, type ModuleState } from './modules'

export type OverrideEvidence = Extract<PlaybookRound['answers'][number], { status: 'override' }>
export type OverrideAuthority = (
  evidence: Pick<OverrideEvidence, 'actor' | 'reason' | 'at'>,
  subject: string,
) => boolean

export function hasReviewConflict(agents: PlaybookReviewAgents): boolean {
  return (
    Object.values(agents).some(
      (id) => !id.trim() || id.length > PLAYBOOK_ID_MAX_CHARS || redactSecrets(id) !== id,
    ) ||
    agents.implementerId.trim() === agents.reviewerId.trim() ||
    agents.implementerSessionId.trim() === agents.reviewerSessionId.trim()
  )
}

function priority(finding: ReviewFinding): PlaybookRound['findings'][number]['severity'] {
  const normalized = finding.severity?.toUpperCase()
  switch (normalized) {
    case 'P1':
    case 'P2':
    case 'P3': {
      return normalized
    }
  }
  const severity = knownSeverity(finding.severity)
  if (severity === 'critical' || severity === undefined) return 'P1'
  return severity === 'high' ? 'P2' : 'P3'
}

export function areFindingsAnswered(
  state: ModuleState,
  isAuthorized: OverrideAuthority,
  isOnePassRequired = true,
): boolean {
  const current = state.current
  if (!current) return true
  return current.findings.every((finding) => {
    const answer = current.answers.find((item) => item.findingId === finding.id)
    if (!answer) return !isOnePassRequired && finding.severity === 'P3'
    if (answer.status === 'fixed') return true
    return answer.status === 'override'
      ? isAuthorized(answer, finding.id)
      : finding.severity !== 'P1' &&
          (finding.severity !== 'P2' ||
            (answer.status === 'residual' &&
              state.design !== undefined &&
              state.design.outcome !== 'impossible'))
  })
}

export function hasCompleteIds(expected: readonly string[], supplied: readonly string[]): boolean {
  return (
    expected.length === supplied.length &&
    new Set(supplied).size === supplied.length &&
    supplied.every((id) => expected.includes(id))
  )
}

export function reviewCoverage(review: ReviewBlock): (typeof PLAYBOOK_FINDING_CLASSES)[number][] {
  return PLAYBOOK_FINDING_CLASSES.filter(
    (entry) => !review.coverage?.some((word) => knownFindingClass(word) === entry),
  )
}

export function resolutionOutcome(
  resolutions: readonly ReviewResolution[],
): 'impossible' | 'caught' | 'remains' {
  if (resolutions.some((item) => item.outcome === 'remains')) return 'remains'
  return resolutions.every((item) => item.outcome === 'impossible') ? 'impossible' : 'caught'
}

/** A redesign never drops an old id merely because the new review omits it.
 * Caught/remains references remain live alongside any newly found issue. */
export function reviewRounds(
  module: PlaybookModule,
  state: ModuleState,
  review: ReviewBlock,
  agents: PlaybookReviewAgents,
  at: number,
): PlaybookRound[] {
  const redesign = state.design && state.design.outcome !== 'impossible'
  const retained = redesign
    ? (state.current?.findings.filter(
        (finding) =>
          review.resolution?.find((item) => item.findingId === finding.id)?.outcome !==
          'impossible',
      ) ?? [])
    : []
  const matched = new Set<string>()
  const findings: PlaybookRound['findings'] = review.findings.map((finding) => {
    const file = modulePath(finding.file)
    const className = knownFindingClass(finding.class)
    const prior = retained.find(
      (item) =>
        !matched.has(item.id) &&
        item.file === file &&
        item.class === className &&
        item.line === finding.line,
    )
    if (prior) matched.add(prior.id)
    const severity = priority(finding)
    return {
      id: prior?.id ?? randomUUID(),
      file,
      severity: prior && prior.severity < severity ? prior.severity : severity,
      ...(finding.line !== undefined && { line: finding.line }),
      ...(knownFindingClass(finding.class) && { class: knownFindingClass(finding.class) }),
    }
  })
  if (redesign) findings.unshift(...retained.filter((finding) => !matched.has(finding.id)))
  const patchPhase = state.strikes === 0 ? 'build' : 'fix'
  const phase = redesign ? 'redesign' : patchPhase
  const aggregate: PlaybookRound = playbookRoundSchema.parse({
    module,
    ...agents,
    round: (state.counts.get(undefined) ?? 0) + 1,
    phase,
    findings,
    answers: [],
    ...(redesign && { resolution: review.resolution }),
    at,
  })
  const classes = [
    ...new Set(findings.flatMap((finding) => (finding.class ? [finding.class] : []))),
  ]
  return [
    aggregate,
    ...classes.map((className) => ({
      ...aggregate,
      class: className,
      round: (state.counts.get(className) ?? 0) + 1,
      findings: findings.filter((finding) => finding.class === className),
    })),
  ]
}

export function redesignBlock(
  state: ModuleState,
  max: number,
): PlaybookWhyNote['code'] | undefined {
  if (state.design?.outcome === 'remains') return 'redesignEscalated'
  if (state.design && state.design.outcome !== 'impossible') return 'redesignOpen'
  return state.current?.findings.length && state.strikes > max ? 'redesignRequired' : undefined
}
