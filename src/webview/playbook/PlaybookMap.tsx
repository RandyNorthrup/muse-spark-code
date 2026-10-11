// The map's settings navigation belongs to the playbook's own lazy closure.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as z from 'zod/mini'
import { PLAYBOOK_PANEL_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'
import type { PlaybookRecord } from '../../shared/playbook'
import type { PlaybookSurfacePort } from '../../runtime/playbook/command'
import {
  playbookAgentRefSchema,
  playbookAgentsSchema,
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
 * records. It shows nothing itself. A host that never answers leaves the map
 * exactly as it was.
 */
export function PlaybookLink({ post, agents, onPort, onRecords }: PlaybookLinkProps) {
  const [workspaceId, setWorkspaceId] = useState<string>()
  const sequence = useRef(0)
  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const hello = playbookHelloSchema.safeParse(inner(event.data))
      if (hello.success) setWorkspaceId(hello.data.workspaceId)
    }
    window.addEventListener('message', receive)
    post({ type: 'playbookHello' })
    return () => {
      window.removeEventListener('message', receive)
    }
  }, [post])
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
      const answer = playbookAgentsSchema.safeParse(inner(event.data))
      if (answer.success && answer.data.requestId === requestId) onRecords(answer.data.records)
    }
    window.addEventListener('message', receive)
    post({ type: 'playbookAgents', requestId, children })
    return () => {
      window.removeEventListener('message', receive)
    }
  }, [workspaceId, rows, post, onRecords])
  return null
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
