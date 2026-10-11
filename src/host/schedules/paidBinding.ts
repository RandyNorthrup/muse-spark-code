import type { ScheduleAuthorityStore } from '../../core/schedules/grantAudit'
import type { CreateResponseBody, CreateImageBody } from '../../core/backends/modelapi/schemas'
import { requestImageCount } from '../../core/backends/modelapi/modelPolicy'
import { estimateInput, type SessionBudgetClaim } from '../../core/backends/modelapi/sessionBudget'
import {
  isValidPriceCard,
  reserveRequestAmount,
  type ModelPricing,
} from '../../core/providers/priceCard'
import {
  askSchedulePaidConsent,
  createSchedulePaidScope,
  scheduleConsentFailure,
  type PaidUseAnswer,
  type SchedulePaidIdentity,
} from '../../core/paid/paidConsent'
import { UI_TEXT, MILLISECONDS_PER_MINUTE, type PaidFeature } from '../../shared/constants'
import { formatList, formatNumber, formatTime, formatUnit } from '../../shared/l10n/text'
import { scheduleDateTime, scheduleWeekdayText } from '../../webview/schedules/presentation'
import { autoReviewPrice } from '../../shared/reviewPriceText'
import { Usd, type UsdAmount } from '../../shared/usd'
import { scheduleV2Schema, type ScheduleRunContext, type ScheduleV2 } from '../../shared/scheduleV2'
import type { BackendSession } from './backgroundTarget'
import type { PaidUseRequest } from '../../shared/paid'
import type { ScheduleCallerContext } from '../../runtime/schedules/args'
import { cliSchedulePaidAnswer } from '../../runtime/schedules/consent'

export interface ScheduleBillingPorts {
  modelId(schedule: ScheduleV2): string
  host(): Promise<{
    schedulePricing(modelId: string): Promise<{
      readonly pricing: ModelPricing
      readonly accountId: string
      readonly providerId: string
      readonly origin: string
    }>
  }>
  generation(): number
  capUsd(): UsdAmount
  isActive(): boolean
  isOn(feature: PaidFeature): boolean
  /** Trusted invocation context supplied by the runtime, never by the draft. */
  caller?(): ScheduleCallerContext
  /** CLI flags replace the popup only after the same full quote is printed. */
  reportConsent?(question: { readonly title: string; readonly detail: string }): Promise<void>
  ask(question: {
    readonly title: string
    readonly detail: string
    readonly request: Extract<PaidUseRequest, { feature: 'scheduledPrompts' }>
  }): Promise<PaidUseAnswer>
  reserve(schedule: ScheduleV2, amount: UsdAmount, signal: AbortSignal): Promise<SessionBudgetClaim>
}

const times = (clocks: readonly { hour: number; minute: number }[]) =>
  formatList(
    clocks.map(({ hour, minute }) => {
      const date = new Date(0)
      date.setHours(hour, minute)
      return formatTime(date.getTime())
    }),
  )

function cadenceText(trigger: ScheduleV2['trigger'], zone: string): string {
  let detail: string
  switch (trigger.kind) {
    case 'once': {
      detail = scheduleDateTime(trigger.atMs, zone)
      break
    }
    case 'interval': {
      detail = formatUnit(trigger.everyMs / MILLISECONDS_PER_MINUTE, 'minute')
      break
    }
    case 'daily': {
      detail = `${formatUnit(trigger.everyDays, 'day')}: ${times(trigger.times)}`
      break
    }
    case 'weekdays': {
      detail = times(trigger.times)
      break
    }
    case 'weekly': {
      detail = formatList(
        trigger.days.map((day) => `${scheduleWeekdayText(day.weekday)}: ${times(day.times)}`),
      )
      break
    }
    case 'cron': {
      detail = trigger.expression
      break
    }
    case 'event': {
      const conditions = trigger.conditions.map(
        (condition) =>
          `${condition.field}=${typeof condition.equals === 'number' ? formatNumber(condition.equals) : String(condition.equals)}`,
      )
      detail = `${UI_TEXT.scheduleV2.events[trigger.event]} (${trigger.source}): ${formatList(conditions)}`
      break
    }
    case 'afterEvent': {
      detail = formatList([cadenceText(trigger.event, zone), cadenceText(trigger.time, zone)])
      break
    }
  }
  return `${UI_TEXT.scheduleV2.triggers[trigger.kind]}: ${detail}`
}

/** Uses the selected model's verified tariff, including non-Meta providers. */
export function createScheduleBilling(ports: ScheduleBillingPorts) {
  const quote = async (modelId: string) => {
    const generation = ports.generation()
    const host = await ports.host()
    const { pricing, accountId, providerId, origin } = await host.schedulePricing(modelId)
    if (generation !== ports.generation()) throw new Error(UI_TEXT.scheduleV2.messages.changedKey)
    if (pricing.kind !== 'priced' || !isValidPriceCard(pricing.card))
      throw new Error(UI_TEXT.bestOfNTariffUnknown)
    const card = pricing.card
    const price = autoReviewPrice(modelId, pricing)
    if (price === undefined) throw new Error(UI_TEXT.bestOfNTariffUnknown)
    const { fetchedAt: _fetchedAt, source: _source, upstream: _upstream, ...tariff } = card
    const identity: SchedulePaidIdentity = {
      modelId,
      accountId,
      providerId,
      origin,
      priceTier: JSON.stringify({ providerId, origin, tariff }),
      payerKind: 'paidKey',
      price,
      sharedDailyBudgetUsd: ports.capUsd(),
    }
    const estimate = (body: CreateResponseBody | CreateImageBody, tokens: number | undefined) => {
      if (!('input' in body)) throw new Error(UI_TEXT.scheduleV2.messages.paidUnavailable)
      const inputTokens = tokens ?? estimateInput([JSON.stringify(body)], undefined).inputTokens
      return Usd.from(
        reserveRequestAmount(card, {
          inputTokens,
          outputTokens: body.max_output_tokens,
          cachedTokens: 0,
          cacheWriteTokens: inputTokens,
        }),
      )
        .add(Usd.from(card.image ?? 0).times(requestImageCount(body)))
        .toAmount()
    }
    return { identity, estimate, generation }
  }
  return {
    async consent(schedule: ScheduleV2): Promise<ScheduleV2['paidConsent']> {
      const modelId = ports.modelId(schedule)
      const { identity, generation } = await quote(modelId)
      const caller = ports.caller?.()
      return await askSchedulePaidConsent({
        schedule,
        identity,
        cadence: `${cadenceText(schedule.trigger, schedule.zone)} (${schedule.zone})`,
        extras: [],
        now: Date.now,
        isOn: () => ports.isOn('scheduledPrompts'),
        isCurrent: () =>
          ports.isActive() &&
          ports.modelId(schedule) === modelId &&
          JSON.stringify(ports.caller?.()) === JSON.stringify(caller) &&
          ports.generation() === generation &&
          ports.capUsd() === identity.sharedDailyBudgetUsd,
        ask: async (question) => {
          if (caller?.source !== 'cli') return await ports.ask(question)
          if (ports.reportConsent === undefined) return 'deny'
          const answer = cliSchedulePaidAnswer(schedule, caller)
          if (answer === 'deny') return answer
          await ports.reportConsent(question)
          return answer
        },
      })
    },
    async paid(
      schedule: ScheduleV2,
      session: BackendSession,
      context: ScheduleRunContext,
      authority: ScheduleAuthorityStore,
    ) {
      const { identity, estimate, generation } = await quote(session.modelId)
      const assertCurrent = (
        live: ScheduleV2 | undefined,
        record: ScheduleV2,
        freshIdentity: SchedulePaidIdentity,
      ): ScheduleV2 => {
        if (live === undefined || !ports.isActive())
          throw new Error(UI_TEXT.scheduleV2.messages.changedRevision)
        if (live.paused) throw new Error(UI_TEXT.scheduleV2.messages.pausedPaid)
        if (ports.generation() !== generation)
          throw new Error(UI_TEXT.scheduleV2.messages.changedKey)
        if (session.modelId !== identity.modelId)
          throw new Error(UI_TEXT.scheduleV2.messages.changedModel)
        if (ports.capUsd() !== identity.sharedDailyBudgetUsd)
          throw new Error(UI_TEXT.scheduleV2.messages.changedSharedCap)
        const failure = scheduleConsentFailure(live, freshIdentity)
        if (failure !== undefined) throw new Error(UI_TEXT.scheduleV2.messages[failure])
        if (JSON.stringify(live.grant) !== JSON.stringify(record.grant))
          throw new Error(UI_TEXT.scheduleV2.messages.changedGrant)
        if (JSON.stringify(live.paidConsent) !== JSON.stringify(record.paidConsent))
          throw new Error(UI_TEXT.scheduleV2.messages.changedConsent)
        if (live.mode !== record.mode || live.revision !== record.revision)
          throw new Error(UI_TEXT.scheduleV2.messages.changedRevision)
        return live
      }
      let current = await authority.read(schedule.workspaceKey, schedule.id)
      current = assertCurrent(current, schedule, identity)
      if (current.paidConsent?.scope === 'once' && current.paidConsent.runId === undefined) {
        const next = scheduleV2Schema.parse({
          ...current,
          paidConsent: { ...current.paidConsent, runId: context.runId },
          updatedAtMs: Date.now(),
        })
        if (
          !(await authority.commit(next, {
            scheduleId: schedule.id,
            atMs: Date.now(),
            kind: 'changed',
          }))
        )
          throw new Error(UI_TEXT.scheduleV2.messages.lostOnceClaim)
        current = await authority.read(schedule.workspaceKey, schedule.id)
        if (current?.paidConsent?.runId !== context.runId)
          throw new Error(UI_TEXT.scheduleV2.messages.lostOnceClaim)
        current = assertCurrent(current, { ...next, revision: next.revision + 1 }, identity)
      }
      if (current.paidConsent?.scope === 'once' && current.paidConsent.runId !== context.runId)
        throw new Error(UI_TEXT.scheduleV2.messages.lostOnceClaim)
      const admitted = current
      const policy = createSchedulePaidScope({
        backend: 'modelApi',
        schedule: admitted,
        identity,
        runId: context.runId,
        currentIdentity: () => ({
          ...identity,
          accountId: identity.accountId,
          sharedDailyBudgetUsd: ports.capUsd(),
        }),
        isCurrent: () =>
          ports.isActive() &&
          ports.generation() === generation &&
          session.modelId === identity.modelId,
        isOn: (feature) => ports.isOn(feature),
        estimate,
        reserve: async (record, amount, signal) => {
          const fresh = await quote(session.modelId)
          // Read authority after awaited pricing, then validate synchronously
          // beside admission. A pause during a quote cannot use an older read.
          const live = assertCurrent(
            await authority.read(record.workspaceKey, record.id),
            record,
            fresh.identity,
          )
          signal.throwIfAborted()
          const claim = await ports.reserve(record, amount, signal)
          try {
            const quoted = await quote(session.modelId)
            assertCurrent(
              await authority.read(record.workspaceKey, record.id),
              live,
              quoted.identity,
            )
            signal.throwIfAborted()
            return claim
          } catch (error: unknown) {
            await claim.settle(Usd.from(0).toAmount())
            throw error
          }
        },
      })
      if (!policy.allows('scheduledPrompts'))
        throw new Error(UI_TEXT.scheduleV2.messages.paidUnavailable)
      return { policy, consent: admitted.paidConsent, cost: () => Promise.resolve(policy.cost()) }
    },
  }
}
