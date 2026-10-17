import * as z from 'zod/mini'
import { usageCountSchema, usageIdSchema } from './usageJournal'
import { usagePageToServiceMessageSchema, usageServiceToPageMessageSchema } from './usagePage'

// Our page protocol over C's authenticated companion transport.
export const usageCompanionRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('request'),
    id: usageIdSchema,
    message: usagePageToServiceMessageSchema,
  }),
  z.strictObject({
    type: z.literal('confirm'),
    id: usageIdSchema,
    count: usageCountSchema,
    approved: z.boolean(),
  }),
])
export const usageCompanionEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('reply'),
    id: usageIdSchema,
    messages: z.array(usageServiceToPageMessageSchema),
    download: z.optional(
      z.strictObject({
        name: z.string(),
        mimeType: z.enum(['text/csv', 'application/json']),
        content: z.string(),
      }),
    ),
  }),
  z.strictObject({
    type: z.literal('confirm'),
    id: usageIdSchema,
    count: usageCountSchema,
    detail: z.string(),
  }),
])
export type UsageCompanionEvent = z.infer<typeof usageCompanionEventSchema>
