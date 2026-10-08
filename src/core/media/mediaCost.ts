// M105 C / D85.6–7. Metadata and billed usage only; never encoded media or
// input_tokens media counts. The caller injects evidence, tariffs and stores.
import * as z from 'zod/mini'
import {
  MEDIA_CONTRIBUTOR_CHOICES,
  MEDIA_ID_MAX_CHARS,
  MODEL_API_MEDIA_PER_REQUEST,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Usd, type UsdAmount } from '../../shared/usd'
import { mediaInfoSchema, mediaEstimateSchema, type MediaInfo } from '../../shared/media'
import { usageSchema, type Usage } from '../backends/modelapi/schemas'
import type { CoreLogger } from '../logging'

const positive = z.number().check(z.gt(0))
const tokens = z.int().check(z.gte(0), z.lte(Number.MAX_SAFE_INTEGER))
const id = z.string().check(z.minLength(1), z.maxLength(MEDIA_ID_MAX_CHARS))
const variantSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('video'), fps: z.nullable(positive) }),
  z.strictObject({ kind: z.literal('audio') }),
  z.strictObject({ kind: z.literal('document') }),
  z.strictObject({ kind: z.literal('image'), detail: z.enum(['auto', 'low', 'high', 'original']) }),
])

const pointSchema = z.strictObject({
  provider: id,
  modelId: id,
  variant: variantSchema,
  units: positive,
  inputTokens: tokens,
  captureId: id,
  // A mixed turn cannot attribute tokens to a particular item. Its complete
  // bill supplies an upper observation for each item, never a typical rate.
  upperOnly: z.boolean(),
})
type CalibrationPoint = z.infer<typeof pointSchema>

export interface MediaCostItem {
  readonly info: MediaInfo
  /** null/absent means provider default, kept distinct from explicit fps. */
  readonly fps?: number
  readonly detail?: 'auto' | 'low' | 'high' | 'original'
}

function measurement(item: MediaCostItem):
  | {
      variant: z.infer<typeof variantSchema>
      units: number | null
    }
  | undefined {
  const info = mediaInfoSchema.parse(item.info)
  switch (info.kind) {
    case 'video': {
      return { variant: { kind: 'video', fps: item.fps ?? null }, units: info.durationSeconds }
    }
    case 'audio': {
      return { variant: { kind: 'audio' }, units: info.durationSeconds }
    }
    case 'document': {
      return { variant: { kind: 'document' }, units: info.pageCount ?? null }
    }
    case 'image': {
      return { variant: { kind: 'image', detail: item.detail ?? 'auto' }, units: 1 }
    }
    case 'text': {
      return undefined
    }
  }
}

function hasSameRate(a: CalibrationPoint, provider: string, modelId: string, variant: unknown) {
  return (
    a.provider === provider &&
    a.modelId === modelId &&
    JSON.stringify(a.variant) === JSON.stringify(variant)
  )
}

/** Local store reads are untrusted and validated before they become rates. */
export class MediaCostEstimator {
  private points: CalibrationPoint[]
  private pendingSave = Promise.resolve()

  public constructor(
    private readonly deps: {
      readonly read: () => unknown
      readonly write: (points: readonly CalibrationPoint[]) => Promise<void>
      /** Lane W supplies MEDIA_ESTIMATE_SAFETY_FACTOR; no rate is invented here. */
      readonly safetyFactor: number
    },
  ) {
    z.number().check(z.gte(1)).parse(deps.safetyFactor)
    this.points = z.array(pointSchema).parse(deps.read())
  }

  /** Missing evidence stays unknown, and is a named refusal under a cap. */
  public estimate(provider: string, modelId: string, item: MediaCostItem, isCapped: boolean) {
    const measured = measurement(item)
    if (measured === undefined) throw new Error('Text belongs to the text estimator')
    const variant = variantSchema.parse(measured.variant)
    const matches = this.points.filter((point) => hasSameRate(point, provider, modelId, variant))
    const calibrated = matches.filter((point) => !point.upperOnly)
    if (measured.units === null || calibrated.length === 0) {
      if (isCapped) {
        throw new Error(
          measured.units === null && ['video', 'audio'].includes(variant.kind)
            ? UI_TEXT.media.cappedDurationUnknown
            : fill(UI_TEXT.media.cappedRateUnknown, { model: modelId }),
        )
      }
      return
    }
    const units = measured.units
    // Nearest recorded rate gives an estimate, without claiming a linear
    // fit from captures we do not have. The largest rate reserves all bills.
    let nearest = calibrated[0]
    let largestRate = 0
    for (const point of matches) {
      largestRate = Math.max(largestRate, point.inputTokens / point.units)
      if (
        !point.upperOnly &&
        (nearest === undefined || Math.abs(point.units - units) < Math.abs(nearest.units - units))
      )
        nearest = point
    }
    if (nearest === undefined) throw new Error('A calibrated rate is required')
    const estimatedInputTokens = Math.ceil((nearest.inputTokens / nearest.units) * units)
    const upperBoundInputTokens = Math.ceil(largestRate * units * this.deps.safetyFactor)
    tokens.parse(upperBoundInputTokens)
    return { estimatedInputTokens, upperBoundInputTokens }
  }

  /** The chip names tier prices supplied by the verified selected-model record. */
  public chipEstimate(
    provider: string,
    modelId: string,
    item: MediaCostItem,
    prices: {
      readonly standardInput: number
      readonly contributorInput?: number
    },
    isCapped: boolean,
  ) {
    const estimate = this.estimate(provider, modelId, item, isCapped)
    if (estimate === undefined) return
    for (const price of Object.values(prices)) z.number().check(z.gte(0)).parse(price)
    return mediaEstimateSchema.parse({
      ...estimate,
      standardCostUsd: Usd.from(prices.standardInput)
        .times(estimate.estimatedInputTokens)
        .divide(TOKENS_PER_MILLION)
        .toAmount(),
      ...(prices.contributorInput !== undefined && {
        contributorCostUsd: Usd.from(prices.contributorInput)
          .times(estimate.estimatedInputTokens)
          .divide(TOKENS_PER_MILLION)
          .toAmount(),
      }),
    })
  }

  /** Every verified bill is local evidence; mixed bills only raise the bound. */
  public async observe(
    provider: string,
    modelId: string,
    items: readonly MediaCostItem[],
    usage: Usage,
    captureId: string,
  ): Promise<void> {
    const reported = usageSchema.parse(usage)
    tokens.parse(reported.input_tokens)
    const additions = items.flatMap((item) => {
      const measured = measurement(item)
      if (measured?.units === undefined || measured.units === null) return []
      return [
        pointSchema.parse({
          provider,
          modelId,
          ...measured,
          inputTokens: reported.input_tokens,
          captureId,
          upperOnly: items.length !== 1,
        }),
      ]
    })
    const previous = this.pendingSave
    const save = async () => {
      try {
        await previous
      } catch {
        // Its caller already received the failure; a later bill still saves.
      }
      const next = [...this.points, ...additions]
      await this.deps.write(next)
      this.points = next
    }
    const saving = save()
    this.pendingSave = saving
    await saving
  }
}

/** Metadata, selected-model tariff and both existing ledgers are injected. */
export interface MediaCostClaim {
  check(): void
  settle(costUsd: UsdAmount, hasUnknownCost?: boolean): Promise<unknown>
}
export interface MediaCostLedger {
  reserve(costUsd: UsdAmount): Promise<MediaCostClaim>
}
export interface MediaRequestAccounting {
  readonly modelId: string
  readonly maxOutputTokens: number
  readonly inputTokens: number
  readonly reservedUsd: UsdAmount
  check(): void
  started(): void
  refused(): void
  rebindDaily(reserve: () => Promise<MediaCostClaim>): Promise<void>
  settle(usage: Usage): Promise<void>
  finish(): Promise<void>
}

/** Reserve the whole request at list price; cache discounts only settle bills. */
export async function reserveMediaRequest(request: {
  readonly provider: string
  readonly modelId: string
  readonly items: readonly MediaCostItem[]
  readonly textInputTokens: number
  readonly maxOutputTokens: number
  readonly captureId: string
  readonly estimator: MediaCostEstimator
  readonly log: Pick<CoreLogger, 'warn'>
  readonly prices: { readonly input: number; readonly output: number; readonly cachedInput: number }
  readonly session: MediaCostLedger
  readonly daily: MediaCostLedger
}): Promise<MediaRequestAccounting> {
  // Snapshot what is admitted, so later model/attachment changes cannot
  // alter a dispatched request's tariff or calibration observation.
  request = {
    ...request,
    prices: { ...request.prices },
    items: request.items.map((item) => ({ ...item, info: mediaInfoSchema.parse(item.info) })),
  }
  z.array(z.unknown())
    .check(z.minLength(1), z.maxLength(MODEL_API_MEDIA_PER_REQUEST))
    .parse(request.items)
  tokens.parse(request.textInputTokens)
  tokens.parse(request.maxOutputTokens)
  for (const price of Object.values(request.prices)) z.number().check(z.gte(0)).parse(price)
  let inputTokens = request.textInputTokens
  for (const item of request.items) {
    const estimate = request.estimator.estimate(request.provider, request.modelId, item, true)
    if (estimate === undefined)
      throw new Error(fill(UI_TEXT.media.cappedRateUnknown, { model: request.modelId }))
    inputTokens += estimate.upperBoundInputTokens
  }
  tokens.parse(inputTokens)
  const prices = {
    input: Usd.from(request.prices.input),
    output: Usd.from(request.prices.output),
    cachedInput: Usd.from(request.prices.cachedInput),
  }
  const reservedUsd = prices.input
    .times(inputTokens)
    .add(prices.output.times(request.maxOutputTokens))
    .divide(TOKENS_PER_MILLION)
    .toAmount()
  if (prices.cachedInput.compare(prices.input) > 0)
    throw new Error('Cache tariff exceeds list price')
  const session = await request.session.reserve(reservedUsd)
  let daily: MediaCostClaim
  try {
    daily = await request.daily.reserve(reservedUsd)
  } catch (error: unknown) {
    await session.settle(Usd.from(0).toAmount())
    throw error
  }
  let wasSent = false
  let isRebinding = false
  const closed = new Set<MediaCostClaim>()
  // Selecting the terminal outcome is synchronous. Every settle/finish caller
  // then shares its write; a failed ledger write retries only unclosed claims.
  let settled: { costUsd: UsdAmount; hasUnknownCost: boolean; usage?: Usage } | undefined
  let completion: Promise<void> | undefined
  const complete = () => {
    if (completion !== undefined) return completion
    const bill = settled
    if (bill === undefined) throw new Error('Media settlement has no terminal outcome')
    const write = async () => {
      // Publish completion before a ledger can reenter settle/finish.
      await Promise.resolve()
      try {
        const results = await Promise.allSettled(
          [session, daily]
            .filter((claim) => !closed.has(claim))
            .map(async (claim) => {
              await claim.settle(bill.costUsd, bill.hasUnknownCost)
              closed.add(claim)
            }),
        )
        for (const result of results) if (result.status === 'rejected') throw result.reason
        if (bill.usage !== undefined) {
          try {
            await request.estimator.observe(
              request.provider,
              request.modelId,
              request.items,
              bill.usage,
              request.captureId,
            )
          } catch {
            // Local calibration is optional evidence, not the provider result.
            // Fixed words keep a store's error text (possibly a path) out of logs.
            request.log.warn('Media calibration cache write failed')
          }
        }
      } catch (error: unknown) {
        completion = undefined
        throw error
      }
    }
    completion = write()
    return completion
  }
  return {
    modelId: request.modelId,
    maxOutputTokens: request.maxOutputTokens,
    inputTokens,
    reservedUsd,
    async rebindDaily(reserve) {
      // The schedule replaces the shared-day claim; retaining both would double charge.
      if (wasSent || settled !== undefined || isRebinding || closed.has(daily))
        throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
      isRebinding = true
      try {
        const replacement = await reserve()
        try {
          await daily.settle(Usd.from(0).toAmount())
        } catch (error: unknown) {
          await replacement.settle(Usd.from(0).toAmount())
          throw error
        }
        closed.add(daily)
        daily = replacement
      } finally {
        isRebinding = false
      }
    },
    check() {
      // An uncertain first dispatch never spends the same claims on a retry.
      if (wasSent || settled !== undefined || isRebinding || closed.has(daily))
        throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
      session.check()
      daily.check()
    },
    started() {
      if (wasSent || settled !== undefined || isRebinding || closed.has(daily))
        throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
      wasSent = true
    },
    refused() {
      if (settled !== undefined) throw new Error(UI_TEXT.sessionBudgetRetryUnavailable)
      wasSent = false
    },
    async settle(usage) {
      if (settled !== undefined) {
        await complete()
        return
      }
      if (!wasSent) throw new Error('Unsent media cannot have billed usage')
      const reported = usageSchema.parse(usage)
      const input = tokens.parse(reported.input_tokens)
      const output = tokens.parse(reported.output_tokens)
      const cached = tokens.parse(reported.input_tokens_details?.cached_tokens ?? 0)
      if (cached > input) throw new Error('Cached usage exceeds input usage')
      const costUsd = prices.input
        .times(input - cached)
        .add(prices.cachedInput.times(cached))
        .add(prices.output.times(output))
        .divide(TOKENS_PER_MILLION)
        .toAmount()
      settled = { costUsd, hasUnknownCost: false, usage: reported }
      await complete()
    },
    async finish() {
      settled ??= {
        costUsd: wasSent ? reservedUsd : Usd.from(0).toAmount(),
        hasUnknownCost: wasSent,
      }
      await complete()
    },
  }
}

/** Every editor asks through its own modal/permission bridge, before upload. */
export class MediaContributorConsent {
  private readonly allowed = new Set<string>()
  private readonly pending = new Map<string, Promise<'send' | 'useStandard' | 'remove'>>()

  public constructor(
    private readonly ask: (question: {
      readonly title: string
      readonly detail: string
      readonly choices: typeof MEDIA_CONTRIBUTOR_CHOICES
    }) => Promise<'send' | 'useStandard' | 'remove'>,
  ) {}

  public async choose(request: {
    readonly conversationId: string
    readonly name: string
    readonly info: MediaInfo
    readonly contributor: boolean
    readonly isScreenRecording: boolean
  }) {
    const isSensitive = ['video', 'audio'].includes(request.info.kind)
    if (
      !request.isScreenRecording &&
      (!isSensitive || !request.contributor || this.allowed.has(request.conversationId))
    )
      return 'send'
    const decide = async () => {
      const choice = z.enum(MEDIA_CONTRIBUTOR_CHOICES).parse(
        await this.ask({
          title: request.contributor
            ? fill(UI_TEXT.media.contributorQuestion, { name: request.name })
            : UI_TEXT.media.recordingWarning,
          detail: request.isScreenRecording
            ? UI_TEXT.media.recordingWarning
            : UI_TEXT.media.contributorWarning,
          choices: MEDIA_CONTRIBUTOR_CHOICES,
        }),
      )
      if (choice === 'send' && request.contributor) this.allowed.add(request.conversationId)
      return choice
    }
    if (request.isScreenRecording) return await decide()
    const pending = this.pending.get(request.conversationId)
    if (pending !== undefined) return await pending
    const decision = decide()
    this.pending.set(request.conversationId, decision)
    try {
      return await decision
    } finally {
      this.pending.delete(request.conversationId)
    }
  }
}
