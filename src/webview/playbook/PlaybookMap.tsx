// The map's settings navigation belongs to the playbook's own lazy closure.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { PLAYBOOK_PANEL_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { PlaybookRecord } from '../../shared/playbook'
import type { PlaybookSurfacePort } from '../../runtime/playbook/command'
import {
  playbookAgentRefSchema,
  playbookAgentsFailedSchema,
  playbookAgentsSchema,
  playbookFailedSchema,
  playbookHelloSchema,
  type PlaybookAgentRef,
  type PlaybookPanelRequest,
} from '../../runtime/playbook/panelWire'
import { createPlaybookBridge } from './bridge'
import { PlaybookPanel } from './PlaybookPanel'

const agentRefs = z.array(playbookAgentRefSchema)

export interface PlaybookLinkProps {
  /** Posts on the playbook's channel; the window's answers arrive as `playbook` messages. */
  readonly post: (message: PlaybookPanelRequest) => void
  /** The map's rows that are child agents the host recorded. */
  readonly agents: readonly PlaybookAgentRef[]
  /** The journal's port while this window has one; undefined before, and after. */
  readonly onPort: (port: PlaybookSurfacePort | undefined) => void
  readonly onRecords: (records: Readonly<Record<string, readonly PlaybookRecord[]>>) => void
}

/** What is inside the host's envelope; undefined for any other message. */
function inner(data: unknown): unknown {
  return typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === 'playbook' &&
    'message' in data
    ? data.message
    : undefined
}

/**
 * The VS Code panel's link to its window's playbook: asks which journal the
 * window reads, hands the map that journal's port, and reads the rows'
 * records. What it shows itself is what the map would otherwise hide: that
 * the window's playbook could not be asked, that the rows' records could not
 * be read (what is shown is kept, and said to be possibly old), each with a
 * way to ask again; and the line a governed conversation is owed while its
 * backend starts subagents without asking. A host that never answers has no
 * playbook, and leaves the map exactly as it was.
 */
export function PlaybookLink({ post, agents, onPort, onRecords }: PlaybookLinkProps) {
  const [workspaceId, setWorkspaceId] = useState<string>()
  const [hasSpawnGap, setSpawnGap] = useState(false)
  const [isFailed, setFailed] = useState(false)
  const [isStale, setStale] = useState(false)
  /** Counts the times the person asked again: each asks the window anew. */
  const [attempt, setAttempt] = useState(0)
  const sequence = useRef(0)
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const message = inner(event.data)
      if (playbookFailedSchema.safeParse(message).success) {
        // No journal is known now: the page goes, and the map says why.
        setFailed(true)
        setWorkspaceId(undefined)
        return
      }
      const hello = playbookHelloSchema.safeParse(message)
      if (!hello.success) return
      setFailed(false)
      setWorkspaceId(hello.data.workspaceId)
      setSpawnGap(hello.data.spawnGap === true)
    }
    window.addEventListener('message', receive)
    post({ type: 'playbookHello' })
    return () => {
      window.removeEventListener('message', receive)
    }
  }, [post, attempt])
  useEffect(() => {
    if (workspaceId === undefined) return
    const bridge = createPlaybookBridge(window, post, PLAYBOOK_PANEL_TIMEOUT_MS, workspaceId, inner)
    onPort(bridge)
    return () => {
      onPort(undefined)
      bridge.dispose()
    }
  }, [workspaceId, post, onPort])
  // The rows by value: the map hands a new array on every render.
  const rows = JSON.stringify(agents)
  useEffect(() => {
    const children = agentRefs.parse(JSON.parse(rows))
    if (workspaceId === undefined || children.length === 0) return
    sequence.current += 1
    const requestId = sequence.current
    const receive = (event: MessageEvent<unknown>) => {
      const message = inner(event.data)
      const failed = playbookAgentsFailedSchema.safeParse(message)
      // A read that failed says nothing about the records: what is shown stays, marked.
      if (failed.success && failed.data.requestId === requestId) setStale(true)
      const answer = playbookAgentsSchema.safeParse(message)
      if (!answer.success || answer.data.requestId !== requestId) return
      setStale(false)
      onRecords(answer.data.records)
    }
    window.addEventListener('message', receive)
    post({ type: 'playbookAgents', requestId, children })
    return () => {
      window.removeEventListener('message', receive)
    }
  }, [workspaceId, rows, post, onRecords, attempt])
  // With no child's row there is no record shown that could be old.
  const isMarked = isStale && agents.length > 0
  return (
    <>
      {isFailed || isMarked ? (
        <p className="usage-row-meta" role="alert">
          {isFailed ? UI_TEXT.playbookUnavailable : UI_TEXT.playbookRecordStale}{' '}
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              setAttempt((count) => count + 1)
            }}
          >
            {UI_TEXT.agentRetry}
          </button>
        </p>
      ) : null}
      {hasSpawnGap ? (
        <p className="usage-row-meta" role="note">
          {fill(UI_TEXT.playbookSpawnsNotAdmitted, {
            auto: UI_TEXT.permissionModes.auto,
            bypass: UI_TEXT.permissionModes.bypassPermissions,
          })}
        </p>
      ) : null}
    </>
  )
}

export function PlaybookMap({
  port,
  children,
}: {
  readonly port: PlaybookSurfacePort
  readonly children: ReactNode
}) {
  const [isOpen, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const previouslyOpen = useRef(isOpen)
  useEffect(() => {
    if (!isOpen && previouslyOpen.current) opener.current?.focus()
    previouslyOpen.current = isOpen
  }, [isOpen])
  return isOpen ? (
    <>
      <button
        type="button"
        className="tool-more"
        onClick={() => {
          setOpen(false)
        }}
      >
        {UI_TEXT.agentBack}
      </button>
      <PlaybookPanel port={port} />
    </>
  ) : (
    <>
      <button
        ref={opener}
        type="button"
        className="tool-more"
        onClick={() => {
          setOpen(true)
        }}
      >
        {UI_TEXT.playbookSettings}
      </button>
      {children}
    </>
  )
}
