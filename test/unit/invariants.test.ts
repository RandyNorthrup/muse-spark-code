// Owner-protected request-shape and savings invariants (SoL-Pi gains,
// 2026-10-04): earlier request bytes never change, extra context goes at the
// tail only, the declared tool list stays byte-stable, packing runs after any
// output rewrite, paid calls share one gate with separate tallies, `then_run`
// is the shell by another name, overflow compaction skips the economics gate,
// and the eval stays comparable. Every test below calls the real module with
// real inputs: no mocks, no fakes, no timers, no loopback provider.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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
import {
  instructionsFor,
  type InstructionFacts,
} from '../../src/core/backends/modelapi/instructions'
import {
  ObservationPack,
  estimatePackTokens,
} from '../../src/core/backends/modelapi/observationPack'
import { withStrictTools, type InputItem } from '../../src/core/backends/modelapi/schemas'
import { promptCacheKey } from '../../src/core/backends/modelapi/promptCache'
import { toolMatcherNames } from '../../src/core/backends/modelapi/hookNames'
import { authorizeThenGuard } from '../../src/core/backends/modelapi/verifyLoop'
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
    // Literal wire names, not the constants that produce them: renaming a
    // tool changes every request's prefix, so the rename must fail here.
    expect(names).toEqual([
      'read_file',
      'edit_file',
      'write_file',
      'search',
      'list_files',
      'bash',
      'ask_user',
      'todo_write',
      'create_goal',
      'get_goal',
      'update_goal',
      'report_progress',
    ])
  })

  it('adds optional tools without touching the base list around them', () => {
    const baseTools = toolDefinitions('linux', { hasShell: true, hasSkills: false })
    const base = baseTools.map((tool) => tool.name)
    const baseBytes = JSON.stringify(baseTools)
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
      const extendedTools = toolDefinitions('linux', { ...options })
      const extended = extendedTools.map((tool) => tool.name)
      // Every base tool stays, in order; the flag only adds its own entries.
      expect(extended.filter((name) => base.includes(name))).toEqual(base)
      expect(extended.length).toBeGreaterThan(base.length)
      // And each base tool's own bytes stay: a flag that rewrote a base
      // description or parameter would change the request prefix.
      for (const baseTool of baseTools) {
        const kept = extendedTools.find((tool) => tool.name === baseTool.name)
        expect(JSON.stringify(kept)).toBe(JSON.stringify(baseTool))
      }
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
    // Both trailing sections, in the host's arrival order (the repo map is
    // loaded before a turn's prompt is built; a goal can start later):
    // adding the goal after the map still only appends.
    const withBoth = instructionsFor({
      ...baseFacts(),
      repoMap: 'src/index.ts',
      goalSection: 'Ship the fix.',
    })
    expect(withBoth.startsWith(withMap)).toBe(true)
    expect(withBoth.endsWith('Ship the fix.')).toBe(true)
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

  it('pins the packing thresholds the savings come from', () => {
    // Literal numbers, not the constants read back: raising the whole-send
    // count or the threshold quietly spends the savings on every request,
    // so a deliberate change must update this test and say why.
    expect(OBS_PACK_WHOLE_SENDS).toBe(2)
    expect(OBS_PACK_THRESHOLD_CHARS).toBe(8000)
    expect(OBS_PACK_PAGE_CHARS).toBe(4000)
  })

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
    // The ledger counts exactly what the two packed sends left out.
    expect(pack.savings()).toBe(
      2 * (estimatePackTokens(BIG.length) - estimatePackTokens(packed.length)),
    )
  })

  it('does not count a retried send of the same request twice', () => {
    const pack = new ObservationPack()
    const call: InputItem = {
      type: 'function_call',
      call_id: CALL_ID,
      name: 'search',
      arguments: '{}',
    }
    const result: InputItem = { type: 'function_call_output', call_id: CALL_ID, output: BIG }
    const projected = pack.project([call, result])
    pack.noteSent(projected)
    pack.noteSent(projected)
    // One real send so far: the output still rides whole.
    expect(outputOf(send(pack, BIG))).toBe(BIG)
  })

  it('keeps the swap sticky across a resume and forgets it after a reset', () => {
    const call: InputItem = {
      type: 'function_call',
      call_id: CALL_ID,
      name: 'search',
      arguments: '{}',
    }
    const result: InputItem = { type: 'function_call_output', call_id: CALL_ID, output: BIG }
    const resumed = new ObservationPack()
    resumed.restorePackedCallIds([CALL_ID], [call, result])
    // A resumed session packs from its first request, not after whole sends.
    expect(outputOf(resumed.project([call, result]))).not.toBe(BIG)
    expect(resumed.recall(JSON.stringify({ id: CALL_ID, offset: 0 })).failureReason).toBeUndefined()
    resumed.reset()
    const forgotten = resumed.recall(JSON.stringify({ id: CALL_ID, offset: 0 }))
    expect(forgotten.output.startsWith('Error:')).toBe(true)
    expect(forgotten.failureReason).toBeDefined()
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
    const tail = pack.recall(JSON.stringify({ id: CALL_ID, search: 'line 399' }))
    expect(tail.output).toContain('line 399')
    expect(tail.failureReason).toBeUndefined()
    const unknown = pack.recall(JSON.stringify({ id: 'call_missing', offset: 0 }))
    expect(unknown.output.startsWith('Error:')).toBe(true)
    expect(unknown.failureReason).toBeDefined()
  })
})

function paidQuote(id: string, model: string, tariff = '0.05'): PaidQuote {
  return {
    id,
    feature: 'webSearch',
    provider: 'meta',
    model,
    modelRevision: 1,
    tariffUsd: Usd.from(tariff).toAmount(),
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
    // The reducer mirrors the day's cap and spend for the host's budget
    // wiring; the cap itself is refused by the budget journal's claim
    // check, not here (see the certification record).
    expect(state.days.get('2026-01-01')).toEqual({
      capUsd: Usd.from('1').toAmount(),
      spentUsd: Usd.from(0).toAmount(),
    })

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
    // Each claim keeps its own tally: 2 calls and 4 calls at the same tariff.
    expect(state.claims.get('claim-a1')?.settlement?.costUsd).toBe(Usd.from('0.10').toAmount())
    expect(state.claims.get('claim-a2')?.settlement?.costUsd).toBe(Usd.from('0.20').toAmount())
    expect(state.settledUsd).toBe(Usd.from('0.30').toAmount())

    // A claim settled in stages counts each stage's delta once, never the
    // running total again.
    state = step(state, {
      type: 'reserve',
      claimId: 'claim-a3',
      quote: searchA,
      reservedUsd: Usd.from('0.15').toAmount(),
    }).state
    state = step(state, {
      type: 'settle',
      claimId: 'claim-a3',
      returnedCalls: 1,
      isTerminal: false,
    }).state
    expect(state.settledUsd).toBe(Usd.from('0.35').toAmount())
    state = step(state, {
      type: 'settle',
      claimId: 'claim-a3',
      returnedCalls: 3,
      isTerminal: true,
    }).state
    expect(state.claims.get('claim-a3')?.settlement?.costUsd).toBe(Usd.from('0.15').toAmount())
    expect(state.settledUsd).toBe(Usd.from('0.45').toAmount())

    // Revoking the key ends its authority: nothing under it reserves again.
    state = step(state, {
      type: 'revoke',
      key: paidAuthorityKey(searchA),
      generation: 'g2',
    }).state
    expect(() =>
      step(state, {
        type: 'reserve',
        claimId: 'claim-a4',
        quote: searchA,
        reservedUsd: Usd.from('0.05').toAmount(),
      }),
    ).toThrow()
  })

  it('asks again when the price rises under a saved grant for the same key', () => {
    const cheap = paidQuote('q-cheap', 'muse-spark-1.3', '0.05')
    let state = initialPaidAuthorityState()
    state = step(state, { type: 'quote', quote: cheap, generation: 'g1', ask: true }).state
    state = step(state, {
      type: 'answer',
      grant: { generation: 'g1', quote: cheap },
      answer: 'always',
    }).state
    state = step(state, {
      type: 'saved',
      grant: { generation: 'g1', quote: cheap },
      ok: true,
    }).state

    // Same key, same price: the saved grant answers, no question.
    const samePrice = paidQuote('q-same', 'muse-spark-1.3', '0.05')
    const quiet = step(state, {
      type: 'quote',
      quote: samePrice,
      generation: 'g1',
      grant: { generation: 'g1', quote: cheap },
      ask: false,
    })
    expect(quiet.effects.some((effect) => effect.type === 'ask')).toBe(false)

    // Same key, higher price: the person is asked again before any spend.
    const dearer = paidQuote('q-dearer', 'muse-spark-1.3', '0.10')
    expect(paidAuthorityKey(dearer)).toBe(paidAuthorityKey(cheap))
    const asked = step(quiet.state, {
      type: 'quote',
      quote: dearer,
      generation: 'g1',
      grant: { generation: 'g1', quote: cheap },
      ask: false,
    })
    expect(asked.effects.some((effect) => effect.type === 'ask')).toBe(true)
    expect(() =>
      step(asked.state, {
        type: 'reserve',
        claimId: 'claim-dearer',
        quote: dearer,
        reservedUsd: Usd.from('0.10').toAmount(),
      }),
    ).toThrow()
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

  it('names the shell to imported hooks under every alias they match', () => {
    // Literal aliases: a hook imported from another agent matches `Bash`
    // or `shell`, and then_run reaches it only under those names.
    expect(toolMatcherNames('bash')).toEqual(['bash', 'Bash', 'shell'])
    expect(toolMatcherNames('powershell')).toEqual(['powershell', 'Bash', 'shell'])
  })

  it('authorizes before the as-edited guard, and again when a rule lapses', async () => {
    let authorizations = 0
    const allowed = await authorizeThenGuard({
      isRuleLapsed: () => false,
      authorize: () => {
        authorizations += 1
        return Promise.resolve(undefined)
      },
      guard: () => Promise.resolve(true),
    })
    expect(allowed).toBeUndefined()
    expect(authorizations).toBe(1)

    // A refusal at authorization ends it: the guard never runs.
    let guardRuns = 0
    const refused = await authorizeThenGuard({
      isRuleLapsed: () => false,
      authorize: () => Promise.resolve({ skip: 'refused' as const }),
      guard: () => {
        guardRuns += 1
        return Promise.resolve(true)
      },
    })
    expect(refused).toEqual({ skip: 'refused' })
    expect(guardRuns).toBe(0)

    // The file no longer holding the edit is its own refusal.
    const changed = await authorizeThenGuard({
      isRuleLapsed: () => false,
      authorize: () => Promise.resolve(undefined),
      guard: () => Promise.resolve(false),
    })
    expect(changed).toEqual({ skip: 'changed' })

    // A rule file edited while the guard waited: authorize and guard again.
    let isLapsed = false
    let secondAuthorizations = 0
    let secondGuardRuns = 0
    const relapsed = await authorizeThenGuard({
      isRuleLapsed: () => isLapsed,
      authorize: () => {
        secondAuthorizations += 1
        return Promise.resolve(undefined)
      },
      guard: () => {
        secondGuardRuns += 1
        isLapsed = true
        return Promise.resolve(true)
      },
    })
    expect(relapsed).toBeUndefined()
    expect(secondAuthorizations).toBe(2)
    expect(secondGuardRuns).toBe(2)
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

  it('reopens overflow for a new user task after a failure', () => {
    const compact = new AutoCompact()
    compact.failed()
    expect(compact.decide(compactInput(), true)).toBeUndefined()
    compact.newUserTask()
    expect(compact.decide(compactInput(), true)?.reason).toBe('overflow')
  })

  it('still refuses overflow when there is nothing removable to compact', () => {
    const compact = new AutoCompact()
    expect(compact.decide({ ...compactInput(), removableTokens: 0 }, true)).toBeUndefined()
    expect(compact.decide({ ...compactInput(), contextTokens: -1 }, true)).toBeUndefined()
  })
})

describe('invariant 6: the eval stays comparable', () => {
  it('records the packing arm in the arm description with live numbers', () => {
    expect(OBSERVATION_PACKING_ARM.name).toBe('packing')
    // Literal numbers: the mechanism text is built from the same constants,
    // so reading them back would pass at any value. A threshold change
    // makes old and new eval runs incomparable and must fail here.
    expect(OBSERVATION_PACKING_ARM.mechanism).toContain('8000 characters')
    expect(OBSERVATION_PACKING_ARM.mechanism).toContain('whole for 2 requests')
    expect(OBSERVATION_PACKING_ARM.change).toBeDefined()
  })

  it('keeps a fixed task set per split', () => {
    const accept = evalTasksOfSplit('accept')
    const heldout = evalTasksOfSplit('heldout')
    // The literal task ids: adding, dropping or renaming a task changes
    // what an eval score means, so it must be a deliberate, recorded edit.
    expect(accept.map((task) => task.id)).toEqual([
      'accept-off-by-one',
      'accept-null-guard',
      'accept-await-read',
      'accept-import-path',
      'accept-no-secret',
      'accept-empty-average',
      'accept-long-middle-value',
    ])
    expect(heldout.map((task) => task.id)).toEqual([
      'heldout-strict-equal',
      'heldout-clear-timer',
      'heldout-sort-numbers',
      'heldout-await-write',
      'heldout-long-middle-rule',
    ])
    expect(accept.every((task) => task.split === 'accept')).toBe(true)
    expect(heldout.every((task) => task.split === 'heldout')).toBe(true)
    const acceptIds = new Set(accept.map((task) => task.id))
    expect(acceptIds.size).toBe(accept.length)
    expect(heldout.every((task) => !acceptIds.has(task.id))).toBe(true)
    expect(evalTasksOfSplit('accept').map((task) => task.id)).toEqual([...acceptIds])
  })
})

const goldenFileSchema = z.object({ scenario: z.string(), requests: z.array(z.string()) })
const goldenBodySchema = z.object({
  model: z.string(),
  instructions: z.string(),
  tools: z.array(z.unknown()),
  tool_choice: z.string(),
  reasoning: z.object({ effort: z.string(), summary: z.string().optional() }),
  stream: z.boolean(),
  store: z.boolean(),
  include: z.array(z.string()),
  max_output_tokens: z.number(),
  prompt_cache_key: z.string(),
  prompt_cache_retention: z.string(),
})

function goldenRequests(relativePath: string): readonly string[] {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../fixtures/golden-requests/${relativePath}`, import.meta.url), 'utf8'),
  )
  return goldenFileSchema.parse(raw).requests
}

function goldenTurn(
  file: string,
  tools: ReturnType<typeof toolDefinitions> | ReturnType<typeof withStrictTools>,
) {
  const body = goldenBodySchema.parse(JSON.parse(goldenRequests(file)[0]!) as unknown)
  const instructions = instructionsFor({ ...baseFacts(), today: '1970-01-01' })
  expect(JSON.stringify(body.tools)).toBe(JSON.stringify(tools))
  expect(body.instructions).toBe(instructions)
  expect(body.prompt_cache_key).toBe(
    promptCacheKey({ model: 'muse-spark-1.3', instructions, tools }),
  )
  return body
}

describe('invariant 7: golden request bytes with new features off', () => {
  // The host's body assembly order (ModelApiHost.body + keyed), pinned as
  // literals: it is the order JSON.stringify sends on the Meta path.
  const BODY_KEYS = [
    'model',
    'input',
    'instructions',
    'tools',
    'tool_choice',
    'reasoning',
    'stream',
    'store',
    'include',
    'max_output_tokens',
    'prompt_cache_key',
    'prompt_cache_retention',
  ]

  it('keeps every recorded golden request in the sent key order', () => {
    const directory = fileURLToPath(new URL('../fixtures/golden-requests/', import.meta.url))
    const files = [
      ...readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => name),
      ...readdirSync(path.join(directory, 'strict'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => `strict/${name}`),
    ]
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      for (const request of goldenRequests(file)) {
        const parsed: unknown = JSON.parse(request)
        expect(Object.keys(z.record(z.string(), z.unknown()).parse(parsed))).toEqual(BODY_KEYS)
      }
    }
  })

  it('reproduces the plain golden turn from the real modules', () => {
    const body = goldenTurn(
      '01-plain-turn.json',
      toolDefinitions('linux', { hasShell: true, hasSkills: false }),
    )
    expect(body.model).toBe('muse-spark-1.3')
    expect(body.tool_choice).toBe('auto')
    expect(body.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    expect(body.stream).toBe(true)
    expect(body.store).toBe(false)
    expect(body.include).toEqual(['reasoning.encrypted_content'])
    expect(body.max_output_tokens).toBe(32_768)
    expect(body.prompt_cache_retention).toBe('in_memory')
  })

  it('reproduces the strict golden tools from the real strict conversion', () => {
    goldenTurn(
      'strict/01-plain-turn.json',
      withStrictTools(toolDefinitions('linux', { hasShell: true, hasSkills: false }), true),
    )
  })
})
