// M124 (D106): M115's schedules through the connector. The list is an
// allow-listed projection of the runtime's own `schedule list --json`
// answer (no prompt text); cancel pauses a schedule on Stop's path.
import * as z from 'zod/mini'

export interface SchedulesPort {
  /** The runtime's JSON answer for `schedule list` in that workspace. */
  readonly list: (root: string, signal?: AbortSignal) => Promise<unknown>
  /** The runtime's JSON answer for `schedule pause <id>`. */
  readonly pause: (root: string, id: string) => Promise<unknown>
}

const listSchema = z.object({
  kind: z.literal('list'),
  schedules: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      delivery: z.string(),
      paused: z.boolean(),
      nextFireAtMs: z.optional(z.number()),
    }),
  ),
})
const refusedSchema = z.object({ kind: z.literal('refused'), reason: z.string() })
const acceptedSchema = z.object({ kind: z.literal('accepted') })

export type ScheduleAnswer<T> =
  { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'refused'; readonly reason: string }

export function projectScheduleList(answer: unknown): ScheduleAnswer<
  readonly {
    readonly id: string
    readonly name: string
    readonly delivery: string
    readonly paused: boolean
    readonly nextFireAt?: string
  }[]
> {
  const refused = refusedSchema.safeParse(answer)
  if (refused.success) return { kind: 'refused', reason: refused.data.reason }
  const list = listSchema.parse(answer)
  return {
    kind: 'ok',
    value: list.schedules.map((schedule) => ({
      id: schedule.id,
      name: schedule.name,
      delivery: schedule.delivery,
      paused: schedule.paused,
      ...(schedule.nextFireAtMs !== undefined && {
        nextFireAt: new Date(schedule.nextFireAtMs).toISOString(),
      }),
    })),
  }
}

export function projectSchedulePause(answer: unknown): ScheduleAnswer<'stopped'> {
  const refused = refusedSchema.safeParse(answer)
  if (refused.success) return { kind: 'refused', reason: refused.data.reason }
  acceptedSchema.parse(answer)
  return { kind: 'ok', value: 'stopped' }
}
