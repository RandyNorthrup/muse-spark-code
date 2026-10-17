import { useEffect, useState } from 'react'
import {
  REPORT_FORMATS,
  REPORT_LABEL_KEYS,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber, formatPercent, formatUnit } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { ReportRow, ReportValue } from '../../shared/reportSchema'
import {
  reportingHostMessageSchema,
  type ReportingHostMessage,
  type ReportingWebviewMessage,
} from './protocol'

/** Native hosts and the companion can mount this same view with their own bridge. */
export interface ReportingBridge {
  readonly messages: Pick<Window, 'addEventListener' | 'removeEventListener'>
  readonly post: (message: ReportingWebviewMessage) => void
}

function displayValue(cell: ReportValue): string {
  switch (cell.type) {
    case 'text':
    case 'timestamp': {
      return cell.value
    }
    case 'label': {
      return UI_TEXT.reportLabels[cell.value]
    }
    case 'count':
    case 'number': {
      return formatNumber(cell.value)
    }
    case 'percent': {
      return formatPercent(cell.value)
    }
    case 'usd': {
      return `${cell.value === null ? UI_TEXT.reportLabels.unknown : formatUsd(cell.value, 2)} (${UI_TEXT.reportLabels[cell.certainty]})`
    }
    case 'durationMs': {
      return formatUnit(cell.value / MILLISECONDS_PER_SECOND, 'second')
    }
    case 'boolean': {
      return cell.value ? UI_TEXT.toggleOn : UI_TEXT.toggleOff
    }
    case 'textList': {
      return cell.value.join('\n')
    }
  }
}

function RowValues({ row }: { readonly row: ReportRow }) {
  return (
    <dl className="reporting-row-values">
      {Object.entries(row.cells).map(([key, cell]) => {
        const label = REPORT_LABEL_KEYS.find((candidate) => candidate === key)
        return (
          <div key={key}>
            <dt>{label === undefined ? key : UI_TEXT.reportLabels[label]}</dt>
            <dd>{displayValue(cell)}</dd>
          </div>
        )
      })}
      <div>
        <dt>{UI_TEXT.reportLabels.sources}</dt>
        <dd>{row.sourceIds.join(', ')}</dd>
      </div>
    </dl>
  )
}

function ReportDiff({ diff }: { readonly diff: NonNullable<ReportingHostMessage['diff']> }) {
  return (
    <section aria-labelledby="report-diff-title" className="reporting-diff">
      <h2 id="report-diff-title">{UI_TEXT.reportLabels.diff}</h2>
      <p>
        {diff.from.asOf} → {diff.to.asOf}
      </p>
      {diff.sections.map((section) => (
        <section key={section.id}>
          <h3>{UI_TEXT.reportLabels[section.label]}</h3>
          <dl>
            <dt>{UI_TEXT.reportLabels.unchanged}</dt>
            <dd>{formatNumber(section.unchangedRows)}</dd>
          </dl>
          {(['added', 'removed', 'changed'] as const).map((kind) => (
            <div key={kind}>
              <h4>
                {UI_TEXT.reportLabels[kind]} ({formatNumber(section[kind].length)})
              </h4>
              <ul>
                {section[kind].map((row) => (
                  <li key={row.key}>
                    <code>{row.key}</code>
                    {'before' in row ? (
                      <>
                        <h5>{diff.from.asOf}</h5>
                        <RowValues row={row.before} />
                        <h5>{diff.to.asOf}</h5>
                        <RowValues row={row.after} />
                      </>
                    ) : (
                      <RowValues row={row} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </section>
  )
}

export function ReportApp({ bridge }: { readonly bridge: ReportingBridge }) {
  const [state, setState] = useState<ReportingHostMessage>()
  const [format, setFormat] = useState<(typeof REPORT_FORMATS)[number]>('md')
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>): void => {
      const parsed = reportingHostMessageSchema.safeParse(event.data)
      if (parsed.success) setState(parsed.data)
    }
    bridge.messages.addEventListener('message', receive)
    bridge.post({ type: 'reportingReady' })
    return () => {
      bridge.messages.removeEventListener('message', receive)
    }
  }, [bridge])
  const canExport = state?.header !== null && state?.header !== undefined && !state.busy
  const action = (
    value: Extract<ReportingWebviewMessage, { type: 'reportingAction' }>['action'],
  ) => {
    bridge.post({ type: 'reportingAction', action: value })
  }
  return (
    <main className="reporting-page" aria-busy={state?.busy ?? true}>
      <header>
        <h1>{UI_TEXT.reportUi.title}</h1>
        <div className="reporting-actions" role="group" aria-label={UI_TEXT.reportUi.title}>
          <button
            type="button"
            disabled={state?.busy}
            onClick={() => {
              action('pick')
            }}
          >
            {UI_TEXT.reportUi.show}
          </button>
          <label htmlFor="report-format">{UI_TEXT.reportUi.format}</label>
          <select
            id="report-format"
            value={format}
            disabled={!canExport}
            onChange={(event) => {
              const selected = REPORT_FORMATS.find((candidate) => candidate === event.target.value)
              if (selected !== undefined) setFormat(selected)
            }}
          >
            {REPORT_FORMATS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => {
              bridge.post({ type: 'reportingSave', format })
            }}
          >
            {UI_TEXT.reportUi.saveAs}
          </button>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => {
              action('copy')
            }}
          >
            {UI_TEXT.reportUi.copyMarkdown}
          </button>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => {
              action('attach')
            }}
          >
            {UI_TEXT.reportUi.attach}
          </button>
          <button
            type="button"
            disabled={state?.busy}
            onClick={() => {
              action('history')
            }}
          >
            {UI_TEXT.reportUi.history}
          </button>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => {
              action('diff')
            }}
          >
            {UI_TEXT.reportUi.diffPrevious}
          </button>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => {
              action('refresh')
            }}
          >
            {UI_TEXT.reportUi.refresh}
          </button>
        </div>
      </header>
      <p role={state?.isError === true ? 'alert' : 'status'}>
        {state === undefined || state.busy ? UI_TEXT.loadingOutput : state.status}
      </p>
      {state?.history == null ? null : (
        <section aria-labelledby="report-history-title">
          <h2 id="report-history-title">{UI_TEXT.reportUi.history}</h2>
          {state.history.length === 0 ? (
            <p>{UI_TEXT.reportUi.noHistory}</p>
          ) : (
            <ul className="reporting-history">
              {state.history.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={state.busy}
                    onClick={() => {
                      bridge.post({ type: 'reportingOpen', id: entry.id })
                    }}
                  >
                    {UI_TEXT.reportKinds[entry.header.kind]} · {entry.header.scope} ·{' '}
                    {entry.header.asOf}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {state?.diff == null ? null : <ReportDiff diff={state.diff} />}
      {state?.header == null ? null : (
        <>
          <p>{fill(UI_TEXT.reportUi.generatedAsOf, { asOf: state.header.asOf })}</p>
          {/* R's static HTML runs in a sandbox with no scripts, network, forms or navigation permissions. */}
          <iframe
            className="reporting-document"
            title={UI_TEXT.reportKinds[state.header.kind]}
            sandbox=""
            srcDoc={state.html}
          />
        </>
      )}
    </main>
  )
}
