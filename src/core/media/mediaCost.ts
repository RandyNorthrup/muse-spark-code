import { SpendLedgerError } from '../paid/spendLedgerError'
// M105 C / D85.6–7. Metadata and billed usage only; never encoded media or
// input_tokens media counts. The caller injects evidence, tariffs and stores.
import * as z from 'zod/mini'
import { UserRefusalError } from '../refusal'
import {
  MEDIA_CALIBRATION_IMAGE_MAX_HEIGHT,
  MEDIA_CALIBRATION_IMAGE_MAX_WIDTH,
  MEDIA_CALIBRATION_VIDEO_MAX_SECONDS,
  MEDIA_ID_MAX_CHARS,
  MODEL_API_MEDIA_PER_REQUEST,
  TOKENS_PER_MILLION,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { Usd, usdAmountSchema, type UsdAmount } from '../../shared/usd'
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

export const calibrationPointSchema = z.strictObject({
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
export type CalibrationPoint = z.infer<typeof calibrationPointSchema>
const pointSchema = calibrationPointSchema

export interface MediaCostItem {
  readonly info: MediaInfo
  /** null/absent means provider default, kept distinct from explicit fps. */
  readonly fps?: number | undefined
  readonly detail?: 'auto' | 'low' | 'high' | 'original' | undefined
  /** Inline-priced visuals (image/PDF reads): the bound reserves, but the
  provider-counted inline bytes never become a calibration observation. */
  readonly inlinePriced?: boolean
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
      /** Merges settlements under the calibration store's mutex when bound. */
      readonly withLock?: <T>(operation: () => Promise<T>) => Promise<T>
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
    // The calibration envelope (D85.6): size changes image usage and no
    // image above 3000x2000 was captured, so a larger image has no rate to
    // match even though its detail variant does. Video past 600 seconds
    // extrapolates a rate curve evidenced only to there. Both stay refused
    // under a cap rather than bounded on a guess. Higher fps values refuse
    // through the variant match below: only seeded fps values match.
    const isOversizeImage =
      variant.kind === 'image' &&
      item.info.kind === 'image' &&
      ((item.info.width !== undefined && item.info.width > MEDIA_CALIBRATION_IMAGE_MAX_WIDTH) ||
        (item.info.height !== undefined && item.info.height > MEDIA_CALIBRATION_IMAGE_MAX_HEIGHT))
    const isOverlongVideo =
      variant.kind === 'video' &&
      measured.units !== null &&
      measured.units > MEDIA_CALIBRATION_VIDEO_MAX_SECONDS
    const isUnmeasured = isOversizeImage || isOverlongVideo
    if (!isCapped && isUnmeasured) return
    if (isUnmeasured) throw new Error(fill(UI_TEXT.media.cappedRateUnknown, { model: modelId }))
    const matches = this.points.filter((point) => hasSameRate(point, provider, modelId, variant))
    const calibrated = matches.filter((point) => !point.upperOnly)
    if (measured.units === null || calibrated.length === 0) {
      if (isCapped) {
        throw new UserRefusalError(
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
    options?: { readonly mixed?: boolean },
  ): Promise<void> {
    const reported = usageSchema.parse(usage)
    tokens.parse(reported.input_tokens)
    // The caller filters inline-priced visuals before observing: the bill
    // still covers them, so one remaining item of a mixed request is an upper
    // observation, never a typical rate.
    const isMixed = options?.mixed === true || items.length !== 1
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
          upperOnly: isMixed,
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
      if (this.deps.withLock === undefined) {
        const next = [...this.points, ...additions]
        await this.deps.write(next)
        this.points = next
        return
      }
      // Two live sessions settle under the shared mutex: re-read inside it
      // and merge by capture id, so the second settlement keeps the first.
      await this.deps.withLock(async () => {
        const fresh = z.array(pointSchema).parse(this.deps.read())
        const known = new Set(fresh.map((point) => point.captureId))
        const unseen = additions.filter((point) => !known.has(point.captureId))
        if (unseen.length === 0) {
          this.points = fresh
          return
        }
        const merged = [...fresh, ...unseen]
        await this.deps.write(merged)
        this.points = merged
      })
    }
    const saving = save()
    this.pendingSave = saving
    await saving
  }
}

/** A scheduled run's own day claim for a media request (D95): checked before the send, settled after. */
export interface MediaCostClaim {
  check(): void
  /** Its cost from the reported usage; `undefined` when it went out and none came back. */
  settle(costUsd: UsdAmount | undefined): Promise<unknown>
}
export interface MediaRequestAccounting {
  readonly modelId: string
  readonly maxOutputTokens: number
  readonly inputTokens: number
  /** The whole request at list price: compared with a limit, never counted as spent (D121). */
  readonly estimateUsd: UsdAmount
  check(): void
  started(): void
  refused(): void
  rebindDaily(reserve: () => Promise<MediaCostClaim>): Promise<void>
  settle(usage: Usage): Promise<void>
  finish(): Promise<void>
}

/** Estimate the whole request at list price; cache discounts only settle bills. */
export function reserveMediaRequest(request: {
  readonly provider: string
  readonly modelId: string
  readonly items: readonly MediaCostItem[]
  readonly textInputTokens: number
  readonly maxOutputTokens: number
  readonly captureId: string
  readonly estimator: MediaCostEstimator
  readonly log: Pick<CoreLogger, 'warn'>
  readonly prices: {
    readonly input: UsdAmount
    readonly output: UsdAmount
    readonly cachedInput: UsdAmount
  }
}): MediaRequestAccounting {
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
  for (const price of Object.values(request.prices))
    if (!usdAmountSchema.safeParse(price).success || Usd.from(price).compare(Usd.from(0)) < 0)
      throw new SpendLedgerError('integrity', { scope: 'account', file: 'mediaCost' })
  let inputTokens = request.textInputTokens
  for (const item of request.items) {
    const estimate = request.estimator.estimate(request.provider, request.modelId, item, true)
    if (estimate === undefined)
      throw new UserRefusalError(fill(UI_TEXT.media.cappedRateUnknown, { model: request.modelId }))
    inputTokens += estimate.upperBoundInputTokens
  }
  tokens.parse(inputTokens)
  const prices = {
    input: Usd.from(request.prices.input),
    output: Usd.from(request.prices.output),
    cachedInput: Usd.from(request.prices.cachedInput),
  }
  const estimateUsd = prices.input
    .times(inputTokens)
    .add(prices.output.times(request.maxOutputTokens))
    .divide(TOKENS_PER_MILLION)
    .toAmount()
  if (prices.cachedInput.compare(prices.input) > 0)
    throw new Error('Cache tariff exceeds list price')
  // A scheduled run binds its own day claim before the send (rebindDaily).
  let daily: MediaCostClaim | undefined
  let wasSent = false
  let isRebinding = false
  let isDailyClosed = false
  // Selecting the terminal outcome is synchronous. Every settle/finish caller
  // then shares its write; a failed write retries on the next call.
  let settled: { costUsd: UsdAmount | undefined; usage?: Usage } | undefined
  let completion: Promise<void> | undefined
  const complete = () => {
    if (completion !== undefined) return completion
    const bill = settled
    if (bill === undefined) throw new Error('Media settlement has no terminal outcome')
    const write = async () => {
      // Publish completion before a ledger can reenter settle/finish.
      await Promise.resolve()
      try {
        if (daily !== undefined && !isDailyClosed) {
          await daily.settle(bill.costUsd)
          isDailyClosed = true
        }
        if (bill.usage !== undefined) {
          try {
            // Inline-priced visuals settle their bound but teach nothing. The
            // bill still covers them, so the request stays mixed for the
            // remaining items even when one is left.
            const observed = request.items.filter((item) => item.inlinePriced !== true)
            if (observed.length === 0) return
            await request.estimator.observe(
              request.provider,
              request.modelId,
              observed,
              bill.usage,
              request.captureId,
              { mixed: observed.length !== request.items.length },
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
    estimateUsd,
    async rebindDaily(reserve) {
      // One day claim per request, bound before it is sent.
      if (wasSent || settled !== undefined || isRebinding || daily !== undefined)
        throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
      isRebinding = true
      try {
        daily = await reserve()
      } finally {
        isRebinding = false
      }
    },
    check() {
      if (settled !== undefined || isRebinding)
        throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
      daily?.check()
    },
    started() {
      if (settled !== undefined || isRebinding)
        throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
      wasSent = true
    },
    refused() {
      if (settled !== undefined)
        throw new UserRefusalError(UI_TEXT.paidDailyLedgerUnavailable, 'daily_ledger')
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
      settled = { costUsd, usage: reported }
      await complete()
    },
    async finish() {
      // Sent with no usage: its cost is unknown, never its estimate (D121).
      settled ??= { costUsd: wasSent ? undefined : Usd.from(0).toAmount() }
      await complete()
    },
  }
}
