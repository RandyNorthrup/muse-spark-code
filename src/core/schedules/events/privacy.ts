import { createHash } from 'node:crypto'
import {
  scheduleEventSchema,
  scheduleEventBlockSchema,
  type ScheduleEvent,
  type ScheduleEventBlock,
} from '../../../shared/scheduleEvents'
import { SCHEDULE_EVENT_FIELD_MAX_CHARS } from '../../../shared/constants'
import { buildSessionExport } from '../../export/sessionTransfer'
import { fenced } from '../../export/transcriptMarkdown'

/** M109's marker sees only data, never the schedule's mutable authority. */
export interface ScheduleEventTaintPort {
  mark(block: ScheduleEventBlock): void
}

function opaque(original: string, scrubbed: string): string {
  return original === scrubbed
    ? original
    : createHash('sha256').update(original).digest('base64url')
}

export class ScheduleEventPrivacy {
  constructor(
    private readonly localRoots: readonly string[],
    private readonly taint: ScheduleEventTaintPort,
    private readonly eventLead: string,
  ) {}

  async scrub(input: ScheduleEvent): Promise<ScheduleEvent> {
    const event = scheduleEventSchema.parse(input)
    const fields = Object.entries(event.fields)
    const strings = [event.eventKey, ...fields.flatMap(([key, value]) => [key, String(value)])]
    // Use M84's real scrub, including plain paths before any JSON escaping.
    const result = await buildSessionExport(
      {
        backend: 'modelApi',
        modelId: '',
        exportedAt: new Date(event.observedAt).toISOString(),
        items: strings.map((text, index) => ({
          itemId: String(index),
          kind: 'userMessage',
          status: 'completed',
          text,
        })),
      },
      { redact: true, localRoots: this.localRoots },
    )
    const clean = result.doc.transcript.map((item) => item.text ?? '')
    return scheduleEventSchema.parse({
      ...event,
      eventKey: opaque(event.eventKey, clean[0] ?? ''),
      fields: Object.fromEntries(
        fields.map(([key, value], index) => [
          opaque(key, clean[1 + index * 2] ?? ''),
          typeof value === 'string'
            ? (clean[2 + index * 2] ?? '').slice(0, SCHEDULE_EVENT_FIELD_MAX_CHARS)
            : value,
        ]),
      ),
    })
  }

  block(event: ScheduleEvent): { readonly block: ScheduleEventBlock; readonly text: string } {
    const block = scheduleEventBlockSchema.parse({
      type: 'scheduleEvent',
      trust: 'untrusted',
      event,
    })
    this.taint.mark(structuredClone(block))
    return { block, text: `${this.eventLead}\n${fenced(JSON.stringify(block), 'json')}` }
  }
}
