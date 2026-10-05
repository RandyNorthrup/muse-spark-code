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
    const result = buildGeminiStdin('BeforeToolSelection', packet)
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

  it('#7 source-script fixtures retain their provenance and data selectors', () => {
    expect(scripts.map((fixture) => fixture.source)).toEqual([
      'gemini/hooks-writing-hooks.md:95-125',
      'gemini/hooks-writing-hooks.md:153-208',
    ])
    expect(script('block-secrets')).toContain('.tool_input.new_string')
    expect(script('filter-tools')).toContain('llm_request.messages')
  })
})
