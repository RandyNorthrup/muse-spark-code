// M96b contracts (C-M96b-0, PLAN.md D75): the frozen ACP team mapping.
import type { ContentBlock, PermissionOption, ToolCallContent } from '@agentclientprotocol/sdk'
import sdkSchema from '@agentclientprotocol/sdk/schema/schema.json'
import { describe, expect, it, vi } from 'vitest'
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

/** Runs the builder while counting global `structuredClone` calls. */
function countClones<T>(build: () => T): { output: T; calls: number } {
  const real = globalThis.structuredClone
  let calls = 0
  vi.stubGlobal('structuredClone', (value: unknown): unknown => {
    calls += 1
    return real(value)
  })
  try {
    return { output: build(), calls }
  } finally {
    vi.unstubAllGlobals()
  }
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

  // RVCM96B0D: the entry snapshot cannot copy a function-valued own
  // property, so a caller `map` fails closed with a typed error instead of
  // shrinking the plan. Data-valued shadows are proved harmless by the
  // RVCM96B0E sweep below, which builds the clean output from them.
  it('refuses a plan collection with an overridden map', () => {
    const tasks: TeamPlanTask[] = [{ taskId: 't1', title: 'First' }]
    // A caller can override map without a cast; the snapshot refuses it.
    tasks.map = () => []
    expect(() => teamPlanEntries(tasks)).toThrow(TeamContractError)
    const benign: TeamPlanTask[] = [{ taskId: 't1', title: 'First' }]
    Object.defineProperty(benign, 'note', { value: 'extra', enumerable: true })
    expect(teamPlanEntries(benign)).toHaveLength(1)
  })
})

describe('M96b merge permission request', () => {
  const input = {
    sessionId: 's1',
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: [DIFF],
    options: OPTIONS,
  }
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
    expect(() => teamMergeCompletedCall({ ...input, diffs: textOnly })).toThrow()
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
    const call = teamMergeCompletedCall({ ...input })
    expect(call).toMatchObject({
      toolCallId: 'team/merge/m1',
      title: 'merger · zed: Land t1',
      status: 'completed',
    })
    expect(teamTaskUpdateSchema.safeParse(call).success).toBe(true)
  })
})

describe('RVCM96B0B builder/schema consistency', () => {
  const input = {
    sessionId: 's1',
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: [DIFF],
    options: OPTIONS,
  }

  function refusesContent(diffs: readonly ToolCallContent[]): void {
    expect(() => teamMergeRequest({ ...input, diffs })).toThrow(TeamContractError)
    expect(() => teamMergeCompletedCall({ ...input, diffs })).toThrow(TeamContractError)
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
        expect(teamMergeCompletedCall({ ...input, diffs }).content).toEqual(diffs)
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

  it('random builder inputs with sparse collections either throw typed errors or pass their frozen schemas', () => {
    let seed = 96_003
    function pick<T>(values: readonly T[]): T {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      const chosen = values[Math.floor((seed / 4_294_967_296) * values.length)]
      if (chosen === undefined) throw new Error('Empty random input domain')
      return chosen
    }
    const counts = new Map<string, { accepted: number; refused: number }>()
    for (let attempt = 0; attempt < 500; attempt++) {
      const candidate = {
        taskId: pick(['t1', 't2', '', 'a/b', 1, null]),
        mergeId: pick(['m1', 'm2', '', 'a/b', 1, null]),
        sessionId: pick(['s1', '', 1, null]),
        role: pick(['coder', 'merger', '', 'a: b', 'a\nb', null]),
        agent: pick(['zed', 'worker', '', 'a · b', 'a\u{2028}b', null]),
        detail: pick(['Write x', 'Merge', '', 'a: b\nc']),
        path: pick(['/a', String.raw`C:\repo\a.ts`, '', 1, null]),
        oldText: pick(['a', '', null, 1]),
        newText: pick(['b', '', null, 1]),
        report: pick(['done', '', null, 1]),
        title: pick(['First', '', null, 1]),
        diffs: pick([
          [DIFF],
          [DIFF, teamReportContent('note')],
          [],
          [{ type: 'diff', path: '', newText: 'b' }],
          [DIFF, SDK_TOOL_CONTENT['terminal']],
          [null],
          withHole([DIFF], 0),
          withHole([DIFF, DIFF, DIFF], pick([0, 1, 2])),
          null,
        ]),
        options: pick([
          ...SDK_OPTION_KINDS.map((kind) => [{ optionId: 'yes', name: 'Yes', kind }]),
          [{ optionId: '', name: 'Yes', kind: 'allow_once' }],
          [{ optionId: 'yes', name: 'Yes', kind: 'unknown' }],
          [],
          withHole(OPTIONS, 0),
          withHole([...OPTIONS, ...OPTIONS, ...OPTIONS], pick([0, 1, 2])),
          null,
        ]),
      }
      // Seed one valid input for every builder; the property cannot pass by refusing everything.
      if (attempt === 0)
        Object.assign(candidate, {
          ...input,
          taskId: 't1',
          path: '/a',
          oldText: null,
          newText: 'b',
          report: 'done',
          title: 'First',
        })
      const tasks =
        attempt === 0
          ? [candidate]
          : pick([
              [],
              [candidate],
              [candidate, { taskId: 't2', title: 'Second' }],
              withHole([candidate], 0),
              withHole([candidate, candidate, candidate], pick([0, 1, 2])),
            ])
      const builders: { name: string; schema: z.ZodMiniType; build: () => unknown }[] = [
        { name: 'diff', schema: teamDiffSchema, build: () => teamDiff(atRuntime(candidate)) },
        {
          name: 'report',
          schema: teamToolContentSchema,
          build: () => teamReportContent(atRuntime(candidate.report)),
        },
        {
          name: 'announcement',
          schema: teamTaskUpdateSchema,
          build: () => teamTaskToolCall(atRuntime(candidate)),
        },
        {
          name: 'completion',
          schema: teamTaskUpdateSchema,
          build: () => teamTaskReportUpdate(atRuntime(candidate)),
        },
        {
          name: 'working',
          schema: teamTaskUpdateSchema,
          build: () => teamTaskDiffUpdate(atRuntime(candidate)),
        },
        {
          name: 'merge',
          schema: teamMergeRequestSchema,
          build: () => teamMergeRequest(atRuntime(candidate)),
        },
        {
          name: 'bypass',
          schema: teamTaskUpdateSchema,
          build: () => teamMergeCompletedCall(atRuntime(candidate)),
        },
        {
          name: 'plan',
          schema: z.array(teamPlanEntrySchema).check(z.length(tasks.length)),
          build: () => teamPlanEntries(atRuntime(tasks)),
        },
      ]
      for (const builder of builders) {
        const count = counts.get(builder.name) ?? { accepted: 0, refused: 0 }
        counts.set(builder.name, count)
        let output: unknown
        try {
          output = builder.build()
        } catch (error) {
          expect(error, `${builder.name}: ${String(attempt)}`).toBeInstanceOf(TeamContractError)
          count.refused++
          continue
        }
        expect(
          builder.schema.safeParse(output).success,
          `${builder.name}: ${String(attempt)}`,
        ).toBe(true)
        count.accepted++
      }
    }
    for (const [name, count] of counts) {
      expect(count.accepted, name).toBeGreaterThan(0)
      expect(count.refused, name).toBeGreaterThan(0)
    }
  })
})

describe('RVCM96B0D hostile caller collections use the entry snapshot', () => {
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

  it('builds every content call from indexed entries, not the caller iterator', () => {
    const empty = withYields(DIFFS, [])
    expect(teamTaskDiffUpdate({ taskId: 't1', diffs: empty }).content).toEqual(DIFFS)
    const completed = teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: empty })
    expect(completed.content?.map((entry) => entry.type)).toEqual(['content', 'diff', 'diff'])
    expect(completed.content?.slice(1)).toEqual(DIFFS)
    expect(teamMergeRequest({ ...mergeInput, diffs: empty }).toolCall.content).toEqual(DIFFS)
    expect(teamMergeCompletedCall({ ...mergeInput, diffs: empty }).content).toEqual(DIFFS)
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

  it('reads input-object getters through the snapshot', () => {
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

  it('refuses proxy collections with a typed error instead of reading through traps', () => {
    const proxied = new Proxy(DIFFS, {})
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: proxied })).toThrow(TeamContractError)
    expect(() => teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: proxied })).toThrow(
      TeamContractError,
    )
    expect(() => teamMergeRequest({ ...mergeInput, diffs: proxied })).toThrow(TeamContractError)
    expect(() => teamMergeCompletedCall({ ...mergeInput, diffs: proxied })).toThrow(
      TeamContractError,
    )
    expect(() => teamMergeRequest({ ...mergeInput, options: new Proxy(TWO_OPTIONS, {}) })).toThrow(
      TeamContractError,
    )
    expect(() => teamPlanEntries(new Proxy([{ taskId: 't1', title: 'First' }], {}))).toThrow(
      TeamContractError,
    )
  })

  it('refuses uncloneable entries with a typed error', () => {
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
    const hostileDiffs = [...DIFFS]
    hostileDiffs.map = () => []
    expect(() => teamTaskDiffUpdate({ taskId: 't1', diffs: hostileDiffs })).toThrow(
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

  it('builds content calls from indexed diffs despite own shadows', () => {
    const working = teamTaskDiffUpdate({ taskId: 't1', diffs: CLEAN_DIFFS })
    const completed = teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs: CLEAN_DIFFS })
    const merge = teamMergeRequest(CLEAN_MERGE)
    const bypass = teamMergeCompletedCall(CLEAN_MERGE)
    for (const diffs of shadowVariants(CLEAN_DIFFS)) {
      expectCleanOrTyped(() => teamTaskDiffUpdate({ taskId: 't1', diffs }), working)
      expectCleanOrTyped(
        () => teamTaskReportUpdate({ taskId: 't1', report: 'done', diffs }),
        completed,
      )
      expectCleanOrTyped(() => teamMergeRequest({ ...CLEAN_MERGE, diffs }), merge)
      expectCleanOrTyped(() => teamMergeCompletedCall({ ...CLEAN_MERGE, diffs }), bypass)
    }
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

describe('RVCM96B0E one snapshot per public call', () => {
  const input = {
    sessionId: 's1',
    mergeId: 'm1',
    role: 'merger',
    agent: 'zed',
    detail: 'Land t1',
    diffs: [DIFF],
    options: OPTIONS,
  }

  it('snapshots the task announcement once', () => {
    const { output, calls } = countClones(() =>
      teamTaskToolCall({ taskId: 't1', role: 'coder', agent: 'zed', detail: 'Write x' }),
    )
    expect(calls).toBe(1)
    expect(output.title).toBe('coder · zed: Write x')
  })

  it('snapshots the merge request once', () => {
    const { output, calls } = countClones(() => teamMergeRequest(input))
    expect(calls).toBe(1)
    expect(output.toolCall.title).toBe('merger · zed: Land t1')
  })

  it('snapshots the Bypass merge call once', () => {
    const { output, calls } = countClones(() => teamMergeCompletedCall(input))
    expect(calls).toBe(1)
    expect(output.title).toBe('merger · zed: Land t1')
  })
})

describe('M96b exec --team admission', () => {
  it('needs the Model API backend, acceptEdits and the runner lane', () => {
    expect(teamExecAdmission({ mode: 'acceptEdits', backend: 'museCode' })).toEqual({
      ok: false,
      reason: UI_TEXT.execModelApiOnly,
    })
    expect(teamExecAdmission({ mode: 'plan', backend: 'modelApi' })).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNeedsEdits,
    })
    expect(teamExecAdmission({ mode: 'acceptEdits', backend: 'modelApi' })).toEqual({
      ok: false,
      reason: UI_TEXT.execTeamNotReady,
    })
  })
})
