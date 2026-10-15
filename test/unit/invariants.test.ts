// Owner-protected request-shape and savings invariants (SoL-Pi gains,
// 2026-10-04): earlier request bytes never change, extra context goes at the
// tail only, the declared tool list stays byte-stable, packing runs after any
// output rewrite, paid calls share one gate with separate tallies, `then_run`
// is the shell by another name, overflow compaction skips the economics gate,
// and the eval stays comparable. Every test below calls the real module with
// real inputs: no mocks, no fakes, no timers, no loopback provider.

import { describe, expect, it } from 'vitest'
import {
  MODEL_API_TOOLS,
  OBS_PACK_PAGE_CHARS,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
  THEN_RUN_ARGUMENT,
} from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import type { PaidQuote } from '../../src/shared/paid'
import { toolDefinitions } from '../../src/core/backends/modelapi/tools'
import { GOAL_TOOL_DEFINITIONS } from '../../src/core/backends/modelapi/goals'
import {
  instructionsFor,
  type InstructionFacts,
} from '../../src/core/backends/modelapi/instructions'
import { ObservationPack } from '../../src/core/backends/modelapi/observationPack'
import type { InputItem } from '../../src/core/backends/modelapi/schemas'
import { thenRunOf } from '../../src/core/backends/modelapi/verifyTools'
import { AutoCompact, type AutoCompactInput } from '../../src/core/backends/modelapi/autoCompact'
import {
  initialPaidAuthorityState,
  paidAuthorityKey,
  step,
} from '../../src/core/paid/paidAuthority'
import { OBSERVATION_PACKING_ARM } from '../../src/core/eval/mechanisms'
import { evalTasksOfSplit } from '../../src/core/eval/tasks'

function baseFacts(): InstructionFacts {
  return {
    workspaceRoot: '/ws',
    platform: 'linux',
    shellToolName: 'bash',
    shellName: 'bash',
    hasShell: true,
    hasMemory: false,
    hasCodeIntel: false,
    today: '2026-01-01',
    environment: { git: undefined },
    context: { rules: undefined, skills: [], agents: [], memory: [] },
  }
}

describe('invariant 1: earlier request bytes never change, extras append at the tail', () => {
  it('keeps the declared tool list in a fixed order for fixed options', () => {
    const names = toolDefinitions('linux', { hasShell: true, hasSkills: false }).map(
      (tool) => tool.name,
    )
    expect(names).toEqual([
      MODEL_API_TOOLS.readFile,
      MODEL_API_TOOLS.editFile,
      MODEL_API_TOOLS.writeFile,
      MODEL_API_TOOLS.search,
      MODEL_API_TOOLS.listFiles,
      MODEL_API_TOOLS.bash,
      MODEL_API_TOOLS.askUser,
      MODEL_API_TOOLS.todoWrite,
      ...GOAL_TOOL_DEFINITIONS.map((tool) => tool.name),
    ])
  })

  it('adds optional tools without touching the base list around them', () => {
    const base = toolDefinitions('linux', { hasShell: true, hasSkills: false }).map(
      (tool) => tool.name,
    )
    const baseBytes = JSON.stringify(toolDefinitions('linux', { hasShell: true, hasSkills: false }))
    // Same options, same bytes: one session's declared list never drifts.
    expect(JSON.stringify(toolDefinitions('linux', { hasShell: true, hasSkills: false }))).toBe(
      baseBytes,
    )
    for (const options of [
      { hasShell: true, hasSkills: true },
      { hasShell: true, hasSkills: false, hasMemory: true },
      { hasShell: true, hasSkills: false, hasPackedRecall: true },
      { hasShell: true, hasSkills: false, hasWebFetch: true },
    ] as const) {
      const extended = toolDefinitions('linux', { ...options }).map((tool) => tool.name)
      // Every base tool stays, in order; the flag only adds its own entries.
      expect(extended.filter((name) => base.includes(name))).toEqual(base)
      expect(extended.length).toBeGreaterThan(base.length)
    }
  })

  it('serializes a tool definition with stable key order', () => {
    const first = toolDefinitions('linux', { hasShell: true, hasSkills: false })[0]
    expect(first).toBeDefined()
    expect(Object.keys(first!)).toEqual(['type', 'name', 'description', 'parameters', 'strict'])
    expect(Object.keys(first!.parameters)).toEqual([
      'type',
      'properties',
      'required',
      'additionalProperties',
    ])
    const rebuilt = toolDefinitions('linux', { hasShell: true, hasSkills: false })[0]
    expect(JSON.stringify(rebuilt)).toBe(JSON.stringify(first))
  })

  it('offers then_run on the edit tools only with the shell', () => {
    const withShell = toolDefinitions('linux', { hasShell: true, hasSkills: false })
    for (const name of [MODEL_API_TOOLS.editFile, MODEL_API_TOOLS.writeFile]) {
      const tool = withShell.find((candidate) => candidate.name === name)
      expect(tool).toBeDefined()
      expect(tool!.parameters['properties']).toHaveProperty(THEN_RUN_ARGUMENT)
    }
    const withoutShell = toolDefinitions('linux', { hasShell: false, hasSkills: false })
    expect(withoutShell.map((tool) => tool.name)).not.toContain(MODEL_API_TOOLS.bash)
    for (const name of [MODEL_API_TOOLS.editFile, MODEL_API_TOOLS.writeFile]) {
      const tool = withoutShell.find((candidate) => candidate.name === name)
      expect(tool).toBeDefined()
      expect(tool!.parameters['properties']).not.toHaveProperty(THEN_RUN_ARGUMENT)
    }
  })

  it('renders byte-identical instructions for identical facts', () => {
    expect(instructionsFor(baseFacts())).toBe(instructionsFor(baseFacts()))
  })

  it('appends trailing sections without touching earlier instruction bytes', () => {
    const minimal = instructionsFor(baseFacts())
    const withGoal = instructionsFor({ ...baseFacts(), goalSection: 'Ship the fix.' })
    expect(withGoal.startsWith(minimal)).toBe(true)
    const withMap = instructionsFor({ ...baseFacts(), repoMap: 'src/index.ts' })
    expect(withMap.startsWith(minimal)).toBe(true)
  })
})

describe('invariant 2: observation packing keeps what the model saw', () => {
  const CALL_ID = 'call_big_output'
  // Many lines: a placeholder keeps head and tail lines, so the packed form
  // is far shorter than the original.
  const BIG = Array.from(
    { length: 400 },
    (_, index) => `line ${String(index).padStart(3, '0')} ${'x'.repeat(28)} [as-written]`,
  ).join('\n')

  function send(pack: ObservationPack, output: string): InputItem[] {
    const call: InputItem = {
      type: 'function_call',
      call_id: CALL_ID,
      name: 'search',
      arguments: '{}',
    }
    const result: InputItem = { type: 'function_call_output', call_id: CALL_ID, output }
    const projected = pack.project([call, result])
    pack.noteSent(projected)
    return projected
  }

  function outputOf(items: readonly InputItem[]): string {
    const result = items.find(
      (item): item is InputItem & { type: 'function_call_output' } =>
        item.type === 'function_call_output' && item.call_id === CALL_ID,
    )
    expect(result).toBeDefined()
    expect(typeof result!.output).toBe('string')
    return result!.output as string
  }

  it('rides whole for its first sends, then packs, and the swap stays sticky', () => {
    expect(BIG.length).toBeGreaterThan(OBS_PACK_THRESHOLD_CHARS)
    const pack = new ObservationPack()
    for (let sendIndex = 0; sendIndex < OBS_PACK_WHOLE_SENDS; sendIndex += 1) {
      expect(outputOf(send(pack, BIG))).toBe(BIG)
    }
    const packed = outputOf(send(pack, BIG))
    expect(packed).not.toBe(BIG)
    expect(packed.length).toBeLessThan(BIG.length)
    expect(packed).toContain(CALL_ID)
    expect(outputOf(send(pack, BIG))).not.toBe(BIG)
    expect(pack.packedCallIds()).toContain(CALL_ID)
    expect(pack.savings()).toBeGreaterThan(0)
  })

  it('pages the archived original back through recall_output', () => {
    const pack = new ObservationPack()
    for (let sendIndex = 0; sendIndex <= OBS_PACK_WHOLE_SENDS; sendIndex += 1) {
      send(pack, BIG)
    }
    const first = pack.recall(JSON.stringify({ id: CALL_ID, offset: 0 }))
    expect(first.output).toContain(BIG.slice(0, 100))
    expect(first.failureReason).toBeUndefined()
    const later = pack.recall(JSON.stringify({ id: CALL_ID, offset: OBS_PACK_PAGE_CHARS }))
    expect(later.output).toContain(BIG.slice(OBS_PACK_PAGE_CHARS, OBS_PACK_PAGE_CHARS + 100))
    const unknown = pack.recall(JSON.stringify({ id: 'call_missing', offset: 0 }))
    expect(unknown.output.startsWith('Error:')).toBe(true)
    expect(unknown.failureReason).toBeDefined()
  })
})

function paidQuote(id: string, model: string): PaidQuote {
  return {
    id,
    feature: 'webSearch',
    provider: 'meta',
    model,
    modelRevision: 1,
    tariffUsd: Usd.from('0.05').toAmount(),
    unit: 'search',
    capturedAt: 0,
  }
}

describe('invariant 3: paid calls share one gate and tally separately', () => {
  it('asks per key through one reducer while each claim settles its own tally', () => {
    const searchA = paidQuote('q-a', 'muse-spark-1.3')
    const searchB = paidQuote('q-b', 'muse-spark-1.4')
    expect(paidAuthorityKey(searchA)).not.toBe(paidAuthorityKey(searchB))
    let state = initialPaidAuthorityState()
    state = step(state, {
      type: 'day',
      day: '2026-01-01',
      capUsd: Usd.from('1').toAmount(),
      spentUsd: Usd.from(0).toAmount(),
    }).state

    const first = step(state, { type: 'quote', quote: searchA, generation: 'g1', ask: true })
    state = first.state
    expect(first.effects.some((effect) => effect.type === 'ask')).toBe(true)
    state = step(state, {
      type: 'answer',
      grant: { generation: 'g1', quote: searchA },
      answer: 'once',
    }).state

    // The grant for A never answers B: a different key still asks.
    const second = step(state, { type: 'quote', quote: searchB, generation: 'g1', ask: true })
    state = second.state
    expect(second.effects.some((effect) => effect.type === 'ask')).toBe(true)
    state = step(state, {
      type: 'answer',
      grant: { generation: 'g1', quote: searchB },
      answer: 'deny',
    }).state

    // A denied quote cannot reserve: only the approved key spends.
    expect(() =>
      step(state, {
        type: 'reserve',
        claimId: 'claim-b',
        quote: searchB,
        reservedUsd: Usd.from('0.05').toAmount(),
      }),
    ).toThrow()
    state = step(state, {
      type: 'reserve',
      claimId: 'claim-a1',
      quote: searchA,
      reservedUsd: Usd.from('0.05').toAmount(),
    }).state
    const settledOnce = step(state, {
      type: 'settle',
      claimId: 'claim-a1',
      returnedCalls: 2,
      isTerminal: true,
    })
    state = settledOnce.state
    expect(settledOnce.effects.some((effect) => effect.type === 'settled')).toBe(true)
    const afterFirst = state.settledUsd
    expect(Usd.from(afterFirst).compare(Usd.from(0))).toBeGreaterThan(0)

    state = step(state, {
      type: 'reserve',
      claimId: 'claim-a2',
      quote: searchA,
      reservedUsd: Usd.from('0.05').toAmount(),
    }).state
    state = step(state, {
      type: 'settle',
      claimId: 'claim-a2',
      returnedCalls: 4,
      isTerminal: true,
    }).state
    expect(Usd.from(state.settledUsd).compare(Usd.from(afterFirst))).toBeGreaterThan(0)
    expect(state.claims.has('claim-a1')).toBe(true)
    expect(state.claims.has('claim-a2')).toBe(true)
  })
})

describe('invariant 4: then_run is the shell by another name', () => {
  it('parses one command line and never silently drops a present value', () => {
    expect(thenRunOf('{}')).toEqual({ kind: 'absent' })
    expect(thenRunOf(JSON.stringify({ [THEN_RUN_ARGUMENT]: '  npm test  ' }))).toEqual({
      kind: 'run',
      command: 'npm test',
    })
    // Present but unusable is reported, never dropped.
    expect(thenRunOf(JSON.stringify({ [THEN_RUN_ARGUMENT]: 5 }))).toEqual({ kind: 'invalid' })
    expect(thenRunOf(JSON.stringify({ [THEN_RUN_ARGUMENT]: ' '.repeat(3) }))).toEqual({
      kind: 'absent',
    })
  })
})

function compactInput(): AutoCompactInput {
  return {
    pricing: {
      kind: 'priced',
      card: { input: 1.25, cachedInput: 0.15, output: 4.25, source: 'catalogue' },
    },
    contextTokens: 1000,
    windowTokens: 100_000,
    removableTokens: 500,
    summaryTokens: 100,
    summaryInputTokens: 1000,
    summaryOutputTokens: 100,
    summaryRequests: 2,
    cachedTokens: 0,
  }
}

describe('invariant 5: overflow compaction skips the economics gate', () => {
  it('refuses the economics case but compacts on overflow', () => {
    const compact = new AutoCompact()
    expect(compact.decide(compactInput(), false)).toBeUndefined()
    const decision = compact.decide(compactInput(), true)
    expect(decision?.reason).toBe('overflow')
  })

  it('keeps a failure refusal scoped: new tool work reopens overflow', () => {
    const compact = new AutoCompact()
    compact.failed()
    expect(compact.decide(compactInput(), true)).toBeUndefined()
    compact.noteToolWork()
    expect(compact.decide(compactInput(), true)?.reason).toBe('overflow')
  })
})

describe('invariant 6: the eval stays comparable', () => {
  it('records the packing arm in the arm description with live numbers', () => {
    expect(OBSERVATION_PACKING_ARM.name).toBe('packing')
    expect(OBSERVATION_PACKING_ARM.mechanism).toContain(String(OBS_PACK_THRESHOLD_CHARS))
    expect(OBSERVATION_PACKING_ARM.mechanism).toContain(String(OBS_PACK_WHOLE_SENDS))
  })

  it('keeps a fixed task set per split', () => {
    const accept = evalTasksOfSplit('accept')
    const heldout = evalTasksOfSplit('heldout')
    expect(accept.length).toBeGreaterThan(0)
    expect(heldout.length).toBeGreaterThan(0)
    expect(accept.every((task) => task.split === 'accept')).toBe(true)
    expect(heldout.every((task) => task.split === 'heldout')).toBe(true)
    const acceptIds = new Set(accept.map((task) => task.id))
    expect(acceptIds.size).toBe(accept.length)
    expect(heldout.every((task) => !acceptIds.has(task.id))).toBe(true)
    expect(evalTasksOfSplit('accept').map((task) => task.id)).toEqual([...acceptIds])
  })
})
