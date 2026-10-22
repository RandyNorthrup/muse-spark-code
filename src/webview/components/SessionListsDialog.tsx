// The session-lists dialog (M127): the current session's live
// background tasks, hooks and plugins, each section as the host served
// it. A section the backend keeps none of says so; the Refresh button
// re-reads all three. Read-only: rows have no actions.

import { useRef } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { relativeTime } from '../../shared/sessions'
import type { BackgroundTaskRow, SessionHookRow, SessionPluginRow } from '../../shared/sessionLists'
import type { SessionListsView } from '../state/uiState'
import { ListsIcon } from './icons'
import { usePaletteDismiss } from './paletteDialog'

export interface SessionListsDialogProps {
  /** undefined while the host has not answered `requestSessionLists`. */
  readonly lists: SessionListsView | undefined
  readonly now: () => number
  readonly onRefresh: () => void
  readonly onClose: () => void
}

function taskMeta(row: BackgroundTaskRow, nowMs: number): string {
  return [
    row.status,
    row.tool,
    row.backgroundInitiator,
    row.startedAt === undefined ? undefined : relativeTime(row.startedAt, nowMs),
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
}

function hookMeta(row: SessionHookRow): string {
  return [row.event, row.handlerKind, row.enabled ? undefined : UI_TEXT.sessionListsDisabled]
    .filter((part) => part !== undefined)
    .join(' · ')
}

function pluginMeta(row: SessionPluginRow): string {
  return [row.version, row.source, row.enabled ? undefined : UI_TEXT.sessionListsDisabled]
    .filter((part) => part !== undefined)
    .join(' · ')
}

function Section(props: {
  readonly id: string
  readonly title: string
  readonly rows:
    readonly { readonly key: string; readonly label: string; readonly meta: string }[] | undefined
}) {
  let body
  if (props.rows === undefined) {
    body = <p className="menu-empty">{UI_TEXT.sessionListsUnavailable}</p>
  } else if (props.rows.length === 0) {
    body = <p className="menu-empty">{UI_TEXT.sessionListsEmpty}</p>
  } else {
    // A plain list, not a listbox: the rows are read-only, with nothing
    // to select or activate.
    body = (
      <ul id={props.id} aria-label={props.title} className="palette-list">
        {props.rows.map((row) => (
          <li key={row.key} className="palette-item">
            <span className="palette-item-text">
              <span className="palette-item-label">{row.label}</span>
              <span className="palette-item-detail">{row.meta}</span>
            </span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <section aria-label={props.title}>
      <h2 className="palette-group-title">{props.title}</h2>
      {body}
    </section>
  )
}

export function SessionListsDialog(props: SessionListsDialogProps) {
  const { lists, onRefresh, onClose } = props
  const search = useRef<HTMLInputElement>(null)
  const nowMs = props.now()
  const { onDialogBlur, onDialogKeyDown } = usePaletteDismiss(search, onClose)

  return (
    <div
      className="palette history"
      role="dialog"
      aria-label={UI_TEXT.sessionListsTitle}
      onBlur={onDialogBlur}
      onKeyDown={onDialogKeyDown}
    >
      <div className="palette-header">
        <ListsIcon />
        <span className="sessionlists-title">{UI_TEXT.sessionListsTitle}</span>
        <button
          type="button"
          className="button-secondary"
          onClick={onRefresh}
          onMouseDown={(event) => {
            event.preventDefault()
          }}
        >
          {UI_TEXT.sessionListsRefresh}
        </button>
      </div>
      {lists === undefined ? (
        <p className="menu-empty">{UI_TEXT.loadingOutput}</p>
      ) : (
        <>
          <Section
            id="session-lists-tasks"
            title={UI_TEXT.sessionListsTasks}
            rows={lists.tasks?.map((row) => ({
              key: row.taskId,
              label: row.tool ?? row.kind,
              meta: taskMeta(row, nowMs),
            }))}
          />
          <Section
            id="session-lists-hooks"
            title={UI_TEXT.sessionListsHooks}
            rows={lists.hooks?.map((row) => ({
              key: row.key,
              label: row.key,
              meta: hookMeta(row),
            }))}
          />
          <Section
            id="session-lists-plugins"
            title={UI_TEXT.sessionListsPlugins}
            rows={lists.plugins?.map((row) => ({
              key: row.id,
              label: row.id,
              meta: pluginMeta(row),
            }))}
          />
        </>
      )}
    </div>
  )
}
