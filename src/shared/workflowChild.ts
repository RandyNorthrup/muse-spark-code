import * as z from 'zod/mini'

/** Captured M47 child: optional fields are independently readable, including future values. */
export const workflowChildSchema = z.object({
  childId: z.string(),
  attempt: z.number(),
  status: z.string(),
  label: z.optional(z.unknown()),
  terminal: z.optional(z.unknown()),
  durationMs: z.optional(z.unknown()),
  usage: z.optional(z.unknown()),
})
