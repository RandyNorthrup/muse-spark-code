// Observation packing (M73, PLAN.md D49): the pack store, the sticky swap,
// the placeholder, recall paging and the ledger, against long outputs.

import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  MODEL_API_TOOLS,
  MODEL_TEXT,
  OBS_PACK_CHARS_PER_TOKEN,
  OBS_PACK_HEAD_LINES,
  OBS_PACK_PAGE_CHARS,
  OBS_PACK_TAIL_LINES,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import {
  estimatePackTokens,
  ObservationPack,
  RECALL_TOOL_DEFINITION,
  type RecallOutcome,
} from '../../src/core/backends/modelapi/observationPack'
import type { InputItem } from '../../src/core/backends/modelapi/schemas'

const CALL_ID = 'call_big'

/** `count` lines of `width` characters, LF-separated. */
function longText(count: number, width: number): string {
  return Array.from(
    { length: count },
    (_, index) => `line ${String(index)} ${'x'.repeat(width)}`,
  ).join('\n')
}

const BIG = longText(400, 24)

function whole(callId = CALL_ID, output = BIG): InputItem {
  return { type: 'function_call_output', call_id: callId, output }
}

function outputOf(item: InputItem): string {
  if (item.type !== 'function_call_output' || typeof item.output !== 'string') {
    throw new Error('expected a string function output')
  }
  return item.output
}

function recallOk(outcome: RecallOutcome): string {
  expect(outcome.failureReason).toBeUndefined()
  return outcome.output
}

/**
 * `rounds` of a long output sent (the host always projects the replay's
 * whole output, never a placeholder), returning the store and its last
 * projection.
 */
function packedStore(
  rounds = OBS_PACK_WHOLE_SENDS + 1,
  text: string = BIG,
): {
  pack: ObservationPack
  last: InputItem[]
} {
  const pack = new ObservationPack()
  let last: InputItem[] = [whole(CALL_ID, text)]
  for (let round = 0; round < rounds; round += 1) {
    last = pack.project([whole(CALL_ID, text)])
    pack.noteSent(last)
  }
  return { pack, last }
}

describe('estimatePackTokens', () => {
  it('estimates four characters a token, rounded up', () => {
    expect(estimatePackTokens(0)).toBe(0)
    expect(estimatePackTokens(1)).toBe(1)
    expect(estimatePackTokens(OBS_PACK_CHARS_PER_TOKEN)).toBe(1)
    expect(estimatePackTokens(OBS_PACK_CHARS_PER_TOKEN + 1)).toBe(2)
  })
})

describe('ObservationPack.project', () => {
  it('leaves short and non-string outputs alone', () => {
    const pack = new ObservationPack()
    const short: InputItem = { type: 'function_call_output', call_id: 'call_short', output: 'ok' }
    const arrays: InputItem = {
      type: 'function_call_output',
      call_id: 'call_media',
      output: [{ type: 'input_text', text: 'x'.repeat(OBS_PACK_THRESHOLD_CHARS + 1) }],
    }
    const message: InputItem = {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'y'.repeat(OBS_PACK_THRESHOLD_CHARS + 1) }],
    }
    const projected = pack.project([short, arrays, message])
    expect(projected[0]).toBe(short)
    expect(projected[1]).toBe(arrays)
    expect(projected[2]).toBe(message)
    expect(pack.savings()).toBe(0)
  })

  it('never packs a short output, however often it rides', () => {
    const pack = new ObservationPack()
    const short: InputItem = { type: 'function_call_output', call_id: 'call_short', output: 'ok' }
    for (let round = 0; round < OBS_PACK_WHOLE_SENDS + 2; round += 1) {
      const projected = pack.project([short])
      expect(projected[0]).toBe(short)
      pack.noteSent(projected)
    }
    expect(pack.savings()).toBe(0)
  })

  it('packs an output only past the threshold, though a placeholder would be shorter', () => {
    const atThreshold = BIG.slice(0, OBS_PACK_THRESHOLD_CHARS)
    const { pack, last } = packedStore(OBS_PACK_WHOLE_SENDS + 1, atThreshold)
    expect(outputOf(last[0] ?? whole())).toBe(atThreshold)
    expect(pack.savings()).toBe(0)
    const pastThreshold = BIG.slice(0, OBS_PACK_THRESHOLD_CHARS + 1)
    const packed = packedStore(OBS_PACK_WHOLE_SENDS + 1, pastThreshold)
    expect(outputOf(packed.last[0] ?? whole())).not.toBe(pastThreshold)
  })

  it('sends an over-threshold output whole for its first requests, then packs it', () => {
    const pack = new ObservationPack()
    for (let send = 1; send <= OBS_PACK_WHOLE_SENDS; send += 1) {
      const projected = pack.project([whole()])
      expect(outputOf(projected[0] ?? whole())).toBe(BIG)
      pack.noteSent(projected)
      expect(pack.savings()).toBe(0)
    }
    const packed = pack.project([whole()])
    const text = outputOf(packed[0] ?? whole())
    expect(text).not.toBe(BIG)
    expect(pack.isPlaceholder(packed[0] ?? whole())).toBe(true)
    expect(pack.isPlaceholder(whole())).toBe(false)
  })

  it('keeps the swap sticky: once packed, every later request packs', () => {
    const pack = new ObservationPack()
    for (let round = 0; round < OBS_PACK_WHOLE_SENDS + 3; round += 1) {
      const projected = pack.project([whole()])
      pack.noteSent(projected)
    }
    const text = outputOf(pack.project([whole()])[0] ?? whole())
    expect(text).toContain(`"${CALL_ID}"`)
  })

  it('packs each output on its own count', () => {
    const { pack } = packedStore(OBS_PACK_WHOLE_SENDS)
    // An output that arrives later starts its own count: still whole here.
    const projected = pack.project([whole(), whole('call_other')])
    expect(outputOf(projected[0] ?? whole())).not.toBe(BIG)
    expect(outputOf(projected[1] ?? whole())).toBe(BIG)
  })

  it('counts a retried attempt of the same request once', () => {
    const pack = new ObservationPack()
    for (let round = 0; round < OBS_PACK_WHOLE_SENDS - 1; round += 1) {
      const projected = pack.project([whole()])
      // The first attempt and its HTTP retry send the same input.
      pack.noteSent(projected)
      pack.noteSent(projected)
    }
    const still = pack.project([whole()])
    expect(outputOf(still[0] ?? whole())).toBe(BIG)
    pack.noteSent(still)
    const packed = pack.project([whole()])
    expect(outputOf(packed[0] ?? whole())).not.toBe(BIG)
    pack.noteSent(packed)
    const once = pack.savings()
    pack.noteSent(packed)
    expect(pack.savings()).toBe(once)
    expect(once).toBeGreaterThan(0)
  })

  it('counts a projected-but-unsent request as unsent', () => {
    const pack = new ObservationPack()
    for (let round = 0; round < OBS_PACK_WHOLE_SENDS * 2; round += 1) {
      // The hook preview builds the body without sending it.
      pack.project([whole()])
    }
    const projected = pack.project([whole()])
    expect(outputOf(projected[0] ?? whole())).toBe(BIG)
  })
})

describe('the placeholder', () => {
  it('names the id, the size and the first and last lines', () => {
    const { last } = packedStore()
    const text = outputOf(last[0] ?? whole())
    const lines = BIG.split('\n')
    expect(text).toContain(`"${CALL_ID}"`)
    expect(text).toContain(`${String(BIG.length)} characters`)
    expect(text).toContain(`${String(lines.length)} lines`)
    expect(text).toContain(lines[0] ?? '')
    expect(text).toContain(lines[OBS_PACK_HEAD_LINES - 1] ?? '')
    expect(text).toContain(lines.at(-OBS_PACK_TAIL_LINES) ?? '')
    expect(text).toContain(lines.at(-1) ?? '')
  })

  it('shows the edge lines once each and no middle line', () => {
    // Long in the middle, short at the edges: the placeholder keeps all
    // eight edge lines without dropping any.
    const edge = Array.from({ length: OBS_PACK_HEAD_LINES + OBS_PACK_TAIL_LINES }, (_, index) =>
      `edge ${String(index)} ${'x'.repeat(60)}`.slice(0, 70),
    )
    const middle = Array.from(
      { length: 12 },
      (_, index) => `middle ${String(index)} ${'y'.repeat(640)}`,
    )
    const lines = [
      ...edge.slice(0, OBS_PACK_HEAD_LINES),
      ...middle,
      ...edge.slice(OBS_PACK_HEAD_LINES),
    ]
    const text = lines.join('\n')
    expect(text.length).toBeGreaterThan(OBS_PACK_THRESHOLD_CHARS)
    const { last } = packedStore(OBS_PACK_WHOLE_SENDS + 1, text)
    const placeholder = outputOf(last[0] ?? whole())
    for (const line of edge) {
      expect(placeholder.split(line)).toHaveLength(2)
    }
    expect(placeholder).not.toContain(middle[0] ?? '')
  })

  it('stays under the threshold for many long lines', () => {
    const wide = longText(60, 300)
    const { last } = packedStore(OBS_PACK_WHOLE_SENDS + 1, wide)
    expect(outputOf(last[0] ?? whole()).length).toBeLessThanOrEqual(OBS_PACK_THRESHOLD_CHARS)
  })

  it('cuts a single line longer than the threshold, marked', () => {
    const single = 'z'.repeat(OBS_PACK_THRESHOLD_CHARS + 500)
    const { last } = packedStore(OBS_PACK_WHOLE_SENDS + 1, single)
    const text = outputOf(last[0] ?? whole())
    expect(text.length).toBeLessThanOrEqual(OBS_PACK_THRESHOLD_CHARS + 500)
    expect(text).toContain('…')
  })

  it('includes metadata inside the bound for the smallest packable single line', () => {
    const original = 'x'.repeat(OBS_PACK_THRESHOLD_CHARS + 1)
    const { pack, last } = packedStore(OBS_PACK_WHOLE_SENDS + 1, original)
    expect(outputOf(last[0] ?? whole()).length).toBeLessThanOrEqual(OBS_PACK_THRESHOLD_CHARS)
    expect(pack.savings()).toBeGreaterThan(0)
  })

  it('keeps the original when an oversized stable id leaves no smaller placeholder', () => {
    const pack = new ObservationPack()
    const item = whole('id'.repeat(OBS_PACK_THRESHOLD_CHARS), BIG)
    for (let round = 0; round <= OBS_PACK_WHOLE_SENDS; round += 1) {
      const input = pack.project([item])
      expect(input[0]).toBe(item)
      pack.noteSent(input)
    }
    expect(pack.savings()).toBe(0)
  })
})

describe('the savings ledger', () => {
  it('matches the tokens the packed sends left out', () => {
    const { pack } = packedStore(OBS_PACK_WHOLE_SENDS)
    expect(pack.savings()).toBe(0)
    let expected = 0
    for (let send = 0; send < 3; send += 1) {
      const projected = pack.project([whole()])
      const placeholder = outputOf(projected[0] ?? whole())
      expected += estimatePackTokens(BIG.length) - estimatePackTokens(placeholder.length)
      pack.noteSent(projected)
      expect(pack.savings()).toBe(expected)
    }
    expect(expected).toBeGreaterThan(0)
  })

  it('survives a compaction reset while forgetting the originals', () => {
    const { pack } = packedStore()
    const before = pack.savings()
    expect(before).toBeGreaterThan(0)
    pack.reset()
    expect(pack.savings()).toBe(before)
    expect(pack.recall(JSON.stringify({ id: CALL_ID, offset: 0 })).failureReason).toBeDefined()
  })
})

describe('ObservationPack.recall', () => {
  it('refuses what is not JSON, what has no id, and what was never packed', () => {
    const { pack } = packedStore()
    expect(pack.recall('{nope').failureReason).toBe('arguments are not valid JSON')
    expect(pack.recall(JSON.stringify({ offset: 0 })).failureReason).toContain('invalid arguments')
    const unknown = pack.recall(JSON.stringify({ id: 'call_missing', offset: 0 }))
    expect(unknown.failureReason).toBe(
      fill(MODEL_TEXT.packUnknownId, { id: 'call_missing', known: CALL_ID }),
    )
    expect(new ObservationPack().recall(JSON.stringify({ id: 'call_missing' })).failureReason).toBe(
      fill(MODEL_TEXT.packUnknownId, { id: 'call_missing', known: 'none' }),
    )
  })

  it('refuses an offset outside the original', () => {
    const { pack } = packedStore()
    for (const offset of [-1, 1.5, BIG.length, BIG.length + 1]) {
      expect(pack.recall(JSON.stringify({ id: CALL_ID, offset })).failureReason).toBe(
        fill(MODEL_TEXT.packBadOffset, { id: CALL_ID, last: String(BIG.length - 1) }),
      )
    }
  })

  it('pages the original back byte for byte', () => {
    const { pack } = packedStore()
    let offset = 0
    let rebuilt = ''
    let pages = 0
    for (;;) {
      const outcome = pack.recall(JSON.stringify({ id: CALL_ID, offset }))
      const text = recallOk(outcome)
      expect(outcome.visibleOutput).toBe(text)
      const isMiddle = text.includes('call recall_output again')
      const match = /characters (\d+) to (\d+) of (\d+)/.exec(text)
      expect(match?.[1]).toBe(String(offset))
      expect(match?.[3]).toBe(String(BIG.length))
      const page = text.slice(text.indexOf(':\n') + 2)
      rebuilt += page
      pages += 1
      if (!isMiddle) {
        expect(match?.[2]).toBe(String(BIG.length))
        break
      }
      offset = Number(match?.[2])
      expect(pages).toBeLessThan(10)
    }
    expect(rebuilt).toBe(BIG)
  })

  it('ends one page past a page boundary', () => {
    const exact = 'q'.repeat(OBS_PACK_PAGE_CHARS * 2 + 100)
    const { pack } = packedStore(OBS_PACK_WHOLE_SENDS + 1, exact)
    const first = recallOk(pack.recall(JSON.stringify({ id: CALL_ID, offset: 0 })))
    expect(first).toContain(`offset ${String(OBS_PACK_PAGE_CHARS)}`)
    const last = recallOk(
      pack.recall(JSON.stringify({ id: CALL_ID, offset: OBS_PACK_PAGE_CHARS * 2 })),
    )
    expect(last).toContain('end of output')
    expect(last.slice(last.indexOf(':\n') + 2)).toBe('q'.repeat(100))
  })

  it('never splits a character across pages', () => {
    const emoji = `${'a'.repeat(OBS_PACK_PAGE_CHARS - 1)}😀${'b'.repeat(OBS_PACK_PAGE_CHARS)}`
    const { pack } = packedStore(OBS_PACK_WHOLE_SENDS + 1, emoji)
    const first = recallOk(pack.recall(JSON.stringify({ id: CALL_ID, offset: 0 })))
    const firstPage = first.slice(first.indexOf(':\n') + 2)
    expect(firstPage).toBe('a'.repeat(OBS_PACK_PAGE_CHARS - 1))
    expect(first).toContain(`offset ${String(OBS_PACK_PAGE_CHARS - 1)}`)
    const second = recallOk(
      pack.recall(JSON.stringify({ id: CALL_ID, offset: OBS_PACK_PAGE_CHARS - 1 })),
    )
    expect(second.slice(second.indexOf(':\n') + 2)).toBe(`😀${'b'.repeat(OBS_PACK_PAGE_CHARS - 2)}`)
    expect(second).toContain(`offset ${String(2 * OBS_PACK_PAGE_CHARS - 1)}`)
    const last = recallOk(
      pack.recall(JSON.stringify({ id: CALL_ID, offset: 2 * OBS_PACK_PAGE_CHARS - 1 })),
    )
    expect(last).toContain('end of output')
    expect(last.slice(last.indexOf(':\n') + 2)).toBe('bb')
  })

  it('refuses a caller-provided offset inside a surrogate pair', () => {
    const text = `😀${'a'.repeat(OBS_PACK_THRESHOLD_CHARS)}`
    const { pack } = packedStore(OBS_PACK_WHOLE_SENDS + 1, text)
    expect(pack.recall(JSON.stringify({ id: CALL_ID, offset: 1 })).failureReason).toBe(
      fill(MODEL_TEXT.packBadOffset, { id: CALL_ID, last: String(text.length - 1) }),
    )
    const output = recallOk(pack.recall(JSON.stringify({ id: CALL_ID, offset: 2 })))
    expect(output.slice(output.indexOf(':\n') + 2)).toBe('a'.repeat(OBS_PACK_PAGE_CHARS))
  })
})

describe('RECALL_TOOL_DEFINITION', () => {
  it('is the recall_output function the host offers while packing', () => {
    expect(RECALL_TOOL_DEFINITION.type).toBe('function')
    expect(RECALL_TOOL_DEFINITION.name).toBe(MODEL_API_TOOLS.recallOutput)
    expect(RECALL_TOOL_DEFINITION.strict).toBe(false)
    const parameters = z
      .object({ required: z.array(z.string()) })
      .safeParse(RECALL_TOOL_DEFINITION.parameters)
    expect(parameters.success ? parameters.data.required : undefined).toEqual(['id'])
  })
})
