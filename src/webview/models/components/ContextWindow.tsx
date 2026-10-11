import { useId, useState } from 'react'
import { UI_TEXT } from '../../../shared/constants'
import { webviewKey } from '../../../shared/keybindings'

function isWindowCount(tokens: number): boolean {
  return Number.isSafeInteger(tokens) && tokens > 0
}

/** Shared local-model field: draft text stays editable; only validated counts cross the bridge. */
export function ContextWindow({
  model,
  tokens,
  onChange,
}: {
  readonly model: string
  readonly tokens: number | undefined
  readonly onChange: (tokens: number) => void
}) {
  const id = useId()
  const [invalid, setInvalid] = useState(false)
  return (
    <div className="models-field">
      <label htmlFor={id}>
        {UI_TEXT.localContextWindow} ({model})
      </label>
      <input
        id={id}
        type="number"
        min={1}
        step={1}
        defaultValue={tokens}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          setInvalid(!isWindowCount(event.target.valueAsNumber))
        }}
        onBlur={(event) => {
          const tokens = event.target.valueAsNumber
          if (isWindowCount(tokens)) onChange(tokens)
        }}
        onKeyDown={(event) => {
          if (webviewKey('models.select', event) === 'accept') event.currentTarget.blur()
        }}
      />
      <span id={`${id}-hint`} className="models-hint" role={invalid ? 'alert' : undefined}>
        {invalid ? UI_TEXT.localContextWindowInvalid : UI_TEXT.localContextWindowHint}
      </span>
    </div>
  )
}
