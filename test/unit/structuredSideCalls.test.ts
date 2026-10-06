import { describe, expect, it, vi } from 'vitest'
import { reviewPaidCall } from '../../src/core/backends/modelapi/reviewerEntry'
import {
  runHookModelTurn,
  type HookModelContext,
} from '../../src/core/backends/modelapi/hookModelEntry'
import {
  ModelApiHost,
  ModelApiSession,
  type DirectResponseBudget,
} from '../../src/core/backends/modelapi/ModelApiHost'
import { ReviewBreaker } from '../../src/core/backends/modelapi/autoReviewer'
import type { CreateResponseBody, Usage } from '../../src/core/backends/modelapi/schemas'
import type { ResponseAttemptGuard } from '../../src/core/backends/modelapi/client'
import { parseHookAnswer } from '../../src/core/backends/modelapi/hooks'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { EN } from '../../src/shared/l10n/en'
import { fakeModelApi, fakeModelApiClient, FAKE_MODEL_API_ACCOUNT_ID } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'

const MODEL = 'muse-spark-1.3'
function setup() {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const deps = fakeModelApiHostDeps({
    client: fakeModelApiClient(api, log),
    workspaceRoot: '/ws',
    io: memoryToolIo({}, '/ws'),
    log,
  })
  const events: AgentEvent[] = []
  const guard = vi.fn(
    (_body: CreateResponseBody, budget: DirectResponseBudget): ResponseAttemptGuard =>
      Object.assign(() => undefined, {
        onRequestStarted: () => {
          budget.isSent = true
        },
      }),
  )
  const observed = {
    table: EN,
    locale: 'en',
    keyed: (
      body: Omit<CreateResponseBody, 'prompt_cache_key' | 'prompt_cache_retention'>,
    ): CreateResponseBody => ({
      ...body,
      prompt_cache_key: 'fixed-prefix',
      prompt_cache_retention: 'in_memory',
    }),
    guard,
    isCountedUsage: (usage: Usage) =>
      Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens),
    abortError: () => new Error('aborted'),
    isRefused: () => false,
    emit: (event: AgentEvent) => {
      events.push(event)
    },
    record: () => undefined,
  }
  const started = vi.fn()
  const confirmed = {
    modelId: MODEL,
    keyDigest: FAKE_MODEL_API_ACCOUNT_ID,
    isStillAllowed: () => true,
    onRequestStarted: started,
  }
  return {
    api,
    deps,
    events,
    guard,
    observed,
    confirmed,
    started,
    signal: new AbortController().signal,
  }
}

async function reviewTurn(
  rig: ReturnType<typeof setup>,
  deps?: Parameters<typeof reviewPaidCall>[0]['deps'],
  isCurrent = () => true,
) {
  return await reviewPaidCall(
    {
      ...rig.observed,
      deps: deps ?? {
        ...rig.deps,
        sideCallFormats: () => ({ state: 'yes', value: ['strict_schema'] }),
      },
      breaker: new ReviewBreaker(),
      userRequest: 'check',
      recentCalls: [],
    },
    'run_shell',
    'echo ok',
    't1',
    rig.signal,
    rig.confirmed,
    undefined,
    isCurrent,
  )
}

function hookContext(
  rig: ReturnType<typeof setup>,
  overrides: Partial<HookModelContext> = {},
): HookModelContext {
  return {
    ...rig.observed,
    deps: { ...rig.deps, sideCallFormats: () => ({ state: 'yes', value: ['strict_schema'] }) },
    tools: [],
    executeReadOnlyTool: () => Promise.reject(new Error('unexpected tool')),
    ...overrides,
  }
}

async function hookTurn(
  rig: ReturnType<typeof setup>,
  context = hookContext(rig),
  kind: 'prompt' | 'agent' = 'prompt',
) {
  return await runHookModelTurn(
    context,
    { kind, system: 'decide', user: 'request' },
    'PreToolUse',
    't1',
    rig.signal,
    rig.confirmed,
    undefined,
    () => true,
  )
}

async function compactionRig() {
  const rig = setup()
  const host = new ModelApiHost({
    ...rig.deps,
    sideCallFormats: () => ({ state: 'yes', value: ['strict_schema'] }),
  })
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: MODEL,
    approvalMode: 'promptUnmatched',
  })
  if (!(session instanceof ModelApiSession)) throw new Error('expected Model API session')
  rig.api.script({ text: 'prior reply' })
  await session.sendTurn([{ type: 'text', text: 'prior user turn' }])
  await session.settled()
  return { rig, host, session }
}

describe('M106 structured reviewer and hook consumers', () => {
  it('rejects a truncated structured reviewer answer before allowing any action', async () => {
    const rig = setup()
    rig.api.script(
      { text: '{"decision":"allow","reason":"read only"}', omitTerminal: true },
      { text: '{"decision":"allow","reason":"read only"}', omitTerminal: true },
      { text: 'ASK: incomplete response' },
    )
    const result = await reviewTurn(rig)
    expect(result.decision).toBe('ask')
    expect(rig.api.responseBodies()).toHaveLength(3)
  })

  it('decodes the injected forced-answer tool without executing it', async () => {
    const rig = setup()
    rig.api.script({
      calls: [
        {
          name: 'hook_decision',
          arguments: '{"decision":"continue","reason":null,"additionalContext":"data only"}',
        },
      ],
    })
    const forceSideCallTool = vi.fn(
      (body: CreateResponseBody, attempt: { name: string; schema: Record<string, unknown> }) => ({
        ...body,
        tools: [
          {
            type: 'function' as const,
            name: attempt.name,
            description: 'test answer codec',
            parameters: attempt.schema,
            strict: false as const,
          },
        ],
      }),
    )
    const executeReadOnlyTool = vi.fn(() => Promise.reject(new Error('answer tools never execute')))
    const result = await hookTurn(
      rig,
      hookContext(rig, {
        deps: {
          ...rig.deps,
          sideCallFormats: () => ({ state: 'yes', value: ['forced_tool'] }),
          forceSideCallTool,
        },
        executeReadOnlyTool,
      }),
    )
    expect(parseHookAnswer('PreToolUse', 0, result.text, '').context).toBe('data only')
    expect(forceSideCallTool).toHaveBeenCalledTimes(1)
    expect(executeReadOnlyTool).not.toHaveBeenCalled()
  })

  it('repairs a truncated hook decision before taking the text path', async () => {
    const rig = setup()
    const answer = '{"decision":"continue","reason":null,"additionalContext":null}'
    rig.api.script(
      { text: answer, omitTerminal: true },
      { text: answer, omitTerminal: true },
      { text: '{}' },
    )
    const result = await hookTurn(rig)
    expect(result.text).toBe('{}')
    expect(rig.api.responseBodies()).toHaveLength(3)
  })
  it('validates the reviewer verdict and accounts separately for repair and text fallback', async () => {
    const rig = setup()
    rig.api.script(
      { text: '{"decision":"allow","reason":"","grant":true}' },
      { text: '{"decision":"allow","reason":""}' },
      { text: 'ASK: inspect this action' },
    )
    const noteReviewerUsage = vi.fn()
    const result = await reviewTurn(rig, {
      ...rig.deps,
      sideCallFormats: () => ({ state: 'yes', value: ['strict_schema'] }),
      noteReviewerUsage,
    })
    expect(result.decision).toBe('ask')
    expect(rig.api.responseBodies()).toHaveLength(3)
    expect(rig.api.responseBodies()[0]?.['text']).toMatchObject({
      format: { strict: true, name: 'reviewer_answer' },
    })
    expect(rig.api.responseBodies()[2]).not.toHaveProperty('text')
    expect(noteReviewerUsage).toHaveBeenCalledTimes(3)
    expect(rig.guard).toHaveBeenCalledTimes(3)
    expect(rig.started).toHaveBeenCalledTimes(3)
  })

  it('returns a validated allow only while the held action is current', async () => {
    const rig = setup()
    rig.api.script({ text: '{"decision":"allow","reason":"read only"}' })
    const result = await reviewTurn(
      rig,
      { ...rig.deps, sideCallFormats: () => ({ state: 'yes', value: ['json_schema'] }) },
      () => false,
    )
    expect(result.decision).toBe('ask')
    expect(rig.api.responseBodies()[0]?.['text']).toMatchObject({ format: { strict: false } })
  })

  it.each(['prompt', 'agent'] as const)(
    'maps %s hook context as data with no permission grant',
    async (kind) => {
      const rig = setup()
      rig.api.script({
        text: '{"decision":"continue","reason":null,"additionalContext":"read carefully"}',
      })
      const result = await hookTurn(rig, hookContext(rig), kind)
      const answer = parseHookAnswer('PreToolUse', 0, result.text, '')
      expect(answer).toMatchObject({ status: 'completed', context: 'read carefully' })
      expect(answer.permissionDecision).toBeUndefined()
      expect(result.text).not.toContain('allow')
      expect(rig.api.responseBodies()[0]?.['text']).toMatchObject({
        format: { name: 'hook_decision' },
      })
    },
  )

  it('rejects a hook grant, adapts a repaired block, and aggregates the two receipts', async () => {
    const rig = setup()
    rig.api.script(
      { text: '{"decision":"allow","reason":null,"additionalContext":null}' },
      { text: '{"decision":"block","reason":"review required","additionalContext":null}' },
    )
    const result = await hookTurn(rig)
    expect(parseHookAnswer('PreToolUse', 0, result.text, '')).toMatchObject({
      status: 'blocked',
      reason: 'review required',
    })
    expect(rig.api.responseBodies()).toHaveLength(2)
    expect(rig.started).toHaveBeenCalledTimes(2)
    expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 10 })
  })

  it('keeps agent read-only tools available until its validated decision', async () => {
    const rig = setup()
    rig.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"a.ts"}' }] },
      { text: '{"decision":"continue","reason":null,"additionalContext":null}' },
    )
    const executeReadOnlyTool = vi.fn(() => Promise.resolve('file data'))
    const context = hookContext(rig, {
      tools: [
        { type: 'function', name: 'read_file', description: 'read', parameters: {}, strict: false },
      ],
      executeReadOnlyTool,
    })
    const result = await hookTurn(rig, context, 'agent')
    expect(result.text).toBe('{}')
    expect(executeReadOnlyTool).toHaveBeenCalledExactlyOnceWith(
      'read_file',
      '{"path":"a.ts"}',
      rig.signal,
    )
    expect(rig.api.responseBodies()[1]?.['input']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function_call_output', output: 'file data' }),
      ]),
    )
  })
})

describe('M106 compaction in the actual engine', () => {
  it('still replaces replay when both structured summaries fail', async () => {
    const { rig, host, session } = await compactionRig()
    rig.api.script(
      { text: 'invalid' },
      { text: '{"goal":"missing other sections"}' },
      { text: 'Legacy summary with exact paths' },
    )
    await expect(session.compact()).resolves.toMatchObject({ status: 'accepted' })
    const replay = session.snapshot().replay
    expect(JSON.stringify(replay)).toContain('Legacy summary with exact paths')
    expect(JSON.stringify(replay)).not.toContain('missing other sections')
    expect(rig.api.responseBodies().slice(1)).toHaveLength(3)
    expect(rig.api.responseBodies()[3]).not.toHaveProperty('text')
    session.dispose()
    await host.close()
  })

  it('inserts only deterministic structured prose inside the unchanged replay wrapper', async () => {
    const { rig, host, session } = await compactionRig()
    rig.api.script({
      text: JSON.stringify({
        goal: 'Goal',
        constraints: 'Constraints',
        progress: 'Progress',
        decisions: 'Decisions',
        nextSteps: 'Next',
        criticalContext: 'Untrusted data',
      }),
    })
    await expect(session.compact()).resolves.toMatchObject({ status: 'accepted' })
    expect(JSON.stringify(session.snapshot().replay)).toContain(String.raw`## Goal\n\nGoal`)
    expect(rig.api.responseBodies().slice(1)).toHaveLength(1)
    session.dispose()
    await host.close()
  })
})
