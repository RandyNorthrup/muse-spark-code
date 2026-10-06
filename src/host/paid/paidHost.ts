import type { UsageRecording } from '../../core/usage/recording'
// The host side of the paid Model API features (M33–M35, PLAN.md D30): the
// gate over VS Code's settings, the extension's global state and a modal
// confirmation naming the price, the popup before each paid use (M58,
// PLAN.md D48), the window's tally, and the `paidState` message every panel
// renders its badge, toggles and tally from.

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { PaidUseConsent, type PaidUseAnswer, paidUseQuestion } from '../../core/paid/paidConsent'
import { PaidFeatureGate, PaidUsage, paidStateOf } from '../../core/paid/paidFeatures'
import {
  GLOBAL_STATE_KEYS,
  PAID_FEATURE_SETTINGS,
  PAID_FEATURES,
  type PaidFeature,
  SETTINGS_SECTION,
  SUBAGENT_PRICE_ACCEPTANCE_VERSION,
  UI_TEXT,
  WORKSPACE_STATE_KEYS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../core/usage/insights'
import {
  autoReviewPrice,
  modelApiPaidTier,
  paidFeatureName,
  paidFeaturePrice,
  type PaidState,
  type PaidUseRequest,
} from '../../shared/paid'
import type { Logger } from '../logger'

// What an earlier version (or a hand edit) stored is validated, never trusted.
const acceptedSchema = z.array(z.enum(PAID_FEATURES))
// Feature → grant generation; keys that are not a paid feature are ignored.
const generationsSchema = z.record(z.string(), z.int().check(z.nonnegative()))

/** A feature's grant generation: 0 until its price acceptance first changes. */
function generationOf(generations: Readonly<Record<string, number>>, feature: PaidFeature): number {
  return generations[feature] ?? 0
}

interface MementoLike {
  get(key: string): unknown
  update(key: string, value: unknown): Thenable<void>
}

export interface PaidFeaturesDeps {
  readonly usageRecording?: UsageRecording | undefined
  readonly globalState: MementoLike
  /** Where "Allow always in this workspace" is kept (M58). */
  readonly workspaceState: MementoLike
  /** Whether the feature's setting is on, as the settings reader validated it. */
  readonly isSettingOn: (feature: PaidFeature) => boolean
  readonly isAvailable?: (feature: PaidFeature) => boolean
  readonly isDefaultOn?: (feature: PaidFeature) => boolean
  readonly dailyBudgetUsd?: () => number | undefined
  /** Whether a Model API key is stored, as last read (M44). */
  readonly isKeyStored: () => boolean
  /** A trusted workspace with a folder open: "always" is offered and kept only there. */
  readonly canRememberPaidUse: () => boolean
  readonly log: Logger
}

export interface PaidFeatures {
  readonly gate: PaidFeatureGate
  readonly consent: PaidUseConsent
  readonly usage: PaidUsage
  readonly state: () => PaidState
  /** Whether a change to the configuration touched a paid feature's setting. */
  readonly affects: (event: vscode.ConfigurationChangeEvent) => boolean
}

/** What the confirmation says the feature does and costs, in the display language. */
function confirmationDetail(feature: PaidFeature): string {
  const details: Readonly<Record<PaidFeature, string>> = {
    webSearch: UI_TEXT.paidConfirmWebSearch,
    imageGeneration: UI_TEXT.paidConfirmImage,
    voice: UI_TEXT.paidConfirmVoice,
    scheduledPrompts: UI_TEXT.paidConfirmScheduled,
    subagents: UI_TEXT.paidConfirmSubagents,
    autoReviewer: UI_TEXT.paidConfirmAutoReviewer,
    bestOfN: UI_TEXT.paidConfirmBestOfN,
  }
  return fill(details[feature], { price: paidFeaturePrice(feature) })
}

async function isTurnOnConfirmed(feature: PaidFeature): Promise<boolean> {
  const accept = UI_TEXT.paidConfirmAccept
  const answer = await vscode.window.showWarningMessage(
    fill(UI_TEXT.paidConfirmTitle, { feature: paidFeatureName(feature) }),
    { modal: true, detail: confirmationDetail(feature) },
    accept,
  )
  return answer === accept
}

/**
 * The popup before a paid use (M58): Allow once, Allow always in this
 * workspace (only where it can be kept), or Deny, which is also what closing
 * the popup answers.
 */
export async function askPaidUse(
  request: PaidUseRequest,
  canRemember: boolean,
  dailyBudgetUsd?: number,
): Promise<PaidUseAnswer> {
  // No verified price, nothing to accept (M48, M78): refused before any popup.
  if (
    (request.feature === 'subagents' && modelApiPaidTier(request.task.modelId) === undefined) ||
    (request.feature === 'autoReviewer' &&
      autoReviewPrice(request.modelId, request.pricing) === undefined)
  ) {
    return 'deny'
  }
  if (request.feature === 'bestOfN' && modelApiPaidTier(request.modelId) === undefined) {
    return 'deny'
  }
  if (request.feature === 'bestOfN' && modelApiPaidTier(request.modelId) === undefined) {
    return 'deny'
  }
  const { title, detail } = paidUseQuestion(request)
  const once: vscode.MessageItem = { title: UI_TEXT.allowOnce }
  const always: vscode.MessageItem = { title: UI_TEXT.paidAllowAlways }
  const deny: vscode.MessageItem = { title: UI_TEXT.paidDeny, isCloseAffordance: true }
  const answer = await vscode.window.showWarningMessage(
    title,
    {
      modal: true,
      detail:
        dailyBudgetUsd === undefined
          ? detail
          : `${detail}\n\n${fill(UI_TEXT.paidDailyBudgetLine, { budget: formatUsd(dailyBudgetUsd) })}`,
    },
    ...(canRemember ? [once, always, deny] : [once, deny]),
  )
  if (answer === once) {
    return 'once'
  }
  return answer === always && canRemember ? 'always' : 'deny'
}

export function createPaidFeatures(deps: PaidFeaturesDeps): PaidFeatures {
  const readAccepted = (): ReadonlySet<PaidFeature> => {
    const parsed = acceptedSchema.safeParse(
      deps.globalState.get(GLOBAL_STATE_KEYS.paidConfirmations) ?? [],
    )
    const accepted = new Set(parsed.success ? parsed.data : [])
    if (
      deps.globalState.get(GLOBAL_STATE_KEYS.subagentPriceAcceptance) !==
      SUBAGENT_PRICE_ACCEPTANCE_VERSION
    ) {
      accepted.delete('subagents')
    }
    return accepted
  }
  const readGenerations = (): Readonly<Record<string, number>> => {
    const parsed = generationsSchema.safeParse(
      deps.globalState.get(GLOBAL_STATE_KEYS.paidGrantGenerations) ?? {},
    )
    return parsed.success ? parsed.data : {}
  }
  const gate = new PaidFeatureGate({
    isSettingOn: deps.isSettingOn,
    ...(deps.isAvailable !== undefined && { isAvailable: deps.isAvailable }),
    ...(deps.isDefaultOn !== undefined && { isDefaultOn: deps.isDefaultOn }),
    setSetting: async (feature, isOn) => {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(PAID_FEATURE_SETTINGS[feature], isOn, vscode.ConfigurationTarget.Global)
    },
    readAccepted,
    writeAccepted: async (accepted) => {
      // A price accepted or withdrawn voids every "always" given under the
      // old acceptance, in every workspace (M58).
      const previous = readAccepted()
      const generations = { ...readGenerations() }
      for (const feature of PAID_FEATURES) {
        if (previous.has(feature) !== accepted.has(feature)) {
          generations[feature] = generationOf(generations, feature) + 1
        }
      }
      await deps.globalState.update(GLOBAL_STATE_KEYS.paidGrantGenerations, generations)
      await deps.globalState.update(
        GLOBAL_STATE_KEYS.subagentPriceAcceptance,
        accepted.has('subagents') ? SUBAGENT_PRICE_ACCEPTANCE_VERSION : undefined,
      )
      await deps.globalState.update(GLOBAL_STATE_KEYS.paidConfirmations, [...accepted])
    },
    confirm: isTurnOnConfirmed,
    isWindowFocused: () => vscode.window.state.focused,
    log: deps.log,
  })
  const consent = new PaidUseConsent({
    isOn: (feature) => gate.isOn(feature),
    canRemember: deps.canRememberPaidUse,
    readGrants: () => {
      const parsed = generationsSchema.safeParse(
        deps.workspaceState.get(WORKSPACE_STATE_KEYS.paidWorkspaceGrants) ?? {},
      )
      const grants = parsed.success ? parsed.data : {}
      const generations = readGenerations()
      return new Set(
        PAID_FEATURES.filter(
          (feature) =>
            grants[feature] !== undefined &&
            grants[feature] === generationOf(generations, feature) &&
            (feature !== 'subagents' ||
              deps.globalState.get(GLOBAL_STATE_KEYS.subagentPriceAcceptance) ===
                SUBAGENT_PRICE_ACCEPTANCE_VERSION),
        ),
      )
    },
    writeGrants: async (grants) => {
      if (grants.has('subagents')) {
        await deps.globalState.update(
          GLOBAL_STATE_KEYS.subagentPriceAcceptance,
          SUBAGENT_PRICE_ACCEPTANCE_VERSION,
        )
      }
      // A default-on feature's first "always" accepted its price too. Keep
      // that acceptance so turning it off invalidates this generation (D78).
      await deps.globalState.update(GLOBAL_STATE_KEYS.paidConfirmations, [
        ...new Set([...readAccepted(), ...grants]),
      ])
      const generations = readGenerations()
      await deps.workspaceState.update(
        WORKSPACE_STATE_KEYS.paidWorkspaceGrants,
        Object.fromEntries(
          [...grants].map((feature) => [feature, generationOf(generations, feature)]),
        ),
      )
    },
    ask: (request, canRemember) => askPaidUse(request, canRemember, deps.dailyBudgetUsd?.()),
    log: deps.log,
  })
  const usage = new PaidUsage(deps.log, deps.usageRecording)
  const openedAt = Date.now()
  if (deps.usageRecording !== undefined) {
    void deps.usageRecording
      .today()
      .then((records) => {
        usage.restore(records.filter((record) => record.at < openedAt))
      })
      .catch(() => {
        deps.log.warn('Paid usage history could not be restored')
      })
  }
  return {
    gate,
    consent,
    usage,
    state: () => paidStateOf(gate, usage, deps.isKeyStored(), consent.remembered()),
    affects: (event) =>
      PAID_FEATURES.some((feature) =>
        event.affectsConfiguration(`${SETTINGS_SECTION}.${PAID_FEATURE_SETTINGS[feature]}`),
      ),
  }
}
