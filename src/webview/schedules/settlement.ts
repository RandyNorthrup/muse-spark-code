// A restored schedule settlement row (M115) paints with chat startup, so its
// parser stays apart from the lazy surface's presentation helpers: startup
// carries this schema and the scheduleSettlement words, never the surface's
// English (STARTUP017).
import * as z from 'zod/mini'
import { scheduleFireRecordSchema, type ScheduleFireRecord } from '../../shared/scheduleV2'

const settlementSchema = z.strictObject({
  type: z.literal('scheduleFire'),
  fire: scheduleFireRecordSchema,
})

export function parseScheduleSettlement(
  output: string,
): { readonly ok: true; readonly fire: ScheduleFireRecord } | { readonly ok: false } {
  try {
    const parsed = settlementSchema.safeParse(JSON.parse(output))
    return parsed.success ? { ok: true, fire: parsed.data.fire } : { ok: false }
  } catch {
    return { ok: false }
  }
}
