// The team in the ACP agent's own sessions (M96b, RLF-ACPTEAM): a real
// ACP client drives the real agent over the real Model API host, and the
// real ACP team entry binds the real team host over a real git
// repository. Admission is the D227 two-model rule over the stored team
// in the agent data folder; progress rides task tool calls and the plan;
// the merge card is the editor's permission request carrying the real
// diff. No turn is sent: worker conversations stop at their start gate
// (a start that cannot complete is the worker's real failure), and the
// merge case restores a finished task the real end-of-task sequence
// committed, as a restart would find it.
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  cardFailureText,
  createAcpTeam,
  refusedLandingText,
  type AcpTeamDeps,
} from '../../src/acp/acpTeamEntry'
import { normalizeTeamPath } from '../../src/acp/teamContracts'
import type { createAcpAgent } from '../../src/acp/agent'
import {
  isAcpTeamRefusal,
  type AcpTeamPort,
  type AcpTeamSessionHandler,
} from '../../src/acp/teamPort'
import { teamJsonPath } from '../../src/core/team/teamConfig'
import {
  commitTaskBranch,
  publishTaskRef,
  resolveBaseCommit,
  startTeamWorkspace,
} from '../../src/core/team/teamWorkspaces'
import { configureResources } from '../../src/core/resources/admission'
import { workspaceKey } from '../../src/runtime/dataFolder'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { storedTeamSnapshotFile } from '../../src/runtime/teamSnapshotFile'
import { stderrLogger } from '../../src/runtime/stderrLog'
import {
  ACP_SESSIONS_SUBFOLDER,
  ACP_TEAM_BOARD_FILE,
  ACP_TEAM_STORAGE_FOLDER,
  TEAM_MODEL_TEXT,
  TREE_EXIT_WAIT_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { TeamSnapshot } from '../../src/shared/team'
import { createWindowIdentity } from '../../src/host/team/windowIdentity'
import { createLocalAcpAgent } from './helpers/acpLocalAgentDeps'
import { buildLander, startLander } from './helpers/teamLander'
import { realTeamGit, scratchTeamRepo } from './helpers/realTeamGit'

const log = stderrLogger(() => undefined, 'warn')
const ORCHESTRATOR = 'probe-custom/custom-model'
const WORKER = 'probe-offable/offable-model'
const TWO_GIB_AND_A_BYTE = 2 ** 31 + 1
const MODES = ['manual', 'bypassPermissions'] as const
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function scratch(prefix: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), prefix))
  folders.push(folder)
  return folder
}

/** Makes the file, empty, and hands its name on. */
function openAndClose(file: string): string {
  closeSync(openSync(file, 'w'))
  return file
}

/** The stored team the panel's Roles section would have written. */
function storedTeam(workerModel: string): TeamSnapshot {
  return {
    roles: [
      {
        role: 'engineering',
        workspace: 'own-branch',
        pool: [
          {
            id: 'e1',
            concurrent: 1,
            caps: [],
            agent: {
              kind: 'engine',
              agentId: 'probe-offable:offable-model',
              model: workerModel,
              pays: 'local',
            },
          },
        ],
      },
    ],
    intensity: 'balanced',
  }
}

function writeStoredTeam(dataFolder: string, cwd: string, snapshot: TeamSnapshot): void {
  const file = storedTeamSnapshotFile(dataFolder, cwd)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(snapshot))
}

/** A worker start the test holds at its gate, then fails as a refused start does. */
function heldStarts() {
  const gates: { reject: (error: Error) => void }[] = []
  return {
    gates,
    startWorker: () =>
      new Promise<never>((_resolve, reject) => {
        gates.push({ reject })
      }),
  }
}

function teamDeps(dataFolder: string, overrides: Partial<AcpTeamDeps> = {}): AcpTeamDeps {
  return {
    dataFolder,
    platform: process.platform,
    log,
    backendKind: 'modelApi',
    isTrusted: () => true,
    listWorkerModels: () => Promise.resolve([ORCHESTRATOR, WORKER]),
    startWorker: () => Promise.reject(new Error('no worker conversation in this suite')),
    paid: () => undefined,
    runGit: realTeamGit,
    ...overrides,
  }
}

/** The refusal sentence a request answered with (its error data), or undefined. */
async function errorOf(request: Promise<unknown>): Promise<string | undefined> {
  try {
    await request
  } catch (error: unknown) {
    if (error instanceof acp.RequestError && typeof error.data === 'string') return error.data
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

/** What the person read in these updates: the session's own sentences. */
function saidIn(updates: readonly acp.SessionUpdate[]): readonly string[] {
  return updates.flatMap((update) =>
    update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
      ? update.content.text
      : [],
  )
}

/** An editor in this mode whose person answers Merge; a Bypass session is never asked. */
function mergingEditor(mode: 'manual' | 'bypassPermissions', updates: acp.SessionUpdate[]) {
  return {
    mode: () => mode,
    sendUpdate: (update: acp.SessionUpdate) => {
      updates.push(update)
    },
    requestPermission: () =>
      Promise.resolve({ outcome: { outcome: 'selected' as const, optionId: 'merge' } }),
  }
}

/** The error a request failed with; one that succeeds fails the case. */
async function failureOf(request: Promise<unknown>): Promise<unknown> {
  try {
    await request
  } catch (error: unknown) {
    return error
  }
  throw new Error('expected this to fail')
}

/** What preparing a team session in this folder fails with. */
async function prepareFailure(dataFolder: string, repo: string): Promise<unknown> {
  const port = createAcpTeam(teamDeps(dataFolder), UI_TEXT, 'en')
  try {
    return await failureOf(port.prepareNew(repo, ORCHESTRATOR))
  } finally {
    await port.dispose()
  }
}

/** Polls one condition the product itself drives; a timeout is the failure. */
async function eventually(isDone: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000
  while (!isDone()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** The real agent + real Model API host, with or without the team port. */
function agentWithTeam(snapshot: TeamSnapshot | undefined, hasTeam: boolean) {
  const folder = scratch('acp-team-workspace-')
  const dataFolder = scratch('acp-team-data-')
  if (snapshot !== undefined) writeStoredTeam(dataFolder, folder, snapshot)
  let team: AcpTeamPort | undefined
  const { agent } = createLocalAcpAgent(folder, log, (rig, deps) => {
    team = hasTeam
      ? createAcpTeam(
          teamDeps(dataFolder, {
            listWorkerModels: async () => {
              const listed = await rig.host.listModels()
              return listed.map((model) => model.modelId)
            },
            paid: () => deps.paid,
          }),
          UI_TEXT,
          'en',
        )
      : undefined
    return team === undefined ? {} : { team }
  })
  return { agent, folder, team }
}

async function withEditor(
  agent: ReturnType<typeof createAcpAgent>,
  run: (
    editor: Parameters<Parameters<ReturnType<typeof acp.client>['connectWith']>[1]>[0],
  ) => Promise<void>,
): Promise<void> {
  await acp.client({ name: 'acp-team' }).connectWith(agent, async (editor) => {
    await editor.request('initialize', {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    await run(editor)
  })
}

type Editor = Parameters<Parameters<ReturnType<typeof acp.client>['connectWith']>[1]>[0]

/** One admission case: the agent for a stored team, its editor, its folder. */
async function admissionCase(
  snapshot: TeamSnapshot | undefined,
  hasTeam: boolean,
  run: (editor: Editor, folder: string) => Promise<void>,
): Promise<void> {
  const { agent, folder, team } = agentWithTeam(snapshot, hasTeam)
  try {
    await withEditor(agent, async (editor) => {
      await run(editor, folder)
    })
  } finally {
    await team?.dispose()
  }
}

describe('ACP team admission over the real agent', () => {
  // The first admitted session loads the team service and probes its
  // entries; pay that once here so no case carries the cold start.
  beforeAll(async () => {
    await admissionCase(storedTeam(WORKER), true, async (editor, folder) => {
      const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
      await editor.request('session/close', { sessionId: created.sessionId })
    })
  })

  it('refuses a new session without a second usable model', async () => {
    for (const snapshot of [undefined, storedTeam(ORCHESTRATOR)]) {
      await admissionCase(snapshot, true, async (editor, folder) => {
        const refusal = await errorOf(
          editor.request('session/new', { cwd: folder, mcpServers: [] }),
        )
        expect(refusal).toContain(UI_TEXT.teamNeedsSecondModel)
      })
    }
  })

  it('opens a team session, shows its state, and refuses a mid-session switch', async () => {
    await admissionCase(storedTeam(WORKER), true, async (editor, folder) => {
      const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
      const option = created.configOptions?.find((row) => row.id === 'team')
      expect(option).toMatchObject({ type: 'select', currentValue: 'on' })
      const refusal = await errorOf(
        editor.request('session/set_config_option', {
          sessionId: created.sessionId,
          configId: 'team',
          value: 'off',
        }),
      )
      expect(refusal).toContain(UI_TEXT.acpTeamFixedForSession)
      const again = await editor.request('session/set_config_option', {
        sessionId: created.sessionId,
        configId: 'team',
        value: 'on',
      })
      expect(again.configOptions.find((row) => row.id === 'team')).toMatchObject({
        currentValue: 'on',
      })
      await editor.request('session/close', { sessionId: created.sessionId })
    })
  })

  // D261: the refusal fallback as a session's own option, off until it says so.
  it('offers the refusal fallback on a team session, off by default, and takes on and off', async () => {
    await admissionCase(storedTeam(WORKER), true, async (editor, folder) => {
      const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
      expect(created.configOptions?.find((row) => row.id === 'refusalFallback')).toMatchObject({
        type: 'select',
        name: UI_TEXT.acpRefusalFallback,
        currentValue: 'off',
      })
      const turnedOn = await editor.request('session/set_config_option', {
        sessionId: created.sessionId,
        configId: 'refusalFallback',
        value: 'on',
      })
      expect(turnedOn.configOptions.find((row) => row.id === 'refusalFallback')).toMatchObject({
        currentValue: 'on',
      })
      await expect(
        editor.request('session/set_config_option', {
          sessionId: created.sessionId,
          configId: 'refusalFallback',
          value: 'maybe',
        }),
      ).rejects.toThrow()
      await editor.request('session/close', { sessionId: created.sessionId })
    })
  })

  it('hands a refused chat turn on only for the session that turned the fallback on', async () => {
    const repo = await gitRepo()
    const dataFolder = scratch('acp-team-data-')
    // The chat's own model first in the role, then the agent that takes over.
    const stored = storedTeam(WORKER)
    const role = stored.roles[0]
    if (role === undefined) throw new Error('the stored team has no role')
    const worker = role.pool[0]
    if (worker?.agent === undefined) throw new Error('the stored role has no entry')
    writeStoredTeam(dataFolder, repo, {
      ...stored,
      roles: [
        {
          ...role,
          pool: [{ ...worker, id: 'e0', agent: { ...worker.agent, model: ORCHESTRATOR } }, worker],
        },
      ],
    })
    const held = heldStarts()
    const port = createAcpTeam(
      teamDeps(dataFolder, { startWorker: held.startWorker }),
      UI_TEXT,
      'en',
    )
    try {
      const prepared = await port.prepareNew(repo, ORCHESTRATOR)
      const session = await prepared.attach('team-session', editorHandler(() => 'discard').handler)
      const other = await prepared.attach('other-session', editorHandler(() => 'discard').handler)
      const takeOver = port.seamsFor(repo).teamRunner.takeOverRefused
      if (takeOver === undefined) throw new Error('the team offers no chat takeover')
      const turn = { modelId: ORCHESTRATOR, refusal: 'No.', request: 'fix it', work: [] }
      expect(await takeOver(turn, context())).toEqual({ kind: 'stands' })
      session.setRefusalFallback(true)
      expect(session.isRefusalFallbackOn()).toBe(true)
      expect(other.isRefusalFallbackOn()).toBe(false)
      expect(await takeOver(turn, { ...context(), sessionId: 'other-session' })).toEqual({
        kind: 'stands',
      })
      expect(held.gates).toEqual([])
      const answer = takeOver(turn, context())
      await eventually(() => held.gates.length === 1, 'the next agent starting')
      held.gates[0]?.reject(new Error('no worker conversation in this suite'))
      expect(await answer).toMatchObject({ kind: 'answered', model: WORKER })
      await session.close()
      const reopened = await prepared.attach('team-session', editorHandler(() => 'discard').handler)
      expect(reopened.isRefusalFallbackOn()).toBe(false)
    } finally {
      await port.dispose()
    }
  })

  it('offers no team option and no admission without the team port', async () => {
    await admissionCase(undefined, false, async (editor, folder) => {
      const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
      expect((created.configOptions ?? []).some((row) => row.id === 'team')).toBe(false)
      await editor.request('session/close', { sessionId: created.sessionId })
    })
  })
})

/** A real repository with one committed file on `main`. */
async function gitRepo(): Promise<string> {
  const root = scratchTeamRepo('acp-team-repo-')
  writeFileSync(path.join(root, 'a.ts'), 'const value = 1\n')
  await realTeamGit(['add', 'a.ts'], root)
  // The scratch repository's own commit names its author the same way: a
  // hosted runner has no identity of its own.
  await realTeamGit(
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'a'],
    root,
  )
  return root
}

/** One held delegation: the stored team, its port, and the attached editor. */
async function heldTeam() {
  const repo = await gitRepo()
  const dataFolder = scratch('acp-team-data-')
  writeStoredTeam(dataFolder, repo, storedTeam(WORKER))
  const held = heldStarts()
  const port = createAcpTeam(teamDeps(dataFolder, { startWorker: held.startWorker }), UI_TEXT, 'en')
  const prepared = await port.prepareNew(repo, ORCHESTRATOR)
  const editor = editorHandler(() => 'discard')
  const session = await prepared.attach('team-session', editor.handler)
  return { repo, held, port, prepared, editor, session }
}

/** The editor's side of one attached session: its updates and its answers. */
function editorHandler(answer: (request: acp.RequestPermissionRequest) => string) {
  const updates: acp.SessionUpdate[] = []
  const requests: acp.RequestPermissionRequest[] = []
  const handler: AcpTeamSessionHandler = {
    mode: () => 'manual',
    sendUpdate: (update) => {
      updates.push(update)
    },
    requestPermission: (request) => {
      requests.push(request)
      return Promise.resolve({
        outcome: { outcome: 'selected', optionId: answer(request) },
      })
    },
  }
  return { updates, requests, handler }
}

const context = () => ({
  sessionId: 'team-session',
  approvalMode: 'manual',
  signal: new AbortController().signal,
  orchestratorModelId: ORCHESTRATOR,
})

async function delegateOne(port: AcpTeamPort, cwd: string): Promise<string> {
  const result = await port.seamsFor(cwd).teamRunner.delegate(
    {
      tasks: [
        { role: 'engineering', brief: 'fix the bug', reason: { code: 'parallel', detail: 'x' } },
      ],
    },
    context(),
  )
  const answered = JSON.parse(result.output) as { tasks?: { task_id?: string }[] }
  const taskId = answered.tasks?.[0]?.task_id
  if (taskId === undefined) throw new Error(`the delegation did not start: ${result.output}`)
  return taskId
}

/** A finished task restored from the board, its copy made by the real sequence. */
async function restoredMerge(
  answer: string,
  handler?: AcpTeamSessionHandler,
  reportStatus: 'done' | 'capped' = 'done',
) {
  const repo = await gitRepo()
  const dataFolder = scratch('acp-team-data-')
  const snapshot = storedTeam(WORKER)
  writeStoredTeam(dataFolder, repo, snapshot)
  // The copy has to live in the storage the session will actually clean,
  // which is the same place a worker's copy is created.
  const storage = path.join(
    dataFolder,
    ACP_SESSIONS_SUBFOLDER,
    workspaceKey(repo),
    ACP_TEAM_STORAGE_FOLDER,
  )
  const baseCommit = await resolveBaseCommit(realTeamGit, repo)
  const workspace = await startTeamWorkspace(realTeamGit, storage, process.platform, {
    repositoryRoot: repo,
    role: 'engineering',
    taskId: 'task-merge',
    mode: 'own-branch',
    baseCommit,
  })
  if (workspace.branch === undefined || workspace.agentsRef === undefined)
    throw new Error('test: own-branch copies carry a branch and a ref')
  writeFileSync(path.join(workspace.folder, 'a.ts'), 'const value = 2\n')
  const committed = await commitTaskBranch(realTeamGit, workspace.folder, {
    branch: workspace.branch,
    role: 'engineering',
    taskId: 'task-merge',
    entryId: 'e1',
  })
  await publishTaskRef(
    realTeamGit,
    repo,
    workspace.folder,
    workspace.branch,
    workspace.agentsRef,
    baseCommit,
  )
  const usage = {
    input: 1,
    cachedInput: 0,
    output: 1,
    reasoning: 0,
    modelCalls: 1,
    estimated: false,
  }
  const boardFile = path.join(dataFolder, 'acp', workspaceKey(repo), ACP_TEAM_BOARD_FILE)
  mkdirSync(path.dirname(boardFile), { recursive: true })
  writeFileSync(
    boardFile,
    JSON.stringify({
      'museSpark.team.tasks': [
        {
          taskId: 'task-merge',
          role: snapshot.roles[0],
          brief: 'fix the bug',
          files: ['a.ts'],
          reason: 'parallel',
          sessionId: 'team-session',
          startMs: 1,
          endMs: 2,
          entry: snapshot.roles[0]?.pool[0],
          phase: 'done',
          usage,
          workspace: {
            folder: workspace.folder,
            baseCommit,
            branch: workspace.branch,
            agentsRef: workspace.agentsRef,
          },
          outcome: {
            report: {
              status: reportStatus,
              summary: reportStatus === 'capped' ? 'stopped at the cap' : 'did it',
            },
            usage,
            branch: workspace.branch,
            baseCommit,
            head: committed.head,
            changedFiles: ['a.ts'],
            folder: workspace.folder,
            agentsRef: workspace.agentsRef,
          },
        },
      ],
    }),
  )
  const port = createAcpTeam(teamDeps(dataFolder), UI_TEXT, 'en')
  const prepared = await port.prepareNew(repo, ORCHESTRATOR)
  const editor =
    handler === undefined ? editorHandler(() => answer) : { updates: [], requests: [], handler }
  const session = await prepared.attach('team-session', editor.handler)
  return {
    repo,
    port,
    prepared,
    editor,
    session,
    storage,
    baseCommit,
    head: committed.head,
    agentsRef: workspace.agentsRef,
    copyFolder: workspace.folder,
  }
}

/** A restored merge asked of the editor, ready for its answer's effect. */
async function askRestoredMerge(answer: string) {
  const rig = await restoredMerge(answer)
  const result = await rig.port
    .seamsFor(rig.repo)
    .teamRunner.merge({ task_id: 'task-merge' }, context())
  expect(result.output).not.toContain('Error:')
  await eventually(() => rig.editor.requests.length === 1, 'the merge permission request')
  return rig
}

describe('ACP team progress, cancel and merge over the real team host', () => {
  // The engine's git is governed: configure the process governor as the
  // agent process does, so admission answers and copies are real.
  let disposeResources: (() => void) | undefined
  beforeAll(() => {
    disposeResources = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      ...(process.platform === 'win32' && {
        windowsJob: runtimeWindowsJob(scratch('acp-team-jobs-'), path.resolve('.')),
      }),
    })
  })
  afterAll(() => {
    disposeResources?.()
  })

  it('announces a delegated task over the plan and its tool call, then completes its failure', async () => {
    const { repo, held, port, prepared, editor, session } = await heldTeam()
    try {
      expect(prepared.isTeam).toBe(true)
      const taskId = await delegateOne(port, repo)
      await eventually(() => held.gates.length === 1, 'the worker start')
      const plan = editor.updates.find(
        (update) =>
          update.sessionUpdate === 'plan' &&
          Array.isArray(update.entries) &&
          update.entries.length === 1,
      )
      expect(plan).toMatchObject({
        sessionUpdate: 'plan',
        entries: [{ content: 'fix the bug', status: 'in_progress' }],
      })
      const call = editor.updates.find((update) => update.sessionUpdate === 'tool_call')
      expect(call).toMatchObject({
        toolCallId: `team/task/${taskId}`,
        title: `engineering · ${WORKER}: fix the bug`,
        status: 'in_progress',
      })
      // A start that cannot complete is retried by the scheduler; fail
      // each attempt at its gate until the task itself settles failed.
      const isFailed = () =>
        editor.updates.some(
          (update) =>
            update.sessionUpdate === 'tool_call_update' &&
            update.toolCallId === `team/task/${taskId}` &&
            update.status === 'failed',
        )
      const deadline = Date.now() + 3000
      while (!isFailed()) {
        if (Date.now() > deadline)
          throw new Error('timed out waiting for the failed tool call update')
        for (const gate of held.gates.splice(0))
          gate.reject(new Error('the worker conversation could not start'))
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      await session.close()
    } finally {
      await port.dispose()
    }
  })

  it('stops every worker of the session on cancel', async () => {
    const { repo, held, port, editor, session } = await heldTeam()
    try {
      await delegateOne(port, repo)
      await eventually(() => held.gates.length === 1, 'the worker start')
      const before = editor.updates.length
      await session.cancel()
      // A new empty plan arrives from the cancel itself, while the
      // worker's start is still held at its gate: only the stop can
      // have removed the task.
      await eventually(
        () =>
          editor.updates
            .slice(before)
            .some(
              (update) =>
                update.sessionUpdate === 'plan' &&
                Array.isArray(update.entries) &&
                update.entries.length === 0,
            ),
        'the emptied plan',
      )
      held.gates[0]?.reject(new Error('the worker conversation could not start'))
      await session.close()
    } finally {
      await port.dispose()
    }
  })

  it('asks for a merge with the real diff and discards on refusal', async () => {
    const { repo, port, editor, session } = await askRestoredMerge('discard')
    try {
      await eventually(
        () =>
          editor.updates.some(
            (update) =>
              update.sessionUpdate === 'tool_call_update' &&
              update.toolCallId === 'team/merge/task-merge' &&
              update.status === 'completed',
          ),
        'the completed merge call',
      )
      const content = editor.requests[0]?.toolCall.content ?? []
      expect(content).toContainEqual({
        type: 'diff',
        path: normalizeTeamPath(path.join(repo, 'a.ts')),
        oldText: 'const value = 1\n',
        newText: 'const value = 2\n',
      })
      expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 1\n')
      await session.close()
    } finally {
      await port.dispose()
    }
  })

  it('lands the change on the editor’s approval', async () => {
    const { repo, port, session } = await askRestoredMerge('merge')
    try {
      await eventually(
        () => readFileSync(path.join(repo, 'a.ts'), 'utf8') === 'const value = 2\n',
        'the landed change',
      )
      expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 2\n')
      await session.close()
    } finally {
      await port.dispose()
    }
  })

  it('serves the team tools to a Muse Code orchestrator and refuses other tokens', async () => {
    const repo = await gitRepo()
    const dataFolder = scratch('acp-team-data-')
    writeStoredTeam(dataFolder, repo, storedTeam(WORKER))
    const port = createAcpTeam(teamDeps(dataFolder, { backendKind: 'museCode' }), UI_TEXT, 'en')
    try {
      const prepared = await port.prepareNew(repo, ORCHESTRATOR)
      expect(prepared.isTeam).toBe(true)
      const endpoint = prepared.mcpServer
      if (endpoint === undefined)
        throw new Error('test: a Muse Code team session carries its endpoint')
      const editor = editorHandler(() => 'discard')
      const session = await prepared.attach('team-session', editor.handler)
      const call = async (body: unknown, extra: Record<string, string>) => {
        const headers = new Headers({ 'content-type': 'application/json', ...extra })
        return await fetch(endpoint.url, { method: 'POST', headers, body: JSON.stringify(body) })
      }
      const listed = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, endpoint.headers)
      expect(listed.status).toBe(200)
      const tools = (await listed.json()) as { result: { tools: { name: string }[] } }
      expect(tools.result.tools.map((tool) => tool.name)).toEqual([
        'roster',
        'delegate',
        'collect',
        'cancel',
        'merge',
      ])
      const forged = await call(
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { Authorization: `Bearer ${'0'.repeat(64)}` },
      )
      expect(forged.status).toBe(401)
      await session.close()
    } finally {
      await port.dispose()
    }
  })

  it('keeps one session’s tasks, briefs and diffs out of another session', async () => {
    const { repo, port, prepared, editor } = await restoredMerge('discard')
    const otherUpdates: acp.SessionUpdate[] = []
    try {
      await prepared.attach('other-session', {
        mode: () => 'manual',
        sendUpdate: (update) => {
          otherUpdates.push(update)
        },
        requestPermission: () => Promise.reject(new Error('the other session is not asked')),
      })
      await eventually(
        () =>
          editor.updates.some(
            (update) =>
              update.sessionUpdate === 'tool_call' &&
              typeof update.title === 'string' &&
              update.title.includes('fix the bug'),
          ),
        'the owning session’s task',
      )
      const leaked = JSON.stringify(otherUpdates)
      expect(leaked).not.toContain('fix the bug')
      expect(leaked).not.toContain('const value = 2')
      expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 1\n')
    } finally {
      await port.dispose()
    }
  })

  it('refuses a merge the editor answers only after cancel, and removes the copy', async () => {
    const { promise: answer, resolve: release } = Promise.withResolvers<string>()
    let isAsked = false
    const { repo, port, session, copyFolder } = await restoredMerge('merge', {
      mode: () => 'manual',
      sendUpdate: () => undefined,
      requestPermission: async () => {
        isAsked = true
        const optionId = await answer
        return { outcome: { outcome: 'selected' as const, optionId } }
      },
    })
    try {
      const result = await port
        .seamsFor(repo)
        .teamRunner.merge({ task_id: 'task-merge' }, context())
      expect(result.output).not.toContain('Error:')
      await eventually(() => isAsked, 'the merge question')
      await session.cancel()
      expect(existsSync(copyFolder)).toBe(false)
      expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 1\n')
      release('merge')
      await answer
      expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 1\n')
      expect(existsSync(copyFolder)).toBe(false)
    } finally {
      await port.dispose()
    }
  })

  it('says so and discards when the editor cannot answer a merge', async () => {
    const updates: acp.SessionUpdate[] = []
    const { repo, port, session } = await restoredMerge('discard', {
      mode: () => 'manual',
      sendUpdate: (update) => {
        updates.push(update)
      },
      requestPermission: () =>
        Promise.reject(new Error('session/request_permission is not supported')),
    })
    try {
      const result = await port
        .seamsFor(repo)
        .teamRunner.merge({ task_id: 'task-merge' }, context())
      expect(result.output).not.toContain('Error:')
      await eventually(
        () =>
          updates.some(
            (update) =>
              update.sessionUpdate === 'agent_message_chunk' &&
              update.content.type === 'text' &&
              update.content.text === UI_TEXT.acpTeamUnanswered,
          ),
        'the unanswered sentence',
      )
      expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 1\n')
      await session.close()
      expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 1\n')
    } finally {
      await port.dispose()
    }
  })

  // RVACPTEAM's open P3s, each on the real team host and the real filesystem.
  it('says a card that failed for real in the generic words, never a machine’s code', async () => {
    const updates: acp.SessionUpdate[] = []
    const copy = { folder: '' }
    const { repo, port, session, copyFolder } = await restoredMerge('merge', {
      mode: () => 'manual',
      sendUpdate: (update) => {
        updates.push(update)
      },
      // The task's copy goes while the person decides, so the landing throws for real.
      requestPermission: () => {
        rmSync(copy.folder, { force: true, recursive: true })
        return Promise.resolve({ outcome: { outcome: 'selected' as const, optionId: 'merge' } })
      },
    })
    copy.folder = copyFolder
    try {
      const result = await port
        .seamsFor(repo)
        .teamRunner.merge({ task_id: 'task-merge' }, context())
      expect(result.output).not.toContain('Error:')
      await eventually(() => saidIn(updates).length > 0, 'the failed card’s sentence')
      expect(saidIn(updates)).toEqual([UI_TEXT.actionFailed])
      await session.close()
    } finally {
      await port.dispose()
    }
  })

  // A held lock answers rather than throws, so nothing but these words tells the person.
  it.each(MODES)(
    'tells the person once, in %s mode, that a held lock kept the merge off their files',
    async (mode) => {
      const updates: acp.SessionUpdate[] = []
      const { repo, port, session } = await restoredMerge('merge', mergingEditor(mode, updates))
      const notices = UI_TEXT.teamTrafficNotices
      try {
        writeFileSync(path.join(repo, '.git', 'index.lock'), '')
        const result = await port
          .seamsFor(repo)
          .teamRunner.merge({ task_id: 'task-merge' }, context())
        expect(result.output).not.toContain('Error:')
        await eventually(() => saidIn(updates).length > 0, 'the refused landing’s words')
        const listed = await realTeamGit(
          ['branch', '--list', 'agents/landing/*', '--format=%(refname:short)'],
          repo,
        )
        const branch = new TextDecoder().decode(listed).trim()
        expect(branch).not.toBe('')
        const [words = ''] = saidIn(updates)
        expect(words.startsWith(notices.heldByLock.split('{path}', 1)[0] ?? '')).toBe(true)
        expect(words).toContain('index.lock')
        expect(words.endsWith(fill(notices.landingBranchedThen, { branch }))).toBe(true)
        expect(words).not.toContain('"')
        expect(readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe('const value = 1\n')
        rmSync(path.join(repo, '.git', 'index.lock'))
        await session.close()
        expect(saidIn(updates)).toHaveLength(1)
      } finally {
        await port.dispose()
      }
    },
  )

  it.each(MODES)(
    'names the landing that holds the lock, in %s mode, when another run is mid-landing',
    { timeout: 180_000 },
    async (mode) => {
      const updates: acp.SessionUpdate[] = []
      const rig = await restoredMerge('merge', mergingEditor(mode, updates))
      const notices = UI_TEXT.teamTrafficNotices
      const lander = await buildLander()
      try {
        // A real process stands mid-landing: its record is open and git's lock is its own.
        const running = await startLander(
          lander,
          {
            root: rig.repo,
            storage: rig.storage,
            workerCopy: rig.copyFolder,
            baseCommit: rig.baseCommit,
            head: rig.head,
            agentsRef: rig.agentsRef,
            taskId: 'task-merge',
            changedFiles: ['a.ts'],
            dispose: () => Promise.resolve(),
          },
          createWindowIdentity(1000),
          { file: 'a.ts', atRename: true },
        )
        await running.stopped()
        const result = await rig.port
          .seamsFor(rig.repo)
          .teamRunner.merge({ task_id: 'task-merge' }, context())
        expect(result.output).not.toContain('Error:')
        await eventually(() => saidIn(updates).length > 0, 'the refused landing’s words')
        const [words = ''] = saidIn(updates)
        expect(words.startsWith(notices.heldByLanding.split('{path}', 1)[0] ?? '')).toBe(true)
        expect(words).toContain('index.lock')
        expect(words.endsWith(notices.landingBusyThen)).toBe(true)
        expect(words).not.toContain('"')
        await running.kill()
      } finally {
        await rig.port.dispose()
        await lander.dispose()
      }
    },
  )

  it('says a refused landing once, and an answer of Discard after it says nothing more', async () => {
    const updates: acp.SessionUpdate[] = []
    const answers = ['merge', 'discard']
    const { repo, port, session } = await restoredMerge('merge', {
      mode: () => 'manual',
      sendUpdate: (update) => {
        updates.push(update)
      },
      requestPermission: () =>
        Promise.resolve({
          outcome: { outcome: 'selected' as const, optionId: answers.shift() ?? 'discard' },
        }),
    })
    try {
      writeFileSync(path.join(repo, '.git', 'index.lock'), '')
      await port.seamsFor(repo).teamRunner.merge({ task_id: 'task-merge' }, context())
      await eventually(() => saidIn(updates).length > 0, 'the refused landing’s words')
      rmSync(path.join(repo, '.git', 'index.lock'))
      await port.seamsFor(repo).teamRunner.merge({ task_id: 'task-merge' }, context())
      await eventually(() => answers.length === 0, 'the second question')
      await session.close()
      expect(saidIn(updates)).toHaveLength(1)
    } finally {
      await port.dispose()
    }
  })

  it('offers an editor no Undo Merge when a landing stopped on a changed file', () => {
    const changed = { kind: 'changed', paths: ['b.txt', 'c.txt'] } as const
    expect(refusedLandingText(changed)).toBe(
      fill(UI_TEXT.teamTrafficNotices.changedDuringLandingNoUndo, { path: 'b.txt, c.txt' }),
    )
    expect(UI_TEXT.teamTrafficNotices.changedDuringLandingNoUndo).not.toMatch(/undo/iu)
    // Every other kind reads as the card and Traffic read it.
    const stale = { kind: 'stale' } as const
    expect(refusedLandingText(stale)).toBe(UI_TEXT.teamTrafficNotices.landingStale)
  })

  it('lets a card’s own words through, and keeps a place on this machine out', async () => {
    const folder = scratch('acp-team-words-')
    const missing = path.join(folder, 'missing')
    // Real failures that name the place: the filesystem's, and git's.
    const fromFile = await failureOf(readFile(missing))
    const fromGit = await failureOf(realTeamGit(['-C', missing, 'status'], folder))
    for (const failure of [fromFile, fromGit]) {
      expect(String(failure)).toContain('missing')
      expect(cardFailureText(failure)).toBe(UI_TEXT.actionFailed)
    }
    expect(cardFailureText(new Error(UI_TEXT.teamTaskBusy))).toBe(UI_TEXT.teamTaskBusy)
    expect(cardFailureText(new Error(TEAM_MODEL_TEXT.hostMergePlanMode))).toBe(
      TEAM_MODEL_TEXT.hostMergePlanMode,
    )
    expect(cardFailureText(new Error('unknownTask'))).toBe(UI_TEXT.actionFailed)
    expect(cardFailureText('not an error')).toBe(UI_TEXT.actionFailed)
  })

  it('waits for an aborted worker before the team is gone', async () => {
    const { repo, held, port } = await heldTeam()
    await delegateOne(port, repo)
    await eventually(() => held.gates.length === 1, 'the worker start')
    let isDisposed = false
    const disposing = (async () => {
      await port.dispose()
      isDisposed = true
    })()
    // The worker is still at its gate, however long this looks.
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(isDisposed).toBe(false)
    held.gates[0]?.reject(new Error('the worker conversation could not start'))
    await disposing
    expect(isDisposed).toBe(true)
  })

  // A worker still in its start has not read its abort: the agent's exit must not hang on it.
  it(
    'goes on past a worker that never finishes, within the grace',
    { timeout: TREE_EXIT_WAIT_MS * 3 },
    async () => {
      const { repo, held, port } = await heldTeam()
      await delegateOne(port, repo)
      await eventually(() => held.gates.length === 1, 'the worker start')
      try {
        await port.dispose()
      } finally {
        held.gates[0]?.reject(new Error('the worker conversation could not start'))
      }
    },
  )

  it('keeps an unrelated failure’s own kind: a board that cannot be read is no refusal', async () => {
    const repo = await gitRepo()
    const dataFolder = scratch('acp-team-data-')
    writeStoredTeam(dataFolder, repo, storedTeam(WORKER))
    mkdirSync(path.join(dataFolder, 'acp', workspaceKey(repo), ACP_TEAM_BOARD_FILE), {
      recursive: true,
    })
    const failure = await prepareFailure(dataFolder, repo)
    expect(failure).toBeInstanceOf(Error)
    expect(isAcpTeamRefusal(failure)).toBe(false)
  })

  it('brands a stored-team sentence with its slot filled as a refusal', async () => {
    const repo = await gitRepo()
    const dataFolder = scratch('acp-team-data-')
    writeStoredTeam(dataFolder, repo, storedTeam(WORKER))
    const teamJson = teamJsonPath(repo, process.platform)
    mkdirSync(path.dirname(teamJson), { recursive: true })
    writeFileSync(teamJson, JSON.stringify({ sharedFiles: 1 }))
    const failure = await prepareFailure(dataFolder, repo)
    expect(isAcpTeamRefusal(failure)).toBe(true)
    expect(failure).toMatchObject({
      message: fill(UI_TEXT.execTeamConfigBadEntry, { entry: 'sharedFiles' }),
    })
  })

  it('reads a stored file no further than its bound, however large the file is', async () => {
    const repo = await gitRepo()
    const dataFolder = scratch('acp-team-data-')
    const stored = storedTeamSnapshotFile(dataFolder, repo)
    mkdirSync(path.dirname(stored), { recursive: true })
    // Past what a whole-file read can take at all (2 GiB, ERR_FS_FILE_TOO_LARGE), and
    // sparse where the system can: the reader that stops at its bound never knows.
    truncateSync(openAndClose(stored), TWO_GIB_AND_A_BYTE)
    const failure = await prepareFailure(dataFolder, repo)
    expect(isAcpTeamRefusal(failure)).toBe(true)
    expect(failure).toMatchObject({ message: UI_TEXT.execTeamStateUnreadable })
  })

  it('reports a capped worker as failed, with its report', async () => {
    const { port, editor, session } = await restoredMerge('discard', undefined, 'capped')
    try {
      await eventually(
        () =>
          editor.updates.some(
            (update) =>
              update.sessionUpdate === 'tool_call_update' &&
              update.toolCallId === 'team/task/task-merge' &&
              update.status === 'failed' &&
              JSON.stringify(update.content).includes('stopped at the cap'),
          ),
        'the capped task’s failed call',
      )
      expect(
        editor.updates.some(
          (update) =>
            update.sessionUpdate === 'tool_call_update' &&
            update.toolCallId === 'team/task/task-merge' &&
            update.status === 'completed',
        ),
      ).toBe(false)
      await session.close()
    } finally {
      await port.dispose()
    }
  })
})
