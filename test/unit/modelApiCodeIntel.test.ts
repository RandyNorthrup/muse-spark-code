// The code intelligence tools on the Model API backend (M67, PLAN.md D49),
// through the host on the fake Model API: reads that run in every mode
// (Restricted Mode included), a rename that asks and writes like an edit
// (protected paths, Plan, a file changed while the card was open), and the
// opt-in repo map in the system prompt.

import { describe, expect, it, vi } from 'vitest'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import type { EditedFile } from '../../src/core/verify/diagnosticsReport'
import { WorkspaceEdits } from '../../src/core/verify/workspaceEdits'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { type HookDefinition, parseHookConfig } from '../../src/core/backends/modelapi/hooks'
import { MODEL_TEXT, type PaidFeature } from '../../src/shared/constants'
import { memoryContextIo } from './helpers/fakeContextIo'
import {
  type FakeServiceOptions,
  fakeLanguageService,
  KIND,
  loc,
  sym,
} from './helpers/fakeLanguageService'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  type ScriptedCall,
} from './helpers/fakeModelApi'
import { disabledPaidFeatures } from './helpers/fakePaidFeatures'
import { memoryToolIo, realPathThrough } from './helpers/fakeToolIo'

const ROOT = '/ws'
const A = `${ROOT}/src/a.ts`
const B = `${ROOT}/src/b.ts`
const TASKS = `${ROOT}/.vscode/tasks.ts`
const FILES = {
  'src/a.ts': 'export function greet() {}\n',
  'src/b.ts': "import { greet } from './a'\ngreet()\n",
  '.vscode/tasks.ts': 'greet()\n',
}
const TOOLS = [
  'find_definition',
  'find_references',
  'workspace_symbols',
  'document_symbols',
  'hover',
  'call_hierarchy',
  'repo_map',
  'rename_symbol',
]
const RENAME: ScriptedCall = {
  name: 'rename_symbol',
  arguments: JSON.stringify({ path: 'src/a.ts', symbol: 'greet', new_name: 'welcome' }),
}

/** A rename of `greet` at the start of a file's first line. */
function renamedFile(path: string) {
  return renamed(path, 0, 0)
}

function renamed(path: string, line: number, character: number) {
  return {
    path,
    edits: [
      {
        range: { start: { line, character }, end: { line, character: character + 5 } },
        newText: 'welcome',
      },
    ],
  }
}

interface StartOptions {
  readonly approvalMode?: string
  readonly isTrusted?: boolean
  /** The language services' answers; null runs the host without them. */
  readonly service?: Omit<FakeServiceOptions, 'files'> | null
  readonly isRepoMapOn?: () => boolean
  /** Paid child tasks on, their popup allowing each (M48), for the child's prompt. */
  readonly hasSubagents?: boolean
  /** Hooks from Muse Code's settings (M51), and what each one received on its stdin. */
  readonly hooks?: readonly HookDefinition[]
  readonly hookPayloads?: unknown[]
  /** The folder the workspace is opened as: a link to the files' own (/ws). */
  readonly linkedAs?: string
  readonly workspaceEdits?: WorkspaceEdits
  readonly verify?: VerifyHooks
}

async function start(options: StartOptions = {}) {
  const api = fakeModelApi()
  const io = memoryToolIo(FILES, ROOT)
  const root = options.linkedAs ?? ROOT
  if (options.linkedAs !== undefined) {
    io.realPath = realPathThrough(options.linkedAs, ROOT)
  }
  const payloads = options.hookPayloads
  if (payloads !== undefined) {
    io.runHook = (_command, payload) => {
      payloads.push(JSON.parse(payload))
      return Promise.resolve({
        stdout: '{}',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      })
    }
  }
  const service =
    options.service === null
      ? undefined
      : fakeLanguageService({
          files: io.files,
          ...(options.linkedAs !== undefined && { links: { [options.linkedAs]: ROOT } }),
          ...options.service,
        })
  let ids = 0
  const log = new FakeLogOutputChannel()
  // Built directly on POSIX paths: the manager would take this machine's platform.
  const host = new ModelApiHost({
    ...disabledPaidFeatures,
    ...(options.hasSubagents === true && {
      isPaidFeatureOn: (feature: PaidFeature) => feature === 'subagents',
      allowsPaidUse: () => Promise.resolve(true),
    }),
    client: fakeModelApiClient(api, log),
    log,
    workspaceRoot: root,
    platform: 'linux',
    io,
    contextIo: memoryContextIo(io.files),
    newId: () => {
      ids += 1
      return `n${String(ids)}`
    },
    now: () => 0,
    personalSkillsRoot: undefined,
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    promptCacheRetention: () => 'in_memory',
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    memory: undefined,
    codeIntel: service,
    isRepoMapInPrompt: options.isRepoMapOn,
    loadHooks: () => Promise.resolve(options.hooks ?? []),
    workspaceEdits: options.workspaceEdits,
    verify: options.verify,
  })
  const session = await host.startSession({
    workspaceRoot: root,
    modelId: 'muse-spark-1.3',
    approvalMode: options.approvalMode ?? 'promptUnmatched',
  })
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  let turns = 0
  /** Sends a message whose reply makes these calls and then answers; waits for the turn's end. */
  const turn = async (calls: readonly ScriptedCall[], isCardExpected = false) => {
    turns += 1
    const expected = turns
    api.script({ calls }, { text: 'done' })
    await session.sendTurn([{ type: 'text', text: 'go' }])
    if (!isCardExpected) {
      await vi.waitFor(() => {
        expect(events.filter((event) => event.type === 'turnCompleted')).toHaveLength(expected)
      })
    }
  }
  return { api, io, service, session, events, turn, host }
}

type Started = Awaited<ReturnType<typeof start>>

/** Holds a rename recheck after its card, before the first native write. */
function holdRenameRead(t: Started, heldRead = 1) {
  const read = t.io.readFile
  const held = Promise.withResolvers<undefined>()
  const entered = Promise.withResolvers<undefined>()
  let reads = 0
  t.io.readFile = async (path, expected) => {
    if (path === A) {
      reads += 1
      if (reads === heldRead) {
        entered.resolve(undefined)
        await held.promise
      }
    }
    return await read(path, expected)
  }
  return { held, entered }
}

/** The tool rows' final states, in order. */
function finished(events: readonly AgentEvent[]) {
  return events.flatMap((event) =>
    event.type === 'itemCompleted' && event.item.kind === 'toolCall' ? [event.item] : [],
  )
}

/** What the model was given back for its calls in the request after them. */
function outputs(api: ReturnType<typeof fakeModelApi>): readonly string[] {
  const input = api.responseBodies().at(-1)?.['input']
  return (Array.isArray(input) ? input : []).flatMap((item: unknown) =>
    typeof item === 'object' &&
    item !== null &&
    'type' in item &&
    item.type === 'function_call_output' &&
    'output' in item &&
    typeof item.output === 'string'
      ? [item.output]
      : [],
  )
}

async function cardFor(events: readonly AgentEvent[]) {
  await vi.waitFor(() => {
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(true)
  })
  const card = events.find((event) => event.type === 'approvalRequested')
  if (card?.type !== 'approvalRequested') {
    throw new Error('no card')
  }
  return card
}

/** Allows the card once, as the user would, and waits for the turn to end. */
async function allowAndFinish(t: Started, card: Awaited<ReturnType<typeof cardFor>>) {
  await t.session.decideApproval({
    approvalId: card.approvalId,
    choiceId: 'allow_once',
    requirementId: card.requirementId,
  })
  await vi.waitFor(() => {
    expect(t.events.some((event) => event.type === 'turnCompleted')).toBe(true)
  })
}

/** Presses Stop once `provider` has been asked, and waits for the turn to end as the `turns`th. */
async function stopOnceAsked(t: Started, provider: string, turns = 1) {
  await vi.waitFor(() => {
    expect(t.service?.asked.some((call) => call.startsWith(provider))).toBe(true)
  })
  await t.session.cancel()
  await vi.waitFor(() => {
    expect(t.events.filter((event) => event.type === 'turnCompleted')).toHaveLength(turns)
  })
}

/** `greet` renamed where it is: its definition in a.ts, its import and call in b.ts. */
const GREET_FILES = [renamed(A, 0, 16), renamed(B, 0, 9), renamed(B, 1, 0)]

const GREET_EVERYWHERE = {
  rename: () => Promise.resolve({ files: GREET_FILES, fileOperations: 'none' as const }),
}

/** A project `PreToolUse` hook on `Edit`, which a rename matches. */
const EDIT_HOOK = parseHookConfig(
  JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'guard' }] }] },
  }),
  'project',
  'linux',
).hooks

describe('code intelligence on the Model API backend', () => {
  it('offers the tools with their guidance only while language services are there', async () => {
    const t = await start()
    await t.turn([])
    const body = t.api.responseBodies()[0] ?? {}
    const names = (body['tools'] as { name?: string }[]).map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(TOOLS))
    expect(String(body['instructions'])).toContain(MODEL_TEXT.codeIntelInstructions)
    const without = await start({ service: null })
    await without.turn([])
    const plain = without.api.responseBodies()[0] ?? {}
    expect((plain['tools'] as { name?: string }[]).map((tool) => tool.name)).not.toContain('hover')
    expect(String(plain['instructions'])).not.toContain(MODEL_TEXT.codeIntelInstructions)
  })

  it('reads without a card in Plan and in Restricted Mode, and says when no service answers', async () => {
    const t = await start({
      approvalMode: 'denyUnmatched',
      isTrusted: false,
      service: { references: () => [loc(A, 0, 16), loc(B, 1, 0)] },
    })
    await t.turn([
      { name: 'find_references', arguments: '{"path":"src/b.ts","line":2,"column":1}' },
      { name: 'find_definition', arguments: '{"path":"src/a.ts","line":1,"column":1}' },
      { name: 'hover', arguments: 'not json' },
    ])
    expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    const [references, definition, hover] = outputs(t.api)
    expect(references).toBe('src/a.ts:1:17: export function greet() {}\nsrc/b.ts:2:1: greet()')
    expect(definition).toContain('Error: no language service answered for src/a.ts')
    expect(hover).toBe('Error: arguments are not valid JSON')
    expect(finished(t.events).map((item) => item.status)).toEqual(['completed', 'failed', 'failed'])
    expect(finished(t.events)[1]?.failureReason).toBe(
      'No language service answered for src/a.ts, or it declares no symbols.',
    )
  })

  it('renames through the edit path: a card naming the files, then one patch across them', async () => {
    const t = await start({ service: GREET_EVERYWHERE })
    await t.turn([RENAME], true)
    const card = await cardFor(t.events)
    expect(card.subject).toEqual({
      kind: 'fileWrite',
      path: 'src/a.ts, src/b.ts',
      toolName: 'rename_symbol',
    })
    expect(card.isProtectedWrite).toBe(false)
    await allowAndFinish(t, card)
    expect(t.io.files.get(A)).toBe('export function welcome() {}\n')
    expect(t.io.files.get(B)).toBe("import { welcome } from './a'\nwelcome()\n")
    expect(finished(t.events)[0]).toMatchObject({
      status: 'completed',
      patchSummary: { files: 2, added: 3, removed: 3 },
    })
    expect(outputs(t.api)[0]).toContain('Renamed `greet` to `welcome`: 3 edits in 2 files')
  })

  it.each([false, true])(
    'notifies pending rename paths and checks only actual writes (second write fails: %s)',
    async (failsSecondWrite) => {
      const workspaceEdits = new WorkspaceEdits()
      const other = new VerifyLedger()
      workspaceEdits.add(other)
      const checked: EditedFile[] = []
      const t = await start({
        service: GREET_EVERYWHERE,
        linkedAs: '/linked-workspace',
        workspaceEdits,
        verify: {
          isDiagnosticsOn: () => true,
          checkCommands: () => [],
          isFormatOnEdit: () => false,
          diagnosticsAfterEdit: (files) => {
            checked.push(...files)
            return Promise.resolve(files.map((file) => ({ file, entries: [] })))
          },
          formatAfterEdit: () => Promise.resolve(undefined),
        },
      })
      await t.turn([RENAME], true)
      const card = await cardFor(t.events)
      const { held, entered } = holdRenameRead(t)
      const write = t.io.writeFile
      t.io.writeFile = async (path, text, expected) => {
        if (path === B && failsSecondWrite) {
          throw new Error('disk full')
        }
        await write(path, text, expected)
      }
      await t.session.decideApproval({
        approvalId: card.approvalId,
        choiceId: 'allow_once',
        requirementId: card.requirementId,
      })
      await entered.promise
      other.resetForMessage()
      expect(other.changesWhatRuns('node src/a.ts')).toBe(true)
      expect(other.changesWhatRuns('node src/b.ts')).toBe(true)
      held.resolve(undefined)
      await vi.waitFor(() => {
        expect(t.events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      expect(checked.map((file) => file.absolute)).toEqual(failsSecondWrite ? [A] : [A, B])
      expect(checked.map((file) => file.relative)).toEqual(
        failsSecondWrite ? ['src/a.ts'] : ['src/a.ts', 'src/b.ts'],
      )
      other.resetForMessage()
      expect(other.changesWhatRuns('node src/a.ts')).toBe(false)
      expect(other.changesWhatRuns('node src/b.ts')).toBe(false)
      expect(finished(t.events).find((item) => item.tool === 'rename_symbol')?.status).toBe(
        failsSecondWrite ? 'failed' : 'completed',
      )
    },
  )

  it('writes without a card in Auto, and write_file may then replace a renamed file', async () => {
    const t = await start({ approvalMode: 'onRequest', service: GREET_EVERYWHERE })
    await t.turn([
      RENAME,
      { name: 'write_file', arguments: JSON.stringify({ path: 'src/b.ts', content: 'gone\n' }) },
    ])
    expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(t.io.files.get(A)).toBe('export function welcome() {}\n')
    expect(t.io.files.get(B)).toBe('gone\n')
  })

  it('asks for a protected file in every mode but Bypass, and Plan refuses a rename', async () => {
    const protectedRename = {
      rename: () =>
        Promise.resolve({
          files: [renamed(A, 0, 16), renamed(TASKS, 0, 0)],
          fileOperations: 'none' as const,
        }),
    }
    const auto = await start({ approvalMode: 'onRequest', service: protectedRename })
    await auto.turn([RENAME], true)
    expect(await cardFor(auto.events)).toMatchObject({ isProtectedWrite: true })
    const plan = await start({ approvalMode: 'denyUnmatched', service: GREET_EVERYWHERE })
    await plan.turn([RENAME])
    expect(outputs(plan.api)[0]).toBe(`Error: rename_symbol ${MODEL_TEXT.toolRefusedByMode}`)
    expect(plan.io.files.get(A)).toBe(FILES['src/a.ts'])
    // Refused before the language service is asked for anything.
    expect(plan.service?.asked.some((call) => call.startsWith('rename'))).toBe(false)
  })

  it.each([
    [
      'changed',
      (t: Started) => {
        t.io.files.set(B, 'someone else wrote this\n')
      },
      'src/b.ts changed after the rename was planned; nothing was changed',
    ],
    [
      'gained unsaved changes',
      (t: Started) => {
        t.io.unsaved.add(B)
      },
      `src/b.ts ${MODEL_TEXT.fileHasUnsavedChanges}`,
    ],
    [
      'became a link elsewhere',
      (t: Started) => {
        t.io.realPath = (path) => Promise.resolve(path === B ? `${ROOT}/src/elsewhere.ts` : path)
      },
      MODEL_TEXT.pathChangedAfterApproval,
    ],
  ])('writes nothing when a file %s while the card was open', async (_what, change, reason) => {
    const t = await start({ service: GREET_EVERYWHERE })
    await t.turn([RENAME], true)
    const card = await cardFor(t.events)
    change(t)
    await allowAndFinish(t, card)
    expect(outputs(t.api)[0]).toMatch(/^Error: /)
    expect(outputs(t.api)[0]).toContain(reason)
    expect(t.io.files.get(A)).toBe(FILES['src/a.ts'])
  })

  it("writes nothing when an editor gains unsaved changes under a link's path", async () => {
    // The workspace is opened through a link; the service names the files by
    // their real paths (/ws), the editor by the link's.
    const t = await start({ linkedAs: '/link/ws', service: GREET_EVERYWHERE })
    await t.turn([RENAME], true)
    const card = await cardFor(t.events)
    t.io.unsaved.add('/link/ws/src/b.ts')
    await allowAndFinish(t, card)
    expect(outputs(t.api)[0]).toBe(`Error: src/b.ts ${MODEL_TEXT.fileHasUnsavedChanges}`)
    expect(t.io.files.get(A)).toBe(FILES['src/a.ts'])
    expect(t.io.files.get(B)).toBe(FILES['src/b.ts'])
  })

  it('stops writing, and says so, when a file changes while the others are written', async () => {
    const t = await start({ approvalMode: 'onRequest', service: GREET_EVERYWHERE })
    const write = t.io.writeFile
    t.io.writeFile = async (path, content, expected) => {
      await write(path, content, expected)
      if (path === A) {
        // A formatter or the user saves b.ts between the two writes.
        t.io.files.set(B, 'someone else wrote this\n')
      }
    }
    await t.turn([RENAME])
    expect(outputs(t.api)[0]).toBe(
      'Error: src/b.ts changed after the rename was planned, so it was not written. The rename was written to 1 of 2 files (src/a.ts); the rest are unchanged, and the row can revert what was written',
    )
    expect(t.io.files.get(B)).toBe('someone else wrote this\n')
    expect(finished(t.events)[0]).toMatchObject({
      status: 'failed',
      patchSummary: { files: 1, added: 1, removed: 1 },
    })
  })

  it.each([1, 2])(
    'writes nothing when Stop comes during file check %d after approval',
    async (heldRead) => {
      const workspaceEdits = new WorkspaceEdits()
      const other = new VerifyLedger()
      workspaceEdits.add(other)
      const t = await start({ service: GREET_EVERYWHERE, workspaceEdits })
      await t.turn([RENAME], true)
      const card = await cardFor(t.events)
      const { held, entered } = holdRenameRead(t, heldRead)
      await t.session.decideApproval({
        approvalId: card.approvalId,
        choiceId: 'allow_once',
        requirementId: card.requirementId,
      })
      await entered.promise
      expect(other.changesWhatRuns('node src/b.ts')).toBe(true)
      await t.session.cancel()
      held.resolve(undefined)
      await vi.waitFor(() => {
        expect(t.events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      expect(t.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
        terminal: 'cancelled',
      })
      expect(t.io.files.get(A)).toBe(FILES['src/a.ts'])
      expect(t.io.files.get(B)).toBe(FILES['src/b.ts'])
      other.resetForMessage()
      expect(other.changesWhatRuns('node src/b.ts')).toBe(false)
    },
  )

  it('names the protected file first on the card', async () => {
    // A git hook that sorts last among the files: without the order, the
    // card would name five others and count it among the rest.
    const hook = `${ROOT}/src/zz/.husky/pre-commit.ts`
    const many = {
      rename: () =>
        Promise.resolve({
          files: [
            renamed(A, 0, 16),
            renamed(B, 0, 9),
            ...['c', 'd', 'e', 'f'].map((name) => renamedFile(`${ROOT}/src/${name}.ts`)),
            renamedFile(hook),
          ],
          fileOperations: 'none' as const,
        }),
    }
    const t = await start({ approvalMode: 'onRequest', service: many })
    for (const file of [...['c', 'd', 'e', 'f'].map((name) => `${ROOT}/src/${name}.ts`), hook]) {
      t.io.files.set(file, 'greet\n')
    }
    await t.turn([RENAME], true)
    const card = await cardFor(t.events)
    expect(card).toMatchObject({ isProtectedWrite: true })
    expect(card.subject.path).toBe(
      'src/zz/.husky/pre-commit.ts, src/a.ts, src/b.ts, src/c.ts, src/d.ts and 2 more files',
    )
  })

  it('runs an Edit hook for a rename, with the files it would write', async () => {
    const payloads: unknown[] = []
    const hooks = EDIT_HOOK
    const t = await start({
      approvalMode: 'onRequest',
      service: GREET_EVERYWHERE,
      hooks,
      hookPayloads: payloads,
    })
    await t.turn([RENAME])
    expect(payloads).toMatchObject([
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'rename_symbol',
        tool_input: {
          path: 'src/a.ts',
          symbol: 'greet',
          new_name: 'welcome',
          files: ['src/a.ts', 'src/b.ts'],
        },
      },
    ])
    expect(t.io.files.get(A)).toBe('export function welcome() {}\n')
    // A Stop while the hook's files are planned still ends the call with its row.
    const stopped = await start({
      approvalMode: 'onRequest',
      service: { rename: () => new Promise(() => undefined) },
      hooks,
      hookPayloads: [],
    })
    await stopped.turn([RENAME], true)
    await stopOnceAsked(stopped, 'rename')
    expect(finished(stopped.events).map((item) => item.tool)).toEqual(['rename_symbol'])
  })

  it('writes the plan its hook was shown, however the code changes while the hook runs', async () => {
    const C = `${ROOT}/src/c.ts`
    let isGrown = false
    const payloads: unknown[] = []
    const t = await start({
      approvalMode: 'onRequest',
      service: {
        rename: () =>
          Promise.resolve({
            files: [
              ...GREET_FILES,
              // A reference added while the hook runs (by it, or by the user).
              ...(isGrown ? [renamedFile(C)] : []),
            ],
            fileOperations: 'none' as const,
          }),
      },
      hooks: EDIT_HOOK,
      hookPayloads: payloads,
    })
    t.io.files.set(C, 'greet()\n')
    const runHook = t.io.runHook?.bind(t.io)
    t.io.runHook = async (...args) => {
      isGrown = true
      if (runHook === undefined) {
        throw new Error('no hook runner')
      }
      return await runHook(...args)
    }
    await t.turn([RENAME])
    expect(payloads).toMatchObject([{ tool_input: { files: ['src/a.ts', 'src/b.ts'] } }])
    expect(t.service?.asked.filter((call) => call.startsWith('rename'))).toHaveLength(1)
    expect(t.io.files.get(A)).toBe('export function welcome() {}\n')
    expect(t.io.files.get(C)).toBe('greet()\n')
  })

  it('says which files a failed write left renamed, and the row can revert them', async () => {
    const t = await start({ approvalMode: 'onRequest', service: GREET_EVERYWHERE })
    const write = t.io.writeFile
    t.io.writeFile = (path, content, expected) =>
      path === B ? Promise.reject(new Error('disk full')) : write(path, content, expected)
    await t.turn([RENAME])
    expect(outputs(t.api)[0]).toBe(
      'Error: writing src/b.ts failed: disk full. The rename was written to 1 of 2 files (src/a.ts); the rest are unchanged, and the row can revert what was written',
    )
    expect(finished(t.events)[0]).toMatchObject({
      status: 'failed',
      patchSummary: { files: 1, added: 1, removed: 1 },
    })
  })

  it('refuses a rename it cannot plan before any card, and Stop ends a call that hangs', async () => {
    const t = await start({ service: { definitions: () => new Promise(() => undefined) } })
    await t.turn([RENAME])
    expect(t.events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(outputs(t.api)[0]).toContain('no language service answered for src/a.ts')
    t.api.script({
      calls: [{ name: 'find_definition', arguments: '{"symbol":"greet","path":"src/b.ts"}' }],
    })
    await t.session.sendTurn([{ type: 'text', text: 'hang' }])
    await stopOnceAsked(t, 'definitions', 2)
    expect(t.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'cancelled',
    })
  })

  it('pins the repo map in the prompt once per session while the setting is on', async () => {
    let isOn = true
    const t = await start({
      isRepoMapOn: () => isOn,
      service: {
        workspace: (query) =>
          Promise.resolve(query === 'greet' ? [sym('greet', KIND.function, A, 0, 16)] : []),
      },
    })
    await t.turn([])
    await t.turn([])
    const [first, second] = t.api.responseBodies().map((body) => String(body['instructions']))
    expect(first).toContain('# Repo map')
    expect(first).toContain('src/a.ts\n  1: function greet')
    expect(second).toBe(first)
    expect(t.service?.asked.filter((call) => call === 'workspace greet')).toHaveLength(1)
    isOn = false
    await t.turn([])
    expect(String(t.api.responseBodies().at(-1)?.['instructions'])).not.toContain('# Repo map')
    // A Stop while the map is being made ends the turn at once; the next makes it again.
    let isStuck = true
    const stopped = await start({
      isRepoMapOn: () => true,
      service: {
        workspace: (query) =>
          isStuck
            ? new Promise(() => undefined)
            : Promise.resolve(query === 'greet' ? [sym('greet', KIND.function, A, 0, 16)] : []),
      },
    })
    await stopped.session.sendTurn([{ type: 'text', text: 'go' }])
    await stopOnceAsked(stopped, 'workspace')
    isStuck = false
    stopped.api.script({ text: 'done' })
    await stopped.session.sendTurn([{ type: 'text', text: 'again' }])
    await vi.waitFor(() => {
      expect(stopped.events.filter((event) => event.type === 'turnCompleted')).toHaveLength(2)
    })
    expect(stopped.events.find((event) => event.type === 'turnCompleted')).toMatchObject({
      terminal: 'cancelled',
    })
    expect(String(stopped.api.responseBodies().at(-1)?.['instructions'])).toContain('# Repo map')
    // No language service: tried on three turns at most, never pinned empty.
    const quiet = await start({
      isRepoMapOn: () => true,
      service: { workspace: () => Promise.resolve([]) },
    })
    for (let index = 0; index < 4; index += 1) {
      await quiet.turn([])
    }
    expect(String(quiet.api.responseBodies()[0]?.['instructions'])).not.toContain('# Repo map')
    expect(quiet.service?.asked.filter((call) => call.startsWith('workspace'))).toHaveLength(3)
  })

  it('makes the map again after a try that found nothing, and never in Restricted Mode', async () => {
    let isReady = false
    const t = await start({
      isRepoMapOn: () => true,
      service: {
        workspace: (query) =>
          Promise.resolve(
            isReady && query === 'greet' ? [sym('greet', KIND.function, A, 0, 16)] : [],
          ),
      },
    })
    // The first turn finds no workspace symbols (TypeScript's project not loaded yet).
    await t.turn([])
    isReady = true
    await t.turn([])
    const [first, second] = t.api.responseBodies().map((body) => String(body['instructions']))
    expect(first).not.toContain('# Repo map')
    expect(second).toContain('# Repo map')
    const restricted = await start({ isRepoMapOn: () => true, isTrusted: false })
    await restricted.turn([])
    expect(String(restricted.api.responseBodies()[0]?.['instructions'])).not.toContain('# Repo map')
    expect(restricted.service?.asked.some((call) => call.startsWith('workspace'))).toBe(false)
  })

  it("gives a child task its parent's map and never makes one of its own", async () => {
    const t = await start({
      isRepoMapOn: () => true,
      hasSubagents: true,
      service: {
        workspace: (query) =>
          Promise.resolve(query === 'greet' ? [sym('greet', KIND.function, A, 0, 16)] : []),
      },
    })
    t.api.script(
      {
        calls: [
          { name: 'subagent_spawn', arguments: '{"role":"explorer","objective":"Map files"}' },
        ],
      },
      { text: 'done' },
    )
    await t.session.sendTurn([{ type: 'text', text: 'delegate' }])
    await vi.waitFor(() => {
      expect(
        t.api
          .responseBodies()
          .some((body) => JSON.stringify(body['input']).includes(MODEL_TEXT.subagentObjective)),
      ).toBe(true)
    })
    const child = t.api
      .responseBodies()
      .find((body) => JSON.stringify(body['input']).includes(MODEL_TEXT.subagentObjective))
    expect(String(child?.['instructions'])).toContain('src/a.ts\n  1: function greet')
    expect(t.service?.asked.filter((call) => call === 'workspace greet')).toHaveLength(1)
  })
})
