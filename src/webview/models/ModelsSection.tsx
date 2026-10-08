// The Models section (M95 step 8.5 and acceptance 17): a fresh scan's
// rows in a searchable, sortable table with every facet, the four badges
// by their rules, pinned favourites and ticked picker models. The host
// filters, sorts and badges (lane P's pure functions); this posts the
// facet messages and renders the rows it gets back.

import { OLLAMA_NUM_CTX_OPTIONS, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { ModelPriceNote, ModelRow, ModelSort } from '../../shared/modelsPanel'
import { Badge, type BadgeKind } from './components/Badge'
import { DataTable, type DataColumn } from './components/DataTable'
import { FilterBar } from './components/FilterBar'
import { ScanStatus } from './components/ScanStatus'
import type { SectionProps } from './sections'

function PriceNote({ priceNote }: { readonly priceNote: ModelPriceNote }) {
  switch (priceNote) {
    case 'unpriced': {
      return <span>{UI_TEXT.modelUnpriced}</span>
    }
    case 'local': {
      return <span>{UI_TEXT.modelLocal}</span>
    }
    case 'plan': {
      return <span>{UI_TEXT.modelPlan}</span>
    }
    case 'free': {
      return <span>{UI_TEXT.modelFree}</span>
    }
    case 'priced': {
      return null
    }
  }
}

function sortKeyFor(key: string): ModelSort['key'] {
  switch (key) {
    case 'context':
    case 'input-price':
    case 'output-price': {
      return key
    }
    default: {
      return 'name'
    }
  }
}

function contextCell(row: ModelRow): string {
  return row.contextTokens === undefined ? '—' : formatNumber(row.contextTokens)
}

function inputPriceCell(row: ModelRow) {
  return row.priceNote === 'priced' ? (
    row.inputPerMillion === undefined ? (
      '—'
    ) : (
      formatUsd(row.inputPerMillion, 2)
    )
  ) : (
    <PriceNote priceNote={row.priceNote} />
  )
}

function outputPriceCell(row: ModelRow): string {
  if (row.priceNote !== 'priced') {
    return ''
  }
  return row.outputPerMillion === undefined ? '—' : formatUsd(row.outputPerMillion, 2)
}

function RowBadges({ row }: { readonly row: ModelRow }) {
  const kinds: BadgeKind[] = []
  if (row.badges.recommended) {
    kinds.push('recommended')
  }
  if (row.badges.cheapestCapable) {
    kinds.push('cheapestCapable')
  }
  if (row.badges.largestContext) {
    kinds.push('largestContext')
  }
  if (row.badges.isNew) {
    kinds.push('isNew')
  }
  if (kinds.length === 0) {
    return null
  }
  return (
    <span className="models-badges">
      {kinds.map((kind) => (
        <Badge key={kind} kind={kind} />
      ))}
    </span>
  )
}

export function ModelsSection({ panelState, post, highlightedItem }: SectionProps) {
  const columns: readonly DataColumn[] = [
    { key: 'name', label: UI_TEXT.modelColumns.name, sortable: true },
    { key: 'context', label: UI_TEXT.modelColumns.context, sortable: true },
    { key: 'input-price', label: UI_TEXT.modelColumns.inputPrice, sortable: true },
    { key: 'output-price', label: UI_TEXT.modelColumns.outputPrice, sortable: true },
    { key: 'offered', label: UI_TEXT.modelsColumnOffered, sortable: false },
    { key: 'pinned', label: UI_TEXT.modelsColumnPinned, sortable: false },
  ]
  const onSort = (key: string): void => {
    const sortKey = sortKeyFor(key)
    const sort: ModelSort =
      panelState.sort.key === sortKey
        ? { key: sortKey, direction: panelState.sort.direction === 'asc' ? 'desc' : 'asc' }
        : { key: sortKey, direction: 'asc' }
    post({ type: 'models/filter', filter: panelState.filter, sort })
  }
  const scanning = Object.values(panelState.scans).filter((scan) => scan.status === 'scanning')
  return (
    <section aria-label={UI_TEXT.modelsSectionTitle}>
      <h2>{UI_TEXT.modelsSectionTitle}</h2>
      <p className="models-count" role="status">
        {plural(UI_TEXT.modelsShownCount, panelState.totalModels, {
          shown: panelState.models.length,
        })}
      </p>
      <FilterBar
        filter={panelState.filter}
        searchPlaceholder={UI_TEXT.modelsSearchPlaceholder}
        providers={panelState.facets.providers}
        families={panelState.facets.families}
        onChange={(filter) => {
          post({ type: 'models/filter', filter, sort: panelState.sort })
        }}
        onClear={() => {
          post({
            type: 'models/filter',
            filter: {},
            sort: { key: 'name', direction: 'asc' },
          })
        }}
      />
      <DataTable
        caption={UI_TEXT.modelsSectionTitle}
        columns={columns}
        rows={panelState.models.map((row) => ({
          id: row.ref,
          label: row.ref,
          cells: [
            <span
              key="name"
              className={highlightedItem === row.ref ? 'models-row-highlight' : undefined}
            >
              {row.label ?? row.modelId}
              <RowBadges row={row} />
            </span>,
            <span key="context">{contextCell(row)}</span>,
            <span key="input">{inputPriceCell(row)}</span>,
            <span key="output">{outputPriceCell(row)}</span>,
            <input
              key="offered"
              type="checkbox"
              aria-label={fill(UI_TEXT.tickModel, { model: row.ref })}
              checked={row.ticked}
              onChange={(event) => {
                post({
                  type: 'models/tick',
                  scope: { scope: 'provider', providerId: row.providerId },
                  ref: row.ref,
                  ticked: event.target.checked,
                })
              }}
            />,
            <input
              key="pinned"
              type="checkbox"
              aria-label={fill(UI_TEXT.pinModel, { model: row.ref })}
              checked={row.pinned}
              onChange={(event) => {
                post({
                  type: 'models/pin',
                  providerId: row.providerId,
                  ref: row.ref,
                  pinned: event.target.checked,
                })
              }}
            />,
          ],
        }))}
        sortKey={panelState.sort.key}
        sortDirection={panelState.sort.direction}
        emptyText={UI_TEXT.panelNoMatches}
        onSort={onSort}
        onRowActivate={(id) => {
          const row = panelState.models.find((candidate) => candidate.ref === id)
          if (row !== undefined) {
            post({
              type: 'models/tick',
              scope: { scope: 'provider', providerId: row.providerId },
              ref: row.ref,
              ticked: !row.ticked,
            })
          }
        }}
      />
      {panelState.models.some((row) => row.numCtx !== undefined) && (
        <div className="models-numctx">
          {panelState.models
            .filter((row) => row.numCtx !== undefined)
            .map((row) => (
              <label key={row.ref} className="models-facet" htmlFor={`models-numctx-${row.ref}`}>
                <span>
                  {UI_TEXT.numCtxLabel} · {row.ref}
                </span>
                <select
                  id={`models-numctx-${row.ref}`}
                  value={row.numCtx}
                  onChange={(event) => {
                    post({
                      type: 'models/numCtx',
                      providerId: row.providerId,
                      ref: row.ref,
                      numCtx: Number(event.target.value),
                    })
                  }}
                >
                  {OLLAMA_NUM_CTX_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatNumber(option)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
      )}
      <p className="models-hint">{UI_TEXT.pricePerMillion}</p>
      {scanning.map((scan) => (
        <ScanStatus
          key={scan.providerId}
          scan={scan}
          onRefresh={() => {
            post({ type: 'models/scan', providerId: scan.providerId })
          }}
          onCancel={() => {
            post({ type: 'models/cancelScan', providerId: scan.providerId })
          }}
        />
      ))}
    </section>
  )
}
