// Adding a provider as the wizard `wizardFlow.ts` defines it (M95 step
// 8): pick a provider, the prefilled form, the credential, the test, the
// models, OpenRouter's privacy, the suggestions, confirm. The host runs
// the machine (lane K) and holds the draft in memory only; this renders
// the draft's step and posts its events. Cancel writes nothing: no
// provider in `providers.json`, no secret in SecretStorage.

import { useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatUsd, plural } from '../../shared/l10n/text'
import type {
  ModelsPanelState,
  PanelDraft,
  PanelToHostMessage,
  PresetCard,
} from '../../shared/modelsPanel'
import { CostNotice } from './components/CostNotice'
import { InlineError } from './components/InlineError'
import { SearchableSelect, type SelectChip } from './components/SearchableSelect'
import { SuggestionCard } from './components/SuggestionCard'

export interface WizardProps {
  readonly panelState: ModelsPanelState
  readonly draft: PanelDraft
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
}: {
  readonly post: (message: PanelToHostMessage) => void
  readonly onClose: () => void
  readonly showBack: boolean
  readonly continueLabel: string
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

function PickStep({ panelState, post, onClose }: Omit<WizardProps, 'draft' | 'onNavigateModels'>) {
  const [chip, setChip] = useState<string | undefined>(undefined)
  const filters = UI_TEXT.providerFilters
  const chips: readonly SelectChip[] = [
    { value: 'cloud', label: filters.cloud },
    { value: 'local', label: filters.local },
    { value: 'subscription', label: filters.subscription },
    { value: 'aggregator', label: filters.aggregator },
  ]
  return (
    <div className="models-wizard-step">
      <h3>{UI_TEXT.wizardPickProvider}</h3>
      <SearchableSelect
        label={UI_TEXT.providerFields.provider}
        placeholder={UI_TEXT.providerSearchPlaceholder}
        options={panelState.presets.map((preset) => ({
          value: preset.id,
          label: preset.label,
          description: preset.description,
          category: preset.category,
        }))}
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
      <div className="models-row-actions">
        <button type="button" className="models-button" onClick={cancelWizard(post, onClose)}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    </div>
  )
}

function ConfigureStep({ panelState, draft, post, onClose }: Omit<WizardProps, 'onNavigateModels'>) {
  const preset = presetOf(panelState, draft)
  const fields = UI_TEXT.providerDetailFields
  const edit = (patch: {
    readonly address?: string | undefined
    readonly azureResource?: string | undefined
    readonly deployment?: string | undefined
    readonly loopbackPort?: number | undefined
    readonly customFormat?: 'chat' | 'responses' | 'anthropic' | undefined
  }): void => {
    post({ type: 'providers/prefill', fields: patch })
  }
  return (
    <div className="models-wizard-step">
      <h3>{preset?.label ?? UI_TEXT.providerFields.provider}</h3>
      {preset?.originKind === 'fixed' && (
        <p className="models-origin">
          {preset.originDisplay}
        </p>
      )}
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
      <InlineError messages={draft.errors} />
      <WizardNav post={post} onClose={onClose} showBack={true} continueLabel={UI_TEXT.wizardContinue} />
    </div>
  )
}

function CredentialStep({ panelState, draft, post, onClose }: Omit<WizardProps, 'onNavigateModels'>) {
  const preset = presetOf(panelState, draft)
  const [connecting, setConnecting] = useState(false)
  if (draft.auth === 'none') {
    return (
      <div className="models-wizard-step">
        <h3>{preset?.label ?? UI_TEXT.providerFields.provider}</h3>
        <InlineError messages={draft.errors} />
        <WizardNav post={post} onClose={onClose} showBack={true} continueLabel={UI_TEXT.wizardContinue} />
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
      <InlineError messages={draft.errors} />
      <WizardNav post={post} onClose={onClose} showBack={true} continueLabel={UI_TEXT.wizardContinue} />
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
      <InlineError messages={draft.errors} />
      <WizardNav post={post} onClose={onClose} showBack={true} continueLabel={UI_TEXT.wizardContinue} />
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
  const toggle = (ref: string): void => {
    post({
      type: 'models/tick',
      scope: { scope: 'wizard' },
      ref,
      ticked: !draft.models.includes(ref),
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
                checked={draft.models.includes(row.ref)}
                onChange={() => {
                  toggle(row.ref)
                }}
              />
              <span>{row.label ?? row.modelId}</span>
            </label>
          </li>
        ))}
      </ul>
      <InlineError messages={draft.errors} />
      <WizardNav post={post} onClose={onClose} showBack={true} continueLabel={UI_TEXT.wizardContinue} />
    </div>
  )
}

function PrivacyStep({ panelState, draft, post, onClose }: Omit<WizardProps, 'onNavigateModels'>) {
  const preset = presetOf(panelState, draft)
  const choices = [
    {
      value: 'zdr' as const,
      label: UI_TEXT.privacyNoRetention,
      detail: UI_TEXT.privacyNoRetentionDetail,
    },
    {
      value: 'no-training' as const,
      label: UI_TEXT.privacyNoTraining,
      detail: UI_TEXT.privacyNoTrainingDetail,
    },
    {
      value: 'any' as const,
      label: UI_TEXT.privacyAnyProvider,
      detail: UI_TEXT.privacyAnyDetail,
    },
  ]
  return (
    <div className="models-wizard-step">
      <h3>{UI_TEXT.providerFields.privacy}</h3>
      <div className="models-radio-group" role="radiogroup" aria-label={UI_TEXT.providerFields.privacy}>
        {choices.map((choice) => (
          <label key={choice.value} className="models-radio" htmlFor={`models-privacy-${choice.value}`}>
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
      <InlineError messages={draft.errors} />
      <WizardNav post={post} onClose={onClose} showBack={true} continueLabel={UI_TEXT.wizardContinue} />
    </div>
  )
}

function SuggestionsStep({ panelState, draft, post, onClose, onNavigateModels }: WizardProps) {
  const [budgetOverride, setBudgetOverride] = useState('')
  const ticked = draft.models
  return (
    <div className="models-wizard-step">
      {panelState.suggestions.length === 0 && (
        <p className="models-hint">{UI_TEXT.suggestUnavailable}</p>
      )}
      {panelState.suggestions.map((suggestion) =>
        suggestion.kind === 'defaultModel' ? (
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
        ) : (
          <SuggestionCard
            key={suggestion.kind}
            title={UI_TEXT.suggestSessionBudget}
            reason={suggestion.reason}
            value={formatUsd(suggestion.usd, 2)}
            accepted={suggestion.accepted}
            onAccept={() => {
              post({ type: 'suggestions/accept', kind: 'sessionBudget' })
            }}
            onChange={() => {
              const usd = Number(budgetOverride)
              if (budgetOverride.trim() !== '' && Number.isFinite(usd) && usd > 0) {
                post({ type: 'suggestions/change', kind: 'sessionBudget', usd })
              }
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
        <span>{UI_TEXT.suggestSessionBudget}</span>
        <input
          id="models-budget-override"
          type="number"
          min={0}
          value={budgetOverride}
          onChange={(event) => {
            setBudgetOverride(event.target.value)
          }}
        />
      </label>
      {panelState.lastChoices.defaultModelRef !== undefined && (
        <p className="models-hint">
          {fill(UI_TEXT.lastDefaultHint, { model: panelState.lastChoices.defaultModelRef })}
        </p>
      )}
      <InlineError messages={draft.errors} />
      <WizardNav post={post} onClose={onClose} showBack={true} continueLabel={UI_TEXT.wizardContinue} />
    </div>
  )
}

function ConfirmStep({ draft, post, onClose }: Omit<WizardProps, 'panelState' | 'onNavigateModels'>) {
  // **Save** stays disabled until the form is valid, with each blocker
  // inline in plain words.
  const blocked = draft.blockers.length > 0
  const save = (useNow: boolean): void => {
    if (blocked) {
      return
    }
    post({ type: 'providers/save', useNow })
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
        <button
          type="button"
          className="models-button-primary"
          disabled={blocked}
          onClick={() => {
            save(false)
          }}
        >
          {UI_TEXT.saveProvider}
        </button>
        <button
          type="button"
          className="models-button-primary"
          disabled={blocked}
          onClick={() => {
            save(true)
          }}
        >
          {UI_TEXT.saveAndUseNow}
        </button>
        <button type="button" className="models-button" onClick={cancelWizard(post, onClose)}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
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

