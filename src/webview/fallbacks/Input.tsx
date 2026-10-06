import { useId, useState } from 'react'
import { UI_TEXT } from '../../shared/l10n/text'
import type { MhpParams, MhpResult } from '../../shared/hostApi/methods'
import { Dialog } from './Dialog'

export function Input({
  params,
  onResult,
}: {
  readonly params: MhpParams<'ui/input'>
  readonly onResult: (result: MhpResult<'ui/input'>) => void
}) {
  const id = useId()
  const [value, setValue] = useState(params.value ?? '')
  return (
    <Dialog
      title={params.title}
      onCancel={() => {
        onResult(null)
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onResult(value)
        }}
      >
        <label htmlFor={id}>{params.prompt}</label>
        <input
          id={id}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
        />
        <div className="fallback-actions">
          <button type="submit">{UI_TEXT.fallbackContinue}</button>
          <button
            type="button"
            onClick={() => {
              onResult(null)
            }}
          >
            {UI_TEXT.goalEditCancel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
