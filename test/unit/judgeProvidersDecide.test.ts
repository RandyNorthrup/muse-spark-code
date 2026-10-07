import { describe, expect, it } from 'vitest'
import {
  resolveModelCapabilities,
  type CapabilityOverrides,
  type ModelCapabilityRecord,
} from '../../src/core/providers/capabilityRecord'
import {
  chooseByoTechnique,
  type ByoTechniqueDecision,
} from '../../src/core/judge/providers/decide'
import {
  judgeCapabilitySchema,
  type JudgeCapability,
  type JudgeQuestion,
} from '../../src/core/judge/schema'

const capture = { kind: 'capture' as const, ref: 'localJudgeCapture.json' }
const yes = <T>(value: T) => ({ state: 'yes' as const, value, source: capture })
const denied = { state: 'no' as const, source: capture }

const ollama = {
  provider: 'ollama',
  nativeModel: 'qwen3:4b-instruct-2507-q4_K_M',
  format: 'ollama' as const,
}

function captured(
  identity: ModelCapabilityRecord['identity'],
  fields: CapabilityOverrides = {},
): ModelCapabilityRecord {
  return resolveModelCapabilities(identity, [{ source: capture, fields }])
}

function capability(patch: Partial<JudgeCapability> = {}): JudgeCapability {
  return judgeCapabilitySchema.parse({
    source: 'same',
    providerId: ollama.provider,
    model: ollama.nativeModel,
    modelVersion: 'captured',
    endpoint: 'http://127.0.0.1:11434',
    captureId: 'local-judge-chat',
    logprobs: { kind: 'topk', topK: 5 },
    stated: false,
    systemone: false,
    reasoningForced: false,
    cache: false,
    contextWindowTokens: 8192,
    minOutputTokens: 1,
    ...patch,
  })
}

function choose(
  record: ModelCapabilityRecord,
  judge: JudgeCapability,
  kind: JudgeQuestion['type'] = 'noul',
): ByoTechniqueDecision {
  return chooseByoTechnique(record, judge, kind)
}

function chosen(decision: ByoTechniqueDecision) {
  expect(decision.outcome).toBe('chosen')
  if (decision.outcome !== 'chosen') {
    throw new Error('expected a technique')
  }
  return decision.choice
}

describe('chooseByoTechnique', () => {
  it('uses captured top-k, including a stated format recorded beside it', () => {
    const choice = chosen(
      choose(
        captured(ollama, {
          logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'ollama-chat' }),
          output: { formats: yes(['json_object', 'text']) },
        }),
        capability(),
      ),
    )
    expect(choice.technique).toBe('logprob')
    expect(choice.logprobs).toBe('topk')
    expect(choice.requestTopK).toBe(5)
    expect(choice.statedFormat).toBe('json_object')
    expect(choice.requiresEffortNone).toBe(false)
    expect(choice.minOutputTokens).toBe(1)
  })

  it('uses top-1 only for a noul and keeps the returned count at one', () => {
    const record = captured(ollama, {
      logprobs: yes({ kind: 'top1', dialect: 'ollama-chat' }),
    })
    const judge = capability({ logprobs: { kind: 'top1' } })
    const noul = chosen(choose(record, judge, 'noul'))
    expect(noul.technique).toBe('top1')
    expect(noul.requestTopK).toBe(1)
    expect(noul.statedFormat).toBeUndefined()
    expect(choose(record, judge, 'choice')).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(choose(record, judge, 'score')).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
  })

  it('states a choice or score on top-1 only when a structured format was captured', () => {
    const record = captured(ollama, {
      logprobs: yes({ kind: 'top1', dialect: 'ollama-chat' }),
      output: { formats: yes(['text', 'json_schema']) },
    })
    const judge = capability({ logprobs: { kind: 'top1' } })
    expect(chosen(choose(record, judge, 'choice')).technique).toBe('stated')
    expect(chosen(choose(record, judge, 'choice')).statedFormat).toBe('json_schema')
    expect(chosen(choose(record, judge, 'score')).technique).toBe('stated')
    expect(chosen(choose(record, judge, 'noul')).technique).toBe('top1')
  })

  it('lets a dropped or refused field state only on a captured structured format', () => {
    const dropped = capability({ logprobs: { kind: 'dropped' } })
    const refused = capability({ logprobs: { kind: 'refused' } })
    const bare = captured(ollama, { logprobs: denied })
    expect(choose(bare, dropped)).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(choose(bare, refused)).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    const stated = captured(ollama, {
      logprobs: denied,
      output: { formats: yes(['json_object']) },
    })
    expect(chosen(choose(stated, dropped))).toMatchObject({
      technique: 'stated',
      logprobs: 'dropped',
      statedFormat: 'json_object',
    })
    expect(chosen(choose(stated, refused)).logprobs).toBe('refused')
  })

  it('does not treat plain text or an unknown format list as a stated path', () => {
    const judge = capability({ logprobs: { kind: 'unknown' } })
    expect(choose(captured(ollama, { output: { formats: yes(['text']) } }), judge)).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(choose(captured(ollama), judge)).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
  })

  it('does not treat the stated flag as a captured format', () => {
    const decision = choose(
      captured(ollama, { logprobs: denied }),
      capability({ logprobs: { kind: 'dropped' }, stated: true }),
    )
    expect(decision).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
  })

  it('prefers strict_schema, then json_schema, forced_tool and json_object', () => {
    const judge = capability({ logprobs: { kind: 'dropped' } })
    const formats = ['json_object', 'forced_tool', 'json_schema', 'strict_schema', 'text'] as const
    expect(
      chosen(
        choose(
          captured(ollama, { logprobs: denied, output: { formats: yes([...formats]) } }),
          judge,
        ),
      ).statedFormat,
    ).toBe('strict_schema')
    expect(
      chosen(
        choose(
          captured(ollama, {
            logprobs: denied,
            output: { formats: yes(['json_object', 'forced_tool']) },
          }),
          judge,
        ),
      ).statedFormat,
    ).toBe('forced_tool')
  })

  it('does not infer top-1 from the provider name', () => {
    const identity = {
      provider: 'openai',
      nativeModel: 'gpt-4.1',
      format: 'responses' as const,
    }
    const decision = choose(
      captured(identity, { logprobs: { state: 'unknown' } }),
      capability({
        source: 'separate',
        providerId: 'openai',
        model: 'gpt-4.1',
        endpoint: 'https://api.openai.com',
        logprobs: { kind: 'unknown' },
      }),
    )
    expect(decision).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
  })

  it('still uses a captured top-k when the provider is one that often has logprobs', () => {
    const identity = {
      provider: 'openai',
      nativeModel: 'gpt-4.1',
      format: 'responses' as const,
    }
    const choice = chosen(
      choose(
        captured(identity, {
          logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'responses' }),
        }),
        capability({
          providerId: 'openai',
          model: 'gpt-4.1',
          endpoint: 'https://api.openai.com',
          logprobs: { kind: 'topk', topK: 5 },
        }),
      ),
    )
    expect(choice.technique).toBe('logprob')
    expect(choice.requestTopK).toBe(5)
  })

  it('does not let the dialect string choose the technique', () => {
    const judge = capability()
    const responses = chosen(
      choose(
        captured(ollama, {
          logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'responses' }),
        }),
        judge,
      ),
    )
    const chat = chosen(
      choose(
        captured(ollama, {
          logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'ollama-chat' }),
        }),
        judge,
      ),
    )
    expect(responses.technique).toBe('logprob')
    expect(chat.technique).toBe(responses.technique)
    expect(chat.requestTopK).toBe(responses.requestTopK)
  })

  it('refuses when the judge claim disagrees with the captured record', () => {
    const topk = captured(ollama, {
      logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'ollama-chat' }),
    })
    expect(choose(topk, capability({ logprobs: { kind: 'top1' } }))).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(choose(topk, capability({ logprobs: { kind: 'topk', topK: 6 } }))).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    const unknown = captured(ollama)
    expect(choose(unknown, capability({ logprobs: { kind: 'topk', topK: 5 } }))).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
  })

  it('keeps two models on one provider on their own records', () => {
    const provider = { provider: 'ollama', format: 'ollama' as const }
    const first = chosen(
      choose(
        captured(
          { ...provider, nativeModel: 'qwen3:4b-instruct-2507-q4_K_M' },
          { logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'ollama-chat' }) },
        ),
        capability(),
      ),
    )
    const second = choose(
      captured({ ...provider, nativeModel: 'other:7b' }, { logprobs: denied }),
      capability({ model: 'other:7b', logprobs: { kind: 'dropped' } }),
    )
    expect(first.technique).toBe('logprob')
    expect(second).toEqual({ outcome: 'no-answer', reason: 'capability-unavailable' })
  })

  it('copies requiresEffortNone and the output floor only from the record', () => {
    const effort = chosen(
      choose(
        captured(ollama, {
          logprobs: yes({
            kind: 'topk',
            maxTopK: 5,
            dialect: 'ollama-chat',
            requiresEffortNone: true,
            minOutputTokens: 7,
          }),
        }),
        capability(),
      ),
    )
    expect(effort.requiresEffortNone).toBe(true)
    expect(effort.minOutputTokens).toBe(7)
    const fromOutput = chosen(
      choose(
        captured(ollama, {
          logprobs: yes({ kind: 'top1', dialect: 'ollama-chat', requiresEffortNone: false }),
          output: { minTokens: 9 },
        }),
        capability({ logprobs: { kind: 'top1' } }),
      ),
    )
    expect(fromOutput.requiresEffortNone).toBe(false)
    expect(fromOutput.minOutputTokens).toBe(9)
  })

  it('honors both captured output and judge minimums (P2.7)', () => {
    const record = captured(ollama, {
      logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'ollama-chat', minOutputTokens: 1 }),
      output: { minTokens: 9 },
    })
    expect(chosen(choose(record, capability({ minOutputTokens: 12 }))).minOutputTokens).toBe(12)
    expect(chosen(choose(record, capability())).minOutputTokens).toBe(9)
  })

  it('refuses an identity or served-version mismatch', () => {
    const record = captured(
      { ...ollama, servedVersion: 'rev-a' },
      { logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'ollama-chat' }) },
    )
    const judge = capability({ modelVersion: 'rev-a' })
    expect(chosen(choose(record, judge)).technique).toBe('logprob')
    expect(choose(record, capability({ modelVersion: 'rev-b' }))).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(choose(record, capability({ providerId: 'other', modelVersion: 'rev-a' }))).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
    expect(choose(record, capability({ model: 'other', modelVersion: 'rev-a' }))).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
  })

  it('refuses a capability object the contract does not accept', () => {
    const broken = { ...capability(), contextWindowTokens: 0 } as JudgeCapability
    expect(choose(captured(ollama), broken)).toEqual({
      outcome: 'no-answer',
      reason: 'capability-unavailable',
    })
  })
})
