// The Providers section (M95 step 8): each provider with its test
// state, key state ("stored, bound to `<origin>`", never any of the key),
// last scan, usage and Test, Change key or Reconnect, Refresh models,
// Edit, Remove (with Undo), Export and Import.

import { useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatUsd, plural } from '../../shared/l10n/text'
import type {
  ModelsPanelState,
  PanelDraft,
  PrefillFields,
  ProviderState,
  ProviderTest,
} from '../../shared/modelsPanel'
import { formatTestCost } from './components/CostNotice'
import { InlineError } from './components/InlineError'
import { KeyState } from './components/KeyState'
import { ScanStatus } from './components/ScanStatus'
import { UndoBar } from './components/UndoBar'
import type { SectionProps } from './sections'
import { Wizard } from './Wizard'

function TestLine({
  provider,
  onTest,
}: {
  readonly provider: ProviderState
  readonly onTest: (isAccepted: boolean) => void
}) {
  // Declining the paid check only puts it away; the next Test asks again.
  const [costDismissed, setCostDismissed] = useState(false)
  const test: ProviderTest = provider.test
  if (test.status === 'testing') {
    return (
      <p className="models-hint" role="status">
        {UI_TEXT.testRunning}
      </p>
    )
  }
  if (test.status === 'ok') {
    return (
      <p className="models-hint" role="status">
        {plural(UI_TEXT.providerKeyWorks, test.modelCount ?? 0)}
      </p>
    )
  }
  if (test.status === 'failed') {
    return (
      <InlineError messages={[fill(UI_TEXT.providerTestFailed, { detail: test.detail ?? '' })]} />
    )
  }
  if (!costDismissed && test.status === 'needs-cost' && test.costUsd !== undefined) {
    return (
      <div className="models-cost-notice">
        <p>{fill(UI_TEXT.providerTestPaid, { cost: formatTestCost(test.costUsd) })}</p>
        <button
          type="button"
          className="models-button-primary"
          onClick={() => {
            onTest(true)
          }}
        >
          {UI_TEXT.suggestionAccept}
        </button>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            setCostDismissed(true)
          }}
        >
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    )
  }
  return <p className="models-hint">{UI_TEXT.providerUntested}</p>
}

function KeyUsage({ provider }: { readonly provider: ProviderState }) {
  const usage = provider.keyUsage
  if (usage === undefined) {
    return null
  }
  const rows: (readonly [string, number])[] = []
  if (usage.dayUsd !== undefined) {
    rows.push([UI_TEXT.usageToday, usage.dayUsd])
  }
  if (usage.monthUsd !== undefined) {
    rows.push([UI_TEXT.usageThisMonth, usage.monthUsd])
  }
  if (usage.limitUsd !== undefined) {
    rows.push([UI_TEXT.usageLimit, usage.limitUsd])
  }
  if (usage.remainingUsd !== undefined) {
    rows.push([UI_TEXT.usageRemaining, usage.remainingUsd])
  }
  if (rows.length === 0) {
    return null
  }
  return (
    <div className="models-key-usage">
      <h4>{UI_TEXT.usageKeyUsage}</h4>
      <dl className="models-usage">
        {rows.map(([label, usd]) => (
          <div key={label} className="models-usage-row">
            <dt>{label}</dt>
            <dd>{formatUsd(usd, 2)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function EditForm({
  draft,
  editId,
  onSave,
  onCancel,
  onPrefill,
}: {
  readonly draft: PanelDraft
  readonly editId: string
  readonly onSave: () => void
  readonly onCancel: () => void
  readonly onPrefill: (fields: PrefillFields) => void
}) {
  return (
    <div className="models-edit-form">
      <label className="models-field" htmlFor={`models-edit-address-${editId}`}>
        <span>{UI_TEXT.providerFields.address}</span>
        <input
          id={`models-edit-address-${editId}`}
          type="text"
          inputMode="url"
          value={draft.address ?? ''}
          onChange={(event) => {
            onPrefill({ address: event.target.value })
          }}
        />
      </label>
      <InlineError messages={[...draft.errors, ...draft.blockers]} />
      <div className="models-row-actions">
        <button
          type="button"
          className="models-button-primary"
          disabled={draft.blockers.length > 0}
          onClick={onSave}
        >
          {UI_TEXT.saveProvider}
        </button>
        <button type="button" className="models-button" onClick={onCancel}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    </div>
  )
}

/**
 * The pick step before the host's draft arrives: local only, with nothing
 * to save. Cancelling here writes nothing anywhere.
 */
const PICK_DRAFT: PanelDraft = {
  step: 'pick-provider',
  auth: 'apiKey',
  keyPresent: false,
  keyShapeOk: false,
  connected: false,
  costAccepted: false,
  models: [],
  privacy: 'zdr',
  providerOrder: [],
  allowFallbacks: true,
  privateConfirmed: false,
  privateAsked: false,
  errors: [],
  blockers: ['Pick a provider first.'],
}

function ProviderRow({
  provider,
  panelState,
  props,
}: {
  readonly provider: ProviderState
  readonly panelState: ModelsPanelState
  readonly props: SectionProps
}) {
  const { post } = props
  const [editing, setEditing] = useState(false)
  const editDraft = panelState.drafts.edits[provider.id]
  const isHighlighted = props.highlightedItem === provider.id
  return (
    <li className={isHighlighted ? 'models-provider models-provider-highlight' : 'models-provider'}>
      <h3 className="models-provider-name">{provider.label}</h3>
      {provider.address !== undefined && provider.address !== '' && (
        <p className="models-origin">{provider.address}</p>
      )}
      <KeyState credential={provider.key} />
      <TestLine
        provider={provider}
        onTest={(acceptCost) => {
          post({ type: 'providers/test', acceptCost, providerId: provider.id })
        }}
      />
      <KeyUsage provider={provider} />
      <ScanStatus
        scan={panelState.scans[provider.id]}
        onRefresh={() => {
          post({ type: 'models/scan', providerId: provider.id })
        }}
        onCancel={() => {
          post({ type: 'models/cancelScan', providerId: provider.id })
        }}
      />
      <div className="models-row-actions">
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/test', acceptCost: false, providerId: provider.id })
          }}
        >
          {UI_TEXT.testConnection}
        </button>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/enterKey', mode: 'change', providerId: provider.id })
          }}
        >
          {UI_TEXT.changeKey}
        </button>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/connect', providerId: provider.id })
          }}
        >
          {UI_TEXT.reconnectAccount}
        </button>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post(
              editing
                ? { type: 'providers/wizard', event: 'cancel', providerId: provider.id }
                : { type: 'providers/edit', providerId: provider.id },
            )
            setEditing(!editing)
          }}
        >
          {UI_TEXT.providerEdit}
        </button>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/remove', providerId: provider.id })
          }}
        >
          {UI_TEXT.providerRemove}
        </button>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/export', providerId: provider.id })
          }}
        >
          {UI_TEXT.providerExport}
        </button>
      </div>
      {editing && editDraft !== undefined && (
        <EditForm
          draft={editDraft}
          editId={provider.id}
          onSave={() => {
            post({ type: 'providers/save', useNow: false, providerId: provider.id })
            setEditing(false)
          }}
          onCancel={() => {
            post({ type: 'providers/wizard', event: 'cancel', providerId: provider.id })
            setEditing(false)
          }}
          onPrefill={(fields) => {
            post({ type: 'providers/prefill', fields, providerId: provider.id })
          }}
        />
      )}
    </li>
  )
}

function ImportPane({
  panelState,
  post,
  onClose,
}: {
  readonly panelState: ModelsPanelState
  readonly post: SectionProps['post']
  readonly onClose: () => void
}) {
  const [json, setJson] = useState('')
  const preview = panelState.importPreview
  return (
    <div className="models-import">
      <h3>{UI_TEXT.providerImport}</h3>
      <label className="models-field" htmlFor="models-import-json">
        <span>{UI_TEXT.providerImport}</span>
        <textarea
          id="models-import-json"
          rows={6}
          value={json}
          onChange={(event) => {
            setJson(event.target.value)
          }}
        />
      </label>
      <div className="models-row-actions">
        <button
          type="button"
          className="models-button-primary"
          onClick={() => {
            post({ type: 'providers/import', json, confirmed: false })
          }}
        >
          {UI_TEXT.providerImport}
        </button>
        <button type="button" className="models-button" onClick={onClose}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
      {preview !== undefined && (
        <div className="models-import-preview">
          <h4>{UI_TEXT.providerImportPreviewTitle}</h4>
          <p className="models-hint">{UI_TEXT.importUntrusted}</p>
          <ul>
            {preview.providers.map((provider) => (
              <li key={provider.id}>
                <span>{provider.label ?? provider.id}</span>
                <span className="models-origin">{provider.address}</span>
                <span className="models-needs-key">{UI_TEXT.importNeedsKey}</span>
              </li>
            ))}
          </ul>
          <InlineError messages={preview.errors} />
          <div className="models-row-actions">
            <button
              type="button"
              className="models-button-primary"
              disabled={preview.errors.length > 0 || preview.providers.length === 0}
              onClick={() => {
                post({ type: 'providers/import', json, confirmed: true })
              }}
            >
              {UI_TEXT.providerImport}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProvidersSection(props: SectionProps) {
  const { panelState, post, wizardOpen, importOpen, dispatch } = props
  // The pick step is local: before the host's draft arrives (right after
  // `providers/select`, or while the wizard just opened) the panel shows
  // the pick step from this draft, which carries nothing to save.
  const wizard: PanelDraft = panelState.drafts.wizard ?? PICK_DRAFT
  return (
    <section aria-label={UI_TEXT.providersSectionTitle}>
      <h2>{UI_TEXT.providersSectionTitle}</h2>
      {panelState.notice !== undefined && (
        <p className="models-notice" role="status">
          {panelState.notice}
        </p>
      )}
      <UndoBar
        removals={panelState.pendingRemovals}
        onUndo={(providerId) => {
          post({ type: 'providers/undoRemove', providerId })
        }}
      />
      {panelState.providers.length === 0 && !wizardOpen && (
        <div className="models-empty">
          <p>{UI_TEXT.modelsEmpty}</p>
        </div>
      )}
      <ul className="models-providers">
        {panelState.providers.map((provider) => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            panelState={panelState}
            props={props}
          />
        ))}
      </ul>
      {wizardOpen && (
        <Wizard
          panelState={panelState}
          draft={wizard}
          post={post}
          onNavigateModels={() => {
            props.navigate('models')
          }}
          onClose={() => {
            dispatch({ type: 'close-wizard' })
          }}
        />
      )}
      <div className="models-row-actions">
        {!wizardOpen && (
          <button
            type="button"
            className="models-button"
            onClick={() => {
              dispatch({ type: 'open-wizard' })
            }}
          >
            {UI_TEXT.wizardPickProvider}
          </button>
        )}
        <button
          type="button"
          className="models-button"
          onClick={() => {
            dispatch({ type: 'toggle-import' })
          }}
        >
          {UI_TEXT.providerImport}
        </button>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'providers/export' })
          }}
        >
          {UI_TEXT.providerExport}
        </button>
      </div>
      {importOpen && (
        <ImportPane
          panelState={panelState}
          post={post}
          onClose={() => {
            dispatch({ type: 'toggle-import' })
          }}
        />
      )}
    </section>
  )
}
