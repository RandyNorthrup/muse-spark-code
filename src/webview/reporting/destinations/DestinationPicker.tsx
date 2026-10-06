import { useId } from 'react'
import './destinations.css'
import { REPORT_FORMATS, REPORT_SAVE_RETENTION_MAX, UI_TEXT } from '../../../shared/constants'
import type {
  ReportDestination,
  ReportMailConnection,
} from '../../../core/reporting/destinations/types'

export interface DestinationPickerProps {
  readonly destinations: readonly ReportDestination[]
  readonly choices: readonly ReportDestination[]
  readonly format: (typeof REPORT_FORMATS)[number]
  readonly connections: readonly ReportMailConnection[]
  readonly verifiedRecipients: readonly string[]
  readonly connectableProviders: readonly ('gmail' | 'outlook')[]
  readonly onChange: (destinations: readonly ReportDestination[]) => void
  readonly onFormat: (format: (typeof REPORT_FORMATS)[number]) => void
  // Every host provides its native folder dialog/OAuth click/verification UI.
  readonly onPickFolder: (id: string) => void
  readonly onConnect: (provider: 'gmail' | 'outlook') => void
  readonly onVerify: (id: string) => void
}

function destinationLabel(type: ReportDestination['type']): string {
  switch (type) {
    case 'save': {
      return UI_TEXT.reportUi.saveDestination
    }
    case 'browser': {
      return UI_TEXT.reportUi.browserDestination
    }
    case 'email': {
      return UI_TEXT.reportUi.emailDestination
    }
    case 'post': {
      return UI_TEXT.reportUi.post
    }
  }
}

/** Loaded by M115's schedule editor on the first Report action, on every host. */
export function DestinationPicker(props: DestinationPickerProps) {
  const prefix = useId()
  const change = (next: ReportDestination) => {
    props.onChange(props.destinations.map((item) => (item.id === next.id ? next : item)))
  }
  return (
    <fieldset className="ms-report-destinations">
      <legend>{UI_TEXT.reportUi.destinations}</legend>
      {props.choices.map((choice) => (
        <label key={choice.id}>
          <input
            type="checkbox"
            checked={props.destinations.some((item) => item.id === choice.id)}
            onChange={(event) => {
              props.onChange(
                event.currentTarget.checked
                  ? [...props.destinations, choice]
                  : props.destinations.filter((item) => item.id !== choice.id),
              )
            }}
          />
          {destinationLabel(choice.type)}
        </label>
      ))}
      <label htmlFor={`${prefix}-format`}>{UI_TEXT.reportUi.format}</label>
      <select
        id={`${prefix}-format`}
        value={props.format}
        onChange={(event) => {
          const value = event.currentTarget.value
          const format = REPORT_FORMATS.find((item) => item === value)
          if (format !== undefined) props.onFormat(format)
        }}
      >
        {REPORT_FORMATS.map((format) => (
          <option key={format} value={format}>
            {format}
          </option>
        ))}
      </select>
      {props.destinations.map((destination) => (
        <fieldset key={destination.id}>
          <legend>{destinationLabel(destination.type)}</legend>
          {destination.type === 'save' && (
            <>
              <button
                type="button"
                onClick={() => {
                  props.onPickFolder(destination.id)
                }}
              >
                {UI_TEXT.reportUi.saveDestination}
              </button>
              <output>{destination.root}</output>
              <label htmlFor={`${prefix}-${destination.id}-template`}>
                {UI_TEXT.reportUi.nameTemplate}
              </label>
              <input
                id={`${prefix}-${destination.id}-template`}
                value={destination.template}
                onChange={(event) => {
                  change({ ...destination, template: event.currentTarget.value })
                }}
              />
              <label htmlFor={`${prefix}-${destination.id}-retention`}>
                {UI_TEXT.reportUi.retention}
              </label>
              <input
                id={`${prefix}-${destination.id}-retention`}
                type="number"
                min={1}
                max={REPORT_SAVE_RETENTION_MAX}
                value={destination.retention}
                onChange={(event) => {
                  const retention = event.currentTarget.valueAsNumber
                  if (Number.isSafeInteger(retention)) change({ ...destination, retention })
                }}
              />
            </>
          )}
          {destination.type === 'browser' && <p>{UI_TEXT.reportUi.openWhenBack}</p>}
          {destination.type === 'email' && (
            <>
              <label htmlFor={`${prefix}-${destination.id}-address`}>
                {UI_TEXT.reportUi.recipient}
              </label>
              <input
                id={`${prefix}-${destination.id}-address`}
                type="email"
                value={destination.address}
                onChange={(event) => {
                  change({ ...destination, address: event.currentTarget.value })
                }}
              />
              <label htmlFor={`${prefix}-${destination.id}-connection`}>
                {UI_TEXT.reportLabels.provider}
              </label>
              <select
                id={`${prefix}-${destination.id}-connection`}
                value={destination.connection.vaultItemId}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  const connection = props.connections.find((item) => item.vaultItemId === value)
                  if (connection !== undefined) change({ ...destination, connection })
                }}
              >
                {props.connections.map((connection) => (
                  <option key={connection.vaultItemId} value={connection.vaultItemId}>
                    {connection.provider} ({connection.vaultItemId})
                  </option>
                ))}
              </select>
              {!props.verifiedRecipients.includes(
                destination.address.replace(/@[^@]+$/, (domain) => domain.toLowerCase()),
              ) && <p role="status">{UI_TEXT.reportUi.recipientUnverified}</p>}
              <button
                type="button"
                onClick={() => {
                  props.onVerify(destination.id)
                }}
              >
                {UI_TEXT.reportUi.verifyRecipient}
              </button>
            </>
          )}
          {destination.type === 'post' && (
            <output>
              {destination.target.repository} ({destination.target.number})
            </output>
          )}
          <button
            type="button"
            onClick={() => {
              props.onChange(props.destinations.filter((item) => item.id !== destination.id))
            }}
          >
            {UI_TEXT.memoryDeleteAction}
          </button>
        </fieldset>
      ))}
      {props.connectableProviders.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => {
            props.onConnect(provider)
          }}
        >
          {UI_TEXT.reportLabels.provider} ({provider === 'gmail' ? 'Gmail' : 'Outlook'})
        </button>
      ))}
    </fieldset>
  )
}
