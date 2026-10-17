// RVM91P3 regressions. Source scripts are verbatim saved docs; captures and
// manifest identify the earlier CLI runs. This suite makes no model call.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  type AdapterEvent,
  buildGeminiStdin,
  parseGeminiResult,
} from '../../src/core/backends/modelapi/hookFormats'

const FIXTURES = path.join(process.cwd(), 'test/fixtures/hookFormats')
const scripts = z
  .array(z.object({ id: z.string(), source: z.string(), script: z.string() }))
  .parse(JSON.parse(readFileSync(path.join(FIXTURES, 'docs/gemini-scripts.json'), 'utf8')))
const objectSchema = z.record(z.string(), z.unknown())

function capture(name: string): Record<string, unknown> {
  return objectSchema.parse(
    JSON.parse(readFileSync(path.join(FIXTURES, 'captured/gemini', name), 'utf8')),
  )
}

function stdin(event: AdapterEvent, payload: Record<string, unknown>) {
  const result = buildGeminiStdin(event, payload, { platform: 'linux' })
  if (result.outcome !== 'run') throw new Error(`${result.outcome}: ${result.reason}`)
  return objectSchema.parse(JSON.parse(result.stdin))
}

function script(id: string): string {
  const found = scripts.find((fixture) => fixture.id === id)
  if (found === undefined) throw new Error(`no source script: ${id}`)
  return found.script
}

describe('RVM91P3 tool guards and source scripts', () => {
  it('#1 the saved secret scanner cannot allow an unsupported edit', () => {
    const result = buildGeminiStdin('PreToolUse', {
      cwd: '/workspace',
      tool_name: 'edit_file',
      tool_input: { path: 'hello.txt', find: 'hello', replace: 'secret' },
    })
    // No replace-tool capture establishes its complete argument schema. Refuse
    // the operation before execution, rather than send incompatible arguments.
    expect(result).toMatchObject({ outcome: 'refused', blockOperation: true })
  })

  it('#1 a captured file_path guard sees the actual read path and range', () => {
    const packet = stdin('PreToolUse', {
      cwd: '/workspace',
      tool_name: 'read_file',
      tool_input: { path: 'private/keys.txt', offset: 1, limit: 10 },
    })
    const input = objectSchema.parse(packet['tool_input'])
    expect(input).toEqual({ file_path: 'private/keys.txt', start_line: 1, end_line: 10 })
    const output = JSON.stringify({
      decision: input['file_path'] === 'private/keys.txt' ? 'deny' : 'allow',
    })
    expect(parseGeminiResult('PreToolUse', 0, output, '').status).toBe('blocked')
  })

  it('#1 the saved scanner selectors see a source-shaped write', () => {
    // GW:102,105: take selectors and the scanner expression from the saved
    // Bash script. This portable assertion checks the data-dependent contract;
    // the certification separately records execution of the verbatim script.
    const source = script('block-secrets')
    const selectors = Array.from(source.matchAll(/\.tool_input\.(\w+)/g), (match) => match[1])
    const expression = /grep -qE '([^']+)'/.exec(source)?.[1]
    if (expression === undefined) throw new Error('scanner expression is absent')
    const packet = stdin('PreToolUse', {
      cwd: '/workspace',
      tool_name: 'write_file',
      tool_input: { path: 'hello.txt', content: 'secret' },
    })
    const input = objectSchema.parse(packet['tool_input'])
    expect(input).toEqual({ file_path: 'hello.txt', content: 'secret' })
    const content = selectors
      .map((key) => input[key ?? ''])
      .find((value) => typeof value === 'string')
    expect(typeof content === 'string' && new RegExp(expression).test(content)).toBe(true)
  })

  it.each([
    ['list_files', { glob: '**/*.ts' }],
    ['search', { pattern: 'x', output_mode: 'count' }],
    ['read_file', { path: 'a.txt', offset: 'bad' }],
  ])('#1 unsupported %s arguments refuse the blocking operation', (tool, input) => {
    expect(
      buildGeminiStdin('PreToolUse', { cwd: '/workspace', tool_name: tool, tool_input: input }),
    ).toMatchObject({ outcome: 'refused', blockOperation: true })
  })

  it('#1 an overflowing captured read range refuses the blocking operation', () => {
    expect(
      buildGeminiStdin('PreToolUse', {
        tool_name: 'read_file',
        tool_input: { path: 'a.txt', offset: Number.MAX_SAFE_INTEGER, limit: 2 },
      }),
    ).toMatchObject({ outcome: 'refused', blockOperation: true })
  })

  it('#1 MCP argument objects keep legitimate path and replace keys untouched', () => {
    const input = { path: 'private', replace: 'secret', arguments: { query: 'x' } }
    expect(
      stdin('PreToolUse', { tool_name: 'mcp__srv__tool', tool_input: input })['tool_input'],
    ).toEqual(input)
  })

  it('#2 the verbatim filter-tools.js whitelist survives its ANY mode', () => {
    const packet = capture('BeforeToolSelection.json')
    const request = objectSchema.parse(packet['llm_request'])
    packet['llm_request'] = {
      ...request,
      messages: [{ role: 'user', content: 'read the project' }],
    }
    const result = buildGeminiStdin('BeforeToolSelection', packet, { platform: 'linux' })
    if (result.outcome !== 'run') throw new Error(result.reason)
    const output = execFileSync(process.execPath, ['-e', script('filter-tools')], {
      input: result.stdin,
      env: { PATH: process.env['PATH'] ?? '' },
      encoding: 'utf8',
    })
    expect(parseGeminiResult('BeforeToolSelection', 0, output, '')).toMatchObject({
      status: 'completed',
      allowedToolNames: ['write_todos', 'read_file', 'list_directory'],
    })
  })

  it('#2 ANY without a whitelist vetoes instead of dropping a forced-selection guard', () => {
    expect(
      parseGeminiResult(
        'BeforeToolSelection',
        0,
        '{"hookSpecificOutput":{"toolConfig":{"mode":"ANY"}}}',
        '',
      ),
    ).toMatchObject({ status: 'blocked', allowedToolNames: [] })
  })

  it('#2 malformed selection output cannot erase a guard', () => {
    const output =
      '{"hookSpecificOutput":{"toolConfig":{"mode":"ANY","allowedFunctionNames":[42]}}}'
    expect(parseGeminiResult('BeforeToolSelection', 0, output, '').status).toBe('blocked')
  })

  it('#2 an untranslatable selection input refuses the guarded operation', () => {
    expect(buildGeminiStdin('BeforeToolSelection', { llm_request: null })).toMatchObject({
      outcome: 'refused',
      blockOperation: true,
    })
  })

  it('#7 source-script fixtures retain their provenance and data selectors', () => {
    expect(scripts.map((fixture) => fixture.source)).toEqual([
      'gemini/hooks-writing-hooks.md:95-125',
      'gemini/hooks-writing-hooks.md:153-208',
    ])
    expect(script('block-secrets')).toContain('.tool_input.new_string')
    expect(script('filter-tools')).toContain('llm_request.messages')
  })
})

describe('RVM91P3 model and observation contracts', () => {
  const invalidRequests: readonly unknown[] = [
    null,
    false,
    42,
    'request',
    {},
    [],
    { model: 'm', messages: [], config: null },
    { model: 'm', messages: [{ role: 'user', content: 42 }], config: {} },
    { model: 42, messages: [], config: {} },
    { model: 'm', messages: [], config: { temperature: 'hot' } },
  ]
  it.each(invalidRequests.map((value, index) => ({ value, index })))(
    '#3 invalid request $index refuses every model event',
    ({ value }) => {
      for (const event of ['PreLLMCall', 'PostLLMCall', 'BeforeToolSelection'] as const)
        expect(
          buildGeminiStdin(event, { llm_request: value, llm_response: { candidates: [] } }).outcome,
        ).toBe('refused')
    },
  )

  const invalidResponses: readonly unknown[] = [
    null,
    false,
    42,
    'response',
    {},
    [],
    { candidates: false },
    { candidates: [null] },
    { candidates: [{ content: { role: 'model', parts: [42] } }] },
    { candidates: [], usageMetadata: { totalTokenCount: 'many' } },
  ]
  it.each(invalidResponses.map((value, index) => ({ value, index })))(
    '#3 invalid response $index refuses AfterModel',
    ({ value }) => {
      const packet = capture('AfterModel.json')
      packet['llm_response'] = value
      expect(buildGeminiStdin('PostLLMCall', packet).outcome).toBe('refused')
    },
  )

  it('#3 every captured model chunk remains unchanged, including empty candidates and parts', () => {
    for (const name of [
      'AfterModel.json',
      'AfterModel.empty-candidates-chunk.json',
      'AfterModel.thought-chunk.json',
      'AfterModel.tool-call-chunk.json',
      'AfterModel.finish-chunk.json',
    ]) {
      const packet = capture(name)
      const built = stdin('PostLLMCall', packet)
      expect(built['llm_request']).toEqual(packet['llm_request'])
      expect(built['llm_response']).toEqual(packet['llm_response'])
    }
  })

  it('#4 a shell patch merges against the full execution input, never the clipped stdin preview', () => {
    const command = 'echo ' + 'a'.repeat(20_000)
    const input = {
      tool_name: 'bash',
      tool_input: { command, description: 'original', timeout_ms: 1000 },
    }
    const output = '{"hookSpecificOutput":{"tool_input":{"description":"safe comment"}}}'
    const before = structuredClone(input)
    const answer = parseGeminiResult('PreToolUse', 0, output, '', { input })
    expect(answer).toMatchObject({
      status: 'completed',
      updatedInput: { description: 'safe comment', timeout_ms: 1000 },
    })
    expect(answer.updatedInput?.['command'] === command).toBe(true)
    expect(input).toEqual(before)
  })

  it('#4 a patch without the original execution input vetoes instead of returning an incomplete call', () => {
    const output =
      '{"hookSpecificOutput":{"tool_input":{"description":"safe comment"}},"systemMessage":"review"}'
    expect(parseGeminiResult('PreToolUse', 0, output, '')).toMatchObject({
      status: 'blocked',
      systemMessage: 'review',
    })
  })

  it('#4 translated path patches update the Muse execution argument and retain content', () => {
    const input = { tool_name: 'write_file', tool_input: { path: 'a.txt', content: 'hello' } }
    const output = '{"hookSpecificOutput":{"tool_input":{"file_path":"b.txt"}}}'
    expect(parseGeminiResult('PreToolUse', 0, output, '', { input })).toEqual({
      status: 'completed',
      updatedInput: { path: 'b.txt', content: 'hello' },
    })
  })

  it('#4 a patch with incomplete original arguments vetoes', () => {
    const input = { tool_name: 'bash', tool_input: { description: 'original' } }
    const output = '{"hookSpecificOutput":{"tool_input":{"description":"safe comment"}}}'
    expect(parseGeminiResult('PreToolUse', 0, output, '', { input }).status).toBe('blocked')
  })

  it('#4 MCP patches merge without translating server-owned file_path keys', () => {
    const input = {
      tool_name: 'mcp__srv__tool',
      tool_input: { file_path: 'a.txt', database: 'test' },
    }
    const output = '{"hookSpecificOutput":{"tool_input":{"file_path":"b.txt"}}}'
    expect(parseGeminiResult('PreToolUse', 0, output, '', { input })).toEqual({
      status: 'completed',
      updatedInput: { file_path: 'b.txt', database: 'test' },
    })
  })

  it('#4 unsupported patch value types veto', () => {
    const input = { tool_name: 'bash', tool_input: { command: 'echo hi' } }
    const output = '{"hookSpecificOutput":{"tool_input":{"command":42}}}'
    expect(parseGeminiResult('PreToolUse', 0, output, '', { input }).status).toBe('blocked')
  })

  it('#4 unsupported translated range patches veto rather than silently changing arguments', () => {
    const input = { tool_name: 'read_file', tool_input: { path: 'a.txt', offset: 1, limit: 10 } }
    const output = '{"hookSpecificOutput":{"tool_input":{"end_line":42}}}'
    expect(parseGeminiResult('PreToolUse', 0, output, '', { input }).status).toBe('blocked')
  })

  it.each([
    ['SessionStart', 'SessionStart'],
    ['SessionEnd', 'SessionEnd'],
    ['Notification', 'Notification'],
    ['PreCompact', 'PreCompress'],
  ] as const)(
    '#5 %s ignores lifecycle controls and retains independent observations',
    (event, sourceEvent) => {
      const output = JSON.stringify({
        continue: false,
        decision: 'deny',
        stopReason: 'ignored',
        reason: 'ignored',
        systemMessage: 'warning',
        hookSpecificOutput: { hookEventName: sourceEvent, additionalContext: 'context' },
      })
      expect(parseGeminiResult(event, 0, output, '')).toEqual({
        status: 'completed',
        systemMessage: 'warning',
        context: 'context',
      })
    },
  )

  it('#6 Notification retains documented details without inventing missing data (GR:277-281, doc-derived)', () => {
    const details = {
      tool_name: 'run_shell_command',
      file_path: 'private/keys.txt',
      extra: { event: 'permission' },
    }
    const payload = { message: 'permission', notification_type: 'ToolPermission', details }
    expect(stdin('Notification', payload)['details']).toEqual(details)
    expect(stdin('Notification', { message: 'permission' })).not.toHaveProperty('details')
    expect(buildGeminiStdin('Notification', { details: null }).outcome).toBe('refused')
  })
})
