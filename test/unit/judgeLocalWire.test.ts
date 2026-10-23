import { describe, expect, it } from 'vitest'
import { judgeRequestSchema, judgeResultSchema } from '../../src/core/judge/schema'
import { localChatResult, localSystemOneResult } from '../../src/core/judge/local/wire'
import { Usd } from '../../src/shared/usd'
import capture from './fixtures/localJudgeSystemOneCapture.json'
import chat from './fixtures/localJudgeCapture.json'

const request = judgeRequestSchema.parse(capture.request)
describe('M98 J2 captured local result boundary', () => {
  it('replays all three real SystemOne answers with entropy and zero paid cost', () => {
    const result = localSystemOneResult(capture.response, request, capture.request.model)
    expect(judgeResultSchema.safeParse(result).success).toBe(true)
    expect(result.answers['risk']).toMatchObject(capture.response.answers.risk)
    expect(result.answers['kind']).toEqual(capture.response.answers.kind)
    expect(result.answers['level']).toEqual(capture.response.answers.level)
    expect(result.muse['risk']).toMatchObject({
      source: 'separate',
      technique: 'systemone',
      label: 'uncalibrated',
      partial: false,
      reservedCostUsd: Usd.from(0).toAmount(),
      settledCostUsd: Usd.from(0).toAmount(),
    })
    expect(result.muse['kind']?.vendorConfidence).toBe(capture.response.answers.kind.confidence)
    expect(result.muse['kind']?.confidence).toBeCloseTo(capture.response.answers.kind.confidence)
    expect(result.muse['risk']?.vendorConfidence).toBeUndefined()
    expect(result.answers['risk']).toHaveProperty(
      'probabilities.true',
      capture.response.answers.risk.noul,
    )
  })
  it('retains unexpected vendor fields without treating their confidence as ours', () => {
    const value = structuredClone(capture.response)
    value.answers.kind.confidence = 0
    const result = localSystemOneResult({ ...value, future: 'retained' }, request, value.model)
    expect(result['future']).toBe('retained')
    expect(result.muse['kind']?.vendorConfidence).toBe(0)
    expect(result.muse['kind']?.confidence).toBeGreaterThan(0)
  })

  it('rejects a score legend that reverses the requested criteria', () => {
    const value = structuredClone(capture.response)
    const legend = value.answers.level.legend
    const first = legend['0']
    legend['0'] = legend['2']
    legend['2'] = first
    expect(() => localSystemOneResult(value, request, value.model)).toThrow('invalid-local-answer')
  })

  it('rejects an in-range score that contradicts its distribution', () => {
    const value = structuredClone(capture.response)
    value.answers.level.score = 2
    expect(() => localSystemOneResult(value, request, value.model)).toThrow('invalid-local-answer')
  })

  it('accepts score summation roundoff but rejects a meaningful discrepancy', () => {
    const value = structuredClone(capture.response)
    value.answers.level.score += Number.EPSILON
    expect(() => localSystemOneResult(value, request, value.model)).not.toThrow()
    value.answers.level.score += 0.000001
    expect(() => localSystemOneResult(value, request, value.model)).toThrow('invalid-local-answer')
  })

  it('rejects a valid wire answer of the wrong requested kind', () => {
    const response = {
      ...capture.response,
      answers: {
        ...capture.response.answers,
        risk: {
          type: 'choice',
          choice: 'true',
          probabilities: { true: 0.5, false: 0.5 },
          confidence: 0.5,
        },
      },
    }
    expect(() => localSystemOneResult(response, request, capture.request.model)).toThrow(
      'invalid-local-answer',
    )
  })
  it.each([
    'model',
    'missing',
    'extra',
    'type',
    'probability',
    'choice',
    'legend',
    'usage',
    'mass',
    'score',
    'option-keys',
  ])('refuses invalid %s rather than manufacturing an answer', (fault) => {
    const value = structuredClone(capture.response)
    switch (fault) {
      case 'model': {
        value.model = 'other'
        break
      }
      case 'missing': {
        Object.assign(value, { answers: { kind: value.answers.kind, level: value.answers.level } })
        break
      }
      case 'extra': {
        Object.assign(value.answers, { extra: value.answers.risk })
        break
      }
      case 'type': {
        Object.assign(value.answers.risk, { type: 'choice' })
        break
      }
      case 'probability': {
        value.answers.risk.noul = NaN
        break
      }
      case 'choice': {
        value.answers.kind.choice = 'Z'
        break
      }
      case 'legend': {
        Object.assign(value.answers.level, { legend: {} })
        break
      }
      case 'usage': {
        Object.assign(value, { usage: { input_tokens: 1 } })
        break
      }
      case 'mass': {
        value.answers.kind.probabilities.A = 0
        break
      }
      case 'score': {
        value.answers.level.score = 100
        break
      }
      case 'option-keys': {
        Object.assign(value.answers.kind.probabilities, { Z: 0 })
        break
      }
    }
    expect(() => localSystemOneResult(value, request, capture.request.model)).toThrow()
  })
  it('renormalizes the actual qwen top-5 over distinct yes/no variants', () => {
    const result = localChatResult(
      chat.chat,
      { state: 'git status', questions: { risk: request.questions['risk']! } },
      chat.chat.model,
    )
    expect(result.muse['risk']).toMatchObject({
      source: 'separate',
      technique: 'logprob',
      label: 'uncalibrated',
      partial: false,
    })
    expect(result.answers['risk']).toMatchObject({ type: 'noul' })
    expect(result.muse['risk']?.confidence).toBeGreaterThan(0)
    expect(result.usage).toEqual({ input_tokens: chat.chat.prompt_eval_count, output_tokens: 1 })
  })
  it.each(['missing', 'empty', 'non-answer', 'model', 'unfinished', 'extra-token'])(
    'refuses %s chat evidence',
    (fault) => {
      const value = structuredClone(chat.chat)
      switch (fault) {
        case 'missing': {
          Object.assign(value, { logprobs: undefined })
          break
        }
        case 'empty': {
          value.logprobs[0]!.top_logprobs = []
          break
        }
        case 'non-answer': {
          const candidates = value.logprobs[0]!.top_logprobs
          for (const token of candidates) token.token = 'maybe'
          break
        }
        case 'model': {
          value.model = 'other'
          break
        }
        case 'unfinished': {
          value.done = false
          break
        }
        case 'extra-token': {
          value.logprobs.push(value.logprobs[0]!)
          break
        }
      }
      expect(() =>
        localChatResult(
          value,
          { state: 'git status', questions: { risk: request.questions['risk']! } },
          chat.chat.model,
        ),
      ).toThrow()
    },
  )
})
