import { webviewKey } from '../../shared/keybindings'
// A server's primitive MCP form. Draft values live here until settlement
// unmounts the card; nothing is written to webview persistence or history.
import { useId, useState } from 'react'
import type { ElicitationField } from '../../shared/agentEvents'
import { validateElicitationValues } from '../../core/backends/modelapi/mcp/elicitation'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { PendingElicitation } from '../state/uiState'

export interface ElicitationCardProps {
  readonly form: PendingElicitation
  readonly onAccept: (elicitationId: string, values: Record<string, unknown>) => void
  readonly onDecline: (elicitationId: string) => void
  readonly onCancel: (elicitationId: string) => void
}

type Draft = Readonly<Record<string, string>>

function draftOf(field: ElicitationField): string {
  if (field.default === undefined) return field.type === 'boolean' ? 'false' : ''
  if (field.enum !== undefined) {
    const index = typeof field.default === 'string' ? field.enum.indexOf(field.default) : -1
    return index === -1 ? '' : String(index)
  }
  return String(field.default)
}

function fieldValue(field: ElicitationField, text: string): unknown {
  if (field.enum !== undefined) return text === '' ? undefined : field.enum[Number(text)]
  if (field.type === 'boolean') return text === 'true'
  if (field.type === 'string') return text
  return text.trim() === '' ? undefined : Number(text)
}

function valuesOf(fields: readonly ElicitationField[], draft: Draft): Record<string, unknown> {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const text = draft[field.name] ?? ''
      return text === '' && !field.required ? [] : [[field.name, fieldValue(field, text)]]
    }),
  )
}

export function ElicitationCard({ form, onAccept, onDecline, onCancel }: ElicitationCardProps) {
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(form.fields.map((field) => [field.name, draftOf(field)])),
  )
  const formId = useId()
  const isLocked = form.isSubmitted === true
  const values = valuesOf(form.fields, draft)
  const checked = validateElicitationValues(form.fields, values)
  const setText = (name: string, text: string) => {
    setDraft((previous) => ({ ...previous, [name]: text }))
  }
  const renderField = (field: ElicitationField, index: number) => {
    const inputId = `${formId}-${String(index)}`
    const text = draft[field.name] ?? ''
    const label = field.title ?? field.name
    const result = validateElicitationValues(
      [field],
      Object.fromEntries(Object.entries(values).filter(([name]) => name === field.name)),
    )
    const error = result.ok
      ? undefined
      : fill(UI_TEXT.elicitationInvalid, { field: label, server: form.server })
    const descriptionId = field.description === undefined ? undefined : `${inputId}-description`
    const errorId = error === undefined ? undefined : `${inputId}-error`
    const describedBy =
      [descriptionId, errorId].filter((id) => id !== undefined).join(' ') || undefined
    return (
      <fieldset key={field.name} className="question-block elicitation-field" disabled={isLocked}>
        <legend className="question-header" dir="auto">
          {label}
          {field.required ? ` (${UI_TEXT.elicitationRequired})` : ''}
        </legend>
        {field.description === undefined ? null : (
          <div id={descriptionId} className="question-text" dir="auto">
            {field.description}
          </div>
        )}
        {field.enum === undefined ? (
          <input
            id={inputId}
            className={field.type === 'boolean' ? undefined : 'question-input elicitation-input'}
            type={field.type === 'boolean' ? 'checkbox' : 'text'}
            dir="auto"
            inputMode={field.type === 'number' || field.type === 'integer' ? 'decimal' : undefined}
            aria-label={label}
            aria-required={field.required}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy}
            autoComplete="off"
            checked={field.type === 'boolean' ? text === 'true' : undefined}
            value={field.type === 'boolean' ? undefined : text}
            onChange={(event) => {
              setText(
                field.name,
                field.type === 'boolean' ? String(event.target.checked) : event.target.value,
              )
            }}
          />
        ) : (
          <div
            className="question-options"
            role="radiogroup"
            aria-label={label}
            aria-required={field.required}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy}
          >
            {field.enum.map((option, index) => (
              <label key={option} className="question-choice">
                <input
                  type="radio"
                  name={inputId}
                  checked={text === String(index)}
                  onChange={() => {
                    setText(field.name, String(index))
                  }}
                />
                <span className="question-choice-label" dir="auto">
                  {field.enumNames?.[index] ?? option}
                </span>
              </label>
            ))}
          </div>
        )}
        {error === undefined ? null : (
          <div id={errorId} className="elicitation-error" role="alert" dir="auto">
            {error}
          </div>
        )}
      </fieldset>
    )
  }
  const submit = () => {
    if (!isLocked && checked.ok) onAccept(form.elicitationId, { ...checked.content })
  }
  return (
    <form
      className="question"
      tabIndex={-1}
      aria-label={fill(UI_TEXT.elicitationTitle, { server: form.server })}
      aria-busy={isLocked}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      onKeyDown={(event) => {
        if (isLocked || webviewKey('elicitation', event) !== 'close') {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onCancel(form.elicitationId)
      }}
    >
      <div className="question-header" dir="auto">
        {fill(UI_TEXT.elicitationTitle, { server: form.server })}
      </div>
      <div className="question-text" dir="auto">
        {form.message}
      </div>
      <div className="elicitation-note" dir="auto">
        {fill(UI_TEXT.elicitationNote, { server: form.server })}
      </div>
      {form.fields.map((field, index) => renderField(field, index))}
      <div className="question-actions">
        <button type="submit" className="button-primary" disabled={isLocked || !checked.ok}>
          {UI_TEXT.elicitationSend}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={isLocked}
          onClick={() => {
            onDecline(form.elicitationId)
          }}
        >
          {UI_TEXT.elicitationDecline}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={isLocked}
          onClick={() => {
            onCancel(form.elicitationId)
          }}
        >
          {UI_TEXT.elicitationCancel}
        </button>
      </div>
    </form>
  )
}
