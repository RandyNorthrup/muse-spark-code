// M91 lane P round 3 golden fixtures: the vendor docs' own examples, verbatim
// (test/fixtures/hookFormats/docs/*.json, each citing hooks-parity file:lines),
// and the stdin real CLIs sent (test/fixtures/hookFormats/captured/, scrubbed;
// see its manifest.json). Every emitted stdin key must be one the source shows;
// every doc output must parse to the answer the source describes.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  type AdapterOptions,
  type HookFormat,
  type VendorContract,
  HOOK_FORMAT_CONTRACTS,
  buildForeignStdin,
  parseForeignResult,
} from '../../src/core/backends/modelapi/hookFormats'

type Row = VendorContract['rows'][number]
const FIXTURES = path.join(process.cwd(), 'test/fixtures/hookFormats')
const ROOT = '/workspace'

const fixtureSchema = z.array(
  z.object({
    id: z.string(),
    vendor: z.enum(['cursor', 'copilot', 'vscode', 'windsurf', 'kiro']),
    flavor: z.optional(z.string()),
    event: z.string(),
    direction: z.enum(['stdin', 'stdout']),
    exitCode: z.optional(z.number()),
    source: z.string(),
    raw: z.string(),
    json: z.optional(z.unknown()),
  }),
)
type Fixture = z.infer<typeof fixtureSchema>[number]

const docs: readonly Fixture[] = ['cursor', 'copilot', 'vscode', 'windsurf', 'kiro'].flatMap(
  (name) =>
    fixtureSchema.parse(
      JSON.parse(readFileSync(path.join(FIXTURES, 'docs', `${name}.json`), 'utf8')),
    ),
)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatOf(fixture: Fixture): { format: HookFormat; flavor: string | undefined } {
  if (fixture.vendor === 'vscode') return { format: 'copilot', flavor: 'vscode' }
  return fixture.vendor === 'copilot'
    ? { format: 'copilot', flavor: 'copilot' }
    : { format: fixture.vendor, flavor: undefined }
}

function rowOf(format: HookFormat, flavor: string | undefined, event: string): Row | undefined {
  const contract = HOOK_FORMAT_CONTRACTS[format]
  return contract.rows.find(
    (row) =>
      (row.flavor ?? contract.defaultFlavor) === (flavor ?? contract.defaultFlavor) &&
      (row.vendor === event || row.aliases?.includes(event) === true),
  )
}

/** Vendor events the tables refuse on purpose, with the decision behind each. */
const REFUSED_EVENTS: Readonly<Record<string, string>> = {
  // m91-lane-common decision I: its original can block where ours cannot.
  'cursor/subagentStart': 'lane-common I',
  // Tab hooks arrive with M94 lane K (lane-common round 2).
  'cursor/beforeTabFileRead': 'M94 lane K',
  'cursor/afterTabFileEdit': 'M94 lane K',
  // Mutation-only prompt rewrite (C:371-395); Muse has no such event.
  'copilot/userPromptTransformed': 'no Muse event',
  // m91-research.md:223: the transcript variant is refused.
  'windsurf/post_cascade_response_with_transcript': 'm91-research',
}

/** Documented common input outside the per-event examples. */
const COMMON_KEYS: Readonly<Record<string, readonly string[]>> = {
  // docs_devin_ai_desktop_cascade_hooks_md.out:139-146 (examples omit them, :148).
  windsurf: [
    'agent_action_name',
    'trajectory_id',
    'execution_id',
    'timestamp',
    'model_name',
    'tool_info',
  ],
  // vsc/hooks-reference.md:71-77.
  vscode: ['timestamp', 'cwd', 'session_id', 'hook_event_name', 'transcript_path'],
  // cursor_com_docs_hooks_md.out:815-826 (the cursor-common-stdin-1 fixture).
  cursor: Object.keys(docs.find((fixture) => fixture.id === 'cursor-common-stdin-1')?.json ?? {}),
}

/** Keys a block shows: JSON keys, or identifiers before a colon in a schema block. */
function keysOf(fixture: Fixture): readonly string[] {
  return isObject(fixture.json)
    ? Object.keys(fixture.json)
    : Array.from(fixture.raw.matchAll(/^\s*"?([A-Za-z_]\w*)"?\??\s*:/gm), (match) => match[1] ?? '')
}

const TOOL_BY_EVENT: Readonly<Record<string, string>> = {
  beforeMCPExecution: 'mcp__srv__tool',
  afterMCPExecution: 'mcp__srv__tool',
  pre_mcp_tool_use: 'mcp__srv__tool',
  post_mcp_tool_use: 'mcp__srv__tool',
  beforeReadFile: 'read_file',
  pre_read_code: 'read_file',
  post_read_code: 'read_file',
  afterFileEdit: 'edit_file',
  pre_write_code: 'edit_file',
  post_write_code: 'edit_file',
}

function payloadFor(event: string): Record<string, unknown> {
  const tool = TOOL_BY_EVENT[event] ?? 'bash'
  return {
    session_id: 'session-1',
    turn_id: 'turn-1',
    cwd: ROOT,
    timestamp: '2026-10-04T00:00:00.000Z',
    model: 'model-1',
    tool_name: tool,
    tool_input:
      tool === 'mcp__srv__tool'
        ? { owner: 'o' }
        : { command: 'echo hi', path: 'a.py', find: 'a', replace: 'b' },
    tool_response: 'preview',
    content: 'text',
    prompt: 'hello',
    text: 'thinking',
    last_assistant_message: 'done',
    worktree_path: `${ROOT}/wt`,
    status: 'completed',
    source: 'startup',
    reason: 'complete',
    trigger: 'auto',
  }
}

function optionsFor(row: Row): AdapterOptions {
  return {
    platform: 'linux',
    ...(row.selection === 'explicit' && { sourceEvent: row.vendor }),
    ...(row.flavor !== undefined && { flavor: row.flavor }),
  }
}

function kind(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  return value === null ? 'null' : typeof value
}

describe('every documented event is a row or refused on purpose', () => {
  it.each(docs.filter((fixture) => fixture.event !== 'common'))('$id', (fixture) => {
    const { format, flavor } = formatOf(fixture)
    const refused = REFUSED_EVENTS[`${format}/${fixture.event}`]
    expect(rowOf(format, flavor, fixture.event) === undefined).toBe(refused !== undefined)
  })
})

describe('doc stdin: every emitted key is documented, with the documented type', () => {
  const groups = new Map<string, Fixture[]>()
  for (const fixture of docs) {
    if (fixture.direction !== 'stdin' || fixture.event === 'common') continue
    const key = `${fixture.vendor}/${fixture.flavor ?? ''}/${fixture.event}`
    groups.set(key, [...(groups.get(key) ?? []), fixture])
  }
  const cases = [...groups].flatMap(([key, fixtures]) => {
    const first = fixtures[0]
    if (first === undefined) return []
    const { format, flavor } = formatOf(first)
    const row = rowOf(format, flavor, first.event)
    return row === undefined ? [] : [{ key, fixtures, format, row }]
  })

  it.each(cases)('$key', ({ fixtures, format, row }) => {
    const result = buildForeignStdin(format, row.muse, payloadFor(row.vendor), optionsFor(row))
    if (result.outcome !== 'run') throw new Error(`${result.outcome}: ${result.reason}`)
    const stdin: unknown = JSON.parse(result.stdin)
    if (!isObject(stdin)) throw new Error('stdin is not an object')
    const documented = new Set([
      ...fixtures.flatMap((fixture) => keysOf(fixture)),
      ...(COMMON_KEYS[fixtures[0]?.vendor ?? ''] ?? []),
    ])
    expect(Object.keys(stdin).filter((key) => !documented.has(key))).toEqual([])
    for (const fixture of fixtures) {
      const json = fixture.json
      if (!isObject(json)) continue
      for (const [key, value] of Object.entries(stdin)) {
        if (!Object.hasOwn(json, key)) continue
        // Doc placeholders such as "string | null" are strings; null is allowed there.
        if (value === null && typeof json[key] === 'string') continue
        expect(kind(value), `${fixture.id} ${key}`).toBe(kind(json[key]))
        const nested = json[key]
        if (isObject(value) && isObject(nested) && ['tool_info', 'tool_response'].includes(key))
          for (const [inner, innerValue] of Object.entries(value)) {
            expect(Object.keys(nested), `${fixture.id} ${key}.${inner}`).toContain(inner)
            expect(kind(innerValue)).toBe(kind(nested[inner]))
          }
      }
    }
  })
})

/** What each doc output means, per its source lines (fixture id → answer). */
const STDOUT_EXPECTATIONS: Readonly<
  Record<string, { input?: Record<string, unknown>; answer: object }>
> = {
  'cursor-postToolUse-stdout-1': {
    input: { tool_name: 'mcp__srv__tool' },
    answer: {
      status: 'completed',
      context: 'Test coverage report attached.',
      replacement: { target: 'toolResult', value: { modified: 'output' } },
    },
  },
  'cursor-postToolUseFailure-stdout-1': {
    answer: {
      status: 'completed',
      context: 'Tests time out on CI runners. Retry with --maxWorkers=2.',
    },
  },
  'cursor-subagentStop-stdout-1': {
    input: { status: 'completed' },
    answer: { status: 'blocked', reason: '<auto-continue with this message>' },
  },
  'cursor-beforeShellExecution-stdout-2': {
    answer: {
      status: 'blocked',
      systemMessage: 'Git command blocked. Please use the GitHub CLI (gh) tool instead.',
    },
  },
  'cursor-beforeShellExecution-stdout-3': {
    answer: { status: 'completed', permissionDecision: 'ask' },
  },
  'cursor-beforeShellExecution-stdout-4': { answer: { status: 'completed' } },
  'cursor-stop-stdout-1': { answer: { status: 'blocked', reason: '<message text>' } },
  // CH:1351 env would leak into later hooks: refused (lane-common round 2 P).
  'cursor-sessionStart-stdout-1': { answer: { status: 'failed' } },
  'cursor-preCompact-stdout-1': {
    answer: { status: 'completed', systemMessage: '<message to show when compaction occurs>' },
  },
  // CH:1441 pluginPaths would load plugins: refused.
  'cursor-workspaceOpen-stdout-1': { answer: { status: 'failed' } },
  // Third-party (Claude-format) outputs: Cursor-native permission parsing still
  // blocks both denies (one as an invalid permission answer, CH:194).
  'cursor-preToolUse-stdout-2': { answer: { status: 'blocked' } },
  'cursor-preToolUse-stdout-3': { answer: { status: 'blocked', reason: 'Blocked by policy' } },
  // Claude-format Stop outputs are not the Cursor-native followup contract.
  'cursor-stop-stdout-2': { answer: { status: 'failed' } },
  'cursor-stop-stdout-3': { answer: { status: 'failed' } },
  'cursor-stop-stdout-4': {
    answer: { status: 'blocked', reason: 'Tasks incomplete, continue working' },
  },
  'cursor-subagentStop-stdout-2': { input: { status: 'completed' }, answer: { status: 'failed' } },
  'cursor-subagentStop-stdout-3': { input: { status: 'completed' }, answer: { status: 'failed' } },
  'cursor-subagentStop-stdout-4': {
    input: { status: 'completed' },
    answer: { status: 'blocked', reason: 'Tasks incomplete, continue working' },
  },
  'cursor-preToolUse-stdout-4': {
    answer: {
      status: 'blocked',
      reason: 'Destructive command blocked',
      systemMessage: 'Destructive command blocked',
    },
  },
  'cursor-preToolUse-stdout-5': { answer: { status: 'completed' } },
  'copilot-permissionRequest-stdout-1': {
    answer: { status: 'blocked', approvalDecision: 'deny', reason: 'copilot hook denied the call' },
  },
  'copilot-preToolUse-stdout-3': {
    answer: { status: 'blocked', reason: 'Privilege escalation requires manual approval.' },
  },
  'vscode-common-stdout-1': {
    answer: {
      status: 'blocked',
      stopReason: 'Security policy violation',
      systemMessage: 'Review the hook result.',
    },
  },
  'vscode-PreToolUse-stdout-1': {
    answer: {
      status: 'blocked',
      reason: 'Destructive command blocked by policy.',
      context: 'Production files are read-only.',
    },
  },
  'vscode-PostToolUse-stdout-1': {
    answer: {
      status: 'blocked',
      reason: 'Post-processing validation failed.',
      context: 'The edited file has lint errors.',
    },
  },
  'vscode-SessionStart-stdout-1': {
    answer: { status: 'completed', context: 'Project: my-app 2.1.0 | Branch: main' },
  },
  'vscode-Stop-stdout-1': {
    answer: { status: 'blocked', reason: 'Run the test suite before finishing.' },
  },
  'vscode-SubagentStart-stdout-1': {
    answer: { status: 'completed', context: 'Follow the project coding guidelines.' },
  },
  'vscode-SubagentStop-stdout-1': {
    answer: { status: 'blocked', reason: 'Verify the results before completing.' },
  },
  'vscode-common-stdout-2': { answer: { status: 'completed', systemMessage: 'Unit tests failed' } },
  'vscode-PreToolUse-stdout-3': {
    answer: { status: 'blocked', reason: 'Destructive command blocked by security policy' },
  },
  'vscode-PreToolUse-stdout-4': { answer: { status: 'completed' } },
  'vscode-PostToolUse-stdout-2': { answer: { status: 'completed' } },
  'vscode-PreToolUse-stdout-5': { answer: { status: 'completed' } },
  'vscode-PreToolUse-stdout-6': { answer: { status: 'completed', permissionDecision: 'ask' } },
  'vscode-PreToolUse-stdout-7': { answer: { status: 'completed' } },
  'vscode-SessionStart-stdout-3': { answer: { status: 'completed' } },
  'kiro-stop-stdout-1': { answer: { status: 'blocked', reason: "You haven't run the tests yet." } },
}

describe('doc stdout: the documented answer', () => {
  const jsonOutputs = docs.filter((f) => f.direction === 'stdout' && f.json !== undefined)

  it('every JSON doc output has an expectation', () => {
    expect(
      jsonOutputs.map((f) => f.id).filter((id) => STDOUT_EXPECTATIONS[id] === undefined),
    ).toEqual([])
  })

  it.each(jsonOutputs.filter((f) => f.event !== 'common' || f.vendor === 'vscode'))(
    '$id',
    (fixture) => {
      const expected = STDOUT_EXPECTATIONS[fixture.id]
      if (expected === undefined) throw new Error('missing expectation')
      const { format, flavor } = formatOf(fixture)
      // VS Code common output applies to every event; check it on UserPromptSubmit.
      const event = fixture.event === 'common' ? 'UserPromptSubmit' : fixture.event
      const row = rowOf(format, flavor, event)
      if (row === undefined) throw new Error(`no row for ${event}`)
      const options = {
        ...optionsFor(row),
        ...(expected.input !== undefined && { input: expected.input }),
      }
      const answer = parseForeignResult(
        format,
        row.muse,
        fixture.exitCode ?? 0,
        fixture.raw,
        '',
        options,
      )
      expect(answer).toMatchObject(expected.answer)
      expect(answer.approvalDecision).not.toBe('allow')
    },
  )
})

describe('captured stdin (real CLIs, scrubbed)', () => {
  const geminiDir = path.join(FIXTURES, 'captured', 'gemini')
  const captured = readdirSync(geminiDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const value: unknown = JSON.parse(readFileSync(path.join(geminiDir, name), 'utf8'))
      if (!isObject(value)) throw new Error(`${name} is not an object`)
      return { name, value, event: String(value['hook_event_name']) }
    })

  it('every Gemini event that fired has a row', () => {
    for (const { event } of captured) expect(rowOf('gemini', undefined, event), event).toBeDefined()
  })

  // One representative per event; tool rows use the shell capture.
  const representatives = captured.filter(
    ({ name }) =>
      !name.includes('.') || /^[A-Za-z]+\.json$/.test(name) || name.includes('run_shell_command'),
  )
  it.each(representatives)(
    'Gemini $name: our keys are the captured keys, same types',
    ({ value, event }) => {
      const row = rowOf('gemini', undefined, event)
      if (row === undefined) throw new Error(`no row for ${event}`)
      const payload = {
        ...payloadFor(event),
        llm_request: value['llm_request'],
        llm_response: value['llm_response'],
        prompt_response: value['prompt_response'],
      }
      const result = buildForeignStdin('gemini', row.muse, payload, optionsFor(row))
      if (result.outcome !== 'run') throw new Error(`${result.outcome}: ${result.reason}`)
      const stdin: unknown = JSON.parse(result.stdin)
      if (!isObject(stdin)) throw new Error('stdin is not an object')
      for (const [key, item] of Object.entries(stdin)) {
        expect(Object.keys(value), key).toContain(key)
        expect(kind(item), key).toBe(kind(value[key]))
      }
      expect(stdin['hook_event_name']).toBe(value['hook_event_name'])
      const response = value['tool_response']
      if (isObject(response)) expect(Object.keys(response)).toContain('llmContent')
    },
  )

  it('Claude Code captures confirm the snake_case tool fields the Local flavor sends', () => {
    // vsc/hooks-reference.md:131-143 mirror Claude's names; the capture is real.
    const pre: unknown = JSON.parse(
      readFileSync(path.join(FIXTURES, 'captured', 'claude', 'PreToolUse.Bash.json'), 'utf8'),
    )
    if (!isObject(pre)) throw new Error('capture is not an object')
    const result = buildForeignStdin('copilot', 'PreToolUse', payloadFor('PreToolUse'), {
      flavor: 'vscode',
      platform: 'linux',
    })
    if (result.outcome !== 'run') throw new Error(result.reason)
    const stdin: unknown = JSON.parse(result.stdin)
    if (!isObject(stdin)) throw new Error('stdin is not an object')
    for (const key of ['hook_event_name', 'session_id', 'cwd', 'tool_name', 'tool_input']) {
      expect(Object.keys(pre), key).toContain(key)
      expect(kind(stdin[key]), key).toBe(kind(pre[key]))
    }
  })
})
