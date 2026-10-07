// Adding a provider as a pure state machine (M95, PLAN.md D74): the panel
// and the quick pick both drive it. Steps: pick a provider, the prefilled
// form, the credential, the test, the models, OpenRouter's privacy, the
// suggestions, confirm, done. **Save** writes `providers.json` and the
// secret together (lane K); **Cancel** at any step leaves nothing saved —
// the draft lives only in this state, so cancelling cannot keep anything.
// A paid test states its cost and waits for `accept-test-cost` first.
// Pure: no clock, no network, no storage.

import { fill, UI_TEXT } from '../../shared/l10n/text'
import { checkEndpointUrl, type EndpointVerdict } from './endpointPolicy'
import type { OpenRouterPrivacy } from './presets'

/** The wizard's steps, in order (privacy only for OpenRouter). */
export type WizardStep =
  | 'pick-provider'
  | 'configure'
  | 'credential'
  | 'test'
  | 'models'
  | 'privacy'
  | 'suggestions'
  | 'confirm'
  | 'done'

export const WIZARD_STEPS: readonly WizardStep[] = [
  'pick-provider',
  'configure',
  'credential',
  'test',
  'models',
  'privacy',
  'suggestions',
  'confirm',
  'done',
]

/** What the free check found (lane K runs it; the machine records it). */
export interface WizardTestResult {
  readonly ok: boolean
  readonly modelCount?: number | undefined
  /** The one-token request's USD cost, where no free check exists. */
  readonly costUsd?: number | undefined
  readonly detail?: string | undefined
}

/** The draft: everything the form holds, in memory only. */
export interface WizardDraft {
  readonly presetId?: string | undefined
  /** A fixed origin, an Azure resource URL, a loopback address or a custom server. */
  readonly address?: string | undefined
  readonly azureResource?: string | undefined
  readonly deployment?: string | undefined
  readonly loopbackPort?: number | undefined
  readonly customFormat?: 'chat' | 'responses' | 'anthropic' | undefined
  readonly auth: 'apiKey' | 'none'
  /** A key was entered (lane K holds it; never the webview, never here). */
  readonly keyPresent: boolean
  readonly keyShapeOk: boolean
  /** OpenRouter's OAuth connect completed (the key arrived with no paste). */
  readonly connected: boolean
  readonly costAccepted: boolean
  readonly test?: WizardTestResult | undefined
  readonly models: readonly string[]
  readonly privacy: OpenRouterPrivacy
  readonly allowFallbacks: boolean
  readonly providerOrder: readonly string[]
  readonly endpoint?: { readonly address: string; readonly verdict: EndpointVerdict } | undefined
  readonly privateConfirmed: boolean
  readonly defaultModel?: string | undefined
  readonly sessionBudgetUsd?: number | undefined
}

export interface WizardState {
  readonly step: WizardStep
  readonly draft: WizardDraft
  readonly cancelled: boolean
  /** The last rejection, in plain words (localized at use time). */
  readonly error?: string | undefined
}

export function startWizard(): WizardState {
  return {
    step: 'pick-provider',
    draft: {
      auth: 'apiKey',
      keyPresent: false,
      keyShapeOk: false,
      connected: false,
      costAccepted: false,
      models: [],
      privacy: 'zdr',
      allowFallbacks: true,
      providerOrder: [],
      privateConfirmed: false,
    },
    cancelled: false,
  }
}

// Only form-owned fields can be edited; credentials, validation and consent
// arrive through their own events, never an unrestricted draft merge.
const WIZARD_FORM_FIELDS = [
  'address',
  'azureResource',
  'deployment',
  'loopbackPort',
  'customFormat',
  'auth',
  'defaultModel',
  'sessionBudgetUsd',
  'allowFallbacks',
  'providerOrder',
] as const
const WIZARD_CONNECTION_FIELDS = [
  'address',
  'azureResource',
  'deployment',
  'loopbackPort',
  'customFormat',
  'auth',
] as const

export type WizardEvent =
  | { readonly type: 'select-preset'; readonly presetId: string; readonly auth: 'apiKey' | 'none' }
  | {
      readonly type: 'edit-form'
      readonly fields: Partial<Pick<WizardDraft, (typeof WIZARD_FORM_FIELDS)[number]>>
    }
  | {
      readonly type: 'validate-endpoint'
      readonly address: string
      readonly answers: readonly string[]
    }
  | { readonly type: 'confirm-private'; readonly confirmed: boolean }
  | { readonly type: 'submit-key'; readonly shapeOk: boolean }
  | { readonly type: 'connect-oauth' }
  | { readonly type: 'accept-test-cost' }
  | { readonly type: 'test-complete'; readonly result: WizardTestResult }
  | { readonly type: 'set-models'; readonly models: readonly string[] }
  | { readonly type: 'set-privacy'; readonly privacy: OpenRouterPrivacy }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'cancel' }
  | { readonly type: 'confirm' }

function failed(state: WizardState, error: string): WizardState {
  return { ...state, error }
}

function stepAfter(step: WizardStep, draft: WizardDraft): WizardStep {
  switch (step) {
    case 'pick-provider': {
      return 'configure'
    }
    case 'configure': {
      return draft.auth === 'none' ? 'test' : 'credential'
    }
    case 'credential': {
      return 'test'
    }
    case 'test': {
      return 'models'
    }
    case 'models': {
      return draft.presetId === 'openrouter' ? 'privacy' : 'suggestions'
    }
    case 'privacy': {
      return 'suggestions'
    }
    case 'suggestions': {
      return 'confirm'
    }
    case 'confirm':
    case 'done': {
      return 'done'
    }
  }
}

function stepBefore(step: WizardStep, draft: WizardDraft): WizardStep {
  switch (step) {
    case 'pick-provider':
    case 'done': {
      return step
    }
    case 'configure': {
      return 'pick-provider'
    }
    case 'credential': {
      return 'configure'
    }
    case 'test': {
      return draft.auth === 'none' ? 'configure' : 'credential'
    }
    case 'models': {
      return 'test'
    }
    case 'privacy': {
      return 'models'
    }
    case 'suggestions': {
      return draft.presetId === 'openrouter' ? 'privacy' : 'models'
    }
    case 'confirm': {
      return 'suggestions'
    }
  }
}

/**
 * The blocking problems for **Save** (empty means saving is allowed):
 * a preset, a valid address, a credential where one is needed, a passed
 * test, at least one ticked model, and the private-network question
 * answered where one was asked.
 */
export function wizardBlockers(state: WizardState): readonly string[] {
  if (state.cancelled || state.step === 'done') {
    return state.step === 'done' ? [] : [UI_TEXT.providerText.wizard.cancelled]
  }
  const blockers: string[] = []
  const draft = state.draft
  if (draft.presetId === undefined) {
    blockers.push(UI_TEXT.providerText.wizard.pick)
  }
  if (draft.address === undefined || draft.address.trim() === '') {
    blockers.push(UI_TEXT.providerText.wizard.address)
  }
  if (draft.endpoint === undefined || draft.endpoint.address !== draft.address) {
    blockers.push(UI_TEXT.providerText.wizard.validate)
  } else if (draft.endpoint.verdict.kind === 'refused') {
    blockers.push(
      fill(UI_TEXT.providerText.wizard.refused, { reason: draft.endpoint.verdict.reason }),
    )
  } else if (draft.endpoint.verdict.kind === 'confirm-private' && !draft.privateConfirmed) {
    blockers.push(UI_TEXT.providerText.wizard.private)
  }
  if (draft.auth !== 'none' && !draft.keyPresent && !draft.connected) {
    blockers.push(UI_TEXT.providerText.wizard.credential)
  }
  if (draft.auth !== 'none' && draft.keyPresent && !draft.keyShapeOk && !draft.connected) {
    blockers.push(UI_TEXT.providerText.wizard.keyShape)
  }
  if (!draft.test?.ok) {
    blockers.push(UI_TEXT.providerText.wizard.test)
  }
  if (draft.models.length === 0) {
    blockers.push(UI_TEXT.providerText.wizard.models)
  }
  return blockers
}

/** One event through the machine; failures keep the state and name the problem. */
export function applyWizardEvent(state: WizardState, event: WizardEvent): WizardState {
  if (state.cancelled) {
    return state
  }
  switch (event.type) {
    case 'cancel': {
      return { ...state, cancelled: true, error: undefined }
    }
    case 'select-preset': {
      if (state.step !== 'pick-provider' && state.step !== 'configure') {
        return failed(state, UI_TEXT.providerText.wizard.pickStep)
      }
      return {
        ...state,
        step: 'configure',
        error: undefined,
        draft: {
          ...startWizard().draft,
          presetId: event.presetId,
          auth: event.auth,
          keyPresent: false,
          keyShapeOk: false,
          connected: false,
          costAccepted: false,
          test: undefined,
          models: [],
        },
      }
    }
    case 'edit-form': {
      let draft = state.draft
      for (const field of WIZARD_FORM_FIELDS) {
        if (Object.hasOwn(event.fields, field)) {
          draft = { ...draft, [field]: event.fields[field] }
        }
      }
      const isChanged = WIZARD_CONNECTION_FIELDS.some(
        (field) => draft[field] !== state.draft[field],
      )
      return {
        ...state,
        error: undefined,
        draft: isChanged
          ? {
              ...draft,
              endpoint: undefined,
              privateConfirmed: false,
              costAccepted: false,
              keyPresent: false,
              keyShapeOk: false,
              connected: false,
              test: undefined,
              models: [],
            }
          : draft,
      }
    }
    case 'validate-endpoint': {
      // Ignore validation completed for an address that has since been edited.
      if (event.address !== state.draft.address) {
        return state
      }
      return {
        ...state,
        error: undefined,
        draft: {
          ...state.draft,
          endpoint: {
            address: event.address,
            verdict: checkEndpointUrl(event.address, event.answers),
          },
          privateConfirmed: false,
        },
      }
    }
    case 'confirm-private': {
      return state.draft.endpoint?.verdict.kind === 'confirm-private'
        ? {
            ...state,
            error: undefined,
            draft: { ...state.draft, privateConfirmed: event.confirmed },
          }
        : failed(state, UI_TEXT.providerText.wizard.private)
    }
    case 'submit-key': {
      if (state.step !== 'credential') {
        return failed(state, UI_TEXT.providerText.wizard.keyStep)
      }
      if (!event.shapeOk) {
        return failed(state, UI_TEXT.providerText.wizard.badKey)
      }
      return {
        ...state,
        error: undefined,
        draft: { ...state.draft, keyPresent: true, keyShapeOk: true, test: undefined },
      }
    }
    case 'connect-oauth': {
      if (state.step !== 'credential') {
        return failed(state, UI_TEXT.providerText.wizard.oauthStep)
      }
      return {
        ...state,
        error: undefined,
        draft: {
          ...state.draft,
          connected: true,
          keyPresent: true,
          keyShapeOk: true,
          test: undefined,
        },
      }
    }
    case 'accept-test-cost': {
      return state.step === 'test'
        ? { ...state, error: undefined, draft: { ...state.draft, costAccepted: true } }
        : failed(state, UI_TEXT.providerText.wizard.costStep)
    }
    case 'test-complete': {
      if (state.step !== 'test') {
        return failed(state, UI_TEXT.providerText.wizard.testStep)
      }
      // Where no free check exists, the one-token request's cost is stated
      // and asked before it is sent: a test carrying a cost without that
      // consent is refused, never recorded.
      return event.result.costUsd !== undefined && !state.draft.costAccepted
        ? failed(state, UI_TEXT.providerText.wizard.costConsent)
        : { ...state, error: undefined, draft: { ...state.draft, test: event.result } }
    }
    case 'set-models': {
      return state.step === 'models'
        ? { ...state, error: undefined, draft: { ...state.draft, models: [...event.models] } }
        : failed(state, UI_TEXT.providerText.wizard.modelsStep)
    }
    case 'set-privacy': {
      return state.step === 'privacy'
        ? { ...state, error: undefined, draft: { ...state.draft, privacy: event.privacy } }
        : failed(state, UI_TEXT.providerText.wizard.privacyStep)
    }
    case 'next': {
      if (
        state.step === 'credential' &&
        state.draft.auth !== 'none' &&
        !state.draft.keyPresent &&
        !state.draft.connected
      ) {
        return failed(state, UI_TEXT.providerText.wizard.credential)
      }
      if (state.step === 'test' && !state.draft.test?.ok) {
        return failed(state, UI_TEXT.providerText.wizard.passedTest)
      }
      if (state.step === 'models' && state.draft.models.length === 0) {
        return failed(state, UI_TEXT.providerText.wizard.models)
      }
      return state.step === 'confirm'
        ? failed(state, UI_TEXT.providerText.wizard.finish)
        : { ...state, error: undefined, step: stepAfter(state.step, state.draft) }
    }
    case 'back': {
      return { ...state, error: undefined, step: stepBefore(state.step, state.draft) }
    }
    case 'confirm': {
      if (state.step !== 'confirm') {
        return failed(state, UI_TEXT.providerText.wizard.confirmStep)
      }
      const blockers = wizardBlockers(state)
      const firstBlocker = blockers.at(0)
      return firstBlocker === undefined
        ? { ...state, error: undefined, step: 'done' }
        : failed(state, firstBlocker)
    }
  }
}

/** The confirm step's summary: what is saved, and who receives the code. */
export function wizardSummary(state: WizardState): {
  readonly origin: string
  readonly lines: readonly string[]
} {
  const draft = state.draft
  const lines = [
    fill(UI_TEXT.providerText.summary.provider, { value: draft.presetId ?? '—' }),
    fill(UI_TEXT.providerText.summary.destination, { value: draft.address ?? '—' }),
    fill(UI_TEXT.providerText.summary.models, {
      value: draft.models.length === 0 ? '—' : draft.models.join(', '),
    }),
    draft.defaultModel === undefined
      ? UI_TEXT.providerText.summary.defaultSuggested
      : fill(UI_TEXT.providerText.summary.defaultModel, { value: draft.defaultModel }),
  ]
  return { origin: draft.address ?? '', lines }
}
