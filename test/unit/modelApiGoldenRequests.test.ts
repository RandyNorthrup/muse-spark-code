// Lane M91-G: golden "hooks off" requests (PLAN.md M91 acceptance 14g,
// SoL-Pi rule 7). Every request body the fake Model API receives with hooks
// OFF is recorded as a fixture under `test/fixtures/golden-requests/`, and
// this test compares raw fetch body strings, preserving key order and all
// formatting, except for the documented generated-id tokens below. Every
// later M91 lane compares against these fixtures, so they were captured on
// the lane-0 tree before any lane changed request building.
//
// Regeneration is explicit and never the default: set
// `MUSE_SPARK_UPDATE_GOLDEN_REQUESTS=1` (like the eval probes read
// `MUSE_EVAL_PROBE`) to rewrite the fixtures, then review the diff. The
// update refuses to run under CI.
//
// Normalisation covers only real nondeterminism, each with its reason:
// - Wire item ids (`fc_N`, `rs_N`, `msg_N`, `ws_N`): the fake Model API
//   numbers every streamed item from a module-global counter, and the host
//   replays those ids in later request inputs. The ids name nothing the
//   test chose. Only those types' direct `input[*].id` fields with the fake's
//   matching numeric prefix are replaced. One map spans every request in a
//   scenario: distinct ids get distinct aliases (`fc_A`, `msg_B`, …), and
//   repeated references retain their alias. No keys are sorted or reserialized.
// - Scripted call ids (`c1`, `spawn1`, …) stay: the test chose them, and a
//   lane that renamed or dropped a call must fail loudly.
// - Dates: the instructions carry `today` from the host's `now()` dep, and
//   the harness clock counts up from a fixed start, so `today` is always
//   1970-01-01. No wall clock, no temporary path and no random marker
//   reaches these request bodies (observation-pack markers are per recall
//   response, and this tree has no checkpoint shadow repository without the
//   verify dep), so nothing else is normalised. If a later lane puts a
//   timestamp or path on the wire, the byte comparison fails first and the
//   normalisation list grows only with a documented reason.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  ModelApiHost,
  ModelApiSession,
  type ModelApiHostDeps,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClientSettings, type FakeModelApi } from './helpers/fakeModelApi'
import { memoryToolIo, type MemoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { watchSessionTurns } from './helpers/sessionTurns'

import type { TeamDecisionSource } from '../../src/core/team/teamSeams'
import type * as TeamEntry from '../../src/core/team/teamEntry'
import { isSameTeamModel } from '../../src/core/team/sameModel'
import { memorySessionStore } from './helpers/fakeSessionStore'

const teamLoads = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../src/core/team/teamEntry.js', async (importOriginal) => {
  teamLoads.count += 1
  return await importOriginal<typeof TeamEntry>()
})

const ROOT = '/ws'
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'golden-requests')

/** Rewrite the fixtures instead of comparing: explicit, never the default, never in CI. */
function isRegenerate(): boolean {
  if (process.env['MUSE_SPARK_UPDATE_GOLDEN_REQUESTS'] !== '1') {
    return false
  }
  if (process.env['CI'] !== undefined) {
    throw new Error('MUSE_SPARK_UPDATE_GOLDEN_REQUESTS=1 is refused under CI')
  }
  return true
}

interface Harness {
  readonly api: FakeModelApi
  readonly rawBodies: string[]
  readonly host: ModelApiHost
  readonly io: MemoryToolIo
  readonly session: ModelApiSession
  readonly turnDone: () => Promise<void>
}

async function baseSetup(
  files: Record<string, string>,
  options: {
    readonly paidSubagents?: boolean
    readonly teamSource?: () => TeamDecisionSource | undefined
    readonly store?: ReturnType<typeof memorySessionStore>
    readonly idPrefix?: string
  } = {},
): Promise<Harness> {
  const api = fakeModelApi()
  const rawBodies: string[] = []
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(files, ROOT)
  const client = new ModelApiClient({
    ...fakeModelApiClientSettings(log),
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname === '/v1/responses' && init?.method === 'POST') {
        if (typeof init.body !== 'string') {
          throw new TypeError('expected a raw Model API request body string')
        }
        rawBodies.push(init.body)
      }
      return api.fetch(input, init)
    },
  })
  const base = fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log })
  const deps: ModelApiHostDeps = {
    ...base,
    ...(options.idPrefix !== undefined && {
      newId: () => `${options.idPrefix ?? ''}${base.newId()}`,
    }),
    ...(options.teamSource !== undefined && { teamDecisionSource: options.teamSource }),
    ...(options.store !== undefined && { store: options.store }),
    teamRosterData: () => ({ stable: [] }),
    // Hooks OFF: the golden baseline every later M91 lane must not move.
    isHooksEnabled: () => false,
    // Packing stays on (it is not a hook): scenario 4 watches a long output
    // ride whole twice, then as a placeholder.
    observationPacking: () => true,
    ...(options.paidSubagents === true && {
      isPaidFeatureOn: () => true,
      allowsPaidUse: () => Promise.resolve(true),
    }),
  }
  const host = new ModelApiHost(deps)
  const session = await host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  if (!(session instanceof ModelApiSession)) {
    throw new TypeError('expected the Model API session')
  }
  return { api, rawBodies, host, io, session, ...watchSessionTurns(session) }
}

/** One user text turn, driven to completion. */
async function runTurn(harness: Harness, text: string): Promise<void> {
  const submitted = harness.session.sendTurn([{ type: 'text', text }])
  await submitted
  await harness.turnDone()
}

/** Only the generated wire-item ids documented by the shared fake are eligible. */
function wireIdPrefix(type: unknown): string | undefined {
  switch (type) {
    case 'function_call': {
      return 'fc'
    }
    case 'reasoning': {
      return 'rs'
    }
    case 'message': {
      return 'msg'
    }
    case 'web_search_call': {
      return 'ws'
    }
    default: {
      return undefined
    }
  }
}

// Consume whole string tokens, including escaped quotes, so text/arguments
// containing JSON-looking ids or braces cannot be treated as wire fields.
const JSON_TOKENS = /"(?:\\.|[^"\\])*"|[{}[\]:,]/g

function normalizeItem(raw: string, ids: Map<string, string>): string {
  const item: unknown = JSON.parse(raw)
  if (typeof item !== 'object' || item === null || !('type' in item) || !('id' in item)) {
    return raw
  }
  const prefix = wireIdPrefix(item.type)
  if (
    prefix === undefined ||
    typeof item.id !== 'string' ||
    !new RegExp(`^${prefix}_[0-9]+$`).test(item.id)
  ) {
    return raw
  }
  const alias =
    ids.get(item.id) ?? `${prefix}_${String.fromCodePoint('A'.codePointAt(0)! + ids.size)}`
  ids.set(item.id, alias)
  let depth = 0
  let previous = ''
  let beforePrevious = ''
  return raw.replaceAll(JSON_TOKENS, (token: string) => {
    const isId = depth === 1 && previous === ':' && beforePrevious === '"id"'
    if (token === '{' || token === '[') depth += 1
    else if (token === '}' || token === ']') depth -= 1
    beforePrevious = previous
    previous = token
    return isId ? JSON.stringify(alias) : token
  })
}

/** Replace only direct input-item id tokens; every other raw byte is retained. */
function normalizeBodies(bodies: readonly string[]): string[] {
  const ids = new Map<string, string>()
  return bodies.map((body) => {
    let depth = 0
    let isInput = false
    let itemStart: number | undefined
    let keptUntil = 0
    let previous = ''
    let beforePrevious = ''
    const parts: string[] = []
    for (const match of body.matchAll(JSON_TOKENS)) {
      const token = match[0]
      if (token === '[' && depth === 1 && previous === ':' && beforePrevious === '"input"') {
        isInput = true
      }
      if (token === '{' && isInput && depth === 2) itemStart = match.index
      if (token === '}' && isInput && depth === 3 && itemStart !== undefined) {
        const end = match.index + 1
        parts.push(body.slice(keptUntil, itemStart), normalizeItem(body.slice(itemStart, end), ids))
        keptUntil = end
        itemStart = undefined
      }
      if (token === ']' && isInput && depth === 2) isInput = false
      if (token === '{' || token === '[') depth += 1
      else if (token === '}' || token === ']') depth -= 1
      beforePrevious = previous
      previous = token
    }
    parts.push(body.slice(keptUntil))
    return parts.join('')
  })
}

// D78 (PLAN.md, FIXDEF follow-up): recall_output is declared only when the
// request contains a packed observation. Fixtures include the resulting key;
// all other raw request bytes and the existing id-only normalization stay exact.
function checkGolden(scenario: string, harness: Harness): void {
  expect(harness.rawBodies).toHaveLength(harness.api.responseBodies().length)
  expect(
    harness.api.requests.filter(
      (request) => !['/responses', '/responses/input_tokens'].includes(request.path),
    ),
  ).toEqual([])
  // The fixture envelope is formatted JSON; each entry is the raw request
  // string, not a parsed/reserialized body. Its whitespace and order survive.
  const doc = { scenario, requests: normalizeBodies(harness.rawBodies) }
  const text = `${JSON.stringify(doc, undefined, 2)}\n`
  const file = path.join(FIXTURE_DIR, `${scenario}.json`)
  if (isRegenerate()) {
    mkdirSync(FIXTURE_DIR, { recursive: true })
    writeFileSync(file, text)
    return
  }
  const expected = readFileSync(file, 'utf8')
  expect(text).toBe(expected)
}

const BIG = Array.from(
  { length: 400 },
  (_, index) => `line ${String(index)} ${'x'.repeat(20)}`,
).join('\n')

const skillFile = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`

describe('golden request normalization boundaries', () => {
  it('preserves raw formatting and key order', () => {
    const bodies = [
      '{ "input" : [ { "id" : "fc_91", "type" : "function_call" } ], "model" : "muse-spark-1.3" }\n',
      '{"model":"muse-spark-1.3","input":[{"type":"function_call","id":"fc_91"}]}',
    ]
    expect(normalizeBodies(bodies)).toEqual(bodies.map((body) => body.replace('fc_91', 'fc_A')))
    expect(normalizeBodies(bodies)[0]).not.toBe(normalizeBodies(bodies)[1])
  })

  it('keeps distinct ids and repeated references across the whole scenario', () => {
    const bodies = [
      '{"input":[{"type":"function_call","id":"fc_91"},{"type":"function_call","id":"fc_92"}]}',
      '{"input":[{"type":"function_call","id":"fc_92"},{"type":"function_call","id":"fc_91"}]}',
    ]
    const expected = bodies.map((body) =>
      body.replaceAll('fc_91', 'fc_A').replaceAll('fc_92', 'fc_B'),
    )
    expect(normalizeBodies(bodies)).toEqual(expected)
    expect(normalizeBodies([bodies[0]!, bodies[1]!.replace('fc_91', 'fc_93')])).not.toEqual(
      expected,
    )
  })

  it('normalizes only matching direct wire-item ids, leaving other fields and text intact', () => {
    // Synthetic scope probes, not additional claimed provider wire shapes.
    const body = JSON.stringify({
      id: 'fc_91',
      tools: [{ type: 'function_call', id: 'fc_91' }],
      input: [
        { type: 'function_call', id: 'fc_91', call_id: 'fc_91', arguments: '{"id":"fc_91"}' },
        { type: 'reasoning', id: 'rs_92' },
        {
          type: 'message',
          id: 'msg_93',
          content: [{ type: 'output_text', text: '{"id":"msg_93"}' }],
        },
        { type: 'web_search_call', id: 'ws_94' },
        { type: 'function_call_output', id: 'fc_95', output: 'fc_95' },
        { type: 'message', id: 'scripted-message' },
        { type: 'message', id: 'fc_96' },
      ],
    })
    expect(normalizeBodies([body])).toEqual([
      body
        .replace('"id":"fc_91","call_id"', '"id":"fc_A","call_id"')
        .replace('"id":"rs_92"', '"id":"rs_B"')
        .replace('"id":"msg_93"', '"id":"msg_C"')
        .replace('"id":"ws_94"', '"id":"ws_D"'),
    ])
  })
})

function teamSource(overrides: Partial<TeamDecisionSource> = {}): TeamDecisionSource {
  return {
    teamSwitchOn: true,
    soloTemplate: false,
    orchestratorModelId: 'muse-spark-1.3',
    customEntries: [],
    isSameModel: isSameTeamModel,
    isEntryReady: () => false,
    teamWorkersOn: false,
    ...overrides,
  }
}

const OTHER_ENTRY = {
  entryId: 'other',
  modelId: 'other-model',
  kind: 'engine' as const,
  billsKey: false,
  isAvailable: true,
}

const BASELINES: readonly { label: string; source?: () => TeamDecisionSource }[] = [
  { label: 'no team source' },
  {
    label: 'team off',
    source: () =>
      teamSource({ teamSwitchOn: false, customEntries: [OTHER_ENTRY], isEntryReady: () => true }),
  },
  {
    label: 'Solo',
    source: () =>
      teamSource({ soloTemplate: true, customEntries: [OTHER_ENTRY], isEntryReady: () => true }),
  },
  { label: 'only Default', source: () => teamSource() },
  {
    label: 'key entries off',
    source: () =>
      teamSource({ customEntries: [{ ...OTHER_ENTRY, billsKey: true }], isEntryReady: () => true }),
  },
  {
    label: 'duplicate models',
    source: () =>
      teamSource({
        customEntries: [
          { ...OTHER_ENTRY, modelId: 'muse-spark-1.3' },
          { ...OTHER_ENTRY, entryId: 'duplicate', modelId: ' muse-spark-1.3 ', kind: 'musecode' },
        ],
        isEntryReady: () => true,
      }),
  },
  {
    label: 'unavailable',
    source: () =>
      teamSource({
        customEntries: [{ ...OTHER_ENTRY, isAvailable: false }],
        isEntryReady: () => true,
      }),
  },
  { label: 'failed probe', source: () => teamSource({ customEntries: [OTHER_ENTRY] }) },
  {
    label: 'not loaded',
    source: () => teamSource({ customEntries: [{ ...OTHER_ENTRY, modelId: 'unloaded-model' }] }),
  },
]

describe.each(BASELINES)('M91-G golden requests: $label', ({ source }) => {
  afterEach(() => {
    expect(teamLoads.count).toBe(0)
  })
  const setup = (files: Record<string, string>, options: { paidSubagents?: boolean } = {}) =>
    baseSetup(files, { ...options, ...(source !== undefined && { teamSource: source }) })
  it('records a plain one-turn reply', async () => {
    const harness = await setup({})
    harness.api.script({ text: 'Hello back.' })
    await runTurn(harness, 'Hello.')
    expect(harness.api.responseBodies()).toHaveLength(1)
    checkGolden('01-plain-turn', harness)
    await harness.host.close()
  })

  it('records a turn with one tool call and its result', async () => {
    const harness = await setup({ 'a.txt': 'Alpha.\n' })
    harness.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'c1' }] },
      { text: 'It says alpha.' },
    )
    await runTurn(harness, 'What is in a.txt?')
    expect(harness.api.responseBodies()).toHaveLength(2)
    checkGolden('02-tool-call', harness)
    await harness.host.close()
  })

  it('records an edit_file with then_run', async () => {
    const harness = await setup({ 'owned.ts': 'export const one = 1\n' })
    harness.api.script(
      {
        calls: [
          {
            name: 'edit_file',
            arguments: JSON.stringify({
              path: 'owned.ts',
              find: 'one',
              replace: 'two',
              then_run: 'echo then',
            }),
            callId: 'e1',
          },
        ],
      },
      { text: 'Renamed, and the command ran.' },
    )
    await runTurn(harness, 'Rename one to two, then run echo then.')
    expect(harness.api.responseBodies()).toHaveLength(2)
    checkGolden('03-edit-then-run', harness)
    await harness.host.close()
  })

  it('records a long tool output whole twice, then as a placeholder', async () => {
    const harness = await setup({ 'big.txt': BIG })
    harness.api.script(
      {
        calls: [{ name: 'read_file', arguments: '{"path":"big.txt"}', callId: 'c1' }],
      },
      { text: 'Read it.' },
    )
    await runTurn(harness, 'Read big.txt.')
    harness.api.script({ text: 'Again.' })
    await runTurn(harness, 'And?')
    harness.api.script({ text: 'Once more.' })
    await runTurn(harness, 'And?')
    expect(harness.api.responseBodies()).toHaveLength(4)
    checkGolden('04-packed-output', harness)
    await harness.host.close()
  })

  it('records a manual compaction and the turn after it', async () => {
    const harness = await setup({})
    harness.api.script({ text: 'First reply.' })
    await runTurn(harness, 'First.')
    harness.api.inputTokens = 77
    harness.api.script({ text: 'THE SUMMARY' })
    await expect(harness.session.compact()).resolves.toEqual({
      status: 'accepted',
      reason: undefined,
    })
    harness.api.script({ text: 'Later.' })
    await runTurn(harness, 'Next.')
    expect(harness.api.responseBodies()).toHaveLength(3)
    checkGolden('05-manual-compaction', harness)
    await harness.host.close()
  })

  it('records a subagent child turn', async () => {
    const harness = await setup({}, { paidSubagents: true })
    harness.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"worker","objective":"Map the workspace files"}',
            callId: 'spawn1',
          },
        ],
      },
      { text: 'Mapped.' },
      { text: 'Parent continues.' },
    )
    await harness.session.sendTurn([{ type: 'text', text: 'Delegate.' }])
    await vi.waitFor(() => {
      expect(harness.api.responseBodies()).toHaveLength(3)
      expect(harness.session.status).toBe('idle')
    })
    checkGolden('06-subagent-child', harness)
    await harness.host.close()
  })

  it('records a turn with skills and rules loaded', async () => {
    const harness = await setup({
      'AGENTS.md': 'End every reply with PINEAPPLE.\n',
      '.agents/skills/shout/SKILL.md': skillFile('shout', 'Repeat in caps', 'UPPER CASE.'),
    })
    harness.api.script({ text: 'Done.' })
    await runTurn(harness, 'Go.')
    expect(harness.api.responseBodies()).toHaveLength(1)
    checkGolden('07-skills-and-rules', harness)
    await harness.host.close()
  })
})

async function runResumedTurn(first: Harness, second: Harness): Promise<void> {
  await second.host.load()
  const revived = await second.host.resumeSession(first.session.sessionId, 'muse-spark-1.3')
  const watching = watchSessionTurns(revived.session)
  second.api.script({ text: 'Later.' })
  await revived.session.sendTurn([{ type: 'text', text: 'Next.' }])
  await watching.turnDone()
  expect(second.api.responseBodies()[0]?.['instructions']).toBe(
    first.api.responseBodies()[0]?.['instructions'],
  )
  await first.host.close()
  await second.host.close()
}

describe('M96 conversation boundaries', () => {
  it('keeps golden continuation when an entry becomes ready mid-turn, and enables the next conversation', async () => {
    let isReady = false
    const source = () => teamSource({ customEntries: [OTHER_ENTRY], isEntryReady: () => isReady })
    const baseline = await baseSetup({})
    baseline.api.script({ text: 'First reply.' })
    await runTurn(baseline, 'First.')
    baseline.api.script({ text: 'Later.' })
    await runTurn(baseline, 'Next.')
    checkGolden('09-single-continuation', baseline)
    const current = await baseSetup({}, { teamSource: source })
    const held = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    current.api.script({
      text: 'First reply.',
      hold: held.promise,
      onRequest: () => {
        entered.resolve(undefined)
      },
    })
    const turning = runTurn(current, 'First.')
    await entered.promise
    isReady = true
    held.resolve(undefined)
    await turning
    current.api.script({ text: 'Later.' })
    await runTurn(current, 'Next.')
    expect(normalizeBodies(current.rawBodies)).toEqual(normalizeBodies(baseline.rawBodies))
    const next = await baseSetup({}, { teamSource: source })
    next.api.script({ text: 'Team ready.' })
    await runTurn(next, 'Start.')
    expect(next.rawBodies[0]).toContain('"name":"delegate"')
    expect(next.rawBodies[0]).not.toContain('subagent_spawn')
    checkGolden('08-team-on', next)
    await baseline.host.close()
    await current.host.close()
    await next.host.close()
  })

  it('keeps the team declaration and stable roster across resume when readiness changes', async () => {
    let isReady = true
    const store = memorySessionStore()
    const source = () => teamSource({ customEntries: [OTHER_ENTRY], isEntryReady: () => isReady })
    const first = await baseSetup({}, { teamSource: source, store })
    first.api.script({ text: 'First reply.' })
    await runTurn(first, 'First.')
    const saved = await store.load(first.session.sessionId)
    expect(saved?.teamMode).toBe('team')
    isReady = false
    const second = await baseSetup({}, { teamSource: source, store, idPrefix: 'revived-' })
    await first.host.flush()
    await runResumedTurn(first, second)
    expect(second.rawBodies[0]).toContain('"name":"delegate"')
  })

  it('keeps a legacy session single-model when today’s setup has a team', async () => {
    const store = memorySessionStore()
    const first = await baseSetup({}, { store })
    first.api.script({ text: 'First reply.' })
    await runTurn(first, 'First.')
    await first.host.flush()
    const saved = await store.load(first.session.sessionId)
    if (saved === undefined) throw new Error('Expected a saved session')
    const legacy = { ...saved }
    delete legacy.teamMode
    delete legacy.teamRoster
    delete legacy.teamCommands
    await store.save(legacy)
    const second = await baseSetup(
      {},
      {
        store,
        idPrefix: 'legacy-',
        teamSource: () => teamSource({ customEntries: [OTHER_ENTRY], isEntryReady: () => true }),
      },
    )
    await runResumedTurn(first, second)
    expect(second.rawBodies[0]).not.toContain('"name":"delegate"')
  })
})
