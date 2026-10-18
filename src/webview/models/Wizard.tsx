// Adding a provider as the wizard `wizardFlow.ts` defines it (M95 step
// 8): pick a provider, the prefilled form, the credential, the test, the
// models, OpenRouter's privacy, the suggestions, confirm. The host runs
// the machine (lane K) and holds the draft in memory only; this renders
// the draft's step and posts its events. Cancel writes nothing: no
// provider in `providers.json`, no secret in SecretStorage.

import { useState, type ReactNode } from 'react'
import { usdInputSchema, type UsdAmount } from '../../shared/usdSchema'
import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type {
  ModelsCustomFormat,
  ModelsPanelState,
  ModelsPrivacy,
  PanelDraft,
  PanelToHostMessage,
  PresetCard,
  PrefillFields,
  TickScope,
} from '../../shared/modelsPanel'
import type { WizardLife } from './reducer'
import { CostNotice } from './components/CostNotice'
import { InlineError } from './components/InlineError'
import { SearchableSelect, type SelectChip } from './components/SearchableSelect'
import { SuggestionCard } from './components/SuggestionCard'

export interface WizardProps {
  readonly panelState: ModelsPanelState
  readonly draft: PanelDraft
  /** The draft's generation: pending work posts only while it is current. */
  readonly life: WizardLife
  readonly post: (message: PanelToHostMessage) => void
  readonly onNavigateModels: () => void
  readonly onClose: () => void
}

function presetOf(panelState: ModelsPanelState, draft: PanelDraft): PresetCard | undefined {
  return panelState.presets.find((preset) => preset.id === draft.presetId)
}

function cancelWizard(
  post: (message: PanelToHostMessage) => void,
  onClose: () => void,
): () => void {
  return () => {
    post({ type: 'providers/wizard', event: 'cancel' })
    onClose()
  }
}

function WizardNav({
  post,
  onClose,
  showBack,
  continueLabel,
  continueDisabled,
}: {
  readonly post: (message: PanelToHostMessage) => void
  readonly onClose: () => void
  readonly showBack: boolean
  readonly continueLabel: string
  readonly continueDisabled: boolean
}) {
  return (
    <div className="models-row-actions">
      {showBack && (
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/wizard', event: 'back' })
          }}
        >
          {UI_TEXT.wizardBack}
        </button>
      )}
      <button
        type="button"
        className="models-button-primary"
        disabled={continueDisabled}
        onClick={() => {
          post({ type: 'providers/wizard', event: 'next' })
        }}
      >
        {continueLabel}
      </button>
      <button type="button" className="models-button" onClick={cancelWizard(post, onClose)}>
        {UI_TEXT.wizardCancel}
      </button>
    </div>
  )
}

/**
 * The closing block of every wizard step except confirm: the step's
 * errors and blockers, then Continue with Back and Cancel beside it.
 * Continue stays disabled with the blockers inline while any stands.
 */
function StepFoot({
  errors,
  blockers,
  post,
  onClose,
}: {
  readonly errors: readonly string[]
  readonly blockers: readonly string[]
  readonly post: (message: PanelToHostMessage) => void
  readonly onClose: () => void
}) {
  return (
    <>
      <InlineError messages={[...errors, ...blockers]} />
      <WizardNav
        post={post}
        onClose={onClose}
        showBack={true}
        continueLabel={UI_TEXT.wizardContinue}
        continueDisabled={blockers.length > 0}
      />
    </>
  )
}

/**
 * The closing block of the suggestions and confirm steps: the draft's
 * errors and blockers, then Back, the step's own primary buttons, and
 * Cancel.
 */
function StepActions({
  draft,
  post,
  onClose,
  children,
}: {
  readonly draft: PanelDraft
  readonly post: (message: PanelToHostMessage) => void
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  return (
    <>
      <InlineError messages={[...draft.errors, ...draft.blockers]} />
      <div className="models-row-actions">
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/wizard', event: 'back' })
          }}
        >
          {UI_TEXT.wizardBack}
        </button>
        {children}
        <button type="button" className="models-button" onClick={cancelWizard(post, onClose)}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    </>
  )
}

/**
 * Why a subscription sign-in row cannot be picked, or undefined when it can.
 * A confidential workspace hides Copilot outright (the README's rule); any
 * other unavailable sign-in stays visible but disabled, with its reason.
 */
function signInReason(
  panelState: ModelsPanelState,
  preset: PresetCard,
): { readonly hidden: boolean; readonly reason?: string } {
  if (preset.auth !== 'subscription' || (preset.id !== 'chatgpt' && preset.id !== 'copilot')) {
    return { hidden: false }
  }
  if (preset.id === 'copilot' && panelState.confidentialWorkspace === true) {
    return { hidden: true }
  }
  if (preset.id === 'copilot' && panelState.copilotAvailable !== true) {
    return { hidden: false, reason: UI_TEXT.signInNotOffered }
  }
  if (preset.id === 'copilot') {
    return { hidden: false }
  }
  if (panelState.subscriptionsAvailable !== true) {
    return { hidden: false, reason: UI_TEXT.signInNotOffered }
  }
  return panelState.remoteWindow === true
    ? { hidden: false, reason: UI_TEXT.signInRemoteWindow }
    : { hidden: false }
}

function PickStep({ panelState, post, onClose }: Omit<WizardProps, 'draft' | 'onNavigateModels'>) {
  const [chip, setChip] = useState<string | undefined>(undefined)
  const filters = UI_TEXT.providerFilters
  const chips: readonly SelectChip[] = [
    { value: 'cloud', label: filters.cloud },
    { value: 'local', label: filters.local },
    { value: 'subscription', label: filters.subscription },
    { value: 'aggregator', label: filters.aggregator },
  ]
  // The last **Scan this computer** run: each server that answered opens
  // its own wizard with the answering port filled; an empty run says so
  // and names each local app with its usual port.
  const scan = panelState.localScan
  return (
    <div className="models-wizard-step">
      <h3>{UI_TEXT.wizardPickProvider}</h3>
      <SearchableSelect
        label={UI_TEXT.providerFields.provider}
        placeholder={UI_TEXT.providerSearchPlaceholder}
        options={panelState.presets.flatMap((preset) => {
          const availability = signInReason(panelState, preset)
          if (availability.hidden) {
            return []
          }
          return [
            {
              value: preset.id,
              label: preset.label,
              description: preset.description,
              category: preset.category,
              ...(availability.reason !== undefined && {
                disabled: true,
                disabledReason: availability.reason,
              }),
            },
          ]
        })}
        chips={chips}
        activeChip={chip}
        onChip={setChip}
        onSelect={(presetId) => {
          post({ type: 'providers/select', presetId })
        }}
        footer={
          <button
            type="button"
            className="models-button"
            onClick={() => {
              post({ type: 'providers/scanLocal' })
            }}
          >
            {UI_TEXT.scanComputer}
          </button>
        }
      />
      {scan !== undefined &&
        (scan.found.length > 0 ? (
          <ul className="models-scan-found">
            {scan.found.map((hit) => (
              <li key={hit.presetId}>
                <button
                  type="button"
                  className="models-button"
                  onClick={() => {
                    post({ type: 'providers/select', presetId: hit.presetId })
                    post({ type: 'providers/prefill', fields: { loopbackPort: hit.port } })
                  }}
                >
                  {fill(UI_TEXT.localScanChoice, { label: hit.label, port: String(hit.port) })}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="models-hint" role="status">
              {UI_TEXT.localScanEmpty}
            </p>
            <ul className="models-scan-checked">
              {scan.checked.map((hit) => (
                <li key={hit.presetId}>
                  {fill(UI_TEXT.localScanChoice, { label: hit.label, port: String(hit.port) })}
                </li>
              ))}
            </ul>
          </>
        ))}
      <div className="models-row-actions">
        <button type="button" className="models-button" onClick={cancelWizard(post, onClose)}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    </div>
  )
}

function ConfigureStep({
  panelState,
  draft,
  post,
  onClose,
}: Omit<WizardProps, 'onNavigateModels'>) {
  const preset = presetOf(panelState, draft)
  const fields = UI_TEXT.providerDetailFields
  const edit = (patch: {
    readonly address?: string | undefined
    readonly azureResource?: string | undefined
    readonly deployment?: string | undefined
    readonly loopbackPort?: number | undefined
    readonly customFormat?: ModelsCustomFormat | undefined
  }): void => {
    post({ type: 'providers/prefill', fields: patch })
  }
  return (
    <div className="models-wizard-step">
      <h3>{preset?.label ?? UI_TEXT.providerFields.provider}</h3>
      {preset?.originKind === 'fixed' && <p className="models-origin">{preset.originDisplay}</p>}
      {preset?.originKind === 'azure-resource' && (
        <>
          <label className="models-field" htmlFor="models-azure-resource">
            <span>{fields.azureResource}</span>
            <input
              id="models-azure-resource"
              type="text"
              value={draft.azureResource ?? ''}
              onChange={(event) => {
                edit({ azureResource: event.target.value })
              }}
            />
          </label>
          <label className="models-field" htmlFor="models-deployment">
            <span>{fields.deployment}</span>
            <input
              id="models-deployment"
              type="text"
              value={draft.deployment ?? ''}
              onChange={(event) => {
                edit({ deployment: event.target.value })
              }}
            />
          </label>
        </>
      )}
      {preset?.originKind === 'loopback' && (
        <label className="models-field" htmlFor="models-loopback-port">
          <span>{fields.loopbackPort}</span>
          <input
            id="models-loopback-port"
            type="number"
            min={1}
            value={draft.loopbackPort ?? ''}
            onChange={(event) => {
              const port = event.target.valueAsNumber
              edit({ loopbackPort: Number.isNaN(port) ? undefined : port })
            }}
          />
        </label>
      )}
      {preset?.originKind === 'custom' && (
        <>
          <label className="models-field" htmlFor="models-custom-address">
            <span>{UI_TEXT.providerFields.address}</span>
            <input
              id="models-custom-address"
              type="text"
              inputMode="url"
              value={draft.address ?? ''}
              onChange={(event) => {
                edit({ address: event.target.value })
              }}
            />
          </label>
          <label className="models-field" htmlFor="models-custom-format">
            <span>{fields.customFormat}</span>
            <select
              id="models-custom-format"
              value={draft.customFormat ?? 'chat'}
              onChange={(event) => {
                const customFormat = event.target.value
                edit({
                  customFormat:
                    customFormat === 'responses' || customFormat === 'anthropic'
                      ? customFormat
                      : 'chat',
                })
              }}
            >
              <option value="chat">{UI_TEXT.wireFormats.chat}</option>
              <option value="responses">{UI_TEXT.wireFormats.responses}</option>
              <option value="anthropic">{UI_TEXT.wireFormats.anthropic}</option>
            </select>
          </label>
        </>
      )}
      <StepFoot errors={draft.errors} blockers={draft.blockers} post={post} onClose={onClose} />
    </div>
  )
}

function CredentialStep({
  panelState,
  draft,
  post,
  onClose,
}: Omit<WizardProps, 'onNavigateModels'>) {
  const preset = presetOf(panelState, draft)
  const [connecting, setConnecting] = useState(false)
  if (draft.auth === 'none') {
    return (
      <div className="models-wizard-step">
        <h3>{preset?.label ?? UI_TEXT.providerFields.provider}</h3>
        <StepFoot errors={draft.errors} blockers={draft.blockers} post={post} onClose={onClose} />
      </div>
    )
  }
  return (
    <div className="models-wizard-step">
      <h3>{preset?.label ?? UI_TEXT.providerFields.provider}</h3>
      <p className="models-hint">{preset?.keyHint}</p>
      {preset?.keyPage !== undefined && (
        <button
          type="button"
          className="models-link"
          onClick={() => {
            post({ type: 'openExternal', url: preset.keyPage ?? '' })
          }}
        >
          {UI_TEXT.getKey}
        </button>
      )}
      <div className="models-row-actions">
        <button
          type="button"
          className="models-button-primary"
          onClick={() => {
            post({ type: 'providers/enterKey', mode: 'new' })
          }}
        >
          {UI_TEXT.enterKey}
        </button>
        {preset?.connectOAuth === true && (
          <button
            type="button"
            className="models-button"
            onClick={() => {
              setConnecting(true)
              post({ type: 'providers/connect' })
            }}
          >
            {fill(UI_TEXT.providerConnect, { provider: preset.label })}
          </button>
        )}
      </div>
      {preset?.id === 'openrouter' && !preset.connectOAuth && (
        <p className="models-hint" role="status">
          {UI_TEXT.providerOpenRouterServices}
        </p>
      )}
      {draft.keyPresent && (
        <p className="models-hint" role="status">
          {fill(UI_TEXT.keyStoredNote, {
            origin: draft.address ?? preset?.originDisplay ?? '',
          })}
        </p>
      )}
      {connecting && !draft.connected && (
        <p className="models-hint" role="status">
          {fill(UI_TEXT.providerConnectWaiting, { provider: preset?.label ?? '' })}
        </p>
      )}
      <StepFoot errors={draft.errors} blockers={draft.blockers} post={post} onClose={onClose} />
    </div>
  )
}

function TestStep({ panelState, draft, post, onClose }: Omit<WizardProps, 'onNavigateModels'>) {
  const preset = presetOf(panelState, draft)
  const test = draft.test
  return (
    <div className="models-wizard-step">
      <h3>{preset?.label ?? UI_TEXT.providerFields.provider}</h3>
      {test === undefined && (
        <button
          type="button"
          className="models-button-primary"
          onClick={() => {
            post({ type: 'providers/test', acceptCost: false })
          }}
        >
          {UI_TEXT.testConnection}
        </button>
      )}
      {test?.status === 'testing' && (
        <p className="models-hint" role="status">
          {UI_TEXT.testRunning}
        </p>
      )}
      {test?.status === 'ok' && (
        <p className="models-hint" role="status">
          {plural(UI_TEXT.providerKeyWorks, test.modelCount ?? 0)}
        </p>
      )}
      {test?.status === 'failed' && (
        <>
          <InlineError
            messages={[fill(UI_TEXT.providerTestFailed, { detail: test.detail ?? '' })]}
          />
          <button
            type="button"
            className="models-button"
            onClick={() => {
              post({ type: 'providers/test', acceptCost: false })
            }}
          >
            {UI_TEXT.testConnection}
          </button>
        </>
      )}
      {test?.status === 'needs-cost' && test.costUsd !== undefined && (
        <CostNotice
          costUsd={test.costUsd}
          onAccept={() => {
            post({ type: 'providers/test', acceptCost: true })
          }}
          onDecline={() => {
            post({ type: 'providers/wizard', event: 'back' })
          }}
        />
      )}
      <StepFoot errors={draft.errors} blockers={draft.blockers} post={post} onClose={onClose} />
    </div>
  )
}

export function ModelLimitsFields({
  draft,
  id,
  modelId,
  reportedContext,
  onPrefill,
}: {
  readonly draft: PanelDraft
  readonly id: string
  readonly modelId: string
  readonly reportedContext?: number | undefined
  readonly onPrefill: (fields: PrefillFields) => void
}) {
  // A custom server saves every chosen model's limits: the scan fills what
  // it reported, and each ticked row asks the rest as plain numbers. An
  // emptied field drops that number, never sends it.
  const setLimit = (kind: 'contextTokens' | 'outputTokens', raw: number): void => {
    const valued = Number.isNaN(raw) ? undefined : Math.floor(raw)
    const current = draft.modelLimits?.[modelId]
    const contextTokens = kind === 'contextTokens' ? valued : current?.contextTokens
    const outputTokens = kind === 'outputTokens' ? valued : current?.outputTokens
    onPrefill({
      modelLimits: {
        ...draft.modelLimits,
        [modelId]: {
          ...(contextTokens !== undefined && { contextTokens }),
          ...(outputTokens !== undefined && { outputTokens }),
        },
      },
    })
  }
  return (
    <div className="models-limits">
      <label className="models-field" htmlFor={`models-limits-context-${id}`}>
        <span>{UI_TEXT.customLimitsContext}</span>
        <input
          id={`models-limits-context-${id}`}
          type="number"
          min={1}
          value={draft.modelLimits?.[modelId]?.contextTokens ?? reportedContext ?? ''}
          onChange={(event) => {
            setLimit('contextTokens', event.target.valueAsNumber)
          }}
        />
      </label>
      <label className="models-field" htmlFor={`models-limits-output-${id}`}>
        <span>{UI_TEXT.customLimitsOutput}</span>
        <input
          id={`models-limits-output-${id}`}
          type="number"
          min={1}
          value={draft.modelLimits?.[modelId]?.outputTokens ?? ''}
          onChange={(event) => {
            setLimit('outputTokens', event.target.valueAsNumber)
          }}
        />
      </label>
    </div>
  )
}

function WizardModelsStep({
  panelState,
  draft,
  post,
  onClose,
}: Omit<WizardProps, 'onNavigateModels'>) {
  const rows = panelState.models.filter((row) => row.providerId === draft.presetId)
  const isCustom = draft.presetId === 'custom'
  // The draft holds bare model ids (the host strips the `<providerId>/`
  // prefix), so ticked state compares those, while the message keeps the
  // full ref the host routes on.
  const toggle = (ref: string, modelId: string): void => {
    const scope: TickScope = { scope: 'wizard' }
    post({
      type: 'models/tick',
      scope,
      ref,
      ticked: !draft.models.includes(modelId),
    })
  }
  return (
    <div className="models-wizard-step">
      <h3>{UI_TEXT.providerFields.models}</h3>
      {rows.length === 0 && <p className="models-hint">{UI_TEXT.modelsNotScanned}</p>}
      <ul className="models-tick-list">
        {rows.map((row) => (
          <li key={row.ref}>
            <label className="models-tick" htmlFor={`models-wizard-tick-${row.ref}`}>
              <input
                id={`models-wizard-tick-${row.ref}`}
                type="checkbox"
                checked={draft.models.includes(row.modelId)}
                onChange={() => {
                  toggle(row.ref, row.modelId)
                }}
              />
              <span>{row.label ?? row.modelId}</span>
            </label>
            {!row.toolCalling && (
              <p className="models-hint" role="note">
                {fill(UI_TEXT.providerModelNoToolCalling, { model: row.ref })}
              </p>
            )}
            {isCustom && draft.models.includes(row.modelId) && (
              <ModelLimitsFields
                id={row.ref}
                modelId={row.modelId}
                draft={draft}
                reportedContext={row.contextTokens}
                onPrefill={(fields) => {
                  post({ type: 'providers/prefill', fields })
                }}
              />
            )}
          </li>
        ))}
      </ul>
      <StepFoot errors={draft.errors} blockers={draft.blockers} post={post} onClose={onClose} />
    </div>
  )
}

function PrivacyStep({ panelState, draft, post, onClose }: Omit<WizardProps, 'onNavigateModels'>) {
  const preset = presetOf(panelState, draft)
  const choices: readonly {
    readonly value: ModelsPrivacy
    readonly label: string
    readonly detail: string
  }[] = [
    {
      value: 'zdr',
      label: UI_TEXT.privacyNoRetention,
      detail: UI_TEXT.privacyNoRetentionDetail,
    },
    {
      value: 'no-training',
      label: UI_TEXT.privacyNoTraining,
      detail: UI_TEXT.privacyNoTrainingDetail,
    },
    {
      value: 'any',
      label: UI_TEXT.privacyAnyProvider,
      detail: UI_TEXT.privacyAnyDetail,
    },
  ]
  return (
    <div className="models-wizard-step">
      <h3>{UI_TEXT.providerFields.privacy}</h3>
      <div
        className="models-radio-group"
        role="radiogroup"
        aria-label={UI_TEXT.providerFields.privacy}
      >
        {choices.map((choice) => (
          <label
            key={choice.value}
            className="models-radio"
            htmlFor={`models-privacy-${choice.value}`}
          >
            <input
              id={`models-privacy-${choice.value}`}
              type="radio"
              name="models-privacy"
              checked={draft.privacy === choice.value}
              onChange={() => {
                post({ type: 'providers/prefill', fields: { privacy: choice.value } })
              }}
            />
            <span>
              <span className="models-radio-label">{choice.label}</span>
              <span className="models-radio-detail">{choice.detail}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="models-field" htmlFor="models-provider-order">
        <span>{UI_TEXT.openRouterOrder}</span>
        <input
          id="models-provider-order"
          type="text"
          value={draft.providerOrder.join(', ')}
          onChange={(event) => {
            const order = event.target.value
              .split(',')
              .map((part) => part.trim())
              .filter((part) => part !== '')
            post({ type: 'providers/prefill', fields: { providerOrder: order } })
          }}
        />
      </label>
      <label className="models-check" htmlFor="models-allow-fallbacks">
        <input
          id="models-allow-fallbacks"
          type="checkbox"
          checked={draft.allowFallbacks}
          onChange={(event) => {
            post({ type: 'providers/prefill', fields: { allowFallbacks: event.target.checked } })
          }}
        />
        <span>{UI_TEXT.openRouterFallback}</span>
      </label>
      {preset?.keyPage !== undefined && (
        <button
          type="button"
          className="models-link"
          onClick={() => {
            post({ type: 'openExternal', url: preset.keyPage ?? '' })
          }}
        >
          {UI_TEXT.spendLimitLink}
        </button>
      )}
      <StepFoot errors={draft.errors} blockers={draft.blockers} post={post} onClose={onClose} />
    </div>
  )
}

function SuggestionsStep({ panelState, draft, post, onClose, onNavigateModels }: WizardProps) {
  // The spending limit IS the conversation spending limit setting: the
  // Untouched fields follow the effective setting. An edit retains its
  // prefill for the host's compare-and-set after provider persistence.
  // An unparseable number disables Continue (nothing is saved until the
  // field holds a non-negative dollar amount); the wording of the failure
  // stays host-side with the write, so this lazy bundle carries no error
  // string for the field.
  const [budgetEdit, setBudgetEdit] = useState<{ text: string; expectedUsd: UsdAmount }>()
  const budgetText =
    budgetEdit?.text ?? draft.sessionBudgetUsd ?? panelState.sessionBudget.effectiveUsd
  const ticked = draft.models
  const budgetParsed = usdInputSchema.safeParse(budgetText.trim().replace(',', '.'))
  const commitAndNext = (): void => {
    if (!budgetParsed.success) {
      return
    }
    if (budgetEdit !== undefined) {
      post({
        type: 'suggestions/change',
        kind: 'sessionBudget',
        usd: budgetParsed.data,
        expectedUsd: budgetEdit.expectedUsd,
      })
    }
    post({ type: 'providers/wizard', event: 'next' })
  }
  return (
    <div className="models-wizard-step">
      {panelState.suggestions.length === 0 && (
        <p className="models-hint">{UI_TEXT.suggestUnavailable}</p>
      )}
      {panelState.suggestions.map(
        (suggestion) =>
          suggestion.kind === 'defaultModel' && (
            <SuggestionCard
              key={suggestion.kind}
              title={UI_TEXT.suggestDefaultModel}
              reason={suggestion.reason}
              value={suggestion.modelRef}
              accepted={suggestion.accepted}
              onAccept={() => {
                post({ type: 'suggestions/accept', kind: 'defaultModel' })
              }}
              onChange={() => {
                onNavigateModels()
              }}
            />
          ),
      )}
      {ticked.length > 0 && (
        <label className="models-field" htmlFor="models-default-override">
          <span>{UI_TEXT.suggestDefaultModel}</span>
          <select
            id="models-default-override"
            value={draft.defaultModel ?? ''}
            onChange={(event) => {
              const modelRef = event.target.value
              post({
                type: 'suggestions/change',
                kind: 'defaultModel',
                modelRef: modelRef === '' ? undefined : modelRef,
              })
            }}
          >
            <option value="">{UI_TEXT.suggestDefaultModel}</option>
            {ticked.map((ref) => (
              <option key={ref} value={ref}>
                {ref}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="models-field" htmlFor="models-budget-override">
        <span>{UI_TEXT.wizardSessionBudget}</span>
        <input
          id="models-budget-override"
          type="number"
          min={0}
          value={budgetText}
          onChange={(event) => {
            setBudgetEdit({
              text: event.target.value,
              expectedUsd:
                budgetEdit?.expectedUsd ??
                draft.sessionBudgetExpectedUsd ??
                panelState.sessionBudget.effectiveUsd,
            })
          }}
        />
      </label>
      <p className="models-hint">{panelState.sessionBudget.nowLine}</p>
      {panelState.lastChoices.defaultModelRef !== undefined && (
        <p className="models-hint">
          {fill(UI_TEXT.lastDefaultHint, { model: panelState.lastChoices.defaultModelRef })}
        </p>
      )}
      <StepActions draft={draft} post={post} onClose={onClose}>
        <button
          type="button"
          className="models-button-primary"
          disabled={draft.blockers.length > 0 || !budgetParsed.success}
          onClick={commitAndNext}
        >
          {UI_TEXT.wizardContinue}
        </button>
      </StepActions>
    </div>
  )
}

function ConfirmStep({
  draft,
  post,
  onClose,
}: Omit<WizardProps, 'panelState' | 'onNavigateModels'>) {
  // **Save** stays disabled until the form is valid, with each blocker
  // inline in plain words.
  const isBlocked = draft.saving === true || draft.blockers.length > 0
  const save = (shouldUseNow: boolean): void => {
    if (isBlocked) {
      return
    }
    post({ type: 'providers/save', useNow: shouldUseNow })
  }
  return (
    <div className="models-wizard-step">
      {draft.summary !== undefined && (
        <ul className="models-summary">
          {draft.summary.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <StepActions draft={draft} post={post} onClose={onClose}>
        <button
          type="button"
          className="models-button-primary"
          disabled={isBlocked}
          onClick={() => {
            save(false)
          }}
        >
          {UI_TEXT.saveProvider}
        </button>
        <button
          type="button"
          className="models-button-primary"
          disabled={isBlocked}
          onClick={() => {
            save(true)
          }}
        >
          {UI_TEXT.saveAndUseNow}
        </button>
      </StepActions>
    </div>
  )
}

export function Wizard(props: WizardProps) {
  const { draft } = props
  switch (draft.step) {
    case 'pick-provider': {
      return <PickStep {...props} />
    }
    case 'configure': {
      return <ConfigureStep {...props} />
    }
    case 'credential': {
      return <CredentialStep {...props} />
    }
    case 'test': {
      return <TestStep {...props} />
    }
    case 'models': {
      return <WizardModelsStep {...props} />
    }
    case 'privacy': {
      return <PrivacyStep {...props} />
    }
    case 'suggestions': {
      return <SuggestionsStep {...props} />
    }
    case 'confirm':
    case 'done': {
      return <ConfirmStep {...props} />
    }
  }
}
