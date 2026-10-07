// M115's lazy schedule channel. Keep schema construction outside the main
// conversation protocol so a single-model user pays no activation cost.
import * as z from 'zod/mini'
import { scheduleRequestSchema, scheduleResponseSchema } from './scheduleV2'
import { parseWith, type ParseResult } from './protocol'
import { SCHEDULE_PROTOCOL_VERSION } from './constants'

// M115's lazy schedule surface uses a separate validated channel, like Tasks.
// The main conversation protocol stays on M52 until lane W binds the surface.
export const scheduleWebviewMessageSchema = z.strictObject({
  type: z.literal('schedulesRequest'),
  version: z.literal(SCHEDULE_PROTOCOL_VERSION),
  requestId: z.string().check(z.minLength(1)),
  request: scheduleRequestSchema,
})
const scheduleResponseMessageSchema = z.strictObject({
  type: z.literal('schedulesResponse'),
  version: z.literal(SCHEDULE_PROTOCOL_VERSION),
  requestId: z.string().check(z.minLength(1)),
  response: scheduleResponseSchema,
})
/** W/S broadcast the durable workspace store revision after every write. */
export const scheduleChangedMessageSchema = z.strictObject({
  type: z.literal('scheduleChanged'),
  version: z.literal(SCHEDULE_PROTOCOL_VERSION),
  workspaceKey: z.string().check(z.minLength(1), z.regex(/^[\w-][\w.-]*$/)),
  revision: z.int().check(z.gte(0)),
})
export const scheduleHostMessageSchema = z.discriminatedUnion('type', [
  scheduleResponseMessageSchema,
  scheduleChangedMessageSchema,
])
export type ScheduleWebviewMessage = z.infer<typeof scheduleWebviewMessageSchema>
export type ScheduleHostMessage = z.infer<typeof scheduleHostMessageSchema>
export function parseScheduleWebviewMessage(input: unknown): ParseResult<ScheduleWebviewMessage> {
  return parseWith(scheduleWebviewMessageSchema, input)
}
export function parseScheduleHostMessage(input: unknown): ParseResult<ScheduleHostMessage> {
  return parseWith(scheduleHostMessageSchema, input)
}
