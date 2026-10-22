// One session's live lists (M127): the background-task, hook and plugin
// rows the session-lists dialog shows. Shared by the host (which maps the
// session's lists onto these) and the webview (which renders them). No
// `vscode`, Node or DOM imports.

import * as z from 'zod/mini'

/** One background-task row (MSP `task/list`): kind and status are open. */
export const backgroundTaskRowSchema = z.object({
  taskId: z.string(),
  kind: z.string(),
  status: z.string(),
  startedAt: z.optional(z.string()),
  tool: z.optional(z.string()),
  backgroundInitiator: z.optional(z.string()),
})
export type BackgroundTaskRow = z.infer<typeof backgroundTaskRowSchema>

/** One installed hook row (MSP `hook/list`): the event is open. */
export const sessionHookRowSchema = z.object({
  key: z.string(),
  event: z.string(),
  handlerKind: z.string(),
  enabled: z.boolean(),
})
export type SessionHookRow = z.infer<typeof sessionHookRowSchema>

/** One installed plugin record (MSP `plugin/list`): the source reads as served. */
export const sessionPluginRowSchema = z.object({
  id: z.string(),
  version: z.string(),
  enabled: z.boolean(),
  source: z.string(),
})
export type SessionPluginRow = z.infer<typeof sessionPluginRowSchema>
