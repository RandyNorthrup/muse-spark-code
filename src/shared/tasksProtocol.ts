// The read-only tasks surface has no conversation commands or send action.
import * as z from 'zod/mini'
import { todoItemSchema } from './agentEvents'

export const tasksHostMessageSchema = z.strictObject({
  type: z.literal('tasksState'),
  conversation: z.string(),
  items: z.array(todoItemSchema),
  ended: z.boolean(),
  canMoveToWindow: z.boolean(),
})
export type TasksHostMessage = z.infer<typeof tasksHostMessageSchema>

export const tasksWebviewMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('tasksReady') }),
  z.strictObject({ type: z.literal('revealConversation') }),
  z.strictObject({ type: z.literal('moveTasksToWindow') }),
])
export type TasksWebviewMessage = z.infer<typeof tasksWebviewMessageSchema>
