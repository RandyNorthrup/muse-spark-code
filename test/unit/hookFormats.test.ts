// Lane P tests: the foreign hook-format adapters (PLAN.md M91, D70).
//
// Contract source: docs/certification/m91-research.md (the per-format rows:
// event names, tool maps, exit codes, decision fields, timeouts in ms vs s),
// as the round 2 lead decision allows in place of a wire capture. Every
// stdin/stdout pair below is recorded from those documented examples: the
// test names the documented shape it exercises. Guard rules asserted here:
// each source's fail-closed rules are kept exactly; an adapter parse failure
// is a failure, never allow; a foreign "allow" never skips an approval card
// (it only means "no objection").

import { describe, expect, it } from 'vitest'
import {
  type AdapterEvent,
  buildCopilotStdin,
  buildCursorStdin,
  buildGeminiStdin,
  buildKiroStdin,
  buildWindsurfStdin,
  geminiTimeoutMsToSeconds,
  HOOK_FORMATS,
  parseCopilotResult,
  parseCursorResult,
  parseGeminiResult,
  parseKiroResult,
  parseWindsurfResult,
  type CopilotAdapterOptions,
  type CursorAdapterOptions,
  type ForeignStdinResult,
  type HookFormat,
  type KiroAdapterOptions,
} from '../../src/core/backends/modelapi/hookFormats'

function stdinOf(result: ForeignStdinResult): unknown {
  if (result.outcome !== 'run') {
    throw new Error(`expected run, got ${result.outcome}: ${result.reason}`)
  }
  const parsed: unknown = JSON.parse(result.stdin)
  return parsed
}

function refusalOf(result: ForeignStdinResult): string {
  if (result.outcome !== 'refused') {
    throw new Error(`expected refused, got ${result.outcome}`)
  }
  return result.reason
}

function skipOf(result: ForeignStdinResult): string {
  if (result.outcome !== 'skip') {
    throw new Error(`expected skip, got ${result.outcome}`)
  }
  return result.reason
}

/** Adapters also take extension-only events; refusals name the reason. */
function refusalForExtensionEvent(
  build: (event: AdapterEvent, payload: Record<string, unknown>) => ForeignStdinResult,
  event: AdapterEvent,
): string {
  return refusalOf(build(event, {}))
}

function shellPayload(command: string): Record<string, unknown> {
  return {
    session_id: 'sess_1',
    cwd: '/repo',
    tool_name: 'bash',
    tool_input: { command },
  }
}

describe('hook formats', () => {
  it('covers gemini, cursor, copilot, windsurf and kiro', () => {
    const formats: readonly HookFormat[] = HOOK_FORMATS
    expect(formats).toEqual(['gemini', 'cursor', 'copilot', 'windsurf', 'kiro'])
  })
})

describe('gemini stdin', () => {
  it('translates PreToolUse into BeforeTool with the Gemini tool name', () => {
    expect(stdinOf(buildGeminiStdin('PreToolUse', shellPayload('rm -rf /tmp/x')))).toEqual({
      hook_event_name: 'BeforeTool',
      session_id: 'sess_1',
      cwd: '/repo',
      tool_name: 'run_shell_command',
      tool_input: { command: 'rm -rf /tmp/x' },
    })
  })

  it('maps edit_file to replace and MCP names back to mcp_<server>_<tool>', () => {
    const edit = { tool_name: 'edit_file', tool_input: { path: 'a.ts' } }
    expect(stdinOf(buildGeminiStdin('PreToolUse', edit))).toMatchObject({
      hook_event_name: 'BeforeTool',
      tool_name: 'replace',
    })
    const mcp = { tool_name: 'mcp__fs__read', tool_input: { path: 'a.ts' } }
    expect(stdinOf(buildGeminiStdin('PostToolUse', mcp))).toMatchObject({
      hook_event_name: 'AfterTool',
      tool_name: 'mcp_fs_read',
    })
  })

  it('passes unmapped tool names through unchanged', () => {
    const payload = { tool_name: 'powershell', tool_input: { command: 'dir' } }
    expect(stdinOf(buildGeminiStdin('PreToolUse', payload))).toMatchObject({
      tool_name: 'powershell',
    })
  })

  it('omits tool fields the payload does not carry', () => {
    expect(stdinOf(buildGeminiStdin('PreToolUse', { session_id: 'sess_1' }))).toEqual({
      hook_event_name: 'BeforeTool',
      session_id: 'sess_1',
    })
  })

  it('maps the kept events onto Gemini names', () => {
    expect(stdinOf(buildGeminiStdin('UserPromptSubmit', { prompt: 'hi' }))).toEqual({
      hook_event_name: 'BeforeAgent',
      prompt: 'hi',
    })
    expect(stdinOf(buildGeminiStdin('Stop', {}))).toEqual({ hook_event_name: 'AfterAgent' })
    expect(stdinOf(buildGeminiStdin('PreCompact', {}))).toEqual({ hook_event_name: 'PreCompress' })
    expect(stdinOf(buildGeminiStdin('Notification', { message: 'done' }))).toEqual({
      hook_event_name: 'Notification',
      message: 'done',
    })
    expect(stdinOf(buildGeminiStdin('SessionStart', { session_id: 's' }))).toEqual({
      hook_event_name: 'SessionStart',
      session_id: 's',
    })
  })

  it('refuses the model events whose fields modify the request or response', () => {
    expect(refusalOf(buildGeminiStdin('PreLLMCall', {}))).toContain('BeforeModel')
    expect(refusalOf(buildGeminiStdin('PostLLMCall', {}))).toContain('AfterModel')
    expect(refusalOf(buildGeminiStdin('PermissionRequest', {}))).toContain('gemini')
  })
})

describe('gemini timeout conversion', () => {
  it('converts milliseconds to seconds, rounded up and capped at 600', () => {
    expect(geminiTimeoutMsToSeconds(60_000)).toBe(60)
    expect(geminiTimeoutMsToSeconds(1)).toBe(1)
    expect(geminiTimeoutMsToSeconds(500)).toBe(1)
    expect(geminiTimeoutMsToSeconds(1500)).toBe(2)
    expect(geminiTimeoutMsToSeconds(0)).toBe(1)
    expect(geminiTimeoutMsToSeconds(600_000)).toBe(600)
    expect(geminiTimeoutMsToSeconds(999_999)).toBe(600)
  })

  it('refuses values that are not a non-negative finite number', () => {
    expect(geminiTimeoutMsToSeconds(-1)).toBeUndefined()
    expect(geminiTimeoutMsToSeconds(NaN)).toBeUndefined()
    expect(geminiTimeoutMsToSeconds(Infinity)).toBeUndefined()
    expect(geminiTimeoutMsToSeconds('60000')).toBeUndefined()
    expect(geminiTimeoutMsToSeconds(undefined)).toBeUndefined()
  })
})

describe('gemini stdout', () => {
  it('blocks on exit 2 for BeforeTool, with the stderr reason', () => {
    const answer = parseGeminiResult('PreToolUse', 2, '', 'dangerous command')
    expect(answer).toEqual({ status: 'blocked', reason: 'dangerous command' })
  })

  it('falls back to a fixed reason when exit 2 carries none', () => {
    const answer = parseGeminiResult('PreToolUse', 2, '', '')
    expect(answer.status).toBe('blocked')
    expect(answer.reason).toContain('gemini')
  })

  it('treats exit 2 as a failure where Gemini cannot block', () => {
    expect(parseGeminiResult('Stop', 2, '', 'x').status).toBe('failed')
  })

  it('treats other exits as failures, never allow', () => {
    expect(parseGeminiResult('PreToolUse', 1, '', 'boom').status).toBe('failed')
    expect(parseGeminiResult('PreToolUse', 1, '', '').reason).toContain('1')
    expect(parseGeminiResult('PreToolUse', null, '', '').status).toBe('failed')
  })

  it('accepts empty stdout as no objection', () => {
    expect(parseGeminiResult('PreToolUse', 0, '  ', '')).toEqual({ status: 'completed' })
  })

  it('blocks on a deny decision with its reason', () => {
    const answer = parseGeminiResult(
      'PreToolUse',
      0,
      '{"decision":"deny","reason":"no deletes"}',
      '',
    )
    expect(answer).toEqual({ status: 'blocked', reason: 'no deletes' })
  })

  it('accepts the block alias and defaults a missing reason', () => {
    const answer = parseGeminiResult('PreToolUse', 0, '{"decision":"block"}', '')
    expect(answer.status).toBe('blocked')
    expect(answer.reason).toContain('gemini')
  })

  it('refuses a deny where Gemini cannot block', () => {
    expect(parseGeminiResult('PostToolUse', 0, '{"decision":"deny","reason":"x"}', '').status).toBe(
      'failed',
    )
  })

  it('maps ask to an approval card on PreToolUse only', () => {
    const answer = parseGeminiResult('PreToolUse', 0, '{"decision":"ask"}', '')
    expect(answer).toMatchObject({ status: 'completed', permissionDecision: 'ask' })
    expect(parseGeminiResult('Stop', 0, '{"decision":"ask"}', '').status).toBe('failed')
  })

  it('never turns approve into an approval grant', () => {
    for (const stdout of ['{"decision":"approve"}', '{"decision":"allow"}', '{}']) {
      const answer = parseGeminiResult('PreToolUse', 0, stdout, '')
      expect(answer.status).toBe('completed')
      expect(answer.approvalDecision).toBeUndefined()
      expect(answer.permissionDecision).toBeUndefined()
    }
  })

  it('keeps observation context', () => {
    const answer = parseGeminiResult(
      'PreToolUse',
      0,
      '{"decision":"approve","additionalContext":"uses cache"}',
      '',
    )
    expect(answer.context).toBe('uses cache')
  })

  it('refuses modifying fields, unknown decisions and stray reasons', () => {
    expect(
      parseGeminiResult('PreToolUse', 0, '{"decision":"block","updatedInput":{}}', '').status,
    ).toBe('failed')
    expect(parseGeminiResult('PreToolUse', 0, '{"decision":"rewrite"}', '').status).toBe('failed')
    expect(parseGeminiResult('PreToolUse', 0, '{"reason":"x"}', '').status).toBe('failed')
    expect(parseGeminiResult('PreToolUse', 0, '{"decision":42}', '').status).toBe('failed')
    expect(parseGeminiResult('PreToolUse', 0, 'not json', '').status).toBe('failed')
    expect(parseGeminiResult('PreToolUse', 0, '[1]', '').status).toBe('failed')
  })
})

describe('cursor stdin', () => {
  it('translates shell calls into beforeShellExecution with the command', () => {
    expect(stdinOf(buildCursorStdin('PreToolUse', shellPayload('npm test')))).toEqual({
      hook_event_name: 'beforeShellExecution',
      session_id: 'sess_1',
      cwd: '/repo',
      tool_name: 'bash',
      tool_input: { command: 'npm test' },
      command: 'npm test',
    })
  })

  it('omits the command when the input carries none', () => {
    const stdin = stdinOf(
      buildCursorStdin('PostToolUse', { tool_name: 'powershell', tool_input: { code: 0 } }),
    )
    expect(stdin).toEqual({
      hook_event_name: 'afterShellExecution',
      tool_name: 'powershell',
      tool_input: { code: 0 },
    })
  })

  it('splits MCP, read and edit tools onto their Cursor events', () => {
    const mcp = { tool_name: 'mcp__fs__read', tool_input: { path: 'a' } }
    expect(stdinOf(buildCursorStdin('PreToolUse', mcp))).toMatchObject({
      hook_event_name: 'beforeMCPExecution',
    })
    expect(stdinOf(buildCursorStdin('PostToolUse', mcp))).toMatchObject({
      hook_event_name: 'afterMCPExecution',
    })
    expect(stdinOf(buildCursorStdin('PreToolUse', { tool_name: 'read_file' }))).toMatchObject({
      hook_event_name: 'beforeReadFile',
    })
    expect(stdinOf(buildCursorStdin('PostToolUse', { tool_name: 'write_file' }))).toMatchObject({
      hook_event_name: 'afterFileEdit',
    })
    expect(stdinOf(buildCursorStdin('PostToolUse', { tool_name: 'edit_file' }))).toMatchObject({
      hook_event_name: 'afterFileEdit',
    })
  })

  it('falls back to preToolUse and postToolUse for other tools', () => {
    expect(stdinOf(buildCursorStdin('PreToolUse', { tool_name: 'edit_file' }))).toMatchObject({
      hook_event_name: 'preToolUse',
    })
    expect(stdinOf(buildCursorStdin('PreToolUse', {}))).toMatchObject({
      hook_event_name: 'preToolUse',
    })
    expect(stdinOf(buildCursorStdin('PostToolUse', { tool_name: 'ask_user' }))).toMatchObject({
      hook_event_name: 'postToolUse',
    })
  })

  it('maps the kept events and skips empty text fields', () => {
    expect(stdinOf(buildCursorStdin('UserPromptSubmit', { prompt: 'hi' }))).toEqual({
      hook_event_name: 'beforeSubmitPrompt',
      prompt: 'hi',
    })
    expect(stdinOf(buildCursorStdin('PostLLMCall', { response: 'ok' }))).toEqual({
      hook_event_name: 'afterAgentResponse',
      response: 'ok',
    })
    expect(stdinOf(buildCursorStdin('Stop', {}))).toEqual({ hook_event_name: 'stop' })
    expect(stdinOf(buildCursorStdin('SubagentStop', {}))).toEqual({
      hook_event_name: 'subagentStop',
    })
    expect(stdinOf(buildCursorStdin('PreToolUse', { session_id: '', tool_name: 'bash' }))).toEqual({
      hook_event_name: 'beforeShellExecution',
      tool_name: 'bash',
    })
  })

  it('refuses subagentStart, Tab hooks and workspaceOpen', () => {
    expect(refusalOf(buildCursorStdin('SubagentStart', {}))).toContain('subagentStart')
    expect(refusalForExtensionEvent(buildCursorStdin, 'DirectoryAdded')).toContain('workspaceOpen')
    expect(refusalOf(buildCursorStdin('PermissionRequest', {}))).toContain('cursor')
  })
})

describe('cursor stdout', () => {
  it('denies on exit 2 for permission hooks', () => {
    const answer = parseCursorResult('PreToolUse', 2, '', 'nope')
    expect(answer).toEqual({ status: 'blocked', reason: 'nope' })
  })

  it('falls back to a fixed reason when exit 2 carries none', () => {
    const answer = parseCursorResult('PreToolUse', 2, '', '')
    expect(answer.status).toBe('blocked')
    expect(answer.reason).toContain('cursor')
  })

  it('treats exit 2 as a failure where Cursor cannot decide', () => {
    expect(parseCursorResult('PostToolUse', 2, '', 'x').status).toBe('failed')
  })

  it('fails open on other exits unless the entry is failClosed', () => {
    const options: CursorAdapterOptions = { failClosed: true }
    expect(parseCursorResult('PreToolUse', 1, '', 'boom', options)).toEqual({
      status: 'blocked',
      reason: 'boom',
    })
    expect(parseCursorResult('PreToolUse', null, '', '', options).status).toBe('blocked')
    expect(parseCursorResult('PreToolUse', 1, '', 'boom').status).toBe('failed')
    expect(parseCursorResult('PreToolUse', 1, '', '').reason).toContain('1')
    expect(parseCursorResult('PostToolUse', 1, '', 'boom', options).status).toBe('failed')
  })

  it('blocks on missing JSON only for failClosed permission hooks', () => {
    const options: CursorAdapterOptions = { failClosed: true }
    expect(parseCursorResult('PreToolUse', 0, '  ', '', options).status).toBe('blocked')
    expect(parseCursorResult('PreToolUse', 0, '  ', '')).toEqual({ status: 'completed' })
    expect(parseCursorResult('Stop', 0, '  ', '', options)).toEqual({ status: 'completed' })
  })

  it('blocks on invalid JSON from permission hooks, even without failClosed', () => {
    expect(parseCursorResult('PreToolUse', 0, 'not json', '').status).toBe('blocked')
    expect(parseCursorResult('PostToolUse', 0, 'not json', '').status).toBe('failed')
  })

  it('blocks on deny and forces a card on ask', () => {
    expect(parseCursorResult('PreToolUse', 0, '{"permission":"deny"}', '')).toMatchObject({
      status: 'blocked',
    })
    expect(parseCursorResult('PreToolUse', 0, '{"decision":"deny"}', 'why')).toMatchObject({
      status: 'blocked',
      reason: 'why',
    })
    const ask = parseCursorResult('PreToolUse', 0, '{"permission":"ask"}', '')
    expect(ask).toMatchObject({ status: 'completed', permissionDecision: 'ask' })
    expect(ask.approvalDecision).toBeUndefined()
  })

  it('never turns allow into an approval grant', () => {
    for (const stdout of ['{"permission":"allow"}', '{"decision":"allow"}', '{}']) {
      const answer = parseCursorResult('PreToolUse', 0, stdout, '')
      expect(answer.status).toBe('completed')
      expect(answer.approvalDecision).toBeUndefined()
      expect(answer.permissionDecision).toBeUndefined()
    }
  })

  it('refuses verdicts on events that cannot carry them', () => {
    expect(parseCursorResult('PostToolUse', 0, '{"permission":"deny"}', '').status).toBe('failed')
    expect(parseCursorResult('Stop', 0, '{"decision":"allow"}', '').status).toBe('failed')
    expect(parseCursorResult('PreToolUse', 0, '{"followup_message":"go"}', '').status).toBe(
      'failed',
    )
    expect(parseCursorResult('PostToolUse', 0, '{"followup_message":"go"}', '').status).toBe(
      'failed',
    )
    expect(parseCursorResult('PreToolUse', 0, '{"permission":"maybe"}', '').status).toBe('failed')
    expect(parseCursorResult('PreToolUse', 0, '{"decision":"ask"}', '').status).toBe('failed')
    expect(parseCursorResult('PreToolUse', 0, '{"permission":1}', '').status).toBe('failed')
    expect(parseCursorResult('PreToolUse', 0, '{"permission":"allow","extra":1}', '').status).toBe(
      'failed',
    )
  })

  it('blocks Stop on followup_message', () => {
    expect(parseCursorResult('Stop', 0, '{"followup_message":"keep going"}', '')).toEqual({
      status: 'blocked',
      reason: 'keep going',
    })
    expect(parseCursorResult('SubagentStop', 0, '{"followup_message":"retry"}', '')).toMatchObject({
      status: 'blocked',
    })
    expect(parseCursorResult('Stop', 0, '{"followup_message":"  "}', '').status).toBe('failed')
  })

  it('keeps additional context', () => {
    const answer = parseCursorResult(
      'PreToolUse',
      0,
      '{"permission":"allow","additional_context":"cached"}',
      '',
    )
    expect(answer.context).toBe('cached')
  })
})

describe('copilot stdin', () => {
  it('translates PreToolUse into the flat camelCase shape', () => {
    const payload = {
      session_id: 'sess_7',
      tool_name: 'bash',
      tool_input: { command: 'npm test' },
    }
    expect(stdinOf(buildCopilotStdin('PreToolUse', payload))).toEqual({
      sessionId: 'sess_7',
      toolName: 'bash',
      toolArgs: { command: 'npm test' },
    })
  })

  it('carries the prompt on userPromptSubmitted', () => {
    expect(stdinOf(buildCopilotStdin('UserPromptSubmit', { prompt: 'hi' }))).toEqual({
      prompt: 'hi',
    })
  })

  it('sends cwd only when relative and confined to the workspace', () => {
    const options: CopilotAdapterOptions = { workspaceRoot: '/repo', platform: 'linux' }
    expect(stdinOf(buildCopilotStdin('PreToolUse', { cwd: 'src/a' }, options))).toMatchObject({
      cwd: 'src/a',
    })
    expect(stdinOf(buildCopilotStdin('PreToolUse', { cwd: '/repo/src/a' }, options))).toMatchObject(
      { cwd: 'src/a' },
    )
    expect(stdinOf(buildCopilotStdin('PreToolUse', { cwd: '/repo' }, options))).toMatchObject({
      cwd: '.',
    })
    expect(refusalOf(buildCopilotStdin('PreToolUse', { cwd: '/etc' }, options))).toContain('cwd')
    expect(refusalOf(buildCopilotStdin('PreToolUse', { cwd: '/repo/../etc' }, options))).toContain(
      'cwd',
    )
  })

  it('refuses absolute and escaping cwd without a workspace root', () => {
    expect(refusalOf(buildCopilotStdin('PreToolUse', { cwd: '/repo' }))).toContain('cwd')
    expect(refusalOf(buildCopilotStdin('PreToolUse', { cwd: '../etc' }))).toContain('cwd')
    expect(stdinOf(buildCopilotStdin('PreToolUse', { cwd: 'src' }))).toMatchObject({
      cwd: 'src',
    })
  })

  it('confines Windows paths on win32', () => {
    const options: CopilotAdapterOptions = { workspaceRoot: String.raw`C:\ws`, platform: 'win32' }
    expect(
      stdinOf(buildCopilotStdin('PreToolUse', { cwd: String.raw`C:\ws\sub` }, options)),
    ).toMatchObject({ cwd: 'sub' })
    expect(
      refusalOf(buildCopilotStdin('PreToolUse', { cwd: String.raw`C:\other` }, options)),
    ).toContain('cwd')
  })

  it('always refuses env', () => {
    expect(refusalOf(buildCopilotStdin('PreToolUse', { env: { FOO: '1' } }))).toContain('env')
    expect(refusalOf(buildCopilotStdin('PreToolUse', { environment: { FOO: '1' } }))).toContain(
      'env',
    )
  })

  it('refuses userPromptTransformed and runs the VS Code subset', () => {
    expect(refusalForExtensionEvent(buildCopilotStdin, 'UserPromptExpansion')).toContain(
      'userPromptTransformed',
    )
    const vscode: CopilotAdapterOptions = { flavor: 'vscode' }
    expect(stdinOf(buildCopilotStdin('Stop', {}, vscode))).toEqual({})
    expect(stdinOf(buildCopilotStdin('PreToolUse', { tool_name: 'bash' }, vscode))).toEqual({
      toolName: 'bash',
    })
    expect(refusalOf(buildCopilotStdin('TaskCreated', {}, vscode))).toContain('copilot')
    expect(refusalOf(buildCopilotStdin('StopFailure', {}, vscode))).toContain('copilot')
  })
})

describe('copilot stdout', () => {
  it('denies preToolUse errors: non-zero exits, crashes and invalid JSON', () => {
    expect(parseCopilotResult('PreToolUse', 1, '', 'boom').status).toBe('blocked')
    expect(parseCopilotResult('PreToolUse', 2, '', '').reason).toContain('copilot')
    expect(parseCopilotResult('PreToolUse', null, '', '').status).toBe('blocked')
    expect(parseCopilotResult('PermissionRequest', 1, '', '').status).toBe('blocked')
    expect(parseCopilotResult('PreToolUse', 0, 'not json', '').status).toBe('blocked')
    expect(parseCopilotResult('PostToolUse', 1, '', 'boom').status).toBe('failed')
    expect(parseCopilotResult('Stop', 0, 'not json', '').status).toBe('failed')
  })

  it('blocks on deny, with approvalDecision on permissionRequest', () => {
    const denied = parseCopilotResult(
      'PreToolUse',
      0,
      '{"permissionDecision":"deny","permissionDecisionReason":"policy"}',
      '',
    )
    expect(denied).toMatchObject({ status: 'blocked', reason: 'policy' })
    expect(denied.approvalDecision).toBeUndefined()
    const asked = parseCopilotResult(
      'PermissionRequest',
      0,
      '{"permissionDecision":"deny","permissionDecisionReason":"policy"}',
      '',
    )
    expect(asked).toMatchObject({ status: 'blocked', approvalDecision: 'deny' })
    const fallback = parseCopilotResult('PreToolUse', 0, '{"permissionDecision":"deny"}', '')
    expect(fallback.status).toBe('blocked')
    expect(fallback.reason).toContain('copilot')
  })

  it('forces a card on ask for guard events only', () => {
    const ask = parseCopilotResult('PreToolUse', 0, '{"permissionDecision":"ask"}', '')
    expect(ask).toMatchObject({ status: 'completed', permissionDecision: 'ask' })
    expect(ask.approvalDecision).toBeUndefined()
    expect(parseCopilotResult('PostToolUse', 0, '{"permissionDecision":"ask"}', '').status).toBe(
      'failed',
    )
    expect(parseCopilotResult('PostToolUse', 0, '{"permissionDecision":"deny"}', '').status).toBe(
      'failed',
    )
  })

  it('never turns allow into an approval grant', () => {
    const answer = parseCopilotResult(
      'PreToolUse',
      0,
      '{"permissionDecision":"allow","modifiedArgs":{"command":"ls"}}',
      '',
    )
    expect(answer.status).toBe('completed')
    expect(answer.approvalDecision).toBeUndefined()
    expect(answer.permissionDecision).toBeUndefined()
    expect(answer.updatedInput).toEqual({ command: 'ls' })
    expect(parseCopilotResult('PreToolUse', 0, '', '').approvalDecision).toBeUndefined()
  })

  it('refuses rewrites and reasons where they do not belong', () => {
    expect(parseCopilotResult('PermissionRequest', 0, '{"modifiedArgs":{"a":1}}', '').status).toBe(
      'failed',
    )
    expect(parseCopilotResult('PreToolUse', 0, '{"permissionDecisionReason":"x"}', '').status).toBe(
      'failed',
    )
    expect(parseCopilotResult('PreToolUse', 0, '{"permissionDecision":"yes"}', '').status).toBe(
      'failed',
    )
    expect(parseCopilotResult('PreToolUse', 0, '{"modifiedArgs":"x"}', '').status).toBe('failed')
    expect(parseCopilotResult('PreToolUse', 0, '{"unknown":1}', '').status).toBe('failed')
  })

  it('keeps additional context', () => {
    const answer = parseCopilotResult('PostToolUse', 0, '{"additionalContext":"cached"}', '')
    expect(answer).toMatchObject({ status: 'completed', context: 'cached' })
  })
})

describe('windsurf stdin', () => {
  it('translates shell calls into pre_run_command', () => {
    expect(stdinOf(buildWindsurfStdin('PreToolUse', shellPayload('npm test')))).toEqual({
      command_string: 'npm test',
    })
  })

  it('translates reads, writes and MCP calls onto their kinds', () => {
    expect(
      stdinOf(
        buildWindsurfStdin('PreToolUse', { tool_name: 'read_file', tool_input: { path: 'a.ts' } }),
      ),
    ).toEqual({ file_path: 'a.ts' })
    expect(
      stdinOf(
        buildWindsurfStdin('PostToolUse', {
          tool_name: 'write_file',
          tool_input: { file_path: 'a.ts', content: 'hi' },
        }),
      ),
    ).toEqual({ file_path: 'a.ts', code: 'hi' })
    expect(
      stdinOf(
        buildWindsurfStdin('PreToolUse', {
          tool_name: 'mcp__fs__read',
          tool_input: { arguments: { path: 'a' } },
        }),
      ),
    ).toEqual({ tool_name: 'read', mcp_server_name: 'fs', arguments: { path: 'a' } })
  })

  it('reads the code fallback and tolerates missing optionals', () => {
    expect(
      stdinOf(
        buildWindsurfStdin('PreToolUse', {
          tool_name: 'edit_file',
          tool_input: { file_path: 'a.ts', code: 'x' },
        }),
      ),
    ).toEqual({ file_path: 'a.ts', code: 'x' })
    expect(
      stdinOf(
        buildWindsurfStdin('PreToolUse', {
          tool_name: 'edit_file',
          tool_input: { file_path: 'a.ts', content: '', code: '' },
        }),
      ),
    ).toEqual({ file_path: 'a.ts' })
    expect(
      stdinOf(
        buildWindsurfStdin('PostToolUse', {
          tool_name: 'bash',
          tool_input: { command: 'npm test' },
          exit_code: 0,
          output: 'ok',
        }),
      ),
    ).toEqual({ command_string: 'npm test', exit_code: 0, output_snippet: 'ok' })
    expect(
      stdinOf(
        buildWindsurfStdin('PostToolUse', { tool_name: 'bash', tool_input: { command: 'ls' } }),
      ),
    ).toEqual({ command_string: 'ls' })
  })

  it('maps prompts, responses and worktrees', () => {
    expect(stdinOf(buildWindsurfStdin('UserPromptSubmit', { prompt: 'hi' }))).toEqual({
      prompt: 'hi',
    })
    expect(stdinOf(buildWindsurfStdin('Stop', {}))).toEqual({})
    expect(stdinOf(buildWindsurfStdin('Stop', { stop_reason: 'end' }))).toEqual({
      stop_reason: 'end',
    })
    expect(stdinOf(buildWindsurfStdin('WorktreeCreate', { worktree_path: 'w' }))).toEqual({
      worktree_path: 'w',
    })
  })

  it('refuses shapes Windsurf cannot judge', () => {
    expect(refusalOf(buildWindsurfStdin('PreToolUse', { tool_name: 'ask_user' }))).toContain(
      'windsurf',
    )
    expect(refusalOf(buildWindsurfStdin('PreLLMCall', {}))).toContain('windsurf')
    expect(
      refusalOf(buildWindsurfStdin('PreToolUse', { tool_name: 'bash', tool_input: {} })),
    ).toContain('command')
    expect(
      refusalOf(buildWindsurfStdin('PreToolUse', { tool_name: 'read_file', tool_input: {} })),
    ).toContain('file path')
    expect(
      refusalOf(buildWindsurfStdin('PreToolUse', { tool_name: 'mcp__x', tool_input: {} })),
    ).toContain('MCP tool')
    expect(refusalOf(buildWindsurfStdin('UserPromptSubmit', {}))).toContain('prompt')
  })
})

describe('windsurf stdout', () => {
  it('ignores stdout: exit 0 proceeds', () => {
    const answer = parseWindsurfResult('PreToolUse', 0, '{"anything":true}', '')
    expect(answer).toEqual({ status: 'completed' })
  })

  it('blocks on exit 2 for pre events, with the stderr message', () => {
    expect(parseWindsurfResult('PreToolUse', 2, '', 'blocked by policy')).toEqual({
      status: 'blocked',
      reason: 'blocked by policy',
    })
    expect(parseWindsurfResult('UserPromptSubmit', 2, '', '')).toMatchObject({
      status: 'blocked',
    })
  })

  it('fails the WorktreeCreate attempt on exit 2', () => {
    expect(parseWindsurfResult('WorktreeCreate', 2, '', 'no disk')).toEqual({
      status: 'blocked',
      reason: 'no disk',
    })
  })

  it('treats exit 2 on post events as a failure, never a block', () => {
    expect(parseWindsurfResult('PostToolUse', 2, '', 'x').status).toBe('failed')
    expect(parseWindsurfResult('Stop', 2, '', 'x').status).toBe('failed')
  })

  it('treats other exits as failures, never allow', () => {
    expect(parseWindsurfResult('PreToolUse', 1, '', '').status).toBe('failed')
    expect(parseWindsurfResult('PreToolUse', null, '', '').status).toBe('failed')
  })
})

describe('kiro stdin', () => {
  it('translates tool calls into Kiro tool names', () => {
    expect(stdinOf(buildKiroStdin('PreToolUse', shellPayload('ls')))).toEqual({
      hook_event_name: 'PreToolUse',
      session_id: 'sess_1',
      cwd: '/repo',
      tool_name: 'execute_bash',
      tool_input: { command: 'ls' },
    })
    expect(stdinOf(buildKiroStdin('PreToolUse', { tool_name: 'read_file' }))).toMatchObject({
      tool_name: 'fs_read',
    })
    expect(stdinOf(buildKiroStdin('PreToolUse', { tool_name: 'write_file' }))).toMatchObject({
      tool_name: 'fs_write',
    })
    expect(stdinOf(buildKiroStdin('PreToolUse', { tool_name: 'edit_file' }))).toMatchObject({
      tool_name: 'fs_write',
    })
    expect(stdinOf(buildKiroStdin('PreToolUse', { tool_name: 'powershell' }))).toMatchObject({
      tool_name: 'execute_bash',
    })
    expect(stdinOf(buildKiroStdin('PreToolUse', { tool_name: 'ask_user' }))).toMatchObject({
      tool_name: 'ask_user',
    })
  })

  it('carries prompts, responses and task triggers', () => {
    expect(stdinOf(buildKiroStdin('UserPromptSubmit', { prompt: 'hi' }))).toEqual({
      hook_event_name: 'UserPromptSubmit',
      prompt: 'hi',
    })
    expect(
      stdinOf(
        buildKiroStdin('PostToolUse', {
          tool_name: 'read_file',
          tool_input: { path: 'a' },
          tool_response: { content: 'hi' },
        }),
      ),
    ).toMatchObject({ tool_response: { content: 'hi' } })
    expect(stdinOf(buildKiroStdin('TaskCreated', {}))).toMatchObject({
      hook_event_name: 'PreTaskExec',
    })
    expect(stdinOf(buildKiroStdin('TaskCompleted', {}))).toMatchObject({
      hook_event_name: 'PostTaskExec',
    })
  })

  it('applies a file trigger path regex before running', () => {
    const fileHook: KiroAdapterOptions = {
      trigger: 'PostFileCreate',
      pathPattern: String.raw`\.ts$`,
    }
    const match = { tool_name: 'write_file', tool_input: { file_path: 'src/a.ts' } }
    expect(stdinOf(buildKiroStdin('PostToolUse', match, fileHook))).toMatchObject({
      hook_event_name: 'PostFileCreate',
      tool_name: 'fs_write',
    })
    const miss = { tool_name: 'write_file', tool_input: { file_path: 'src/a.md' } }
    expect(skipOf(buildKiroStdin('PostToolUse', miss, fileHook))).toContain('scope')
    expect(skipOf(buildKiroStdin('PostToolUse', { tool_name: 'bash' }, fileHook))).toContain(
      'file path',
    )
  })

  it('reads the file path from top-level payload fields', () => {
    const hook: KiroAdapterOptions = { pathPattern: '^src/' }
    expect(
      stdinOf(buildKiroStdin('PostToolUse', { tool_name: 'edit_file', path: 'src/a' }, hook)),
    ).toMatchObject({ hook_event_name: 'PostToolUse' })
  })

  it('refuses invalid patterns, overlong paths, unknown triggers and Manual', () => {
    const badPattern: KiroAdapterOptions = { pathPattern: '([' }
    const payload = { tool_name: 'write_file', tool_input: { file_path: 'a.ts' } }
    expect(refusalOf(buildKiroStdin('PostToolUse', payload, badPattern))).toContain('pattern')
    const longPath: KiroAdapterOptions = { pathPattern: '.*' }
    expect(
      refusalOf(
        buildKiroStdin(
          'PostToolUse',
          { tool_input: { file_path: `x/${'a'.repeat(300)}` } },
          longPath,
        ),
      ),
    ).toContain('too long')
    const badTrigger: KiroAdapterOptions = { trigger: 'Nope' }
    expect(refusalOf(buildKiroStdin('PreToolUse', {}, badTrigger))).toContain('trigger')
    expect(refusalForExtensionEvent(buildKiroStdin, 'Manual')).toContain('Manual')
    expect(refusalOf(buildKiroStdin('PreLLMCall', {}))).toContain('kiro')
  })
})

describe('kiro stdout', () => {
  it('blocks only on exit 2', () => {
    expect(parseKiroResult('PreToolUse', 2, '', 'policy says no')).toEqual({
      status: 'blocked',
      reason: 'policy says no',
    })
    expect(parseKiroResult('Stop', 2, '', '')).toMatchObject({ status: 'blocked' })
    expect(parseKiroResult('PreToolUse', 1, '', 'boom').status).toBe('failed')
    expect(parseKiroResult('PreToolUse', 3, '', '').status).toBe('failed')
    expect(parseKiroResult('PreToolUse', null, '', '').status).toBe('failed')
  })

  it('injects success stdout as bounded context, never as a grant', () => {
    const answer = parseKiroResult('PreToolUse', 0, '  lints clean  ', '')
    expect(answer.status).toBe('completed')
    expect(answer.context).toBe('lints clean')
    expect(answer.approvalDecision).toBeUndefined()
    expect(parseKiroResult('PreToolUse', 0, '  ', '')).toEqual({ status: 'completed' })
    const long = parseKiroResult('PostToolUse', 0, `y/${'y'.repeat(2000)}`, '')
    expect(long.context?.length).toBe(1024)
  })
})
