import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildForeignStdin,
  parseForeignResult,
  type AdapterEvent,
  type HookFormat,
} from '../../src/core/backends/modelapi/hookFormats'
import { HOOK_EVENTS, parseHookAnswer } from '../../src/core/backends/modelapi/hooks'
import { parseExtensionHookAnswer } from '../../src/core/backends/modelapi/extensionHooks'
import type { JudgeHookCliSettings } from '../../src/runtime/judge/hook'
import { command, source } from './judgeCliFixtures'
import { CAUTION, PAYLOAD, capture, hookDeps, invoke, riskOutcome } from './judgeHookCliFixtures'

afterEach(() => vi.restoreAllMocks())

function foreignPayload(format: HookFormat, event: string, muse: AdapterEvent = 'PreToolUse') {
  const built = buildForeignStdin(
    format,
    muse,
    { ...PAYLOAD, cwd: '/workspace', tool_response: 'clean' },
    // The borrowed POSIX fixtures need their platform at main's path boundary.
    { sourceEvent: event, platform: 'linux', workspaceRoot: '/workspace' },
  )
  if (built.outcome !== 'run') throw new Error('fixture build refused')
  const payload: unknown = JSON.parse(built.stdin)
  return payload
}

const SUPPORTED = [
  [{ format: 'muse' }, PAYLOAD],
  [{ format: 'muse', event: 'WorktreeCreate' }, { hook_event_name: 'WorktreeCreate' }],
  [{ format: 'claude' }, capture('claude/PreToolUse.Bash.json')],
  [{ format: 'vscode' }, foreignPayload('copilot', 'PreToolUse')],
  [{ format: 'gemini' }, capture('gemini/BeforeTool.run_shell_command.json')],
  [{ format: 'copilot', event: 'preToolUse' }, foreignPayload('copilot', 'preToolUse')],
  [{ format: 'copilot' }, foreignPayload('copilot', 'PreToolUse')],
  [
    { format: 'cursor', event: 'postToolUse' },
    foreignPayload('cursor', 'postToolUse', 'PostToolUse'),
  ],
] as const

function consumer(settings: JudgeHookCliSettings, code: number, stdout: string) {
  if (settings.event === 'WorktreeCreate')
    return parseExtensionHookAnswer('WorktreeCreate', code, stdout, '')
  if (settings.format === 'muse' || settings.format === 'claude')
    return parseHookAnswer('PreToolUse', code, stdout, '')
  return parseForeignResult(
    settings.format === 'vscode' ? 'copilot' : settings.format,
    settings.event === 'postToolUse' ? 'PostToolUse' : 'PreToolUse',
    code,
    stdout,
    '',
    {
      sourceEvent: settings.event,
      flavor: settings.format === 'vscode' ? 'vscode' : undefined,
      failClosed: true,
    },
  )
}

describe('judge hook host-specific contracts (RVM98GH)', () => {
  it.each(['preToolUse', 'beforeShellExecution', 'beforeMCPExecution'])(
    'keeps Cursor %s unavailable before inference because abstention needs a grant',
    async (event) => {
      let payload: unknown = foreignPayload('cursor', 'preToolUse')
      if (event === 'beforeMCPExecution')
        payload = {
          hook_event_name: event,
          tool_name: 'status',
          tool_input: '{}',
          mcp_server_name: 'git',
        }
      else if (event === 'beforeShellExecution')
        payload = { hook_event_name: event, command: 'git status' }
      for (const outcome of [
        riskOutcome(0),
        riskOutcome(),
        { outcome: 'no-answer', reason: 'source-unavailable' },
      ] as const) {
        const fake = source()
        fake.judge.mockResolvedValue(outcome)
        const deps = hookDeps(fake.value)
        const result = await invoke(payload, { format: 'cursor', event }, deps)
        expect(result.code).toBe(4)
        expect(result.output()).toBe('')
        expect(deps.resolveSource).not.toHaveBeenCalled()
        expect(fake.judge).not.toHaveBeenCalled()
      }
    },
  )
  it('safe supported results preserve each host default checks and validated neutral output', async () => {
    for (const [settings, payload] of SUPPORTED) {
      const fake = source()
      fake.judge.mockResolvedValue(riskOutcome(0))
      const deps = hookDeps(fake.value)
      const result = await invoke(payload, settings, deps)
      expect(deps.resolveSource).toHaveBeenCalledOnce()
      expect(fake.judge).toHaveBeenCalledOnce()
      expect(result.output()).toBe(settings.format === 'cursor' ? '{}\n' : '')
      expect(result.code).toBe(0)
      expect(consumer(settings, result.code, result.output()).status).toBe('completed')
      expect(result.output()).not.toMatch(/allow|deny|ask|permission|caution|modified|updated/)
    }
  })
  it('emits exactly one caution for a risky Cursor observation', async () => {
    const payload = foreignPayload('cursor', 'postToolUse', 'PostToolUse')
    const settings = { format: 'cursor', event: 'postToolUse' } as const
    const result = await invoke(payload, settings)
    expect(result.code).toBe(0)
    expect(JSON.parse(result.output())).toEqual({ additional_context: CAUTION })
    expect(consumer(settings, result.code, result.output()).status).toBe('completed')
  })
  it('keeps Copilot JSON-object arguments intact through explicit paid admission', async () => {
    const payload = foreignPayload('copilot', 'preToolUse')
    const fake = source('paid', 0.01)
    const admitPaid = vi.fn(() => Promise.resolve(riskOutcome()))
    const result = await invoke(
      payload,
      { format: 'copilot', event: 'preToolUse' },
      { ...hookDeps(fake.value), admitPaid },
      command('ask', ['--model', 'chosen', '--budget-usd', '1']).options,
    )
    expect(result.code).toBe(0)
    expect(admitPaid).toHaveBeenCalledOnce()
    expect(fake.judge).not.toHaveBeenCalled()
    expect(
      consumer({ format: 'copilot', event: 'preToolUse' }, result.code, result.output()).status,
    ).toBe('completed')
  })
  it('no answer from budget, unavailable, failed or partial sources never vetoes a supported host', async () => {
    for (const [settings, payload] of SUPPORTED) {
      for (const reason of ['zero-budget', 'unavailable', 'failed', 'partial', 'no-answer']) {
        const fake = source(reason === 'zero-budget' ? 'paid' : 'free', 0.01)
        fake.judge.mockResolvedValue(
          reason === 'partial'
            ? riskOutcome(1, true)
            : { outcome: 'no-answer', reason: 'source-unavailable' },
        )
        if (reason === 'failed') fake.judge.mockRejectedValue(new Error('private provider failure'))
        const deps = hookDeps(fake.value)
        if (reason === 'unavailable') deps.resolveSource = vi.fn(() => Promise.resolve(undefined))
        const result = await invoke(payload, settings, deps)
        expect(deps.resolveSource).toHaveBeenCalledOnce()
        expect(result.output()).toBe(settings.format === 'cursor' ? '{}\n' : '')
        expect(result.code).toBe(0)
        expect(consumer(settings, result.code, result.output()).status).toBe('completed')
        expect(result.output() + result.error()).not.toMatch(
          /allow|deny|ask|permission|caution|private/,
        )
        if (reason === 'zero-budget') expect(fake.judge).not.toHaveBeenCalled()
      }
    }
  })
  it.each([
    'SessionStart',
    'SessionEnd',
    'UserPromptSubmit',
    'PreToolUse.Bash',
    'PostToolUse.Bash',
    'Stop',
  ])('uses Claude own captured %s event instead of the VS Code Local table', async (file) => {
    const payload = capture(`claude/${file}.json`)
    const deps = hookDeps()
    const result = await invoke(payload, { format: 'claude' }, deps)
    expect(result.code).toBe(0)
    if (file === 'SessionEnd') {
      expect(deps.resolveSource).not.toHaveBeenCalled()
      expect(result.output()).toBe('')
    } else {
      expect(deps.resolveSource).toHaveBeenCalledOnce()
      expect(result.output()).toContain(CAUTION)
    }
    const event = HOOK_EVENTS.find((name) => name === file.split('.', 1)[0])
    if (event === undefined) throw new Error('captured event is absent from native parser')
    expect(parseHookAnswer(event, result.code, result.output(), '').status).toBe('completed')
  })
  it('keeps unrecorded Claude events and VS Code unavailable events out of inference', async () => {
    for (const [format, event] of [
      ['claude', 'SessionFork'],
      ['vscode', 'SessionEnd'],
    ] as const) {
      const deps = hookDeps()
      const result = await invoke({ hook_event_name: event }, { format }, deps)
      expect(result.code).toBe(2)
      expect(deps.resolveSource).not.toHaveBeenCalled()
    }
  })
  it.each([
    ['claude', 'PreToolUse', 'tool_input'],
    ['vscode', 'PreToolUse', 'tool_input'],
    ['gemini', 'BeforeTool', 'tool_input'],
    ['copilot', 'PreToolUse', 'tool_input'],
    ['copilot', 'preToolUse', 'toolArgs'],
    ['cursor', 'preToolUse', 'tool_input'],
    ['cursor', 'beforeMCPExecution', 'tool_input'],
  ] as const)(
    'strictly rejects malformed %s/%s %s before paid admission',
    async (format, event, field) => {
      let original: unknown
      switch (format) {
        case 'claude': {
          original = capture('claude/PreToolUse.Bash.json')
          break
        }
        case 'gemini': {
          original = capture('gemini/BeforeTool.run_shell_command.json')
          break
        }
        case 'vscode': {
          original = { ...PAYLOAD, tool_name: 'Bash' }
          break
        }
        default: {
          if (event === 'beforeMCPExecution')
            original = {
              hook_event_name: event,
              tool_name: 'status',
              tool_input: '{}',
              mcp_server_name: 'git',
            }
          else original = foreignPayload(format, event)
        }
      }
      for (const invalid of ['invalid string', '"string"', '[]', 'null', '1', 1, [], null]) {
        const fake = source('paid', 0.01)
        const initialize = vi.fn(() => Promise.resolve())
        const admitPaid = vi.fn(() => Promise.resolve(riskOutcome()))
        const deps = { ...hookDeps(fake.value), initialize, admitPaid }
        const payload = Object.assign({}, original, { [field]: invalid })
        const result = await invoke(
          payload,
          { format, event },
          deps,
          command('ask', ['--model', 'chosen', '--budget-usd', '1']).options,
        )
        expect(result.code).toBe(2)
        expect(result.output()).toBe('')
        expect(initialize).not.toHaveBeenCalled()
        expect(deps.resolveSource).not.toHaveBeenCalled()
        expect(admitPaid).not.toHaveBeenCalled()
      }
    },
  )
})
