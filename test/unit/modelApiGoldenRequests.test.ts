// Lane M91-G: golden "hooks off" requests (PLAN.md M91 acceptance 14g,
// SoL-Pi rule 7). Every request body the fake Model API receives with hooks
// OFF is recorded as a fixture under `test/fixtures/golden-requests/`, and
// this test asserts the live bytes equal those fixtures byte for byte. Every
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
//   test chose, so each becomes `<item-id>/<reasoning-id>/…` by item kind.
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
import { describe, expect, it, vi } from 'vitest'
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
  readonly host: ModelApiHost
  readonly io: MemoryToolIo
  readonly session: ModelApiSession
  readonly turnDone: () => Promise<void>
}

async function setup(
  files: Record<string, string>,
  options: { readonly paidSubagents?: boolean } = {},
): Promise<Harness> {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo(files, ROOT)
  const client = new ModelApiClient({ ...fakeModelApiClientSettings(log), fetch: api.fetch })
  const base = fakeModelApiHostDeps({ client, workspaceRoot: ROOT, io, log })
  const deps: ModelApiHostDeps = {
    ...base,
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
  return { api, host, io, session, ...watchSessionTurns(session) }
}

/** One user text turn, driven to completion. */
async function runTurn(harness: Harness, text: string): Promise<void> {
  const submitted = harness.session.sendTurn([{ type: 'text', text }])
  await submitted
  await harness.turnDone()
}

/** The `id` the fake numbers on each streamed item, by input-item kind. */
function placeholderIdFor(item: Record<string, unknown>): string {
  switch (item['type']) {
    case 'function_call': {
      return '<item-id>'
    }
    case 'reasoning': {
      return '<reasoning-id>'
    }
    case 'message': {
      return '<message-id>'
    }
    case 'web_search_call': {
      return '<search-id>'
    }
    default: {
      return '<item-id>'
    }
  }
}

/** Code-unit order, the same on every runtime: byte stability must not depend on ICU. */
function compareKeys(left: string, right: string): number {
  return left < right ? -1 : 1
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry))
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const keys = Object.keys(record).toSorted(compareKeys)
    for (const key of keys) {
      if (key === 'id' && typeof record[key] === 'string') {
        out[key] = placeholderIdFor(record)
        continue
      }
      out[key] = normalizeValue(record[key])
    }
    return out
  }
  return value
}

/** Stable JSON: sorted keys at every level, two-space indent. */
function stableJson(value: unknown): string {
  return JSON.stringify(normalizeValue(value), undefined, 2)
}

function checkGolden(scenario: string, api: FakeModelApi): void {
  const doc = { scenario, requests: api.responseBodies() }
  const text = `${stableJson(doc)}\n`
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

describe('M91-G golden requests with hooks off', () => {
  it('records a plain one-turn reply', async () => {
    const harness = await setup({})
    harness.api.script({ text: 'Hello back.' })
    await runTurn(harness, 'Hello.')
    expect(harness.api.responseBodies()).toHaveLength(1)
    checkGolden('01-plain-turn', harness.api)
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
    checkGolden('02-tool-call', harness.api)
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
    checkGolden('03-edit-then-run', harness.api)
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
    checkGolden('04-packed-output', harness.api)
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
    checkGolden('05-manual-compaction', harness.api)
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
    checkGolden('06-subagent-child', harness.api)
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
    checkGolden('07-skills-and-rules', harness.api)
    await harness.host.close()
  })
})
