import * as z from 'zod/mini'

/** GET /v1/status, captured 2026-10-05 with and without authentication (M106). */
export const modelApiStatusSchema = z.object({
  is_alive: z.boolean(),
  service_status: z.string(),
  service_message: z.string(),
  updated_at: z.string(),
  // Only an empty list was captured. Preserve future entries without
  // inventing their fields; lane R must validate any fields it consumes.
  model_statuses: z.array(z.unknown()),
})
