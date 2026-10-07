import {
  RequestError,
  type AvailableCommand,
  type ContentBlock,
  type SessionUpdate,
} from '@agentclientprotocol/sdk'
import { UI_TEXT } from '../shared/constants'
import { resourceEventSchema, resourceStatusSchema } from '../shared/resources'
import type { RuntimeResourceNotice, RuntimeResources } from '../runtime/resources/port'

export function resourceCommands(): AvailableCommand[] {
  return [
    {
      name: 'resources',
      description: UI_TEXT.resourceGovernorDescription,
      input: { hint: 'status | history | resume' },
    },
    { name: 'usage', description: UI_TEXT.resourceHistory, input: { hint: 'resources' } },
  ]
}

/** Commands are handled locally before skill expansion or any model submission. */
export async function acpResourceCommand(
  blocks: readonly ContentBlock[],
  resources: RuntimeResources,
): Promise<SessionUpdate | undefined> {
  const first = blocks[0]
  if (first?.type !== 'text') return undefined
  const words = first.text.trim().split(/\s+/)
  const isResources = words[0] === '/resources'
  const isHistory = words[0] === '/usage' && words[1] === 'resources'
  if (!isResources && !isHistory) return undefined
  const action = isHistory ? 'history' : (words[1] ?? 'status')
  if (blocks.length !== 1 || words.length > 2 || !['status', 'history', 'resume'].includes(action))
    throw RequestError.invalidParams(undefined, UI_TEXT.resourceGovernorDescription)
  if (action !== 'status' && action !== 'history' && action !== 'resume') return undefined
  return {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: await resources.command(action, false) },
  }
}

/** A local tool id supplies correlation; it never enters the bounded resource payload. */
export function acpResourceUpdates(notice: RuntimeResourceNotice): SessionUpdate[] {
  const event = resourceEventSchema.parse(notice.event)
  const status = resourceStatusSchema.parse(notice.status)
  if (event.type === 'deferred' && notice.toolCallId !== undefined)
    return [
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: notice.toolCallId,
        title: UI_TEXT.resourceWaiting,
        status: 'pending',
        _meta: { 'museSpark.resources': { event, status } },
        content: [{ type: 'content', content: { type: 'text', text: notice.text } }],
      },
    ]
  if (
    event.type !== 'levelChanged' &&
    event.type !== 'override' &&
    event.type !== 'deferred' &&
    event.type !== 'relocated'
  )
    return []
  return [
    {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: notice.text },
      _meta: { 'museSpark.resources': { event, status } },
    },
  ]
}
