// Owner-protected request-shape and savings invariants (SoL-Pi gains,
// 2026-10-04): earlier request bytes never change, extra context goes at the
// tail only, the declared tool list stays byte-stable, packing runs after any
// output rewrite, paid calls share one gate with separate tallies, `then_run`
// is the shell by another name, overflow compaction skips the economics gate,
// and the eval stays comparable. Every test below calls the real module;
// every input that names something the outside world sends (provider tariffs
// and models, the recorded harness environment, tool outputs, skill and rule
// files, roster data) comes from the product's own listed records or from the
// recorded M91-G harness capture (`test/fixtures/golden-requests/`, harness
// date 1970-01-01, workspace /ws), never invented. The remaining values are
// the functions' own scenario parameters (ledger days, token counts, the
// approval answers), documented where they are used. No mocks, no fakes, no
// timers, no loopback provider.

import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { removeFolder } from './helpers/temporaryFolders'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MODEL_API_TOOLS,
  MODEL_API_WEB_SEARCH_TOOL,
  OBS_PACK_PAGE_CHARS,
  OBS_PACK_THRESHOLD_CHARS,
  OBS_PACK_WHOLE_SENDS,
  THEN_RUN_ARGUMENT,
} from '../../src/shared/constants'
import { Usd, multiplyUsd, type UsdAmount } from '../../src/shared/usd'
import type { PaidQuote } from '../../src/shared/paid'
import { RULES_PREAMBLE } from '../../src/shared/constants'
import { toolDefinitions, type ToolDefinitionOptions } from '../../src/core/backends/modelapi/tools'
import { restoredToolText } from '../../src/core/backends/modelapi/schemas'
import {
  instructionsFor,
  type InstructionFacts,
} from '../../src/core/backends/modelapi/instructions'
import { builtinAgents } from '../../src/core/context/customAgents'
import { renderRules } from '../../src/core/context/rules'
import { parseSkillFile, type SkillDefinition } from '../../src/core/context/skills'
import { buildStableRosterSection } from '../../src/core/team/roster'
import { TEAM_TOOL_DEFINITIONS } from '../../src/core/team/teamTools'
import { webSearchPriceUsd } from '../../src/core/paid/paidFeatures'
import {
  ObservationPack,
  estimatePackTokens,
} from '../../src/core/backends/modelapi/observationPack'
import {
  functionCallItemSchema,
  withStrictTools,
  type FunctionCallItem,
  type InputItem,
  type ToolDefinition,
} from '../../src/core/backends/modelapi/schemas'
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
import {
  EVAL_TASKS,
  EVAL_VERIFY_PRELUDE,
  evalTaskSchema,
  evalTasksOfSplit,
} from '../../src/core/eval/tasks'

// The recorded M91-G harness environment, as the golden fixtures carry it:
// workspace /ws on linux with the shell, no memory or code-intel tools, not
// a git repository, and the harness date 1970-01-01 (embedded in every
// recorded instructions text as "Today's date: 1970-01-01").
function baseFacts(): InstructionFacts {
  return {
    workspaceRoot: '/ws',
    platform: 'linux',
    shellToolName: 'bash',
    shellName: 'bash',
    hasShell: true,
    hasMemory: false,
    hasCodeIntel: false,
    today: '1970-01-01',
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
  // The oversized tool output is recorded, not generated — and so is its
  // call: the read_file call and result the M91-G harness run carried in
  // scenario 04 (call `c1` on big.txt, 13,407 characters; the
  // `N|line M ...` rendering is the product's own read_file result
  // format, the file content was the harness's big.txt). The recorded call
  // names the tool, which recall reports back as the source, so the pair
  // is taken whole from the fixture rather than re-wrapped by hand.
  const RECORDED = recordedCallAndOutput('04-packed-output.json', 1)
  const CALL_ID = RECORDED.call.call_id
  const BIG = RECORDED.output

  function send(pack: ObservationPack, output: string): InputItem[] {
    const call: InputItem = { ...RECORDED.call }
    const result: InputItem = {
      type: 'function_call_output',
      call_id: CALL_ID,
      output: restoredToolText(output),
    }
    const projected = pack.project([call, result])
    pack.noteSent(projected)
    return projected
  }

  function outputOf(items: readonly InputItem[]): string {
    const result = items.find(
      (item): item is InputItem & { type: 'function_call_output' } =>
        item.type === 'function_call_output' && item.call_id === CALL_ID,
    )
    // Checked narrowing, not a cast: a non-string output fails the test here.
    if (result === undefined) throw new Error(`missing function_call_output for ${CALL_ID}`)
    if (typeof result.output !== 'string')
      throw new Error(`function_call_output for ${CALL_ID} is not a string`)
    return result.output
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
    const call: InputItem = { ...RECORDED.call }
    const result: InputItem = {
      type: 'function_call_output',
      call_id: CALL_ID,
      output: restoredToolText(BIG),
    }
    const projected = pack.project([call, result])
    pack.noteSent(projected)
    pack.noteSent(projected)
    // One real send so far: the output still rides whole.
    expect(outputOf(send(pack, BIG))).toBe(BIG)
  })

  it('keeps the swap sticky across a resume and forgets it after a reset', () => {
    const call: InputItem = { ...RECORDED.call }
    const result: InputItem = {
      type: 'function_call_output',
      call_id: CALL_ID,
      output: restoredToolText(BIG),
    }
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

// Paid quotes name real priced models (`MODEL_API_PRICED_MODELS.standard`:
// muse-spark-1.3 and muse-spark-1.2) at the product's own listed web-search
// tariff (`PAID_PRICES_USD.webSearchPerThousand`, verified 2026-09-24,
// `PAID_PRICES_VERIFIED_ON`), read through the real `webSearchPriceUsd`.
// The id is minted and capturedAt taken exactly as production does them
// (`paidConsent.ts`: a randomUUID per request, the real clock); neither
// reaches an assertion.
function searchTariff(model: string): UsdAmount {
  const tariff = webSearchPriceUsd(model)
  if (tariff === undefined) throw new Error(`no listed web-search tariff for ${model}`)
  return tariff
}

function searchQuote(model: string, tariff: UsdAmount = searchTariff(model)): PaidQuote {
  return {
    id: randomUUID(),
    feature: 'webSearch',
    provider: 'meta',
    model,
    modelRevision: 1,
    tariffUsd: tariff,
    unit: 'search',
    capturedAt: Date.now(),
  }
}

describe('invariant 3: paid calls share one gate and tally separately', () => {
  it('asks per key through one reducer while each claim settles its own tally', () => {
    const searchA = searchQuote('muse-spark-1.3')
    const searchB = searchQuote('muse-spark-1.2')
    const tariff = searchTariff('muse-spark-1.3')
    // Literal anchor on the listed tariff (2.5 per thousand searches): a
    // provider-side price change must fail here and be re-verified, exactly
    // like the packing thresholds above.
    expect(tariff).toBe('0.0025')
    expect(paidAuthorityKey(searchA)).not.toBe(paidAuthorityKey(searchB))
    // The day, cap and spend are the scenario's ledger state (the reducer
    // only mirrors them for the host's budget wiring; the cap itself is
    // refused by the budget journal's claim check, not here — see the
    // certification record).
    let state = initialPaidAuthorityState()
    state = step(state, {
      type: 'day',
      day: '2026-01-01',
      capUsd: Usd.from('1').toAmount(),
      spentUsd: Usd.from(0).toAmount(),
    }).state
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
        reservedUsd: multiplyUsd(tariff, 1),
      }),
    ).toThrow()
    state = step(state, {
      type: 'reserve',
      claimId: 'claim-a1',
      quote: searchA,
      reservedUsd: multiplyUsd(tariff, 2),
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
      reservedUsd: multiplyUsd(tariff, 4),
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
    expect(state.claims.get('claim-a1')?.settlement?.costUsd).toBe(multiplyUsd(tariff, 2))
    expect(state.claims.get('claim-a2')?.settlement?.costUsd).toBe(multiplyUsd(tariff, 4))
    expect(state.settledUsd).toBe(multiplyUsd(tariff, 6))

    // A claim settled in stages counts each stage's delta once, never the
    // running total again.
    state = step(state, {
      type: 'reserve',
      claimId: 'claim-a3',
      quote: searchA,
      reservedUsd: multiplyUsd(tariff, 3),
    }).state
    state = step(state, {
      type: 'settle',
      claimId: 'claim-a3',
      returnedCalls: 1,
      isTerminal: false,
    }).state
    expect(state.settledUsd).toBe(multiplyUsd(tariff, 7))
    state = step(state, {
      type: 'settle',
      claimId: 'claim-a3',
      returnedCalls: 3,
      isTerminal: true,
    }).state
    expect(state.claims.get('claim-a3')?.settlement?.costUsd).toBe(multiplyUsd(tariff, 3))
    expect(state.settledUsd).toBe(multiplyUsd(tariff, 9))

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
        reservedUsd: multiplyUsd(tariff, 1),
      }),
    ).toThrow()
  })

  it('asks again when the price rises under a saved grant for the same key', () => {
    const cheap = searchQuote('muse-spark-1.3')
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
    const samePrice = searchQuote('muse-spark-1.3')
    const quiet = step(state, {
      type: 'quote',
      quote: samePrice,
      generation: 'g1',
      grant: { generation: 'g1', quote: cheap },
      ask: false,
    })
    expect(quiet.effects.some((effect) => effect.type === 'ask')).toBe(false)

    // Same key, higher price: the person is asked again before any spend.
    // The risen tariff is twice the listed one: production re-reads the
    // tariff per request (`ModelApiHost` compares the quote against the
    // current `searchPriceUsd`), so a provider-side rise arrives as a new
    // quote at a higher tariff under the same key.
    const risen = multiplyUsd(searchTariff('muse-spark-1.3'), 2)
    const dearer = searchQuote('muse-spark-1.3', risen)
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
        reservedUsd: risen,
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
    // The authorize closures return the two real user answers (approved,
    // refused); the guard and the lapse check read real files, so a changed
    // file and a lapsed rule below are real edits, not arranged booleans.
    const files = editState()
    let authorizations = 0
    const allowed = await authorizeThenGuard({
      isRuleLapsed: files.isRuleLapsed,
      authorize: () => {
        authorizations += 1
        return Promise.resolve(undefined)
      },
      guard: files.guard,
    })
    expect(allowed).toBeUndefined()
    expect(authorizations).toBe(1)

    // A refusal at authorization ends it: the guard never runs.
    let guardRuns = 0
    const refused = await authorizeThenGuard({
      isRuleLapsed: files.isRuleLapsed,
      authorize: () => Promise.resolve({ skip: 'refused' as const }),
      guard: () => {
        guardRuns += 1
        return files.guard()
      },
    })
    expect(refused).toEqual({ skip: 'refused' })
    expect(guardRuns).toBe(0)

    // The file no longer holding the edit is its own refusal: a real edit
    // lands between authorization and the guard's read.
    files.editFile()
    const changed = await authorizeThenGuard({
      isRuleLapsed: files.isRuleLapsed,
      authorize: () => Promise.resolve(undefined),
      guard: files.guard,
    })
    expect(changed).toEqual({ skip: 'changed' })

    // A rule file edited while the guard waited: authorize and guard again.
    // The guard's own read models the subagent edit landing mid-wait.
    const relapsing = editState()
    let secondAuthorizations = 0
    let secondGuardRuns = 0
    const relapsed = await authorizeThenGuard({
      isRuleLapsed: relapsing.isRuleLapsed,
      authorize: () => {
        secondAuthorizations += 1
        return Promise.resolve(undefined)
      },
      guard: () => {
        secondGuardRuns += 1
        relapsing.editRules()
        return relapsing.guard()
      },
    })
    expect(relapsed).toBeUndefined()
    expect(secondAuthorizations).toBe(2)
    expect(secondGuardRuns).toBe(2)
  })
})

// One real folder per verify-ordering case: the guard reads a real edited
// file ("the file still holds what the edit left") and the lapse check reads
// a real rule file ("a deciding file changed since the user's message").
// Folders are removed after the run by `removeFolder` (with its Windows
// retries); `tmpdir()` honours the machine's TMPDIR.
const verifyFolders: string[] = []
afterAll(async () => {
  for (const folder of verifyFolders) await removeFolder(folder)
})

function editState(): {
  readonly guard: () => Promise<boolean>
  readonly isRuleLapsed: () => boolean
  readonly editFile: () => void
  readonly editRules: () => void
} {
  const folder = mkdtempSync(path.join(tmpdir(), 'invariants-verify-'))
  verifyFolders.push(folder)
  const editedFile = path.join(folder, 'edited.ts')
  const rulesFile = path.join(folder, 'rules.md')
  writeFileSync(editedFile, 'const edited = 1\n')
  writeFileSync(rulesFile, '# Rules\n')
  const messageRules = readFileSync(rulesFile, 'utf8')
  return {
    guard: () => Promise.resolve(readFileSync(editedFile, 'utf8') === 'const edited = 1\n'),
    isRuleLapsed: () => readFileSync(rulesFile, 'utf8') !== messageRules,
    editFile: () => {
      writeFileSync(editedFile, 'const edited = 2\n')
    },
    editRules: () => {
      writeFileSync(rulesFile, '# Rules\n# More\n')
    },
  }
}

// The pricing card repeats Meta's published standard-tier rates
// (`MODEL_API_PRICES_PER_MILLION.standard`, verified 2026-09-26,
// `MODEL_API_PRICES_VERIFIED_ON`) as literals, so a catalogue change that
// moves the economics boundary fails here and is re-verified. The token
// counts are the decision's scenario state: enough context to overflow,
// removable work to compact, and summary costs below the savings.
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

  it('pins the complete task definitions behind a recorded digest', () => {
    // The digest covers every field a score's meaning rests on (prompt,
    // fixture files, verifier, title, isLongOutput) as well as the ids and
    // splits: any edit that changes what a run measures must update this
    // literal deliberately. Key order is the source order of `EVAL_TASKS`,
    // stable across runs; the prelude is digested too because it opens every
    // verifier. Each definition also parses under the real `evalTaskSchema`;
    // the behavioural half (every verifier fails its defect and passes two
    // fix spellings) stays in `test/unit/eval/evalTasks.test.ts`.
    for (const task of EVAL_TASKS) {
      expect(evalTaskSchema.safeParse(task).success).toBe(true)
    }
    const payload = JSON.stringify({ prelude: EVAL_VERIFY_PRELUDE, tasks: EVAL_TASKS })
    // TRAINFIX: the release train measures its own task set (M101/M75 arms
    // main simplified away); e613f70a is main's digest for main's set.
    expect(createHash('sha256').update(payload).digest('hex')).toBe(
      '2606a640921fdec49b0c38a623892fee5c6026c1a24780dd5c4ef75e84854895',
    )
    const accept = evalTasksOfSplit('accept')
    const heldout = evalTasksOfSplit('heldout')
    expect(accept.every((task) => task.split === 'accept')).toBe(true)
    expect(heldout.every((task) => task.split === 'heldout')).toBe(true)
    const acceptIds = new Set(accept.map((task) => task.id))
    expect(acceptIds.size).toBe(accept.length)
    expect(heldout.every((task) => !acceptIds.has(task.id))).toBe(true)
  })
})

const goldenFileSchema = z.object({ scenario: z.string(), requests: z.array(z.string()) })
const goldenBodySchema = z.object({
  model: z.string(),
  input: z.array(z.unknown()),
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

function goldenFiles(): string[] {
  const directory = fileURLToPath(new URL('../fixtures/golden-requests/', import.meta.url))
  return [
    ...readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name),
    ...readdirSync(path.join(directory, 'strict'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => `strict/${name}`),
  ]
}

const fixtureItemSchema = z.object({
  type: z.string(),
  call_id: z.string().optional(),
  output: z.unknown().optional(),
})

/** One recorded tool call and its output from a golden fixture: the first
 * function_call (parsed under the product's own item schema) and the
 * string output of its function_call_output, narrowed by a typeof guard. */
function recordedCallAndOutput(
  relativePath: string,
  requestIndex: number,
): { readonly call: FunctionCallItem; readonly output: string } {
  const raw: unknown = JSON.parse(goldenRequests(relativePath)[requestIndex]!)
  const parsed = z.object({ input: z.array(z.unknown()) }).parse(raw)
  const callItem = parsed.input
    .map((item) => functionCallItemSchema.safeParse(item))
    .find((result) => result.success)
  if (!callItem?.success)
    throw new Error(`no recorded function call in ${relativePath} request ${String(requestIndex)}`)
  const call = callItem.data
  const outputItem = parsed.input
    .map((item) => fixtureItemSchema.safeParse(item))
    .find(
      (result) =>
        result.success &&
        result.data.type === 'function_call_output' &&
        result.data.call_id === call.call_id,
    )
  const output = outputItem?.success === true ? outputItem.data.output : undefined
  if (typeof output !== 'string')
    throw new Error(
      `no recorded string tool output in ${relativePath} request ${String(requestIndex)}`,
    )
  return { call, output }
}

interface GoldenPrefix {
  readonly options: ToolDefinitionOptions
  readonly facts: (base: InstructionFacts) => InstructionFacts
  /** The host appends the hosted-search tool when paid web search is
   * offered (`ModelApiHost`: `isWebSearchOffered`). */
  readonly hostedSearch?: boolean
}

interface GoldenScenario {
  readonly file: string
  /** One reproduced prefix per recorded request, in request order. */
  readonly prefixes: readonly GoldenPrefix[]
}

function shoutSkill(): SkillDefinition {
  // The harness workspace's skill file, as the deleted M91-G harness wrote
  // it (`skillFile('shout', 'Repeat in caps', 'UPPER CASE.')`): parsed by the
  // real `parseSkillFile`, so only the file bytes are recorded and the
  // definition itself is product-built. The file lived under
  // `.agents/skills/shout/`, hence the project source.
  const parsed = parseSkillFile(
    '---\nname: shout\ndescription: Repeat in caps\n---\n\nUPPER CASE.\n',
  )
  if (!parsed.ok) throw new Error(`the recorded shout skill does not parse: ${parsed.reason}`)
  return { id: 'shout', source: 'project', ...parsed.skill }
}

function skillsRulesFacts(base: InstructionFacts): InstructionFacts {
  // The harness workspace's AGENTS.md (`End every reply with PINEAPPLE.`,
  // as the deleted M91-G harness wrote it), rendered by the real
  // `renderRules` under the product's own rules preamble (`RULES_PREAMBLE`,
  // joined as `WorkspaceContext` joins it) — never hand-assembled, so a
  // rendering change fails against the recorded bytes.
  const rendered = renderRules([
    { path: 'AGENTS.md', directory: '', text: 'End every reply with PINEAPPLE.' },
  ])
  return {
    ...base,
    context: {
      rules: `${RULES_PREAMBLE}\n\n${rendered.text}`,
      skills: [shoutSkill()],
      agents: [],
      memory: [],
    },
  }
}

const PLAIN_OPTIONS: ToolDefinitionOptions = { hasShell: true, hasSkills: false }
const basePrefix: GoldenPrefix = { options: PLAIN_OPTIONS, facts: (base) => base }

function repeatPrefix(prefix: GoldenPrefix, count: number): GoldenPrefix[] {
  return Array.from({ length: count }, () => prefix)
}

// The parent's prefix in scenario 06: paid subagents with image generation
// on (the harness ran 06 with `paidSubagents: true`, which also offers paid
// web search, hence the hosted-search tool the host appends). The harness
// offered the product's own built-in agents.
const subagentParentPrefix: GoldenPrefix = {
  options: { hasShell: true, hasSkills: false, hasImageGeneration: true, hasSubagents: true },
  hostedSearch: true,
  facts: (base) => ({ ...base, context: { ...base.context, agents: [...builtinAgents()] } }),
}

// The spawned child's own prefix in scenario 06: a child cannot ask the
// panel, keep a task list or spawn again (`isSubagent`), while image
// generation and the offered web search stay.
const subagentChildPrefix: GoldenPrefix = {
  options: { hasShell: true, hasSkills: false, isSubagent: true, hasImageGeneration: true },
  hostedSearch: true,
  facts: (base) => base,
}

const GOLDEN_SCENARIOS: readonly GoldenScenario[] = [
  { file: '01-plain-turn.json', prefixes: repeatPrefix(basePrefix, 1) },
  { file: '02-tool-call.json', prefixes: repeatPrefix(basePrefix, 2) },
  { file: '03-edit-then-run.json', prefixes: repeatPrefix(basePrefix, 2) },
  { file: '04-packed-output.json', prefixes: repeatPrefix(basePrefix, 4) },
  { file: '05-manual-compaction.json', prefixes: repeatPrefix(basePrefix, 3) },
  {
    file: '06-subagent-child.json',
    prefixes: [subagentParentPrefix, subagentParentPrefix, subagentChildPrefix],
  },
  {
    file: '07-skills-and-rules.json',
    prefixes: [
      {
        options: { hasShell: true, hasSkills: true },
        facts: skillsRulesFacts,
      },
    ],
  },
  {
    file: '08-team-on.json',
    prefixes: [
      {
        options: { hasShell: true, hasSkills: false, teamTools: TEAM_TOOL_DEFINITIONS },
        // The harness declared no roles (`teamRosterData: () => ({ stable: [] })`),
        // so the stable section is the real builder's empty-roles output.
        facts: (base) => ({ ...base, teamRoster: buildStableRosterSection([]) }),
      },
    ],
  },
  { file: '09-single-continuation.json', prefixes: repeatPrefix(basePrefix, 2) },
  {
    file: 'moved-helpers.json',
    prefixes: repeatPrefix(
      {
        options: { hasShell: true, hasSkills: false, hasWebFetch: true },
        facts: (base) => ({ ...base, hasWebFetch: true }),
      },
      2,
    ),
  },
]

function prefixTools(prefix: GoldenPrefix): readonly ToolDefinition[] {
  const tools = toolDefinitions('linux', prefix.options)
  // The hosted-search tool the host appends, under the host's own constant
  // (`ModelApiHost` appends `{ type: MODEL_API_WEB_SEARCH_TOOL }`): using
  // the constant means renaming the wire type fails against the fixtures,
  // where a hand-written literal here would keep passing.
  return prefix.hostedSearch === true ? [...tools, { type: MODEL_API_WEB_SEARCH_TOOL }] : tools
}

/** Rebuilds a recorded turn's body with the real builders and returns the
 * complete serialized body: the byte comparison then covers every field,
 * not selected ones. */
function rebuildGoldenTurn(file: string, tools: readonly ToolDefinition[]): string {
  const body = goldenBodySchema.parse(JSON.parse(goldenRequests(file)[0]!) as unknown)
  const instructions = instructionsFor(baseFacts())
  expect(JSON.stringify(body.tools)).toBe(JSON.stringify(tools))
  expect(body.instructions).toBe(instructions)
  expect(body.prompt_cache_key).toBe(promptCacheKey({ model: body.model, instructions, tools }))
  // The recorded contract's scalars, pinned as literals: a regeneration with
  // new scalars fails these before the byte comparison below.
  expect(body.model).toBe('muse-spark-1.3')
  expect(body.tool_choice).toBe('auto')
  expect(body.reasoning).toEqual({ effort: 'high', summary: 'auto' })
  expect(body.stream).toBe(true)
  expect(body.store).toBe(false)
  expect(body.include).toEqual(['reasoning.encrypted_content'])
  expect(body.max_output_tokens).toBe(32_768)
  expect(body.prompt_cache_retention).toBe('in_memory')
  return JSON.stringify({
    model: body.model,
    input: body.input,
    instructions,
    tools,
    tool_choice: body.tool_choice,
    reasoning: body.reasoning,
    stream: body.stream,
    store: body.store,
    include: body.include,
    max_output_tokens: body.max_output_tokens,
    prompt_cache_key: body.prompt_cache_key,
    prompt_cache_retention: body.prompt_cache_retention,
  })
}

describe('invariant 7: golden request bytes with new features off', () => {
  // The recorded contract's key order (ModelApiHost.body + keyed, as
  // JSON.stringify sends it on the Meta path), pinned as literals: a
  // regeneration that adds, removes or reorders a field fails here and is
  // reviewed. The cases below tie the recorded bytes to the real producers,
  // so producer drift fails there instead.
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
    // A tools-disabled wrap-up declares no tools, so the wire carries no
    // `tools` or `tool_choice` keys either (xAI answers 400 to a choice
    // with no tools): golden 10-turn-limit-wrap-up pins that shape beside
    // the full one, request by request.
    const wrapUpKeys = BODY_KEYS.filter((key) => key !== 'tools' && key !== 'tool_choice')
    const files = goldenFiles()
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const shapes = file === '10-turn-limit-wrap-up.json' ? [BODY_KEYS, wrapUpKeys] : undefined
      const requests = goldenRequests(file)
      if (shapes !== undefined) {
        expect(requests.length).toBe(shapes.length)
      }
      for (const [index, request] of requests.entries()) {
        const parsed: unknown = JSON.parse(request)
        expect(Object.keys(z.record(z.string(), z.unknown()).parse(parsed))).toEqual(
          shapes?.[index] ?? BODY_KEYS,
        )
      }
    }
  })

  it.each(GOLDEN_SCENARIOS.map((scenario) => [scenario.file, scenario] as const))(
    'reproduces %s tools, instructions and every cache key from the real builders',
    (_file, scenario) => {
      const requests = goldenRequests(scenario.file)
      // A regenerated scenario with more or fewer requests fails here first.
      expect(requests.length).toBe(scenario.prefixes.length)
      for (const [index, request] of requests.entries()) {
        const prefix = scenario.prefixes[index]!
        const tools = prefixTools(prefix)
        const body = goldenBodySchema.parse(JSON.parse(request) as unknown)
        expect(JSON.stringify(body.tools)).toBe(JSON.stringify(tools))
        expect(body.instructions).toBe(instructionsFor(prefix.facts(baseFacts())))
        // Each request carries the key the real function emits for its
        // recorded prefix (with the reproduced tools): a key change, or a
        // prefix change the key must follow, fails here on all ten files,
        // not just scenario 01.
        expect(body.prompt_cache_key).toBe(
          promptCacheKey({ model: body.model, instructions: body.instructions, tools }),
        )
      }
    },
  )

  // The strict fixtures cover scenarios 01-07 (no team, continuation or
  // moved-helpers strict run was recorded).
  const strictScenarios = GOLDEN_SCENARIOS.filter((scenario) =>
    [
      '01-plain-turn.json',
      '02-tool-call.json',
      '03-edit-then-run.json',
      '04-packed-output.json',
      '05-manual-compaction.json',
      '06-subagent-child.json',
      '07-skills-and-rules.json',
    ].includes(scenario.file),
  )
  it.each(strictScenarios.map((scenario) => [scenario.file, scenario] as const))(
    'reproduces strict/%s tools through the real strict conversion',
    (_file, scenario) => {
      const requests = goldenRequests(`strict/${scenario.file}`)
      expect(requests.length).toBe(scenario.prefixes.length)
      for (const [index, request] of requests.entries()) {
        const strictTools = withStrictTools(prefixTools(scenario.prefixes[index]!), true)
        const body = goldenBodySchema.parse(JSON.parse(request) as unknown)
        expect(JSON.stringify(body.tools)).toBe(JSON.stringify(strictTools))
        // Strict conversion keeps the instructions: each strict request's
        // text is its plain request's recorded text.
        const plain = goldenBodySchema.parse(
          JSON.parse(goldenRequests(scenario.file)[index]!) as unknown,
        )
        expect(body.instructions).toBe(plain.instructions)
        expect(body.prompt_cache_key).toBe(
          promptCacheKey({
            model: body.model,
            instructions: body.instructions,
            tools: strictTools,
          }),
        )
      }
    },
  )

  it('reproduces the plain golden turn byte-for-byte', () => {
    expect(
      rebuildGoldenTurn('01-plain-turn.json', prefixTools(GOLDEN_SCENARIOS[0]!.prefixes[0]!)),
    ).toBe(goldenRequests('01-plain-turn.json')[0])
  })

  it('reproduces the strict golden turn byte-for-byte', () => {
    expect(
      rebuildGoldenTurn(
        'strict/01-plain-turn.json',
        withStrictTools(prefixTools(GOLDEN_SCENARIOS[0]!.prefixes[0]!), true),
      ),
    ).toBe(goldenRequests('strict/01-plain-turn.json')[0])
  })
})
