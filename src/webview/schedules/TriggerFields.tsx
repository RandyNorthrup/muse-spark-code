import { useState } from 'react'
import {
  CRON_MAX_WEEKDAY,
  SCHEDULE_DEFAULT_INTERVAL_MS,
  SCHEDULE_MIN_INTERVAL_MS,
  UI_TEXT,
} from '../../shared/constants'
import { scheduleWeekdayText } from './presentation'
import { scheduleEventTriggerSchema } from '../../shared/scheduleEvents'
import {
  scheduleTimeTriggerSchema,
  scheduleZoneSchema,
  type ScheduleDraft,
  type ScheduleTimeTrigger,
} from '../../shared/scheduleV2'
import type { EventSources } from './ports'

type Trigger = ScheduleDraft['trigger']
type EventTrigger = Extract<Trigger, { kind: 'event' }>

export function timeTrigger(kind: string, nowMs: number, zone: string): ScheduleTimeTrigger {
  const times = [{ hour: 0, minute: 0 }]
  switch (kind) {
    case 'once': {
      return { kind, atMs: nowMs }
    }
    case 'interval': {
      return { kind, everyMs: SCHEDULE_DEFAULT_INTERVAL_MS, anchorMs: nowMs }
    }
    case 'daily': {
      const parts = new Map(
        new Intl.DateTimeFormat('en', {
          timeZone: zone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          calendar: 'iso8601',
          numberingSystem: 'latn',
        })
          .formatToParts(nowMs)
          .map((part) => [part.type, part.value]),
      )
      return scheduleTimeTriggerSchema.parse({
        kind,
        times,
        everyDays: 1,
        anchorDate: (['year', 'month', 'day'] as const).map((part) => parts.get(part)).join('-'),
      })
    }
    case 'weekdays': {
      return { kind, times }
    }
    case 'weekly': {
      return { kind, days: [{ weekday: 1, times }] }
    }
    case 'cron': {
      return { kind, expression: '* * * * *' }
    }
    default: {
      throw new Error(UI_TEXT.scheduleV2.editor.invalid)
    }
  }
}

function Times({
  times,
  onChange,
  label,
}: {
  readonly times: readonly { hour: number; minute: number }[]
  readonly onChange: (times: { hour: number; minute: number }[]) => void
  readonly label: string
}) {
  const [text, setText] = useState(() =>
    times
      .map(
        ({ hour, minute }) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      )
      .join(', '),
  )
  return (
    <label>
      {label}
      <input
        value={text}
        onChange={(event) => {
          const value = event.target.value
          setText(value)
          onChange(
            value.split(',').map((time) => {
              if (!/^\s*\d{2}:\d{2}\s*$/.test(time)) return { hour: NaN, minute: NaN }
              const [hour, minute] = time.trim().split(':').map(Number)
              return { hour: hour ?? NaN, minute: minute ?? NaN }
            }),
          )
        }}
      />
    </label>
  )
}

export function UtcInput({
  value,
  label,
  onChange,
}: {
  readonly value: number | undefined
  readonly label: string
  readonly onChange: (value: number | undefined) => void
}) {
  const [text, setText] = useState(() =>
    value === undefined ? '' : (new Date(value).toISOString().split('.', 1)[0] ?? ''),
  )
  return (
    <label>
      {label}
      <input
        type="datetime-local"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          onChange(event.target.value === '' ? undefined : Date.parse(`${event.target.value}Z`))
        }}
      />
    </label>
  )
}

function TimeFields({
  trigger,
  onChange,
}: {
  readonly trigger: ScheduleTimeTrigger
  readonly onChange: (value: ScheduleTimeTrigger) => void
}) {
  switch (trigger.kind) {
    case 'once': {
      return (
        <UtcInput
          label={UI_TEXT.scheduleV2.editor.dateTimeUtc}
          value={trigger.atMs}
          onChange={(atMs) => {
            onChange({ ...trigger, atMs: atMs ?? NaN })
          }}
        />
      )
    }
    case 'interval': {
      return (
        <label>
          {UI_TEXT.scheduleV2.editor.minutes}
          <input
            type="number"
            min={1}
            value={
              Number.isFinite(trigger.everyMs) ? trigger.everyMs / SCHEDULE_MIN_INTERVAL_MS : ''
            }
            onChange={(event) => {
              onChange({
                ...trigger,
                everyMs: event.target.valueAsNumber * SCHEDULE_MIN_INTERVAL_MS,
              })
            }}
          />
        </label>
      )
    }
    case 'cron': {
      return (
        <label>
          {UI_TEXT.scheduleV2.editor.cronExpression}
          <input
            value={trigger.expression}
            onChange={(event) => {
              onChange({ ...trigger, expression: event.target.value })
            }}
          />
        </label>
      )
    }
    case 'daily': {
      return (
        <>
          <label>
            {UI_TEXT.scheduleV2.editor.everyDays}
            <input
              type="number"
              min={1}
              value={Number.isFinite(trigger.everyDays) ? trigger.everyDays : ''}
              onChange={(event) => {
                onChange({ ...trigger, everyDays: event.target.valueAsNumber })
              }}
            />
          </label>
          <label>
            {UI_TEXT.scheduleV2.editor.anchorDate}
            <input
              type="date"
              value={trigger.anchorDate}
              onChange={(event) => {
                onChange({ ...trigger, anchorDate: event.target.value })
              }}
            />
          </label>
          <Times
            times={trigger.times}
            label={UI_TEXT.scheduleV2.editor.times}
            onChange={(times) => {
              onChange({ ...trigger, times })
            }}
          />
        </>
      )
    }
    case 'weekdays': {
      return (
        <Times
          times={trigger.times}
          label={UI_TEXT.scheduleV2.editor.times}
          onChange={(times) => {
            onChange({ ...trigger, times })
          }}
        />
      )
    }
    case 'weekly': {
      return (
        <div>
          {Array.from({ length: CRON_MAX_WEEKDAY }, (_, weekday) => {
            const day = trigger.days.find((item) => item.weekday === weekday)
            const label = scheduleWeekdayText(weekday)
            return (
              <div key={weekday}>
                <label>
                  <input
                    type="checkbox"
                    checked={day !== undefined}
                    onChange={(event) => {
                      onChange({
                        ...trigger,
                        days: event.target.checked
                          ? [...trigger.days, { weekday, times: [{ hour: 0, minute: 0 }] }]
                          : trigger.days.filter((item) => item.weekday !== weekday),
                      })
                    }}
                  />
                  {label}
                </label>
                {day === undefined ? null : (
                  <Times
                    label={`${label}: ${UI_TEXT.scheduleV2.editor.times}`}
                    times={day.times}
                    onChange={(times) => {
                      onChange({
                        ...trigger,
                        days: trigger.days.map((item) =>
                          item.weekday === weekday ? { ...item, times } : item,
                        ),
                      })
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      )
    }
  }
}

function EventFields({
  trigger,
  sources,
  onChange,
  onValid,
}: {
  readonly trigger: EventTrigger
  readonly sources: EventSources
  readonly onChange: (value: EventTrigger) => void
  readonly onValid: (isValid: boolean, conditions?: string) => void
}) {
  const [conditions, setConditions] = useState(() =>
    trigger.conditions.map((item) => `${item.field}=${String(item.equals)}`).join('\n'),
  )
  const source = sources.find((item) => item.id === trigger.source)
  return (
    <>
      <label>
        {UI_TEXT.scheduleV2.editor.source}
        <select
          value={trigger.source}
          onChange={(event) => {
            const next = sources.find((item) => item.id === event.target.value)
            if (next?.capability.available !== true) return
            onValid(
              true,
              trigger.conditions.map((item) => `${item.field}=${String(item.equals)}`).join('\n'),
            )
            onChange({ ...trigger, source: next.id, event: next.kinds[0] ?? 'manual' })
          }}
        >
          <option value="" disabled>
            {UI_TEXT.scheduleV2.labels.unavailable}
          </option>
          {sources.map((item) => (
            <option key={item.id} value={item.id} disabled={!item.capability.available}>
              {item.id}
              {item.capability.available ? '' : `: ${item.capability.reason}`}
            </option>
          ))}
        </select>
      </label>
      {source?.capability.available === false ? (
        <p role="status">{source.capability.reason}</p>
      ) : null}
      <label>
        {UI_TEXT.scheduleV2.labels.trigger}
        <select
          value={trigger.event}
          onChange={(event) => {
            const parsed = scheduleEventTriggerSchema.safeParse({
              ...trigger,
              event: event.target.value,
            })
            if (parsed.success) onChange(parsed.data)
          }}
        >
          {source?.kinds.map((kind) => (
            <option key={kind} value={kind}>
              {UI_TEXT.scheduleV2.events[kind]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {UI_TEXT.scheduleV2.editor.conditions}
        <textarea
          value={conditions}
          onChange={(event) => {
            const text = event.target.value
            setConditions(text)
            const parsed = scheduleEventTriggerSchema.safeParse({
              ...trigger,
              conditions:
                text === ''
                  ? []
                  : text.split('\n').map((line) => {
                      const separator = line.indexOf('=')
                      return {
                        field: separator < 1 ? '' : line.slice(0, separator),
                        equals: line.slice(separator + 1),
                      }
                    }),
            })
            onValid(parsed.success, text)
            if (parsed.success) onChange(parsed.data)
          }}
        />
      </label>
      <p>{UI_TEXT.scheduleV2.messages.eventUntrusted}</p>
    </>
  )
}

export function TriggerFields({
  trigger,
  nowMs,
  zone,
  sources,
  onChange,
  onValid,
}: {
  readonly trigger: Trigger
  readonly nowMs: number
  readonly zone: string
  readonly sources: EventSources
  readonly onChange: (value: Trigger) => void
  readonly onValid: (isValid: boolean, conditions?: string) => void
}) {
  const changeTime = (kind: string, isComposed = false) => {
    const checkedZone = scheduleZoneSchema.safeParse(zone)
    if (!checkedZone.success) return
    const next = timeTrigger(kind, nowMs, checkedZone.data)
    if (!isComposed) onValid(true)
    onChange(isComposed && trigger.kind === 'afterEvent' ? { ...trigger, time: next } : next)
  }
  let event: EventTrigger | undefined
  let time: ScheduleTimeTrigger | undefined
  if (trigger.kind === 'afterEvent') {
    event = trigger.event
    time = trigger.time
  } else if (trigger.kind === 'event') event = trigger
  else time = trigger
  return (
    <fieldset>
      <legend>{UI_TEXT.scheduleV2.labels.trigger}</legend>
      <label>
        {UI_TEXT.scheduleV2.labels.trigger}
        <select
          value={trigger.kind}
          onChange={(change) => {
            const kind = change.target.value
            const source = sources.find(
              (item) => item.capability.available && item.kinds.length > 0,
            )
            const eventTrigger: EventTrigger = {
              kind: 'event',
              source: source?.id ?? '',
              event: source?.kinds[0] ?? 'manual',
              conditions: [],
            }
            if (kind === 'event') {
              onValid(true)
              onChange(eventTrigger)
            } else if (kind === 'afterEvent') {
              onValid(true)
              onChange({ kind, event: eventTrigger, time: timeTrigger('weekdays', nowMs, zone) })
            } else changeTime(kind)
          }}
        >
          {Object.entries(UI_TEXT.scheduleV2.triggers).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {event === undefined ? null : (
        <EventFields
          key={`${trigger.kind}:${event.source}`}
          trigger={event}
          sources={sources}
          onValid={onValid}
          onChange={(next) => {
            onChange(trigger.kind === 'afterEvent' ? { ...trigger, event: next } : next)
          }}
        />
      )}
      {trigger.kind === 'afterEvent' ? (
        <label>
          {UI_TEXT.scheduleV2.labels.trigger}
          <select
            value={trigger.time.kind}
            onChange={(change) => {
              changeTime(change.target.value, true)
            }}
          >
            {Object.entries(UI_TEXT.scheduleV2.triggers)
              .filter(([kind]) => kind !== 'event' && kind !== 'afterEvent')
              .map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      {time === undefined ? null : (
        <TimeFields
          key={`${trigger.kind}:${time.kind}`}
          trigger={time}
          onChange={(next) => {
            onChange(trigger.kind === 'afterEvent' ? { ...trigger, time: next } : next)
          }}
        />
      )}
    </fieldset>
  )
}
