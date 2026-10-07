import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildForeignStdin, parseForeignResult } from '../../src/core/backends/modelapi/hookFormats'
import { parseHookAnswer } from '../../src/core/backends/modelapi/hooks'
import { parseExtensionHookAnswer } from '../../src/core/backends/modelapi/extensionHooks'
import {
  EXTENSION_HOOK_EVENTS,
  HOOK_SYSTEM_MESSAGE_MAX_CHARS,
  JUDGE_ADVISORY_THRESHOLD,
  JUDGE_MAX_BODY_BYTES,
} from '../../src/shared/constants'
import { runJudgeHookCommand } from '../../src/runtime/judge/hook'
import * as commands from '../../src/runtime/judge/commands'
import * as hooks from '../../src/core/backends/modelapi/hooks'
import * as extensionHooks from '../../src/core/backends/modelapi/extensionHooks'
import * as foreignHooks from '../../src/core/backends/modelapi/hookFormats'
import { command, io, source } from './judgeCliFixtures'
import {
  CAUTION,
  QUESTION,
  PAYLOAD,
  capture,
  hookDeps,
  invoke,
  riskOutcome,
} from './judgeHookCliFixtures'

afterEach(() => vi.restoreAllMocks())

describe('judge hook native advisory formats', () => {
  it('emits an ask and a fixed warning for Muse PreToolUse, never a grant or a rewrite', async () => {
    const result = await invoke()
    expect(result.code).toBe(0)
    expect(JSON.parse(result.output())).toEqual({
      systemMessage: CAUTION,
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: CAUTION,
      },
    })
    expect(parseHookAnswer('PreToolUse', 0, result.output(), '')).toMatchObject({
      status: 'completed',
      permissionDecision: 'ask',
      systemMessage: CAUTION,
    })
    expect(result.output()).not.toMatch(/allow|deny|block|updatedInput|session\/|jsonrpc/)
  })
  it('reads the captured Claude and Gemini payloads and their existing M91 output contracts', async () => {
    for (const format of ['claude', 'gemini'] as const) {
      const payload = capture(
        format === 'claude'
          ? 'claude/PreToolUse.Bash.json'
          : 'gemini/BeforeTool.run_shell_command.json',
      )
      const result = await invoke(payload, { format })
      expect(result.code).toBe(0)
      const answer =
        format === 'claude'
          ? parseHookAnswer('PreToolUse', 0, result.output(), '')
          : parseForeignResult(format, 'PreToolUse', 0, result.output(), '')
      expect(answer).toMatchObject({ status: 'completed', systemMessage: CAUTION })
      expect(answer.approvalDecision).toBeUndefined()
      expect(result.output()).not.toMatch(/"(?:allow|deny|block)"|updatedInput|tool_input/)
    }
  })
  it.each(EXTENSION_HOOK_EVENTS)(
    'uses M91 EXTENSION_HOOK_EVENTS for %s without granting a decision',
    async (event) => {
      const result = await invoke({ hook_event_name: event, extension_data: { kept: true } })
      expect(result.code).toBe(0)
      expect(JSON.parse(result.output())).toEqual({ systemMessage: CAUTION })
      expect(parseExtensionHookAnswer(event, 0, result.output(), '')).toMatchObject({
        status: 'completed',
        message: CAUTION,
      })
    },
  )
  it.each([
    ['cursor', 'preToolUse', 'PreToolUse'],
    ['copilot', 'preToolUse', 'PreToolUse'],
    ['copilot', 'PreToolUse', 'PreToolUse'],
    ['cline', 'PreToolUse', 'PreToolUse'],
    ['kiro', 'UserPromptSubmit', 'UserPromptSubmit'],
  ] as const)('honors the existing %s advisory contract on %s', async (format, event, muse) => {
    const built = buildForeignStdin(
      format,
      muse,
      { ...PAYLOAD, cwd: '/workspace', prompt: 'review this action' },
      // The borrowed POSIX fixture is not a Windows rooted path.
      { sourceEvent: event, platform: 'linux', workspaceRoot: '/workspace' },
    )
    if (built.outcome !== 'run') throw new Error('fixture build refused')
    const result = await invoke(JSON.parse(built.stdin), { format, event })
    if (format === 'cursor') {
      expect(result.code).toBe(4)
      expect(result.output()).toBe('')
      expect(result.deps.resolveSource).not.toHaveBeenCalled()
      return
    }
    expect(result.code).toBe(0)
    const answer = parseForeignResult(format, muse, 0, result.output(), '', {
      sourceEvent: event,
    })
    expect(answer.status).toBe('completed')
    expect(
      answer.permissionDecision === 'ask' ||
        answer.context === CAUTION ||
        answer.systemMessage === CAUTION,
    ).toBe(true)
    expect(result.output()).not.toMatch(/"(?:allow|deny|block)"|updated_input|modifiedArgs|cancel/)
  })
  it.each([
    ['windsurf', 'pre_run_command', 'PreToolUse'],
    ['kiro', 'PreToolUse', 'PreToolUse'],
    ['cursor', 'beforeReadFile', 'PreToolUse'],
    ['cursor', 'stop', 'Stop'],
    ['copilot', 'permissionRequest', 'PermissionRequest'],
  ] as const)(
    'refuses %s/%s before resolution when no advisory-only output exists',
    async (format, event, muse) => {
      const built = buildForeignStdin(
        format,
        muse,
        {
          ...PAYLOAD,
          tool_name: event === 'beforeReadFile' ? 'read_file' : 'bash',
          tool_input: { command: 'git status', file_path: '/workspace/file.txt' },
          cwd: '/workspace',
          content: 'file',
          status: 'completed',
        },
        { sourceEvent: event, platform: 'linux', workspaceRoot: '/workspace' },
      )
      if (built.outcome !== 'run') throw new Error('fixture build refused')
      const deps = hookDeps()
      const result = await invoke(JSON.parse(built.stdin), { format, event }, deps)
      expect(result.code).toBe(format === 'cursor' && event === 'beforeReadFile' ? 4 : 0)
      expect(result.output()).toBe(format === 'cursor' && event === 'stop' ? '{}\n' : '')
      expect(deps.resolveSource).not.toHaveBeenCalled()
    },
  )
  it('safe, below-threshold and partial results never emit ALLOW or a caution', async () => {
    for (const outcome of [
      riskOutcome(0),
      riskOutcome(JUDGE_ADVISORY_THRESHOLD - 0.01),
      riskOutcome(1, true),
    ]) {
      const fake = source()
      fake.judge.mockResolvedValue(outcome)
      const result = await invoke(PAYLOAD, { format: 'muse' }, hookDeps(fake.value))
      expect(result.code).toBe(0)
      expect(result.output()).toBe('')
    }
    const fake = source()
    fake.judge.mockResolvedValue(riskOutcome(JUDGE_ADVISORY_THRESHOLD))
    const boundary = await invoke(PAYLOAD, { format: 'muse' }, hookDeps(fake.value))
    expect(boundary.output()).toContain(CAUTION)
  })
  it('abstains on no-answer at native exit 0 with no stdout verdict', async () => {
    const fake = source()
    fake.judge.mockResolvedValue({ outcome: 'no-answer', reason: 'consent-needed' })
    const result = await invoke(PAYLOAD, { format: 'muse' }, hookDeps(fake.value))
    expect(result.code).toBe(0)
    expect(result.output()).toBe('')
    expect(result.error()).toBe('')
  })
  it('validates borrowed command stdout before translating a native verdict', async () => {
    const borrowed = vi.spyOn(commands, 'runJudgeCommand')
    const good = riskOutcome()
    if (good.outcome !== 'answered') throw new Error('fixture')
    const meta = good.result.muse['risk']
    if (meta === undefined) throw new Error('fixture')
    const choice = {
      ...good,
      result: {
        ...good.result,
        answers: {
          risk: { type: 'choice', choice: 'A', probabilities: { A: 1, B: 0 }, confidence: 1 },
        },
      },
    }
    const wrongId = {
      ...good,
      result: {
        ...good.result,
        answers: { other: good.result.answers['risk'] },
        muse: { other: meta },
      },
    }
    for (const raw of [
      '{',
      JSON.stringify({ outcome: 'answered', result: {} }),
      JSON.stringify({ outcome: 'no-answer', reason: 'timeout' }),
      JSON.stringify(choice),
      JSON.stringify(wrongId),
    ]) {
      borrowed.mockImplementationOnce((_command, streams) => {
        streams.stdout.write(raw)
        return Promise.resolve(0)
      })
      const result = await invoke()
      expect(result.code).toBe(0)
      expect(result.output()).toBe('')
      expect(result.error()).toBe('')
    }
  })
  it('drops a borrowed result after cancellation and abstains on a stalled native flush', async () => {
    const borrowed = vi.spyOn(commands, 'runJudgeCommand')
    const controller = new AbortController()
    borrowed.mockImplementationOnce((_command, streams) => {
      controller.abort(new Error('private cancellation'))
      streams.stdout.write(JSON.stringify(riskOutcome()))
      return Promise.resolve(0)
    })
    const cancelled = await invoke(
      PAYLOAD,
      { format: 'muse' },
      hookDeps(),
      command().options,
      controller.signal,
    )
    expect(cancelled.code).toBe(0)
    expect(cancelled.output()).toBe('')
    borrowed.mockImplementationOnce((_command, streams) => {
      streams.stdout.write(JSON.stringify(riskOutcome(0)))
      return Promise.resolve(0)
    })
    const streams = io(JSON.stringify(PAYLOAD))
    vi.mocked(streams.stdout.flush).mockResolvedValue(false)
    expect(
      await runJudgeHookCommand(command().options, { format: 'muse' }, streams, hookDeps()),
    ).toBe(0)
  })
  it('requires a native event and rejects conflicting or unknown explicit events', async () => {
    for (const [payload, settings] of [
      [{}, { format: 'muse' }],
      [{ tool_name: 'bash', tool_input: {} }, { format: 'muse' }],
      [PAYLOAD, { format: 'muse', event: 'Stop' }],
      [{ hook_event_name: 'invented' }, { format: 'muse' }],
      [{ hook_event_name: 'invented' }, { format: 'gemini' }],
    ] as const) {
      const deps = hookDeps()
      const result = await invoke(payload, settings, deps)
      expect(result.code).toBe(2)
      expect(result.output()).toBe('')
      expect(deps.resolveSource).not.toHaveBeenCalled()
    }
  })
  it('refuses a caution before inference when M91 rejects its native output', async () => {
    vi.spyOn(hooks, 'parseHookAnswer').mockReturnValue({
      status: 'failed',
      reason: 'fixed contract failure',
    })
    vi.spyOn(extensionHooks, 'parseExtensionHookAnswer').mockReturnValue({
      status: 'failed',
      hasAnswer: false,
      output: '',
    })
    for (const event of ['PreToolUse', 'FileChanged']) {
      const deps = hookDeps()
      const result = await invoke({ ...PAYLOAD, hook_event_name: event }, { format: 'muse' }, deps)
      expect(result.code).toBe(0)
      expect(result.output()).toBe('')
      expect(deps.resolveSource).not.toHaveBeenCalled()
    }
    vi.spyOn(foreignHooks, 'parseForeignResult').mockReturnValue({
      status: 'failed',
      reason: 'fixed contract failure',
      systemMessage: CAUTION,
    })
    const deps = hookDeps()
    const foreign = await invoke(
      capture('gemini/BeforeTool.run_shell_command.json'),
      {
        format: 'gemini',
      },
      deps,
    )
    expect(foreign.code).toBe(0)
    expect(foreign.output()).toBe('')
    expect(deps.resolveSource).not.toHaveBeenCalled()
  })
  it('validates malformed bytes, envelopes and required tool fields before inference', async () => {
    for (const raw of [
      '',
      '{',
      '[]',
      'null',
      '{"hook_event_name":1}',
      JSON.stringify({ hook_event_name: 'PreToolUse' }),
      JSON.stringify({ ...PAYLOAD, tool_input: [] }),
      JSON.stringify({ ...PAYLOAD, tool_input: 'git status' }),
      JSON.stringify({ ...PAYLOAD, tool_name: 1 }),
      JSON.stringify({ hook_event_name: 'BeforeTool', tool_name: 'read_file' }),
    ]) {
      const deps = hookDeps()
      const streams = io(raw)
      expect(
        await runJudgeHookCommand(
          command().options,
          { format: raw.includes('BeforeTool') ? 'gemini' : 'muse' },
          streams,
          deps,
        ),
      ).toBe(2)
      expect(streams.output()).toBe('')
      expect(deps.resolveSource).not.toHaveBeenCalled()
    }
    const streams = io(Buffer.from([0xff]))
    expect(
      await runJudgeHookCommand(command().options, { format: 'muse' }, streams, hookDeps()),
    ).toBe(2)
  })
  it('validates native field types, captured model packets and JSON toolArgs', async () => {
    for (const [payload, settings] of [
      [{ hook_event_name: 'BeforeModel', llm_request: 1 }, { format: 'gemini' }],
      [{ hook_event_name: 'preToolUse', toolName: 'bash', toolArgs: '{' }, { format: 'copilot' }],
      [{ hook_event_name: 'beforeShellExecution', command: 1 }, { format: 'cursor' }],
      [{ hook_event_name: 'preToolUse', toolName: 1, toolArgs: '{}' }, { format: 'copilot' }],
      [
        { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} },
        { format: 'copilot', event: 'sessionStart' },
      ],
    ] as const) {
      const deps = hookDeps()
      const result = await invoke(payload, settings, deps)
      expect(result.code).toBe(2)
      expect(deps.resolveSource).not.toHaveBeenCalled()
      expect(result.output()).toBe('')
    }
  })
  it('refuses invalid hook settings without reflecting private arguments', async () => {
    for (const settings of [
      { format: 'private-unknown' },
      { format: 'muse', event: '' },
      { format: 'muse', extra: 'private-option' },
    ]) {
      const deps = hookDeps()
      const streams = io(JSON.stringify(PAYLOAD))
      // An external JS caller is not constrained by the exported TS type.
      const bad = Object.assign({ format: 'muse' as const }, settings)
      expect(await runJudgeHookCommand(command().options, bad, streams, deps)).toBe(2)
      expect(streams.output() + streams.error()).not.toMatch(/private-/)
      expect(deps.resolveSource).not.toHaveBeenCalled()
    }
  })
  it('bounds the raw input and complete unsplit request including question overhead', async () => {
    for (const [payload, question] of [
      [{ ...PAYLOAD, extra: 'x'.repeat(JUDGE_MAX_BODY_BYTES) }, QUESTION],
      [PAYLOAD, { ...QUESTION, instructions: 'x'.repeat(JUDGE_MAX_BODY_BYTES) }],
    ] as const) {
      const initialize = vi.fn(() => Promise.resolve())
      const deps = { ...hookDeps(), question, initialize }
      const result = await invoke(payload, { format: 'muse' }, deps)
      expect(result.code).toBe(2)
      expect(result.output()).toBe('')
      expect(deps.resolveSource).not.toHaveBeenCalled()
      expect(initialize).not.toHaveBeenCalled()
    }
  })
  it('sanitizes configuration failures without printing private dependency text', async () => {
    const deps = {
      ...hookDeps(),
      cautionText: () => {
        throw new Error('private dependency and account')
      },
    }
    const result = await invoke(PAYLOAD, { format: 'muse' }, deps)
    expect(result.code).toBe(2)
    expect(result.error()).not.toContain('private')
    expect(result.output()).toBe('')
    expect(deps.resolveSource).not.toHaveBeenCalled()
  })
  it('requires bounded runtime caution text and a positive-polarity noul question', async () => {
    for (const text of ['', 'x'.repeat(HOOK_SYSTEM_MESSAGE_MAX_CHARS + 1)]) {
      const deps = { ...hookDeps(), cautionText: () => text }
      const result = await invoke(PAYLOAD, { format: 'muse' }, deps)
      expect(result.code).toBe(2)
      expect(deps.resolveSource).not.toHaveBeenCalled()
    }
    const deps = hookDeps()
    Object.assign(deps, {
      question: { type: 'choice', instructions: 'choose', criteria: { A: null, B: null } },
    })
    const invalid = await invoke(PAYLOAD, { format: 'muse' }, deps)
    expect(invalid.code).toBe(2)
    expect(deps.resolveSource).not.toHaveBeenCalled()
  })
  it('redacts the whole state, preserves additions and never selects the payload model or opens a transcript', async () => {
    const fake = source()
    const payload = {
      ...PAYLOAD,
      transcript_path: '/nonexistent/private-transcript.jsonl',
      future_field: { retained: 'whole state' },
      prompt: 'authorization: Bearer synthetic-private-value',
    }
    fake.judge.mockResolvedValue(riskOutcome())
    const deps = { ...hookDeps(), resolveSource: vi.fn(() => Promise.resolve(fake.value)) }
    const result = await invoke(payload, { format: 'muse' }, deps)
    expect(result.code).toBe(0)
    const calls = vi.mocked(deps.resolveSource).mock.results
    expect(calls.length).toBe(1)
    const request = vi.mocked(fake.value.runtime.judge).mock.calls[0]?.[0]
    expect(request?.state).toContain('whole state')
    expect(request?.state).not.toContain('synthetic-private-value')
    expect(request?.questions).toEqual({ risk: QUESTION })
    expect(deps.resolveSource).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'chosen' }),
      expect.any(AbortSignal),
    )
    expect(result.output() + result.error()).not.toMatch(
      /private-transcript|whole state|payload-model|synthetic-private/,
    )
  })
})
