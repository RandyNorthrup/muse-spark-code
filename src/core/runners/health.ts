import * as z from 'zod/mini'
import { RUNNER_HEALTH_MS, RUNNER_MAX_JOBS } from '../../shared/constants'

/** The bundled helper's own protocol, not a vendor wire shape. */
export const runnerHealthSchema = z.strictObject({
  cores: z.int().check(z.gte(1)),
  load: z.number().check(z.nonnegative()),
  freeSlots: z.int().check(z.nonnegative(), z.lte(RUNNER_MAX_JOBS)),
  inputReady: z.boolean(),
})
export type RunnerHealth = z.infer<typeof runnerHealthSchema>

export class RunnerHealthStore {
  private readonly records = new Map<string, { at: number; health: RunnerHealth | undefined }>()
  public constructor(private readonly now: () => number) {}
  public record(id: string, value: unknown): RunnerHealth | undefined {
    const parsed = runnerHealthSchema.safeParse(value)
    const health = parsed.success ? parsed.data : undefined
    this.records.set(id, { at: this.now(), health })
    return health
  }
  public get(id: string): RunnerHealth | undefined {
    const record = this.records.get(id)
    return record !== undefined &&
      this.now() - record.at < RUNNER_HEALTH_MS &&
      this.now() >= record.at
      ? record.health
      : undefined
  }
}
