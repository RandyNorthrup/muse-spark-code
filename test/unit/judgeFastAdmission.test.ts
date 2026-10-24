// M125 lane P (D107 §4.1): engine admission over M95 records. Every
// predicate fails closed; hosted siblings pass the same predicates as
// local engines; the mirrored M98 readings stay pinned to their
// sources, so a drift fails here instead of dispatching wrong.
import { describe, expect, it } from 'vitest'
import {
  capabilityEffortLevels,
  resolveModelCapabilities,
} from '../../src/core/providers/capabilityRecord'
import { presetById } from '../../src/core/providers/presets'
import {
  engineRoles,
  fastEffortScale,
  judgeEffortScale,
  hasLogprobWire,
  hasStatedWire,
} from '../../src/core/judge/fast/engines'
import { BYO_STATED_FORMATS } from '../../src/core/judge/providers/decide'
import { record, yes } from './helpers/userCapabilities'

describe('fast engine admission', () => {
  it('admits the logprob wire only on affirmed top-5', () => {
    const affirmed = record({
      logprobs: yes({ kind: 'topk', maxTopK: 5, dialect: 'openai' }),
    })
    expect(hasLogprobWire(affirmed)).toBe(true)
    expect(hasLogprobWire(record())).toBe(false)
    expect(hasLogprobWire(record({ logprobs: yes({ kind: 'top1', dialect: 'openai' }) }))).toBe(
      false,
    )
    expect(
      hasLogprobWire(record({ logprobs: yes({ kind: 'topk', maxTopK: 4, dialect: 'x' }) })),
    ).toBe(false)
    expect(hasLogprobWire(record({ logprobs: yes({ kind: 'topk', dialect: 'unbounded' }) }))).toBe(
      false,
    )
  })

  it('admits the stated wire only on a captured structured format', () => {
    expect(hasStatedWire(record({ output: { formats: yes(['text', 'json_schema']) } }))).toBe(true)
    expect(hasStatedWire(record())).toBe(false)
    expect(hasStatedWire(record({ output: { formats: yes(['text']) } }))).toBe(false)
  })

  it('reads the effort scale off the record, empty when unnamed', () => {
    const scaled = record({
      reasoning: { effortLevels: yes(['low', 'medium', 'high']) },
    })
    expect(judgeEffortScale(scaled)).toEqual(['low', 'medium', 'high'])
    expect(judgeEffortScale(record())).toEqual([])
  })

  it('combines every role, all fail-closed', () => {
    expect(engineRoles(record())).toEqual({ logprobs: false, stated: false, effort: [] })
  })

  it('reads the record first, the policy only without one', () => {
    const policy = { state: 'yes' as const, value: ['low', 'medium', 'high'] }
    const unknown = { state: 'unknown' as const }
    // No record: the policy keeps today's same-model behaviour.
    expect(fastEffortScale(undefined, policy)).toEqual(['low', 'medium', 'high'])
    expect(fastEffortScale(undefined, unknown)).toEqual([])
    // A record wins either way: its scale, or nothing when silent.
    const scaled = record({ reasoning: { effortLevels: yes(['a', 'b']) } })
    expect(fastEffortScale(scaled, unknown)).toEqual(['a', 'b'])
    expect(fastEffortScale(record(), policy)).toEqual([])
  })

  it('flows the preset patches into the scale the fast path lowers on', () => {
    const patch = presetById('xai')?.reasoningFacts?.find((fact) => fact.modelId === 'grok-4.5')
    if (patch === undefined) throw new Error('xai grok-4.5 reasoning patch missing')
    const identity = { provider: 'xai', nativeModel: 'grok-4.5', format: 'chat' as const }
    const bare = resolveModelCapabilities(identity, [])
    const patched = resolveModelCapabilities(identity, [
      {
        source: { kind: 'preset', ref: `${patch.docUrl} (read ${patch.readOn})` },
        fields: patch.fields,
      },
    ])
    expect(judgeEffortScale(bare)).toEqual([])
    // The documented names, `xhigh` included: the catalogue lists only
    // low/medium/high, so without the patch the scale stays empty.
    expect(judgeEffortScale(patched)).toEqual(['low', 'medium', 'high', 'xhigh'])
  })

  it('pins the mirrored M98 readings to their sources', () => {
    // The stated set is BYO_STATED_FORMATS: a drift here fails loudly.
    for (const format of BYO_STATED_FORMATS) {
      expect(hasStatedWire(record({ output: { formats: yes(['text', format]) } }))).toBe(true)
    }
    // The effort read is capabilityEffortLevels over the same records.
    const rows = [
      record(),
      record({ reasoning: { effortLevels: yes(['a', 'b']) } }),
      record({ logprobs: yes({ kind: 'topk', maxTopK: 20, dialect: 'openai' }) }),
    ]
    for (const row of rows) {
      expect(judgeEffortScale(row)).toEqual(capabilityEffortLevels(row))
    }
  })
})
