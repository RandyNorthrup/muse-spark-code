// M91 lane P regressions, round 3. Each test names the review finding it
// guards (RVM91P2 #n, RVM91P #n) or the round-3 contract correction (R3-n),
// with the saved source line it follows (paths relative to hooks-parity/).
// Fake-only: no vendor CLI and no model call.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { buildSync } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  type AdapterEvent,
  type ForeignStdinResult,
  buildCopilotStdin,
  buildCursorStdin,
  buildForeignStdin,
  buildGeminiStdin,
  buildKiroStdin,
  buildWindsurfStdin,
  confineHookCwd,
  geminiTimeoutMsToSeconds,
  parseCopilotResult,
  parseCursorResult,
  parseForeignResult,
  parseGeminiResult,
  parseKiroResult,
  parseWindsurfResult,
} from '../../src/core/backends/modelapi/hookFormats'

// Fixtures use POSIX paths; Windows semantics are tested with platform: 'win32'.
const cursorIn: typeof buildCursorStdin = (e, p, o) =>
  buildCursorStdin(e, p, { platform: 'linux', ...o })
const copilotIn: typeof buildCopilotStdin = (e, p, o) =>
  buildCopilotStdin(e, p, { platform: 'linux', ...o })
const windsurfIn: typeof buildWindsurfStdin = (e, p, o) =>
  buildWindsurfStdin(e, p, { platform: 'linux', ...o })
const geminiIn: typeof buildGeminiStdin = (e, p, o) =>
  buildGeminiStdin(e, p, { platform: 'linux', ...o })
const kiroIn: typeof buildKiroStdin = (e, p, o) => buildKiroStdin(e, p, { platform: 'linux', ...o })

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function stdinOf(result: ForeignStdinResult): Record<string, unknown> {
  if (result.outcome !== 'run') throw new Error(`${result.outcome}: ${result.reason}`)
  const value: unknown = JSON.parse(result.stdin)
  if (!isObject(value)) throw new Error('stdin is not an object')
  return value
}
/** The guard from RVM91P2 #1: deny database === "production". */
function isProductionCall(args: unknown): boolean {
  return isObject(args) && args['database'] === 'production'
}
function objectAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const found = value[key]
  if (!isObject(found)) throw new Error(`${key} is not an object`)
  return found
}

const ROOT = '/project'
const preview = 'line 1\n{"ok":true}\n'
const shell = {
  session_id: 'session-123',
  turn_id: 'turn-1',
  cwd: ROOT,
  tool_name: 'bash',
  tool_input: { command: 'npm install' },
}
const post = { ...shell, tool_response: preview }
// RVM91P2 #1 scenario: a legitimate argument named `arguments` beside others.
const mcpCall = {
  session_id: 'session-123',
  cwd: ROOT,
  tool_name: 'mcp__db__query',
  tool_input: { arguments: { sql: 'SELECT 1' }, database: 'production' },
}
const readCall = {
  session_id: 'session-123',
  cwd: ROOT,
  tool_name: 'read_file',
  tool_input: { path: 'private/keys.txt' },
  content: 'secret',
}

describe('RVM91P2 findings', () => {
  it('#1 MCP arguments pass as-is to Cursor and Windsurf (CH:1078, W:283-288)', () => {
    const cursor = stdinOf(cursorIn('PreToolUse', mcpCall, { sourceEvent: 'beforeMCPExecution' }))
    const params: unknown = JSON.parse(String(cursor['tool_input']))
    expect(params).toEqual(mcpCall.tool_input)
    const windsurf = stdinOf(windsurfIn('PreToolUse', mcpCall))
    expect(windsurf['tool_info']).toMatchObject({ mcp_tool_arguments: mcpCall.tool_input })
    expect(isProductionCall(params)).toBe(true)
    expect(isProductionCall(objectAt(windsurf, 'tool_info')['mcp_tool_arguments'])).toBe(true)
    expect(stdinOf(cursorIn('PreToolUse', mcpCall))['tool_input']).toEqual(mcpCall.tool_input)
  })

  it('#2 Cursor beforeReadFile file_path is absolute (CH:1171)', () => {
    const stdin = stdinOf(cursorIn('PreToolUse', readCall, { sourceEvent: 'beforeReadFile' }))
    expect(stdin['file_path']).toBe('/project/private/keys.txt')
    expect(String(stdin['file_path']).startsWith('/project/private/')).toBe(true)
    const noRoot = { ...readCall, cwd: undefined }
    expect(cursorIn('PreToolUse', noRoot, { sourceEvent: 'beforeReadFile' }).outcome).toBe(
      'refused',
    )
    const win = { ...readCall, cwd: String.raw`C:\ws`, tool_input: { path: String.raw`src\a.ts` } }
    expect(
      stdinOf(cursorIn('PreToolUse', win, { sourceEvent: 'beforeReadFile', platform: 'win32' }))[
        'file_path'
      ],
    ).toBe(String.raw`C:\ws\src\a.ts`)
    for (const bad of ['D:x', String.raw`\\server\share\x`, String.raw`\\?\C:\x`, String.raw`\x`])
      expect(
        buildCursorStdin(
          'PreToolUse',
          { ...win, tool_input: { path: bad } },
          { sourceEvent: 'beforeReadFile', platform: 'win32' },
        ).outcome,
      ).toBe('refused')
  })

  it('#3 Copilot camelCase hooks get native tool names (C:832-843)', () => {
    const expected = { edit_file: 'edit', write_file: 'create', read_file: 'view', bash: 'bash' }
    for (const [muse, native] of Object.entries(expected)) {
      const stdin = stdinOf(copilotIn('PreToolUse', { ...shell, tool_name: muse }))
      expect(stdin['toolName']).toBe(native)
      expect(['edit', 'create', 'view', 'bash'].includes(String(stdin['toolName']))).toBe(true)
    }
    const pascal = { sourceEvent: 'PreToolUse' }
    expect(
      stdinOf(copilotIn('PreToolUse', { ...shell, tool_name: 'edit_file' }, pascal))['tool_name'],
    ).toBe('Edit')
    expect(
      stdinOf(copilotIn('PreToolUse', { ...shell, tool_name: 'read_file' }, pascal))['tool_name'],
    ).toBe('Read')
    expect(
      stdinOf(copilotIn('PreToolUse', { ...shell, tool_name: 'read_file' }, { flavor: 'vscode' }))[
        'tool_name'
      ],
    ).toBe('read_file')
  })

  it.each([null, 1, 3])(
    '#4 beforeSubmitPrompt honours failClosed on exit %s (CH:707)',
    (exitCode) => {
      expect(
        parseCursorResult('UserPromptSubmit', exitCode, '', 'boom', { failClosed: true }).status,
      ).toBe('blocked')
      expect(parseCursorResult('UserPromptSubmit', exitCode, '', 'boom').status).toBe('failed')
    },
  )

  it('#4 beforeSubmitPrompt failClosed covers no output and invalid output', () => {
    expect(parseCursorResult('UserPromptSubmit', 0, '', '', { failClosed: true }).status).toBe(
      'blocked',
    )
    expect(parseCursorResult('UserPromptSubmit', 0, '', '').status).toBe('completed')
    expect(parseCursorResult('UserPromptSubmit', 0, '{', '', { failClosed: true }).status).toBe(
      'blocked',
    )
    expect(parseCursorResult('UserPromptSubmit', 0, '{', '').status).toBe('failed')
  })

  it('#5 Cursor MCP output replacement keeps its context (CH:905-920)', () => {
    const output = '{"updated_mcp_tool_output":{"redacted":true},"additional_context":"redacted"}'
    expect(parseCursorResult('PostToolUse', 0, output, '', { input: mcpCall })).toEqual({
      status: 'completed',
      context: 'redacted',
      replacement: { target: 'toolResult', value: { redacted: true } },
    })
    // "For MCP tools only": a shell result is not replaced; context survives.
    expect(parseCursorResult('PostToolUse', 0, output, '', { input: post })).toEqual({
      status: 'completed',
      context: 'redacted',
    })
  })

  it('#5 Copilot modifiedResult and modifiedResponse are adapter results (C:713-735, C:702-706)', () => {
    const output =
      '{"modifiedResult":{"resultType":"success","textResultForLlm":"[redacted]"},"additionalContext":"note"}'
    expect(parseCopilotResult('PostToolUse', 0, output, '')).toEqual({
      status: 'completed',
      context: 'note',
      replacement: { target: 'toolResult', value: '[redacted]' },
    })
    expect(parseCopilotResult('SubagentStop', 0, '{"modifiedResponse":"short"}', '')).toMatchObject(
      {
        replacement: { target: 'subagentResponse', value: 'short' },
      },
    )
    const both = '{"decision":"block","reason":"verify","modifiedResponse":"short"}'
    expect(parseCopilotResult('SubagentStop', 0, both, '')).toEqual({
      status: 'blocked',
      reason: 'verify',
    })
    const failure = '{"modifiedResult":{"resultType":"failure","textResultForLlm":"x"}}'
    expect(parseCopilotResult('PostToolUse', 0, failure, '').status).toBe('failed')
  })

  it('#6 Gemini model events refuse the runtime summaries (no llm_request)', () => {
    // The keys preModelCallFields/postModelCallFields emit (modelCallHooks.ts:100-160).
    const summary = {
      session_id: 's',
      cwd: ROOT,
      provider: 'meta',
      request_id: 'r',
      attempt: 1,
      step: 1,
      messages: [],
      message_count: 0,
      tools: [],
      tool_count: 0,
    }
    for (const event of ['PreLLMCall', 'PostLLMCall', 'BeforeToolSelection'] as const)
      expect(buildGeminiStdin(event, summary)).toMatchObject({ outcome: 'refused' })
    const request = { model: 'gemini-2.5-flash', messages: [], config: {} }
    expect(
      stdinOf(geminiIn('PreLLMCall', { ...summary, llm_request: request }))['llm_request'],
    ).toEqual(request)
    expect(geminiIn('PostLLMCall', { ...summary, llm_request: request }).outcome).toBe('refused')
  })

  it('#7 a veto keeps its user warning and context (V:84-98, R:69-71)', () => {
    const gemini =
      '{"decision":"deny","reason":"policy","systemMessage":"warn","hookSpecificOutput":{"additionalContext":"ctx"}}'
    expect(parseGeminiResult('PreLLMCall', 0, gemini, '')).toEqual({
      status: 'blocked',
      reason: 'policy',
      systemMessage: 'warn',
      context: 'ctx',
    })
    // vsc/hooks-reference.md:87-91, verbatim.
    const local =
      '{"continue":false,"stopReason":"Security policy violation","systemMessage":"Review the hook result."}'
    expect(parseCopilotResult('UserPromptSubmit', 0, local, '', { flavor: 'vscode' })).toEqual({
      status: 'blocked',
      reason: 'Security policy violation',
      stopReason: 'Security policy violation',
      systemMessage: 'Review the hook result.',
    })
  })

  it.each(['error', 'aborted'])(
    '#8 subagentStop ignores followup when status is %s (CH:1038)',
    (status) => {
      const output = '{"followup_message":"Run the next task"}'
      expect(parseCursorResult('SubagentStop', 0, output, '', { input: { status } }).status).toBe(
        'completed',
      )
      expect(
        parseCursorResult('SubagentStop', 0, output, '', { input: { status: 'completed' } }),
      ).toEqual({
        status: 'blocked',
        reason: 'Run the next task',
      })
      // No originating status: the follow-up is not consumed.
      expect(parseCursorResult('SubagentStop', 0, output, '').status).toBe('completed')
      // stop has no status condition (CH:1319).
      expect(parseCursorResult('Stop', 0, output, '', { input: { status } }).status).toBe('blocked')
    },
  )
})

describe('RVM91P findings stay fixed', () => {
  it('#1 Cursor permission answers: deny keeps messages, invalid blocks (CH:194, 1046)', () => {
    expect(
      parseCursorResult('PreToolUse', 0, '{"permission":"deny","user_message":"policy"}', ''),
    ).toEqual({
      status: 'blocked',
      reason: 'policy',
      systemMessage: 'policy',
    })
    for (const output of ['{"permission":42}', '{', '', '{"permission":"maybe"}'])
      expect(parseCursorResult('PreToolUse', 0, output, '').status).toBe('blocked')
    expect(parseCursorResult('PreToolUse', 2, '', 'nope').status).toBe('blocked')
    for (const exitCode of [null, 1]) {
      expect(parseCursorResult('PreToolUse', exitCode, '', '', { failClosed: true }).status).toBe(
        'blocked',
      )
      expect(parseCursorResult('PreToolUse', exitCode, '', '').status).toBe('failed')
    }
    const ask = parseCursorResult('PreToolUse', 0, '{"permission":"ask"}', '')
    expect(ask).toMatchObject({ status: 'completed', permissionDecision: 'ask' })
    expect(
      parseCursorResult('PreToolUse', 0, '{"permission":"ask"}', '', {
        sourceEvent: 'beforeReadFile',
      }).status,
    ).toBe('blocked')
  })

  it('#2 Windsurf envelope; the saved dangerous-command guard fires (W:242-249, 619-626)', () => {
    const stdin = stdinOf(
      windsurfIn('PreToolUse', { ...shell, tool_input: { command: 'rm -rf x' } }),
    )
    expect(stdin).toMatchObject({
      agent_action_name: 'pre_run_command',
      trajectory_id: 'session-123',
      execution_id: 'turn-1',
      tool_info: { command_line: 'rm -rf x', cwd: ROOT },
    })
    // The doc's Python example: exit 2 when pre_run_command carries rm -rf.
    const info = objectAt(stdin, 'tool_info')
    const exit =
      stdin['agent_action_name'] === 'pre_run_command' &&
      String(info['command_line']).includes('rm -rf')
        ? 2
        : 0
    expect(parseWindsurfResult('PreToolUse', exit, '', 'blocked rm').status).toBe('blocked')
  })

  it('#3 VS Code snake_case input and nested deny; PascalCase is its own CLI contract', () => {
    const local = stdinOf(copilotIn('PreToolUse', shell, { flavor: 'vscode' }))
    expect(local).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'bash',
      tool_input: shell.tool_input,
    })
    const deny =
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}'
    expect(parseCopilotResult('PreToolUse', 0, deny, '', { flavor: 'vscode' })).toMatchObject({
      status: 'blocked',
      reason: 'no',
    })
    const pascal = stdinOf(copilotIn('PreToolUse', shell, { sourceEvent: 'PreToolUse' }))
    expect(pascal).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: shell.tool_input,
    })
  })

  it('#4 permissionRequest behavior/message/interrupt (C:763-771)', () => {
    expect(
      parseCopilotResult('PermissionRequest', 0, '{"behavior":"deny","message":"policy"}', ''),
    ).toEqual({
      status: 'blocked',
      reason: 'policy',
      approvalDecision: 'deny',
    })
    expect(
      parseCopilotResult(
        'PermissionRequest',
        2,
        '{"behavior":"allow","message":"policy","interrupt":true}',
        'ignored',
      ),
    ).toEqual({
      status: 'blocked',
      reason: 'policy',
      stopReason: 'policy',
      approvalDecision: 'deny',
    })
    expect(parseCopilotResult('PermissionRequest', 2, '', 'ignored')).toMatchObject({
      status: 'blocked',
      reason: 'copilot hook denied the call',
      approvalDecision: 'deny',
    })
  })

  it.each([
    'UserPromptSubmit',
    'Stop',
    'PreLLMCall',
    'PostLLMCall',
    'PreToolUse',
    'PostToolUse',
  ] as const)('#5 Gemini %s keeps exit-2 and JSON vetoes (R:60-66)', (event) => {
    expect(parseGeminiResult(event, 2, '', 'policy')).toEqual({
      status: 'blocked',
      reason: 'policy',
    })
    for (const decision of ['deny', 'block'])
      expect(
        parseGeminiResult(event, 0, `{"decision":"${decision}","reason":"policy"}`, '').status,
      ).toBe('blocked')
  })

  it('#6 Kiro pathological regex returns within the child deadline', () => {
    const entry = `import {buildKiroStdin} from './src/core/backends/modelapi/hookFormats';
      process.stdout.write(JSON.stringify(buildKiroStdin('PostToolUse',
        {tool_name:'edit_file',tool_input:{path:'a'.repeat(64)+'!'},tool_response:'preview'}, {trigger:'PostFileSave',pathPattern:'^(a+)+$'})));`
    // The child bundle is written inside the rig worktree: Windows command
    // lines cannot carry the bundled adapter through node -e.
    const directory = mkdtempSync(path.join(process.cwd(), 'm91p-regex-'))
    const probe = path.join(directory, 'probe.cjs')
    let output: string
    try {
      buildSync({
        stdin: { contents: entry, resolveDir: process.cwd() },
        bundle: true,
        platform: 'node',
        outfile: probe,
      })
      output = execFileSync(process.execPath, [probe], { encoding: 'utf8', timeout: 2000 })
    } finally {
      unlinkSync(probe)
      rmdirSync(directory)
    }
    expect(JSON.parse(output)).toMatchObject({
      outcome: 'refused',
      reason: 'hook regular-expression matcher timed out or failed',
    })
  })

  it('#7 Cursor keeps the imported source event and its fields (CH:846-881, 1049-1082)', () => {
    expect(stdinOf(cursorIn('PreToolUse', shell))).toMatchObject({
      hook_event_name: 'preToolUse',
      tool_name: 'Shell',
      tool_input: shell.tool_input,
      conversation_id: 'session-123',
      generation_id: 'turn-1',
    })
    expect(
      stdinOf(cursorIn('PreToolUse', shell, { sourceEvent: 'beforeShellExecution' })),
    ).toMatchObject({
      hook_event_name: 'beforeShellExecution',
      command: 'npm install',
      cwd: ROOT,
    })
    expect(
      stdinOf(cursorIn('PreToolUse', mcpCall, { sourceEvent: 'beforeMCPExecution' })),
    ).toMatchObject({
      tool_name: 'query',
      mcp_server_name: 'db',
    })
    expect(cursorIn('PreToolUse', shell, { sourceEvent: 'beforeReadFile' }).outcome).toBe('refused')
    expect(
      cursorIn('PreToolUse', { ...readCall, content: undefined }, { sourceEvent: 'beforeReadFile' })
        .outcome,
    ).toBe('refused')
  })

  it('#8 Cursor beforeSubmitPrompt continue:false blocks with its message (CH:1255-1265)', () => {
    expect(
      parseCursorResult(
        'UserPromptSubmit',
        0,
        '{"continue":false,"user_message":"no secrets"}',
        '',
      ),
    ).toEqual({
      status: 'blocked',
      reason: 'no secrets',
      systemMessage: 'no secrets',
    })
  })

  it.each(['Stop', 'SubagentStop'] as const)(
    '#9 Copilot %s decision:block continues (C:696-711)',
    (event) => {
      expect(
        parseCopilotResult(event, 0, '{"decision":"block","reason":"run checks"}', ''),
      ).toEqual({
        status: 'blocked',
        reason: 'run checks',
      })
    },
  )

  it('#10 Gemini model events: modifiers refused, a simultaneous veto survives (R:62-63)', () => {
    expect(
      parseGeminiResult('PreLLMCall', 0, '{"hookSpecificOutput":{"llm_request":{}}}', '').status,
    ).toBe('failed')
    expect(
      parseGeminiResult(
        'PreLLMCall',
        0,
        '{"decision":"deny","hookSpecificOutput":{"llm_request":{}}}',
        '',
      ).status,
    ).toBe('blocked')
    expect(
      parseGeminiResult('PostLLMCall', 0, '{"hookSpecificOutput":{"llm_response":{}}}', '').status,
    ).toBe('failed')
  })

  it('#11 Gemini nested context and systemMessage observations (R:69-71)', () => {
    expect(
      parseGeminiResult(
        'SessionStart',
        0,
        '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"guide"}}',
        '',
      ),
    ).toEqual({ status: 'completed', context: 'guide' })
    expect(parseGeminiResult('Notification', 0, '{"systemMessage":"heads up"}', '')).toEqual({
      status: 'completed',
      systemMessage: 'heads up',
    })
    expect(
      parseGeminiResult('SessionStart', 0, '{"additionalContext":"old shape"}', '').status,
    ).toBe('failed')
  })

  it.each(['D:outside', 'C:outside', 'C:', String.raw`\\server\share`, String.raw`\\?\C:\x`])(
    '#12 drive-relative and UNC/device cwd refused: %s',
    (cwd) => {
      expect(confineHookCwd(cwd, String.raw`C:\ws`, 'win32')).toBeUndefined()
      expect(confineHookCwd(cwd, undefined, 'win32')).toBeUndefined()
      expect(
        copilotIn(
          'PreToolUse',
          { ...shell, cwd },
          { workspaceRoot: String.raw`C:\ws`, platform: 'win32' },
        ).outcome,
      ).toBe('refused')
    },
  )

  it('#13 cwd follows platform path semantics', () => {
    expect(confineHookCwd('src', '/repo/', 'linux')).toBe('src')
    expect(confineHookCwd(String.raw`C:\src`, 'C:\\', 'win32')).toBe('src')
    expect(confineHookCwd(String.raw`c:\ws\src`, String.raw`C:\WS`, 'win32')).toBe('src')
    expect(confineHookCwd('../outside', '/repo', 'linux')).toBeUndefined()
    expect(confineHookCwd('/outside', undefined, 'linux')).toBeUndefined()
    const options = { workspaceRoot: '/repo/', platform: 'linux' as const }
    expect(stdinOf(copilotIn('PreToolUse', { ...shell, cwd: '/repo/src' }, options))['cwd']).toBe(
      '/repo/src',
    )
    expect(copilotIn('PreToolUse', { ...shell, cwd: '/repo-other' }, options).outcome).toBe(
      'refused',
    )
    const win = { workspaceRoot: String.raw`C:\WS`, platform: 'win32' as const }
    expect(
      stdinOf(copilotIn('PreToolUse', { ...shell, cwd: String.raw`c:\ws\src` }, win))['cwd'],
    ).toBe(String.raw`c:\ws\src`)
  })

  it('#14 every post-tool contract carries the bounded preview or refuses', () => {
    expect(stdinOf(cursorIn('PostToolUse', post))['tool_output']).toBe(JSON.stringify(preview))
    expect(
      stdinOf(cursorIn('PostToolUse', post, { sourceEvent: 'afterShellExecution' }))['output'],
    ).toBe(preview)
    expect(stdinOf(copilotIn('PostToolUse', post))['toolResult']).toEqual({
      resultType: 'success',
      textResultForLlm: preview,
    })
    expect(
      stdinOf(copilotIn('PostToolUse', post, { sourceEvent: 'PostToolUse' }))['tool_result'],
    ).toEqual({
      result_type: 'success',
      text_result_for_llm: preview,
    })
    expect(stdinOf(copilotIn('PostToolUse', post, { flavor: 'vscode' }))['tool_response']).toBe(
      preview,
    )
    expect(stdinOf(geminiIn('PostToolUse', post))['tool_response']).toEqual({ llmContent: preview })
    expect(stdinOf(kiroIn('PostToolUse', post))['tool_response']).toEqual({
      success: true,
      result: [preview],
    })
    expect(
      stdinOf(windsurfIn('PostToolUse', { ...mcpCall, tool_response: preview }))['tool_info'],
    ).toMatchObject({
      mcp_result: preview,
    })
    for (const build of [buildCursorStdin, buildCopilotStdin, buildGeminiStdin, buildKiroStdin])
      expect(build('PostToolUse', shell).outcome).toBe('refused')
  })

  it.each(['bash', 'powershell'])('#15 Gemini maps %s to run_shell_command (R:65)', (tool) => {
    expect(stdinOf(geminiIn('PreToolUse', { ...shell, tool_name: tool }))['tool_name']).toBe(
      'run_shell_command',
    )
  })
})

describe('round-3 contract corrections', () => {
  it('R3-1 Copilot camelCase toolArgs is a JSON string (CT:322-324, use-hooks.md:185)', () => {
    const stdin = stdinOf(copilotIn('PreToolUse', shell))
    expect(stdin['toolArgs']).toBe('{"command":"npm install"}')
    expect(
      typeof stdinOf(copilotIn('PreToolUse', shell, { sourceEvent: 'PreToolUse' }))['tool_input'],
    ).toBe('object')
  })

  it('R3-2 Copilot stdin cwd is the absolute agent directory (use-hooks.md:185 "cwd":"/tmp")', () => {
    expect(stdinOf(copilotIn('PreToolUse', shell))['cwd']).toBe(ROOT)
    expect(stdinOf(copilotIn('PreToolUse', shell, { flavor: 'vscode' }))['cwd']).toBe(ROOT)
  })

  it('R3-3 Copilot unparseable stdout is no output; progress lines are display-only (C:154-159)', () => {
    expect(parseCopilotResult('PreToolUse', 0, 'not json', '').status).toBe('completed')
    const progress =
      '{"type":"progress","message":"Thinking..."}\n{"permissionDecision":"deny","permissionDecisionReason":"no"}'
    expect(parseCopilotResult('PreToolUse', 0, progress, '')).toEqual({
      status: 'blocked',
      reason: 'no',
    })
    // A parseable answer with a wrong type is a hook error on the fail-closed event.
    expect(parseCopilotResult('PreToolUse', 0, '{"permissionDecision":42}', '').status).toBe(
      'blocked',
    )
    expect(parseCopilotResult('PreToolUse', 2, '{"permissionDecision":"allow"}', '')).toMatchObject(
      { status: 'blocked' },
    )
    for (const exitCode of [null, 1])
      expect(parseCopilotResult('PreToolUse', exitCode, '', '').status).toBe('blocked')
  })

  it('R3-4 Copilot permissionRequest failures other than 2 fail open (C:853)', () => {
    expect(parseCopilotResult('PermissionRequest', 1, '', 'x').status).toBe('failed')
    expect(parseCopilotResult('PermissionRequest', 0, '{"behavior":"ask"}', '').status).toBe(
      'failed',
    )
    expect(parseCopilotResult('PostToolUseFailure', 2, 'try --maxWorkers=2', '')).toEqual({
      status: 'completed',
      context: 'try --maxWorkers=2',
    })
  })

  it('R3-5 Kiro stdin: camelCase event names, alias tool names, response envelope (TH:143, T:107-111)', () => {
    expect(stdinOf(kiroIn('PreToolUse', { ...shell, tool_name: 'read_file' }))).toMatchObject({
      hook_event_name: 'preToolUse',
      tool_name: 'read',
    })
    expect(stdinOf(kiroIn('PreToolUse', mcpCall))['tool_name']).toBe('@db/query')
    expect(stdinOf(kiroIn('SessionStart', shell))['hook_event_name']).toBe('agentSpawn')
    expect(
      stdinOf(kiroIn('Stop', { session_id: 's', last_assistant_message: 'done' })),
    ).toMatchObject({
      hook_event_name: 'stop',
      assistant_response: 'done',
    })
  })

  it('R3-6 Kiro exit codes and stdout follow A:32-34', () => {
    expect(parseKiroResult('PreToolUse', 2, '', 'policy')).toEqual({
      status: 'blocked',
      reason: 'policy',
    })
    expect(parseKiroResult('TaskCreated', 2, '', 'policy').status).toBe('blocked')
    for (const event of ['PostToolUse', 'Stop', 'SessionStart'] as const)
      expect(parseKiroResult(event, 2, '', 'x').status).toBe('failed')
    for (const exitCode of [null, 1, 3])
      expect(parseKiroResult('PreToolUse', exitCode, '', '').status).toBe('failed')
    expect(parseKiroResult('PreToolUse', 0, 'ignored text', '')).toEqual({ status: 'completed' })
    expect(parseKiroResult('SessionStart', 0, 'project guidance', '')).toEqual({
      status: 'completed',
      context: 'project guidance',
    })
    expect(
      parseKiroResult(
        'Stop',
        0,
        '{"decision": "block", "reason": "You haven\'t run the tests yet."}',
        '',
      ),
    ).toEqual({
      status: 'blocked',
      reason: "You haven't run the tests yet.",
    })
    expect(parseKiroResult('Stop', 0, 'plain text', '').status).toBe('completed')
  })

  it('R3-7 Kiro file triggers keep the bounded path scope', () => {
    const payload = {
      tool_name: 'edit_file',
      tool_input: { path: 'src/file.ts' },
      tool_response: preview,
    }
    expect(
      kiroIn('PostToolUse', payload, { trigger: 'PostFileSave', pathPattern: String.raw`\.ts$` })
        .outcome,
    ).toBe('run')
    expect(
      kiroIn('PostToolUse', payload, { trigger: 'PostFileSave', pathPattern: String.raw`\.py$` })
        .outcome,
    ).toBe('skip')
    expect(
      kiroIn('PostToolUse', payload, { trigger: 'PostFileSave', pathPattern: '[' }).outcome,
    ).toBe('refused')
    expect(kiroIn('PostToolUse', payload, { trigger: 'Bogus' }).outcome).toBe('refused')
    expect(kiroIn('PreToolUse', payload, { trigger: 'PostFileSave' }).outcome).toBe('refused')
  })

  it('R3-8 documented post events without results are translated (CH:1086-1141, W:169-268)', () => {
    const edit = {
      ...shell,
      tool_name: 'edit_file',
      tool_input: { path: 'a.py', find: 'x', replace: 'y' },
      tool_response: preview,
    }
    expect(stdinOf(cursorIn('PostToolUse', edit, { sourceEvent: 'afterFileEdit' }))).toMatchObject({
      file_path: '/project/a.py',
      edits: [{ old_string: 'x', new_string: 'y' }],
    })
    expect(stdinOf(windsurfIn('PostToolUse', post))).toMatchObject({
      agent_action_name: 'post_run_command',
      tool_info: { command_line: 'npm install', cwd: ROOT },
    })
    expect(parseWindsurfResult('PostToolUse', 2, '', 'x').status).toBe('failed')
  })

  it('R3-9 refused outputs: Cursor env and pluginPaths, Gemini forced selection', () => {
    expect(parseCursorResult('SessionStart', 0, '{"env":{"TOKEN":"x"}}', '').status).toBe('failed')
    expect(parseCursorResult('DirectoryAdded', 0, '{"pluginPaths":["/x"]}', '').status).toBe(
      'failed',
    )
    const any = '{"hookSpecificOutput":{"toolConfig":{"mode":"ANY"}}}'
    expect(parseGeminiResult('BeforeToolSelection', 0, any, '').status).toBe('blocked')
    const none = '{"hookSpecificOutput":{"toolConfig":{"mode":"NONE"}}}'
    expect(parseGeminiResult('BeforeToolSelection', 0, none, '')).toEqual({
      status: 'completed',
      allowedToolNames: [],
    })
    const some = '{"hookSpecificOutput":{"toolConfig":{"allowedFunctionNames":["read_file"]}}}'
    expect(parseGeminiResult('BeforeToolSelection', 0, some, '')).toEqual({
      status: 'completed',
      allowedToolNames: ['read_file'],
    })
  })

  it('R3-11 Gemini exit codes and plain stdout as captured (manifest outputContract)', () => {
    // Captured: exit 3 with stderr blocked BeforeTool; reason = stdout || stderr.
    expect(parseGeminiResult('PreToolUse', 3, '', 'capture-exit3')).toEqual({
      status: 'blocked',
      reason: 'capture-exit3',
    })
    expect(parseGeminiResult('PreToolUse', 2, '', 'capture-exit2')).toEqual({
      status: 'blocked',
      reason: 'capture-exit2',
    })
    expect(parseGeminiResult('PreToolUse', 2, '{"decision":"deny","reason":"why"}', 'x')).toEqual({
      status: 'blocked',
      reason: 'why',
    })
    // Captured: exit 0 plain text ran the tool and showed a system message.
    expect(parseGeminiResult('PreToolUse', 0, 'capture-text', '')).toEqual({
      status: 'completed',
      systemMessage: 'capture-text',
    })
    expect(parseGeminiResult('PreToolUse', 1, '', 'warn').status).toBe('failed')
    for (const event of ['SessionStart', 'SessionEnd', 'PreCompact', 'Notification'] as const)
      expect(parseGeminiResult(event, 2, '', 'x').status).toBe('failed')
  })

  it('R3-12 Gemini tool names follow the captured runtime names', () => {
    expect(
      stdinOf(
        geminiIn('PreToolUse', { ...shell, tool_name: 'search', tool_input: { pattern: 'x' } }),
      )['tool_name'],
    ).toBe('grep_search')
    expect(
      geminiIn('PreToolUse', { ...shell, tool_name: 'list_files', tool_input: { glob: '*' } }),
    ).toMatchObject({ outcome: 'refused', blockOperation: true })
    expect(stdinOf(geminiIn('PreToolUse', readCall))['tool_name']).toBe('read_file')
  })

  it('R3-13 tool-specific rows refuse a call without a tool name', () => {
    // Windsurf has no generic tool event: no tool name, no pre_read_code guess.
    expect(windsurfIn('PreToolUse', { cwd: ROOT, tool_input: { path: 'a.py' } })).toMatchObject({
      outcome: 'refused',
    })
    expect(cursorIn('PreToolUse', { cwd: ROOT, tool_input: {} }).outcome).toBe('refused')
  })

  it('R3-10 the generic entry accepts the import record shape', () => {
    const viaRecord = buildForeignStdin('cursor', 'PreToolUse', shell, {
      sourceEvent: 'beforeShellExecution',
      platform: 'linux',
    })
    expect(viaRecord).toEqual(
      cursorIn('PreToolUse', shell, { sourceEvent: 'beforeShellExecution' }),
    )
    expect(parseForeignResult('copilot', 'PreToolUse', 0, '{}', '', { flavor: 'vscode' })).toEqual({
      status: 'completed',
    })
  })

  it('unknown events and env payloads are refused', () => {
    const event: AdapterEvent = 'MessageDisplay'
    for (const build of [
      buildCursorStdin,
      buildCopilotStdin,
      buildGeminiStdin,
      buildKiroStdin,
      buildWindsurfStdin,
    ])
      expect(build(event, {}).outcome).toBe('refused')
    for (const key of ['env', 'environment'])
      expect(copilotIn('PreToolUse', { ...shell, [key]: { A: 'b' } }).outcome).toBe('refused')
  })

  it.each([
    [1000, 1],
    [1, 1],
    [601_000, 600],
  ])('Gemini timeout %s ms -> %s s', (ms, seconds) => {
    expect(geminiTimeoutMsToSeconds(ms)).toBe(seconds)
  })

  it.each([-1, Infinity, NaN, '1000'])('Gemini rejects invalid timeout %s', (value) => {
    expect(geminiTimeoutMsToSeconds(value)).toBeUndefined()
  })
})
