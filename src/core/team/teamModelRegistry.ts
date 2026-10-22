// Captured model facts and observed account limits become Roles offers only
// when this editor can run the corresponding worker. Unknown stays absent.
import * as z from 'zod/mini'
import {
  UI_TEXT,
  MODEL_API_PRICES_PER_MILLION,
  TEAM_CAPTURED_PROVIDER_PRESETS,
} from '../../shared/constants'
import type { ModelSummary } from '../agent/agentBackend'
import type { ModelCapabilityRecord } from '../providers/capabilityRecord'
import type { MuseCodeModelSummary } from '../backends/musecode/MuseCodeHost'
import type { TeamPanelOffer, TeamSettingControl } from '../../shared/teamPanel'
import type { UsageLimitSnapshot } from '../../shared/usageJournal'
import { computeTeamCeiling, metaTeamLimits } from './teamCeilings'
import { modelApiPaidTier } from '../../shared/paid'

export interface TeamEngineModel {
  readonly model: ModelSummary
  readonly record: ModelCapabilityRecord
  readonly preset: string
}
export interface TeamDiscoveryAbsence {
  readonly provider: string
  readonly reason: 'capture' | 'limits' | 'worker' | 'discovery' | 'unavailable'
}
function billingForPricing(pricing: ModelSummary['pricing']): 'subscription' | 'key' {
  return pricing === 'plan' ? 'subscription' : 'key'
}
function cachedRateFor(pricing: ModelSummary['pricing'], cachedInput: unknown): number | undefined {
  if (pricing === 'local') return 0
  return cachedInput === undefined ? undefined : Number(cachedInput)
}
const positive = z.number().check(z.positive())
function amount(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return
  const parsed = positive.safeParse(Number(value))
  return parsed.success ? parsed.data : undefined
}
/** Header names and minute windows are from the M95 provider captures. */
export function observedTeamLimits(
  preset: string,
  raw: UsageLimitSnapshot['raw'],
): { rpm?: number | undefined; tpm?: number | undefined } | undefined {
  if (raw === undefined) return
  if (preset === 'openai' || preset === 'xai') {
    const rpm = amount(raw['x-ratelimit-limit-requests'])
    const tpm = amount(raw['x-ratelimit-limit-tokens'])
    return rpm === undefined && tpm === undefined ? undefined : { rpm, tpm }
  }
  if (preset === 'groq') {
    const tpm = amount(raw['x-ratelimit-limit-tokens'])
    return tpm === undefined ? undefined : { tpm }
  }
  if (preset === 'anthropic') {
    const rpm = amount(raw['anthropic-ratelimit-requests-limit'])
    const tokens = [
      'anthropic-ratelimit-tokens-limit',
      'anthropic-ratelimit-input-tokens-limit',
      'anthropic-ratelimit-output-tokens-limit',
    ].flatMap((key) => {
      const value = amount(Reflect.get(raw, key))
      return value === undefined ? [] : [value]
    })
    const tpm = tokens.length === 0 ? undefined : Math.min(...tokens)
    return rpm === undefined && tpm === undefined ? undefined : { rpm, tpm }
  }
  // Groq's request count is daily, and Hugging Face's x-headers name an
  // upstream, not its own router quota. Neither is a provider RPM capture.
  return
}
export function teamControls(record: ModelCapabilityRecord): TeamSettingControl[] {
  const labels = UI_TEXT.teamControlLabels
  const controls: TeamSettingControl[] = []
  const effort = record.reasoning.effortLevels
  if (effort.state === 'yes' && effort.value.length > 0)
    controls.push({
      key: 'effort',
      kind: 'choice',
      label: UI_TEXT.effortItem,
      note: UI_TEXT.teamSettingCostEffort,
      choices: [...effort.value],
    })
  if (record.output.acceptsLimit.state === 'yes' && record.output.maxTokens !== undefined)
    controls.push({
      key: 'outputCap',
      kind: 'number',
      label: labels.outputCap,
      note: UI_TEXT.teamSettingCostMaxOutput,
      min: record.output.minTokens ?? 1,
      max: record.output.maxTokens,
    })
  return controls
}
export function buildTeamModelOffers(input: {
  readonly engine: readonly TeamEngineModel[]
  readonly museCode: readonly MuseCodeModelSummary[]
  readonly limits: readonly UsageLimitSnapshot[]
  readonly maxWorkers: number
  readonly canRunKind: (kind: 'engine' | 'museCode' | 'external') => boolean
  /**
   * The credential identity spending today, by provider. A known identity
   * drops an observation stamped for another account, and an unstamped one
   * is omitted with the limits reason (RVCM963J 7). An unknown identity
   * for a provider (undefined: signed out, or an OAuth or damaged record)
   * drops every stamped row, so no other account's quota comes back;
   * unstamped rows keep the legacy newest-row selection. Absent keeps it
   * everywhere (tests, unattributed rows).
   */
  readonly currentAccountOf?: (provider: string) => string | undefined
}): { readonly offers: TeamPanelOffer[]; readonly absent: TeamDiscoveryAbsence[] } {
  const offers: TeamPanelOffer[] = []
  const absent: TeamDiscoveryAbsence[] = []
  for (const { model, record, preset } of input.engine) {
    const provider = model.providerId ?? 'meta'
    if (!input.canRunKind('engine')) {
      absent.push({ provider, reason: 'worker' })
      continue
    }
    if (record.tools.calling.state !== 'yes') {
      absent.push({ provider, reason: 'capture' })
      continue
    }
    const isLocal = model.pricing === 'local'
    // Newest first, so a replaced key's older rows never shadow the current
    // account's observation; rows stamped for another account are dropped.
    const current = input.currentAccountOf?.(provider)
    const observed = input.limits
      .filter((row) => row.provider === provider)
      // A known identity drops rows stamped for another account, so a
      // rotated key's old quota gives no offer; an unknown one drops every
      // stamped row, so a removed key brings back no other account's quota.
      // Only unstamped rows keep legacy newest-row selection.
      .filter((row) => input.currentAccountOf === undefined || row.observedAccount === current)
      .toSorted((a, b) => b.observedAt - a.observedAt)
      .at(0)
    const observedLimits = observedTeamLimits(preset, observed?.raw)
    const limits =
      provider === 'meta'
        ? metaTeamLimits(
            modelApiPaidTier(model.modelId) === 'contributor' ? 'contributor' : 'standard',
          )
        : (observedLimits ??
          (preset !== 'openai' &&
          preset !== 'anthropic' &&
          preset !== 'xai' &&
          TEAM_CAPTURED_PROVIDER_PRESETS.includes(preset)
            ? {}
            : undefined))
    if (!isLocal && limits === undefined) {
      absent.push({ provider, reason: 'limits' })
      continue
    }
    const ceiling = computeTeamCeiling({
      kind: 'engine',
      providerRpm: limits?.rpm,
      providerTpm: limits?.tpm,
      workerRpm: undefined,
      workerTpm: undefined,
      machineLimit: input.maxWorkers,
    })
    if (ceiling < 1) {
      absent.push({ provider, reason: 'limits' })
      continue
    }
    const tier = modelApiPaidTier(model.modelId) === 'contributor' ? 'contributor' : 'standard'
    const metaRates = provider === 'meta' ? MODEL_API_PRICES_PER_MILLION[tier] : undefined
    const billing = isLocal ? 'local' : billingForPricing(model.pricing)
    offers.push({
      ref: `engine:${model.modelId}`,
      label: model.displayLabel,
      agent: {
        kind: 'engine',
        agentId: provider,
        provider,
        model: model.modelId,
        pays: billing,
      },
      toolCalling: true,
      contextWindow: model.contextLimit,
      imageInput: record.modalities.image.state === 'yes',
      reasoning: record.reasoning.supported.state === 'yes',
      inputRate:
        model.inputUsdPerMTokens ?? (metaRates === undefined ? undefined : Number(metaRates.input)),
      outputRate:
        model.outputUsdPerMTokens ??
        (metaRates === undefined ? undefined : Number(metaRates.output)),
      cachedRate: cachedRateFor(model.pricing, metaRates?.cachedInput),
      ceiling,
      controls: teamControls(record),
    })
  }
  for (const model of input.museCode) {
    if (!input.canRunKind('museCode')) {
      absent.push({ provider: 'museCode', reason: 'worker' })
      continue
    }
    if (modelApiPaidTier(model.modelId) === undefined) {
      absent.push({ provider: 'museCode', reason: 'capture' })
      continue
    }
    const choices = model.reasoningEffortVariants?.map((row) => row.tier)
    offers.push({
      ref: `museCode:${model.modelId}`,
      label: model.displayLabel,
      agent: { kind: 'museCode', agentId: 'museCode', model: model.modelId, pays: 'subscription' },
      toolCalling: true,
      contextWindow: model.contextLimit,
      ceiling: computeTeamCeiling({
        kind: 'museCode',
        providerRpm: undefined,
        providerTpm: undefined,
        workerRpm: undefined,
        workerTpm: undefined,
        machineLimit: input.maxWorkers,
      }),
      controls:
        choices === undefined
          ? []
          : [
              {
                key: 'effort',
                label: UI_TEXT.effortItem,
                note: UI_TEXT.teamSettingCostEffort,
                kind: 'choice',
                choices,
              },
            ],
    })
  }
  return { offers, absent }
}
