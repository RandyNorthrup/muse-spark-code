// The VS Code panel's side of the playbook (M116, lane C-M116-6): the Agent
// map's page reads and changes the journal, and its rows read their records,
// through the window's playbook. Every request is parsed here. One this
// build cannot read is not answered. A failure is answered as a failure, in
// its own message: a journal that cannot be read is `playbookUnavailable`, a
// hello that could not be answered `playbookFailed`, rows whose records could
// not be read `playbookAgentsFailed`. Never a made-up state, and never an
// empty one that reads like success.

import { randomUUID } from 'node:crypto'
import { PLAYBOOK_PANEL_TIMEOUT_MS } from '../../shared/constants'
import { playbookSnapshotSchema } from '../../runtime/playbook/command'
import {
  playbookPanelRequestSchema,
  type PlaybookPanelResponse,
} from '../../runtime/playbook/panelWire'
import type { PlaybookWindow } from './playbookWindow'

/**
 * Whether the conversation a panel shows is owed the line about subagents its
 * backend starts unasked (D96.17), from that conversation's own playbook.
 * Rejects when the journal could not say; undefined with no conversation.
 */
export type PlaybookPanelGap = () => Promise<boolean> | undefined

/** Answers one message of a panel; never rejects. */
export type PlaybookPanel = (
  raw: unknown,
  reply: (message: PlaybookPanelResponse) => void,
  hasSpawnGap?: PlaybookPanelGap,
) => Promise<void>

/** `work`, or a rejection when it has not settled within `ms`. */
function within<T>(ms: number, work: Promise<T> | undefined): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The playbook did not answer in time'))
    }, ms)
    timer.unref()
    const settled = async (): Promise<void> => {
      try {
        resolve(await work)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        clearTimeout(timer)
      }
    }
    void settled()
  })
}

export function createPlaybookPanel(
  window: PlaybookWindow,
  hasWorkspace: boolean,
  helloTimeoutMs: number = PLAYBOOK_PANEL_TIMEOUT_MS,
): PlaybookPanel {
  // Scopes the panel's bridge to this window's journal. It names nothing: a
  // folder's path never goes to the webview.
  const workspaceId = hasWorkspace ? randomUUID() : undefined
  return async (raw, reply, hasSpawnGap) => {
    const parsed = playbookPanelRequestSchema.safeParse(raw)
    if (!parsed.success) return
    const request = parsed.data
    if (request.type === 'playbookHello') {
      try {
        // The hello waits on nothing without a bound: a journal that cannot say is a failure.
        const hasGap = await within(helloTimeoutMs, hasSpawnGap?.())
        reply({
          type: 'playbookHello',
          ...(workspaceId !== undefined && { workspaceId }),
          ...(hasGap === true && { spawnGap: true }),
        })
      } catch {
        reply({ type: 'playbookFailed' })
      }
      return
    }
    if (request.type === 'playbookAgents') {
      const { requestId } = request
      try {
        reply({ type: 'playbookAgents', requestId, records: await window.agents(request.children) })
      } catch {
        reply({ type: 'playbookAgentsFailed', requestId })
      }
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
