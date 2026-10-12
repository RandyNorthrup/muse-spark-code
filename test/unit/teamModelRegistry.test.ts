import { describe, expect, it } from 'vitest'
import {
  buildTeamModelOffers,
  observedTeamLimits,
  teamControls,
} from '../../src/core/team/teamModelRegistry'
import { metaCapabilityRecord } from '../../src/core/providers/capabilityRecord'
import type { TeamEngineModel } from '../../src/core/team/teamModelRegistry'
import type { UsageLimitSnapshot } from '../../src/shared/usageJournal'

const base = metaCapabilityRecord('muse-spark-1.3')
const engine = (provider = 'meta', preset = provider): TeamEngineModel => ({
  model: {
    modelId: provider === 'meta' ? 'muse-spark-1.3' : `${provider}/captured`,
    providerId: provider,
    displayLabel: provider,
    isDefault: true,
    isActive: false,
    contextLimit: undefined,
  },
  record: { ...base, identity: { ...base.identity, provider } },
  preset,
})
const input = {
  engine: [engine()],
  museCode: [],
  limits: [],
  maxWorkers: 2,
  canRunKind: () => true,
}
const limit = (observedAt: number, raw: UsageLimitSnapshot['raw']): UsageLimitSnapshot => ({
  v: 1,
  id: `limit-${String(observedAt)}`,
  at: observedAt,
  day: '2026-10-11',
  timezoneOffsetMins: 0,
  client: 'VS Code',
  backend: 'modelApi',
  provider: 'openai',
  type: 'limit',
  source: 'headers',
  observedAt,
  windows: [],
  raw,
})
const stamped = (
  provider: string,
  observedAt: number,
  observedAccount: string,
): UsageLimitSnapshot => ({
  ...limit(observedAt, { 'x-ratelimit-limit-requests': '10000' }),
  provider,
  observedAccount,
})
const offersWith = (
  current: Record<string, string | undefined>,
  limits: readonly UsageLimitSnapshot[],
): ReturnType<typeof buildTeamModelOffers> =>
  buildTeamModelOffers({
    ...input,
    engine: [engine(), engine('openai')],
    limits,
    currentAccountOf: (provider: string) => current[provider],
  })
describe('captured team discovery', () => {
  it('uses the documented Meta tier under the machine ceiling', () => {
    expect(buildTeamModelOffers(input).offers[0]).toMatchObject({
      ref: 'engine:muse-spark-1.3',
      ceiling: 2,
      inputRate: 1.25,
    })
  })
  it('omits an unavailable worker and an uncaptured tool capability', () => {
    expect(buildTeamModelOffers({ ...input, canRunKind: () => false }).absent).toEqual([
      { provider: 'meta', reason: 'worker' },
    ])
    const item = engine()
    const record = {
      ...item.record,
      tools: { ...item.record.tools, calling: { state: 'unknown' } },
    } satisfies TeamEngineModel['record']
    expect(buildTeamModelOffers({ ...input, engine: [{ ...item, record }] }).offers).toEqual([])
  })
  it('uses only the latest account limit instead of reviving an older quota', () => {
    const result = buildTeamModelOffers({
      ...input,
      engine: [engine('openai')],
      limits: [limit(1, { 'x-ratelimit-limit-requests': '10000' }), limit(2, {})],
    })
    expect(result.offers).toEqual([])
    expect(result.absent).toEqual([{ provider: 'openai', reason: 'limits' }])
  })
  it('drops a replaced key quota and omits offers unknown for the current account', () => {
    // The old account's generous headers no longer produce a ceiling once the
    // key changes, even though they are newer than nothing: the offer is
    // omitted with the limits reason.
    const switched = buildTeamModelOffers({
      ...input,
      engine: [engine('openai')],
      limits: [stamped('openai', 2, 'old-account')],
      currentAccountOf: () => 'new-account',
    })
    expect(switched.offers).toEqual([])
    expect(switched.absent).toEqual([{ provider: 'openai', reason: 'limits' }])
    // An unstamped observation is not known for a keyed account either.
    const unstamped = buildTeamModelOffers({
      ...input,
      engine: [engine('openai')],
      limits: [limit(2, { 'x-ratelimit-limit-requests': '10000' })],
      currentAccountOf: () => 'new-account',
    })
    expect(unstamped.offers).toEqual([])
    expect(unstamped.absent).toEqual([{ provider: 'openai', reason: 'limits' }])
    // The current account's own observation still yields a ceiling.
    const current = buildTeamModelOffers({
      ...input,
      engine: [engine('openai')],
      limits: [stamped('openai', 1, 'old-account'), stamped('openai', 2, 'new-account')],
      currentAccountOf: () => 'new-account',
    })
    expect(current.offers).toHaveLength(1)
    expect(current.absent).toEqual([])
  })
  // P2-4: identity is per provider. Meta plus OpenAI configured, rotate only
  // the OpenAI key: the old OpenAI quota gives no offer, Meta is untouched.
  it('keeps each provider on its own credential identity when one key rotates', () => {
    const rows = [stamped('meta', 1, 'meta-account'), stamped('openai', 2, 'openai-old')]
    // Before rotation both offer.
    const before = offersWith({ meta: 'meta-account', openai: 'openai-old' }, rows)
    expect(before.offers.map((offer) => offer.ref)).toContain('engine:muse-spark-1.3')
    expect(before.offers.map((offer) => offer.ref)).toContain('engine:openai/captured')
    // After rotating only the OpenAI key the old OpenAI quota gives no offer.
    const rotated = offersWith({ meta: 'meta-account', openai: 'openai-new' }, rows)
    expect(rotated.offers.map((offer) => offer.ref)).toContain('engine:muse-spark-1.3')
    expect(rotated.offers.map((offer) => offer.ref)).not.toContain('engine:openai/captured')
    expect(rotated.absent).toContainEqual({ provider: 'openai', reason: 'limits' })
    // A provider with no known identity keeps legacy unattributed matching.
    const unknown = offersWith({ meta: 'meta-account' }, rows)
    expect(unknown.offers.map((offer) => offer.ref)).toContain('engine:openai/captured')
  })
  it('does not mistake daily Groq requests or router upstreams for provider RPM', () => {
    expect(
      observedTeamLimits('groq', {
        'x-ratelimit-limit-requests': '14400',
        'x-ratelimit-limit-tokens': '6000',
      }),
    ).toEqual({ tpm: 6000 })
    expect(
      observedTeamLimits('huggingface', { 'x-ratelimit-limit-requests': '14400' }),
    ).toBeUndefined()
    expect(observedTeamLimits('openai', { 'x-ratelimit-limit-requests': 'NaN' })).toBeUndefined()
  })
  it('uses the narrowest captured Anthropic token limit', () => {
    expect(
      observedTeamLimits('anthropic', {
        'anthropic-ratelimit-requests-limit': '50',
        'anthropic-ratelimit-input-tokens-limit': '100000',
        'anthropic-ratelimit-output-tokens-limit': '10000',
      }),
    ).toEqual({ rpm: 50, tpm: 10_000 })
  })
  it('retains hard and machine ceilings for captured providers without numeric quota headers', () => {
    expect(buildTeamModelOffers({ ...input, engine: [engine('gemini')] }).offers[0]?.ceiling).toBe(
      2,
    )
    expect(buildTeamModelOffers({ ...input, maxWorkers: 0 }).offers).toEqual([])
    expect(buildTeamModelOffers({ ...input, engine: [engine('uncaptured')] }).offers).toEqual([])
  })
  it('shows only settings carried to the actual session', () => {
    const record = {
      ...base,
      reasoning: {
        ...base.reasoning,
        effortLevels: { state: 'yes', value: ['low', 'high'], source: { kind: 'capture' } },
      },
      output: {
        ...base.output,
        acceptsLimit: { state: 'yes', value: true, source: { kind: 'capture' } },
        maxTokens: 2048,
      },
      sampling: {
        ...base.sampling,
        topP: { state: 'yes', value: true, source: { kind: 'capture' } },
      },
    } satisfies TeamEngineModel['record']
    expect(teamControls(record).map((row) => row.key)).toEqual(['effort', 'outputCap'])
  })
})
