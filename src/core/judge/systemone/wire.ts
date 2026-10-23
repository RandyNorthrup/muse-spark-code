// Remote SystemOne responses, at the captured common wire (OpenRouter host
// calls and the current TypeSafe docs). Inbound `noul` may omit
// probabilities; the internal contract still requires them. Vendor extras
// stay on the answer. Our confidence is entropy, never the vendor's number.
import * as z from 'zod/mini'
import { Usd } from '../../../shared/usd'
import { entropyConfidence } from '../math'
import {
  jevChoiceAnswerSchema,
  jevScoreAnswerSchema,
  judgeResultSchema,
  type JudgeMuse,
  type JudgeQuestion,
  type JudgeRequest,
  type JudgeResult,
} from '../schema'

const SUM_TOLERANCE_SCALE = 100

const probabilitySchema = z.number().check(z.gte(0), z.lte(1))

const inboundNoulSchema = z.looseObject({
  type: z.literal('noul'),
  noul: probabilitySchema,
  probabilities: z.optional(z.record(z.string(), probabilitySchema)),
})

const inboundAnswerSchema = z.discriminatedUnion('type', [
  inboundNoulSchema,
  jevChoiceAnswerSchema,
  jevScoreAnswerSchema,
])

const usageSchema = z.looseObject({
  input_tokens: z.int().check(z.nonnegative()),
  output_tokens: z.int().check(z.nonnegative()),
})

const shellSchema = z.looseObject({
  model: z.string().check(z.minLength(1)),
  answers: z.record(z.string(), z.unknown()),
})

export type SystemOneWireCode =
  | 'systemone-usage'
  | 'systemone-wire'
  | 'systemone-answer'
  | 'systemone-distribution'
  | 'systemone-alignment'

/** A closed parse failure. The message is the code, never the payload. */
export class SystemOneWireError extends Error {
  readonly code: SystemOneWireCode

  constructor(code: SystemOneWireCode) {
    super(code)
    this.name = 'SystemOneWireError'
    this.code = code
  }
}

export interface SystemOneCosts {
  readonly reservedCostUsd: number
  readonly settledCostUsd: number
}

export interface PreparedSystemOne {
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number }
  withCosts(costs: SystemOneCosts): JudgeResult
}

interface AlignedAnswer {
  readonly answer: unknown
  readonly masses: readonly number[]
  readonly vendorConfidence?: number
}

function distributionKeys(question: JudgeQuestion): readonly string[] {
  if (question.type === 'score') {
    return Array.from(question.criteria, (_level, index) => String(index))
  }
  return question.type === 'choice' ? Object.keys(question.criteria) : ['true', 'false']
}

function plainObject(value: unknown): object | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function hasSameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const pending = new Set(right)
  for (const id of left) {
    if (!pending.delete(id)) return false
  }
  return pending.size === 0
}

function isModelAllowed(model: string, allowedModels: readonly string[]): boolean {
  return allowedModels.includes(model)
}

/** Masses in `keys` order. A missing or extra key is undefined, not zero. */
function massesInOrder(
  keys: readonly string[],
  distribution: Readonly<Record<string, number>>,
): readonly number[] | undefined {
  if (Object.keys(distribution).length !== keys.length) return undefined
  const masses: number[] = []
  for (const key of keys) {
    const mass = distribution[key]
    if (mass === undefined) return undefined
    masses.push(mass)
  }
  return masses
}

function hasUnitMass(masses: readonly number[]): boolean {
  let total = 0
  for (const mass of masses) total += mass
  const room = Number.EPSILON * masses.length * SUM_TOLERANCE_SCALE
  return total > 0 && Math.abs(total - 1) <= room
}

function isHeaviest(
  selected: string,
  keys: readonly string[],
  distribution: Readonly<Record<string, number>>,
): boolean {
  const selectedMass = distribution[selected]
  if (selectedMass === undefined) return false
  for (const key of keys) {
    const mass = distribution[key]
    if (mass !== undefined && mass > selectedMass) return false
  }
  return true
}

function levelExpectation(masses: readonly number[]): number {
  let expected = 0
  for (const [index, mass] of masses.entries()) {
    expected += mass * index
  }
  return expected
}

function isLegendAligned(
  legend: Readonly<Record<string, string>>,
  criteria: readonly string[],
): boolean {
  if (Object.keys(legend).length !== criteria.length) return false
  for (const [index, level] of criteria.entries()) {
    if (legend[String(index)] !== level) return false
  }
  return true
}

function binaryMasses(
  noul: number,
  provided: Readonly<Record<string, number>> | undefined,
): readonly number[] {
  if (provided === undefined) return [noul, 1 - noul]
  const ordered = massesInOrder(['true', 'false'], provided)
  if (ordered === undefined) throw new SystemOneWireError('systemone-distribution')
  const yes = ordered[0]
  if (yes === undefined || Math.abs(yes - noul) > Number.EPSILON * SUM_TOLERANCE_SCALE) {
    throw new SystemOneWireError('systemone-answer')
  }
  return ordered
}

function alignAnswer(question: JudgeQuestion, raw: unknown): AlignedAnswer {
  const parsed = inboundAnswerSchema.safeParse(raw)
  if (!parsed.success || parsed.data.type !== question.type) {
    throw new SystemOneWireError('systemone-answer')
  }
  if (parsed.data.type === 'noul') {
    const masses = binaryMasses(parsed.data.noul, parsed.data.probabilities)
    if (!hasUnitMass(masses)) throw new SystemOneWireError('systemone-distribution')
    const yes = masses[0]
    const no = masses[1]
    if (yes === undefined || no === undefined)
      throw new SystemOneWireError('systemone-distribution')
    return {
      answer: { ...parsed.data, probabilities: { true: yes, false: no } },
      masses,
    }
  }
  if (parsed.data.type === 'choice') {
    const keys = distributionKeys(question)
    const masses = massesInOrder(keys, parsed.data.probabilities)
    if (masses === undefined || !hasUnitMass(masses)) {
      throw new SystemOneWireError('systemone-distribution')
    }
    const chosen = parsed.data.choice
    if (!keys.includes(chosen) || !isHeaviest(chosen, keys, parsed.data.probabilities)) {
      throw new SystemOneWireError('systemone-answer')
    }
    return { answer: parsed.data, masses, vendorConfidence: parsed.data.confidence }
  }
  if (question.type !== 'score') throw new SystemOneWireError('systemone-answer')
  const keys = distributionKeys(question)
  if (!isLegendAligned(parsed.data.legend, question.criteria)) {
    throw new SystemOneWireError('systemone-alignment')
  }
  const masses = massesInOrder(keys, parsed.data.probabilities)
  if (masses === undefined || !hasUnitMass(masses)) {
    throw new SystemOneWireError('systemone-distribution')
  }
  const room = Number.EPSILON * masses.length * masses.length * SUM_TOLERANCE_SCALE
  const isWithinLevels = parsed.data.score >= 0 && parsed.data.score <= keys.length - 1
  if (!isWithinLevels || Math.abs(parsed.data.score - levelExpectation(masses)) > room) {
    throw new SystemOneWireError('systemone-answer')
  }
  return { answer: parsed.data, masses, vendorConfidence: parsed.data.confidence }
}

function entropyOf(masses: readonly number[]): number {
  try {
    return entropyConfidence(masses)
  } catch (error) {
    if (error instanceof RangeError) throw new SystemOneWireError('systemone-distribution')
    throw error
  }
}

/**
Validate one captured response against the request and the models this
route may report. `withCosts` attaches the reservation after the caller
decides whether the usage is still inside it.
*/
export function prepareSystemOne(
  value: unknown,
  request: JudgeRequest,
  allowedModels: readonly string[],
): PreparedSystemOne {
  const record = plainObject(value)
  if (record === undefined) throw new SystemOneWireError('systemone-wire')
  const shell = shellSchema.safeParse(record)
  if (!shell.success) throw new SystemOneWireError('systemone-wire')
  if (!Object.hasOwn(record, 'usage')) throw new SystemOneWireError('systemone-usage')
  const usage = usageSchema.safeParse(Reflect.get(record, 'usage'))
  if (!usage.success) throw new SystemOneWireError('systemone-usage')
  if (!isModelAllowed(shell.data.model, allowedModels)) {
    throw new SystemOneWireError('systemone-alignment')
  }
  const questionIds = Object.keys(request.questions)
  if (!hasSameMembers(questionIds, Object.keys(shell.data.answers))) {
    throw new SystemOneWireError('systemone-alignment')
  }
  const answers: Record<string, unknown> = {}
  const muse: Record<string, JudgeMuse> = {}
  for (const [id, question] of Object.entries(request.questions)) {
    const aligned = alignAnswer(question, shell.data.answers[id])
    answers[id] = aligned.answer
    muse[id] = {
      source: 'separate',
      technique: 'systemone',
      model: shell.data.model,
      label: 'uncalibrated',
      confidence: entropyOf(aligned.masses),
      partial: false,
      ...(aligned.vendorConfidence !== undefined && {
        vendorConfidence: aligned.vendorConfidence,
      }),
    }
  }
  const additions: Record<string, unknown> = {}
  const ownedFields = new Set(['model', 'answers', 'usage'])
  for (const key of Object.keys(record)) {
    if (ownedFields.has(key)) continue
    additions[key] = Reflect.get(record, key)
  }
  return {
    usage: {
      input_tokens: usage.data.input_tokens,
      output_tokens: usage.data.output_tokens,
    },
    withCosts(costs: SystemOneCosts): JudgeResult {
      // Quoted dollars canonicalize at this seam: the receipt the schema
      // carries is always an exact amount.
      const reservedCostUsd = Usd.from(costs.reservedCostUsd).toAmount()
      const settledCostUsd = Usd.from(costs.settledCostUsd).toAmount()
      const noted: Record<string, JudgeMuse> = {}
      for (const [id, meta] of Object.entries(muse)) {
        noted[id] = {
          ...meta,
          reservedCostUsd,
          settledCostUsd,
        }
      }
      return judgeResultSchema.parse({
        ...additions,
        model: shell.data.model,
        answers,
        muse: noted,
        usage: usage.data,
      })
    },
  }
}
