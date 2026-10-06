// The Models table's chips and range inputs (M95 acceptance 17): tool
// calling, vision, reasoning, a context range, input, output and cached
// price ranges, free or local, provider and family. Every facet alone or
// combined; the host applies them (lane P's `filterModels`).

import { UI_TEXT } from '../../../shared/constants'
import type { ModelFilter } from '../../../shared/modelsPanel'

export interface FilterBarProps {
  readonly filter: ModelFilter
  readonly searchPlaceholder: string
  readonly providers: readonly string[]
  readonly families: readonly string[]
  readonly onChange: (filter: ModelFilter) => void
  readonly onClear: () => void
}

function TriChip({
  label,
  pressed,
  onToggle,
}: {
  readonly label: string
  readonly pressed: boolean
  readonly onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={pressed ? 'models-chip models-chip-pressed' : 'models-chip'}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {label}
    </button>
  )
}

function NumberInput({
  id,
  label,
  value,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly value: number | undefined
  readonly onChange: (value: number | undefined) => void
}) {
  return (
    <label className="models-range" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.valueAsNumber
          onChange(Number.isNaN(next) ? undefined : next)
        }}
      />
    </label>
  )
}

export function FilterBar({
  filter,
  searchPlaceholder,
  providers,
  families,
  onChange,
  onClear,
}: FilterBarProps) {
  const labels = UI_TEXT.modelFilterLabels
  const toggle = (facet: 'toolCalling' | 'vision' | 'reasoning' | 'freeOrLocal'): void => {
    if (filter[facet] === true) {
      onChange({ ...filter, [facet]: undefined })
    } else {
      onChange({ ...filter, [facet]: true })
    }
  }
  return (
    <div className="models-filter-bar">
      <label className="models-search" htmlFor="models-filter-search">
        <span className="models-visually-hidden">{searchPlaceholder}</span>
        <input
          id="models-filter-search"
          type="search"
          placeholder={searchPlaceholder}
          value={filter.search ?? ''}
          onChange={(event) => {
            onChange({ ...filter, search: event.target.value || undefined })
          }}
        />
      </label>
      <div className="models-chips" role="group" aria-label={searchPlaceholder}>
        <TriChip
          label={labels.toolCalling}
          pressed={filter.toolCalling === true}
          onToggle={() => {
            toggle('toolCalling')
          }}
        />
        <TriChip
          label={labels.vision}
          pressed={filter.vision === true}
          onToggle={() => {
            toggle('vision')
          }}
        />
        <TriChip
          label={labels.reasoning}
          pressed={filter.reasoning === true}
          onToggle={() => {
            toggle('reasoning')
          }}
        />
        <TriChip
          label={labels.freeOrLocal}
          pressed={filter.freeOrLocal === true}
          onToggle={() => {
            toggle('freeOrLocal')
          }}
        />
      </div>
      <div className="models-ranges">
        <NumberInput
          id="models-filter-context-min"
          label={labels.contextMin}
          value={filter.contextMin}
          onChange={(contextMin) => {
            onChange({ ...filter, contextMin })
          }}
        />
        <NumberInput
          id="models-filter-context-max"
          label={labels.contextMax}
          value={filter.contextMax}
          onChange={(contextMax) => {
            onChange({ ...filter, contextMax })
          }}
        />
        <NumberInput
          id="models-filter-max-input"
          label={labels.maxInput}
          value={filter.maxInputPerMillion}
          onChange={(maxInputPerMillion) => {
            onChange({ ...filter, maxInputPerMillion })
          }}
        />
        <NumberInput
          id="models-filter-max-output"
          label={labels.maxOutput}
          value={filter.maxOutputPerMillion}
          onChange={(maxOutputPerMillion) => {
            onChange({ ...filter, maxOutputPerMillion })
          }}
        />
        <NumberInput
          id="models-filter-max-cached"
          label={labels.maxCached}
          value={filter.maxCachedPerMillion}
          onChange={(maxCachedPerMillion) => {
            onChange({ ...filter, maxCachedPerMillion })
          }}
        />
      </div>
      <div className="models-facets">
        <label className="models-facet" htmlFor="models-filter-provider">
          <span>{labels.provider}</span>
          <select
            id="models-filter-provider"
            value={filter.providerId ?? ''}
            onChange={(event) => {
              const providerId = event.target.value
              onChange({ ...filter, providerId: providerId === '' ? undefined : providerId })
            }}
          >
            <option value="">{labels.any}</option>
            {providers.map((providerId) => (
              <option key={providerId} value={providerId}>
                {providerId}
              </option>
            ))}
          </select>
        </label>
        <label className="models-facet" htmlFor="models-filter-family">
          <span>{labels.family}</span>
          <select
            id="models-filter-family"
            value={filter.family ?? ''}
            onChange={(event) => {
              const family = event.target.value
              onChange({ ...filter, family: family === '' ? undefined : family })
            }}
          >
            <option value="">{labels.any}</option>
            {families.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="models-button" onClick={onClear}>
          {labels.clear}
        </button>
      </div>
    </div>
  )
}
