// M125 lane M (D107): the Model API request goldens. The fast judge's
// effects on a request are pinned byte for byte: the tail message, the
// effort field, the triaged placeholder and the keep-list. Off and
// on-but-abstaining send today's bytes; the red drill forces one
// decision and watches the bytes change.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ObservationPack } from '../../src/core/backends/modelapi/observationPacking'
import { functionCallItemSchema, restoredToolText } from '../../src/core/backends/modelapi/schemas'
import type {
  BoundedToolText,
  FunctionCallItem,
  InputItem,
} from '../../src/core/backends/modelapi/schemas'
import {
  doneTailNote,
  failureTailHint,
  loopTailNote,
  lowerEffortLevel,
  rankedKeepIds,
  tailNotes,
  triageRoute,
} from '../../src/core/judge/fast/apply'
import { ruleEffort } from '../../src/core/judge/fast/reflex/effort'
import { triageOutput } from '../../src/core/judge/fast/reflex/triage'
import { JUDGE_FAST_KEEP_ENTRIES } from '../../src/shared/constants'

const goldenCallAndOutput = (): {
  readonly call: FunctionCallItem
  readonly output: BoundedToolText
} => {
  const goldenFile = z
    .object({ requests: z.array(z.string()) })
    .parse(
      JSON.parse(
        readFileSync(
          new URL('../fixtures/golden-requests/04-packed-output.json', import.meta.url),
          'utf8',
        ),
      ),
    )
  const request = z
    .object({ input: z.array(z.unknown()) })
    .parse(JSON.parse(goldenFile.requests[1] ?? ''))
  const call = request.input
    .map((item) => functionCallItemSchema.safeParse(item))
    .find((result) => result.success)
  if (!call?.success) throw new Error('no recorded function call in 04-packed-output.json')
  const fixtureItemSchema = z.object({
    type: z.string(),
    call_id: z.string().optional(),
    output: z.unknown().optional(),
  })
  const output = request.input
    .map((item) => fixtureItemSchema.safeParse(item))
    .find(
      (result) =>
        result.success &&
        result.data.type === 'function_call_output' &&
        result.data.call_id === call.data.call_id,
    )
  const text = output?.success === true ? output.data.output : undefined
  if (typeof text !== 'string') throw new TypeError('recorded output is not a string')
  return { call: call.data, output: restoredToolText(text) }
}

const outputOf = (items: readonly InputItem[], callId: string): string => {
  const result = items.find(
    (item): item is InputItem & { type: 'function_call_output' } =>
      item.type === 'function_call_output' && item.call_id === callId,
  )
  if (result === undefined) throw new Error(`missing function_call_output for ${callId}`)
  if (typeof result.output !== 'string')
    throw new TypeError(`function_call_output for ${callId} is not a string`)
  return result.output
}

describe('Model API request goldens', () => {
  it('pins the tail message a queued note sends', () => {
    const [note] = tailNotes([loopTailNote('repeat', 'shell')])
    if (note === undefined) throw new Error('a queued note drains to one message')
    const item: InputItem = {
      type: 'message',
      role: note.role,
      content: [{ type: 'input_text', text: note.text }],
    }
    expect(JSON.stringify(item)).toBe(
      '{"type":"message","role":"developer","content":[{"type":"input_text","text":"The last three shell calls repeat the same call with the same result; try a different approach before calling it again."}]}',
    )
    expect(doneTailNote()).toBe(
      "The request's checks already passed; no further verification rounds are needed.",
    )
    expect(failureTailHint('shell')).toBe(
      'The last shell run reported a failure the reply does not mention; address it before continuing.',
    )
  })

  it('sends no tail message with the switch off or every decision abstaining', () => {
    expect(tailNotes([])).toEqual([])
  })

  it('lowers effort one level on the model scale, and keeps it on a miss', () => {
    const levels = ['minimal', 'low', 'medium', 'high']
    const request = (text: string): string => {
      const verdict = ruleEffort({ request: text, filesTouched: 1 })
      return verdict.decision === 'lower' ? lowerEffortLevel('medium', levels) : 'medium'
    }
    expect(request('rename this variable')).toBe('low')
    expect(request('redesign the cache')).toBe('medium')
    expect(lowerEffortLevel('minimal', levels)).toBe('minimal')
  })

  it('packs a triaged output on its first send through M73’s own placeholder', () => {
    const recorded = goldenCallAndOutput()
    expect(recorded.output.length).toBeGreaterThan(8000)
    const pack = new ObservationPack()
    pack.markEarly(recorded.call.call_id)
    const projected = pack.project([
      recorded.call,
      {
        type: 'function_call_output',
        call_id: recorded.call.call_id,
        output: recorded.output,
      },
    ])
    const packed = outputOf(projected, recorded.call.call_id)
    expect(packed).not.toBe(recorded.output)
    // M73's own placeholder, byte for byte: the triage mark only moves
    // its first send earlier.
    expect(packed).toBe(
      'Packed output "c1" (13407 characters, 401 lines, about 3352 tokens): sent whole before, packed to save context. Its first 4 and last 4 lines:\nRead text file `big.txt`.\n1|line 0 xxxxxxxxxxxxxxxxxxxx\n2|line 1 xxxxxxxxxxxxxxxxxxxx\n3|line 2 xxxxxxxxxxxxxxxxxxxx\n[…]\n397|line 396 xxxxxxxxxxxxxxxxxxxx\n398|line 397 xxxxxxxxxxxxxxxxxxxx\n399|line 398 xxxxxxxxxxxxxxxxxxxx\n400|line 399 xxxxxxxxxxxxxxxxxxxx\nCall recall_output with id "c1" and an offset to page the original back.',
    )
  })

  it('rides an untriaged output whole, exactly as today', () => {
    const recorded = goldenCallAndOutput()
    const pack = new ObservationPack()
    const projected = pack.project([
      recorded.call,
      {
        type: 'function_call_output',
        call_id: recorded.call.call_id,
        output: recorded.output,
      },
    ])
    expect(outputOf(projected, recorded.call.call_id)).toBe(recorded.output)
  })

  it('routes a miss whole with its reason, and packs only a skip', () => {
    expect(triageRoute({ decision: 'miss' }, 'none', false)).toEqual({
      action: 'whole',
      unasked: 'no-window',
    })
    expect(triageRoute(triageOutput({ exitCode: 0, output: '  \n' }), 'none', false)).toEqual({
      action: 'pack',
    })
  })

  it('keeps relevance-ranked entries past the tail, up to the keep bound', () => {
    expect(JUDGE_FAST_KEEP_ENTRIES).toBe(3)
    const ranked = rankedKeepIds('vitest failure output', [
      { id: 'a', text: 'the vitest run and its failure output' },
      { id: 'b', text: 'unrelated gardening notes' },
      { id: 'c', text: 'vitest output tail with the failure lines' },
      { id: 'd', text: 'more vitest failure output detail here' },
    ])
    expect(ranked).toEqual(['d', 'a', 'c'])
    expect(ranked.slice(0, 3)).toHaveLength(3)
    expect(rankedKeepIds('', [{ id: 'a', text: 'vitest' }])).toEqual([])
  })

  it('red drill: one forced decision changes the request bytes', () => {
    const forced = tailNotes([loopTailNote('oscillation', 'shell')])
    expect(forced).toHaveLength(1)
    expect(forced[0]?.text).toContain('alternate between two calls')
    expect(tailNotes([])).toHaveLength(0)
    expect(lowerEffortLevel('high', ['minimal', 'low', 'medium', 'high'])).toBe('medium')
  })
})
