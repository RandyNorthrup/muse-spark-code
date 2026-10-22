import * as z from 'zod/mini'
import { JUDGE_QUESTION_MAX } from '../../../shared/constants'
import { redactSecrets } from '../../redact'
import { entropyConfidence } from '../math'
import { judgeRequestSchema, judgeResultSchema, type JudgeRequest } from '../schema'
import { type LintCache, type LintDecision, type LintIdentity } from './cache'
import { lintQuestion, type LintQuestion, type LintRule, type LintWording } from './rules'
import type { LintFile, LintUnit } from './units'

const calleeSchema = z.strictObject({ name: z.string(), path: z.string(), source: z.string() })

export interface LintLimits {
  readonly maxCallees: number
  readonly maxCalleeBytes: number
  readonly distributionTolerance: number
}

export interface LintEvaluator {
  readonly identity: LintIdentity
  readonly wording: LintWording
  readonly limits: LintLimits
  readonly cache: LintCache
  callees(file: LintFile, unit: LintUnit): Promise<unknown>
  /** The assembled source must reserve/rebind under D78 before each send, including retries. */
  judgeAdmitted(request: JudgeRequest, budgetUsd: number, signal: AbortSignal): Promise<unknown>
}

export interface LintUnitResult {
  readonly rule: LintRule
  readonly unit: LintUnit
  readonly decision: LintDecision
  readonly provenance: LintIdentity['provenance']
}

function decisionsFromResponse(
  raw: unknown,
  request: JudgeRequest,
  rules: readonly LintRule[],
  questions: ReadonlyMap<string, LintQuestion>,
  evaluator: LintEvaluator,
): readonly LintDecision[] {
  const result = judgeResultSchema.parse(raw)
  if (
    result.model !== evaluator.identity.model ||
    Object.keys(result.answers).length !== rules.length
  ) {
    throw new Error('lint-answer-alignment')
  }
  return rules.map((rule) => {
    const answer = result.answers[rule.id]
    const meta = result.muse[rule.id]
    const prepared = questions.get(rule.id)
    if (
      meta === undefined ||
      prepared === undefined ||
      answer?.type !== 'choice' ||
      meta.source !== evaluator.identity.source ||
      meta.model !== evaluator.identity.model
    ) {
      throw new Error('lint-answer-alignment')
    }
    const criteria = request.questions[rule.id]
    if (criteria?.type !== 'choice') throw new Error('lint-answer-alignment')
    const letters = Object.keys(criteria.criteria)
    const probabilities = letters.map((letter) => answer.probabilities[letter])
    if (
      Object.keys(answer.probabilities).length !== letters.length ||
      probabilities.includes(undefined) ||
      Math.abs(probabilities.reduce<number>((sum, probability = 0) => sum + probability, 0) - 1) >
        evaluator.limits.distributionTolerance
    ) {
      throw new Error('lint-answer-distribution')
    }
    const confidence = entropyConfidence(probabilities.map((probability = 0) => probability))
    const outcome = prepared.outcomes[answer.choice]
    if (outcome === undefined) throw new Error('lint-answer-alignment')
    const chosenProbability = answer.probabilities[answer.choice]
    if (
      chosenProbability === undefined ||
      probabilities.some((probability = 0) => probability > chosenProbability)
    ) {
      throw new Error('lint-answer-distribution')
    }
    return {
      outcome: meta.partial || confidence < rule.minConfidence ? 'inconclusive' : outcome,
      confidence,
    }
  })
}

/** Rules with identical context needs share one complete unit state, never fragments of it. */
export async function evaluateLintUnit(
  file: LintFile,
  unit: LintUnit,
  rules: readonly LintRule[],
  evaluator: LintEvaluator,
  budgetUsd: number,
  signal: AbortSignal,
  parent?: LintUnit,
): Promise<readonly LintUnitResult[]> {
  if (rules.length === 0) return []
  if (
    rules.some(
      (rule) =>
        !Number.isFinite(rule.minConfidence) || rule.minConfidence < 0 || rule.minConfidence > 1,
    )
  ) {
    throw new RangeError('lint-confidence-invalid')
  }
  if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
    throw new Error('lint-rule-id-duplicate')
  const identity = { ...evaluator.identity }
  const assertIdentity = () => {
    if (
      Object.entries(identity).some(
        ([key, value]) => Reflect.get(evaluator.identity, key) !== value,
      )
    ) {
      throw new Error('lint-source-changed')
    }
  }
  const results: LintUnitResult[] = []
  for (const isNeedsCallees of [false, true]) {
    signal.throwIfAborted()
    // Cache decisions are positional, so identical serialized questions require a stable rule order.
    const group = rules
      .filter((rule) => rule.callees === isNeedsCallees)
      .toSorted((left, right) => left.id.localeCompare(right.id))
    if (group.length === 0) continue
    const callees = isNeedsCallees
      ? z.array(calleeSchema).parse(await evaluator.callees(file, parent ?? unit))
      : []
    signal.throwIfAborted()
    assertIdentity()
    if (
      callees.length > evaluator.limits.maxCallees ||
      callees.reduce((bytes, callee) => bytes + Buffer.byteLength(callee.source, 'utf8'), 0) >
        evaluator.limits.maxCalleeBytes
    ) {
      throw new RangeError('lint-context-too-large')
    }
    const pending: LintRule[][] = []
    for (let offset = 0; offset < group.length; offset += JUDGE_QUESTION_MAX) {
      pending.push(group.slice(offset, offset + JUDGE_QUESTION_MAX))
    }
    while (pending.length > 0) {
      signal.throwIfAborted()
      assertIdentity()
      const batch = pending.shift()
      if (batch === undefined) throw new Error('lint-answer-alignment')
      const questions = new Map(
        batch.map((rule) => [rule.id, lintQuestion(rule, evaluator.wording, parent !== undefined)]),
      )
      const rawRequest = {
        model: identity.model,
        state: {
          language: file.language,
          kind: parent === undefined ? unit.kind : 'region',
          name: unit.name,
          path: file.path,
          source: file.source.slice(unit.start, unit.end),
          ...(unit.parentSource !== undefined && { parentSource: unit.parentSource }),
          ...(unit.regionKind !== undefined && { regionKind: unit.regionKind }),
          ...((parent ?? unit).types !== undefined && { types: (parent ?? unit).types }),
          ...(parent !== undefined && {
            parentSource: file.source.slice(parent.start, parent.end),
            regionKind: unit.regionKind ?? unit.kind,
          }),
          ...(callees.length > 0 && { callees }),
        },
        questions: Object.fromEntries(
          [...questions].map(([id, prepared]) => [id, prepared.question]),
        ),
      }
      // Redact the entire request before hashing or dispatch; cache reuse never wins over privacy.
      const parsed = judgeRequestSchema.safeParse(
        JSON.parse(redactSecrets(JSON.stringify(rawRequest))),
      )
      if (!parsed.success) {
        if (batch.length === 1) throw parsed.error
        // Only questions split. Every attempted batch retains the complete unit and context.
        const middle = Math.ceil(batch.length / 2)
        pending.unshift(batch.slice(0, middle), batch.slice(middle))
        continue
      }
      const request = parsed.data
      const cached = evaluator.cache.get(request, identity)
      const decisions =
        cached ??
        decisionsFromResponse(
          await evaluator.judgeAdmitted(request, budgetUsd, signal),
          request,
          batch,
          questions,
          evaluator,
        )
      signal.throwIfAborted()
      assertIdentity()
      if (
        cached === undefined &&
        decisions.every((decision) => decision.outcome !== 'inconclusive')
      ) {
        evaluator.cache.put(request, identity, decisions)
      }
      for (const [index, rule] of batch.entries()) {
        const decision = decisions[index]
        if (decision === undefined) throw new Error('lint-answer-alignment')
        results.push({
          rule,
          unit,
          provenance: identity.provenance,
          decision: {
            ...decision,
            outcome: decision.confidence < rule.minConfidence ? 'inconclusive' : decision.outcome,
          },
        })
      }
    }
  }
  return results
}
