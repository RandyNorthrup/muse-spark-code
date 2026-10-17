import { RESOURCE_EXEC_EVENT_VERSION } from '../../shared/constants'
import { resourceEventSchema, type ResourceEvent } from '../../shared/resources'
import { createExecSink, type ExecSink } from '../exec/execOutput'
import { execEventSchema, execEventV2Schema } from '../exec/execProtocol'
import type { FdWriter } from '../exec/fdWriter'

/** Interleave resource events after M80 validates and redacts each ordinary v2 body. */
export function createResourceExecSink(input: Parameters<typeof createExecSink>[0]): ExecSink & {
  resource(event: ResourceEvent): boolean
} {
  let seq = 0
  let isFinished = false
  const writeEvent = (body: unknown) => {
    const event = execEventV2Schema.parse(body)
    input.out.write(`${JSON.stringify(event)}\n`)
    seq = event.seq
  }
  const out: FdWriter = {
    write(chunk) {
      if (input.format !== 'jsonl') {
        input.out.write(chunk)
        return
      }
      const raw: unknown = JSON.parse(chunk)
      const old = execEventSchema.parse(raw)
      writeEvent({ ...old, v: RESOURCE_EXEC_EVENT_VERSION, seq: seq + 1 })
    },
    get queuedBytes() {
      return input.out.queuedBytes
    },
    get isClosed() {
      return input.out.isClosed
    },
    flush: (withinMs) => input.out.flush(withinMs),
  }
  const sink = createExecSink({ ...input, out })
  return {
    ...sink,
    get isStalled() {
      return sink.isStalled
    },
    get resultExitCode() {
      return sink.resultExitCode
    },
    resource(event) {
      if (isFinished || sink.isStalled) return false
      resourceEventSchema.parse(event)
      if (input.format !== 'jsonl') return true

      writeEvent({
        v: RESOURCE_EXEC_EVENT_VERSION,
        seq: seq + 1,
        time: new Date(input.now()).toISOString(),
        type: 'resource',
        event,
      })
      // Use the existing sink's backpressure check after this write, too.
      return !sink.isStalled
    },
    async finish(result) {
      isFinished = true
      await sink.finish(result)
    },
    forceFinish(result) {
      isFinished = true
      sink.forceFinish(result)
    },
  }
}
