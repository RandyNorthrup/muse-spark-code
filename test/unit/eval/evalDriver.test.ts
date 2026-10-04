import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  EVAL_MODEL_ID,
  EVAL_TURN_TIMED_OUT,
  MODEL_API_MODEL_TEXT,
} from '../../../src/shared/constants'
import type { EvalHostChange } from '../../../src/core/eval/driver'
import { driveEvalTurn, EVAL_TURN_ROOT as ROOT, type DrivenEvalTurn } from '../helpers/evalTurn'
import {
  fakeModelApi,
  fakeModelApiClient,
  type FakeModelApi,
  type ScriptedReply,
} from '../helpers/fakeModelApi'
import { FakeLogOutputChannel } from '../helpers/fakes'

const TOTAL = 'export function sumAll(items) {\n  return items.length\n}\n'
const SHORT_TURN_MS = 50

const toolListSchema = z.array(z.object({ name: z.optional(z.string()), type: z.string() }))
const outputSchema = z.object({ type: z.literal('function_call_output'), output: z.string() })

async function drive(
  replies: readonly ScriptedReply[],
  options: { change?: EvalHostChange; turnTimeoutMs?: number } = {},
): Promise<DrivenEvalTurn> {
  return await driveEvalTurn({
    replies,
    files: { 'total.js': TOTAL },
    prompt: 'Fix total.js.',
    change: options.change,
    turnTimeoutMs: options.turnTimeoutMs,
  })
}

/** The tool results the model was sent in the `index`th request. */
function outputsSent(api: FakeModelApi, index: number): string[] {
  const input = api.responseBodies()[index]?.['input']
  return Array.isArray(input)
    ? input.flatMap((item) => {
        const parsed = outputSchema.safeParse(item)
        return parsed.success ? [parsed.data.output] : []
      })
    : []
}

describe('runEvalTurn', () => {
  it('runs the task on the harness and the contributor model, edits allowed', async () => {
    const { api, io, outcome } = await drive([
      { calls: [{ name: 'read_file', arguments: JSON.stringify({ path: 'total.js' }) }] },
      {
        calls: [
          {
            name: 'edit_file',
            arguments: JSON.stringify({
              path: 'total.js',
              find: 'items.length',
              replace: 'items.reduce((a, b) => a + b, 0)',
            }),
          },
        ],
      },
      { text: 'Fixed.' },
    ])
    expect(outcome).toMatchObject({
      terminal: 'completed',
      reason: undefined,
      tools: ['read_file', 'edit_file'],
      approvals: 0,
      questions: 0,
      paidRefusals: 0,
      paidUses: 0,
      problems: [],
    })
    expect(io.files.get(`${ROOT}/total.js`)).toContain('items.reduce')
    const bodies = api.responseBodies()
    expect(bodies).toHaveLength(3)
    expect(bodies.every((body) => body['model'] === EVAL_MODEL_ID)).toBe(true)
    // No paid tool is offered: nothing the run does is billed beyond tokens.
    const tools = toolListSchema.parse(bodies[0]?.['tools']).map((tool) => tool.name ?? tool.type)
    expect(tools).toContain('bash')
    expect(tools).not.toContain('generate_image')
    expect(tools).not.toContain('web_search')
  })

  it('allows a shell command once through its card', async () => {
    const { io, outcome } = await drive([
      {
        calls: [
          { name: 'bash', arguments: JSON.stringify({ command: 'node -v', description: 'v' }) },
        ],
      },
      { text: 'Ran it.' },
    ])
    expect(outcome.terminal).toBe('completed')
    expect(outcome.approvals).toBe(1)
    expect(io.shellCalls.map((call) => call.command)).toEqual(['node -v'])
  })

  it('answers a question with "proceed"', async () => {
    const { api, outcome } = await drive([
      {
        calls: [
          {
            name: 'ask_user',
            arguments: JSON.stringify({
              questions: [
                {
                  id: 'q',
                  header: 'Which',
                  question: 'Which fix?',
                  selection: { mode: 'single' },
                  options: [{ label: 'This one' }],
                },
              ],
            }),
          },
        ],
      },
      { text: 'Went ahead.' },
    ])
    expect(outcome.terminal).toBe('completed')
    expect(outcome.questions).toBe(1)
    expect(outputsSent(api, 1).join('\n')).toContain(MODEL_API_MODEL_TEXT.evalClarification)
  })

  it('refuses a child task, a paid use, even where a mechanism offers it', async () => {
    const spawn: ScriptedReply = {
      calls: [
        {
          name: 'subagent_spawn',
          arguments: JSON.stringify({ role: 'worker', objective: 'Fix it for me.' }),
        },
      ],
    }
    const plain = await drive([spawn, { text: 'Did it myself.' }])
    const plainTools = toolListSchema.parse(plain.api.responseBodies()[0]?.['tools'])
    expect(plainTools.map((tool) => tool.name)).not.toContain('subagent_spawn')
    expect(plain.outcome).toMatchObject({ terminal: 'completed', paidRefusals: 0, paidUses: 0 })
    // Switched on by a mechanism, the paid-use popup still asks, and the run says no.
    const offered = await drive([spawn, { text: 'Did it myself.' }], {
      change: (deps) => ({ ...deps, isPaidFeatureOn: (feature) => feature === 'subagents' }),
    })
    expect(offered.outcome).toMatchObject({ terminal: 'completed', paidRefusals: 1, paidUses: 0 })
    expect(offered.api.responseBodies()).toHaveLength(2)
  })

  it('applies the mechanism’s change to the harness', async () => {
    const plain = await drive([{ text: 'ok' }])
    const changed = await drive([{ text: 'ok' }], {
      change: (deps) => ({ ...deps, promptCacheRetention: () => '24h' }),
    })
    expect(plain.api.responseBodies()[0]?.['prompt_cache_retention']).toBe('in_memory')
    expect(changed.api.responseBodies()[0]?.['prompt_cache_retention']).toBe('24h')
  })

  it('holds the trace, the workspace and the paid-use hooks fixed', async () => {
    const api = fakeModelApi()
    const other = fakeModelApiClient(api, new FakeLogOutputChannel())
    await expect(
      drive([{ text: 'ok' }], {
        change: (deps) => ({ ...deps, client: other, workspaceRoot: '/elsewhere' }),
      }),
    ).rejects.toThrow(
      'the mechanism changed client, workspaceRoot, which the evaluation holds fixed',
    )
    await expect(
      drive([{ text: 'ok' }], {
        change: (deps) => ({
          ...deps,
          allowsPaidUse: () => Promise.resolve(true),
          isPaidUseRemembered: () => true,
          notePaidUse: () => undefined,
          noteSubagentUsage: () => undefined,
        }),
      }),
    ).rejects.toThrow(
      'the mechanism changed allowsPaidUse, isPaidUseRemembered, notePaidUse, noteSubagentUsage, which',
    )
    expect(api.requests).toEqual([])
  })

  it('reports a turn that failed, with its reason', async () => {
    const { outcome } = await drive([
      { failed: { code: 'server_error', message: 'the backend fell over' } },
    ])
    expect(outcome.terminal).toBe('failed')
    expect(outcome.reason).toContain('the backend fell over')
  })

  it('stops a turn that runs out of time', async () => {
    const never = new Promise<never>(() => undefined)
    const { outcome } = await drive([{ hold: never, text: 'late' }], {
      turnTimeoutMs: SHORT_TURN_MS,
    })
    expect(outcome.terminal).toBe(EVAL_TURN_TIMED_OUT)
    expect(outcome.reason).toBeUndefined()
  })
})
