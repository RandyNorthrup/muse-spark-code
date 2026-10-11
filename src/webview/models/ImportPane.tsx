import { useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import type { ModelsPanelState } from '../../shared/modelsPanel'
import type { SectionProps } from './sections'
import { InlineError } from './components/InlineError'

export function ImportPane({
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
