import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { installEmbeddedTable } from '../installTable'
import { SCHEDULE_TIMELINE_HOURS, UI_TEXT } from '../../shared/constants'
import { formatUnit } from '../../shared/l10n/text'
import {
  scheduleRequestSchema,
  scheduleResponseSchema,
  type ScheduleRequest,
} from '../../shared/scheduleV2'
import { ScheduleCard } from './ScheduleCard'
import { ScheduleEditor } from './ScheduleEditor'
import { ScheduleTimeline } from './ScheduleTimeline'
import type {
  EventSources,
  ScheduleSurfacePort,
  GrantAudit,
  ScheduleResponse,
  ScheduleSurfaceProps,
  ScheduleView,
} from './ports'

async function request(
  port: ScheduleSurfacePort,
  input: ScheduleRequest,
): Promise<ScheduleResponse> {
  return scheduleResponseSchema.parse(await port.request(scheduleRequestSchema.parse(input)))
}

async function readSchedules(port: ScheduleSurfacePort, workspaceKey: string) {
  const list = await request(port, { method: 'schedules/list', workspaceKey })
  if (list.kind !== 'list' || list.schedules.some((item) => item.workspaceKey !== workspaceKey))
    throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
  return list.schedules
}

export function ScheduleSurface(context: ScheduleSurfaceProps) {
  const { port, workspaceKey, initialView } = context
  const [schedules, setSchedules] = useState<ScheduleView[]>([])
  const [sources, setSources] = useState<EventSources>([])
  const [audit, setAudit] = useState<Readonly<Record<string, GrantAudit>>>({})
  const [entries, setEntries] = useState<
    Extract<ScheduleResponse, { kind: 'timeline' }>['entries']
  >([])
  const [view, setView] = useState(context.initialView ?? 'list')
  const [editing, setEditing] = useState<ScheduleView>()
  const [hours, setHours] = useState<(typeof SCHEDULE_TIMELINE_HOURS)[number]>(
    SCHEDULE_TIMELINE_HOURS[0],
  )
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()
  const [background, setBackground] =
    useState<Extract<ScheduleResponse, { kind: 'backgroundStatus' }>['status']>()
  useEffect(() => {
    let isCancelled = false
    const load = async () => {
      try {
        const list = await readSchedules(port, workspaceKey)
        const events = await request(port, {
          method: 'schedules/eventSources',
          workspaceKey: workspaceKey,
        })
        if (events.kind !== 'eventSources') throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
        if (initialView === 'timeline') {
          const timeline = await request(port, {
            method: 'schedules/timeline',
            workspaceKey,
            hours: SCHEDULE_TIMELINE_HOURS[0],
          })
          if (timeline.kind !== 'timeline') throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
          if (!isCancelled) setEntries(timeline.entries)
        }
        if (!isCancelled) {
          setSchedules(list)
          setSources(events.sources)
          setLoaded(true)
        }
      } catch {
        if (!isCancelled) {
          setError(UI_TEXT.scheduleV2.editor.loadFailed)
          setLoaded(true)
        }
      }
    }
    void load()
    return () => {
      isCancelled = true
    }
  }, [port, workspaceKey, initialView])

  const reload = async () => {
    setSchedules(await readSchedules(port, workspaceKey))
  }
  const act = async (input: ScheduleRequest) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    try {
      const response = await request(port, input)
      if (response.kind === 'refused') {
        setError(response.reason)
        if (input.method === 'schedules/update') {
          // A stale revision must never be attached to old grant/consent data.
          setEditing(undefined)
          setView('list')
          setAudit({})
          await reload()
        }
      } else if (
        response.kind === 'grantAudit' &&
        input.method === 'schedules/grantAudit' &&
        response.scheduleId === input.id &&
        response.entries.every((entry) => entry.scheduleId === input.id)
      ) {
        setAudit((previous) => ({ ...previous, [response.scheduleId]: response.entries }))
      } else if (response.kind === 'timeline' && input.method === 'schedules/timeline') {
        setEntries(response.entries)
        setView('timeline')
      } else if (
        response.kind === 'backgroundStatus' &&
        input.method === 'schedules/backgroundStatus'
      ) {
        setBackground(response.status)
      } else if (
        response.kind === 'accepted' &&
        input.method !== 'schedules/grantAudit' &&
        input.method !== 'schedules/timeline' &&
        input.method !== 'schedules/backgroundStatus'
      ) {
        setAudit({})
        if (input.method === 'schedules/backgroundRemove') setBackground({ registered: false })
        else if (input.method === 'schedules/background') {
          const status = await request(port, { method: 'schedules/backgroundStatus' })
          if (status.kind !== 'backgroundStatus')
            throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
          setBackground(status.status)
        }
        setEditing(undefined)
        setView('list')
        await reload()
      } else {
        throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
      }
    } catch {
      setError(UI_TEXT.scheduleV2.editor.loadFailed)
    } finally {
      setBusy(false)
    }
  }
  const backgroundLabels = {
    yes: UI_TEXT.scheduleV2.messages.backgroundYes,
    notNow: UI_TEXT.scheduleV2.messages.backgroundNotNow,
    never: UI_TEXT.scheduleV2.messages.backgroundNever,
  }
  const content = {
    editor: (
      <ScheduleEditor
        key={editing?.id ?? 'new'}
        context={context}
        schedule={editing}
        sources={sources}
        busy={busy}
        onSave={(input) => {
          void act(input)
        }}
        onClose={() => {
          setView('list')
        }}
      />
    ),
    timeline: (
      <>
        <label>
          {UI_TEXT.scheduleV2.labels.timeline}
          <select
            value={hours}
            disabled={busy}
            onChange={(event) => {
              const next = SCHEDULE_TIMELINE_HOURS.find(
                (value) => String(value) === event.target.value,
              )
              if (next === undefined) {
                return
              }

              setHours(next)
              void act({
                method: 'schedules/timeline',
                workspaceKey: workspaceKey,
                hours: next,
              })
            }}
          >
            {SCHEDULE_TIMELINE_HOURS.map((value) => (
              <option key={value} value={value}>
                {formatUnit(value, 'hour')}
              </option>
            ))}
          </select>
        </label>
        <ScheduleTimeline entries={entries} schedules={schedules} />
      </>
    ),
    list: (
      <div className="schedule-v2-list">
        {schedules.length === 0 ? (
          <p role="status">{UI_TEXT.scheduleV2.editor.empty}</p>
        ) : (
          schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              audit={audit[schedule.id]}
              busy={busy}
              onEdit={() => {
                setEditing(schedule)
                setView('editor')
              }}
              onAction={(method) => {
                void act({ method, workspaceKey: workspaceKey, id: schedule.id })
              }}
            />
          ))
        )}
      </div>
    ),
  }
  return (
    <section
      className="schedule-v2-surface"
      aria-label={UI_TEXT.scheduleV2.labels.title}
      data-schedule-ready={loaded ? '' : undefined}
    >
      <h1>{UI_TEXT.scheduleV2.labels.title}</h1>
      <nav className="schedule-v2-actions" aria-label={UI_TEXT.scheduleV2.labels.title}>
        <button
          type="button"
          onClick={() => {
            setView('list')
          }}
        >
          {UI_TEXT.scheduleV2.labels.title}
        </button>
        <button
          type="button"
          disabled={!loaded || busy}
          onClick={() => {
            setEditing(undefined)
            setView('editor')
          }}
        >
          {UI_TEXT.scheduleV2.labels.schedulePrompt}
        </button>
        <button
          type="button"
          disabled={!loaded || busy}
          onClick={() => {
            void act({ method: 'schedules/timeline', workspaceKey: workspaceKey, hours })
          }}
        >
          {UI_TEXT.scheduleV2.labels.timeline}
        </button>
        {context.onClose === undefined ? null : (
          <button type="button" onClick={context.onClose}>
            {UI_TEXT.goalEditCancel}
          </button>
        )}
      </nav>
      {error === undefined ? null : <p role="alert">{error}</p>}
      {loaded ? content[view] : <p role="status">{UI_TEXT.loadingOutput}</p>}
      <details>
        <summary>{UI_TEXT.scheduleV2.labels.background}</summary>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void act({ method: 'schedules/backgroundStatus' })
          }}
        >
          {UI_TEXT.scheduleV2.labels.background}
        </button>
        {background?.registered === true ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void act({ method: 'schedules/backgroundRemove' })
            }}
          >
            {UI_TEXT.scheduleV2.messages.backgroundRemove}
          </button>
        ) : null}
        {background?.registered === false ? (
          <>
            <p>{UI_TEXT.scheduleV2.messages.backgroundQuestion}</p>
            <div className="schedule-v2-actions">
              {(['yes', 'notNow', 'never'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void act({
                      method: 'schedules/background',
                      consent: { choice, decidedAtMs: context.nowMs },
                    })
                  }}
                >
                  {backgroundLabels[choice]}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </details>
    </section>
  )
}

/** Standalone panel entry for VS Code, companion and native webview hosts. */
export function mountScheduleSurface(element: Element, context: ScheduleSurfaceProps): () => void {
  const tableError = installEmbeddedTable(element.ownerDocument)
  if (tableError !== undefined) throw tableError
  const root = createRoot(element)
  root.render(<ScheduleSurface key={context.workspaceKey} {...context} />)
  return () => {
    root.unmount()
  }
}
