// M96b contracts (C-M96b-0, PLAN.md D75): the frozen ACP team mapping.
import type { ContentBlock, PermissionOption, ToolCallContent } from '@agentclientprotocol/sdk'
import sdkSchema from '@agentclientprotocol/sdk/schema/schema.json'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  TeamContractError,
  TEAM_PERMISSION_OPTION_KINDS,
  TEAM_PLAN_PRIORITY,
  TEAM_TASK_TOOL_KIND,
  TEAM_TOOL_CALL_PREFIX,
  formatTeamPermissionTitle,
  isTeamToolCallId,
  normalizeTeamPath,
  parseTeamPermissionTitle,
  teamDiff,
  teamDiffSchema,
  teamExecAdmission,
  teamMergeCompletedCall,
  teamMergeRequest,
  teamMergeRequestSchema,
  teamMergeToolCallId,
  teamPlanEntries,
  teamPlanEntrySchema,
  teamReportContent,
  teamTaskDiffUpdate,
  teamTaskReportUpdate,
  teamTaskToolCall,
  teamTaskToolCallId,
  teamTaskUpdateSchema,
  teamToolContentSchema,
  type TeamPlanTask,
} from '../../src/acp/teamContracts'
import { UI_TEXT } from '../../src/shared/constants'

const DIFF = teamDiff({ path: '/repo/a.ts', oldText: 'a', newText: 'b' })
const OPTIONS: PermissionOption[] = [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }]
const SDK_OPTION_KINDS = sdkSchema.$defs.PermissionOptionKind.oneOf.map((option) => option.const)
const SDK_CONTENT_BLOCKS: Record<string, ContentBlock> = {
  text: { type: 'text', text: 'report' },
  image: { type: 'image', data: 'AA==', mimeType: 'image/png' },
  audio: { type: 'audio', data: 'AA==', mimeType: 'audio/wav' },
  resource_link: { type: 'resource_link', uri: 'file:///repo/a.ts', name: 'a.ts' },
  resource: { type: 'resource', resource: { uri: 'file:///repo/a.ts', text: 'a' } },
}
const SDK_TOOL_CONTENT: Record<string, ToolCallContent> = {
  content: { type: 'content', content: { type: 'text', text: 'report' } },
  diff: DIFF,
  terminal: { type: 'terminal', terminalId: 'term' },
}

function atRuntime<T>(input: NoInfer<T> | object | null | number): T {
  // NoInfer keeps malformed input from choosing the typed port's return shape.
  // Deliberately bypass the typed port to test malformed caller values (PLAN.md §8).
  return input as T
}

function withHole<T>(entries: readonly T[], index: number): T[] {
  const sparse = [...entries]
  // Deliberately remove a slot without changing length to exercise sparse caller arrays.
  Reflect.deleteProperty(sparse, index)
  return sparse
}

/** The same indexed entries, but iterating the array yields something else. */
function withYields<T>(entries: readonly T[], yielded: readonly T[]): T[] {
  const hostile = [...entries]
  hostile[Symbol.iterator] = () => [...yielded].values()
  return hostile
}

/** The same indexed entries carrying an enumerable data-valued own property. */
function withDataShadow<T>(entries: readonly T[], key: string, value: unknown): T[] {
  const hostile = [...entries]
  Object.defineProperty(hostile, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
  return hostile
}

/** The same indexed entries with an explicitly redefined array length. */
function withLengthShadow<T>(entries: readonly T[]): T[] {
  const hostile = [...entries]
  Object.defineProperty(hostile, 'length', { value: hostile.length, writable: true })
  return hostile
}

/** Data-valued own properties that must never reach native dispatch. */
const DATA_SHADOWS: readonly (readonly [string, unknown])[] = [
  ['map', 'extra'],
  ['map', null],
  ['filter', 'extra'],
  ['forEach', null],
  ['constructor', 'extra'],
  ['constructor', null],
]

/** Every shadow variant of a collection, passed directly and pre-cloned. */
function shadowVariants<T>(entries: readonly T[]): T[][] {
  const hostile = [
    ...DATA_SHADOWS.map(([key, value]) => withDataShadow(entries, key, value)),
    withLengthShadow(entries),
    withYields(entries, []),
  ]
  return [...hostile, ...hostile.map((variant) => structuredClone(variant))]
}

/**
 * A shadowed collection builds exactly the clean output, or refuses with the
 * typed contract error — a raw `TypeError` from shadowed dispatch never escapes.
 */
function expectCleanOrTyped(build: () => unknown, clean: unknown): void {
  let output: unknown
  try {
    output = build()
  } catch (error) {
    expect(error).toBeInstanceOf(TeamContractError)
    return
  }
  expect(output).toEqual(clean)
}

// Every hostile scalar below is invalid for its field: `''` is a valid
// report, name and mode, `null` a valid `oldText`, so those stay out of the
// lists they would pass through. Explicit `undefined` is never picked from a
// list (the property's `pick` guard cannot tell it from an empty domain); it
// has its own corruption arm instead.
const INVALID_VALUES: Record<string, readonly unknown[]> = {
  taskId: ['', 'a/b', null, 1, true],
  mergeId: ['', 'a/b', null, 1, true],
  sessionId: ['', null, 1],
  role: ['', 'a · b', 'a: b', 'a\nb', null, 1],
  agent: ['', 'a · b', 'a: b', 'a\nb', null, 1],
  detail: ['', null, 1, true, ['x'], { detail: 'x' }],
  path: ['', null, 1],
  oldText: [1, true, {}],
  newText: [null, 1],
  report: [null, 1, {}],
  title: ['', null, 1],
  optionId: ['', null, 1],
  name: [null, 1],
  kind: ['', 'unknown', null, 1],
  mode: [null, 1, {}],
  backend: [null, 1, {}],
}

function invalidValues(key: string): readonly unknown[] {
  return INVALID_VALUES[key] ?? [null, 1]
}

function hostileCollection(field: string): readonly unknown[] {
  if (field === 'options')
    return [
      null,
      'x',
      {},
      [],
      [{ optionId: '', name: 'Yes', kind: 'allow_once' }],
      [{ optionId: 'yes', name: 'Yes', kind: 'unknown' }],
      withHole(OPTIONS, 0),
      [OPTIONS[0], null],
    ]
  return [
    null,
    'x',
    {},
    [null],
    [{ type: 'diff', path: '', oldText: 'a', newText: 'b' }],
    [SDK_TOOL_CONTENT['terminal']],
    [DIFF, null],
    withHole([DIFF], 0),
  ]
}

function deepFreeze(value: unknown): void {
  if (Array.isArray(value)) {
    Object.freeze(value)
    for (const entry of value) deepFreeze(entry)
  } else if (typeof value === 'object' && value !== null) {
    Object.freeze(value)
    for (const entry of Object.values(value)) deepFreeze(entry)
  }
}

function withSameGetter(
  copy: Record<string, unknown> | unknown[],
  slot: string | number,
  value: unknown,
): Record<string, unknown> | unknown[] {
  Object.defineProperty(copy, slot, {
    get: () => value,
    enumerable: true,
    configurable: true,
  })
  return copy
}

function frozenCopy(
  copy: Record<string, unknown> | unknown[],
): Record<string, unknown> | unknown[] {
  deepFreeze(copy)
  return copy
}

function withSymbolExtra(
  copy: Record<string, unknown> | unknown[],
): Record<string, unknown> | unknown[] {
  Object.defineProperty(copy, Symbol('s'), {
    value: 1,
    enumerable: true,
    configurable: true,
  })
  return copy
}

// The standard merge-permission fixture the two merge describes share. The
// Bypass call takes only the merge fields: the entry parse is strict, so the
// request's `sessionId`/`options` never ride along there. Builders only read
// these fixtures, never write them.
const MERGE_REQUEST_INPUT = {
  sessionId: 's1',
  mergeId: 'm1',
  role: 'merger',
  agent: 'zed',
  detail: 'Land t1',
  diffs: [DIFF],
  options: OPTIONS,
}
const MERGE_BYPASS_INPUT = {
  mergeId: 'm1',
  role: 'merger',
  agent: 'zed',
  detail: 'Land t1',
  diffs: [DIFF],
}

describe('M96b team tool call ids', () => {
  it('namespaces tasks and merges under team/', () => {
    expect(teamTaskToolCallId('t1')).toBe('team/task/t1')
    expect(teamMergeToolCallId('m1')).toBe('team/merge/m1')
    expect(isTeamToolCallId('team/task/t1')).toBe(true)
    expect(isTeamToolCallId('team/merge/m1')).toBe(true)
    expect(isTeamToolCallId('other/t1')).toBe(false)
    expect(TEAM_TOOL_CALL_PREFIX).toBe('team/')
  })
  it('refuses ids that would fake a hierarchy', () => {
    for (const bad of ['', 'a/b']) {
      expect(() => teamTaskToolCallId(bad)).toThrow()
      expect(() => teamMergeToolCallId(bad)).toThrow()
    }
  })
})

describe('M96b permission titles', () => {
  it('starts with the role and the agent', () => {
    const title = formatTeamPermissionTitle({
      role: 'researcher',
      agent: 'zed',
      detail: 'Read src',
    })
    expect(title).toBe('researcher · zed: Read src')
    expect(parseTeamPermissionTitle(title)).toEqual({
      role: 'researcher',
      agent: 'zed',
      detail: 'Read src',
    })
  })
  it('round-trips a detail holding colons', () => {
    const title = formatTeamPermissionTitle({ role: 'r', agent: 'a', detail: 'a: b: c' })
    expect(parseTeamPermissionTitle(title)?.detail).toBe('a: b: c')
  })
  it('rejects what it did not build', () => {
    expect(parseTeamPermissionTitle('hello')).toBe(undefined)
    expect(parseTeamPermissionTitle('researcher · zed')).toBe(undefined)
    expect(parseTeamPermissionTitle('a · b · c: d')).toBe(undefined)
    expect(() => formatTeamPermissionTitle({ role: '', agent: 'a', detail: 'd' })).toThrow()
    expect(() => formatTeamPermissionTitle({ role: 'a · b', agent: 'a', detail: 'd' })).toThrow()
    expect(() => formatTeamPermissionTitle({ role: 'a', agent: 'a', detail: '' })).toThrow()
  })
  // RVCM96B0 finding 3: every delimiter the parser uses is refused in role
  // and agent, so a built title always parses back to exactly one triple.
  it('rejects every parser delimiter in role and agent', () => {
    const delimiters = ['·', ' · ', ': ', '\n', '\r', '\u{2028}', '\u{2029}']
    for (const delimiter of delimiters) {
      expect(() =>
        formatTeamPermissionTitle({ role: `a${delimiter}b`, agent: 'c', detail: 'd' }),
      ).toThrow()
      expect(() =>
        formatTeamPermissionTitle({ role: 'a', agent: `c${delimiter}d`, detail: 'e' }),
      ).toThrow()
    }
  })
  it('parses no title the builder refuses to make', () => {
    expect(parseTeamPermissionTitle('a: b · c: d')).toBe(undefined)
    expect(parseTeamPermissionTitle('a\rb · c: d')).toBe(undefined)
    expect(parseTeamPermissionTitle('a\u{2028}b · c: d')).toBe(undefined)
  })
})

describe('M96b task tool calls', () => {
  it('announces a running task without content', () => {
    const call = teamTaskToolCall({ taskId: 't1', role: 'coder', agent: 'zed', detail: 'Write x' })
    expect(call).toMatchObject({
      toolCallId: 'team/task/t1',
      title: 'coder · zed: Write x',
      kind: TEAM_TASK_TOOL_KIND,
      status: 'in_progress',
    })
    expect(teamTaskUpdateSchema.safeParse(call).success).toBe(true)
  })
  it('carries the report as text content on completion', () => {
    const update = teamTaskReportUpdate({ taskId: 't1', report: 'done' })
    expect(update).toMatchObject({ toolCallId: 'team/task/t1', status: 'completed' })
    expect(teamToolContentSchema.safeParse(teamReportContent('done')).success).toBe(true)
    expect(teamTaskUpdateSchema.safeParse(update).success).toBe(true)
  })
  it('carries diffs as diff content while running', () => {
    const update = teamTaskDiffUpdate({ taskId: 't1', diffs: [DIFF] })
    expect(update).toMatchObject({ toolCallId: 'team/task/t1', status: 'in_progress' })
    expect(teamTaskUpdateSchema.safeParse(update).success).toBe(true)
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: [] })).toThrow()
  })
  // RVCM96B0 finding 2: ACP updates replace content, so the normal
  // announce → diff → report sequence keeps the shown diffs on the final
  // completed call instead of losing them.
  it('keeps the displayed diffs on the completed call', () => {
    teamTaskToolCall({ taskId: 't1', role: 'coder', agent: 'zed', detail: 'Write x' })
    const diffUpdate = teamTaskDiffUpdate({ taskId: 't1', diffs: [DIFF] })
    const shown: ToolCallContent[] = [...(diffUpdate.content ?? [])]
    const completed = teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: shown })
    expect(completed.content?.map((entry) => entry.type)).toEqual(['content', 'diff'])
    expect(teamTaskUpdateSchema.safeParse(completed).success).toBe(true)
  })
  it('normalises Windows separators before comparing paths', () => {
    expect(normalizeTeamPath(String.raw`C:\repo\a.ts`)).toBe('C:/repo/a.ts')
    expect(normalizeTeamPath('/repo/a.ts')).toBe('/repo/a.ts')
    expect(teamDiff({ path: String.raw`C:\repo\a.ts`, oldText: null, newText: 'b' })).toMatchObject(
      {
        type: 'diff',
        path: 'C:/repo/a.ts',
        oldText: null,
      },
    )
    expect(() => teamDiff({ path: '', oldText: null, newText: 'b' })).toThrow()
  })
  it('validates the frozen diff shape and rejects the rest', () => {
    expect(
      teamDiffSchema.safeParse({ type: 'diff', path: '/a', oldText: null, newText: 'b' }).success,
    ).toBe(true)
    expect(teamDiffSchema.safeParse({ type: 'diff', path: '/a', newText: 'b' }).success).toBe(true)
    expect(teamDiffSchema.safeParse({ type: 'diff', path: '/a' }).success).toBe(false)
    expect(teamDiffSchema.safeParse({ type: 'content', content: 'x' }).success).toBe(false)
  })
})

describe('M96b agent-map plan', () => {
  it('sends one entry per running task, traced by its id', () => {
    const entries = teamPlanEntries([
      { taskId: 't1', title: 'First' },
      { taskId: 't2', title: 'Second' },
    ])
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      content: 'First',
      priority: TEAM_PLAN_PRIORITY,
      status: 'in_progress',
    })
    expect(entries.map((entry) => entry._meta)).toEqual([{ teamTask: 't1' }, { teamTask: 't2' }])
    expect(z.array(teamPlanEntrySchema).safeParse(entries).success).toBe(true)
    expect(teamPlanEntries([])).toEqual([])
    expect(teamPlanEntrySchema.safeParse({ content: '', priority: 'medium' }).success).toBe(false)
  })

  it('refuses holes anywhere in the complete returned plan collection', () => {
    const tasks: TeamPlanTask[] = [
      { taskId: 't1', title: 'First' },
      { taskId: 't2', title: 'Second' },
      { taskId: 't3', title: 'Third' },
    ]
    for (const sparse of [
      withHole(tasks.slice(0, 1), 0),
      ...tasks.map((_task, index) => withHole(tasks, index)),
    ])
      expect(() => teamPlanEntries(sparse)).toThrow(TeamContractError)
    const entries = teamPlanEntries(tasks)
    expect(entries).toHaveLength(tasks.length)
    expect(entries.map((entry) => entry._meta?.['teamTask'])).toEqual(['t1', 't2', 't3'])
    expect(z.array(teamPlanEntrySchema).safeParse(entries).success).toBe(true)
  })

  // RVCM96B0F: the entry parse reads arrays by index, so an overridden
  // `map` is never dispatched: the plan builds from the indexed entries.
  it('ignores an overridden array map on the plan collection', () => {
    const tasks: TeamPlanTask[] = [{ taskId: 't1', title: 'First' }]
    // A caller can override map without a cast; the parse never calls it.
    tasks.map = () => []
    expect(teamPlanEntries(tasks)).toHaveLength(1)
    expect(teamPlanEntries(tasks)[0]?._meta).toEqual({ teamTask: 't1' })
    const benign: TeamPlanTask[] = [{ taskId: 't1', title: 'First' }]
    Object.defineProperty(benign, 'note', { value: 'extra', enumerable: true })
    expect(teamPlanEntries(benign)).toHaveLength(1)
  })
})

describe('M96b merge permission request', () => {
  const input = MERGE_REQUEST_INPUT
  const bypass = MERGE_BYPASS_INPUT
  it('freezes the request shape the editor is asked', () => {
    expect(teamMergeRequest(input)).toEqual({
      sessionId: 's1',
      toolCall: {
        toolCallId: 'team/merge/m1',
        title: 'merger · zed: Land t1',
        kind: TEAM_TASK_TOOL_KIND,
        status: 'pending',
        content: [DIFF],
      },
      options: OPTIONS,
    })
    expect(teamMergeRequestSchema.safeParse(teamMergeRequest(input)).success).toBe(true)
  })
  it('refuses a merge with no diff, no options or no session', () => {
    expect(() => teamMergeRequest({ ...input, diffs: [] })).toThrow()
    expect(() => teamMergeRequest({ ...input, options: [] })).toThrow()
    expect(() => teamMergeRequest({ ...input, sessionId: '' })).toThrow()
    expect(
      teamMergeRequestSchema.safeParse({ sessionId: 's', toolCall: {}, options: [] }).success,
    ).toBe(false)
  })
  // RVCM96B0 finding 1: a merge permission carries at least one real diff —
  // never a text-only content list — in the Bypass completed call too.
  it('refuses a merge that shows no real diff', () => {
    const textOnly = [teamReportContent('Merge now')]
    expect(() => teamMergeRequest({ ...input, diffs: textOnly })).toThrow()
    expect(() => teamMergeCompletedCall({ ...bypass, diffs: textOnly })).toThrow()
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: textOnly })).toThrow()
    const mixed = [teamReportContent('note'), DIFF]
    expect(teamMergeRequest({ ...input, diffs: mixed }).toolCall.content).toEqual(mixed)
    expect(
      teamMergeRequestSchema.safeParse(teamMergeRequest({ ...input, diffs: mixed })).success,
    ).toBe(true)
  })
  it('refuses a merge schema with text-only content', () => {
    const request = teamMergeRequest(input)
    expect(
      teamMergeRequestSchema.safeParse({
        ...request,
        toolCall: { ...request.toolCall, content: [teamReportContent('Merge now')] },
      }).success,
    ).toBe(false)
  })
  // RVCM96B0 finding 4: the frozen option kinds are exactly the SDK's own
  // `PermissionOptionKind` — every valid kind passes, anything else fails.
  it('accepts only the SDK option kinds', () => {
    const request = teamMergeRequest(input)
    expect(TEAM_PERMISSION_OPTION_KINDS).toEqual(SDK_OPTION_KINDS)
    for (const kind of SDK_OPTION_KINDS) {
      const options: PermissionOption[] = [atRuntime({ optionId: 'yes', name: 'Yes', kind })]
      expect(
        teamMergeRequestSchema.safeParse({
          ...request,
          options,
        }).success,
      ).toBe(true)
      expect(teamMergeRequest({ ...input, options }).options).toEqual(options)
    }
    const invalidKinds = [
      '',
      'approved',
      ...SDK_OPTION_KINDS.flatMap((kind) => [kind.toUpperCase(), `${kind} `, `_${kind}`]),
    ].filter((kind) => !SDK_OPTION_KINDS.includes(kind))
    for (const kind of invalidKinds) {
      expect(
        teamMergeRequestSchema.safeParse({
          ...request,
          options: [{ optionId: 'yes', name: 'Yes', kind }],
        }).success,
      ).toBe(false)
      const smuggled: PermissionOption = atRuntime({ optionId: 'yes', name: 'Yes', kind })
      expect(() => teamMergeRequest({ ...input, options: [smuggled] })).toThrow(TeamContractError)
    }
  })
  it('shows the merge as one completed call where asking is off', () => {
    const call = teamMergeCompletedCall({ ...bypass })
    expect(call).toMatchObject({
      toolCallId: 'team/merge/m1',
      title: 'merger · zed: Land t1',
      status: 'completed',
    })
    expect(teamTaskUpdateSchema.safeParse(call).success).toBe(true)
  })
})

describe('RVCM96B0B builder/schema consistency', () => {
  const input = MERGE_REQUEST_INPUT
  const bypass = MERGE_BYPASS_INPUT

  function refusesContent(diffs: readonly ToolCallContent[]): void {
    expect(() => teamMergeRequest({ ...input, diffs })).toThrow(TeamContractError)
    expect(() => teamMergeCompletedCall({ ...bypass, diffs })).toThrow(TeamContractError)
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs })).toThrow(TeamContractError)
    expect(() => teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs })).toThrow(
      TeamContractError,
    )
  }

  it('refuses empty-path diffs in every content builder', () => {
    refusesContent([{ type: 'diff', path: '', oldText: 'a', newText: 'b' }])
  })

  it('refuses holes in every content and permission-option collection', () => {
    const diffs = [DIFF, DIFF, DIFF]
    for (const sparse of [
      withHole([DIFF], 0),
      ...diffs.map((_diff, index) => withHole(diffs, index)),
    ])
      refusesContent(sparse)
    const options = [...OPTIONS, ...OPTIONS, ...OPTIONS]
    for (const sparse of [
      withHole(OPTIONS, 0),
      ...options.map((_option, index) => withHole(options, index)),
    ])
      expect(() => teamMergeRequest({ ...input, options: sparse })).toThrow(TeamContractError)
  })

  it('accepts only frozen content kinds from the SDK schema', () => {
    // Enumerate SDK variants independently: a new SDK kind needs a fixture and review.
    const content = sdkSchema.$defs.ToolCallContent.oneOf.map((variant) => {
      const sample = SDK_TOOL_CONTENT[variant.properties.type.const]
      if (sample === undefined) throw new Error('Missing SDK tool content fixture')
      return sample
    })
    for (const variant of sdkSchema.$defs.ContentBlock.oneOf) {
      const sample = SDK_CONTENT_BLOCKS[variant.properties.type.const]
      if (sample === undefined) throw new Error('Missing SDK content block fixture')
      content.push({ type: 'content', content: sample })
    }
    for (const sample of content) {
      const isAccepted =
        sample.type === 'diff' || (sample.type === 'content' && sample.content.type === 'text')
      expect(teamToolContentSchema.safeParse(sample).success).toBe(isAccepted)
      const diffs = [DIFF, sample]
      if (isAccepted) {
        expect(teamMergeRequest({ ...input, diffs }).toolCall.content).toEqual(diffs)
        expect(teamMergeCompletedCall({ ...bypass, diffs }).content).toEqual(diffs)
        expect(teamTaskDiffUpdate({ taskId: 't1', diffs }).content).toEqual(diffs)
        expect(teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs }).content).toEqual([
          teamReportContent('done'),
          ...diffs,
        ])
      } else refusesContent(diffs)
    }
    for (const kind of [
      '',
      ...sdkSchema.$defs.ToolCallContent.oneOf.map(
        (variant) => `${variant.properties.type.const}_unknown`,
      ),
    ])
      refusesContent([DIFF, atRuntime({ type: kind })])
    for (const variant of sdkSchema.$defs.ContentBlock.oneOf)
      refusesContent([
        DIFF,
        atRuntime({
          type: 'content',
          content: { type: `${variant.properties.type.const}_unknown` },
        }),
      ])
  })

  it('validates sibling diff, report, option and plan fields', () => {
    expect(() => teamDiff(atRuntime({ path: '/a', oldText: 1, newText: 'b' }))).toThrow(
      TeamContractError,
    )
    expect(() => teamDiff(atRuntime({ path: '/a', oldText: null, newText: null }))).toThrow(
      TeamContractError,
    )
    expect(() => teamReportContent(atRuntime(null))).toThrow(TeamContractError)
    expect(() => teamPlanEntries([{ taskId: 't1', title: '' }])).toThrow(TeamContractError)
    for (const option of [
      { optionId: '', name: 'Yes', kind: 'allow_once' },
      { optionId: 'yes', name: null, kind: 'allow_once' },
    ])
      expect(() => teamMergeRequest({ ...input, options: [atRuntime(option)] })).toThrow(
        TeamContractError,
      )
  })

  it('preserves unknown fields through validated output', () => {
    const diff = { type: 'diff', path: '/a', newText: 'b', future: { version: 1 } }
    const option = { ...OPTIONS[0], future: { version: 1 } }
    const request = teamMergeRequest({
      ...input,
      diffs: [atRuntime(diff)],
      options: [atRuntime(option)],
    })
    expect(request.toolCall.content).toEqual([diff])
    expect(request.options).toEqual([option])
    expect(teamMergeRequestSchema.safeParse(request).success).toBe(true)
  })

  // RVCM96B0F: one strict parse per builder. Random hostile inputs come in
  // two classes. Corruptions (nulls, missing required fields, non-strings,
  // unknown keys, holes, wrong-typed elements, exotic extras, throwing
  // getters) must ALWAYS throw `TeamContractError` — never another error
  // type, never an acceptance. Transparent wrappings (proxies, hostile
  // iterators, own-property shadows, same-value getters, frozen inputs,
  // symbol extras) must build output EQUAL to the clean-input build, or throw
  // the same typed error — never a partial result. `teamReportContent` takes
  // a primitive, so its hostile scalars stay in the deterministic sweep
  // above; every object-input builder is swept here.
  it('random hostile inputs either match the clean build or throw the typed error', () => {
    let seed = 96_003
    function pick<T>(values: readonly T[]): T {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      const chosen = values[Math.floor((seed / 4_294_967_296) * values.length)]
      if (chosen === undefined) throw new Error('Empty random input domain')
      return chosen
    }

    interface HostileBuilder {
      readonly name: string
      readonly schema?: z.ZodMiniType
      readonly scalarKeys: readonly string[]
      readonly requiredKeys: readonly string[]
      readonly collectionKeys: readonly string[]
      readonly cleanInput: () => Record<string, unknown> | unknown[]
      readonly run: (input: Record<string, unknown> | unknown[]) => unknown
    }

    const builders: readonly HostileBuilder[] = [
      {
        name: 'title',
        scalarKeys: ['role', 'agent', 'detail'],
        requiredKeys: ['role', 'agent', 'detail'],
        collectionKeys: [],
        cleanInput: () => ({ role: 'coder', agent: 'zed', detail: 'Write x' }),
        run: (input) => formatTeamPermissionTitle(atRuntime(input)),
      },
      {
        name: 'diff',
        schema: teamDiffSchema,
        scalarKeys: ['path', 'oldText', 'newText'],
        requiredKeys: ['path', 'newText'],
        collectionKeys: [],
        cleanInput: () => ({ path: '/a', oldText: null, newText: 'b' }),
        run: (input) => teamDiff(atRuntime(input)),
      },
      {
        name: 'announcement',
        schema: teamTaskUpdateSchema,
        scalarKeys: ['taskId', 'role', 'agent', 'detail'],
        requiredKeys: ['taskId', 'role', 'agent', 'detail'],
        collectionKeys: [],
        cleanInput: () => ({ taskId: 't1', role: 'coder', agent: 'zed', detail: 'Write x' }),
        run: (input) => teamTaskToolCall(atRuntime(input)),
      },
      {
        name: 'completion',
        schema: teamTaskUpdateSchema,
        scalarKeys: ['taskId', 'report'],
        requiredKeys: ['taskId', 'report'],
        collectionKeys: ['diffs'],
        cleanInput: () => ({ taskId: 't1', report: 'done', diffs: [DIFF] }),
        run: (input) => teamTaskReportUpdate(atRuntime(input)),
      },
      {
        name: 'working',
        schema: teamTaskUpdateSchema,
        scalarKeys: ['taskId'],
        requiredKeys: ['taskId', 'diffs'],
        collectionKeys: ['diffs'],
        cleanInput: () => ({ taskId: 't1', diffs: [DIFF] }),
        run: (input) => teamTaskDiffUpdate(atRuntime(input)),
      },
      {
        name: 'merge',
        schema: teamMergeRequestSchema,
        scalarKeys: ['sessionId', 'mergeId', 'role', 'agent', 'detail'],
        requiredKeys: ['sessionId', 'mergeId', 'role', 'agent', 'detail', 'diffs', 'options'],
        collectionKeys: ['diffs', 'options'],
        cleanInput: () => ({
          sessionId: 's1',
          mergeId: 'm1',
          role: 'merger',
          agent: 'zed',
          detail: 'Land t1',
          diffs: [DIFF],
          options: OPTIONS,
        }),
        run: (input) => teamMergeRequest(atRuntime(input)),
      },
      {
        name: 'bypass',
        schema: teamTaskUpdateSchema,
        scalarKeys: ['mergeId', 'role', 'agent', 'detail'],
        requiredKeys: ['mergeId', 'role', 'agent', 'detail', 'diffs'],
        collectionKeys: ['diffs'],
        cleanInput: () => ({
          mergeId: 'm1',
          role: 'merger',
          agent: 'zed',
          detail: 'Land t1',
          diffs: [DIFF],
        }),
        run: (input) => teamMergeCompletedCall(atRuntime(input)),
      },
      {
        name: 'plan',
        schema: z.array(teamPlanEntrySchema).check(z.length(2)),
        scalarKeys: [],
        requiredKeys: [],
        collectionKeys: [],
        cleanInput: () => [
          { taskId: 't1', title: 'First' },
          { taskId: 't2', title: 'Second' },
        ],
        run: (input) => teamPlanEntries(atRuntime(input)),
      },
      {
        name: 'admission',
        scalarKeys: ['mode', 'backend'],
        requiredKeys: ['mode', 'backend'],
        collectionKeys: [],
        cleanInput: () => ({ mode: 'acceptEdits', backend: 'modelApi' }),
        run: (input) => teamExecAdmission(atRuntime(input)),
      },
    ]

    function corruptPlan(copy: unknown[]): unknown[] {
      const kinds: ('null' | 'hole' | 'scalar' | 'extra' | 'missing' | 'invalid' | 'throwing')[] = [
        'null',
        'hole',
        'scalar',
        'extra',
        'missing',
        'invalid',
        'throwing',
      ]
      const index = pick([0, 1])
      switch (pick(kinds)) {
        case 'null': {
          copy[index] = null
          return copy
        }
        case 'hole': {
          Reflect.deleteProperty(copy, index)
          return copy
        }
        case 'scalar': {
          copy[index] = 'x'
          return copy
        }
        case 'extra': {
          copy[index] = { taskId: 't1', title: 'First', smuggled: 1 }
          return copy
        }
        case 'missing': {
          copy[index] = pick([{ taskId: 't1' }, { title: 'First' }])
          return copy
        }
        case 'invalid': {
          copy[index] = pick([
            { taskId: '', title: 'First' },
            { taskId: 't1', title: '' },
            { taskId: 't1', title: null },
          ])
          return copy
        }
        case 'throwing': {
          Object.defineProperty(copy, index, {
            get(): never {
              throw new Error('hostile plan slot')
            },
            enumerable: true,
            configurable: true,
          })
          return copy
        }
      }
    }

    function corruptInput(
      def: HostileBuilder,
      clean: Record<string, unknown> | unknown[],
    ): Record<string, unknown> | unknown[] {
      if (Array.isArray(clean)) return corruptPlan([...clean])
      const kinds: (
        'scalar' | 'missing' | 'explicit-undefined' | 'extra' | 'collection' | 'throwing'
      )[] = ['scalar', 'missing', 'explicit-undefined', 'extra', 'collection', 'throwing']
      const copy = { ...clean }
      switch (pick(kinds)) {
        case 'scalar': {
          const key = pick(def.scalarKeys)
          copy[key] = pick(invalidValues(key))
          return copy
        }
        case 'missing': {
          const key = pick(def.requiredKeys)
          Reflect.deleteProperty(copy, key)
          return copy
        }
        case 'explicit-undefined': {
          const key = pick(def.requiredKeys)
          copy[key] = undefined
          return copy
        }
        case 'extra': {
          copy['smuggled'] = 1
          return copy
        }
        case 'collection': {
          if (def.collectionKeys.length === 0) {
            const key = pick(def.scalarKeys)
            copy[key] = pick(invalidValues(key))
            return copy
          }
          const field = pick(def.collectionKeys)
          copy[field] = pick(hostileCollection(field))
          return copy
        }
        case 'throwing': {
          const key = pick(def.requiredKeys)
          Object.defineProperty(copy, key, {
            get(): never {
              throw new Error(`hostile ${key}`)
            },
            enumerable: true,
            configurable: true,
          })
          return copy
        }
      }
    }

    function transparentInput(
      def: HostileBuilder,
      clean: Record<string, unknown> | unknown[],
    ): Record<string, unknown> | unknown[] {
      const copy = Array.isArray(clean) ? [...clean] : { ...clean }
      const hasCollections = !Array.isArray(clean) && def.collectionKeys.length > 0
      const kinds: ('proxy' | 'yields' | 'shadow' | 'getter' | 'frozen' | 'symbol')[] =
        hasCollections || Array.isArray(clean)
          ? ['proxy', 'yields', 'shadow', 'getter', 'frozen', 'symbol']
          : ['proxy', 'getter', 'frozen', 'symbol']
      switch (pick(kinds)) {
        case 'proxy': {
          return new Proxy(copy, {})
        }
        case 'yields': {
          if (Array.isArray(copy)) return withYields(copy, [])
          const field = pick(def.collectionKeys)
          const entries = copy[field]
          copy[field] = Array.isArray(entries) ? withYields(entries, []) : entries
          return copy
        }
        case 'shadow': {
          if (Array.isArray(copy)) {
            const [key, value] = pick(DATA_SHADOWS)
            return withDataShadow(copy, key, value)
          }
          const field = pick(def.collectionKeys)
          const entries = copy[field]
          const [key, value] = pick(DATA_SHADOWS)
          copy[field] = Array.isArray(entries) ? withDataShadow(entries, key, value) : entries
          return copy
        }
        case 'getter': {
          if (Array.isArray(copy)) {
            const index = pick([0, 1])
            return withSameGetter(copy, index, copy[index])
          }
          const key = pick(def.scalarKeys)
          return withSameGetter(copy, key, copy[key])
        }
        case 'frozen': {
          return frozenCopy(copy)
        }
        case 'symbol': {
          return withSymbolExtra(copy)
        }
      }
    }

    const refused = new Map<string, number>()
    const matched = new Map<string, number>()
    for (let attempt = 0; attempt < 200; attempt++) {
      for (const def of builders) {
        const clean = def.cleanInput()
        const cleanOutput = def.run(clean)
        if (def.schema !== undefined)
          expect(def.schema.safeParse(cleanOutput).success, `${def.name} clean`).toBe(true)

        let isCorruptThrew = false
        try {
          def.run(corruptInput(def, clean))
        } catch (error) {
          isCorruptThrew = true
          expect(error, `${def.name} corrupt ${String(attempt)}`).toBeInstanceOf(TeamContractError)
        }
        expect(isCorruptThrew, `${def.name} corrupt ${String(attempt)} must throw`).toBe(true)
        refused.set(def.name, (refused.get(def.name) ?? 0) + 1)

        let isTransparentThrew = false
        let output: unknown
        try {
          output = def.run(transparentInput(def, clean))
        } catch (error) {
          isTransparentThrew = true
          expect(error, `${def.name} transparent ${String(attempt)}`).toBeInstanceOf(
            TeamContractError,
          )
        }
        if (isTransparentThrew) {
          continue
        }

        expect(output, `${def.name} transparent ${String(attempt)}`).toEqual(cleanOutput)
        if (def.schema !== undefined)
          expect(
            def.schema.safeParse(output).success,
            `${def.name} transparent schema ${String(attempt)}`,
          ).toBe(true)
        matched.set(def.name, (matched.get(def.name) ?? 0) + 1)
      }
    }
    for (const def of builders) {
      expect(matched.get(def.name) ?? 0, def.name).toBeGreaterThan(0)
      expect(refused.get(def.name) ?? 0, def.name).toBeGreaterThan(0)
    }
  })
})

describe('RVCM96B0D hostile caller collections meet the entry parse', () => {
  const DIFF_B = teamDiff({ path: '/repo/b.ts', oldText: null, newText: 'c' })
  const DIFFS = [DIFF, DIFF_B]
  const TWO_OPTIONS: PermissionOption[] = [
    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
    { optionId: 'no', name: 'No', kind: 'reject_once' },
  ]
  const mergeInput = {
    sessionId: 's1',
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: DIFFS,
    options: TWO_OPTIONS,
  }
  const bypassInput = {
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: DIFFS,
  }

  it('builds every content call from indexed entries, not the caller iterator', () => {
    const empty = withYields(DIFFS, [])
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs: empty }).content).toEqual(DIFFS)
    const completed = teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: empty })
    expect(completed.content?.map((entry) => entry.type)).toEqual(['content', 'diff', 'diff'])
    expect(completed.content?.slice(1)).toEqual(DIFFS)
    expect(teamMergeRequest({ ...mergeInput, diffs: empty }).toolCall.content).toEqual(DIFFS)
    expect(teamMergeCompletedCall({ ...bypassInput, diffs: empty }).content).toEqual(DIFFS)
  })

  it('keeps every indexed entry when the caller iterator yields fewer, more or invalid items', () => {
    expect(
      teamTaskDiffUpdate({ taskId: 't1', diffs: withYields(DIFFS, DIFFS.slice(0, 1)) }).content,
    ).toEqual(DIFFS)
    const extra = withYields([DIFF], [...DIFFS, teamReportContent('smuggled')])
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs: extra }).content).toEqual([DIFF])
    const invalid = withYields([DIFF], [atRuntime({ type: 'diff', path: '', newText: 'x' })])
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs: invalid }).content).toEqual([DIFF])
  })

  it('keeps every permission option when the caller iterator yields fewer', () => {
    const request = teamMergeRequest({
      ...mergeInput,
      options: withYields(TWO_OPTIONS, TWO_OPTIONS.slice(0, 1)),
    })
    expect(request.options).toHaveLength(TWO_OPTIONS.length)
    expect(request.options).toEqual(TWO_OPTIONS)
  })

  it('returns the complete plan when the caller iterator yields nothing', () => {
    const tasks: TeamPlanTask[] = [
      { taskId: 't1', title: 'First' },
      { taskId: 't2', title: 'Second' },
    ]
    const entries = teamPlanEntries(withYields(tasks, []))
    expect(entries).toHaveLength(tasks.length)
    expect(entries.map((entry) => entry._meta?.['teamTask'])).toEqual(['t1', 't2'])
    expect(z.array(teamPlanEntrySchema).safeParse(entries).success).toBe(true)
  })

  it('reads a caller index getter once and builds from that value', () => {
    let indexReads = 0
    const diffs = [...DIFFS]
    Object.defineProperty(diffs, '0', {
      get() {
        indexReads++
        return DIFF
      },
      enumerable: true,
      configurable: true,
    })
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs }).content).toEqual(DIFFS)
    expect(indexReads).toBe(1)
  })

  it('uses the first-read value when a caller getter shifts between reads', () => {
    let reads = 0
    const diffs = [...DIFFS]
    Object.defineProperty(diffs, '1', {
      get(): ToolCallContent {
        reads++
        return reads === 1 ? DIFF_B : atRuntime({ type: 'diff', path: '', newText: 'x' })
      },
      enumerable: true,
      configurable: true,
    })
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs }).content).toEqual(DIFFS)
  })

  it('reads input-object getters through the entry parse', () => {
    let diffReads = 0
    const input = { taskId: 't1', diffs: DIFFS }
    Object.defineProperty(input, 'diffs', {
      get() {
        diffReads++
        return DIFFS
      },
      enumerable: true,
      configurable: true,
    })
    expect(teamTaskDiffUpdate(atRuntime(input)).content).toEqual(DIFFS)
    expect(diffReads).toBe(1)
    const callInput = { taskId: 't1', role: 'coder', agent: 'zed', detail: 'Write x' }
    Object.defineProperty(callInput, 'detail', {
      get() {
        return 'Write x'
      },
      enumerable: true,
      configurable: true,
    })
    expect(teamTaskToolCall(atRuntime(callInput)).title).toBe('coder · zed: Write x')
  })

  // RVCM96B0F: the entry parse reads through default traps, so a
  // transparent proxy builds exactly the clean output. A trap that throws
  // still fails closed with the typed error, never the trap's own value.
  it('reads transparent proxy collections to the clean output', () => {
    const proxied = new Proxy(DIFFS, {})
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs: proxied }).content).toEqual(DIFFS)
    expect(
      teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: proxied }).content?.slice(1),
    ).toEqual(DIFFS)
    expect(teamMergeRequest({ ...mergeInput, diffs: proxied }).toolCall.content).toEqual(DIFFS)
    expect(teamMergeCompletedCall({ ...bypassInput, diffs: proxied }).content).toEqual(DIFFS)
    expect(
      teamMergeRequest({ ...mergeInput, options: new Proxy(TWO_OPTIONS, {}) }).options,
    ).toEqual(TWO_OPTIONS)
    expect(teamPlanEntries(new Proxy([{ taskId: 't1', title: 'First' }], {}))).toHaveLength(1)
    expect(
      teamTaskToolCall(
        new Proxy({ taskId: 't1', role: 'coder', agent: 'zed', detail: 'Write x' }, {}),
      ).title,
    ).toBe('coder · zed: Write x')
  })

  it('refuses a throwing proxy trap with a typed error', () => {
    const throwing = new Proxy(DIFFS, {
      get() {
        throw new Error('trap blew up')
      },
    })
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: atRuntime(throwing) })).toThrow(
      TeamContractError,
    )
    expect(() => teamPlanEntries(atRuntime([throwing]))).toThrow(TeamContractError)
  })

  it('refuses function-valued entries with a typed error', () => {
    const smuggled: ToolCallContent = atRuntime({
      type: 'diff',
      path: '/a',
      newText: 'b',
      run: () => 1,
    })
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: [DIFF, smuggled] })).toThrow(
      TeamContractError,
    )
    expect(() => teamMergeRequest({ ...mergeInput, diffs: [DIFF, smuggled] })).toThrow(
      TeamContractError,
    )
  })
})

describe('RVCM96B0E array shadows use indexed entries', () => {
  const SECOND = teamDiff({ path: '/repo/b.ts', oldText: null, newText: 'c' })
  const CLEAN_DIFFS = [DIFF, SECOND]
  const CLEAN_OPTIONS: PermissionOption[] = [
    { optionId: 'yes', name: 'Yes', kind: 'allow_once' },
    { optionId: 'no', name: 'No', kind: 'reject_once' },
  ]
  const CLEAN_TASKS: TeamPlanTask[] = [
    { taskId: 't1', title: 'First' },
    { taskId: 't2', title: 'Second' },
  ]
  const CLEAN_MERGE = {
    sessionId: 's1',
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: CLEAN_DIFFS,
    options: CLEAN_OPTIONS,
  }
  const CLEAN_BYPASS = {
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: CLEAN_DIFFS,
  }

  it('builds content calls from indexed diffs despite own shadows', () => {
    const working = teamTaskDiffUpdate({ taskId: 't1', diffs: CLEAN_DIFFS })
    const completed = teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: CLEAN_DIFFS })
    const merge = teamMergeRequest(CLEAN_MERGE)
    const bypass = teamMergeCompletedCall(CLEAN_BYPASS)
    for (const diffs of shadowVariants(CLEAN_DIFFS)) {
      expectCleanOrTyped(() => teamTaskDiffUpdate({ taskId: 't1', diffs }), working)
      expectCleanOrTyped(
        () => teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs }),
        completed,
      )
      expectCleanOrTyped(() => teamMergeRequest({ ...CLEAN_MERGE, diffs }), merge)
      expectCleanOrTyped(() => teamMergeCompletedCall({ ...CLEAN_BYPASS, diffs }), bypass)
    }
  })

  // Function-valued shadows cannot be pre-cloned (the clone itself refuses
  // functions), so they are swept direct-only: the parse never dispatches
  // through them, and the build matches the clean output.
  it('ignores function-valued array shadows', () => {
    const working = teamTaskDiffUpdate({ taskId: 't1', diffs: CLEAN_DIFFS })
    const merge = teamMergeRequest(CLEAN_MERGE)
    const plan = teamPlanEntries(CLEAN_TASKS)
    for (const key of ['map', 'filter', 'constructor']) {
      const diffs = withDataShadow(CLEAN_DIFFS, key, () => [])
      expectCleanOrTyped(() => teamTaskDiffUpdate({ taskId: 't1', diffs }), working)
      expectCleanOrTyped(() => teamMergeRequest({ ...CLEAN_MERGE, diffs }), merge)
      const options = withDataShadow(CLEAN_OPTIONS, key, () => [])
      expectCleanOrTyped(() => teamMergeRequest({ ...CLEAN_MERGE, options }), merge)
      const tasks = withDataShadow(CLEAN_TASKS, key, () => [])
      expectCleanOrTyped(() => teamPlanEntries(tasks), plan)
    }
    const direct: TeamPlanTask[] = [{ taskId: 't1', title: 'First' }]
    direct.map = () => []
    expect(teamPlanEntries(direct)).toHaveLength(1)
  })

  it('builds merge requests from indexed options despite own shadows', () => {
    const merge = teamMergeRequest(CLEAN_MERGE)
    for (const options of shadowVariants(CLEAN_OPTIONS))
      expectCleanOrTyped(() => teamMergeRequest({ ...CLEAN_MERGE, options }), merge)
  })

  it('builds the complete plan from indexed tasks despite own shadows', () => {
    const plan = teamPlanEntries(CLEAN_TASKS)
    for (const tasks of shadowVariants(CLEAN_TASKS))
      expectCleanOrTyped(() => teamPlanEntries(tasks), plan)
  })
})

describe('RVCM96B0F strict entry parse', () => {
  // Every public builder parses its input once with a strict object schema:
  // an unknown key fails rather than riding along into the build.
  it('refuses unknown input keys on every builder', () => {
    const cases: { readonly name: string; readonly run: () => unknown }[] = [
      {
        name: 'title',
        run: () =>
          formatTeamPermissionTitle(atRuntime({ role: 'r', agent: 'a', detail: 'd', smuggled: 1 })),
      },
      {
        name: 'diff',
        run: () => teamDiff(atRuntime({ path: '/a', oldText: null, newText: 'b', smuggled: 1 })),
      },
      {
        name: 'announcement',
        run: () =>
          teamTaskToolCall(
            atRuntime({ taskId: 't1', role: 'c', agent: 'z', detail: 'd', smuggled: 1 }),
          ),
      },
      {
        name: 'completion',
        run: () => teamTaskReportUpdate(atRuntime({ taskId: 't1', report: 'done', smuggled: 1 })),
      },
      {
        name: 'working',
        run: () => teamTaskDiffUpdate(atRuntime({ taskId: 't1', diffs: [DIFF], smuggled: 1 })),
      },
      {
        name: 'plan',
        run: () => teamPlanEntries(atRuntime([{ taskId: 't1', title: 'First', smuggled: 1 }])),
      },
      {
        name: 'merge',
        run: () =>
          teamMergeRequest(
            atRuntime({
              sessionId: 's1',
              mergeId: 'm1',
              role: 'm',
              agent: 'z',
              detail: 'd',
              diffs: [DIFF],
              options: OPTIONS,
              smuggled: 1,
            }),
          ),
      },
      {
        name: 'bypass',
        run: () =>
          teamMergeCompletedCall(
            atRuntime({
              mergeId: 'm1',
              role: 'm',
              agent: 'z',
              detail: 'd',
              diffs: [DIFF],
              smuggled: 1,
            }),
          ),
      },
      {
        name: 'admission',
        run: () =>
          teamExecAdmission(atRuntime({ mode: 'acceptEdits', backend: 'modelApi', smuggled: 1 })),
      },
    ]
    for (const { name, run } of cases) expect(run, name).toThrow(TeamContractError)
  })

  // RVCM96B0F finding 1: a missing or non-string detail used to stringify
  // into the title (`{detail}`, `null`, `[object Object]`). The entry parse
  // requires a non-empty string before `fill` ever runs, on every builder
  // that formats a title, and names the rejected path.
  it('refuses a missing or non-string title detail with a typed error', () => {
    const badDetails: readonly unknown[] = [null, undefined, 1, true, ['x'], { detail: 'x' }]
    for (const detail of badDetails) {
      const titleInput: object = { role: 'coder', agent: 'zed', detail }
      expect(() => formatTeamPermissionTitle(atRuntime(titleInput))).toThrow(TeamContractError)
      const callInput: object = { taskId: 't1', role: 'coder', agent: 'zed', detail }
      expect(() => teamTaskToolCall(atRuntime(callInput))).toThrow(TeamContractError)
    }
    expect(() => formatTeamPermissionTitle(atRuntime({ role: 'coder', agent: 'zed' }))).toThrow(
      /detail/,
    )
    expect(() =>
      teamTaskToolCall(atRuntime({ taskId: 't1', role: 'coder', agent: 'zed', detail: null })),
    ).toThrow(/detail/)
    expect(() =>
      teamTaskToolCall(atRuntime({ taskId: 't1', role: 'coder', agent: 'zed', detail: '' })),
    ).toThrow(/detail/)
    expect(() =>
      teamMergeRequest(
        atRuntime({
          sessionId: 's1',
          mergeId: 'm1',
          role: 'merger',
          agent: 'zed',
          detail: null,
          diffs: [DIFF],
          options: OPTIONS,
        }),
      ),
    ).toThrow(TeamContractError)
    expect(() =>
      teamMergeCompletedCall(
        atRuntime({ mergeId: 'm1', role: 'merger', agent: 'zed', detail: 1, diffs: [DIFF] }),
      ),
    ).toThrow(TeamContractError)
  })

  // RVCM96B0F finding 2: a `null` plan entry used to escape as a raw
  // `TypeError` reading `.title`. The entry parse validates each indexed
  // entry against the strict task schema before the build touches it.
  it('refuses a null plan entry with a typed error', () => {
    const valid = { taskId: 't1', title: 'First' }
    expect(() => teamPlanEntries(atRuntime([null]))).toThrow(/at 0/)
    expect(() => teamPlanEntries(atRuntime([valid, null]))).toThrow(/at 1/)
    const nullGetter: unknown[] = [{ ...valid }]
    Object.defineProperty(nullGetter, '0', {
      get: () => null,
      enumerable: true,
      configurable: true,
    })
    expect(() => teamPlanEntries(atRuntime(nullGetter))).toThrow(/at 0/)
    expect(() => teamPlanEntries(atRuntime([{ taskId: 't1', title: null }]))).toThrow(/title/)
    expect(() => teamPlanEntries(atRuntime([{}]))).toThrow(/taskId/)
  })

  // Exotic values are never wire fields: a function, symbol, bigint or
  // explicit `undefined` smuggled in a content or option extra fails closed,
  // while plain wire data still arrives (the D36 test below pins that side).
  it('refuses exotic values smuggled in content and option extras', () => {
    const exotic: readonly unknown[] = [() => 1, Symbol('s'), 1n, undefined]
    for (const value of exotic) {
      const diff: object = { ...DIFF, future: value }
      expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: atRuntime([diff]) })).toThrow(
        TeamContractError,
      )
      const option: object = { ...OPTIONS[0], future: value }
      expect(() =>
        teamMergeRequest(
          atRuntime({
            sessionId: 's1',
            mergeId: 'm1',
            role: 'm',
            agent: 'z',
            detail: 'd',
            diffs: [DIFF],
            options: [option],
          }),
        ),
      ).toThrow(TeamContractError)
    }
  })

  it('preserves plain wire extras in working-builder content', () => {
    const diff = { type: 'diff', path: '/a', newText: 'b', future: { version: 1 } }
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs: [atRuntime(diff)] }).content).toEqual([diff])
  })

  // The parse builds from its own fresh value and never writes the caller's
  // object: frozen inputs (frozen deep, in strict-mode modules where a write
  // would throw) build the clean output.
  it('builds from frozen inputs without mutating them', () => {
    expect(
      formatTeamPermissionTitle(atRuntime(Object.freeze({ role: 'r', agent: 'a', detail: 'd' }))),
    ).toBe('r · a: d')
    const diffs = Object.freeze([Object.freeze({ ...DIFF })])
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs: atRuntime(diffs) }).content).toEqual([
      { ...DIFF },
    ])
    const plan = Object.freeze([Object.freeze({ taskId: 't1', title: 'First' })])
    expect(teamPlanEntries(atRuntime(plan))).toHaveLength(1)
    expect(
      teamExecAdmission(atRuntime(Object.freeze({ mode: 'acceptEdits', backend: 'modelApi' }))),
    ).toEqual({ ok: true })
  })

  // Whatever a hostile getter or trap throws — an `Error` or a bare value —
  // the parse maps to the typed error; the raw value never escapes.
  it('maps a throwing input getter to the typed error', () => {
    const input: Record<string, unknown> = { taskId: 't1', role: 'coder', agent: 'zed' }
    Object.defineProperty(input, 'detail', {
      get(): never {
        // Thrown as `unknown` so the rule against throwing non-errors stays
        // quiet while the parse still meets a bare string at runtime.
        const unavailable: unknown = 'detail-unavailable'
        throw unavailable
      },
      enumerable: true,
      configurable: true,
    })
    expect(() => teamTaskToolCall(atRuntime(input))).toThrow(TeamContractError)
  })

  // Predicates and parsers stay total: hostile values get an honest answer,
  // never a raw `TypeError`.
  it('keeps predicates and id builders total on hostile values', () => {
    expect(isTeamToolCallId(atRuntime(null))).toBe(false)
    expect(isTeamToolCallId(atRuntime(1))).toBe(false)
    expect(isTeamToolCallId(atRuntime({}))).toBe(false)
    expect(isTeamToolCallId('team/task/t1')).toBe(true)
    expect(parseTeamPermissionTitle(atRuntime(null))).toBe(undefined)
    expect(parseTeamPermissionTitle(atRuntime(1))).toBe(undefined)
    expect(() => normalizeTeamPath(atRuntime(null))).toThrow(TeamContractError)
    expect(() => normalizeTeamPath(atRuntime(1))).toThrow(TeamContractError)
    expect(() => teamTaskToolCallId(atRuntime(''))).toThrow(TeamContractError)
    expect(() => teamTaskToolCallId(atRuntime('a/b'))).toThrow(TeamContractError)
    expect(() => teamTaskToolCallId(atRuntime(1))).toThrow(TeamContractError)
    expect(() => teamMergeToolCallId(atRuntime(null))).toThrow(TeamContractError)
  })
})

describe('RVCM96B0G JSON shapes and failure paths', () => {
  const contentBuilders = [
    (diffs: ToolCallContent[]) => teamTaskDiffUpdate({ taskId: 't1', diffs }).content,
    (diffs: ToolCallContent[]) =>
      teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs }).content?.slice(1),
    (diffs: ToolCallContent[]) =>
      teamMergeRequest({
        sessionId: 's1',
        mergeId: 'm1',
        role: 'merger',
        agent: 'zed',
        detail: 'Land t1',
        diffs,
        options: OPTIONS,
      }).toolCall.content,
    (diffs: ToolCallContent[]) =>
      teamMergeCompletedCall({
        mergeId: 'm1',
        role: 'merger',
        agent: 'zed',
        detail: 'Land t1',
        diffs,
      }).content,
  ]

  it('refuses non-JSON extras at every content layer on every consuming builder', () => {
    const exotic: readonly unknown[] = [() => 1, Symbol('s'), 1n, undefined, NaN]
    for (const build of contentBuilders) {
      for (const future of exotic) {
        for (const text of [
          { type: 'content', content: { type: 'text', text: 'report' }, future },
          { type: 'content', content: { type: 'text', text: 'report', future } },
          { ...DIFF, future },
        ]) {
          expect(() => build([DIFF, atRuntime(text)])).toThrow(TeamContractError)
        }
      }
    }
  })

  it('preserves and isolates plain JSON extras at every content layer', () => {
    for (const build of contentBuilders) {
      const outer = { version: 1 }
      const inner = { nested: [{ version: 1 }] }
      const diffExtra = { versions: [1, 2] }
      const content: ToolCallContent[] = [
        atRuntime({ ...DIFF, future: diffExtra }),
        atRuntime({
          type: 'content',
          content: { type: 'text', text: 'report', future: inner },
          future: outer,
        }),
      ]
      const expected = structuredClone(content)
      const output = build(content)
      outer.version = 2
      for (const item of inner.nested) item.version = 2
      diffExtra.versions.push(1)
      expect(output).toEqual(expected)
      expect(JSON.stringify(output)).toBe(JSON.stringify(expected))
    }
  })

  // Changing caller accessors are outside the lead's threat model. This pins
  // branch selection so a content parser never revisits the original diff.
  it('reads each nested diff getter once and keeps its first value', () => {
    for (const build of contentBuilders) {
      let reads = 0
      const diff = {
        type: 'diff',
        path: '/repo/a.ts',
        get newText() {
          reads++
          return reads === 1 ? 'approved' : 'unreviewed'
        },
      }
      expect(build([atRuntime(diff)])).toEqual([
        { type: 'diff', path: '/repo/a.ts', newText: 'approved' },
      ])
      expect(reads).toBe(1)
    }
  })

  it('wraps unreadable thrown objects as TeamContractError without inspecting them', () => {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    const thrownValues: readonly unknown[] = [
      revoked.proxy,
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('unreadable prototype')
          },
        },
      ),
    ]
    for (const thrown of thrownValues) {
      const input = {
        role: 'coder',
        agent: 'zed',
        get detail(): never {
          throw thrown
        },
      }
      expect(() => formatTeamPermissionTitle(atRuntime(input))).toThrow(TeamContractError)
    }
  })
})

describe('M96b exec --team admission', () => {
  it('needs the Model API backend and acceptEdits after exec budget validation', () => {
    expect(teamExecAdmission({ mode: 'acceptEdits', backend: 'museCode' })).toEqual({
      ok: false,
      reason: UI_TEXT.execModelApiOnly,
    })
    expect(teamExecAdmission({ mode: 'plan', backend: 'modelApi' })).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNeedsEdits,
    })
    expect(teamExecAdmission({ mode: 'acceptEdits', backend: 'modelApi' })).toEqual({ ok: true })
  })
})
