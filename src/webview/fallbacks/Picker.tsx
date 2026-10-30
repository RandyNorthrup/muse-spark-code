import { useId, useState } from 'react'
import { UI_TEXT } from '../../shared/l10n/text'
import type { MhpParams, MhpResult } from '../../shared/hostApi/methods'
import { Dialog } from './Dialog'

export function Picker({
  params,
  onResult,
}: {
  readonly params: MhpParams<'ui/pick'>
  readonly onResult: (result: MhpResult<'ui/pick'>) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string | number>>(new Set())
  const items = params.items.filter((item) =>
    item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  return (
    <Dialog
      title={params.title}
      onCancel={() => {
        onResult(null)
      }}
    >
      <label htmlFor={id}>{UI_TEXT.paletteFilterPlaceholder}</label>
      <input
        id={id}
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
      />
      <fieldset className="fallback-options">
        <legend>{params.title}</legend>
        {items.map((item) => (
          <label key={JSON.stringify(item.id)}>
            <input
              type={params.multiple ? 'checkbox' : 'radio'}
              name={id}
              checked={selected.has(item.id)}
              onChange={() => {
                setSelected((previous) => {
                  const next = params.multiple ? new Set(previous) : new Set<string | number>()
                  if (next.has(item.id)) next.delete(item.id)
                  else next.add(item.id)
                  return next
                })
              }}
            />
            {item.title}
          </label>
        ))}
        {items.length === 0 && <p role="status">{UI_TEXT.fallbackNoMatches}</p>}
      </fieldset>
      <div className="fallback-actions">
        <button
          type="button"
          disabled={selected.size === 0}
          onClick={() => {
            onResult([...selected])
          }}
        >
          {UI_TEXT.fallbackContinue}
        </button>
        <button
          type="button"
          onClick={() => {
            onResult(null)
          }}
        >
          {UI_TEXT.goalEditCancel}
        </button>
      </div>
    </Dialog>
  )
}
