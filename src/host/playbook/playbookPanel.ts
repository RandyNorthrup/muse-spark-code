// The VS Code panel's side of the playbook (M116, lane C-M116-6): the Agent
// map's page reads and changes the journal, and its rows read their records,
// through the window's playbook. Every request is parsed here. One this
// build cannot read is not answered; a journal that cannot be read answers
// `playbookUnavailable`, never a made-up state.

import { randomUUID } from 'node:crypto'
import type { PlaybookRecord } from '../../shared/playbook'
import { playbookSnapshotSchema } from '../../runtime/playbook/command'
import {
  playbookPanelRequestSchema,
  type PlaybookPanelResponse,
} from '../../runtime/playbook/panelWire'
import type { PlaybookWindow } from './playbookWindow'

/** The conversation a panel shows, as its controller knows it. */
export interface PlaybookPanelContext {
  readonly sessionId: string | undefined
  /** Whether its backend asks before it starts a subagent, in its mode now. */
  readonly asksBeforeSpawn: boolean
}

/** Answers one message of a panel; never rejects. */
export type PlaybookPanel = (
  raw: unknown,
  reply: (message: PlaybookPanelResponse) => void,
  context?: PlaybookPanelContext,
) => Promise<void>

export function createPlaybookPanel(window: PlaybookWindow, hasWorkspace: boolean): PlaybookPanel {
  // Scopes the panel's bridge to this window's journal. It names nothing: a
  // folder's path never goes to the webview.
  const workspaceId = hasWorkspace ? randomUUID() : undefined
  /** Whether the map owes its conversation the line about unasked subagents. */
  const hasSpawnGap = async (context: PlaybookPanelContext | undefined): Promise<boolean> => {
    if (context?.sessionId === undefined || context.asksBeforeSpawn) return false
    try {
      const open = await window.standing(context.sessionId)
      return open.length > 0
    } catch {
      return false
    }
  }
  return async (raw, reply, context) => {
    const parsed = playbookPanelRequestSchema.safeParse(raw)
    if (!parsed.success) return
    const request = parsed.data
    if (request.type === 'playbookHello') {
      reply({
        type: 'playbookHello',
        ...(workspaceId !== undefined && { workspaceId }),
        ...((await hasSpawnGap(context)) && { spawnGap: true }),
      })
      return
    }
    if (request.type === 'playbookAgents') {
      let records: Record<string, PlaybookRecord[]> = {}
      try {
        records = await window.agents(request.children)
      } catch {
        // The rows show no playbook records; the page says why when it is opened.
      }
      reply({ type: 'playbookAgents', requestId: request.requestId, records })
      return
    }
    const scope = {
      bridgeId: request.bridgeId,
      workspaceId: request.workspaceId,
      requestId: request.requestId,
    }
    // A request scoped to another journal is not this window's to answer.
    if (request.workspaceId !== workspaceId) {
      reply({ type: 'playbookUnavailable', ...scope })
      return
    }
    try {
      const snapshot = playbookSnapshotSchema.parse(
        request.type === 'playbookRead'
          ? await window.surface.read()
          : await window.surface.change(request.change),
      )
      reply({ type: 'playbookState', ...scope, snapshot })
    } catch {
      reply({ type: 'playbookUnavailable', ...scope })
    }
  }
}
