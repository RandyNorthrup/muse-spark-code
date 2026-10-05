// Source-shaped fixtures: saved hooks-parity/ pages named beside each group.
// FIXM91P/RVM91P numbers identify the reviewed regressions. No live model calls.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs'
import path from 'node:path'
import { buildSync } from 'esbuild'
import { describe, expect, it } from 'vitest'
import {
  type AdapterEvent,
  type HookFormat,
  type CopilotAdapterOptions,
  type CursorAdapterOptions,
  type KiroAdapterOptions,
  type GeminiHookAnswer,
  type ForeignStdinResult,
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
} from '../../src/core/backends/modelapi/hookFormats'

function stdinOf(result: ForeignStdinResult): unknown {
  if (result.outcome !== 'run') throw new Error(`${result.outcome}: ${result.reason}`)
  const value: unknown = JSON.parse(result.stdin)
  return value
}
const shell = {
  session_id: 'session-123',
  cwd: '/project',
  tool_name: 'bash',
  tool_input: { command: 'npm install' },
}
const preview = 'All tests passed\n[truncated]'
const post = { ...shell, tool_response: preview }

it('keeps the five lane P formats', () => {
  const formats: readonly HookFormat[] = HOOK_FORMATS
  expect(formats).toEqual(['gemini', 'cursor', 'copilot', 'windsurf', 'kiro'])
})

// cursor_com_docs_hooks_md.out:194-197, 853-880, 1046-1177, 1239-1265.
describe('Cursor source contract', () => {
  it('F7 preserves generic preToolUse and Shell', () => {
    expect(
      stdinOf(buildCursorStdin('PreToolUse', shell, { sourceEvent: 'preToolUse' })),
    ).toMatchObject({
      hook_event_name: 'preToolUse',
      tool_name: 'Shell',
      tool_input: { command: 'npm install' },
    })
  })
  it('F7 builds specialized shell fields', () => {
    expect(
      stdinOf(buildCursorStdin('PreToolUse', shell, { sourceEvent: 'beforeShellExecution' })),
    ).toMatchObject({
      hook_event_name: 'beforeShellExecution',
      command: 'npm install',
      cwd: '/project',
    })
  })
  it('F7 exposes file_path at top level', () => {
    expect(
      stdinOf(
        buildCursorStdin(
          'PreToolUse',
          {
            tool_name: 'read_file',
            tool_input: { path: '/project/file.py' },
            content: 'print(1)',
            attachments: [],
          },
          { sourceEvent: 'beforeReadFile' },
        ),
      ),
    ).toMatchObject({
      hook_event_name: 'beforeReadFile',
      file_path: '/project/file.py',
      content: 'print(1)',
      attachments: [],
    })
  })
  it('F7 exposes MCP server and JSON params', () => {
    expect(
      stdinOf(
        buildCursorStdin(
          'PreToolUse',
          {
            tool_name: 'mcp__linear__create_issue',
            tool_input: { title: 'Bug' },
          },
          { sourceEvent: 'beforeMCPExecution' },
        ),
      ),
    ).toMatchObject({
      hook_event_name: 'beforeMCPExecution',
      tool_name: 'create_issue',
      mcp_server_name: 'linear',
      tool_input: '{"title":"Bug"}',
    })
  })
  it.each([
    ['PreToolUse', 'stop'],
    ['PreToolUse', 'beforeReadFile'],
    ['PostToolUse', 'beforeShellExecution'],
  ] as const)('refuses source-event/tool mismatches %s/%s', (event, sourceEvent) => {
    expect(buildCursorStdin(event, shell, { sourceEvent }).outcome).toBe('refused')
  })
  it('refuses a read contract without content rather than fabricate it', () => {
    expect(
      buildCursorStdin(
        'PreToolUse',
        { tool_name: 'read_file', tool_input: { path: 'a' } },
        { sourceEvent: 'beforeReadFile' },
      ).outcome,
    ).toBe('refused')
  })
  it('F1 keeps documented deny messages', () => {
    expect(
      parseCursorResult(
        'PreToolUse',
        0,
        '{"permission":"deny","user_message":"policy","agent_message":"do not run","continue":true}',
        '',
      ),
    ).toMatchObject({
      status: 'blocked',
      reason: 'do not run',
      systemMessage: 'policy',
    })
  })
  it.each([
    '{',
    'null',
    '[]',
    '{"permission":42}',
    '{"permission":"maybe"}',
    '{"permission":"allow","alien":true}',
  ])('F1 invalid permission response blocks without failClosed: %s', (answer) => {
    expect(parseCursorResult('PreToolUse', 0, answer, '').status).toBe('blocked')
  })
  it.each([null, 1, 2])('keeps failClosed on exit %s', (exitCode) => {
    expect(
      parseCursorResult('PreToolUse', exitCode, '', 'policy', { failClosed: true }).status,
    ).toBe('blocked')
  })
  it('missing permission JSON is invalid even without failClosed', () => {
    expect(parseCursorResult('PreToolUse', 0, '', '').status).toBe('blocked')
  })
  it('crashes fail open without failClosed', () => {
    expect(parseCursorResult('PreToolUse', null, '', '').status).toBe('failed')
  })
  it('ask requests a card and allow grants nothing', () => {
    expect(parseCursorResult('PreToolUse', 0, '{"permission":"ask"}', '').permissionDecision).toBe(
      'ask',
    )
    expect(
      parseCursorResult('PreToolUse', 0, '{"permission":"allow"}', '').approvalDecision,
    ).toBeUndefined()
    expect(
      parseCursorResult('PreToolUse', 0, '{"permission":"allow"}', '').permissionDecision,
    ).toBeUndefined()
  })
  it('F8 beforeSubmitPrompt continue:false blocks', () => {
    expect(
      parseCursorResult('UserPromptSubmit', 0, '{"continue":false,"user_message":"policy"}', ''),
    ).toMatchObject({
      status: 'blocked',
      reason: 'policy',
    })
  })
  it('prompt stdin preserves attachments', () => {
    expect(
      stdinOf(buildCursorStdin('UserPromptSubmit', { prompt: 'hello', attachments: [] })),
    ).toMatchObject({
      hook_event_name: 'beforeSubmitPrompt',
      prompt: 'hello',
      attachments: [],
    })
  })
  // cursor_com_docs_hooks_md.out:996-1038, 1267-1276, 1300-1320.
  it.each(['Stop', 'SubagentStop'] as const)('followup blocks %s completion', (event) => {
    expect(parseCursorResult(event, 0, '{"followup_message":"run checks"}', '').status).toBe(
      'blocked',
    )
  })
  it('maps assistant response to text', () => {
    expect(stdinOf(buildCursorStdin('PostLLMCall', { response: 'done' }))).toMatchObject({
      hook_event_name: 'afterAgentResponse',
      text: 'done',
    })
  })
  // cursor_com_docs_hooks_md.out:889-915, 1086-1141.
  it('F14 generic post-tool carries preview as JSON tool_output', () => {
    expect(stdinOf(buildCursorStdin('PostToolUse', post))).toMatchObject({
      tool_output: JSON.stringify(preview),
    })
  })
  it('F14 shell post-tool carries preview verbatim', () => {
    expect(
      stdinOf(buildCursorStdin('PostToolUse', post, { sourceEvent: 'afterShellExecution' })),
    ).toMatchObject({ output: preview })
  })
  it('F14 MCP post-tool carries preview as result_json', () => {
    expect(
      stdinOf(
        buildCursorStdin(
          'PostToolUse',
          { ...post, tool_name: 'mcp__fs__read' },
          { sourceEvent: 'afterMCPExecution' },
        ),
      ),
    ).toMatchObject({ result_json: JSON.stringify(preview) })
  })
  it('F14 afterFileEdit refuses result previews it cannot represent', () => {
    expect(
      buildCursorStdin(
        'PostToolUse',
        { ...post, tool_name: 'edit_file', tool_input: { path: 'a' } },
        { sourceEvent: 'afterFileEdit' },
      ).outcome,
    ).toBe('refused')
  })
  it('denial wins over unsupported rewrite fields', () => {
    expect(
      parseCursorResult('PreToolUse', 0, '{"permission":"deny","updated_mcp_tool_output":{}}', '')
        .status,
    ).toBe('blocked')
  })
})

// docs_devin_ai_desktop_cascade_hooks_md.out:135-350, 420-445.
describe('Windsurf source contract', () => {
  it('F2 wraps shell in agent_action_name/tool_info', () => {
    expect(stdinOf(buildWindsurfStdin('PreToolUse', shell))).toMatchObject({
      agent_action_name: 'pre_run_command',
      tool_info: { command_line: 'npm install', cwd: '/project' },
    })
  })
  it('F2 wraps read and edit events', () => {
    expect(
      stdinOf(
        buildWindsurfStdin('PreToolUse', {
          tool_name: 'read_file',
          tool_input: { path: '/project/file.py' },
        }),
      ),
    ).toMatchObject({
      agent_action_name: 'pre_read_code',
      tool_info: { file_path: '/project/file.py' },
    })
    expect(
      stdinOf(
        buildWindsurfStdin('PreToolUse', {
          tool_name: 'edit_file',
          tool_input: {
            path: '/project/file.py',
            old_string: 'import os',
            new_string: 'import os\nimport sys',
          },
        }),
      ),
    ).toMatchObject({
      agent_action_name: 'pre_write_code',
      tool_info: {
        file_path: '/project/file.py',
        edits: [{ old_string: 'import os', new_string: 'import os\nimport sys' }],
      },
    })
  })
  it('F2 wraps MCP arguments and name', () => {
    expect(
      stdinOf(
        buildWindsurfStdin('PreToolUse', {
          tool_name: 'mcp__github__create_issue',
          tool_input: { owner: 'code-owner', repo: 'my-cool-repo' },
        }),
      ),
    ).toMatchObject({
      agent_action_name: 'pre_mcp_tool_use',
      tool_info: {
        mcp_server_name: 'github',
        mcp_tool_name: 'create_issue',
        mcp_tool_arguments: { owner: 'code-owner', repo: 'my-cool-repo' },
      },
    })
  })
  it('F2 wraps prompt, response and worktree events', () => {
    expect(stdinOf(buildWindsurfStdin('UserPromptSubmit', { prompt: 'hello' }))).toMatchObject({
      agent_action_name: 'pre_user_prompt',
      tool_info: { user_prompt: 'hello' },
    })
    expect(stdinOf(buildWindsurfStdin('Stop', { response: 'done' }))).toMatchObject({
      agent_action_name: 'post_cascade_response',
      tool_info: { response: 'done' },
    })
    expect(
      stdinOf(
        buildWindsurfStdin('WorktreeCreate', { worktree_path: '/tmp/work', cwd: '/project' }),
      ),
    ).toMatchObject({
      agent_action_name: 'post_setup_worktree',
      tool_info: { worktree_path: '/tmp/work', root_workspace_path: '/project' },
    })
  })
  it('F14 MCP post-tool carries runtime preview', () => {
    expect(
      stdinOf(
        buildWindsurfStdin('PostToolUse', { ...post, tool_name: 'mcp__github__list_commits' }),
      ),
    ).toMatchObject({ agent_action_name: 'post_mcp_tool_use', tool_info: { mcp_result: preview } })
  })
  it.each(['bash', 'read_file', 'edit_file'])(
    'F14 refuses undocumented post result field for %s',
    (tool_name) => {
      expect(buildWindsurfStdin('PostToolUse', { ...post, tool_name }).outcome).toBe('refused')
    },
  )
  it.each(['PreToolUse', 'UserPromptSubmit', 'WorktreeCreate'] as const)(
    'exit 2 blocks %s',
    (event) => {
      expect(parseWindsurfResult(event, 2, '{"permission":"allow"}', 'policy').status).toBe(
        'blocked',
      )
    },
  )
  it('ignores stdout and fails open on other exits/post errors', () => {
    expect(parseWindsurfResult('PreToolUse', 0, '{"permission":"deny"}', '').status).toBe(
      'completed',
    )
    expect(parseWindsurfResult('PreToolUse', 1, '', '').status).toBe('failed')
    expect(parseWindsurfResult('PostToolUse', 2, '', '').status).toBe('failed')
  })
})

// gh/copilot_reference_hooks-configuration.md:293-432, 453-485, 696-711, 763-771.
// vsc/hooks-reference.md:66-168, 185-223, 308-329, 389-410.
describe('Copilot and VS Code contracts', () => {
  it('CLI camelCase remains its own contract', () => {
    expect(
      stdinOf(buildCopilotStdin('PreToolUse', shell, { workspaceRoot: '/project' })),
    ).toMatchObject({
      sessionId: 'session-123',
      toolName: 'bash',
      toolArgs: { command: 'npm install' },
      cwd: '.',
    })
  })
  it('F3 VS Code uses snake_case', () => {
    expect(
      stdinOf(
        buildCopilotStdin('PreToolUse', shell, { flavor: 'vscode', workspaceRoot: '/project' }),
      ),
    ).toMatchObject({
      hook_event_name: 'PreToolUse',
      session_id: 'session-123',
      tool_name: 'bash',
      tool_input: { command: 'npm install' },
    })
  })
  it('F3 Copilot PascalCase keeps snake_case and Claude tool name', () => {
    expect(
      stdinOf(
        buildCopilotStdin('PreToolUse', shell, {
          sourceEvent: 'PreToolUse',
          workspaceRoot: '/project',
        }),
      ),
    ).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm install' },
    })
  })
  it('F3 VS Code nested permission denial blocks', () => {
    expect(
      parseCopilotResult(
        'PreToolUse',
        0,
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: 'Destructive command blocked by policy.',
            additionalContext: 'Production files are read-only.',
          },
        }),
        '',
        { flavor: 'vscode' },
      ),
    ).toMatchObject({ status: 'blocked', reason: 'Destructive command blocked by policy.' })
  })
  it('VS Code nested allow never grants and updatedInput remains a suggestion', () => {
    const answer = parseCopilotResult(
      'PreToolUse',
      0,
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"command":"npm ci"}}}',
      '',
      { flavor: 'vscode' },
    )
    expect(answer).toMatchObject({ status: 'completed', updatedInput: { command: 'npm ci' } })
    expect(answer.approvalDecision).toBeUndefined()
    expect(answer.permissionDecision).toBeUndefined()
  })
  it('VS Code common continue:false wins over permission allow', () => {
    expect(
      parseCopilotResult(
        'PreToolUse',
        0,
        '{"continue":false,"stopReason":"policy","hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
        '',
        { flavor: 'vscode' },
      ),
    ).toMatchObject({ status: 'blocked', stopReason: 'policy' })
  })
  it('VS Code validates event-specific envelope', () => {
    expect(
      parseCopilotResult(
        'PreToolUse',
        0,
        '{"hookSpecificOutput":{"hookEventName":"Stop","permissionDecision":"deny"}}',
        '',
        { flavor: 'vscode' },
      ).status,
    ).toBe('failed')
  })
  it.each(['Stop', 'SubagentStop'] as const)(
    'F9 CLI decision:block preserves %s continuation',
    (event) => {
      expect(
        parseCopilotResult(event, 0, '{"decision":"block","reason":"run checks"}', ''),
      ).toMatchObject({ status: 'blocked', reason: 'run checks' })
    },
  )
  it('VS Code nested Stop decision blocks', () => {
    expect(
      parseCopilotResult(
        'Stop',
        0,
        '{"hookSpecificOutput":{"hookEventName":"Stop","decision":"block","reason":"Run the test suite before finishing."}}',
        '',
        { flavor: 'vscode' },
      ).status,
    ).toBe('blocked')
  })
  it('F4 permissionRequest behavior/message/interrupt denies and stops', () => {
    expect(
      parseCopilotResult(
        'PermissionRequest',
        0,
        '{"behavior":"deny","message":"policy","interrupt":true}',
        '',
      ),
    ).toMatchObject({
      status: 'blocked',
      approvalDecision: 'deny',
      reason: 'policy',
      stopReason: 'policy',
    })
  })
  it('permission allow never grants', () => {
    expect(
      parseCopilotResult('PermissionRequest', 0, '{"behavior":"allow"}', '').approvalDecision,
    ).toBeUndefined()
  })
  it.each([null, 1, 2])('CLI preToolUse errors deny %s', (exitCode) => {
    expect(
      parseCopilotResult('PreToolUse', exitCode, '{"permissionDecision":"allow"}', '').status,
    ).toBe('blocked')
  })
  it.each(['{', '{"permissionDecision":42}', '{"permissionDecision":"unknown"}'])(
    'invalid CLI permission denies %s',
    (output) => {
      expect(parseCopilotResult('PreToolUse', 0, output, '').status).toBe('blocked')
    },
  )
  it('CLI ask forces approval', () => {
    expect(
      parseCopilotResult('PreToolUse', 0, '{"permissionDecision":"ask"}', '').permissionDecision,
    ).toBe('ask')
  })
  it('VS Code non-2 errors stay nonblocking', () => {
    expect(parseCopilotResult('PreToolUse', 1, '', '', { flavor: 'vscode' }).status).toBe('failed')
  })
  it.each([
    'D:x',
    'D:outside',
    String.raw`\\server\share`,
    String.raw`\\?\C:\ws`,
    String.raw`\\?\UNC\server\share`,
    String.raw`\\.\C:\ws`,
  ])('F12 rejects drive-relative and UNC/device cwd %s', (cwd) => {
    for (const workspaceRoot of [undefined, String.raw`C:\ws`, cwd]) {
      expect(
        buildCopilotStdin('PreToolUse', { ...shell, cwd }, { platform: 'win32', workspaceRoot })
          .outcome,
      ).toBe('refused')
    }
  })
  it.each([
    ['/repo/', 'src', 'linux', 'src'],
    ['C:\\', String.raw`C:\src`, 'win32', 'src'],
    [String.raw`C:\WS`, String.raw`c:\ws\src`, 'win32', 'src'],
  ] as const)(
    'F13 accepts contained cwd with platform semantics %s/%s',
    (workspaceRoot, cwd, platform, expected) => {
      expect(
        stdinOf(buildCopilotStdin('PreToolUse', { ...shell, cwd }, { workspaceRoot, platform })),
      ).toMatchObject({ cwd: expected })
    },
  )
  it.each(['../outside', '/repo-other', '/outside'])('rejects lexical escape %s', (cwd) => {
    expect(
      buildCopilotStdin('PreToolUse', { ...shell, cwd }, { workspaceRoot: '/repo' }).outcome,
    ).toBe('refused')
  })
  it.each(['env', 'environment'])('refuses credential-bearing %s', (field) => {
    expect(
      buildCopilotStdin('PreToolUse', {
        tool_name: 'bash',
        tool_input: { command: 'echo' },
        [field]: {},
      }).outcome,
    ).toBe('refused')
  })
  it('F14 CLI post-tool carries runtime string in toolResult', () => {
    expect(
      stdinOf(buildCopilotStdin('PostToolUse', post, { workspaceRoot: '/project' })),
    ).toMatchObject({
      toolResult: { resultType: 'success', textResultForLlm: preview },
    })
  })
  it('F14 PascalCase CLI post-tool uses tool_result', () => {
    expect(
      stdinOf(
        buildCopilotStdin('PostToolUse', post, {
          sourceEvent: 'PostToolUse',
          workspaceRoot: '/project',
        }),
      ),
    ).toMatchObject({ tool_result: { result_type: 'success', text_result_for_llm: preview } })
  })
  it('F14 VS Code post-tool uses tool_response', () => {
    expect(
      stdinOf(
        buildCopilotStdin('PostToolUse', post, { flavor: 'vscode', workspaceRoot: '/project' }),
      ),
    ).toMatchObject({ tool_response: preview })
  })
})

// raw-codex-gemini.md:52-73, vendor docs + types.ts summarized in saved research.
describe('Gemini source contract', () => {
  it.each(['bash', 'powershell'])('F15 maps both shells to run_shell_command: %s', (tool_name) => {
    expect(stdinOf(buildGeminiStdin('PreToolUse', { ...shell, tool_name }))).toMatchObject({
      tool_name: 'run_shell_command',
    })
  })
  it.each([
    'UserPromptSubmit',
    'Stop',
    'PreLLMCall',
    'PostLLMCall',
    'PreToolUse',
    'PostToolUse',
  ] as const)('F5/F10 exit 2 blocks %s', (event) => {
    expect(parseGeminiResult(event, 2, '', 'policy')).toMatchObject({
      status: 'blocked',
      reason: 'policy',
    })
  })
  it.each(['UserPromptSubmit', 'Stop', 'PreLLMCall', 'PostLLMCall'] as const)(
    'F5/F10 JSON deny/block survives on %s',
    (event) => {
      for (const decision of ['deny', 'block']) {
        expect(
          parseGeminiResult(event, 0, JSON.stringify({ decision, reason: 'policy' }), '').status,
        ).toBe('blocked')
      }
    },
  )
  it('F10 maps model events and tool selection', () => {
    for (const [event, name] of [
      ['PreLLMCall', 'BeforeModel'],
      ['PostLLMCall', 'AfterModel'],
      ['BeforeToolSelection', 'BeforeToolSelection'],
    ] as const) {
      expect(stdinOf(buildGeminiStdin(event, { session_id: 's' }))).toMatchObject({
        hook_event_name: name,
      })
    }
  })
  it('F11 keeps nested context and systemMessage observation', () => {
    expect(
      parseGeminiResult(
        'SessionStart',
        0,
        '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"project guidance"},"systemMessage":"review"}',
        '',
      ),
    ).toMatchObject({ status: 'completed', context: 'project guidance', systemMessage: 'review' })
    expect(
      parseGeminiResult('Notification', 0, '{"systemMessage":"review"}', '').systemMessage,
    ).toBe('review')
  })
  it.each(['llm_request', 'llm_response'])(
    'F10 refuses modifying model field %s but preserves deny',
    (field) => {
      expect(
        parseGeminiResult(
          'PreLLMCall',
          0,
          JSON.stringify({ hookSpecificOutput: { [field]: {} } }),
          '',
        ).status,
      ).toBe('failed')
      expect(
        parseGeminiResult(
          'PreLLMCall',
          0,
          JSON.stringify({ decision: 'deny', hookSpecificOutput: { [field]: {} } }),
          '',
        ).status,
      ).toBe('blocked')
    },
  )
  it('continue:false preserves stop reason', () => {
    expect(
      parseGeminiResult('PostLLMCall', 0, '{"continue":false,"stopReason":"policy"}', ''),
    ).toMatchObject({ status: 'blocked', stopReason: 'policy' })
  })
  it('BeforeToolSelection returns an admission restriction only', () => {
    expect(
      parseGeminiResult(
        'BeforeToolSelection',
        0,
        '{"hookSpecificOutput":{"toolConfig":{"allowedFunctionNames":["read_file"]}}}',
        '',
      ),
    ).toMatchObject({ status: 'completed', allowedToolNames: ['read_file'] })
    expect(
      parseGeminiResult(
        'BeforeToolSelection',
        0,
        '{"hookSpecificOutput":{"toolConfig":{"mode":"NONE"}}}',
        '',
      ),
    ).toMatchObject({ status: 'completed', allowedToolNames: [] })
  })
  it('allow never grants permission', () => {
    const answer = parseGeminiResult('PreToolUse', 0, '{"decision":"allow"}', '')
    expect(answer.approvalDecision).toBeUndefined()
    expect(answer.permissionDecision).toBeUndefined()
  })
  it('F14 preserves post-tool result preview', () => {
    expect(stdinOf(buildGeminiStdin('PostToolUse', post))).toMatchObject({ tool_response: preview })
  })
  it.each([
    [1, 1],
    [1001, 2],
    [60_001, 61],
    [900_000, 600],
  ] as const)('timeout %s ms becomes %s s', (value, expected) => {
    expect(geminiTimeoutMsToSeconds(value)).toBe(expected)
  })
  it.each([-1, Infinity, NaN, '1000'])('rejects invalid timeout %s', (value) => {
    expect(geminiTimeoutMsToSeconds(value)).toBeUndefined()
  })
})

// raw/kiro_hooks_types.md (Pre/Post Tool Use), raw-kiro-amp-opencode-continue.md:9-18.
describe('Kiro source contract', () => {
  it('F14 carries runtime string preview', () => {
    expect(stdinOf(buildKiroStdin('PostToolUse', post))).toMatchObject({
      tool_name: 'execute_bash',
      tool_response: preview,
    })
  })
  it('file regex matches or skips before hook dispatch', () => {
    const payload = {
      tool_name: 'edit_file',
      tool_input: { path: 'src/file.ts' },
      tool_response: preview,
    }
    expect(
      buildKiroStdin('PostToolUse', payload, {
        trigger: 'PostFileSave',
        pathPattern: String.raw`\.ts$`,
      }).outcome,
    ).toBe('run')
    expect(
      buildKiroStdin('PostToolUse', payload, {
        trigger: 'PostFileSave',
        pathPattern: String.raw`\.py$`,
      }).outcome,
    ).toBe('skip')
    expect(
      buildKiroStdin('PostToolUse', {}, { trigger: 'PostFileSave', pathPattern: '.' }).outcome,
    ).toBe('skip')
    expect(
      buildKiroStdin('PostToolUse', payload, { trigger: 'PostFileSave', pathPattern: '[' }).outcome,
    ).toBe('refused')
  })
  it('F6 pathological regex returns within child deadline', () => {
    const entry = `import {buildKiroStdin} from './src/core/backends/modelapi/hookFormats';
      process.stdout.write(JSON.stringify(buildKiroStdin('PostToolUse',
        {tool_name:'edit_file',tool_input:{path:'a'.repeat(64)+'!'},tool_response:'preview'}, {trigger:'PostFileSave',pathPattern:'^(a+)+$'})));`
    // Write the child bundle inside the rig worktree: Windows command-line
    // limits cannot carry the bundled adapter through node -e.
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
    const value: unknown = JSON.parse(output)
    expect(value).toMatchObject({
      outcome: 'refused',
      reason: 'hook regular-expression matcher timed out or failed',
    })
  })
  it.each([null, 1, 3])('only exit 2 blocks, other exit %s fails', (exitCode) => {
    expect(parseKiroResult('PreToolUse', exitCode, '', '').status).toBe('failed')
  })
  it('exit 2 blocks and success context remains bounded', () => {
    expect(parseKiroResult('PreToolUse', 2, '', 'policy').status).toBe('blocked')
    expect(parseKiroResult('SessionStart', 0, 'project guidance', '')).toMatchObject({
      status: 'completed',
      context: 'project guidance',
    })
  })
})

it('unknown events stay refused for every builder', () => {
  const event: AdapterEvent = 'MessageDisplay'
  for (const build of [
    buildCursorStdin,
    buildCopilotStdin,
    buildGeminiStdin,
    buildKiroStdin,
    buildWindsurfStdin,
  ]) {
    expect(build(event, {}).outcome).toBe('refused')
  }
})

// Additional source-event boundaries from the same saved references above.
describe('source-event boundaries', () => {
  it('Cursor read permission schema blocks unsupported ask', () => {
    const options: CursorAdapterOptions = { sourceEvent: 'beforeReadFile' }
    expect(parseCursorResult('PreToolUse', 0, '{"permission":"ask"}', '', options).status).toBe(
      'blocked',
    )
  })
  it('Cursor preCompact user_message stays an observation', () => {
    expect(parseCursorResult('PreCompact', 0, '{"user_message":"compacting"}', '')).toMatchObject({
      status: 'completed',
      systemMessage: 'compacting',
    })
  })
  it('VS Code denial survives unsupported rewrite fields', () => {
    expect(
      parseCopilotResult(
        'PreToolUse',
        0,
        '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","updatedMCPToolOutput":{}}}',
        '',
        { flavor: 'vscode' },
      ).status,
    ).toBe('blocked')
  })
  it('CLI permission exit 2 merges message and interrupt and ignores stderr', () => {
    expect(
      parseCopilotResult(
        'PermissionRequest',
        2,
        '{"behavior":"allow","message":"policy","interrupt":true}',
        'ignored',
      ),
    ).toMatchObject({
      status: 'blocked',
      reason: 'policy',
      stopReason: 'policy',
      approvalDecision: 'deny',
    })
  })
  it.each(['copilot', 'vscode'] as const)('timestamp format follows %s flavor', (flavor) => {
    const options: CopilotAdapterOptions = { flavor, workspaceRoot: '/project' }
    expect(
      stdinOf(
        buildCopilotStdin(
          'PreToolUse',
          { ...shell, timestamp: '2026-10-04T00:00:00.000Z' },
          options,
        ),
      ),
    ).toMatchObject({
      timestamp:
        flavor === 'copilot' ? Date.parse('2026-10-04T00:00:00.000Z') : '2026-10-04T00:00:00.000Z',
    })
  })
  it.each([Infinity, 1e100, 'bad', null, true])(
    'invalid timestamp is refused without throwing %s',
    (timestamp) => {
      expect(
        buildCopilotStdin(
          'PreToolUse',
          { ...shell, timestamp },
          { flavor: 'vscode', workspaceRoot: '/project' },
        ).outcome,
      ).toBe('refused')
    },
  )
  it('Gemini rejects wrong event envelopes and misplaced tool rewrites', () => {
    expect(
      parseGeminiResult(
        'SessionStart',
        0,
        '{"hookSpecificOutput":{"hookEventName":"BeforeTool","additionalContext":"x"}}',
        '',
      ).status,
    ).toBe('failed')
    expect(
      parseGeminiResult('PostToolUse', 0, '{"hookSpecificOutput":{"tool_input":{}}}', '').status,
    ).toBe('failed')
    expect(
      parseGeminiResult(
        'PreToolUse',
        0,
        '{"hookSpecificOutput":{"toolConfig":{"mode":"NONE"}}}',
        '',
      ).status,
    ).toBe('failed')
  })
  it('Gemini selection refuses forced calls and nonselection control fields', () => {
    expect(
      parseGeminiResult(
        'BeforeToolSelection',
        0,
        '{"hookSpecificOutput":{"toolConfig":{"mode":"ANY"}}}',
        '',
      ).status,
    ).toBe('failed')
    expect(parseGeminiResult('BeforeToolSelection', 0, '{"systemMessage":"x"}', '').status).toBe(
      'failed',
    )
    const answer: GeminiHookAnswer = parseGeminiResult(
      'BeforeToolSelection',
      0,
      '{"hookSpecificOutput":{"toolConfig":{"allowedFunctionNames":["run_shell_command"]}}}',
      '',
    )
    expect(answer.allowedToolNames).toEqual(['run_shell_command'])
  })
  it('Kiro task/file triggers cannot be relabeled to another event', () => {
    const options: KiroAdapterOptions = { trigger: 'PostFileSave' }
    expect(buildKiroStdin('PreToolUse', shell, options).outcome).toBe('refused')
  })
  it('Kiro matcher pattern and value bounds precede evaluation', () => {
    expect(
      buildKiroStdin(
        'PostToolUse',
        { ...post, tool_input: { path: 'a'.repeat(257) } },
        { trigger: 'PostFileSave', pathPattern: '.' },
      ).outcome,
    ).toBe('refused')
    expect(
      buildKiroStdin(
        'PostToolUse',
        { ...post, tool_input: { path: 'a' } },
        { trigger: 'PostFileSave', pathPattern: 'a'.repeat(257) },
      ).outcome,
    ).toBe('refused')
  })
  // raw/kiro_hooks_types.md:72-81, 281-291.
  it('Kiro Stop JSON continuation and MCP tool names keep their contracts', () => {
    expect(
      parseKiroResult('Stop', 0, '{"decision":"block","reason":"run checks"}', ''),
    ).toMatchObject({ status: 'blocked', reason: 'run checks' })
    expect(
      stdinOf(
        buildKiroStdin('PreToolUse', {
          tool_name: 'mcp__postgres__query',
          tool_input: { sql: 'SELECT 1' },
        }),
      ),
    ).toMatchObject({ tool_name: '@postgres/query', tool_input: { sql: 'SELECT 1' } })
  })
  it.each([null, 1, 3])('Windsurf worktree failure refuses attempt for exit %s', (exitCode) => {
    expect(parseWindsurfResult('WorktreeCreate', exitCode, '', 'policy').status).toBe('blocked')
  })
  it.each([
    buildCursorStdin,
    buildCopilotStdin,
    buildGeminiStdin,
    buildKiroStdin,
    buildWindsurfStdin,
  ])('missing tool input is explicitly refused by %s', (build) => {
    expect(build('PreToolUse', {}).outcome).toBe('refused')
  })
  it.each([buildCursorStdin, buildCopilotStdin, buildGeminiStdin, buildKiroStdin])(
    'post-tool missing preview is explicitly refused by %s',
    (build) => {
      expect(
        build('PostToolUse', { tool_name: 'bash', tool_input: { command: 'echo' } }).outcome,
      ).toBe('refused')
    },
  )
})

it('runtime edit arguments become Windsurf documented edits', () => {
  expect(
    stdinOf(
      buildWindsurfStdin('PreToolUse', {
        tool_name: 'edit_file',
        tool_input: { path: 'file.py', find: 'import os', replace: 'import os\nimport sys' },
      }),
    ),
  ).toMatchObject({
    tool_info: { edits: [{ old_string: 'import os', new_string: 'import os\nimport sys' }] },
  })
})
it('CLI preToolUse allow is no approval grant', () => {
  const answer = parseCopilotResult('PreToolUse', 0, '{"permissionDecision":"allow"}', '')
  expect(answer.status).toBe('completed')
  expect(answer.permissionDecision).toBeUndefined()
  expect(answer.approvalDecision).toBeUndefined()
})
it('Gemini top-level context and malformed output stay refused', () => {
  for (const output of ['{', '{"additionalContext":"old incompatible shape"}']) {
    expect(parseGeminiResult('SessionStart', 0, output, '').status).toBe('failed')
  }
})
it('nonblocking vendor errors remain nonblocking', () => {
  expect(parseGeminiResult('PreToolUse', 1, '', '').status).toBe('failed')
  expect(parseCursorResult('PostToolUse', 2, '', '').status).toBe('failed')
  expect(parseCopilotResult('Stop', 1, '', '').status).toBe('failed')
})
// Boundary refusals exercise the required fields of each documented envelope.
it.each([
  ['PreToolUse', { tool_name: 'read_file', tool_input: {} }],
  ['PreToolUse', { tool_name: 'edit_file', tool_input: { path: 'a' } }],
  ['PreToolUse', { tool_name: 'bash', tool_input: { command: 'echo' } }],
  ['UserPromptSubmit', {}],
  ['Stop', {}],
  ['WorktreeCreate', { worktree_path: '/tmp/work' }],
  ['PostToolUse', { tool_name: 'mcp__fs__read', tool_input: {} }],
] satisfies readonly (readonly [AdapterEvent, Record<string, unknown>])[])(
  'Windsurf required event fields refuse %s/%j',
  (event, payload) => {
    expect(buildWindsurfStdin(event, payload).outcome).toBe('refused')
  },
)
it.each(['beforeShellExecution', 'beforeMCPExecution'] as const)(
  'Cursor required specialized fields refuse %s',
  (sourceEvent) => {
    expect(
      buildCursorStdin('PreToolUse', { tool_name: 'read_file', tool_input: {} }, { sourceEvent })
        .outcome,
    ).toBe('refused')
  },
)
it('Cursor response and followup fields must be representable', () => {
  expect(buildCursorStdin('PostLLMCall', {}).outcome).toBe('refused')
  expect(parseCursorResult('Stop', 0, '{"followup_message":42}', '').status).toBe('failed')
})
it('Copilot rejects unsupported Local events and foreign output envelopes', () => {
  expect(
    buildCopilotStdin('PermissionRequest', shell, { flavor: 'vscode', workspaceRoot: '/project' })
      .outcome,
  ).toBe('refused')
  expect(parseCopilotResult('PermissionRequest', 0, '{}', '', { flavor: 'vscode' }).status).toBe(
    'failed',
  )
  expect(
    parseCopilotResult('PreToolUse', 0, '{"permissionDecision":"allow"}', '', { flavor: 'vscode' })
      .status,
  ).toBe('failed')
  expect(
    parseCopilotResult(
      'SessionStart',
      0,
      '{"hookSpecificOutput":{"hookEventName":"SessionStart","permissionDecision":"deny"}}',
      '',
      { flavor: 'vscode' },
    ).status,
  ).toBe('failed')
  expect(
    parseCopilotResult('UserPromptSubmit', 0, '{"decision":"block"}', '', { flavor: 'vscode' })
      .status,
  ).toBe('failed')
  expect(parseCopilotResult('PermissionRequest', 0, '{"behavior":"ask"}', '').status).toBe(
    'blocked',
  )
})
it('Copilot cwd without a root still rejects escapes and absolute paths', () => {
  for (const cwd of ['../outside', '/outside'])
    expect(buildCopilotStdin('PreToolUse', { ...shell, cwd }).outcome).toBe('refused')
  expect(
    buildCopilotStdin('PreToolUse', { ...shell, cwd: 'src' }, { workspaceRoot: 'relative' })
      .outcome,
  ).toBe('refused')
})
it('Gemini tool rewrites stay input suggestions without permissions', () => {
  expect(
    parseGeminiResult(
      'PreToolUse',
      0,
      '{"hookSpecificOutput":{"tool_input":{"command":"npm ci"}}}',
      '',
    ),
  ).toMatchObject({ status: 'completed', updatedInput: { command: 'npm ci' } })
  expect(parseGeminiResult('SessionStart', 0, '{"decision":"deny"}', '').status).toBe('failed')
})
it('Kiro unknown triggers are refused and context is capped', () => {
  expect(buildKiroStdin('PostToolUse', post, { trigger: 'Manual' }).outcome).toBe('refused')
  const answer = parseKiroResult('SessionStart', 0, 'x'.repeat(10_000), '')
  expect(answer.context?.length).toBe(1024)
})

it('Cursor exit 2 denies without failClosed', () => {
  expect(parseCursorResult('PreToolUse', 2, '', 'policy')).toMatchObject({
    status: 'blocked',
    reason: 'policy',
  })
  expect(parseCursorResult('UserPromptSubmit', 2, '', 'policy').status).toBe('blocked')
})
it('Kiro bounds and unknown-trigger diagnostics identify the refusing guard', () => {
  expect(
    buildKiroStdin(
      'PostToolUse',
      { ...post, tool_input: { path: 'a'.repeat(257) } },
      { pathPattern: '.' },
    ),
  ).toMatchObject({ outcome: 'refused', reason: 'kiro: file path is too long to match' })
  expect(buildKiroStdin('PostToolUse', post, { trigger: 'Manual' })).toMatchObject({
    outcome: 'refused',
    reason: 'kiro: unknown trigger',
  })
})
it('Gemini selection accepts its documented event envelope', () => {
  expect(
    parseGeminiResult(
      'BeforeToolSelection',
      0,
      '{"hookSpecificOutput":{"hookEventName":"BeforeToolSelection","toolConfig":{"allowedFunctionNames":["read_file"]}}}',
      '',
    ),
  ).toMatchObject({ status: 'completed', allowedToolNames: ['read_file'] })
})
