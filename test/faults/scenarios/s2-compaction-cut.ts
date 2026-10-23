// S2: a model stream cut mid-compaction (M110r Y4). The compaction
// request's stream dies a third of the way through. The conversation is
// not changed until a validated summary replaces the compacted range in
// one step, so the cut applies nothing: the carried history comes back
// byte-identical and the partial summary is dropped, never half-applied.
import { resumeFromCut } from '../../../src/core/backends/modelapi/resume'
import {
  streamEventSchema,
  type InputItem,
  type OutputItem,
} from '../../../src/core/backends/modelapi/schemas'
import { parseSse } from '../../../src/core/backends/modelapi/sse'
import {
  checkFact,
  loadRecordedStream,
  readSocketChunks,
  serveAndCut,
} from '../../../scripts/lib/faultRig.mjs'
import type { FaultScenario } from '../scenario'

export const scenario: FaultScenario = {
  name: 's2-compaction-cut',
  needs: 'loopback',
  run: async (repoRoot: string): Promise<void> => {
    const { bytes } = await loadRecordedStream(repoRoot)
    const cutAt = Math.floor(bytes.length / 3)
    const cutter = await serveAndCut(bytes, cutAt)
    const doneItems: OutputItem[] = []
    const completedIds = new Set<string>()
    try {
      const stream = parseSse(readSocketChunks(cutter.port))
      for await (const entry of stream) {
        let data: unknown
        try {
          data = JSON.parse(entry.data)
        } catch {
          break // the cut's partial tail: incomplete by construction
        }
        const parsed = streamEventSchema.safeParse(data)
        if (!parsed.success) continue
        const validated = parsed.data
        if (validated.type !== 'response.output_item.done') continue
        const item = validated.item
        doneItems.push(item)
        const id = 'id' in item && typeof item.id === 'string' ? item.id : undefined
        if (id !== undefined) completedIds.add(id)
      }
    } finally {
      await cutter.close()
    }
    // The pre-compaction conversation a cut compaction must leave alone.
    const carried: InputItem[] = [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first' }] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'second' }],
      },
      {
        type: 'function_call',
        id: 'f-old',
        call_id: 'c-old',
        name: 'read',
        arguments: '{"path":"x"}',
      },
    ]
    const carriedJson = JSON.stringify(carried)
    const cut = resumeFromCut(carried, doneItems, { completedIds, ranCallIds: new Set(['c-old']) })
    checkFact(
      JSON.stringify(cut.history.slice(0, carried.length)) === carriedJson,
      'a cut compaction changes nothing until a validated summary applies',
    )
    checkFact(
      JSON.stringify(carried) === carriedJson,
      'the carried history itself is untouched by the resume',
    )
  },
}
