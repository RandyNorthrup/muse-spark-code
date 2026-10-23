import { judgeOutcomeSchema, type JevAnswer, type JudgeRequest } from '../schema'
import { entropyConfidence } from '../math'
import { JUDGE_USE_DEFINITIONS, type JudgeUseAdmission } from './definitions'

export type JudgeUseAdvice =
  | { readonly kind: 'no-opinion' }
  | {
      readonly kind: 'advisory'
      readonly effect: (typeof JUDGE_USE_DEFINITIONS)[keyof typeof JUDGE_USE_DEFINITIONS]['effect']
      readonly answer: JevAnswer
    }

/** Validate injected output and its alignment; no answer can grant an action. */
export function judgeUseAdvice(
  admission: JudgeUseAdmission,
  request: JudgeRequest,
  output: unknown,
): JudgeUseAdvice {
  const parsed = judgeOutcomeSchema.safeParse(output)
  if (!admission.admitted || !parsed.success || parsed.data.outcome === 'no-answer') {
    return { kind: 'no-opinion' }
  }
  const ids = Object.keys(request.questions)
  const id = ids[0]
  const { result } = parsed.data
  if (id === undefined || ids.length !== 1 || Object.keys(result.answers).length !== 1) {
    return { kind: 'no-opinion' }
  }
  const question = request.questions[id]
  const answer = result.answers[id]
  const meta = result.muse[id]
  const { evidence } = admission
  if (
    question === undefined ||
    answer === undefined ||
    meta === undefined ||
    answer.type !== question.type ||
    meta.partial ||
    meta.label === 'uncalibrated' ||
    meta.label === 'approximate (top-1)' ||
    meta.profileId !== evidence.profileId ||
    meta.model !== evidence.identity.model ||
    result.model !== meta.model ||
    meta.source !== evidence.identity.source ||
    meta.technique !== evidence.identity.technique ||
    meta.confidence < evidence.threshold
  ) {
    return { kind: 'no-opinion' }
  }
  const probabilities = Object.values(answer.probabilities)
  let expected = ['true', 'false']
  if (question.type === 'choice') {
    expected = Object.keys(question.criteria)
  } else if (question.type === 'score') {
    expected = question.criteria.map((_, index) => String(index))
  }
  if (
    Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) >
      Number.EPSILON * expected.length ||
    probabilities.length !== expected.length ||
    expected.some((key) => !Object.hasOwn(answer.probabilities, key)) ||
    entropyConfidence(probabilities) < evidence.threshold ||
    (answer.type === 'choice' &&
      (!expected.includes(answer.choice) ||
        answer.probabilities[answer.choice] !== Math.max(...probabilities))) ||
    (answer.type === 'score' &&
      (question.type !== 'score' ||
        expected.some((key, index) => answer.legend[key] !== question.criteria[index]) ||
        Math.abs(
          answer.score - probabilities.reduce((sum, value, index) => sum + value * index, 0),
        ) >
          Number.EPSILON * expected.length)) ||
    (answer.type === 'noul' &&
      (answer.noul !== answer.probabilities.true || answer.noul < evidence.threshold))
  ) {
    return { kind: 'no-opinion' }
  }
  return {
    kind: 'advisory',
    effect: JUDGE_USE_DEFINITIONS[evidence.use].effect,
    answer,
  }
}

/**
The request builder may append one prewritten candidate line at its tail.
No history, prefix or skill index is accepted here, so none can be edited.
Z wires this only on a transport with ephemeral hints and borrowed goldens.
*/
export function appendJudgeHint(
  tail: string,
  advice: JudgeUseAdvice,
  candidateLine: string,
  redact: (text: string) => string,
): string {
  if (advice.kind !== 'advisory' || advice.effect !== 'hint') {
    return tail
  }
  const line = redact(candidateLine)
  return line.trim() === '' || /[\r\n\u{2028}\u{2029}]/u.test(line) ? tail : `${tail}\n${line}`
}
