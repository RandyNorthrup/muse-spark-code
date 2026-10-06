// M115's lazy schedule channel. Keep schema construction outside the main
// conversation protocol so a single-model user pays no activation cost.
import * as z from 'zod/mini'
import { scheduleRequestSchema, scheduleResponseSchema } from './scheduleV2'
import { parseWith, type ParseResult } from './protocol'

// M115's lazy schedule surface uses a separate validated channel, like Tasks.
// The main conversation protocol stays on M52 until lane W binds the surface.
export const scheduleWebviewMessageSchema = z.strictObject({
  type: z.literal('schedulesRequest'),
  requestId: z.string().check(z.minLength(1)),
  request: scheduleRequestSchema,
})
export const scheduleHostMessageSchema = z.strictObject({
  type: z.literal('schedulesResponse'),
  requestId: z.string().check(z.minLength(1)),
  response: scheduleResponseSchema,
})
export type ScheduleWebviewMessage = z.infer<typeof scheduleWebviewMessageSchema>
export type ScheduleHostMessage = z.infer<typeof scheduleHostMessageSchema>
export function parseScheduleWebviewMessage(input: unknown): ParseResult<ScheduleWebviewMessage> {
  return parseWith(scheduleWebviewMessageSchema, input)
}
export function parseScheduleHostMessage(input: unknown): ParseResult<ScheduleHostMessage> {
  return parseWith(scheduleHostMessageSchema, input)
}
