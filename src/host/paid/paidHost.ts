// The host side of the paid Model API features (M33–M35, PLAN.md D30): the
// gate over VS Code's settings, the extension's global state and a modal
// confirmation naming the price, the window's tally, and the `paidState`
// message every panel renders its badge, toggles and tally from.

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import type { ImagePlan } from '../../core/backends/modelapi/imageGeneration'
import { PaidFeatureGate, PaidUsage, paidStateOf } from '../../core/paid/paidFeatures'
import {
  GLOBAL_STATE_KEYS,
  PAID_FEATURE_SETTINGS,
  PAID_FEATURES,
  type PaidFeature,
  SETTINGS_SECTION,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { paidFeatureName, paidFeaturePrice, type PaidState } from '../../shared/paid'
import type { Logger } from '../logger'

// What an earlier version (or a hand edit) stored is validated, never trusted.
const acceptedSchema = z.array(z.enum(PAID_FEATURES))

export interface PaidFeaturesDeps {
  readonly globalState: vscode.Memento
  /** Whether the feature's setting is on, as the settings reader validated it. */
  readonly isSettingOn: (feature: PaidFeature) => boolean
  /** Whether a Model API key is stored, as last read (M44). */
  readonly isKeyStored: () => boolean
  readonly log: Logger
}

export interface PaidFeatures {
  readonly gate: PaidFeatureGate
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
 * The price confirmation before an image the `ide` server makes for Muse
 * Code (M44, PLAN.md D37): every one, whatever Muse Code's permission mode,
 * naming what is made, from what, and that the key pays for it.
 */
export async function isImagePurchaseConfirmed(plan: ImagePlan): Promise<boolean> {
  const price = paidFeaturePrice('imageGeneration')
  const accept = fill(UI_TEXT.imageBuyAccept, { price })
  const title = fill(plan.kind === 'edit' ? UI_TEXT.imageBuyEditTitle : UI_TEXT.imageBuyTitle, {
    path: plan.target.relative,
  })
  const sources = plan.sources.map((source) => source.relative).join(', ')
  const detail = [
    fill(UI_TEXT.imageBuyPrompt, { prompt: plan.prompt }),
    ...(sources === '' ? [] : [fill(UI_TEXT.imageBuySources, { paths: sources })]),
    fill(UI_TEXT.imageBuyBilling, { price }),
  ].join('\n\n')
  const answer = await vscode.window.showWarningMessage(title, { modal: true, detail }, accept)
  return answer === accept
}

export function createPaidFeatures(deps: PaidFeaturesDeps): PaidFeatures {
  const readAccepted = (): ReadonlySet<PaidFeature> => {
    const parsed = acceptedSchema.safeParse(
      deps.globalState.get<unknown>(GLOBAL_STATE_KEYS.paidConfirmations) ?? [],
    )
    return new Set(parsed.success ? parsed.data : [])
  }
  const gate = new PaidFeatureGate({
    isSettingOn: deps.isSettingOn,
    setSetting: async (feature, isOn) => {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(PAID_FEATURE_SETTINGS[feature], isOn, vscode.ConfigurationTarget.Global)
    },
    readAccepted,
    writeAccepted: async (accepted) => {
      await deps.globalState.update(GLOBAL_STATE_KEYS.paidConfirmations, [...accepted])
    },
    confirm: isTurnOnConfirmed,
    isWindowFocused: () => vscode.window.state.focused,
    log: deps.log,
  })
  const usage = new PaidUsage(deps.log)
  return {
    gate,
    usage,
    state: () => paidStateOf(gate, usage, deps.isKeyStored()),
    affects: (event) =>
      PAID_FEATURES.some((feature) =>
        event.affectsConfiguration(`${SETTINGS_SECTION}.${PAID_FEATURE_SETTINGS[feature]}`),
      ),
  }
}
