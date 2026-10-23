// S1: a model stream cut mid-response (M110r Y4). Recorded bytes flow
// over a real loopback socket; the cutter destroys it halfway through a
// tool-call arguments delta. The real SSE parser yields only complete
// events, every one validates against the real stream schema, the resume
// drops the partial call (never run) with the carried history
// byte-identical, and the headless outcome is incomplete, never failed.
import { resumeFromCut } from '../../../src/core/backends/modelapi/resume'
import {
  eventTypeSchema,
  isFunctionCallItem,
  streamEventSchema,
  type InputItem,
  type OutputItem,
  type StreamEvent,
} from '../../../src/core/backends/modelapi/schemas'
import { parseSse } from '../../../src/core/backends/modelapi/sse'
import { outcomeStatus } from '../../../src/runtime/exec/execProtocol'
import {
  checkFact,
  frameToSse,
  loadRecordedStream,
  readSocketChunks,
  serveAndCut,
} from '../../../scripts/lib/faultRig.mjs'
import type { FaultScenario } from '../scenario'

export const scenario: FaultScenario = {
  name: 's1-stream-cut',
  needs: 'loopback',
  run: async (repoRoot: string): Promise<void> => {
    const { bytes, frames } = await loadRecordedStream(repoRoot)
    // Cut halfway through the second arguments delta (frame 12): the
    // call's `.done`, its item's `.done` and `response.completed` never
    // arrive.
    const cutFrame = frames[12]
    checkFact(cutFrame !== undefined, 'recorded stream has frame 12')
    const prefix = frames
      .slice(0, 12)
      .map((frame) => frameToSse(frame))
      .join('')
    const cutFrameText = frameToSse(cutFrame)
    const prefixBytes = Buffer.byteLength(prefix, 'utf8')
    const cutFrameBytes = Buffer.byteLength(cutFrameText, 'utf8')
    const cutAt = prefixBytes + Math.floor(cutFrameBytes / 2)
    checkFact(cutAt > prefixBytes && cutAt < prefixBytes + cutFrameBytes, 'cut lands mid-event')

    const cutter = await serveAndCut(bytes, cutAt)
    const events: { event: string | undefined; data: string }[] = []
    let bytesRead = 0
    try {
      const chunks = (async function* () {
        for await (const chunk of readSocketChunks(cutter.port)) {
          bytesRead += chunk.byteLength
          yield chunk
        }
      })()
      for await (const parsed of parseSse(chunks)) {
        events.push(parsed)
      }
    } finally {
      await cutter.close()
    }
    checkFact(bytesRead === cutAt, `cut at byte ${String(cutAt)}, read ${String(bytesRead)}`)
    checkFact(
      events.every((entry) => entry.event !== 'response.completed'),
      'no completion crossed the cut',
    )

    // Every complete event validates: known ones against the stream
    // schema, unknown ones by their discriminator, as the host does.
    const doneItems: OutputItem[] = []
    const completedIds = new Set<string>()
    const addedWithoutDone = new Set<string>()
    const noteValidated = (validated: StreamEvent): void => {
      switch (validated.type) {
        case 'response.output_item.added': {
          const id = 'id' in validated.item ? validated.item.id : undefined
          if (typeof id === 'string') addedWithoutDone.add(id)
          break
        }
        case 'response.output_item.done': {
          const item = validated.item
          doneItems.push(item)
          const id = 'id' in item && typeof item.id === 'string' ? item.id : undefined
          if (id !== undefined) {
            completedIds.add(id)
            addedWithoutDone.delete(id)
          }
          if (isFunctionCallItem(item)) completedIds.add(item.call_id)
          break
        }
        case 'response.function_call_arguments.done': {
          completedIds.add(validated.item_id)
          break
        }
        default: {
          break
        }
      }
    }
    for (const entry of events) {
      let data: unknown
      try {
        data = JSON.parse(entry.data)
      } catch {
        break // the cut's partial tail: incomplete by construction
      }
      const parsed = streamEventSchema.safeParse(data)
      if (!parsed.success) {
        eventTypeSchema.parse(data)
        continue
      }
      noteValidated(parsed.data)
    }
    checkFact(doneItems.length > 0, 'complete items crossed before the cut')

    const carried: InputItem[] = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] },
    ]
    const cut = resumeFromCut(carried, doneItems, { completedIds, ranCallIds: new Set() })
    checkFact(
      JSON.stringify(cut.history.slice(0, carried.length)) === JSON.stringify(carried),
      'carried history is byte-identical after the cut',
    )
    checkFact(cut.droppedTexts === 0, 'no complete text is dropped')
    // The cut call was added but never done: unfinished, unconfirmed, and
    // absent from the resumed history, so it never runs.
    checkFact(addedWithoutDone.size === 1, 'exactly the cut call is left unfinished')
    const unfinished = [...addedWithoutDone][0]
    checkFact(
      unfinished !== undefined && !completedIds.has(unfinished),
      'the cut call stays unconfirmed',
    )
    checkFact(
      cut.history.every((item) => item.type !== 'function_call' || item.call_id !== unfinished),
      'the partial call never enters the resumed history',
    )
    checkFact(
      outcomeStatus(null, 'error', null) === 'incomplete-transport',
      'the cut run ends incomplete, never failed',
    )
  },
}
