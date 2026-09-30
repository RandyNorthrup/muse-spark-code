// The verify loop on the Model API backend (M68, PLAN.md D49), over the
// fake Model API: a fixture whose check fails, the diagnostics and check
// results in the next request, the bounded fix loop, the shell permission
// path per mode, run_checks, then_run with its guard, and format on edit.

import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
import {
  CHECK_FIX_MAX_ROUNDS,
  type CheckCommandSetting,
  MODEL_API_MAX_TOOL_ROUNDS,
  MODEL_TEXT,
  SHELL_DEFAULT_TIMEOUT_MS,
  UI_TEXT,
  VERIFY_NOTE_MAX_CHARS,
} from '../../src/shared/constants'
import { fill, plural } from '../../src/shared/l10n/text'
import { type HookDefinition, parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { ModelApiHost, type ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import type { ShellResult, ToolIo } from '../../src/core/backends/modelapi/tools'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import type { DiagnosticEntry } from '../../src/core/diagnostics'
import type { MemoryStore } from '../../src/core/memory/memoryStore'
import type { EditedFile, FileDiagnostics } from '../../src/core/verify/diagnosticsReport'
import { fingerprint } from '../../src/core/verify/fingerprint'
import type { ApprovalMode } from '../../src/shared/permissionModes'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  type ScriptedCall,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memoryStoreOver } from './helpers/fakeMemoryIo'
import { type MemoryToolIo, memoryToolIo } from './helpers/fakeToolIo'
import { logLines } from './helpers/logText'

const ROOT = '/ws'
const LINT: CheckCommandSetting = { name: 'lint', command: 'npm run lint', changedFiles: true }
const TEST: CheckCommandSetting = { name: 'test', command: 'npm test' }

function passed(stdout = 'ok'): ShellResult {
  return { stdout, stderr: '', exitCode: 0, isTimedOut: false, isCancelled: false }
}

function failed(stdout: string): ShellResult {
  return { stdout, stderr: '', exitCode: 1, isTimedOut: false, isCancelled: false }
}

/** The fixture's shell: lint fails until `isFixed` says so; every other command passes. */
function lintShell(isFixed: () => boolean = () => false): (command: string) => ShellResult {
  return (command) =>
    command.startsWith(LINT.command) && !isFixed()
      ? failed('src/a.ts:1:7 error no-unused-vars')
      : passed(`ran ${command}`)
}

interface SetupOptions {
  readonly files?: Record<string, string>
  readonly checks?: readonly CheckCommandSetting[]
  readonly isDiagnosticsOn?: boolean
  readonly isFormatOnEdit?: boolean
  readonly isTrusted?: boolean
  readonly platform?: NodeJS.Platform
  readonly shell?: (command: string) => ShellResult
  readonly diagnostics?: (files: readonly EditedFile[]) => Promise<readonly FileDiagnostics[]>
  readonly format?: (absolutePath: string, text: string) => Promise<string | undefined>
  readonly io?: MemoryToolIo
  readonly hasVerify?: boolean
  readonly hasSubagents?: boolean
  readonly memory?: MemoryStore
  /** The user's hooks (M51), and what each run of one answers. */
  readonly hooks?: readonly HookDefinition[]
  readonly runHook?: HookRunner
}

type HookRunner = NonNullable<ToolIo['runHook']>

/** One hook for each event named, matching every tool; `runHook` answers them. */
function hooksOn(...events: readonly string[]): readonly HookDefinition[] {
  return parseHookConfig(
    JSON.stringify({
      hooks: Object.fromEntries(
        events.map((event) => [event, [{ hooks: [{ type: 'command', command: event }] }]]),
      ),
    }),
    'project',
    'linux',
  ).hooks
}

/** Each hook run's stdout: what `answer` gives for the event and the payload, as JSON. */
function hookAnswers(
  answer: (event: string, payload: Record<string, unknown>) => unknown,
): HookRunner {
  return (_command, payload) => {
    const parsed = z.record(z.string(), z.unknown()).parse(JSON.parse(payload))
    const reply = answer(String(parsed['hook_event_name']), parsed)
    return Promise.resolve({
      stdout: reply === undefined ? '{}' : JSON.stringify(reply),
      stderr: '',
      exitCode: 0,
      isTimedOut: false,
      isCancelled: false,
    })
  }
}

/** Whether a hook's payload names the shell tool, as a check or then_run does. */
function isShell(payload: Record<string, unknown>): boolean {
  return payload['tool_name'] === 'bash'
}

function setup(options: SetupOptions = {}) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const baseIo =
    options.io ??
    memoryToolIo(options.files ?? { 'src/a.ts': 'const a = 1\n' }, ROOT, options.shell)
  const io: MemoryToolIo =
    options.runHook === undefined ? baseIo : { ...baseIo, runHook: options.runHook }
  const { hooks } = options
  const diagnosticsCalls: (readonly EditedFile[])[] = []
  const formatCalls: string[] = []
  const verify: VerifyHooks = {
    isDiagnosticsOn: () => options.isDiagnosticsOn ?? true,
    checkCommands: () => options.checks ?? [],
    isFormatOnEdit: () => options.isFormatOnEdit ?? false,
    diagnosticsAfterEdit: async (files) => {
      diagnosticsCalls.push(files)
      return await (options.diagnostics?.(files) ??
        Promise.resolve(files.map((file) => ({ file, entries: [] }))))
    },
    formatAfterEdit: async (absolutePath, text) => {
      formatCalls.push(absolutePath)
      return await (options.format?.(absolutePath, text) ?? Promise.resolve(undefined))
    },
  }
  let ids = 0
  let clock = 1_000_000
  const host = new ModelApiHost({
    client: fakeModelApiClient(api, log),
    workspaceRoot: ROOT,
    platform: options.platform ?? 'linux',
    io,
    contextIo: memoryContextIo(io.files),
    newId: () => {
      ids += 1
      return `id${String(ids)}`
    },
    now: () => {
      clock += 1000
      return clock
    },
    log,
    personalSkillsRoot: undefined,
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    isPaidFeatureOn: (feature) => options.hasSubagents === true && feature === 'subagents',
    notePaidUse: () => undefined,
    promptCacheRetention: () => 'in_memory',
    allowsPaidUse: () => Promise.resolve(options.hasSubagents === true),
    isPaidUseRemembered: () => false,
    noteSubagentUsage: () => undefined,
    memory: options.memory,
    ...(options.hasVerify !== false && { verify }),
    ...(hooks !== undefined && { loadHooks: () => Promise.resolve(hooks) }),
  })
  return { api, host, io, log, diagnosticsCalls, formatCalls }
}

type Setup = ReturnType<typeof setup>

/** The choice a test gives each card: allow once unless it says otherwise. */
type Answer = (
  request: Extract<AgentEvent, { type: 'approvalRequested' }>,
) => 'allow_once' | 'allow_session' | 'abort' | 'hold'

async function start(
  t: Setup,
  mode: ApprovalMode,
  answer: Answer = () => 'allow_once',
): Promise<{
  session: ModelApiSession
  events: AgentEvent[]
  cards: Extract<AgentEvent, { type: 'approvalRequested' }>[]
  turn: (text?: string) => Promise<void>
  /** Runs `action` and waits for the turn it starts (a goal's wake) to end. */
  untilTurnEnds: (action: () => Promise<unknown>) => Promise<void>
}> {
  const session = (await t.host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: mode,
  })) as ModelApiSession
  const events: AgentEvent[] = []
  const cards: Extract<AgentEvent, { type: 'approvalRequested' }>[] = []
  let done = Promise.withResolvers<undefined>()
  const decide = (event: Extract<AgentEvent, { type: 'approvalRequested' }>) => {
    cards.push(event)
    const choice = answer(event)
    if (choice === 'hold') {
      return
    }
    queueMicrotask(() => {
      void session.decideApproval({
        approvalId: event.approvalId,
        choiceId: choice,
        requirementId: event.requirementId,
      })
    })
  }
  session.onEvent((event) => {
    events.push(event)
    if (event.type === 'approvalRequested') {
      decide(event)
    } else if (event.type === 'turnCompleted') {
      done.resolve(undefined)
      done = Promise.withResolvers<undefined>()
    }
  })
  return {
    session,
    events,
    cards,
    turn: async (text = 'fix it') => {
      const finished = done.promise
      await session.sendTurn([{ type: 'text', text }])
      await finished
    },
    untilTurnEnds: async (action) => {
      const finished = done.promise
      await action()
      await finished
    },
  }
}

function editCall(find: string, replace: string, thenRun?: string): ScriptedCall {
  return {
    name: 'edit_file',
    arguments: JSON.stringify({
      path: 'src/a.ts',
      find,
      replace,
      ...(thenRun !== undefined && { then_run: thenRun }),
    }),
  }
}

function writeCall(path: string, content: string, thenRun?: string): ScriptedCall {
  return {
    name: 'write_file',
    arguments: JSON.stringify({
      path,
      content,
      ...(thenRun !== undefined && { then_run: thenRun }),
    }),
  }
}

/** The text of every user message in a request, joined. */
function userText(body: Record<string, unknown> | undefined): string {
  const input = (body?.['input'] ?? []) as readonly {
    readonly type?: string
    readonly role?: string
    readonly content?: readonly { readonly text?: string }[]
  }[]
  return input
    .filter((item) => item.type === 'message' && item.role === 'user')
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? '')
    .join('\n')
}

/** Every function output the request carried, in order. */
function outputs(body: Record<string, unknown> | undefined): readonly string[] {
  const input = (body?.['input'] ?? []) as readonly {
    readonly type?: string
    readonly output?: unknown
  }[]
  return input
    .filter((item) => item.type === 'function_call_output')
    .map((item) => (typeof item.output === 'string' ? item.output : JSON.stringify(item.output)))
}

function completedRows(events: readonly AgentEvent[], tool: string): readonly ItemSnapshot[] {
  return events.flatMap((event) =>
    event.type === 'itemCompleted' && event.item.tool === tool ? [event.item] : [],
  )
}

/** `rounds` replies that each write a new file, then a closing reply. */
function scriptWriteRounds(t: Setup, rounds: number, closing: string): void {
  t.api.script(
    ...Array.from({ length: rounds }, (_, index): ScriptedReply => ({
      calls: [writeCall(`src/f${String(index)}.ts`, `export const x = ${String(index)}\n`)],
    })),
    { text: closing },
  )
}

/** Sends a turn that stops at its first card, and waits for it to end. */
async function stopAtFirstCard(
  started: Awaited<ReturnType<typeof start>>,
  t: Setup,
  call: ScriptedCall,
): Promise<void> {
  const { session, events, turn } = started
  t.api.script({ calls: [call] }, { text: 'never' })
  const finished = turn()
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(true)
  })
  await session.cancel()
  await finished
  expect(t.io.shellCalls).toEqual([])
}

function toolNames(body: Record<string, unknown> | undefined): readonly string[] {
  const tools = (body?.['tools'] ?? []) as readonly { readonly name?: string }[]
  return tools.flatMap((tool) => (tool.name === undefined ? [] : [tool.name]))
}

/** A turn of one edit of src/a.ts in Bypass permissions, finished. */
async function editOnce(t: Setup): Promise<Awaited<ReturnType<typeof start>>> {
  const started = await start(t, 'allowAll')
  t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
  await started.turn()
  return started
}

/** A turn of one edit whose then_run is `npm test`, finished. */
async function editThenTest(t: Setup): Promise<Awaited<ReturnType<typeof start>>> {
  const started = await start(t, 'allowAll')
  t.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'ok' })
  await started.turn()
  return started
}

/** The card of the lint check over these files (POSIX quoting). */
function lintCard(...paths: readonly string[]): {
  readonly kind: 'shell'
  readonly command: string
} {
  return {
    kind: 'shell',
    command: `${LINT.command} -- ${paths.map((path) => `'${path}'`).join(' ')}`,
  }
}

/** A workspace whose `lnk` folder is a link to its `real` folder, holding `real/a.ts`. */
function linkedIo(): MemoryToolIo {
  return memoryToolIo({ 'real/a.ts': 'const a = 1\n' }, ROOT, undefined, { lnk: `${ROOT}/real` })
}

/** A turn that edits `real/a.ts` through the link, finished. */
async function editThroughLink(t: Setup): Promise<void> {
  const { turn } = await start(t, 'allowAll')
  t.api.script(
    {
      calls: [
        {
          name: 'edit_file',
          arguments: JSON.stringify({ path: 'lnk/a.ts', find: '1', replace: '2' }),
        },
      ],
    },
    { text: 'ok' },
  )
  await turn()
}

/** Initial edit rounds shared by the session-grant regression fixtures. */
const INITIAL_EDIT_ROUNDS: readonly ScriptedReply[] = [
  { calls: [editCall('1', '2')] },
  { calls: [editCall('2', '3')] },
]

const SCRIPT_CHECK: CheckCommandSetting = { name: 'script', command: 'node scripts/check.js' }
const RUN_CHECKS: ScriptedCall = { name: 'run_checks', arguments: '{}' }

/** Acquire one verify grant, then hold the next check while another session writes. */
async function holdAfterGrant(t: Setup, hold: Promise<unknown>) {
  const reader = await start(t, 'onRequest', () =>
    reader.cards.length === 1 ? 'allow_session' : 'abort',
  )
  t.api.script({ calls: [RUN_CHECKS] }, { calls: [RUN_CHECKS], hold })
  const reading = reader.turn()
  await vi.waitFor(() => {
    expect(t.api.responseBodies()).toHaveLength(2)
    expect(t.io.shellCalls).toHaveLength(1)
  })
  return { reader, reading }
}

describe('workspace writes and verify grants', () => {
  it('new sessions inherit a pending config write, released even when its write fails', async () => {
    const beforeWrite = Promise.withResolvers<undefined>()
    const finishWrite = Promise.withResolvers<undefined>()
    const baseIo = memoryToolIo({ 'src/a.ts': 'const a = 1\n' }, ROOT)
    const t = setup({
      io: {
        ...baseIo,
        writeFile: async (absolute, content, canonical) => {
          if (absolute.endsWith('/eslint.config.js')) {
            beforeWrite.resolve(undefined)
            await finishWrite.promise
            throw new Error('write denied')
          }
          await baseIo.writeFile(absolute, content, canonical)
        },
      },
      isFormatOnEdit: true,
    })
    const writer = await start(t, 'allowAll')
    t.api.script(
      { calls: [writeCall('eslint.config.js', 'module.exports = {}')] },
      { text: 'done' },
    )
    const writing = writer.turn()
    try {
      await beforeWrite.promise
      const reader = await start(t, 'allowAll')
      t.api.script({ calls: [editCall('1', '2')] }, { text: 'done' })
      await reader.turn()
      expect(t.formatCalls).toEqual([])
      expect(t.diagnosticsCalls).toEqual([])
      expect(completedRows(reader.events, 'verify_edits')[0]?.verifySummary).toMatchObject({
        files: ['src/a.ts'],
        unchecked: 1,
      })
      finishWrite.resolve(undefined)
      await writing
      expect(completedRows(writer.events, 'write_file')[0]?.visibleOutput).toContain('write denied')
      expect(t.io.files.has(`${ROOT}/eslint.config.js`)).toBe(false)
      t.api.script({ calls: [editCall('2', '3')] }, { text: 'done' })
      await reader.turn()
      expect(t.formatCalls).toEqual([`${ROOT}/src/a.ts`])
      expect(t.diagnosticsCalls).toHaveLength(1)
    } finally {
      finishWrite.resolve(undefined)
      await writing
      await t.host.close()
    }
  })

  it.each(['note.md', 'MEMORY.md'])(
    'invalidates another session’s grant when project memory writes %s',
    async (path) => {
      const baseIo = memoryToolIo({}, ROOT)
      const memory = memoryStoreOver(baseIo.files).store
      const resumeCheck = Promise.withResolvers<undefined>()
      const check: CheckCommandSetting = {
        name: 'memory',
        command: `node .agents/memory/${path}`,
      }
      const t = setup({ io: baseIo, memory, checks: [check], isDiagnosticsOn: false })
      const { reader, reading } = await holdAfterGrant(t, resumeCheck.promise)
      try {
        const writer = await start(t, 'allowAll')
        t.api.script(
          {
            calls: [
              {
                name: 'add_memory',
                arguments: '{"scope":"project","path":"note.md","content":"console.log(1)"}',
              },
            ],
          },
          { text: 'done' },
        )
        await writer.turn()
        expect(t.io.files.has(`${ROOT}/.agents/memory/${path}`)).toBe(true)
        resumeCheck.resolve(undefined)
        await reading
        expect(reader.cards).toHaveLength(2)
        expect(t.io.shellCalls).toHaveLength(1)
      } finally {
        resumeCheck.resolve(undefined)
        await reading
        await t.host.close()
      }
    },
  )

  it.each(['write_file', 'edit_file'] as const)(
    'asks again in another conversation while %s waits for its formatter',
    async (tool) => {
      const resumeCheck = Promise.withResolvers<undefined>()
      const resumeFormat = Promise.withResolvers<string | undefined>()
      const formatting = Promise.withResolvers<undefined>()
      const t = setup({
        files: { 'scripts/check.js': 'old script\n' },
        checks: [SCRIPT_CHECK],
        isDiagnosticsOn: false,
        isFormatOnEdit: true,
        format: () => {
          formatting.resolve(undefined)
          return resumeFormat.promise
        },
      })
      const { reader, reading } = await holdAfterGrant(t, resumeCheck.promise)
      const writer = await start(t, 'allowAll')
      t.api.script(
        {
          calls: [
            { name: 'read_file', arguments: '{"path":"scripts/check.js"}' },
            {
              name: tool,
              arguments:
                tool === 'write_file'
                  ? String.raw`{"path":"scripts/check.js","content":"new script\n"}`
                  : '{"path":"scripts/check.js","find":"old","replace":"new"}',
            },
          ],
        },
        { text: 'done' },
      )
      const writing = writer.turn()
      try {
        await formatting.promise
        expect(t.io.files.get(`${ROOT}/scripts/check.js`)).toBe('new script\n')
        resumeCheck.resolve(undefined)
        await reading
        expect(reader.cards).toHaveLength(2)
        expect(t.io.shellCalls).toHaveLength(1)
        resumeFormat.resolve('formatted script\n')
        await writing
        expect(t.io.files.get(`${ROOT}/scripts/check.js`)).toBe('formatted script\n')
        expect(t.io.shellCalls).toHaveLength(2)
      } finally {
        resumeCheck.resolve(undefined)
        resumeFormat.resolve(undefined)
        await Promise.all([reading, writing])
        await t.host.close()
      }
    },
  )

  it.each([0, 1])(
    'shares pre-format invalidation between parent and siblings (writer request %s)',
    async (writerIndex) => {
      const firstChecks = Promise.withResolvers<undefined>()
      const nextChecks = Promise.withResolvers<undefined>()
      const nextWrite = Promise.withResolvers<undefined>()
      const resumeFormat = Promise.withResolvers<string | undefined>()
      const formatting = Promise.withResolvers<undefined>()
      const t = setup({
        checks: [SCRIPT_CHECK],
        hasSubagents: true,
        isDiagnosticsOn: false,
        isFormatOnEdit: true,
        format: () => {
          formatting.resolve(undefined)
          return resumeFormat.promise
        },
      })
      let grants = 0
      const parent = await start(t, 'onRequest', (card) => {
        if (card.subject.kind !== 'shell') {
          return 'allow_once'
        }
        grants += 1
        return grants <= 3 ? 'allow_session' : 'abort'
      })
      t.api.script(
        {
          calls: ['first', 'second'].map((role) => ({
            name: 'subagent_spawn',
            arguments: JSON.stringify({ role, objective: `Work as ${role}` }),
          })),
        },
        { calls: [RUN_CHECKS], hold: firstChecks.promise },
      )
      const running = parent.turn()
      try {
        await vi.waitFor(() => {
          expect(t.api.responseBodies()).toHaveLength(4)
        })
        t.api.script(
          ...Array.from({ length: 3 }, (_, index) =>
            index === writerIndex
              ? {
                  calls: [writeCall('scripts/check.js', 'new script\n')],
                  hold: nextWrite.promise,
                }
              : { calls: [RUN_CHECKS], hold: nextChecks.promise },
          ),
          { text: 'done' },
        )
        firstChecks.resolve(undefined)
        await vi.waitFor(() => {
          expect(t.api.responseBodies()).toHaveLength(7)
          expect(t.io.shellCalls).toHaveLength(3)
        })
        const writerRequest = userText(t.api.responseBodies()[4 + writerIndex])
        expect(writerRequest.includes(MODEL_TEXT.subagentObjective)).toBe(writerIndex === 0)
        // All three sessions hold their own grant before one writes.
        nextWrite.resolve(undefined)
        await formatting.promise
        expect(t.io.files.get(`${ROOT}/scripts/check.js`)).toBe('new script\n')
        nextChecks.resolve(undefined)
        await vi.waitFor(() => {
          expect(grants).toBe(5)
        })
        expect(t.io.shellCalls).toHaveLength(3)
        resumeFormat.resolve('formatted script\n')
        await running
        await vi.waitFor(() => {
          expect(parent.session.status).toBe('idle')
          expect(
            parent.session
              .history()
              .items.filter((item) => item.kind === 'subagent')
              .map((item) => item.controlStatus),
          ).toEqual(['resultReady', 'resultReady'])
        })
      } finally {
        firstChecks.resolve(undefined)
        nextChecks.resolve(undefined)
        nextWrite.resolve(undefined)
        resumeFormat.resolve(undefined)
        await running
        await t.host.close()
      }
    },
  )
})

/**
 * A turn in Auto that allows every card for the session: an edit of
 * src/a.ts, then `edit` (an edit_file's arguments), with `check` configured.
 */
async function allowThenEdit(
  files: Record<string, string>,
  check: CheckCommandSetting,
  edit: Record<string, string>,
): Promise<Awaited<ReturnType<typeof start>> & { readonly t: Setup }> {
  const t = setup({ files, checks: [check], isDiagnosticsOn: false })
  const started = await start(t, 'onRequest', () => 'allow_session')
  // Two edits of src/a.ts (the second answered by the rule when the command
  // is plain), then `edit`.
  t.api.script(
    ...INITIAL_EDIT_ROUNDS,
    { calls: [{ name: 'edit_file', arguments: JSON.stringify(edit) }] },
    { text: 'ok' },
  )
  await started.turn()
  return { ...started, t }
}

/** An edit of package.json, which decides what `npm run lint` runs. */
const MANIFEST_EDIT: ScriptedCall = {
  name: 'edit_file',
  arguments: JSON.stringify({ path: 'package.json', find: '{}', replace: '{"x":1}' }),
}

/** A PreToolUse hook's denial, with its words. */
function deny(reason: string): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }
}

/** How many times the lint check ran. */
function lintRuns(t: Setup): number {
  return t.io.shellCalls.filter((call) => call.command.startsWith(LINT.command)).length
}

const TYPE_ERROR: DiagnosticEntry = {
  path: undefined,
  severity: 'error',
  line: 1,
  column: 7,
  message: "Type 'string' is not assignable to type 'number'.",
  source: 'ts',
}

describe('the verify loop after a round of edits (Model API)', () => {
  it('sends the diagnostics and the check results in the next request, and shows a row', async () => {
    const t = setup({
      checks: [LINT, TEST],
      shell: lintShell(),
      diagnostics: (files) =>
        Promise.resolve(files.map((file) => ({ file, entries: [TYPE_ERROR] }))),
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', "'1'")] }, { text: 'done' })
    await turn()
    expect(t.io.shellCalls).toEqual([
      { command: "npm run lint -- 'src/a.ts'", cwd: ROOT, timeoutMs: 300_000 },
      { command: 'npm test', cwd: ROOT, timeoutMs: 300_000 },
    ])
    // With what the edit left, so the editor reads the file only while it holds that.
    expect(t.diagnosticsCalls).toEqual([
      [
        {
          relative: 'src/a.ts',
          absolute: `${ROOT}/src/a.ts`,
          fingerprint: fingerprint("const a = '1'\n"),
        },
      ],
    ])
    const next = userText(t.api.responseBodies()[1])
    expect(next).toContain(MODEL_TEXT.verifyLead)
    expect(next).toContain('src/a.ts: errors 1, warnings 0')
    expect(next).toContain(
      "src/a.ts:1:7: error: Type 'string' is not assignable to type 'number'. [ts]",
    )
    expect(next).toContain(
      "lint: failed\n$ npm run lint -- 'src/a.ts'\nsrc/a.ts:1:7 error no-unused-vars\n[exit code 1]",
    )
    expect(next).toContain('test: passed\n$ npm test\nran npm test\n[exit code 0]')
    const [row] = completedRows(events, 'verify_edits')
    expect(row).toMatchObject({
      status: 'completed',
      args: JSON.stringify({ paths: ['src/a.ts'] }),
      verifySummary: {
        files: ['src/a.ts'],
        errors: 1,
        warnings: 0,
        checks: [
          { name: 'lint', outcome: 'failed' },
          { name: 'test', outcome: 'passed' },
        ],
      },
    })
    // The model reads the same as the row, behind the untrusted-data lead.
    expect(next).toContain(row?.visibleOutput ?? 'missing')
  })

  it('checks nothing after a round without edits, and nothing at all without the loop', async () => {
    const t = setup({ checks: [LINT] })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'read_file', arguments: '{"path":"src/a.ts"}' }] },
      { text: 'ok' },
    )
    await turn()
    expect(completedRows(events, 'verify_edits')).toEqual([])
    const bare = setup({ hasVerify: false })
    const second = await start(bare, 'allowAll')
    bare.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await second.turn()
    expect(completedRows(second.events, 'verify_edits')).toEqual([])
    expect(toolNames(bare.api.responseBodies()[0])).not.toContain('run_checks')
  })

  it('says when the diagnostics cannot be read instead of reporting the files clean', async () => {
    const t = setup({ diagnostics: () => Promise.reject(new Error('no language server')) })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await turn()
    expect(userText(t.api.responseBodies()[1])).toContain(
      fill(MODEL_TEXT.verifyDiagnosticsUnavailable, { reason: 'no language server' }),
    )
    const [row] = completedRows(events, 'verify_edits')
    expect(row?.verifySummary).toEqual({ files: ['src/a.ts'], unchecked: 1, checks: [] })
    expect(logLines(t.log).join('\n')).toContain('the diagnostics could not be read')
  })

  it('stops the fix loop after its limit of failing rounds, and says so to both', async () => {
    const t = setup({ checks: [LINT], shell: lintShell() })
    const { events, turn } = await start(t, 'allowAll')
    const rounds = CHECK_FIX_MAX_ROUNDS + 2
    scriptWriteRounds(t, rounds, 'gave up')
    await turn()
    const lintRuns = t.io.shellCalls.filter((call) => call.command.startsWith(LINT.command))
    expect(lintRuns).toHaveLength(CHECK_FIX_MAX_ROUNDS)
    const stopNote = fill(MODEL_TEXT.checksStopped, { count: String(CHECK_FIX_MAX_ROUNDS) })
    expect(userText(t.api.responseBodies()[CHECK_FIX_MAX_ROUNDS - 1])).not.toContain(stopNote)
    expect(userText(t.api.responseBodies()[CHECK_FIX_MAX_ROUNDS])).toContain(stopNote)
    const notices = events.filter((event) => event.type === 'backendNotice')
    expect(notices).toEqual([
      {
        type: 'backendNotice',
        level: 'warning',
        text: plural(UI_TEXT.checksStoppedNotice, CHECK_FIX_MAX_ROUNDS),
      },
    ])
    // The diagnostics go on after the checks stop.
    const rows = completedRows(events, 'verify_edits')
    expect(rows).toHaveLength(rounds)
    expect(rows.at(-1)?.verifySummary?.checks).toEqual([])
    // A new turn starts the count again.
    t.api.script({ calls: [writeCall('src/g.ts', 'x\n')] }, { text: 'again' })
    await turn('once more')
    expect(t.io.shellCalls.filter((call) => call.command.startsWith(LINT.command))).toHaveLength(
      CHECK_FIX_MAX_ROUNDS + 1,
    )
  })

  it('counts only rounds in a row: a passing round resets the fix loop', async () => {
    let lintRun = 0
    // A whole-project check: each round's edit leaves the earlier runs behind,
    // so each round is judged by its own run.
    const t = setup({
      checks: [TEST],
      shell: (command) => {
        lintRun += 1
        // fail, pass, then fail every time.
        return lintRun === 2 ? passed(command) : failed('still broken')
      },
    })
    const { events, turn } = await start(t, 'allowAll')
    // One failing round, one passing, then failing ones until the limit.
    const rounds = CHECK_FIX_MAX_ROUNDS + 2
    scriptWriteRounds(t, rounds, 'done')
    await turn()
    expect(lintRun).toBe(rounds)
    const stopNote = fill(MODEL_TEXT.checksStopped, { count: String(CHECK_FIX_MAX_ROUNDS) })
    // Without the reset the loop would have stopped after its third round.
    expect(userText(t.api.responseBodies()[CHECK_FIX_MAX_ROUNDS])).not.toContain(stopNote)
    expect(userText(t.api.responseBodies()[rounds - 1])).not.toContain(stopNote)
    expect(userText(t.api.responseBodies()[rounds])).toContain(stopNote)
    expect(events.filter((event) => event.type === 'backendNotice')).toHaveLength(1)
  })

  it('reports a shell that cannot start as a failed check, not a failed turn', async () => {
    const t = setup({
      checks: [LINT],
      shell: () => {
        throw new Error('spawn bash ENOENT')
      },
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'ok' })
    await turn()
    expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'completed',
    })
    const next = t.api.responseBodies()[1]
    expect(userText(next)).toContain('lint: failed')
    expect(userText(next)).toContain('spawn bash ENOENT')
    expect(outputs(next)[0]).toContain('spawn bash ENOENT\n[exit code unknown]')
    expect(completedRows(events, 'edit_file')[0]?.thenRun?.outcome).toBe('failed')
  })

  it('refuses a scoped check whose path would read as an option, running nothing', async () => {
    const t = setup({ files: {}, checks: [LINT] })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [writeCall('-rf.ts', 'x\n')] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls).toEqual([])
    expect(userText(t.api.responseBodies()[1])).toContain(
      fill(MODEL_TEXT.checkNotRun, { name: 'lint', reason: MODEL_TEXT.checkSkipUnsafePath }),
    )
    expect(completedRows(events, 'verify_edits')[0]?.verifySummary?.checks).toEqual([
      { name: 'lint', outcome: 'notRun', skip: 'unsafePath' },
    ])
  })

  it('stops with the turn: a Stop at a check card cancels the row and the turn', async () => {
    const t = setup({ checks: [LINT] })
    const started = await start(t, 'onRequest', () => 'hold')
    const { events } = started
    await stopAtFirstCard(started, t, editCall('1', '2'))
    expect(completedRows(events, 'verify_edits')[0]?.status).toBe('cancelled')
    expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'cancelled',
    })
    expect(t.api.responseBodies()).toHaveLength(1)
  })
})

// The plan's drill: an automatic check asks wherever a shell command asks.
describe('an automatic check takes the shell tool’s permission path, per mode', () => {
  it('asks in Manual, as the shell would (the edit asks too)', async () => {
    const t = setup({ checks: [LINT], shell: lintShell() })
    const { cards, turn } = await start(t, 'promptUnmatched')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await turn()
    expect(cards.map((card) => card.subject)).toEqual([
      { kind: 'fileWrite', path: 'src/a.ts', toolName: 'edit_file' },
      { kind: 'shell', command: "npm run lint -- 'src/a.ts'" },
    ])
    expect(cards[1]?.toolName).toBe('bash')
    expect(
      cards[1]?.availableChoices.find((choice) => choice.choiceId === 'allow_session')?.label,
    ).toBe(`${UI_TEXT.allowSessionPrefix} npm run lint`)
    expect(t.io.shellCalls).toHaveLength(1)
  })

  it('asks in Auto, where edits run without a card', async () => {
    const t = setup({ checks: [LINT], shell: lintShell() })
    const { cards, turn } = await start(t, 'onRequest')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await turn()
    expect(cards.map((card) => card.subject.kind)).toEqual(['shell'])
    expect(t.io.shellCalls).toHaveLength(1)
  })

  it('runs without a card only in Bypass permissions', async () => {
    const t = setup({ checks: [LINT], shell: lintShell() })
    const { cards, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await turn()
    expect(cards).toEqual([])
    expect(t.io.shellCalls).toHaveLength(1)
  })

  it('never runs in Plan: the edit is refused, and run_checks runs nothing', async () => {
    const t = setup({ checks: [LINT, TEST] })
    const { cards, events, turn } = await start(t, 'denyUnmatched')
    t.api.script(
      { calls: [editCall('1', '2'), { name: 'run_checks', arguments: '{}' }] },
      { text: 'ok' },
    )
    await turn()
    expect(cards).toEqual([])
    expect(t.io.shellCalls).toEqual([])
    expect(completedRows(events, 'verify_edits')).toEqual([])
    const [, checksOutput] = outputs(t.api.responseBodies()[1])
    expect(checksOutput).toContain(
      fill(MODEL_TEXT.checkNotRun, { name: 'lint', reason: MODEL_TEXT.checkSkipRefused }),
    )
    expect(completedRows(events, 'run_checks')[0]?.verifySummary?.checks).toEqual([
      { name: 'lint', outcome: 'notRun', skip: 'refused' },
      { name: 'test', outcome: 'notRun', skip: 'refused' },
    ])
  })

  it('never runs in Restricted Mode: no checks after edits, no run_checks offered', async () => {
    const t = setup({ checks: [LINT], isTrusted: false })
    const { cards, events, turn } = await start(t, 'allowAll')
    t.api.script(
      { calls: [editCall('1', '2'), { name: 'run_checks', arguments: '{}' }] },
      { text: 'ok' },
    )
    await turn()
    expect(toolNames(t.api.responseBodies()[0])).not.toContain('run_checks')
    expect(cards).toEqual([])
    expect(t.io.shellCalls).toEqual([])
    // The diagnostics still come; the checks are left out.
    expect(completedRows(events, 'verify_edits')[0]?.verifySummary?.checks).toEqual([])
    expect(outputs(t.api.responseBodies()[1])[1]).toContain(MODEL_TEXT.checkSkipRestricted)
  })

  it('"Always allow in this session" holds for the check, and only for the check', async () => {
    const t = setup({ checks: [LINT], shell: lintShell() })
    const { cards, turn } = await start(t, 'onRequest', () => 'allow_session')
    t.api.script(
      ...INITIAL_EDIT_ROUNDS,
      // The model's own shell call of the same command is not allowed by the
      // check's rule (PR #54, fourth Codex round): it asks. The check's rule
      // still answers for the check afterwards.
      { calls: [{ name: 'bash', arguments: '{"command":"npm run lint","description":"lint"}' }] },
      { calls: [editCall('3', '4')] },
      { text: 'ok' },
    )
    await turn()
    expect(cards.map((card) => [card.toolName, card.subject])).toEqual([
      ['bash', { kind: 'shell', command: "npm run lint -- 'src/a.ts'" }],
      ['bash', { kind: 'shell', command: 'npm run lint' }],
    ])
    expect(t.io.shellCalls.map((call) => call.command)).toEqual([
      "npm run lint -- 'src/a.ts'",
      "npm run lint -- 'src/a.ts'",
      'npm run lint',
      "npm run lint -- 'src/a.ts'",
    ])
  })

  it('does not ask again in the turn for a check the user rejected', async () => {
    const t = setup({ checks: [LINT] })
    const { cards, turn } = await start(t, 'onRequest', () => 'abort')
    t.api.script({ calls: [editCall('1', '2')] }, { calls: [editCall('2', '3')] }, { text: 'ok' })
    await turn()
    expect(cards).toHaveLength(1)
    expect(t.io.shellCalls).toEqual([])
    expect(userText(t.api.responseBodies()[1])).toContain(
      fill(MODEL_TEXT.checkNotRun, { name: 'lint', reason: MODEL_TEXT.checkSkipRejected }),
    )
  })
})

describe('run_checks (the model’s own call)', () => {
  it('is offered with the checks named, and runs the ones asked over the turn’s edits', async () => {
    const t = setup({
      files: { 'src/a.ts': 'const a = 1\n', 'src/b.ts': 'const b = 1\n' },
      checks: [LINT, TEST],
      // The whole project lints clean; a changed file does not. (Three failing
      // rounds in a row would stop the checks: run_checks rounds count too.)
      shell: (command) => (command === LINT.command ? passed() : lintShell()(command)),
      isDiagnosticsOn: false,
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'run_checks', arguments: '{"names":["lint"]}' }] },
      { calls: [editCall('1', '2')] },
      { calls: [{ name: 'run_checks', arguments: '{"names":["lint"]}' }] },
      { calls: [{ name: 'run_checks', arguments: '{"names":["lint"],"paths":["src/b.ts"]}' }] },
      { text: 'ok' },
    )
    await turn()
    const definition = (
      t.api.responseBodies()[0]?.['tools'] as readonly Record<string, unknown>[]
    ).find((tool) => tool['name'] === 'run_checks')
    expect(String(definition?.['description'])).toContain(
      'lint (`npm run lint`), test (`npm test`)',
    )
    expect(t.io.shellCalls.map((call) => call.command)).toEqual([
      // Before any edit: the whole project.
      'npm run lint',
      // The automatic checks after the edit, every one configured.
      "npm run lint -- 'src/a.ts'",
      'npm test',
      // The turn's edits, then the path the model named.
      "npm run lint -- 'src/a.ts'",
      "npm run lint -- 'src/b.ts'",
    ])
    const [first] = completedRows(events, 'run_checks')
    expect(first).toMatchObject({
      status: 'completed',
      verifySummary: { files: [], checks: [{ name: 'lint', outcome: 'passed' }] },
    })
    expect(outputs(t.api.responseBodies()[1])[0]).toContain(MODEL_TEXT.runChecksLead)
  })

  it('refuses unknown names, bad arguments, paths outside the workspace, and no checks', async () => {
    const t = setup({ checks: [LINT] })
    const { turn } = await start(t, 'allowAll')
    t.api.script(
      {
        calls: [
          { name: 'run_checks', arguments: '{"names":["deploy"]}' },
          { name: 'run_checks', arguments: '{"names":"lint"}' },
          { name: 'run_checks', arguments: 'not json' },
          { name: 'run_checks', arguments: '{"paths":["../outside.ts"]}' },
        ],
      },
      { text: 'ok' },
    )
    await turn()
    const [unknown, badShape, notJson, outside] = outputs(t.api.responseBodies()[1])
    expect(unknown).toBe(
      `Error: ${fill(MODEL_TEXT.runChecksUnknown, { name: 'deploy', names: 'lint' })}`,
    )
    expect(badShape).toContain('Error: invalid arguments')
    expect(notJson).toBe('Error: arguments are not valid JSON')
    expect(outside).toContain('Error:')
    expect(t.io.shellCalls).toEqual([])
    const none = setup({ checks: [] })
    const second = await start(none, 'allowAll')
    none.api.script({ calls: [{ name: 'run_checks', arguments: '{}' }] }, { text: 'ok' })
    await second.turn()
    expect(outputs(none.api.responseBodies()[1])[0]).toBe(`Error: ${MODEL_TEXT.runChecksNone}`)
  })
})

describe('then_run: one call, two results', () => {
  it('runs the command after the edit and returns both results in one row', async () => {
    const t = setup({ isDiagnosticsOn: false, shell: () => failed('1 failing') })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2', 'npm test -- a')] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls).toEqual([
      { command: 'npm test -- a', cwd: ROOT, timeoutMs: SHELL_DEFAULT_TIMEOUT_MS },
    ])
    const [output] = outputs(t.api.responseBodies()[1])
    expect(output).toBe(
      `edited src/a.ts\n\n${MODEL_TEXT.thenRunLead} $ npm test -- a\n1 failing\n[exit code 1]`,
    )
    const [row] = completedRows(events, 'edit_file')
    expect(row).toMatchObject({
      status: 'completed',
      patchSummary: { files: 1, added: 1, removed: 1 },
      thenRun: { command: 'npm test -- a', outcome: 'failed', output: '1 failing', exitCode: 1 },
    })
    expect(t.io.files.get(`${ROOT}/src/a.ts`)).toBe('const a = 2\n')
  })

  it('asks for the command where a shell command asks, after the edit’s own card', async () => {
    const t = setup({ isDiagnosticsOn: false })
    const { cards, turn } = await start(t, 'promptUnmatched')
    t.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'ok' })
    await turn()
    expect(cards.map((card) => [card.itemId, card.subject])).toEqual([
      [cards[0]?.itemId, { kind: 'fileWrite', path: 'src/a.ts', toolName: 'edit_file' }],
      [cards[0]?.itemId, { kind: 'shell', command: 'npm test' }],
    ])
  })

  it('does not run a rejected command, or in Restricted Mode, or in Plan', async () => {
    const rejected = setup({ isDiagnosticsOn: false })
    const first = await start(rejected, 'onRequest', () => 'abort')
    rejected.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'ok' })
    await first.turn()
    expect(rejected.io.shellCalls).toEqual([])
    expect(completedRows(first.events, 'edit_file')[0]?.thenRun).toEqual({
      command: 'npm test',
      outcome: 'notRun',
      skip: 'rejected',
      output: '',
    })
    expect(outputs(rejected.api.responseBodies()[1])[0]).toContain(
      fill(MODEL_TEXT.thenRunNotRun, { reason: MODEL_TEXT.checkSkipRejected }),
    )

    const restricted = setup({ isDiagnosticsOn: false, isTrusted: false })
    const second = await start(restricted, 'allowAll')
    restricted.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'ok' })
    await second.turn()
    expect(restricted.io.shellCalls).toEqual([])
    expect(completedRows(second.events, 'edit_file')[0]?.thenRun?.skip).toBe('restricted')
    // Restricted Mode offers no then_run at all.
    expect(JSON.stringify(restricted.api.responseBodies()[0]?.['tools'])).not.toContain('then_run')

    const plan = setup({ isDiagnosticsOn: false })
    const third = await start(plan, 'denyUnmatched')
    plan.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'ok' })
    await third.turn()
    expect(plan.io.shellCalls).toEqual([])
    expect(plan.io.files.get(`${ROOT}/src/a.ts`)).toBe('const a = 1\n')
    expect(completedRows(third.events, 'edit_file')[0]?.thenRun).toBeUndefined()
  })

  it('skips the command when the file changed after the edit (the guard)', async () => {
    const t = setup({ isDiagnosticsOn: false })
    // The file changes while the command's card is open.
    const { turn } = await start(t, 'onRequest', () => {
      t.io.files.set(`${ROOT}/src/a.ts`, 'someone else wrote this\n')
      return 'allow_once'
    })
    t.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls).toEqual([])
    expect(outputs(t.api.responseBodies()[1])[0]).toContain(
      fill(MODEL_TEXT.thenRunNotRun, { reason: MODEL_TEXT.checkSkipChanged }),
    )
  })

  it('takes the guard’s hash after format on edit, so a formatted file still runs', async () => {
    const t = setup({
      isDiagnosticsOn: false,
      isFormatOnEdit: true,
      format: (_path, text) => Promise.resolve(text.replace('=', ' =  ')),
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('a = 1', 'a=2', 'npm test')] }, { text: 'ok' })
    await turn()
    expect(t.io.files.get(`${ROOT}/src/a.ts`)).toBe('const a =  2\n')
    expect(t.io.shellCalls.map((call) => call.command)).toEqual(['npm test'])
    const [output] = outputs(t.api.responseBodies()[1])
    expect(output).toContain(`edited src/a.ts. ${MODEL_TEXT.formattedAfterEdit}`)
    // The row's diff is the formatted result.
    expect(completedRows(events, 'edit_file')[0]?.visibleOutput).toContain('+const a =  2')
    expect(t.formatCalls).toEqual([`${ROOT}/src/a.ts`])
  })

  it('keeps the edit and its diff when the turn is stopped at the command’s card', async () => {
    const t = setup({ isDiagnosticsOn: false })
    const started = await start(t, 'onRequest', () => 'hold')
    await stopAtFirstCard(started, t, editCall('1', '2', 'npm test'))
    const [row] = completedRows(started.events, 'edit_file')
    expect(row).toMatchObject({
      status: 'completed',
      patchSummary: { files: 1 },
      thenRun: { command: 'npm test', outcome: 'cancelled' },
    })
  })

  it('says the command did not run when the edit itself failed', async () => {
    const t = setup({ isDiagnosticsOn: false })
    const { turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('not there', 'x', 'npm test')] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls).toEqual([])
    expect(outputs(t.api.responseBodies()[1])[0]).toBe(
      `Error: find text not found in src/a.ts\n${MODEL_TEXT.thenRunEditFailed}`,
    )
  })
})

describe('format on edit', () => {
  it('writes the formatter’s text before the checks, and is off unless turned on', async () => {
    const t = setup({
      files: {},
      isFormatOnEdit: true,
      format: (_path, text) => Promise.resolve(`${text.trimEnd()};\n`),
    })
    const { turn } = await start(t, 'allowAll')
    t.api.script({ calls: [writeCall('src/n.ts', 'export const n = 1')] }, { text: 'ok' })
    await turn()
    expect(t.io.files.get(`${ROOT}/src/n.ts`)).toBe('export const n = 1;\n')
    const off = setup({ files: {} })
    const second = await start(off, 'allowAll')
    off.api.script({ calls: [writeCall('src/n.ts', 'export const n = 1')] }, { text: 'ok' })
    await second.turn()
    expect(off.formatCalls).toEqual([])
    expect(off.io.files.get(`${ROOT}/src/n.ts`)).toBe('export const n = 1')
  })

  it('leaves the edit as written when the formatter fails, and logs it', async () => {
    const t = setup({
      isFormatOnEdit: true,
      format: () => Promise.reject(new Error('formatter crashed')),
    })
    const { events } = await editOnce(t)
    expect(t.io.files.get(`${ROOT}/src/a.ts`)).toBe('const a = 2\n')
    expect(completedRows(events, 'edit_file')[0]?.status).toBe('completed')
    expect(logLines(t.log).join('\n')).toContain(
      'Format on edit failed; the edit stays as written: formatter crashed',
    )
  })
})

describe('the instructions', () => {
  it('describe the loop, the checks, run_checks and then_run as they are offered', async () => {
    const t = setup({ checks: [LINT] })
    const { turn } = await start(t, 'allowAll')
    t.api.script({ text: 'ok' })
    await turn()
    const instructions = String(t.api.responseBodies()[0]?.['instructions'])
    expect(instructions).toContain('# Checking your work')
    expect(instructions).toContain("errors and warnings from VS Code's language servers")
    expect(instructions).toContain('lint (`npm run lint`)')
    expect(instructions).toContain('run_checks')
    expect(instructions).toContain('then_run')
    const restricted = setup({ checks: [LINT], isTrusted: false, isDiagnosticsOn: false })
    const second = await start(restricted, 'allowAll')
    restricted.api.script({ text: 'ok' })
    await second.turn()
    expect(String(restricted.api.responseBodies()[0]?.['instructions'])).not.toContain(
      '# Checking your work',
    )
  })
})

// The M68 review: then_run and the checks go through the user's tool hooks
// as calls of the shell tool, and a hook's "no" is told apart from the user's.
describe('the user’s hooks see then_run and the checks as shell calls', () => {
  it('lets a PreToolUse hook deny a then_run command, with its words, or a rewrite without one', async () => {
    const payloads: Record<string, unknown>[] = []
    const t = setup({
      isDiagnosticsOn: false,
      hooks: hooksOn('PreToolUse'),
      runHook: hookAnswers((_event, payload) => {
        if (!isShell(payload)) {
          return undefined
        }
        payloads.push(payload)
        return deny('no tests on main')
      }),
    })
    const { events } = await editThenTest(t)
    expect(t.io.shellCalls).toEqual([])
    expect(payloads[0]?.['tool_input']).toMatchObject({ command: 'npm test' })
    expect(completedRows(events, 'edit_file')[0]?.thenRun).toEqual({
      command: 'npm test',
      outcome: 'notRun',
      skip: 'hookDenied',
      detail: 'no tests on main',
      output: '',
    })
    const reason = fill(MODEL_TEXT.checkDetail, {
      reason: MODEL_TEXT.checkSkipHookDenied,
      detail: 'no tests on main',
    })
    expect(outputs(t.api.responseBodies()[1])[0]).toContain(
      fill(MODEL_TEXT.thenRunNotRun, { reason }),
    )

    // A rewrite with no command, then one whose command is blank.
    const rewrites: readonly Record<string, unknown>[] = [{ script: 'npm test' }, { command: '  ' }]
    let rewritten = 0
    const blank = setup({
      isDiagnosticsOn: false,
      hooks: hooksOn('PreToolUse'),
      runHook: hookAnswers((_event, payload) => {
        if (!isShell(payload)) {
          return undefined
        }
        rewritten += 1
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            updatedInput: rewrites[rewritten - 1],
          },
        }
      }),
    })
    const second = await start(blank, 'allowAll')
    blank.api.script(
      { calls: [editCall('1', '2', 'npm test')] },
      { calls: [editCall('2', '3', 'npm test')] },
      { text: 'ok' },
    )
    await second.turn()
    expect(blank.io.shellCalls).toEqual([])
    expect(completedRows(second.events, 'edit_file').map((row) => row.thenRun)).toEqual([
      expect.objectContaining({ skip: 'hookDenied', detail: MODEL_TEXT.hookInputNoCommand }),
      expect.objectContaining({ skip: 'hookDenied', detail: MODEL_TEXT.hookInputNoCommand }),
    ])
  })

  it('runs the command a PreToolUse hook rewrote, and asks when the hook says ask', async () => {
    const t = setup({
      isDiagnosticsOn: false,
      hooks: hooksOn('PreToolUse'),
      runHook: hookAnswers((_event, payload) =>
        isShell(payload)
          ? {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'ask',
                updatedInput: { command: 'npm test -- --bail' },
              },
            }
          : undefined,
      ),
    })
    const { cards, events } = await editThenTest(t)
    expect(cards.map((card) => card.subject)).toEqual([
      { kind: 'shell', command: 'npm test -- --bail' },
    ])
    expect(t.io.shellCalls.map((call) => call.command)).toEqual(['npm test -- --bail'])
    expect(completedRows(events, 'edit_file')[0]?.thenRun).toMatchObject({
      command: 'npm test -- --bail',
      outcome: 'passed',
    })
  })

  it('asks for the then_run command too when a hook made the edit itself ask', async () => {
    const t = setup({
      isDiagnosticsOn: false,
      hooks: hooksOn('PreToolUse'),
      runHook: hookAnswers((_event, payload) =>
        payload['tool_name'] === 'edit_file'
          ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } }
          : undefined,
      ),
    })
    const { cards } = await editThenTest(t)
    expect(cards.map((card) => card.subject.kind)).toEqual(['fileWrite', 'shell'])
    expect(t.io.shellCalls).toHaveLength(1)
  })

  it('gives the model what a PostToolUse hook adds after the output, and stops when it says', async () => {
    const t = setup({
      isDiagnosticsOn: false,
      hooks: hooksOn('PostToolUse'),
      runHook: hookAnswers((_event, payload) =>
        isShell(payload)
          ? {
              decision: 'block',
              reason: 'tests are slow here',
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: 'CI runs them too',
              },
            }
          : undefined,
      ),
    })
    await editThenTest(t)
    const input = z
      .array(z.record(z.string(), z.unknown()))
      .parse(t.api.responseBodies()[1]?.['input'])
    const output = input.findIndex((item) => item['type'] === 'function_call_output')
    const texts = input.map((item) => JSON.stringify(item))
    const context = texts.findIndex((text) => text.includes('CI runs them too'))
    const reason = texts.findIndex((text) => text.includes('tests are slow here'))
    expect(output).toBeGreaterThan(-1)
    expect(context).toBeGreaterThan(output)
    expect(reason).toBeGreaterThan(context)

    const stopping = setup({
      isDiagnosticsOn: false,
      hooks: hooksOn('PostToolUse'),
      runHook: hookAnswers((_event, payload) =>
        isShell(payload) ? { continue: false, stopReason: 'enough for today' } : undefined,
      ),
    })
    const second = await start(stopping, 'allowAll')
    stopping.api.script({ calls: [editCall('1', '2', 'npm test')] }, { text: 'never' })
    await second.turn()
    expect(stopping.io.shellCalls).toHaveLength(1)
    expect(stopping.api.responseBodies()).toHaveLength(1)
  })

  it('runs each check through them: a denial is not a Reject, and a stop ends the turn', async () => {
    let shellHooks = 0
    const t = setup({
      checks: [LINT],
      isDiagnosticsOn: false,
      shell: lintShell(),
      hooks: hooksOn('PreToolUse'),
      runHook: hookAnswers((_event, payload) => {
        if (!isShell(payload)) {
          return undefined
        }
        shellHooks += 1
        return shellHooks === 1 ? deny('not now') : undefined
      }),
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2')] }, { calls: [editCall('2', '3')] }, { text: 'ok' })
    await turn()
    expect(completedRows(events, 'verify_edits').map((row) => row.verifySummary?.checks)).toEqual([
      [{ name: 'lint', outcome: 'notRun', skip: 'hookDenied', detail: 'not now' }],
      [{ name: 'lint', outcome: 'failed' }],
    ])
    expect(userText(t.api.responseBodies()[1])).toContain(
      fill(MODEL_TEXT.checkNotRun, {
        name: 'lint',
        reason: fill(MODEL_TEXT.checkDetail, {
          reason: MODEL_TEXT.checkSkipHookDenied,
          detail: 'not now',
        }),
      }),
    )

    // The Codex review of PR #54: the checks after the stop do not run,
    // automatic or run_checks.
    const stopping = setup({
      checks: [LINT, TEST],
      isDiagnosticsOn: false,
      hooks: hooksOn('PostToolUse'),
      runHook: hookAnswers((_event, payload) =>
        isShell(payload) ? { continue: false, stopReason: 'stop after lint' } : undefined,
      ),
    })
    const second = await start(stopping, 'allowAll')
    stopping.api.script({ calls: [editCall('1', '2')] }, { text: 'never' })
    await second.turn()
    expect(stopping.io.shellCalls.map((call) => call.command)).toEqual([
      "npm run lint -- 'src/a.ts'",
    ])
    expect(stopping.api.responseBodies()).toHaveLength(1)
    const [row] = completedRows(second.events, 'verify_edits')
    expect(row?.status).toBe('completed')
    expect(row?.verifySummary?.checks).toEqual([{ name: 'lint', outcome: 'passed' }])
    stopping.api.script({ calls: [{ name: 'run_checks', arguments: '{}' }] }, { text: 'never' })
    await second.turn('run them')
    expect(stopping.io.shellCalls).toHaveLength(2)
    expect(stopping.api.responseBodies()).toHaveLength(2)
  })

  it('tells a PermissionRequest hook’s denial from the user’s Reject, and asks again later', async () => {
    let asked = 0
    const t = setup({
      checks: [LINT],
      isDiagnosticsOn: false,
      shell: lintShell(),
      hooks: hooksOn('PermissionRequest'),
      runHook: hookAnswers(() => {
        asked += 1
        return asked === 1
          ? {
              hookSpecificOutput: {
                hookEventName: 'PermissionRequest',
                decision: { behavior: 'deny', message: 'ask me later' },
              },
            }
          : undefined
      }),
    })
    const { cards, events, turn } = await start(t, 'onRequest')
    t.api.script({ calls: [editCall('1', '2')] }, { calls: [editCall('2', '3')] }, { text: 'ok' })
    await turn()
    expect(cards).toHaveLength(1)
    expect(completedRows(events, 'verify_edits').map((row) => row.verifySummary?.checks)).toEqual([
      [{ name: 'lint', outcome: 'notRun', skip: 'hookDenied', detail: 'ask me later' }],
      [{ name: 'lint', outcome: 'failed' }],
    ])
  })
})

// The M68 review: one state for the automatic checks and run_checks, kept
// until the user's next message; nothing run twice, or after the last round.
describe('the checks’ state since the user’s message', () => {
  it('asks again for a check allowed for the session once the turn edits what decides what it runs', async () => {
    const t = setup({
      files: { 'src/a.ts': 'const a = 1\n', 'package.json': '{}\n' },
      checks: [LINT],
      isDiagnosticsOn: false,
    })
    const { cards, turn } = await start(t, 'onRequest', () => 'allow_session')
    // The second round's lint would be allowed by the rule (see "Always
    // allow in this session" above), but that round also edits the manifest.
    t.api.script(
      { calls: [editCall('1', '2')] },
      { calls: [editCall('2', '3'), MANIFEST_EDIT] },
      { text: 'ok' },
    )
    await turn()
    expect(cards.map((card) => card.subject)).toEqual([
      lintCard('src/a.ts'),
      lintCard('src/a.ts', 'package.json'),
    ])
    // The user's next message trusts the session's rule again.
    t.api.script({ calls: [editCall('3', '4')] }, { text: 'ok' })
    await turn('go on')
    expect(cards).toHaveLength(2)
    expect(lintRuns(t)).toBe(3)
  })

  it('keeps a Reject and the fix loop’s stop for run_checks too, and remembers its Reject', async () => {
    const t = setup({ checks: [LINT], isDiagnosticsOn: false })
    const { cards, events, turn } = await start(t, 'onRequest', () => 'abort')
    t.api.script(
      { calls: [{ name: 'run_checks', arguments: '{}' }] },
      { calls: [{ name: 'run_checks', arguments: '{}' }] },
      { calls: [editCall('1', '2')] },
      { text: 'ok' },
    )
    await turn()
    expect(cards).toHaveLength(1)
    expect(t.io.shellCalls).toEqual([])
    expect(completedRows(events, 'run_checks').map((row) => row.verifySummary?.checks)).toEqual([
      [{ name: 'lint', outcome: 'notRun', skip: 'rejected' }],
      [{ name: 'lint', outcome: 'notRun', skip: 'rejected' }],
    ])
    expect(completedRows(events, 'verify_edits')).toEqual([])

    const stopped = setup({ files: {}, checks: [LINT], shell: lintShell() })
    const second = await start(stopped, 'allowAll')
    stopped.api.script(
      ...Array.from({ length: CHECK_FIX_MAX_ROUNDS }, (_, index): ScriptedReply => ({
        calls: [writeCall(`src/f${String(index)}.ts`, 'x\n')],
      })),
      { calls: [{ name: 'run_checks', arguments: '{}' }] },
      { text: 'ok' },
    )
    await second.turn()
    expect(lintRuns(stopped)).toBe(CHECK_FIX_MAX_ROUNDS)
    expect(completedRows(second.events, 'run_checks')[0]?.verifySummary?.checks).toEqual([
      { name: 'lint', outcome: 'notRun', skip: 'stopped' },
    ])
  })

  // The Codex review of PR #54: rounds of run_checks alone count too.
  it('counts failing run_checks rounds without edits toward the fix loop', async () => {
    const t = setup({ checks: [LINT], isDiagnosticsOn: false, shell: lintShell() })
    const { events, turn } = await start(t, 'allowAll')
    const runChecks: ScriptedReply = { calls: [{ name: 'run_checks', arguments: '{}' }] }
    t.api.script(...Array.from({ length: CHECK_FIX_MAX_ROUNDS + 1 }, () => runChecks), {
      text: 'ok',
    })
    await turn()
    expect(lintRuns(t)).toBe(CHECK_FIX_MAX_ROUNDS)
    expect(completedRows(events, 'run_checks').at(-1)?.verifySummary?.checks).toEqual([
      { name: 'lint', outcome: 'notRun', skip: 'stopped' },
    ])
    expect(events.filter((event) => event.type === 'backendNotice')).toHaveLength(1)
  })

  it('does not run a check again after the round when the model ran it since the edit', async () => {
    const t = setup({ checks: [LINT, TEST], isDiagnosticsOn: false })
    const { turn } = await start(t, 'allowAll')
    t.api.script(
      { calls: [editCall('1', '2'), { name: 'run_checks', arguments: '{"names":["lint"]}' }] },
      { calls: [editCall('2', '3', 'npm test')] },
      { text: 'ok' },
    )
    await turn()
    expect(t.io.shellCalls.map((call) => call.command)).toEqual([
      // run_checks over the round's edit, then the round's other check.
      "npm run lint -- 'src/a.ts'",
      'npm test',
      // then_run ran the test check's own command, so the round runs lint only.
      'npm test',
      "npm run lint -- 'src/a.ts'",
    ])
  })

  it('runs nothing after the turn’s last round, which no request would read', async () => {
    const t = setup({ files: {}, checks: [LINT] })
    const { events, turn } = await start(t, 'allowAll')
    scriptWriteRounds(t, MODEL_API_MAX_TOOL_ROUNDS, 'never')
    await turn()
    expect(t.api.responseBodies()).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS)
    expect(completedRows(events, 'verify_edits')).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS - 1)
    expect(t.diagnosticsCalls).toHaveLength(MODEL_API_MAX_TOOL_ROUNDS - 1)
    expect(lintRuns(t)).toBe(MODEL_API_MAX_TOOL_ROUNDS - 1)
  })

  it('keeps the fix loop’s stop through a goal’s wake; the user’s next message starts over', async () => {
    const t = setup({ files: {}, checks: [LINT], shell: lintShell() })
    const { session, turn, untilTurnEnds } = await start(t, 'allowAll')
    scriptWriteRounds(t, CHECK_FIX_MAX_ROUNDS, 'gave up')
    await turn()
    expect(lintRuns(t)).toBe(CHECK_FIX_MAX_ROUNDS)
    t.api.script(
      { calls: [writeCall('src/g.ts', 'x\n')] },
      { calls: [{ name: 'update_goal', arguments: '{"status":"complete"}' }] },
      { text: 'goal done' },
    )
    await untilTurnEnds(() => session.controlGoal({ verb: 'set', objective: 'Ship it' }))
    expect(userText(t.api.responseBodies().at(-2))).toContain(MODEL_TEXT.verifyLead)
    expect(lintRuns(t)).toBe(CHECK_FIX_MAX_ROUNDS)
    t.api.script({ calls: [writeCall('src/h.ts', 'x\n')] }, { text: 'again' })
    await turn('once more')
    expect(lintRuns(t)).toBe(CHECK_FIX_MAX_ROUNDS + 1)
  })

  it('keeps the note within one budget however much the checks print', async () => {
    const checks = Array.from({ length: 8 }, (_, index) => ({
      name: `c${String(index)}`,
      command: `check${String(index)}`,
    }))
    // Each check floods both streams: without the one budget the note would be 8 outputs long.
    const flood = 'x'.repeat(VERIFY_NOTE_MAX_CHARS)
    const t = setup({
      checks,
      shell: () => ({ ...failed(flood), stderr: flood }),
    })
    const { turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls).toHaveLength(8)
    const note = userText(t.api.responseBodies()[1])
    expect(note.length).toBeLessThanOrEqual(VERIFY_NOTE_MAX_CHARS + 1000)
    expect(note.length).toBeGreaterThan(VERIFY_NOTE_MAX_CHARS * 0.8)
  })
})

describe('what reaches a check and the editor (the M68 review)', () => {
  it('refuses a path a response file or the Windows shells would read as syntax', async () => {
    const t = setup({ files: {}, checks: [LINT] })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [writeCall('@args.txt', 'x\n')] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls).toEqual([])
    expect(completedRows(events, 'verify_edits')[0]?.verifySummary?.checks).toEqual([
      { name: 'lint', outcome: 'notRun', skip: 'unsafePath' },
    ])
    const windows = setup({ files: {}, checks: [LINT], platform: 'win32' })
    const second = await start(windows, 'allowAll')
    windows.api.script({ calls: [writeCall('src/a&calc.ts', 'x\n')] }, { text: 'ok' })
    await second.turn()
    expect(windows.io.shellCalls).toEqual([])
    expect(completedRows(second.events, 'verify_edits')[0]?.verifySummary?.checks).toEqual([
      { name: 'lint', outcome: 'notRun', skip: 'unsafePath' },
    ])
  })

  it('passes a check only files that exist; run_checks refuses one that does not', async () => {
    const io = memoryToolIo({ 'src/a.ts': 'const a = 1\n' }, ROOT)
    const t = setup({
      io,
      checks: [LINT],
      diagnostics: (files) => {
        // The file is gone by the time the checks run.
        io.files.delete(`${ROOT}/src/n.ts`)
        return Promise.resolve(files.map((file) => ({ file, entries: [] })))
      },
    })
    const { turn } = await start(t, 'allowAll')
    t.api.script(
      { calls: [writeCall('src/n.ts', 'x\n'), editCall('1', '2')] },
      { calls: [{ name: 'run_checks', arguments: '{"paths":["src/gone.ts"]}' }] },
      { text: 'ok' },
    )
    await turn()
    expect(t.io.shellCalls.map((call) => call.command)).toEqual(["npm run lint -- 'src/a.ts'"])
    expect(outputs(t.api.responseBodies()[2]).at(-1)).toBe(
      `Error: ${fill(MODEL_TEXT.runChecksMissingPath, { path: 'src/gone.ts' })}`,
    )
  })

  it('never shows or formats code the editor’s tools run, nor anything once the turn wrote some', async () => {
    const t = setup({
      isFormatOnEdit: true,
      format: (_path, text) => Promise.resolve(`${text}// formatted\n`),
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script(
      { calls: [writeCall('eslint.config.js', 'export default []\n')] },
      { calls: [editCall('1', '2')] },
      { text: 'ok' },
    )
    await turn()
    expect(t.diagnosticsCalls).toEqual([])
    expect(t.formatCalls).toEqual([])
    const reason = fill(MODEL_TEXT.verifyUncheckedCodeLoading, { file: 'eslint.config.js' })
    expect(userText(t.api.responseBodies()[2])).toContain(
      fill(MODEL_TEXT.verifyFileUnchecked, { path: 'src/a.ts', reason }),
    )
    expect(completedRows(events, 'verify_edits').map((row) => row.verifySummary)).toEqual([
      { files: ['eslint.config.js'], unchecked: 1, checks: [] },
      { files: ['src/a.ts'], unchecked: 1, checks: [] },
    ])
    // The user's next message shows and formats again.
    t.api.script({ calls: [editCall('2', '3')] }, { text: 'ok' })
    await turn('go on')
    expect(t.diagnosticsCalls).toHaveLength(1)
    expect(t.formatCalls).toEqual([`${ROOT}/src/a.ts`])
  })

  it('shows at most eight files a round, and says the rest were not checked', async () => {
    const t = setup({ files: {} })
    const { events, turn } = await start(t, 'allowAll')
    const names = Array.from({ length: 9 }, (_, index) => `src/f${String(index)}.ts`)
    t.api.script({ calls: names.map((name) => writeCall(name, 'x\n')) }, { text: 'ok' })
    await turn()
    expect(t.diagnosticsCalls.map((files) => files.length)).toEqual([8])
    expect(completedRows(events, 'verify_edits')[0]?.verifySummary).toMatchObject({
      errors: 0,
      warnings: 0,
      unchecked: 1,
    })
    expect(userText(t.api.responseBodies()[1])).toContain(
      fill(MODEL_TEXT.verifyFileUnchecked, {
        path: 'src/f8.ts',
        reason: fill(MODEL_TEXT.verifyUncheckedTooMany, { count: '8' }),
      }),
    )
  })

  it('reports a file no language server reported on as not checked, never clean', async () => {
    const t = setup({
      diagnostics: (files) =>
        Promise.resolve(
          files.map((file) => ({ file, entries: [], unchecked: 'noReport' as const })),
        ),
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await turn()
    const next = userText(t.api.responseBodies()[1])
    expect(next).toContain(
      fill(MODEL_TEXT.verifyFileUnchecked, {
        path: 'src/a.ts',
        reason: MODEL_TEXT.verifyUncheckedNoReport,
      }),
    )
    expect(next).not.toContain(fill(MODEL_TEXT.verifyFileClean, { path: 'src/a.ts' }))
    expect(completedRows(events, 'verify_edits')[0]?.verifySummary).toEqual({
      files: ['src/a.ts'],
      unchecked: 1,
      checks: [],
    })
  })

  it('moves the diagnostics baseline only once the model has the report', async () => {
    let message = 'first'
    const t = setup({
      checks: [LINT],
      diagnostics: (files) =>
        Promise.resolve(files.map((file) => ({ file, entries: [{ ...TYPE_ERROR, message }] }))),
    })
    let choice: 'hold' | 'allow_once' = 'hold'
    const started = await start(t, 'onRequest', () => choice)
    // Stopped at the check's card: the report never reached the model.
    await stopAtFirstCard(started, t, editCall('1', '2'))
    choice = 'allow_once'
    message = 'second'
    t.api.script({ calls: [editCall('2', '3')] }, { text: 'ok' })
    await started.turn('again')
    const changed = fill(MODEL_TEXT.verifyFileChanges, { added: '1', fixed: '1' })
    expect(userText(t.api.responseBodies().at(-1))).not.toContain(changed)
    message = 'third'
    t.api.script({ calls: [editCall('3', '4')] }, { text: 'ok' })
    await started.turn('and again')
    expect(userText(t.api.responseBodies().at(-1))).toContain(changed)
  })

  it('stops at once when the user stops while the language servers are awaited', async () => {
    const t = setup({ checks: [LINT], diagnostics: () => new Promise(() => undefined) })
    const { session, events, untilTurnEnds } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'never' })
    await untilTurnEnds(async () => {
      await session.sendTurn([{ type: 'text', text: 'fix it' }])
      await vi.waitFor(() => {
        expect(t.diagnosticsCalls).toHaveLength(1)
      })
      await session.cancel()
    })
    expect(t.io.shellCalls).toEqual([])
    expect(completedRows(events, 'verify_edits')[0]?.status).toBe('cancelled')
    expect(events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'cancelled',
    })
  })

  it('keeps the edit as written when the formatted text cannot be written back', async () => {
    const io = memoryToolIo({ 'src/a.ts': 'const a = 1\n' }, ROOT)
    const t = setup({
      // The write-back goes through the one conditional write, which fails here.
      io: { ...io, writeFileIfUnchanged: () => Promise.reject(new Error('disk full')) },
      isDiagnosticsOn: false,
      isFormatOnEdit: true,
      format: (_path, text) => Promise.resolve(`${text}// formatted\n`),
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2')] }, { text: 'ok' })
    await turn()
    expect(io.files.get(`${ROOT}/src/a.ts`)).toBe('const a = 2\n')
    expect(completedRows(events, 'edit_file')[0]?.status).toBe('completed')
    expect(outputs(t.api.responseBodies()[1])[0]).not.toContain(MODEL_TEXT.formattedAfterEdit)
    expect(logLines(t.log).join('\n')).toContain(
      'Format on edit could not write src/a.ts; the edit stays as written: disk full',
    )
  })
})

// The Codex review of PR #54: every act on an edited file after an await uses
// the real path and canonical name confinement found at the edit, and checks
// the file is still that (and still holds what the edit left) just before.
describe('acts on the file the edit wrote, as it left it', () => {
  it('does not write the formatted text over a change made while the formatter ran', async () => {
    const io = memoryToolIo({ 'src/a.ts': 'const a = 1\n' }, ROOT)
    const t = setup({
      io,
      isDiagnosticsOn: false,
      isFormatOnEdit: true,
      format: (_path, text) => {
        // Someone else writes the file while the formatter runs.
        io.files.set(`${ROOT}/src/a.ts`, 'someone else\n')
        return Promise.resolve(`${text}// formatted\n`)
      },
    })
    const { events } = await editThenTest(t)
    expect(io.files.get(`${ROOT}/src/a.ts`)).toBe('someone else\n')
    expect(logLines(t.log).join('\n')).toContain(
      'Format on edit skipped src/a.ts: it no longer holds what the edit wrote',
    )
    // then_run's guard sees the change too, just before the command.
    expect(t.io.shellCalls).toEqual([])
    expect(completedRows(events, 'edit_file')[0]?.thenRun?.skip).toBe('changed')
  })

  it('reads and checks an edited file by the real path and canonical name it had', async () => {
    const io = linkedIo()
    const t = setup({ io, checks: [LINT] })
    await editThroughLink(t)
    expect(t.diagnosticsCalls).toEqual([
      [
        {
          relative: 'real/a.ts',
          absolute: `${ROOT}/real/a.ts`,
          fingerprint: fingerprint('const a = 2\n'),
        },
      ],
    ])
    expect(t.io.shellCalls.map((call) => call.command)).toEqual(["npm run lint -- 'real/a.ts'"])
  })

  it('skips a check when a checked file no longer is where confinement found it', async () => {
    const links: Record<string, string> = {}
    const io = memoryToolIo({ 'src/a.ts': 'const a = 1\n' }, ROOT, undefined, links)
    const t = setup({
      io,
      checks: [LINT],
      diagnostics: (files) => {
        // Before the check runs, the folder becomes a link out of the workspace.
        links['src'] = '/elsewhere/src'
        return Promise.resolve(files.map((file) => ({ file, entries: [] })))
      },
    })
    const { events } = await editOnce(t)
    expect(t.io.shellCalls).toEqual([])
    expect(completedRows(events, 'verify_edits')[0]?.verifySummary?.checks).toEqual([
      { name: 'lint', outcome: 'notRun', skip: 'changed' },
    ])
  })
})

// The Codex review of PR #54, third round: one ledger records every check
// against the state it ran on, judges rounds by the latest state, and starts
// afresh on any admitted user input.
describe('the verify ledger in the loop', () => {
  it('counts a failing then_run of a check’s own command, and does not run the check again', async () => {
    const t = setup({
      files: {},
      checks: [TEST],
      isDiagnosticsOn: false,
      shell: (command) => failed(`${command} failed`),
    })
    const { events, turn } = await start(t, 'allowAll')
    t.api.script(
      ...Array.from({ length: CHECK_FIX_MAX_ROUNDS }, (_, index): ScriptedReply => ({
        calls: [writeCall(`src/f${String(index)}.ts`, 'x\n', TEST.command)],
      })),
      { text: 'gave up' },
    )
    await turn()
    // Only the then_run commands ran: each already ran the check on the latest state.
    expect(t.io.shellCalls.map((call) => call.command)).toEqual(
      Array.from({ length: CHECK_FIX_MAX_ROUNDS }, () => TEST.command),
    )
    expect(events.filter((event) => event.type === 'backendNotice')).toHaveLength(1)
  })

  it('judges a round by its latest state: a failure before the round’s edit does not count', async () => {
    let scoped = 0
    const t = setup({
      checks: [LINT],
      isDiagnosticsOn: false,
      shell: (command) => {
        if (command === LINT.command) {
          return failed('the whole project fails')
        }
        scoped += 1
        return scoped === 1 ? passed() : failed('src/a.ts still fails')
      },
    })
    const { turn } = await start(t, 'allowAll')
    t.api.script(
      { calls: [{ name: 'run_checks', arguments: '{}' }, editCall('1', '2')] },
      { calls: [editCall('2', '3')] },
      { calls: [editCall('3', '4')] },
      { calls: [editCall('4', '5')] },
      { text: 'ok' },
    )
    await turn()
    const stopNote = fill(MODEL_TEXT.checksStopped, { count: String(CHECK_FIX_MAX_ROUNDS) })
    // The first round passed on its latest state; three failing rounds follow it.
    expect(userText(t.api.responseBodies()[CHECK_FIX_MAX_ROUNDS])).not.toContain(stopNote)
    expect(userText(t.api.responseBodies()[CHECK_FIX_MAX_ROUNDS + 1])).toContain(stopNote)
  })

  it('starts afresh on a steered message: a check rejected before it asks again', async () => {
    const t = setup({ checks: [LINT], isDiagnosticsOn: false })
    let asked = 0
    const steering: { now?: () => void } = {}
    const { session, events, cards, turn } = await start(t, 'onRequest', () => {
      asked += 1
      if (asked === 1) {
        steering.now?.()
        return 'abort'
      }
      return 'allow_once'
    })
    steering.now = () => {
      const started = events.find((event) => event.type === 'turnStarted')
      if (started?.type === 'turnStarted') {
        void session.steer(started.turnId, [{ type: 'text', text: 'try the lint again' }])
      }
    }
    t.api.script({ calls: [editCall('1', '2')] }, { calls: [editCall('2', '3')] }, { text: 'ok' })
    await turn()
    expect(cards).toHaveLength(2)
    expect(t.io.shellCalls.map((call) => call.command)).toEqual(["npm run lint -- 'src/a.ts'"])
  })
})

// The review of e4b035a3: a steer resets the fix loop, rejections and runs,
// never what the model wrote.
describe('a steer after the model rewrote what a check runs', () => {
  it('does not let the session’s rule answer again for the rewritten check', async () => {
    const t = setup({
      files: { 'src/a.ts': 'const a = 1\n', 'package.json': '{}\n' },
      checks: [LINT],
      isDiagnosticsOn: false,
    })
    const steering: { now?: () => void } = {}
    let asked = 0
    const { session, events, cards, turn } = await start(t, 'onRequest', () => {
      asked += 1
      if (asked === 2) {
        steering.now?.()
      }
      return 'allow_session'
    })
    steering.now = () => {
      const started = events.find((event) => event.type === 'turnStarted')
      if (started?.type === 'turnStarted') {
        void session.steer(started.turnId, [{ type: 'text', text: 'stop' }])
      }
    }
    t.api.script(
      { calls: [editCall('1', '2')] },
      { calls: [MANIFEST_EDIT] },
      { calls: [editCall('2', '3')] },
      { text: 'ok' },
    )
    await turn()
    // The third round's check still asks: package.json was rewritten since the message.
    expect(cards.map((card) => card.subject)).toEqual([
      lintCard('src/a.ts'),
      lintCard('package.json'),
      lintCard('src/a.ts'),
    ])
  })
})

describe('what counts as a check’s run, and what the write-back leaves alone', () => {
  it('does not take a then_run as a run of a check that takes the changed files', async () => {
    const t = setup({ checks: [LINT], isDiagnosticsOn: false })
    const { turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2', LINT.command)] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls.map((call) => call.command)).toEqual([
      LINT.command,
      "npm run lint -- 'src/a.ts'",
    ])
  })

  it('does not write the formatted text over what the user typed into an editor meanwhile', async () => {
    const io = memoryToolIo({ 'src/a.ts': 'const a = 1\n' }, ROOT)
    const t = setup({
      io,
      isDiagnosticsOn: false,
      isFormatOnEdit: true,
      format: (_path, text) => {
        io.unsaved.add(`${ROOT}/src/a.ts`)
        return Promise.resolve(`${text}// formatted\n`)
      },
    })
    await editOnce(t)
    expect(io.files.get(`${ROOT}/src/a.ts`)).toBe('const a = 2\n')
    expect(logLines(t.log).join('\n')).toContain(
      'Format on edit skipped src/a.ts: it has unsaved changes in an editor',
    )
  })
})

// Grok's review of 6b2a5bfb.
describe('the write-back and then_run, as Grok read them', () => {
  it('does not take a passing then_run as a check whose own cap is shorter than the shell’s', async () => {
    const quick: CheckCommandSetting = {
      name: 'quick',
      command: 'npm run quick',
      timeoutSeconds: 10,
    }
    const t = setup({ checks: [quick], isDiagnosticsOn: false })
    const { turn } = await start(t, 'allowAll')
    t.api.script({ calls: [editCall('1', '2', quick.command)] }, { text: 'ok' })
    await turn()
    expect(t.io.shellCalls.map((call) => call.command)).toEqual([quick.command, quick.command])
  })

  it('leaves the formatted text unwritten while an editor holds the file by the name given', async () => {
    const io = linkedIo()
    const t = setup({
      io,
      isDiagnosticsOn: false,
      isFormatOnEdit: true,
      format: (_path, text) => {
        // The user types into the editor that opened the file through the link.
        io.unsaved.add(`${ROOT}/lnk/a.ts`)
        return Promise.resolve(`${text}// formatted\n`)
      },
    })
    await editThroughLink(t)
    expect(io.files.get(`${ROOT}/real/a.ts`)).toBe('const a = 2\n')
    expect(logLines(t.log).join('\n')).toContain('it has unsaved changes in an editor')
  })
})

// PR #54, fourth Codex round: a check whose script path is quoted.
describe('a check that runs a script by a quoted path', () => {
  it('asks again once the model edits the script, whatever the session rule allowed', async () => {
    const mine: CheckCommandSetting = { name: 'mine', command: 'node "scripts/my check.js"' }
    const { cards } = await allowThenEdit(
      { 'src/a.ts': 'const a = 1\n', 'scripts/my check.js': 'check()\n' },
      mine,
      { path: 'scripts/my check.js', find: 'check', replace: 'x' },
    )
    // A command with quotes: any edit lapses the rule, so every round asks.
    expect(cards.map((card) => card.subject)).toEqual([
      { kind: 'shell', command: mine.command },
      { kind: 'shell', command: mine.command },
      { kind: 'shell', command: mine.command },
    ])
  })
})

// The review of PR #54's fourth round: the grant answers until the named file is edited.
describe('a check that runs a script by a plain path', () => {
  it('lets the rule answer for other edits, and asks again once the script is edited', async () => {
    const script: CheckCommandSetting = { name: 'script', command: 'node scripts/check' }
    const { cards, t } = await allowThenEdit(
      { 'src/a.ts': 'const a = 1\n', 'scripts/check.js': 'check()\n' },
      script,
      { path: 'scripts/check.js', find: 'check', replace: 'x' },
    )
    expect(cards.map((card) => card.subject)).toEqual([
      { kind: 'shell', command: script.command },
      { kind: 'shell', command: script.command },
    ])
    expect(t.io.shellCalls.map((call) => call.command)).toEqual([
      script.command,
      script.command,
      script.command,
    ])
  })
})

// PR #54, fourth Codex round, a sibling: the rule is judged on the command it is keyed on.
describe('a then_run a hook rewrote', () => {
  it('asks again once the model edits the script the rewritten command runs', async () => {
    const t = setup({
      files: { 'src/a.ts': 'const a = 1\n', 'scripts/t.js': 'run()\n' },
      isDiagnosticsOn: false,
      hooks: hooksOn('PreToolUse'),
      runHook: hookAnswers((_event, payload) =>
        isShell(payload)
          ? {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput: { command: 'node scripts/t.js' },
              },
            }
          : undefined,
      ),
    })
    const { cards, turn } = await start(t, 'onRequest', () => 'allow_session')
    t.api.script(
      { calls: [editCall('1', '2', 'npm test')] },
      {
        calls: [
          {
            name: 'edit_file',
            arguments: JSON.stringify({
              path: 'scripts/t.js',
              find: 'run',
              replace: 'x',
              then_run: 'npm test',
            }),
          },
        ],
      },
      { text: 'ok' },
    )
    await turn()
    expect(cards.map((card) => card.subject)).toEqual([
      { kind: 'shell', command: 'node scripts/t.js' },
      { kind: 'shell', command: 'node scripts/t.js' },
    ])
  })
})
