// Paid consent bound to the account that pays (M108 lane P, PLAN.md D88.7).
// A use billed to another account than the provider's default asks D48's
// question again for that account, naming its price and the shared daily
// budget: it may bill another organisation. The workspace consent in
// paidConsent.ts stays the default account's, so a user with one account
// sees exactly what they saw before.
//
// This module loads only with dist/accountPaid.js, on the first use billed
// to another account (PLAN.md D6): activation and a single-account user
// never carry it.
//
// Grant authority is bound to a durable revocation epoch persisted per
// account binding (RVCONSENT017C/D). Every question captures its durable epoch
// and host feature/quote and price generations; an answer is honoured, cached
// or kept only while all still match. A revocation advances the
// epoch with an atomic compare-and-set first, then clears only what was
// approved under older epochs, so an older revoke never purges a grant given
// after it (RVCONSENT017D's three prerequisites).

import {
  ACCOUNT_ID_PATTERN,
  ACCOUNT_QUOTE_GRANT_VERSION,
  PAID_FEATURES,
  type PaidFeature,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { PaidQuote, PaidUseDecision, PaidUseRequest } from '../../shared/paid'
import { Usd, type UsdAmount } from '../../shared/usd'
// zod/mini, which the Node bundles read from dist/validation.js (INT0170).
import * as z from 'zod/mini'
import type { PaidGrant } from './paidAuthority'
import { PaidUseConsent, type PaidUseAnswer, type PaidUseConsentDeps } from './paidConsent'

/** D88.7: verified local tariff and opaque billing identity; never a credential. */
export interface PaidAccountBinding {
  readonly credentialRevision?: string
  readonly provider: string
  readonly account: string
  /** The tariff as the popup states it, in the display language. */
  readonly price: string
  /**
  The same tariff as language-neutral data, which grants are kept under,
  so changing the display language never asks again or strands a grant.
  Without it, `price` is the key.
  */
  readonly tariff?: string
  readonly dailyBudgetUsd: UsdAmount
  /** A repository can set this ceiling: approval is specific to its quoted amount. */
  readonly repositoryBudget?: boolean
}
/** An account binding's kept features with the revocation epoch approved under. */
export interface AccountBindingGrants {
  readonly epoch: number
  readonly features: ReadonlySet<PaidFeature>
  /** Each feature's host/price generations captured when its question was asked. */
  readonly generations: ReadonlyMap<PaidFeature, string>
}

/**
The store lost a grant race: the durable revocation epoch moved under an
in-flight ask or revoke. Consent code retries `advanceEpoch` by re-reading
and refuses a stale `saveGrantIf`/`saveQuoteGrantIf` instead of downgrading
it to Allow once. Stores throw exactly this class on an epoch conflict, so
consent code can tell a revocation from a disk failure; any other failure
keeps the previous behaviour (Allow once, honest revoke error).
*/
export class StaleEpochError extends Error {
  public constructor(bindingKey: string) {
    super(`Paid grant store raced for binding ${bindingKey}`)
    this.name = 'StaleEpochError'
  }
}

/** The popup for one account: the request, the binding it bills and whether Always is offered. */
export type AccountPaidAsk = (
  request: PaidUseRequest,
  binding: PaidAccountBinding,
  canRemember: boolean,
) => Promise<PaidUseAnswer>

export interface AccountPaidUseConsentDeps extends Omit<
  PaidUseConsentDeps,
  | 'readGrants'
  | 'writeGrants'
  | 'rememberGrant'
  | 'isAnswerCurrent'
  | 'ask'
  | 'windowOnceFeatures'
  | 'windowOnceGeneration'
  | 'readTeamGrants'
  | 'writeTeamGrants'
  | 'readQuoteGrant'
  | 'writeQuoteGrant'
  | 'quoteGeneration'
  | 'revokeQuoteGrants'
  | 'accounts'
> {
  readonly readGrants: (bindingKey: string) => AccountBindingGrants | undefined
  /**
  The account's durable revocation epoch, persisted per binding in the
  same store as the grants. `revoke()` advances it before clearing, so a
  leftover grant from a failed clear stays stale on every instance, after
  a restart too. Missing means never revoked.
  */
  readonly readRevocationEpoch: (bindingKey: string) => number | undefined
  /**
  Atomic compare-and-set for the revocation epoch: moves the durable epoch
  from `expected` to `expected + 1`, and throws `StaleEpochError` when the
  durable epoch is no longer `expected`. The production store serializes
  this per binding against `saveGrantIf`, `saveQuoteGrantIf` and the
  clears, across processes, so concurrent revokes produce strictly
  increasing epochs and a delayed writer can never move the epoch
  backwards or republish an older value. Consent code never reads the
  epoch and writes it back itself; it retries only by re-reading and
  calling this again.
  */
  readonly advanceEpoch: (bindingKey: string, expected: number) => Promise<void>
  /**
  Atomic conditional grant write: keeps `grants.features` as approved under
  `epoch` only while the durable epoch still equals `epoch`, and throws
  `StaleEpochError` otherwise, so a grant approved under a revoked epoch is
  never stored as current. Consent code passes the epoch its question
  captured before the popup, never a freshly re-read one.
  */
  readonly saveGrantIf: (
    bindingKey: string,
    epoch: number,
    grants: AccountBindingGrants,
  ) => Promise<void>
  /**
  The revocation's binding clear, fenced by its own epoch: atomically
  removes only grants approved under an epoch below `before`. A grant
  approved under `before` or later (after the revoke's advance) is never
  purged by this older clear.
  */
  readonly clearGrantsBefore: (bindingKey: string, before: number) => Promise<void>
  readonly ask: AccountPaidAsk
  /** Registry checks account membership/credential generation and the accepted tariff. */
  readonly isCurrent: (binding: PaidAccountBinding) => boolean
  /**
  The account's approved search quotes. Required: an unversioned grant
  cannot prove its vintage (0.18 rule), so no account consent exists
  without a store and a generation. The host scopes all three to this
  account binding; grants for another account must never be visible here.
  */
  readonly readQuoteGrant: (quote: PaidQuote) => PaidGrant | undefined
  /**
  Atomic conditional quote-grant write: persists `grant` only while the
  binding's durable epoch still equals `epoch`, throwing
  `StaleEpochError` otherwise. Same per-binding serialization requirement
  as `saveGrantIf`.
  */
  readonly saveQuoteGrantIf: (bindingKey: string, epoch: number, grant: PaidGrant) => Promise<void>
  readonly quoteGeneration: () => string
  /** Shared feature revocation and price acceptance, including ACP's unflagged revocation. */
  readonly featureGeneration?: (feature: PaidFeature) => string
  /**
  The revocation's quote clear, fenced like `clearGrantsBefore`: removes
  only this account's quote grants approved under an epoch below `before`
  (and any whose generation names no epoch). `revoke()` runs it in the
  owner queue after its advance.
  */
  readonly revokeQuoteGrants: (bindingKey: string, before: number) => Promise<void>
}

export function paidAccountQuestion(binding: PaidAccountBinding): string {
  return fill(UI_TEXT.accounts.paidConsent, {
    provider: binding.provider,
    account: binding.account,
    price: binding.price,
    budget: formatUsd(binding.dailyBudgetUsd, 2),
  })
}

/** The key one account/tariff's grants are stored under; never a credential. */
export function accountBindingKey(binding: PaidAccountBinding): string {
  return JSON.stringify([
    binding.provider,
    binding.account,
    binding.tariff ?? binding.price,
    ...(binding.credentialRevision === undefined ? [] : [binding.credentialRevision]),
    ...(binding.repositoryBudget === true ? [binding.dailyBudgetUsd] : []),
  ])
}

/**
The revocation epoch a persisted quote generation was approved under.
Only the versioned durable encoding counts: an instance-counter-era
`[counter, hostGeneration]` array (or anything else unversioned) fails the
schema, so a legacy grant can never match a durable epoch and is asked
again instead.
*/
const durableQuoteGenerationSchema = z.object({
  v: z.literal(ACCOUNT_QUOTE_GRANT_VERSION),
  epoch: z.number(),
  hostGeneration: z.string(),
})

export function quoteGrantEpoch(generation: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(generation)
    const result = durableQuoteGenerationSchema.safeParse(parsed)
    return result.success ? result.data.epoch : undefined
  } catch {
    return undefined
  }
}

/** A refusal in the decision's own shape: no quote for a search, false otherwise. */
function refusal(request: PaidUseRequest): PaidUseDecision {
  switch (request.feature) {
    case 'webSearch': {
      return undefined
    }
    default: {
      return false
    }
  }
}

/**
One instance per account/tariff. The instance-local generation fences
in-flight asks inside one instance; the durable epoch fences every
instance sharing the store, after a restart too.
*/
export class AccountPaidUseConsent {
  private readonly binding: PaidAccountBinding
  private readonly key: string
  private generation = 0
  private isRevoking = false
  private revocations = 0
  /**
  The durable epoch and host generations each question was asked under, keyed by that
  question's own request object: `decision()` hands the inner consent a
  fresh copy per use, so a forced question, a concurrent one or a later one
  for the same feature never shares, overwrites or consumes another's
  capture. A question without one is never honoured.
  */
  private readonly questionEpochs = new WeakMap<
    PaidUseRequest,
    { readonly epoch: number; readonly generation: string }
  >()
  private writes: Promise<void> = Promise.resolve()
  private consent: PaidUseConsent

  public constructor(
    private readonly deps: AccountPaidUseConsentDeps,
    binding: PaidAccountBinding,
  ) {
    if (
      !ACCOUNT_ID_PATTERN.test(binding.provider) ||
      !ACCOUNT_ID_PATTERN.test(binding.account) ||
      binding.price.trim() === '' ||
      binding.tariff?.trim() === '' ||
      Usd.from(binding.dailyBudgetUsd).compare(Usd.from(0)) < 0
    )
      throw new Error(UI_TEXT.accounts.invalidAccount)
    this.binding = Object.freeze({ ...binding })
    this.key = accountBindingKey(binding)
    this.consent = this.createConsent()
  }

  private async write(use: () => Promise<void>): Promise<void> {
    const previous = this.writes
    const operation = (async () => {
      try {
        await previous
      } catch {
        // A failed prior owner must not block this mutation; its caller received the error.
      }
      await use()
    })()
    this.writes = operation
    await operation
  }

  /** The durable revocation epoch: missing means never revoked. */
  private durableEpoch(): number {
    return this.deps.readRevocationEpoch(this.key) ?? 0
  }

  /** Every host generation that can end approval, sampled at ask and at use. */
  private featureGeneration(feature: PaidFeature): string {
    return JSON.stringify([
      this.deps.quoteGeneration(),
      this.deps.featureGeneration?.(feature) ?? 'initial',
    ])
  }

  private useGeneration(feature: PaidFeature): string {
    return JSON.stringify([this.durableEpoch(), this.featureGeneration(feature)])
  }

  private isCurrent(generation: number): boolean {
    return !this.isRevoking && generation === this.generation && this.deps.isCurrent(this.binding)
  }

  /** The binding's kept features: empty while revoked or approved under an older epoch. */
  private bindingGrants(generation: number): ReadonlySet<PaidFeature> {
    if (!this.isCurrent(generation)) return new Set()
    const stored = this.deps.readGrants(this.key)
    return stored?.epoch === this.durableEpoch()
      ? new Set(
          [...stored.features].filter(
            (feature) => stored.generations.get(feature) === this.featureGeneration(feature),
          ),
        )
      : new Set()
  }

  /** Whether the answer's own epoch and every host generation are still current. */
  private isAnswerCurrent(question: PaidUseRequest, generation: number): boolean {
    const capture = this.questionEpochs.get(question)
    return (
      capture?.epoch === this.durableEpoch() &&
      capture.generation === this.featureGeneration(question.feature) &&
      this.isCurrent(generation)
    )
  }

  /**
  Merges one feature into the binding's kept set inside the owner queue,
  under the epoch its question captured. The conditional save is the
  fence: when another instance revoked meanwhile it throws
  `StaleEpochError` and nothing is stored, so the answer can never be
  persisted as approval under the new epoch.
  */
  private async keepBindingFeature(
    feature: PaidFeature,
    generation: number,
    capture: { readonly epoch: number; readonly generation: string },
  ): Promise<void> {
    await this.write(async () => {
      if (!this.isCurrent(generation)) throw new Error(UI_TEXT.accounts.invalidAccount)
      const { epoch } = capture
      if (capture.generation !== this.featureGeneration(feature))
        throw new StaleEpochError(this.key)
      const stored = this.deps.readGrants(this.key)
      const base = stored?.epoch === epoch ? stored.features : new Set<PaidFeature>()
      await this.deps.saveGrantIf(this.key, epoch, {
        epoch,
        features: new Set([...base, feature]),
        generations: new Map([
          ...(stored?.epoch === epoch ? stored.generations : []),
          [feature, capture.generation],
        ]),
      })
      if (!this.isCurrent(generation)) throw new Error(UI_TEXT.accounts.invalidAccount)
      if (capture.generation !== this.featureGeneration(feature))
        throw new StaleEpochError(this.key)
    })
  }

  /**
  Persists an approved search quote inside the owner queue, under the
  epoch its generation was approved under. A save from a revoked epoch
  throws `StaleEpochError` instead of resurrecting the grant after
  `revoke()` advanced past it, on this instance or another sharing the
  store. A legacy unversioned generation is refused outright.
  */
  private async keepQuoteGrant(grant: PaidGrant, generation: number): Promise<void> {
    await this.write(async () => {
      if (!this.isCurrent(generation)) throw new Error(UI_TEXT.accounts.invalidAccount)
      const epoch = quoteGrantEpoch(grant.generation)
      if (epoch === undefined) throw new Error(UI_TEXT.accounts.invalidAccount)
      await this.deps.saveQuoteGrantIf(this.key, epoch, grant)
      if (!this.isCurrent(generation)) throw new Error(UI_TEXT.accounts.invalidAccount)
    })
  }

  /** The popup with this binding, capturing the durable epoch for this question alone. */
  private wrapAsk(ask: AccountPaidAsk): PaidUseConsentDeps['ask'] {
    return async (request, canRemember) => {
      this.questionEpochs.set(request, {
        epoch: this.durableEpoch(),
        generation: this.featureGeneration(request.feature),
      })
      return await ask(request, this.binding, canRemember)
    }
  }

  private createConsent(): PaidUseConsent {
    const generation = this.generation
    const { deps } = this
    const isCurrent = () => this.isCurrent(generation)
    // The persisted quote generation carries this account's durable
    // revocation epoch beside the host's in a versioned encoding: a revoke
    // asks again everywhere, even when its store clear failed and after a
    // restart, and a host generation change asks again as before. The old
    // `[counter, hostGeneration]` array never matches this shape.
    const composedGeneration = () =>
      JSON.stringify({
        v: ACCOUNT_QUOTE_GRANT_VERSION,
        epoch: this.durableEpoch(),
        hostGeneration: this.featureGeneration('webSearch'),
      })
    return new PaidUseConsent({
      isOn: (feature) => isCurrent() && deps.isOn(feature),
      ...(deps.isJudgeEnabled !== undefined && {
        isJudgeEnabled: () => isCurrent() && deps.isJudgeEnabled?.() === true,
      }),
      ...(deps.acceptJudgePrice !== undefined && { acceptJudgePrice: deps.acceptJudgePrice }),
      canRemember: deps.canRemember,
      ...(deps.authority !== undefined && { authority: deps.authority }),
      ...(deps.nextQuoteOrder !== undefined && { nextQuoteOrder: deps.nextQuoteOrder }),
      log: deps.log,
      // Owner ruling: ask once before the first charge; Always remains workspace-scoped.
      windowOnceFeatures: new Set(PAID_FEATURES),
      // A durable or host revocation or price change ends this window's once.
      windowOnceGeneration: (feature) => this.useGeneration(feature),
      readGrants: () => this.bindingGrants(generation),
      // Account approval is kept only by its question (`rememberGrant`); the
      // inner workspace write is never an account path.
      writeGrants: () => Promise.reject(new Error(UI_TEXT.accounts.invalidAccount)),
      rememberGrant: async (feature, question) => {
        // The epoch this answer's own popup was asked under. No capture, no
        // grant: never the epoch found now (RVCONSENT017D prerequisite 1).
        const capture = this.questionEpochs.get(question)
        if (capture === undefined) throw new StaleEpochError(this.key)
        await this.keepBindingFeature(feature, generation, capture)
      },
      isAnswerCurrent: (question) => this.isAnswerCurrent(question, generation),
      quoteGeneration: composedGeneration,
      readQuoteGrant: deps.readQuoteGrant,
      writeQuoteGrant: async (grant) => {
        await this.keepQuoteGrant(grant, generation)
      },
      ask: this.wrapAsk(deps.ask),
    })
  }

  /**
  One use's decision: the frozen quote for a search, true for any other
  feature, or a refusal in the same shape. `ask` replaces the popup for
  this use (the ACP agent asks in the use's own session).
  */
  public async decision(
    request: PaidUseRequest,
    requiresAsking = false,
    ask?: AccountPaidAsk,
  ): Promise<PaidUseDecision> {
    if (this.isRevoking || !this.deps.isCurrent(this.binding)) return refusal(request)
    const consent = this.consent
    const generation = this.generation
    // Initialize the host's first search generation before capturing it.
    // A revoke during initialization still refuses under the original epoch.
    if (request.feature === 'webSearch' && this.deps.prepareQuoteGeneration !== undefined) {
      const epoch = this.durableEpoch()
      const prepared = await this.deps.prepareQuoteGeneration()
      if (
        !this.isCurrent(generation) ||
        epoch !== this.durableEpoch() ||
        prepared !== this.deps.quoteGeneration()
      )
        return refusal(request)
    }
    const captured = this.useGeneration(request.feature)
    // A fresh request object per use: its question carries its own capture.
    const question: PaidUseRequest = { ...request }
    const decision = await consent.allows(
      question,
      requiresAsking,
      ask === undefined ? undefined : this.wrapAsk(ask),
    )
    if (decision === undefined || decision === false || !this.isCurrent(generation)) {
      consent.settleStaleNotKept(false, request.feature)
      return refusal(request)
    }
    // Fence the final decision against every generation captured when this use
    // began: when a revocation landed meanwhile, the conditional save already
    // refused to store, and a downgraded Allow-once must not approve either.
    // A stale-epoch save carried out of `remember()` settles here: only a
    // fence that passes tells the person the choice applied.
    if (this.useGeneration(request.feature) !== captured) {
      consent.settleStaleNotKept(false, request.feature)
      return refusal(request)
    }
    consent.settleStaleNotKept(true, request.feature)
    return decision
  }

  public async allows(request: PaidUseRequest, requiresAsking = false): Promise<boolean> {
    const decision = await this.decision(request, requiresAsking)
    return decision !== undefined && decision !== false
  }

  /**
  Advances the durable revocation epoch first, then removes the
  account/tariff's grants approved under older epochs, in the owner queue.
  The advance is a compare-and-set: a concurrent revoke that moved the
  epoch first makes this one re-read and advance again, so concurrent
  revokes produce strictly increasing epochs. Both clears carry this
  revocation's epoch as their cutoff, so this older clear never purges a
  grant approved after its advance (RVCONSENT017D prerequisite 2). A failed
  clear still leaves every leftover grant stale, on every instance and
  after a restart. A failed advance rejects honestly with nothing cleared
  and the grants still working.
  */
  public async revoke(): Promise<void> {
    this.revocations++
    this.isRevoking = true
    try {
      await this.write(async () => {
        for (;;) {
          const expected = this.deps.readRevocationEpoch(this.key) ?? 0
          try {
            await this.deps.advanceEpoch(this.key, expected)
          } catch (error: unknown) {
            // Another instance revoked first: re-read and advance past it.
            // Any other failure (a disk error) rejects honestly below.
            if (!(error instanceof StaleEpochError)) throw error
            continue
          }
          const epoch = expected + 1
          this.generation++
          await this.deps.clearGrantsBefore(this.key, epoch)
          await this.deps.revokeQuoteGrants(this.key, epoch)
          return
        }
      })
    } finally {
      this.revocations--
      this.isRevoking = this.revocations > 0
      this.consent = this.createConsent()
    }
  }
}
