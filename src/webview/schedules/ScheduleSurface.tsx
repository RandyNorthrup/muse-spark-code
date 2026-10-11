import { Usd } from '../../shared/usd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { installEmbeddedTable } from '../installTable'
import { SCHEDULE_TIMELINE_HOURS, UI_TEXT } from '../../shared/constants'
import { formatUnit } from '../../shared/l10n/text'
import {
  scheduleRequestSchema,
  scheduleResponseSchema,
  type ScheduleRequest,
} from '../../shared/scheduleV2'
import { scheduleChangedMessageSchema } from '../../shared/scheduleProtocol'
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
  const [audit, setAudit] = useState<Readonly<Record<string, GrantAudit | undefined>>>({})
  const [entries, setEntries] = useState<
    Extract<ScheduleResponse, { kind: 'timeline' }>['entries']
  >([])
  const [view, setView] = useState(context.initialView ?? 'list')
  const [editing, setEditing] = useState<ScheduleView>()
  const [hours, setHours] = useState<(typeof SCHEDULE_TIMELINE_HOURS)[number]>(
    SCHEDULE_TIMELINE_HOURS[0],
  )
  const [pending, setPending] = useState<Readonly<Record<string, number>>>({})
  const [unknown, setUnknown] = useState<Readonly<Record<string, boolean>>>({})
  const unknownIds = useRef(new Set<string>())
  const queues = useRef(new Map<string, Promise<void>>())
  const openAudits = useRef(new Set<string>())
  const auditReads = useRef(new Map<string, number>())
  const listRead = useRef(0)
  const [hasList, setHasList] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string>()
  const [background, setBackground] =
    useState<Extract<ScheduleResponse, { kind: 'backgroundStatus' }>['status']>()
  const schedulesRef = useRef(schedules)
  useEffect(() => {
    schedulesRef.current = schedules
  }, [schedules])
  const markAuthorityUnknown = (id: string, isUnknown: boolean) => {
    if (isUnknown) unknownIds.current.add(id)
    else unknownIds.current.delete(id)
    setUnknown((previous) => ({ ...previous, [id]: isUnknown }))
  }
  const reload = useCallback(async () => {
    const sequence = ++listRead.current
    const list = await readSchedules(port, workspaceKey)
    if (sequence !== listRead.current) return
    setSchedules(list)
    unknownIds.current.clear()
    setUnknown({})
    setHasList(true)
    setLoaded(true)
  }, [port, workspaceKey])
  useEffect(() => {
    let isCancelled = false
    const fail = () => {
      if (isCancelled) return
      setError(UI_TEXT.scheduleV2.editor.loadFailed)
      setLoaded(true)
    }
    const refresh = () => {
      void reload().catch(fail)
    }
    refresh()
    void request(port, { method: 'schedules/eventSources', workspaceKey })
      .then((events) => {
        if (events.kind !== 'eventSources') throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
        if (!isCancelled) setSources(events.sources)
      })
      .catch(fail)
    if (initialView === 'timeline') {
      void request(port, {
        method: 'schedules/timeline',
        workspaceKey,
        hours: SCHEDULE_TIMELINE_HOURS[0],
      })
        .then((timeline) => {
          if (timeline.kind !== 'timeline') throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
          if (!isCancelled) setEntries(timeline.entries)
        })
        .catch(fail)
    }
    const unsubscribe = port.subscribeChanges?.((message) => {
      const change = scheduleChangedMessageSchema.safeParse(message)
      if (!change.success || change.data.workspaceKey !== workspaceKey) return
      // Until a fresh list arrives, authority changed outside this surface.
      for (const item of schedulesRef.current) unknownIds.current.add(item.id)
      setUnknown(Object.fromEntries(schedulesRef.current.map((item) => [item.id, true])))
      refresh()
    })
    const invalidate = () => {
      ++listRead.current
    }
    return () => {
      isCancelled = true
      invalidate()
      unsubscribe?.()
    }
  }, [port, workspaceKey, initialView, reload])

  const act = (input: ScheduleRequest) => {
    const isAudit = input.method === 'schedules/grantAudit'
    const id = !isAudit && 'id' in input ? input.id : undefined
    const readKey = input.method.startsWith('schedules/background') ? 'background' : input.method
    const key = id === undefined ? readKey : `schedule:${id}`
    const perform = async () => {
      setPending((previous) => ({ ...previous, [key]: (previous[key] ?? 0) + 1 }))
      setError(undefined)
      const auditSequence = isAudit ? (auditReads.current.get(input.id) ?? 0) + 1 : 0
      if (isAudit) auditReads.current.set(input.id, auditSequence)
      try {
        const response = await request(port, input)
        if (response.kind === 'refused') {
          setError(response.reason)
          if (input.method === 'schedules/update') {
            // A stale revision must never be attached to old grant/consent data.
            setEditing(undefined)
            setView('list')
            await reload()
          }
        } else if (
          response.kind === 'grantAudit' &&
          input.method === 'schedules/grantAudit' &&
          response.scheduleId === input.id &&
          response.entries.every((entry) => entry.scheduleId === input.id)
        ) {
          if (auditReads.current.get(input.id) === auditSequence)
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
          !isAudit &&
          response.kind === 'accepted' &&
          input.method !== 'schedules/timeline' &&
          input.method !== 'schedules/backgroundStatus'
        ) {
          if (id !== undefined) {
            const hasAuthorityAcknowledgement = [
              'schedules/pause',
              'schedules/resume',
              'schedules/revokeGrant',
            ].includes(input.method)
            markAuthorityUnknown(id, !hasAuthorityAcknowledgement || unknownIds.current.has(id))
            if (hasAuthorityAcknowledgement)
              setSchedules((previous) =>
                previous.map((item) => {
                  if (item.id !== id) return item
                  if (input.method === 'schedules/revokeGrant')
                    return {
                      ...item,
                      grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(0).toAmount() },
                      paidCapUsd: Usd.from(0).toAmount(),
                    }
                  return {
                    ...item,
                    paused: input.method === 'schedules/pause',
                    pauseReason: undefined,
                  }
                }),
              )
            setAudit((previous) => ({ ...previous, [id]: undefined }))
            if (openAudits.current.has(id))
              void act({ method: 'schedules/grantAudit', workspaceKey, id })
          }
          switch (input.method) {
            case 'schedules/backgroundRemove': {
              setBackground({ registered: false })
              break
            }
            case 'schedules/background': {
              const status = await request(port, { method: 'schedules/backgroundStatus' })
              if (status.kind !== 'backgroundStatus')
                throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
              setBackground(status.status)

              break
            }
            case 'schedules/create':
            case 'schedules/update': {
              setEditing(undefined)
              setView('list')

              break
            }
            // No default
          }
          await reload()
        } else throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
      } catch {
        if (id !== undefined) markAuthorityUnknown(id, true)
        setError(UI_TEXT.scheduleV2.editor.loadFailed)
      } finally {
        setPending((previous) => ({ ...previous, [key]: Math.max(0, (previous[key] ?? 1) - 1) }))
      }
    }
    if (id === undefined) return perform()
    // Authority clicks remain available; intent is serialized for this id only.
    const previous = queues.current.get(id) ?? Promise.resolve()
    const next = (async () => {
      await previous
      await perform()
    })()
    queues.current.set(id, next)
    void next.finally(() => {
      if (queues.current.get(id) === next) queues.current.delete(id)
    })
    return next
  }
  const retry = () => {
    void reload().catch(() => {
      setError(UI_TEXT.scheduleV2.editor.loadFailed)
    })
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
        busy={
          (pending[editing === undefined ? 'schedules/create' : `schedule:${editing.id}`] ?? 0) > 0
        }
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
            disabled={(pending['schedules/timeline'] ?? 0) > 0}
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
        <ScheduleTimeline
          entries={entries}
          schedules={schedules}
          targets={context.targets}
          currentConversationId={context.currentConversationId}
        />
      </>
    ),
    list: (
      <div className="schedule-v2-list">
        {hasList && schedules.length === 0 ? (
          <p role="status">{UI_TEXT.scheduleV2.editor.empty}</p>
        ) : (
          schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              audit={audit[schedule.id]}
              busy={(pending[`schedule:${schedule.id}`] ?? 0) > 0}
              unknown={unknown[schedule.id] === true}
              targets={context.targets}
              currentConversationId={context.currentConversationId}
              onRetry={retry}
              onAuditOpen={(isOpen) => {
                if (isOpen) openAudits.current.add(schedule.id)
                else openAudits.current.delete(schedule.id)
              }}
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
            retry()
          }}
        >
          {UI_TEXT.scheduleV2.labels.title}
        </button>
        <button
          type="button"
          disabled={!loaded}
          onClick={() => {
            setEditing(undefined)
            setView('editor')
          }}
        >
          {UI_TEXT.scheduleV2.labels.schedulePrompt}
        </button>
        <button
          type="button"
          disabled={!loaded || (pending['schedules/timeline'] ?? 0) > 0}
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
      {loaded && !hasList ? (
        <button type="button" onClick={retry}>
          {UI_TEXT.scheduleV2.editor.retry}
        </button>
      ) : null}
      {loaded ? content[view] : <p role="status">{UI_TEXT.loadingOutput}</p>}
      <details>
        <summary>{UI_TEXT.scheduleV2.labels.background}</summary>
        <button
          type="button"
          disabled={(pending['background'] ?? 0) > 0}
          onClick={() => {
            void act({ method: 'schedules/backgroundStatus' })
          }}
        >
          {UI_TEXT.scheduleV2.labels.background}
        </button>
        {background?.registered === true ? (
          <button
            type="button"
            disabled={(pending['background'] ?? 0) > 0}
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
            <div className="schedule-v2-consent">
              {(['yes', 'notNow', 'never'] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  disabled={(pending['background'] ?? 0) > 0}
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
