// The paid Model API features in the runtime panel (M104 lane B; PLAN.md D30,
// D48, D78, D208): the same gate, tally and question every editor has, over
// the runtime's own settings and the editor's modals. A feature is on only
// with its setting on and its price accepted (a setting the person never
// touched is on by default on the Model API, D78); every use asks first in
// the editor (Allow once, Allow always in this workspace where it is kept,
// Deny), naming the price; and nothing here checks a spending limit the
// person did not set (D208): the daily budget line appears only for a limit
// they set. "Always" is kept in the runtime's own grants store, shared with
// the ACP agent.
import { paidUseQuestion, type PaidUseAnswer } from '../../core/paid/paidConsent'
import { PaidFeatureGate, PaidUsage, paidStateOf } from '../../core/paid/paidFeatures'
import { isActivationPaidSettingOn } from '../../host/paid/paidActivation'
import type { Logger } from '../../host/logger'
import type { ExtensionSettings } from '../../host/settings'
import {
  ACP_PAID_FEATURES,
  ACP_PAID_OPTIONS,
  PAID_FEATURE_SETTINGS,
  PAID_FEATURES,
  UI_TEXT,
  type AcpPaidFeature,
  type PaidFeature,
} from '../../shared/constants'
import type { HostServices } from '../../shared/hostApi/methods'
import { formatDailyBudget } from '../../shared/l10n/exactUsd'
import { fill } from '../../shared/l10n/text'
import {
  paidFeatureName,
  paidFeaturePrice,
  type PaidState,
  type PaidUseRequest,
} from '../../shared/paid'
import * as z from 'zod/mini'
import type { AcpPaidUse } from '../../acp/paid'
import type { RuntimeSettingsStore } from '../settingsStore'

/** The paid features the runtime's backend can bill (the ACP agent's); the rest are not offered here. */
const BILLABLE: readonly PaidFeature[] = ACP_PAID_FEATURES

const acceptedSchema = z.array(z.enum(PAID_FEATURES))

/** The turn-on confirmation's body: what the feature does and what it costs. */
function confirmationDetail(feature: PaidFeature): string {
  const details: Partial<Record<PaidFeature, string>> = {
    autoCompaction: UI_TEXT.paidConfirmAutoCompaction,
    webSearch: UI_TEXT.paidConfirmWebSearch,
    imageGeneration: UI_TEXT.paidConfirmImage,
    voice: UI_TEXT.paidConfirmVoice,
  }
  return fill(details[feature] ?? UI_TEXT.hostService.notAvailable, {
    price: paidFeaturePrice(feature),
  })
}

export interface RuntimePaidDeps {
  readonly host: HostServices
  readonly store: RuntimeSettingsStore
  readonly settings: () => ExtensionSettings
  /** The settings the person has set, as last read (a feature whose setting is not among them is on by default). */
  readonly configured: () => ReadonlySet<string>
  readonly backend: () => 'museCode' | 'modelApi'
  /** The backend's paid-use policy, once it exists. */
  readonly paidUse: () => AcpPaidUse | undefined
  readonly workspaceRoot: string
  /** The shared daily limit the person set; 0 is none (D208). */
  readonly dailyBudgetUsd: () => number
  readonly isKeyStored: () => boolean
  readonly log: Logger
}

export interface RuntimePaid {
  readonly gate: PaidFeatureGate
  readonly usage: PaidUsage
  /** The paid features this runtime's backend may bill now, for the backend's own flags. */
  flagged(): readonly AcpPaidFeature[]
  /** What the badge, toggles and tally show. */
  state(): PaidState
  /** The question before a paid use, answered by the editor. */
  readonly ask: (
    sessionId: string,
    request: PaidUseRequest,
    canRemember: boolean,
    accountLine?: string,
  ) => Promise<PaidUseAnswer>
  /** Loads what the gate keeps in the runtime's storage. */
  load(): Promise<void>
}

/**
The gate, tally and question of one runtime panel. `isCurrent` says whether
a conversation may still be billed (it is held and not let go); `signalFor`
ends the editor's open question with the conversation.
*/
export function createRuntimePaid(
  deps: RuntimePaidDeps,
  conversation: {
    readonly isCurrent: (sessionId: string) => boolean
    readonly signalFor: (sessionId: string) => AbortSignal | undefined
  },
): RuntimePaid {
  const { host, store, log } = deps
  let accepted: ReadonlySet<PaidFeature> = new Set()
  const gate = new PaidFeatureGate({
    isSettingOn: (feature) => isActivationPaidSettingOn(feature, deps.settings()),
    isAvailable: (feature) =>
      BILLABLE.includes(feature) &&
      (deps.backend() === 'modelApi' || !deps.configured().has(PAID_FEATURE_SETTINGS[feature])),
    isDefaultOn: (feature) => !deps.configured().has(PAID_FEATURE_SETTINGS[feature]),
    setSetting: async (feature, isOn) => {
      await store.updateSetting(`museSpark.${PAID_FEATURE_SETTINGS[feature]}`, isOn, 'user')
    },
    readAccepted: () => accepted,
    writeAccepted: async (next) => {
      accepted = new Set(next)
      await store.setStorage('paidConfirmations', [...next], 'user')
    },
    confirm: async (feature) => {
      const accept = 1
      const answer = await host.request('ui/confirm', {
        title: fill(UI_TEXT.paidConfirmTitle, { feature: paidFeatureName(feature) }),
        message: confirmationDetail(feature),
        choices: [{ id: accept, title: UI_TEXT.paidConfirmAccept }],
      })
      return answer === accept
    },
    // The runtime cannot tell which window has the person: the editor that asked is the one.
    isWindowFocused: () => true,
    log,
  })
  const usage = new PaidUsage(log)
  return {
    gate,
    usage,
    flagged: () => ACP_PAID_FEATURES.filter((feature) => gate.isOn(feature)),
    state: () => {
      const paidUse = deps.paidUse()
      const remembered =
        paidUse === undefined
          ? []
          : PAID_FEATURES.filter((feature) => paidUse.isRemembered(deps.workspaceRoot, feature))
      return paidStateOf(gate, usage, deps.isKeyStored(), remembered)
    },
    ask: async (sessionId, request, canRemember, accountLine) => {
      if (!conversation.isCurrent(sessionId)) return 'deny'
      const { title, detail } = await paidUseQuestion(request)
      const budget = deps.dailyBudgetUsd()
      const lines = [
        detail,
        // A limit the person set is named; with none set the question says so, and checks nothing.
        ...(deps.backend() === 'modelApi'
          ? [fill(UI_TEXT.paidDailyBudgetLine, { budget: formatDailyBudget(budget) })]
          : []),
        ...(accountLine === undefined ? [] : [accountLine]),
      ]
      const signal = conversation.signalFor(sessionId)
      const answer = await host.request(
        'ui/confirm',
        {
          title,
          message: lines.join('\n\n'),
          choices: [
            { id: ACP_PAID_OPTIONS.allowOnce, title: UI_TEXT.allowOnce },
            ...(canRemember
              ? [{ id: ACP_PAID_OPTIONS.allowAlways, title: UI_TEXT.paidAllowAlways }]
              : []),
            { id: ACP_PAID_OPTIONS.deny, title: UI_TEXT.paidDeny },
          ],
        },
        signal,
      )
      // A conversation let go while the editor was asked is billed for nothing.
      if (!conversation.isCurrent(sessionId)) return 'deny'
      if (answer === ACP_PAID_OPTIONS.allowOnce) return 'once'
      return canRemember && answer === ACP_PAID_OPTIONS.allowAlways ? 'always' : 'deny'
    },
    load: async () => {
      const stored = acceptedSchema.safeParse(
        (await store.getStorage('paidConfirmations', 'user')) ?? [],
      )
      accepted = new Set(stored.success ? stored.data : [])
    },
  }
}
