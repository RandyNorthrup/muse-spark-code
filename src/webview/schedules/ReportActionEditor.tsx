import { useId, type ComponentType } from 'react'
import './reportAction.css'
import { SCHEDULE_REPORT_FORMATS, UI_TEXT } from '../../shared/constants'
import type {
  ScheduleDraft,
  ScheduleReportAction,
  ScheduleReportDestination,
} from '../../shared/scheduleV2'

export interface ScheduleReportKindChoice {
  readonly id: string
  readonly label: string
  readonly capability:
    { readonly available: true } | { readonly available: false; readonly reason: string }
  readonly arguments: readonly {
    readonly key: string
    readonly label: string
    readonly type: 'string' | 'number' | 'boolean'
  }[]
}
export interface ScheduleDestinationPickerProps {
  readonly value: readonly ScheduleReportDestination[]
  readonly onChange: (destinations: ScheduleReportDestination[]) => void
}

/** V supplies the registry choices and Q's shared destination picker, adapted
 * to opaque configured ids. The same field runs in every host's shared panel. */
export interface ReportActionEditorProps {
  readonly value: ScheduleDraft
  readonly initialReport?: ScheduleReportAction
  readonly initialPrompt: string
  readonly kinds: readonly ScheduleReportKindChoice[]
  readonly DestinationPicker: ComponentType<ScheduleDestinationPickerProps>
  readonly onChange: (draft: ScheduleDraft) => void
}

export function ReportActionEditor({
  value,
  initialReport,
  initialPrompt,
  kinds,
  DestinationPicker,
  onChange,
}: ReportActionEditorProps) {
  const id = useId()
  const action = value.action
  const initialAction = initialReport
  const canSelectReport =
    initialAction !== undefined &&
    kinds.some((item) => item.id === initialAction.reportKind && item.capability.available)
  const selected =
    action.kind === 'report' ? kinds.find((item) => item.id === action.reportKind) : undefined
  const changeReport = (next: ScheduleReportAction) => {
    onChange({
      ...value,
      action: next,
      paidCapUsd: 0,
      // Q/U must renew complete-destination consent after an action edit.
      grant: { ...value.grant, destinationIds: [], paidCapUsd: 0 },
    })
  }
  return (
    <div className="schedule-report-action">
      <label htmlFor={`${id}-action`}>{UI_TEXT.scheduleV2.labels.action}</label>
      <select
        id={`${id}-action`}
        value={action.kind}
        onChange={(event) => {
          if (canSelectReport && event.target.value === 'report') changeReport(initialAction)
          else if (event.target.value === 'prompt')
            onChange({
              ...value,
              action: { kind: 'prompt', prompt: initialPrompt },
              grant: { ...value.grant, destinationIds: [] },
            })
        }}
      >
        <option value="prompt">{UI_TEXT.scheduleV2.labels.prompt}</option>
        <option value="report" disabled={!canSelectReport && action.kind !== 'report'}>
          {UI_TEXT.scheduleV2.labels.report}
        </option>
      </select>
      {action.kind === 'prompt' ? (
        <>
          <label htmlFor={`${id}-prompt`}>{UI_TEXT.scheduleV2.labels.prompt}</label>
          <textarea
            id={`${id}-prompt`}
            value={action.prompt}
            onChange={(event) => {
              onChange({ ...value, action: { kind: 'prompt', prompt: event.target.value } })
            }}
          />
          {!canSelectReport && <p role="status">{UI_TEXT.scheduleV2.reportAction.unavailable}</p>}
        </>
      ) : (
        <>
          <label htmlFor={`${id}-kind`}>{UI_TEXT.scheduleV2.reportAction.kind}</label>
          <select
            id={`${id}-kind`}
            value={action.reportKind}
            onChange={(event) => {
              const choice = kinds.find(
                (item) => item.id === event.target.value && item.capability.available,
              )
              if (choice !== undefined) changeReport({ ...action, reportKind: choice.id, args: {} })
            }}
          >
            {selected === undefined && (
              <option value={action.reportKind} disabled>
                {action.reportKind}
              </option>
            )}
            {kinds.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.capability.available}>
                {item.label}
                {item.capability.available ? '' : `: ${item.capability.reason}`}
              </option>
            ))}
          </select>
          {!selected?.capability.available && (
            <p role="status">
              {selected?.capability.available === false
                ? selected.capability.reason
                : UI_TEXT.scheduleV2.reportAction.unavailable}
            </p>
          )}
          <label htmlFor={`${id}-format`}>{UI_TEXT.scheduleV2.reportAction.format}</label>
          <select
            id={`${id}-format`}
            value={action.format}
            onChange={(event) => {
              const format = SCHEDULE_REPORT_FORMATS.find((item) => item === event.target.value)
              if (format !== undefined) changeReport({ ...action, format })
            }}
          >
            <option value="markdown">{UI_TEXT.scheduleV2.reportAction.formats.markdown}</option>
            <option value="html">{UI_TEXT.scheduleV2.reportAction.formats.html}</option>
            <option value="json">{UI_TEXT.scheduleV2.reportAction.formats.json}</option>
            <option value="text">{UI_TEXT.scheduleV2.reportAction.formats.text}</option>
          </select>
          <fieldset>
            <legend>{UI_TEXT.scheduleV2.reportAction.args}</legend>
            {selected?.arguments.map((arg) => (
              <div key={arg.key}>
                <label htmlFor={`${id}-arg-${arg.key}`}>{arg.label}</label>
                {arg.type === 'boolean' ? (
                  <input
                    id={`${id}-arg-${arg.key}`}
                    type="checkbox"
                    checked={action.args[arg.key] === true}
                    onChange={(event) => {
                      changeReport({
                        ...action,
                        args: { ...action.args, [arg.key]: event.target.checked },
                      })
                    }}
                  />
                ) : (
                  <input
                    id={`${id}-arg-${arg.key}`}
                    type={arg.type === 'number' ? 'number' : 'text'}
                    value={String(action.args[arg.key] ?? '')}
                    onChange={(event) => {
                      const entered = event.target.value
                      const next = arg.type === 'number' ? Number(entered) : entered
                      if (typeof next !== 'number' || Number.isFinite(next))
                        changeReport({ ...action, args: { ...action.args, [arg.key]: next } })
                    }}
                  />
                )}
              </div>
            ))}
          </fieldset>
          <fieldset>
            <legend>{UI_TEXT.scheduleV2.reportAction.destinations}</legend>
            <DestinationPicker
              value={action.destinations}
              onChange={(destinations) => {
                changeReport({ ...action, destinations })
              }}
            />
          </fieldset>
        </>
      )}
    </div>
  )
}
