import * as z from 'zod/mini'
import { createHash } from 'node:crypto'
import { SCHEDULE_EVENT_FIELD_MAX_CHARS } from '../../../shared/constants'
import {
  scheduleEventSchema,
  type ScheduleEvent,
  type ScheduleSourceCapability,
  type ScheduleSubscribedEventSource,
} from '../../../shared/scheduleEvents'
import { compileGlob } from '../../backends/modelapi/globLimits'
import { noEventHistory } from './ports'

export interface ScheduleWorkspaceWatchPort {
  capability(): ScheduleSourceCapability
  /** The host watches only this workspace; links never broaden that scope. */
  watch(globs: readonly string[], listener: (input: unknown) => void): { dispose(): void }
}
const pathSchema = z.string().check(
  z.minLength(1),
  z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS),
  z.refine(
    (value) => !value.startsWith('/') && !value.includes('..') && !/[:\\\p{Cc}]/u.test(value),
  ),
)
const notificationSchema = z.strictObject({
  relativePath: pathSchema,
  identity: z.string().check(z.minLength(1), z.maxLength(SCHEDULE_EVENT_FIELD_MAX_CHARS)),
  observedAt: z.int().check(z.gte(0)),
})
export class ScheduleFilesSource implements ScheduleSubscribedEventSource {
  private readonly globs: readonly string[]
  private readonly matches: readonly ((relative: string) => boolean)[]
  readonly id = 'files'
  readonly kinds = ['filesChanged'] as const
  constructor(
    globs: readonly string[],
    private readonly port: ScheduleWorkspaceWatchPort,
    private readonly onRejected: (id: string) => void,
  ) {
    this.globs = z.array(pathSchema).check(z.minLength(1)).parse(globs)
    this.matches = this.globs.map((glob) => compileGlob(glob))
  }
  capability() {
    return this.port.capability()
  }
  history() {
    return noEventHistory()
  }
  subscribe(listener: (event: ScheduleEvent) => void): { dispose(): void } {
    const capability = this.capability()
    if (!capability.available) throw new Error(capability.reason)
    let isDisposed = false
    const watcher = this.port.watch(this.globs, (input) => {
      if (isDisposed || !this.capability().available) return
      let event: ScheduleEvent
      try {
        const change = notificationSchema.parse(input)
        if (this.matches.every((matches) => !matches(change.relativePath))) return
        event = scheduleEventSchema.parse({
          source: this.id,
          kind: 'filesChanged',
          eventKey: createHash('sha256')
            .update(JSON.stringify([change.relativePath, change.identity]))
            .digest('hex'),
          observedAt: change.observedAt,
          fields: { path: change.relativePath },
        })
      } catch {
        this.onRejected(this.id)
        return
      }
      listener(event)
    })
    return {
      dispose: () => {
        isDisposed = true
        watcher.dispose()
      },
    }
  }
}
