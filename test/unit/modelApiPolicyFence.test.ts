// The dispatcher's live policy fence (M78, the lead's choke-point decisions
// after RV78f and RV78g): every tool the dispatcher knows by name, and the
// external ones (an MCP server's, the IDE's), run through the host with the
// call's own I/O held while a file deny, a mode change or a trust change
// lands. The outcome is refused, and nothing the call brought back reaches
// any request. Each row runs again with a deny on a file the call never
// touches: an outcome that names every file it carries is delivered, one that
// cannot (a command's, a server's, a child's) is refused. A tool the
// dispatcher learns fails the first case until it has a row here.

import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { MODEL_API_MODEL_TEXT, type PaidFeature } from '../../src/shared/constants'
import { ModelApiHost, type ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import {
  classifiedToolNames,
  toolDefinitions,
  type ToolDefinitionOptions,
  type ToolIo,
} from '../../src/core/backends/modelapi/tools'
import type { VerifyHooks } from '../../src/core/backends/modelapi/verifyLoop'
import type { LanguageServiceHost } from '../../src/core/codeIntel/languageService'
import type { McpTool } from '../../src/core/mcp'
import type { PermissionSettings } from '../../src/core/permissionSettings'
import type { WebFetcher } from '../../src/core/web/webFetch'
import { memoryContextIo } from './helpers/fakeContextIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeLanguageService, KIND, loc, renamed, sym } from './helpers/fakeLanguageService'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { memoryStoreOver } from './helpers/fakeMemoryIo'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  type ScriptedReply,
  TINY_PNG_BASE64,
} from './helpers/fakeModelApi'
import { disabledPaidFeatures } from './helpers/fakePaidFeatures'
import { heldShellToolIo } from './helpers/fakeToolIo'
import { pdfFixture } from './helpers/pdfFixture'

const ROOT = '/ws'
const MARKER = 'M78-DISPATCH-FENCE-MARKER'
const A = `${ROOT}/src/a.ts`
const B = `${ROOT}/src/b.ts`
const LISTED = `listed-${MARKER}.txt`
const PNG = Buffer.concat([Buffer.from(TINY_PNG_BASE64, 'base64'), Buffer.from(MARKER)])
const PDF = pdfFixture(1)
const MCP_TOOL = 'mcp__docs__lookup'
const IDE_TOOL = 'mcp__ide__getDiagnostics'
const CHILD = 'subagent-1'
// A file no call reads: a deny on it moves only the file policy's revision.
const ELSEWHERE = 'elsewhere/never-read.txt'
// What a child's reply quotes: its parent's model may see it only while the policy stands.
const CHILD_QUOTE = `child read ${MARKER}`
const FILES: Readonly<Record<string, string>> = {
  'private.txt': `needle ${MARKER}\n`,
  'notes.txt': `before ${MARKER}\n`,
  [LISTED]: 'listed\n',
  'src/a.ts': `export function greet() { return '${MARKER}' }\n`,
  'src/b.ts': "import { greet } from './a'\ngreet()\n",
  '.agents/memory/note.md': `keep ${MARKER}\n`,
  '.agents/skills/deploy/SKILL.md': `---\nname: deploy\ndescription: Ship it\n---\n\n${MARKER}\n`,
}
const NO_RULES: PermissionSettings = {
  commandRules: [],
  profiles: {},
  profile: '',
  repositoryRules: undefined,
}
const PAID: ReadonlySet<PaidFeature> = new Set(['imageGeneration', 'subagents'])
const CHECK = { name: 'test', command: 'npm test' }

/** One held I/O: the call waits in it, once, until the test has landed its change. */
function gate() {
  const entered = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  let isArmed = true
  return {
    entered: entered.promise,
    released: released.promise,
    hold: async (): Promise<void> => {
      if (!isArmed) return
      isArmed = false
      entered.resolve(undefined)
      await released.promise
    },
    release: () => {
      released.resolve(undefined)
    },
  }
}
type Gate = ReturnType<typeof gate>

/** Where a call's I/O is held: its file, its process, its request, its server, its user. */
type HoldPoint =
  | 'readFile'
  | 'readBytes'
  | 'listFiles'
  | 'searchFiles'
  | 'afterWrite'
  | 'realPath'
  | 'imageFill'
  | 'imageReserve'
  | 'memoryRead'
  | 'memoryAfterWrite'
  | 'service'
  | 'mcp'
  | 'ide'
  | 'fetch'
  | 'shell'
  | 'question'
  | 'childReply'

type Hold =
  | { readonly at: HoldPoint; readonly path?: string }
  /**
   * A call with no await of its own after admission: the change lands in
   * the listener of the event it emits there (its panel output).
   */
  | { readonly at: 'event'; readonly when: (event: AgentEvent) => boolean }
  /** `get_goal`: the clock it reads is its one input after admission. */
  | { readonly at: 'clock' }
  /**
   * No I/O and no callback between its admission and the fence: nothing can
   * race it. Checked: no fake I/O advances between its row's start and end.
   */
  | { readonly at: 'none'; readonly reason: string }

type Change =
  | { readonly kind: 'deny'; readonly path: string }
  | { readonly kind: 'forbid' }
  | { readonly kind: 'mode'; readonly mode: string }
  | { readonly kind: 'trust' }

interface Call {
  readonly name: string
  readonly args: unknown
}

interface FenceCase {
  /** The tool as the dispatcher knows it. */
  readonly tool: string
  readonly variant?: string
  readonly args: unknown
  /** Calls made first in the same round (the child a subagent tool needs). */
  readonly before?: readonly Call[]
  /** Replies before the parent's last (a child's). */
  readonly replies?: readonly ScriptedReply[]
  readonly mode?: string
  readonly platform?: NodeJS.Platform
  readonly hold: Hold
  readonly change: Change
  /** What must reach no request: the marker unless said; null where the outcome carries only what the model sent. */
  readonly leak?: string | null
  /** The outcome names every file it carries (`touched.complete`): a deny elsewhere leaves it. */
  readonly isComplete?: true
  /** Refused before the image request: no request is made and nothing is billed. */
  readonly isEgress?: true
}

const spawn: Call = {
  name: 'subagent_spawn',
  args: { role: 'worker', objective: 'Finish the task' },
}
const waitForChild: Call = { name: 'subagent_wait', args: { subagent_id: CHILD, timeout_ms: 5000 } }
const goalCreation: Call = { name: 'create_goal', args: { objective: 'Ship it' } }
const isChildRow = (event: AgentEvent) =>
  (event.type === 'itemStarted' || event.type === 'itemUpdated') && event.item.kind === 'subagent'
const isChildUpdated = (event: AgentEvent) =>
  event.type === 'itemUpdated' && event.item.kind === 'subagent'
const isGoalChanged = (event: AgentEvent) => event.type === 'goalChanged'
const at = (path: string) => ({ path })

/**
 * A call that controls a finished child: it emits the child's row update
 * and has no await of its own after admission, so the change lands there.
 */
function childControl(tool: string, args: unknown): FenceCase {
  return {
    tool,
    args,
    before: [spawn, waitForChild],
    replies: [{ text: 'child done' }],
    hold: { at: 'event', when: isChildUpdated },
    change: { kind: 'trust' },
    // The wait before it delivered the child's reply, as it should.
    leak: null,
  }
}

const CASES: readonly FenceCase[] = [
  {
    tool: 'read_file',
    args: { path: 'private.txt' },
    hold: { at: 'readFile', ...at('private.txt') },
    change: { kind: 'deny', path: 'private.txt' },
    isComplete: true,
  },
  {
    tool: 'read_file',
    variant: 'an image',
    args: { path: 'photo.png' },
    hold: { at: 'readBytes' },
    change: { kind: 'deny', path: 'photo.png' },
    leak: PNG.toString('base64'),
    isComplete: true,
  },
  {
    tool: 'read_file',
    variant: 'a PDF',
    args: { path: 'doc.pdf' },
    hold: { at: 'readBytes' },
    change: { kind: 'deny', path: 'doc.pdf' },
    leak: Buffer.from(PDF).toString('base64'),
    isComplete: true,
  },
  {
    tool: 'list_files',
    args: {},
    hold: { at: 'listFiles' },
    change: { kind: 'deny', path: LISTED },
    isComplete: true,
  },
  {
    tool: 'search',
    args: { pattern: 'needle' },
    hold: { at: 'searchFiles' },
    change: { kind: 'deny', path: 'private.txt' },
    isComplete: true,
  },
  {
    tool: 'write_file',
    args: { path: 'fresh.txt', content: 'hello' },
    hold: { at: 'afterWrite', ...at('fresh.txt') },
    change: { kind: 'deny', path: 'fresh.txt' },
    leak: null,
    isComplete: true,
  },
  {
    tool: 'edit_file',
    args: { path: 'notes.txt', find: 'before', replace: 'after' },
    hold: { at: 'afterWrite', ...at('notes.txt') },
    change: { kind: 'deny', path: 'notes.txt' },
    // The model hears it edited the file; the file's text is on the row only.
    leak: null,
    isComplete: true,
  },
  {
    tool: 'edit_file',
    variant: 'then_run',
    args: { path: 'notes.txt', find: 'before', replace: 'after', then_run: 'npm test' },
    // The command's output joins the edit's: a deny anywhere refuses it.
    hold: { at: 'shell' },
    change: { kind: 'deny', path: ELSEWHERE },
  },
  {
    tool: 'bash',
    args: { command: 'npm test' },
    hold: { at: 'shell' },
    change: { kind: 'forbid' },
  },
  {
    tool: 'powershell',
    platform: 'win32',
    args: { command: 'npm test' },
    hold: { at: 'shell' },
    change: { kind: 'forbid' },
  },
  {
    tool: 'run_checks',
    args: { paths: ['private.txt'] },
    hold: { at: 'shell' },
    change: { kind: 'deny', path: 'private.txt' },
  },
  {
    tool: 'ask_user',
    args: {
      questions: [
        {
          id: 'q',
          header: 'Colour',
          question: 'Which?',
          selection: { mode: 'single' },
          options: [{ label: 'Red' }],
        },
      ],
    },
    hold: { at: 'question' },
    change: { kind: 'trust' },
  },
  {
    tool: 'todo_write',
    args: { items: [{ text: 'Ship it', status: 'pending' }] },
    hold: { at: 'event', when: (event) => event.type === 'todoChanged' },
    change: { kind: 'trust' },
    leak: null,
  },
  {
    tool: 'read_skill',
    args: { id: 'deploy' },
    hold: { at: 'realPath', ...at('SKILL.md') },
    change: { kind: 'trust' },
    isComplete: true,
  },
  {
    tool: 'generate_image',
    args: { prompt: 'a cat', path: 'cat.png' },
    hold: { at: 'imageFill' },
    change: { kind: 'deny', path: 'cat.png' },
    isComplete: true,
  },
  {
    tool: 'generate_image',
    variant: 'egress',
    args: { prompt: 'a cat', path: 'cat.png' },
    hold: { at: 'imageReserve' },
    change: { kind: 'deny', path: 'cat.png' },
    isComplete: true,
    isEgress: true,
  },
  {
    tool: 'edit_image',
    args: { prompt: 'brighten', images: ['photo.png'], path: 'edited.png' },
    hold: { at: 'imageFill' },
    change: { kind: 'deny', path: 'photo.png' },
    isComplete: true,
  },
  {
    tool: 'edit_image',
    variant: 'egress',
    args: { prompt: 'brighten', images: ['photo.png'], path: 'edited.png' },
    hold: { at: 'imageReserve' },
    change: { kind: 'deny', path: 'photo.png' },
    // The source's bytes, as the request would carry them.
    leak: PNG.toString('base64'),
    isComplete: true,
    isEgress: true,
  },
  {
    tool: 'read_memory',
    args: { scope: 'project', path: 'note.md' },
    hold: { at: 'memoryRead', ...at('note.md') },
    change: { kind: 'deny', path: '.agents/memory/note.md' },
    isComplete: true,
  },
  {
    tool: 'add_memory',
    args: { scope: 'project', path: 'fresh.md', content: 'remember this' },
    hold: { at: 'memoryAfterWrite', ...at('fresh.md') },
    change: { kind: 'deny', path: '.agents/memory/fresh.md' },
    leak: null,
    isComplete: true,
  },
  {
    tool: 'edit_memory',
    args: { scope: 'project', path: 'note.md', old_str: 'keep', new_str: 'kept' },
    hold: { at: 'memoryAfterWrite', ...at('note.md') },
    change: { kind: 'deny', path: '.agents/memory/note.md' },
    // Muse Code's answer to an edit names the note, not its text.
    leak: null,
    isComplete: true,
  },
  {
    tool: 'create_goal',
    args: { objective: 'Ship it' },
    hold: { at: 'event', when: isGoalChanged },
    change: { kind: 'trust' },
    leak: null,
  },
  {
    tool: 'get_goal',
    args: {},
    before: [goalCreation],
    hold: { at: 'clock' },
    change: { kind: 'trust' },
    leak: null,
  },
  {
    tool: 'update_goal',
    args: { status: 'complete' },
    before: [goalCreation],
    hold: { at: 'event', when: isGoalChanged },
    change: { kind: 'trust' },
    leak: null,
  },
  {
    tool: 'report_progress',
    args: { current_work: 'Tests', next_work: 'Docs', percent_complete: 50 },
    before: [goalCreation],
    hold: { at: 'event', when: isGoalChanged },
    change: { kind: 'trust' },
    leak: null,
  },
  {
    tool: 'subagent_spawn',
    args: spawn.args,
    // The child's request and the parent's next one share these text replies;
    // the child's quote must not reach the parent once trust is gone.
    replies: [{ text: CHILD_QUOTE }, { text: 'done' }],
    hold: { at: 'event', when: isChildRow },
    change: { kind: 'trust' },
  },
  {
    tool: 'subagent_wait',
    args: waitForChild.args,
    before: [spawn],
    // The child quotes private.txt (RV78g P3-5): its wait and its drained
    // result are both refused once that file is denied.
    hold: { at: 'childReply' },
    change: { kind: 'deny', path: 'private.txt' },
  },
  {
    tool: 'subagent_status',
    args: {},
    before: [spawn, waitForChild],
    replies: [{ text: 'child done' }],
    hold: {
      at: 'none',
      reason:
        "answered from the parent's own record of its children: no await or callback between its admission and the fence",
    },
    change: { kind: 'trust' },
    leak: null,
  },
  childControl('subagent_read_result', { subagent_id: CHILD }),
  childControl('subagent_send_message', { subagent_id: CHILD, message: 'one more thing' }),
  childControl('subagent_cancel', { subagent_id: CHILD }),
  {
    tool: 'recall_output',
    args: { id: 'never-packed' },
    hold: {
      at: 'none',
      reason:
        "pages the session's own packed output back: no await or callback between its admission and the fence",
    },
    change: { kind: 'trust' },
    leak: null,
  },
  {
    tool: 'web_fetch',
    args: { url: 'https://docs.example.com/guide' },
    hold: { at: 'fetch' },
    // Bypass ran it with no question; Auto would ask.
    change: { kind: 'mode', mode: 'onRequest' },
  },
  {
    tool: 'find_definition',
    args: { path: 'src/a.ts', line: 1, column: 17 },
    hold: { at: 'service' },
    change: { kind: 'deny', path: 'src/a.ts' },
  },
  {
    tool: 'find_references',
    args: { path: 'src/a.ts', line: 1, column: 17 },
    hold: { at: 'service' },
    change: { kind: 'deny', path: 'src/a.ts' },
  },
  {
    tool: 'workspace_symbols',
    args: { query: 'greet' },
    // The search names its files first; the file read after is its I/O.
    hold: { at: 'readFile', ...at('src/a.ts') },
    change: { kind: 'deny', path: 'src/a.ts' },
    leak: null,
  },
  {
    tool: 'document_symbols',
    args: { path: 'src/a.ts' },
    hold: { at: 'service' },
    change: { kind: 'deny', path: 'src/a.ts' },
    leak: null,
  },
  {
    tool: 'hover',
    args: { path: 'src/a.ts', line: 1, column: 17 },
    hold: { at: 'service' },
    change: { kind: 'deny', path: 'src/a.ts' },
  },
  {
    tool: 'call_hierarchy',
    args: { path: 'src/a.ts', line: 1, column: 17 },
    hold: { at: 'service' },
    change: { kind: 'deny', path: 'src/a.ts' },
    leak: null,
  },
  {
    tool: 'repo_map',
    args: {},
    hold: { at: 'service' },
    change: { kind: 'deny', path: 'src/a.ts' },
    leak: null,
  },
  {
    tool: 'rename_symbol',
    args: { path: 'src/a.ts', line: 1, column: 17, new_name: 'welcome' },
    // The first file written is denied: the second is still written, and the
    // rename's outcome names the first.
    hold: { at: 'afterWrite', ...at('src/a.ts') },
    change: { kind: 'deny', path: 'src/a.ts' },
    leak: null,
    isComplete: true,
  },
  {
    tool: MCP_TOOL,
    args: { query: 'greet' },
    hold: { at: 'mcp' },
    change: { kind: 'mode', mode: 'denyUnmatched' },
  },
  {
    tool: IDE_TOOL,
    args: {},
    hold: { at: 'ide' },
    change: { kind: 'trust' },
  },
]

/** A fixture with nothing held, for a flow one held call cannot show. */
const UNHELD: FenceCase = {
  tool: 'subagent_status',
  args: {},
  hold: { at: 'none', reason: 'nothing is held' },
  change: { kind: 'trust' },
}

function label(c: FenceCase): string {
  return c.variant === undefined ? c.tool : `${c.tool} (${c.variant})`
}

/** The language services, each answer held at the case's gate when it holds there. */
function heldService(service: LanguageServiceHost, isHeld: boolean, held: Gate, count: () => void) {
  const after = async <T>(answer: () => Promise<T>): Promise<T> => {
    count()
    if (isHeld) await held.hold()
    return await answer()
  }
  const host: LanguageServiceHost = {
    open: (path) => after(() => service.open(path)),
    definitions: (path, position) => after(() => service.definitions(path, position)),
    references: (path, position) => after(() => service.references(path, position)),
    hover: (path, position) => after(() => service.hover(path, position)),
    documentSymbols: (path) => after(() => service.documentSymbols(path)),
    workspaceSymbols: (query) => after(() => service.workspaceSymbols(query)),
    callHierarchy: (path, position, direction) =>
      after(() => service.callHierarchy(path, position, direction)),
    rename: (path, position, newName) => service.rename(path, position, newName),
    libraryRoots: () => service.libraryRoots(),
  }
  return host
}

/** A host with every tool the dispatcher knows, the case's I/O held at its gate. */
function fixture(c: FenceCase) {
  const state = { settings: NO_RULES, isTrusted: true }
  const held = gate()
  const point = c.hold.at
  const target = 'path' in c.hold ? c.hold.path : undefined
  const isAt = (where: HoldPoint, path: string) =>
    point === where && (target === undefined || path.endsWith(target))
  // Every I/O any tool can make, counted: a row that claims none is checked.
  const counter = { io: 0 }
  const count = () => {
    counter.io += 1
  }
  const base = heldShellToolIo(FILES, ROOT)
  base.binaries.set(`${ROOT}/photo.png`, PNG)
  base.binaries.set(`${ROOT}/doc.pdf`, PDF)
  const io: typeof base = {
    ...base,
    readFile: async (...args: Parameters<ToolIo['readFile']>) => {
      count()
      if (isAt('readFile', args[0])) await held.hold()
      return await base.readFile(...args)
    },
    readBytes: async (...args: Parameters<ToolIo['readBytes']>) => {
      count()
      if (isAt('readBytes', args[0])) await held.hold()
      return await base.readBytes(...args)
    },
    listFiles: async () => {
      count()
      if (point === 'listFiles') await held.hold()
      return await base.listFiles()
    },
    searchFiles: async (job) => {
      count()
      if (point === 'searchFiles') await held.hold()
      return await base.searchFiles(job)
    },
    writeFile: async (...args: Parameters<ToolIo['writeFile']>) => {
      count()
      await base.writeFile(...args)
      if (isAt('afterWrite', args[0])) await held.hold()
    },
    realPath: async (path) => {
      count()
      if (isAt('realPath', path)) await held.hold()
      return await base.realPath(path)
    },
    runShell: async (...args: Parameters<ToolIo['runShell']>) => {
      count()
      return await base.runShell(...args)
    },
    reserveFile: async (...args: Parameters<ToolIo['reserveFile']>) => {
      count()
      // Before the image request: its egress fence judges what lands here.
      if (point === 'imageReserve') await held.hold()
      const reservation = await base.reserveFile(...args)
      return {
        fill: async (bytes) => {
          const step = await reservation.fill(bytes)
          if (point === 'imageFill') await held.hold()
          return step
        },
        release: () => reservation.release(),
      }
    },
  }
  const memory = memoryStoreOver(io.files, {
    beforeRead: async (path) => {
      count()
      if (isAt('memoryRead', path)) await held.hold()
    },
    afterWrite: async (path) => {
      count()
      if (isAt('memoryAfterWrite', path)) await held.hold()
    },
  }).store
  const api = fakeModelApi()
  api.images.push({ revisedPrompt: MARKER })
  const mcp = fakeMcpSource([{ server: 'docs', tool: 'lookup' }])
  mcp.outcomes = [{ output: MARKER, visibleOutput: MARKER }]
  if (point === 'mcp') mcp.gate = held.released
  const ide: McpTool = {
    name: 'getDiagnostics',
    description: 'Problems',
    inputSchema: { type: 'object' },
    call: async () => {
      count()
      if (point === 'ide') await held.hold()
      return `No diagnostics. ${MARKER}`
    },
  }
  const webFetch: WebFetcher = async (url) => {
    count()
    if (point === 'fetch') await held.hold()
    const text = `Fetched ${url}. ${MARKER}`
    return {
      kind: 'page',
      page: { url, finalUrl: url, status: 200, type: 'text/html', bytes: text.length },
      text,
    }
  }
  const service = fakeLanguageService({
    files: io.files,
    definitions: () => [loc(A, 0, 16)],
    references: () => [loc(A, 0, 16)],
    hover: () => [`greet() returns ${MARKER}`],
    symbols: { [A]: [sym('greet', KIND.function, A, 0, 16)] },
    workspace: [sym('greet', KIND.function, A, 0, 16)],
    calls: () => ({
      item: sym('greet', KIND.function, A, 0, 16),
      calls: [{ symbol: sym('caller', KIND.function, B, 1, 0), ranges: [loc(B, 1, 0).range] }],
      otherItems: 0,
    }),
    rename: () =>
      Promise.resolve({
        files: [renamed(A, 0, 16), renamed(B, 0, 9), renamed(B, 1, 0)],
        fileOperations: 'none' as const,
      }),
  })
  const verify: VerifyHooks = {
    isDiagnosticsOn: () => false,
    checkCommands: () => [CHECK],
    isFormatOnEdit: () => false,
    diagnosticsAfterEdit: () => Promise.resolve([]),
    formatAfterEdit: () => Promise.resolve(undefined),
  }
  const clock: { onRead?: (() => void) | undefined } = {}
  const paidUses: PaidFeature[] = []
  let time = 1_000_000
  let ids = 0
  const log = new FakeLogOutputChannel()
  const host = new ModelApiHost({
    ...disabledPaidFeatures,
    isPaidFeatureOn: (feature) => PAID.has(feature),
    allowsPaidUse: () => Promise.resolve(true),
    notePaidUse: (feature) => {
      paidUses.push(feature)
    },
    client: fakeModelApiClient(api, log),
    log,
    workspaceRoot: ROOT,
    platform: c.platform ?? 'linux',
    io,
    contextIo: memoryContextIo(io.files),
    newId: () => {
      ids += 1
      return `f${String(ids)}`
    },
    now: () => {
      const read = clock.onRead
      clock.onRead = undefined
      read?.()
      time += 1000
      return time
    },
    // The live state each case changes.
    isWorkspaceTrusted: () => state.isTrusted,
    permissionSettings: () => state.settings,
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    sessionBudgetUsd: () => 0,
    showReplyUsage: () => false,
    promptCacheRetention: () => 'in_memory',
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(false),
    memory,
    mcpServers: mcp,
    ideTools: [ide],
    webFetch,
    codeIntel: heldService(service, point === 'service', held, count),
    // Packing (M73) offers recall_output: only its row packs.
    observationPacking: () => c.tool === 'recall_output',
    // The checks would run after every edit: only the case that runs them has them.
    ...(c.tool === 'run_checks' && { verify }),
    loadHooks: () => Promise.resolve([]),
  })
  // The I/O so far: the fakes' counter, the MCP server's calls and every request.
  const ioCount = () => counter.io + mcp.calls.length + api.requests.length
  return { api, io, host, state, held, clock, mcp, paidUses, ioCount }
}
type Fixture = ReturnType<typeof fixture>

/** The change, landed while the call is held. */
function land(change: Change, f: Fixture, setMode: (mode: string) => Promise<void>): void {
  switch (change.kind) {
    case 'deny': {
      f.state.settings = { ...NO_RULES, repositoryRules: { denyRead: [change.path] } }
      return
    }
    case 'forbid': {
      f.state.settings = {
        ...NO_RULES,
        repositoryRules: {
          commandRules: [{ pattern: ['npm', 'test'], decision: 'forbid', match: ['npm test'] }],
        },
      }
      return
    }
    case 'mode': {
      void setMode(change.mode)
      return
    }
    case 'trust': {
      f.state.isTrusted = false
    }
  }
}

/** What the model was given for `callId`, from the latest request that carries it. */
function outputOf(f: Fixture, callId: string): string | undefined {
  for (const body of f.api.responseBodies().toReversed()) {
    const input = body['input']
    if (!Array.isArray(input)) continue
    for (const item of input as readonly Record<string, unknown>[]) {
      if (item['type'] === 'function_call_output' && item['call_id'] === callId) {
        return JSON.stringify(item['output'])
      }
    }
  }
  return undefined
}

/** The I/O count as the case's own row started and as it completed. */
interface IoAround {
  start?: number
  end?: number
}

async function runCase(
  c: FenceCase,
): Promise<{ readonly f: Fixture; readonly ioAround: IoAround }> {
  const f = fixture(c)
  const ioAround: IoAround = {}
  const session = (await f.host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: c.mode ?? 'allowAll',
  })) as ModelApiSession
  const setMode = (mode: string) => session.setApprovalMode(mode)
  // The parent's own turn: a child's events are not its end.
  let turnId: string | undefined
  let isDone = false
  let isArmed = false
  const { hold } = c
  session.onEvent((event) => {
    if (event.type === 'turnStarted') turnId ??= event.turnId
    if (event.type === 'turnCompleted' && event.turnId === turnId) isDone = true
    if (event.type === 'itemCompleted' && event.item.tool === c.tool) {
      ioAround.end = f.ioCount()
    }
    if (event.type === 'itemStarted' && event.item.kind === 'toolCall') {
      isArmed = event.item.tool === c.tool
      if (isArmed) ioAround.start = f.ioCount()
      if (isArmed && hold.at === 'clock') {
        f.clock.onRead = () => {
          land(c.change, f, setMode)
        }
      }
      return
    }
    if (isArmed && hold.at === 'event' && hold.when(event)) {
      isArmed = false
      land(c.change, f, setMode)
    }
    if (hold.at !== 'question' || event.type !== 'questionRequested') return
    // The user answers the held question after the change: their words are its outcome.
    land(c.change, f, setMode)
    void session.clarifyQuestions(event.userInputId, MARKER)
  })
  const calls = [...(c.before ?? []), { name: c.tool, args: c.args }].map((call, index, all) => ({
    name: call.name,
    arguments: JSON.stringify(call.args),
    callId: index === all.length - 1 ? 'fenced' : `before${String(index)}`,
  }))
  // The child's reply, held while its parent waits for it.
  const childReplies: ScriptedReply[] =
    hold.at === 'childReply'
      ? [
          {
            text: CHILD_QUOTE,
            onRequest: () => {
              void f.held.hold()
            },
            hold: f.held.released,
          },
        ]
      : []
  f.api.script({ calls }, ...childReplies, ...(c.replies ?? []), { text: 'done' })
  await session.sendTurn([{ type: 'text', text: 'go' }])
  switch (hold.at) {
    case 'shell': {
      await vi.waitFor(() => {
        expect(f.io.runs).toHaveLength(1)
      })
      land(c.change, f, setMode)
      f.io.runs[0]?.finish({ stdout: MARKER })
      break
    }
    case 'mcp': {
      await vi.waitFor(() => {
        expect(f.mcp.calls).toHaveLength(1)
      })
      land(c.change, f, setMode)
      f.held.release()
      break
    }
    case 'event':
    case 'clock':
    case 'question':
    case 'none': {
      break
    }
    default: {
      await f.held.entered
      land(c.change, f, setMode)
      f.held.release()
    }
  }
  await vi.waitFor(() => {
    expect(isDone).toBe(true)
  })
  await session.settled()
  return { f, ioAround }
}

/**
 * The row again with a deny on a file the call never touches (RV78g): only
 * the file policy's revision moves. A complete outcome is delivered; an
 * opaque one is refused.
 */
function elsewhereRow(c: FenceCase): FenceCase {
  return {
    ...c,
    variant: c.variant === undefined ? 'deny elsewhere' : `${c.variant}, deny elsewhere`,
    change: { kind: 'deny', path: ELSEWHERE },
  }
}

const HELD = CASES.filter((c) => c.hold.at !== 'none')
// Rows whose change already is a deny elsewhere need no second run.
const ELSEWHERE_ROWS = HELD.filter(
  (c) => !(c.change.kind === 'deny' && c.change.path === ELSEWHERE),
).map((c) => elsewhereRow(c))

/** Asserts the row's outcome was refused and nothing it brought back reached a request. */
function expectRefused(c: FenceCase, f: Fixture): void {
  expect(outputOf(f, 'fenced')).toContain(
    `Error: ${c.tool} ${MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange}`,
  )
  const leak = c.leak === undefined ? MARKER : c.leak
  if (leak !== null) {
    expect(JSON.stringify(f.api.requests)).not.toContain(leak)
  }
}

const ALL_TOOLS: ToolDefinitionOptions = {
  hasShell: true,
  hasSkills: true,
  hasImageGeneration: true,
  hasSubagents: true,
  hasMemory: true,
  hasPackedRecall: true,
  checks: [CHECK],
  hasWebFetch: true,
  hasCodeIntel: true,
}

describe("the dispatcher's live policy fence over every tool (M78)", () => {
  it('has a case for every tool the dispatcher knows by name, and the external ones', () => {
    expect(new Set(CASES.map((c) => c.tool))).toEqual(
      new Set([...classifiedToolNames(), MCP_TOOL, IDE_TOOL]),
    )
    // Every tool a model is offered is one the dispatcher knows, on each platform.
    for (const platform of ['linux', 'win32'] as const) {
      for (const definition of toolDefinitions(platform, ALL_TOOLS)) {
        expect(classifiedToolNames()).toContain(definition.name)
      }
    }
    // A call nothing can race says why.
    for (const c of CASES) {
      if (c.hold.at === 'none') expect(c.hold.reason).not.toBe('')
    }
  })

  it.each(HELD.map((c) => [label(c), c] as const))(
    '%s: refused once the change lands, nothing it brought back sent',
    async (_label, c) => {
      const { f } = await runCase(c)
      try {
        expectRefused(c, f)
        if (c.isEgress === true) {
          // Refused before its request (RV78g P3-4): nothing sent, nothing billed.
          expect(f.api.requests.filter((request) => request.path.startsWith('/images'))).toEqual([])
          expect(f.paidUses).toEqual([])
        }
      } finally {
        await f.host.close()
      }
    },
  )

  it.each(ELSEWHERE_ROWS.map((c) => [label(c), c] as const))(
    '%s: a complete outcome is delivered, an opaque one refused',
    async (_label, c) => {
      const { f } = await runCase(c)
      try {
        if (c.isComplete !== true) {
          expectRefused(c, f)
          return
        }
        expect(outputOf(f, 'fenced')).not.toContain(MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange)
        // What it read did reach the model: the deny elsewhere left it.
        const delivered = c.leak === undefined ? MARKER : c.leak
        if (delivered !== null) {
          expect(JSON.stringify(f.api.requests)).toContain(delivered)
        }
      } finally {
        await f.host.close()
      }
    },
  )

  it.each(CASES.filter((c) => c.hold.at === 'none').map((c) => [label(c), c] as const))(
    '%s: makes no I/O between its admission and the fence, so it runs as admitted',
    async (_label, c) => {
      const { f, ioAround } = await runCase(c)
      try {
        expect(ioAround.start).toBeDefined()
        expect(ioAround.end).toBe(ioAround.start)
        const output = outputOf(f, 'fenced')
        expect(output).toBeDefined()
        expect(output).not.toContain(MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange)
      } finally {
        await f.host.close()
      }
    },
  )

  it("withholds a child's result drained after the file policy moved, outside any call (RV78g P1)", async () => {
    const { f, session, turnEnd } = await unheldSession()
    const childHold = Promise.withResolvers<undefined>()
    const childAsked = Promise.withResolvers<undefined>()
    f.api.script(
      {
        calls: [
          call('spawn', spawn),
          // A wait that times out at once: the child finishes after the parent's turn.
          call('wait', { name: 'subagent_wait', args: { subagent_id: CHILD, timeout_ms: 1 } }),
        ],
      },
      {
        text: CHILD_QUOTE,
        onRequest: () => {
          childAsked.resolve(undefined)
        },
        hold: childHold.promise,
      },
      { text: 'parent goes on' },
    )
    try {
      await turnEnd(await session.sendTurn([{ type: 'text', text: 'delegate' }]))
      await childAsked.promise
      f.state.settings = { ...NO_RULES, repositoryRules: { denyRead: ['private.txt'] } }
      childHold.resolve(undefined)
      await vi.waitFor(() => {
        expect(
          session.history().items.find((item) => item.kind === 'subagent')?.controlStatus,
        ).toBe('resultReady')
      })
      f.api.script({ text: 'fine' })
      await turnEnd(await session.sendTurn([{ type: 'text', text: 'and now?' }]))
      const sent = JSON.stringify(f.api.requests)
      expect(sent).not.toContain(MARKER)
      expect(sent).toContain(`${CHILD}: ${MODEL_API_MODEL_TEXT.subagentResultWithheld}`)
    } finally {
      childHold.resolve(undefined)
      await session.settled()
      await f.host.close()
    }
  })

  it("refuses a child's result in status and read_result once the policy moved since its spawn (RV78g P2-1)", async () => {
    const { f, session, turnEnd } = await unheldSession()
    // The deny lands after the wait, before the calls that read the result are let in.
    session.onEvent((event) => {
      if (event.type === 'itemCompleted' && event.item.tool === 'subagent_wait') {
        f.state.settings = { ...NO_RULES, repositoryRules: { denyRead: [ELSEWHERE] } }
      }
    })
    f.api.script(
      {
        calls: [
          call('spawn', spawn),
          call('wait', waitForChild),
          call('status', { name: 'subagent_status', args: {} }),
          call('read', { name: 'subagent_read_result', args: { subagent_id: CHILD } }),
        ],
      },
      { text: 'child done' },
      { text: 'done' },
    )
    try {
      await turnEnd(await session.sendTurn([{ type: 'text', text: 'delegate' }]))
      expect(outputOf(f, 'wait')).not.toContain(MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange)
      for (const [callId, tool] of [
        ['status', 'subagent_status'],
        ['read', 'subagent_read_result'],
      ] as const) {
        expect(outputOf(f, callId)).toContain(
          `Error: ${tool} ${MODEL_API_MODEL_TEXT.toolRefusedByPolicyChange}`,
        )
      }
    } finally {
      await session.settled()
      await f.host.close()
    }
  })
})

/** A scripted call of `made` with its own call id. */
function call(callId: string, made: Call) {
  return { name: made.name, arguments: JSON.stringify(made.args), callId }
}

/** A Bypass session on the fixture with nothing held, and a wait for one of its own turns' end. */
async function unheldSession() {
  const f = fixture(UNHELD)
  const session = (await f.host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })) as ModelApiSession
  const ended = new Set<string>()
  session.onEvent((event) => {
    if (event.type === 'turnCompleted') ended.add(event.turnId)
  })
  const turnEnd = async (submitted: { readonly turnId: string }) => {
    await vi.waitFor(() => {
      expect(ended.has(submitted.turnId)).toBe(true)
    })
  }
  return { f, session, turnEnd }
}
