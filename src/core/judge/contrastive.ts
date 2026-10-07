import { JUDGE_QUESTION_MAX } from '../../shared/constants'
import {
  prepareTechniqueCall,
  runTechniqueCall,
  techniqueEligibility,
  techniqueProbabilities,
  techniqueRefusal,
  techniqueResult,
  type JudgeTechniqueDependencies,
} from './sampling'
import { judgeRequestSchema, type JudgeOutcome, type JudgeRequest } from './schema'

export interface JudgeContrastiveOptions {
  /** Explicit inverses from the family, never generated from a previous answer. */
  readonly inverses: Readonly<Record<string, JudgeRequest['questions'][string]>>
  readonly maxOutputTokens: number
}

/** One complete request contains each noul and its inverse, adjacent and aligned. */
export async function contrastiveJudge(
  request: JudgeRequest,
  options: JudgeContrastiveOptions,
  deps: JudgeTechniqueDependencies,
  signal: AbortSignal,
): Promise<JudgeOutcome> {
  const eligibility = techniqueEligibility(deps, 'contrastive')
  if (eligibility !== undefined) return eligibility
  if (!deps.capability.stated) return techniqueRefusal('capability-unavailable')
  const parsed = judgeRequestSchema.safeParse(request)
  if (
    !parsed.success ||
    !Number.isSafeInteger(options.maxOutputTokens) ||
    options.maxOutputTokens < 1
  )
    return techniqueRefusal('engine-failure')
  const entries = Object.entries(parsed.data.questions)
  if (entries.length * 2 > JUDGE_QUESTION_MAX) return techniqueRefusal('over-context')
  if (Object.keys(options.inverses).length !== entries.length)
    return techniqueRefusal('engine-failure')
  const questions: JudgeRequest['questions'] = {}
  const pairs: { id: string; forwardId: string; inverseId: string }[] = []
  for (const [index, [id, question]] of entries.entries()) {
    const inverse = options.inverses[id]
    if (question.type !== 'noul' || inverse?.type !== 'noul')
      return techniqueRefusal('capability-unavailable')
    const forwardId = String(index * 2)
    const inverseId = String(index * 2 + 1)
    questions[forwardId] = question
    questions[inverseId] = inverse
    pairs.push({ id, forwardId, inverseId })
  }
  const paired = judgeRequestSchema.safeParse({ ...parsed.data, questions })
  if (!paired.success) return techniqueRefusal('over-context')
  const outputTokens = Math.max(options.maxOutputTokens, deps.capability.minOutputTokens)
  const distributions = new Map<string, number[]>()
  try {
    const call = prepareTechniqueCall(paired.data, 'contrastive', outputTokens, deps)
    if ('outcome' in call) return call
    const receipt = await runTechniqueCall(call, signal, deps)
    const outcome = receipt.outcome
    if (outcome.outcome === 'no-answer') return outcome
    if (
      outcome.result.model !== deps.capability.model ||
      Object.keys(outcome.result.answers).length !== pairs.length * 2
    )
      return techniqueRefusal('engine-failure')
    for (const { id, forwardId, inverseId } of pairs) {
      const probabilities: number[][] = []
      for (const pairId of [forwardId, inverseId]) {
        const question = paired.data.questions[pairId]
        const answer = outcome.result.answers[pairId]
        const meta = outcome.result.muse[pairId]
        if (
          question === undefined ||
          answer === undefined ||
          meta?.partial !== false ||
          meta.model !== deps.capability.model ||
          meta.source !== deps.capability.source ||
          meta.technique === 'top1'
        )
          return techniqueRefusal('engine-failure')
        const values = techniqueProbabilities(question, answer)
        if (values === undefined) return techniqueRefusal('engine-failure')
        probabilities.push(values)
      }
      const forward = probabilities[0]?.[0]
      const inverse = probabilities[1]?.[0]
      if (forward === undefined || inverse === undefined) return techniqueRefusal('engine-failure')
      const p = (forward + 1 - inverse) / 2
      distributions.set(id, [p, 1 - p])
    }
    return techniqueResult(parsed.data, distributions, 'contrastive', deps, [receipt])
  } catch {
    return techniqueRefusal(signal.aborted ? 'cancelled' : 'engine-failure')
  }
}
