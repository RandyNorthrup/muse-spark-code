import * as acp from '@agentclientprotocol/sdk'
import * as z from 'zod/mini'
import type { ExecSink } from './execOutput'
import type { Lifecycle } from './execLimits'
import type { ExecDenial } from './execProtocol'
import { UI_TEXT } from '../../shared/constants'
import { accountEventSchema, type AccountEvent } from '../../shared/accounts'

const updateParams = z.looseObject({
  sessionId: z.string(),
  update: z.looseObject({ sessionUpdate: z.string() }),
})
const toolMetadata = z.looseObject({
  toolCallId: z.string(),
  kind: z.optional(z.string()),
  status: z.optional(z.string()),
  locations: z.optional(z.nullable(z.array(z.looseObject({ path: z.string() })))),
})

export function createExecClient(input: {
  sink: ExecSink
  lifecycle: Lifecycle
  onDenial: (denial: ExecDenial) => void
  onQuestion: (count: number) => void
  onFilesChanged: (paths: readonly string[]) => void
  onAccountNotice?: (event: AccountEvent) => void
}): ReturnType<typeof acp.client> {
  const edits = new Map<string, string[]>()
  const emit = (event: Parameters<ExecSink['emit']>[0]) => {
    try {
      input.sink.emit(event)
    } catch {
      /* The sink rejects unsafe programmer input before any write. */ input.lifecycle.latch({
        kind: 'internal',
      })
    }
  }
  const client = acp.client({ name: 'muse-headless' })
  // ACP SDK 1.5.0's constructor inserts a closed-union session router before
  // custom parsers. Headless uses request(), never its active-session helpers.
  // Remove only that identified constructor handler from this instance's
  // private builder so unknown updates reach our loose boundary (PLAN.md §8).
  // Re-verified with Muse Code SDK 1.4.2 in M106 S; this is an ACP seam,
  // independent of the Muse Code SDK's Connection and fingerprint.
  const original: unknown = Reflect.get(client, 'builder')
  if (typeof original !== 'object' || original === null) throw new Error(UI_TEXT.execRequestShape)
  const handlers: unknown = Reflect.get(original, 'handlers')
  if (!Array.isArray(handlers) || handlers.length !== 1) throw new Error(UI_TEXT.execRequestShape)
  const router: unknown = handlers[0]
  if (
    typeof router !== 'object' ||
    router === null ||
    !('describe' in router) ||
    typeof router.describe !== 'function'
  )
    throw new Error(UI_TEXT.execRequestShape)
  const description: unknown = Reflect.apply(router.describe, router, [])
  if (description !== 'client-session-update-router') throw new Error(UI_TEXT.execRequestShape)
  handlers.shift()
  return client
    .onNotification('session/update', updateParams, ({ params }) => {
      if (input.lifecycle.signal.aborted) return
      const update = params.update
      if (update.sessionUpdate === 'agent_message_chunk') {
        const meta = z.looseObject({ accountNotice: accountEventSchema }).safeParse(update['_meta'])
        if (meta.success) {
          input.onAccountNotice?.(meta.data.accountNotice)
          emit({
            type: 'update',
            update: { sessionUpdate: 'account_notice', event: meta.data.accountNotice },
          })
        }
      }
      // Drop these before the sink: the ACP translator may already have
      // clipped tool text or made synthetic completed message chunks.
      else if (
        update.sessionUpdate === 'tool_call' ||
        update.sessionUpdate === 'tool_call_update'
      ) {
        const metadata = toolMetadata.safeParse(update)
        if (metadata.success) {
          const tool = metadata.data
          if (update.sessionUpdate === 'tool_call' && tool.kind === 'edit')
            edits.set(tool.toolCallId, tool.locations?.map((location) => location.path) ?? [])
          if (update.sessionUpdate === 'tool_call_update' && tool.status === 'completed') {
            const paths = edits.get(tool.toolCallId)
            if (paths !== undefined) {
              input.onFilesChanged(paths)
              edits.delete(tool.toolCallId)
            }
          }
        }
      }
      if (
        update.sessionUpdate.startsWith('tool') ||
        update.sessionUpdate.startsWith('agent_message_chunk') ||
        update.sessionUpdate.startsWith('agent_thought_chunk')
      )
        return
      emit({ type: 'update', update })
    })
    .onRequest('session/request_permission', ({ params }) => {
      if (input.lifecycle.signal.aborted) return { outcome: { outcome: 'cancelled' } }
      const { toolCall } = params
      // Paths are projected by runExec from the tap using its known cwd.
      // Never turn tool content/rawInput/rawOutput into denial text.
      const denial: ExecDenial = {
        toolCallId: toolCall.toolCallId,
        title: toolCall.kind ?? 'other',
        kind: toolCall.kind ?? 'other',
        paths: toolCall.locations?.map((location) => location.path) ?? [],
      }
      input.onDenial(denial)
      emit({ type: 'permission_denied', ...denial })
      const reject = params.options.find((option) => option.kind === 'reject_once')
      return {
        outcome:
          reject === undefined
            ? { outcome: 'cancelled' }
            : { outcome: 'selected', optionId: reject.optionId },
      }
    })
    .onRequest('elicitation/create', () => {
      if (input.lifecycle.signal.aborted) return { action: 'cancel' }
      input.onQuestion(1)
      emit({ type: 'question_declined', count: 1 })
      return { action: 'cancel' }
    })
}
