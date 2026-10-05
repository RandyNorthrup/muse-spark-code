// M91 lane P round 3: engine invariants proven once over EVERY contract row
// (hookFormats/contracts/*). A new row is covered by adding it to a table.
// Fake-only: no vendor CLI and no model call.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type AdapterOptions,
  type HookFormat,
  type VendorContract,
  HOOK_FORMAT_CONTRACTS,
  HOOK_FORMATS,
  buildForeignStdin,
  parseForeignResult,
} from '../../src/core/backends/modelapi/hookFormats'

type Row = VendorContract['rows'][number]
type Field = Row['fields'][number]
interface Case {
  readonly format: HookFormat
  readonly row: Row
  readonly name: string
}

const ROOT = '/project'
const TOOL_BY_CLASS = {
  shell: 'bash',
  read: 'read_file',
  write: 'write_file',
  edit: 'edit_file',
  mcp: 'mcp__srv__tool',
  other: 'search',
} as const

const CASES: readonly Case[] = HOOK_FORMATS.flatMap((format) =>
  HOOK_FORMAT_CONTRACTS[format].rows.map((row) => ({
    format,
    row,
    name: `${format}/${row.flavor ?? '-'}/${row.vendor}<-${row.muse}`,
  })),
)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolFor(row: Row): string {
  const first = row.tools?.[0]
  return first === undefined ? TOOL_BY_CLASS.shell : TOOL_BY_CLASS[first]
}

/** A payload carrying every source any row reads, shaped for this row's tool. */
function fullPayload(row: Row, root = ROOT): Record<string, unknown> {
  const tool = toolFor(row)
  let toolInput: Record<string, unknown> = {
    command: 'echo hi',
    path: 'src/a.ts',
    find: 'a',
    replace: 'b',
  }
  if (tool === TOOL_BY_CLASS.mcp) toolInput = { query: 'x', database: 'production' }
  else if (tool === TOOL_BY_CLASS.shell) toolInput = { command: 'echo hi' }
  return {
    session_id: 'session-1',
    turn_id: 'turn-1',
    cwd: root,
    timestamp: '2026-10-04T00:00:00.000Z',
    model: 'model-1',
    tool_name: tool,
    tool_input: toolInput,
    tool_response: 'preview',
    content: 'file text',
    prompt: 'hello',
    text: 'thinking',
    last_assistant_message: 'done',
    worktree_path: `${root}/wt`,
    llm_request: { model: 'm', messages: [], config: {} },
    llm_response: { candidates: [] },
    status: 'completed',
    source: 'startup',
    reason: 'complete',
    trigger: 'auto',
    message: 'note',
    notification_type: 'permission_prompt',
  }
}

function optionsFor(row: Row, extra: AdapterOptions = {}): AdapterOptions {
  return {
    platform: 'linux',
    ...(row.selection === 'explicit' && { sourceEvent: row.vendor }),
    ...(row.flavor !== undefined && { flavor: row.flavor }),
    ...extra,
  }
}

function pathOf(value: unknown, dotted: string): unknown {
  let current = value
  for (const key of dotted.split('.')) {
    if (!isObject(current)) return undefined
    current = current[key]
  }
  return current
}

function setPath(target: Record<string, unknown>, dotted: string, item: unknown): void {
  const [head = '', ...rest] = dotted.split('.')
  if (rest.length === 0) {
    target[head] = item
    return
  }
  const next = target[head]
  const child: Record<string, unknown> = isObject(next) ? next : {}
  target[head] = child
  setPath(child, rest.join('.'), item)
}

function deletePath(target: Record<string, unknown>, dotted: string): void {
  const keys = dotted.split('.')
  const last = keys.pop() ?? ''
  const parent = keys.length === 0 ? target : pathOf(target, keys.join('.'))
  if (isObject(parent)) Reflect.deleteProperty(parent, last)
}

function sourcesOf(field: Field): readonly string[] {
  if (field.value !== undefined) return []
  return typeof field.from === 'string' ? [field.from] : (field.from ?? [field.to])
}

function stdinOf(c: Case, payload: Record<string, unknown>, options: AdapterOptions) {
  const result = buildForeignStdin(c.format, c.row.muse, payload, options)
  if (result.outcome !== 'run') throw new Error(`${c.name}: ${result.outcome} ${result.reason}`)
  const value: unknown = JSON.parse(result.stdin)
  if (!isObject(value)) throw new Error(`${c.name}: stdin is not an object`)
  return value
}

/** Input the answer belongs to: the row's tool plus what a rule's `when` needs. */
function inputFor(row: Row, when?: { path: string; equals: string } | { toolClass: string }) {
  const input: Record<string, unknown> = { tool_name: toolFor(row) }
  if (when !== undefined && 'path' in when) input[when.path] = when.equals
  if (when !== undefined && 'toolClass' in when && when.toolClass === 'mcp')
    input['tool_name'] = TOOL_BY_CLASS.mcp
  return input
}

describe('every row is reachable and cited', () => {
  it.each(CASES)('$name builds with a complete payload', (c) => {
    const stdin = stdinOf(c, fullPayload(c.row), optionsFor(c.row))
    for (const field of c.row.fields)
      if (field.required === true) expect(pathOf(stdin, field.to), field.to).toBeDefined()
    for (const field of c.row.fields)
      if (field.from === '@event') expect(pathOf(stdin, field.to)).toBe(c.row.vendor)
  })

  it.each(CASES)('$name cites saved sources', (c) => {
    for (const cite of [c.row.cite.input, c.row.cite.output])
      expect(cite).toMatch(/^[\w./-]+\.(md|out|html):\d+/)
  })

  it.each(HOOK_FORMATS)(
    '%s rows are unique and parse-ambiguous rows share one result',
    (format) => {
      const contract = HOOK_FORMAT_CONTRACTS[format]
      const keys = contract.rows.map((row) => `${row.muse}|${row.flavor ?? ''}|${row.vendor}`)
      expect(new Set(keys).size).toBe(keys.length)
      const groups = new Map<string, Row[]>()
      for (const row of contract.rows) {
        if (row.selection !== 'default') continue
        const key = `${row.muse}|${row.flavor ?? contract.defaultFlavor ?? ''}`
        groups.set(key, [...(groups.get(key) ?? []), row])
      }
      for (const group of groups.values()) {
        if (!(group.length > 1)) {
          continue
        }

        // Several default rows must be told apart by disjoint tool classes, and
        // a parse without the tool must not depend on which one is chosen.
        const classes = group.flatMap((row): readonly string[] => row.tools ?? ['*'])
        expect(new Set(classes).size).toBe(classes.length)
        for (const row of group) expect(row.result).toBe(group[0]?.result)
      }
    },
  )
})

describe('missing required data refuses; nothing is guessed', () => {
  it.each(CASES.filter((c) => c.row.fields.some((field) => field.required === true)))(
    '$name refuses each missing required field',
    (c) => {
      for (const field of c.row.fields) {
        if (field.required !== true) continue
        const payload = fullPayload(c.row)
        for (const source of sourcesOf(field)) if (source !== '@event') deletePath(payload, source)
        const result = buildForeignStdin(c.format, c.row.muse, payload, optionsFor(c.row))
        expect(result.outcome, field.to).toBe('refused')
      }
    },
  )
})

describe('a documented veto never becomes failed or allow', () => {
  const vetoCases = CASES.flatMap((c) =>
    c.row.result.rules.flatMap((rule, index) =>
      rule.kind === 'veto' ? [{ ...c, rule, label: `${c.name} veto ${String(index)}` }] : [],
    ),
  )

  it.each(vetoCases)('$label survives an unsupported sibling field', ({ format, row, rule }) => {
    const output: Record<string, unknown> = { zz_unsupported: 42 }
    for (const [key, expected] of Object.entries(rule.match))
      setPath(output, key, typeof expected === 'object' ? expected[0] : expected)
    if (rule.nonEmpty !== undefined) setPath(output, rule.nonEmpty, 'keep going')
    for (const isFailClosed of [false, true]) {
      const options = optionsFor(row, { input: inputFor(row, rule.when), failClosed: isFailClosed })
      const answer = parseForeignResult(format, row.muse, 0, JSON.stringify(output), '', options)
      expect(answer.status).toBe('blocked')
      expect(answer.approvalDecision).not.toBe('allow')
      expect(answer.reason).toBeTruthy()
    }
  })

  const blocking = CASES.filter(
    (c) => c.row.result.blockCodes.length > 0 || c.row.result.blockFrom !== undefined,
  )
  it.each(blocking)('$name block exits block', (c) => {
    const from = c.row.result.blockFrom
    for (const code of [
      ...c.row.result.blockCodes,
      ...(from === undefined ? [] : [from, from + 1]),
    ]) {
      const answer = parseForeignResult(c.format, c.row.muse, code, '', 'policy', optionsFor(c.row))
      expect(answer.status).toBe('blocked')
    }
  })
})

describe('a foreign allow never grants', () => {
  const allows = [
    '{"permission":"allow"}',
    '{"permissionDecision":"allow"}',
    '{"behavior":"allow"}',
    '{"decision":"allow"}',
    '{"continue":true}',
    '{"hookSpecificOutput":{"permissionDecision":"allow"}}',
    // Asks must stay asks: never upgraded to a grant.
    '{"permission":"ask"}',
    '{"permissionDecision":"ask"}',
    '{"hookSpecificOutput":{"permissionDecision":"ask"}}',
    '{}',
    '',
    'not json',
  ]
  it.each(CASES)('$name produces no allow grant', (c) => {
    for (const exitCode of [0, 1, 2, 3, null])
      for (const stdout of allows) {
        const answer = parseForeignResult(
          c.format,
          c.row.muse,
          exitCode,
          stdout,
          '',
          optionsFor(c.row),
        )
        expect(answer.approvalDecision).not.toBe('allow')
        expect(answer.permissionDecision).not.toBe('allow')
      }
  })
})

describe('failClosed applies exactly where a row declares it', () => {
  const probes: readonly (readonly [number | null, string])[] = [
    [1, ''],
    [3, ''],
    [null, ''],
    [0, ''],
    [0, '{'],
  ]
  it.each(CASES)('$name', (c) => {
    for (const [exitCode, stdout] of probes) {
      const closed = parseForeignResult(
        c.format,
        c.row.muse,
        exitCode,
        stdout,
        '',
        optionsFor(c.row, { failClosed: true }),
      )
      const open = parseForeignResult(c.format, c.row.muse, exitCode, stdout, '', optionsFor(c.row))
      if (c.row.result.failClosed === true && c.row.result.stdout !== 'ignore')
        expect(closed.status, `${String(exitCode)} ${stdout}`).toBe('blocked')
      else expect(closed).toEqual(open)
    }
  })

  it.each(HOOK_FORMATS)(
    '%s: a vendor that honours failClosed declares it on every blocking row',
    (format) => {
      const rows = HOOK_FORMAT_CONTRACTS[format].rows
      if (rows.some((row) => row.result.failClosed === true))
        for (const row of rows)
          if (row.result.blockCodes.length > 0) expect(row.result.failClosed, row.vendor).toBe(true)
    },
  )
})

describe('schema and type errors follow the row', () => {
  it.each(CASES.filter((c) => c.row.result.schema !== undefined))('$name', (c) => {
    const spec = c.row.result
    const answer = parseForeignResult(
      c.format,
      c.row.muse,
      0,
      '{"zz_unsupported":42}',
      '',
      optionsFor(c.row),
    )
    const expected = { block: 'blocked', fail: 'failed', ignore: 'completed' }[spec.invalid]
    expect(answer.status).toBe(expected)
    const garbled = parseForeignResult(c.format, c.row.muse, 0, '{', '', optionsFor(c.row))
    const isLenient = spec.unparseableIsEmpty === true || spec.textIsMessage === true
    expect(garbled.status).toBe(isLenient ? 'completed' : expected)
  })
})

describe('bounded work', () => {
  const directory = path.join(process.cwd(), 'src/core/backends/modelapi/hookFormats')
  const files = [
    ...readdirSync(directory).map((name) => path.join(directory, name)),
    ...readdirSync(path.join(directory, 'contracts')).map((name) =>
      path.join(directory, 'contracts', name),
    ),
  ].filter((file) => file.endsWith('.ts'))

  it('no adapter source constructs a regular expression at run time', () => {
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bRegExp\s*\(/)
  })

  it.each(CASES)('$name parses 1 MiB output without hanging', (c) => {
    const big = JSON.stringify({ zz: 'x'.repeat(1024 * 1024) })
    const started = Date.now()
    parseForeignResult(c.format, c.row.muse, 0, big, '', optionsFor(c.row))
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('paths: no ambiguous Windows forms; cwd stays in the workspace', () => {
  const pathFields = CASES.flatMap((c) =>
    c.row.fields
      .filter((field) => field.transform === 'absolutePath' || field.transform === 'containedCwd')
      .map((field) => ({ ...c, field, label: `${c.name} ${field.to}` })),
  )
  const WIN_ROOT = String.raw`C:\ws`

  it.each(pathFields)(
    '$label refuses drive-relative, UNC, device and rooted forms',
    ({ format, row, field }) => {
      const source = sourcesOf(field)[0] ?? field.to
      for (const bad of [
        'D:x',
        'C:',
        String.raw`\\server\share`,
        String.raw`\\?\C:\x`,
        String.raw`\x`,
      ]) {
        const payload = fullPayload(row, WIN_ROOT)
        payload['worktree_path'] = String.raw`${WIN_ROOT}\wt`
        // A list of sources is tried in order: clear the others so `bad` is used.
        for (const other of sourcesOf(field)) deletePath(payload, other)
        setPath(payload, source, bad)
        const options = optionsFor(row, { platform: 'win32', workspaceRoot: WIN_ROOT })
        const result = buildForeignStdin(format, row.muse, payload, options)
        expect(result.outcome, bad).toBe('refused')
        if (result.outcome === 'refused') expect(result.reason).toContain(field.to)
      }
    },
  )

  it.each(pathFields.filter((c) => c.field.transform === 'containedCwd'))(
    '$label refuses a cwd outside the workspace',
    ({ format, row }) => {
      const payload = { ...fullPayload(row), cwd: '/elsewhere' }
      const result = buildForeignStdin(
        format,
        row.muse,
        payload,
        optionsFor(row, { workspaceRoot: ROOT }),
      )
      expect(result.outcome).toBe('refused')
    },
  )
})
