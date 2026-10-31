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
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createAcpTeam, type AcpTeamDeps } from '../../src/acp/acpTeamEntry'
import { createAcpAgent } from '../../src/acp/agent'
import type { AcpTeamPort, AcpTeamPrepared, AcpTeamSessionHandler } from '../../src/acp/teamPort'
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
import { ACP_TEAM_BOARD_FILE, UI_TEXT } from '../../src/shared/constants'
import type { TeamSnapshot } from '../../src/shared/team'
import { acpLocalAgentDeps } from './helpers/acpLocalAgentDeps'
import { modelApiRig } from './helpers/conversationPanel'
import { createEditorChatServices, writeEditorChatProvidersFile } from './helpers/editorChatRig'
import { realTeamGit } from './helpers/realTeamGit'

const log = stderrLogger(() => undefined, 'warn')
const ORCHESTRATOR = 'probe-custom/custom-model'
const WORKER = 'probe-offable/offable-model'
const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function scratch(prefix: string): string {
  const folder = mkdtempSync(path.join(tmpdir(), prefix))
  folders.push(folder)
  return folder
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
  const { configFile, catalogFile } = writeEditorChatProvidersFile(folder)
  const { models } = createEditorChatServices(configFile, catalogFile).client
  const rig = modelApiRig(folder, undefined, undefined, {
    ...(models !== undefined && { models }),
  })
  const deps = acpLocalAgentDeps(folder, log)
  const team: AcpTeamPort | undefined = hasTeam
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
  const agent = createAcpAgent({
    backend: {
      kind: 'modelApi',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(rig.host),
    },
    version: '0.19.0',
    options: {
      canBypass: false,
      allowsContributorModels: false,
      initialMode: 'manual',
      initialModelId: ORCHESTRATOR,
    },
    signIn: {
      id: 'auth-set',
      name: 'Model API key',
      description: 'Model API key',
      args: [],
      command: 'muse-spark-code-acp auth set',
    },
    ...deps,
    ...(team !== undefined && { team }),
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

describe('ACP team admission over the real agent', () => {
  it('refuses a new session with no stored team (no second usable model)', async () => {
    const { agent, folder, team } = agentWithTeam(undefined, true)
    try {
      await withEditor(agent, async (editor) => {
        const refusal = await errorOf(
          editor.request('session/new', { cwd: folder, mcpServers: [] }),
        )
        expect(refusal).toContain(UI_TEXT.teamNeedsSecondModel)
      })
    } finally {
      await team?.dispose()
    }
  })

  it('refuses a stored team whose only entry is the session model', async () => {
    const { agent, folder, team } = agentWithTeam(storedTeam(ORCHESTRATOR), true)
    try {
      await withEditor(agent, async (editor) => {
        const refusal = await errorOf(
          editor.request('session/new', { cwd: folder, mcpServers: [] }),
        )
        expect(refusal).toContain(UI_TEXT.teamNeedsSecondModel)
      })
    } finally {
      await team?.dispose()
    }
  })

  it('opens a team session, shows its state, and refuses a mid-session switch', async () => {
    const { agent, folder, team } = agentWithTeam(storedTeam(WORKER), true)
    try {
      await withEditor(agent, async (editor) => {
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
    } finally {
      await team?.dispose()
    }
  })

  it('offers no team option and no admission without the team port', async () => {
    const { agent, folder } = agentWithTeam(undefined, false)
    await withEditor(agent, async (editor) => {
      const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
      expect(created.configOptions.some((row) => row.id === 'team')).toBe(false)
      await editor.request('session/close', { sessionId: created.sessionId })
    })
  })
})

/** A real repository with one committed file on `main`. */
function gitRepo(): string {
  const root = scratch('acp-team-repo-')
  execFileSync('git', ['init', '-b', 'main'], { cwd: root })
  writeFileSync(path.join(root, 'a.ts'), 'const value = 1\n')
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'add', '--all', '--'],
    { cwd: root },
  )
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'],
    { cwd: root },
  )
  return root
}

type Update = acp.SessionUpdate

/** The editor's side of one attached session: its updates and its answers. */
function editorHandler(answer: (request: acp.RequestPermissionRequest) => string) {
  const updates: Update[] = []
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
async function restoredMerge(answer: string) {
  const repo = gitRepo()
  const dataFolder = scratch('acp-team-data-')
  const snapshot = storedTeam(WORKER)
  writeStoredTeam(dataFolder, repo, snapshot)
  const storage = scratch('acp-team-storage-')
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
            report: { status: 'done', summary: 'did it' },
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
  const editor = editorHandler(() => answer)
  const session = await prepared.attach('team-session', editor.handler)
  return { repo, port, editor, session, agentsRef: workspace.agentsRef }
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
    const repo = gitRepo()
    const dataFolder = scratch('acp-team-data-')
    writeStoredTeam(dataFolder, repo, storedTeam(WORKER))
    const held = heldStarts()
    const port = createAcpTeam(
      teamDeps(dataFolder, { startWorker: held.startWorker }),
      UI_TEXT,
      'en',
    )
    try {
      const prepared: AcpTeamPrepared = await port.prepareNew(repo, ORCHESTRATOR)
      expect(prepared.isTeam).toBe(true)
      const editor = editorHandler(() => 'discard')
      const session = await prepared.attach('team-session', editor.handler)
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
    const repo = gitRepo()
    const dataFolder = scratch('acp-team-data-')
    writeStoredTeam(dataFolder, repo, storedTeam(WORKER))
    const held = heldStarts()
    const port = createAcpTeam(
      teamDeps(dataFolder, { startWorker: held.startWorker }),
      UI_TEXT,
      'en',
    )
    try {
      const prepared = await port.prepareNew(repo, ORCHESTRATOR)
      const editor = editorHandler(() => 'discard')
      const session = await prepared.attach('team-session', editor.handler)
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
    const { repo, port, editor, session } = await restoredMerge('discard')
    try {
      const result = await port
        .seamsFor(repo)
        .teamRunner.merge({ task_id: 'task-merge' }, context())
      expect(result.output).not.toContain('Error:')
      await eventually(() => editor.requests.length === 1, 'the merge permission request')
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
        path: path.join(repo, 'a.ts'),
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
    const { repo, port, editor, session } = await restoredMerge('merge')
    try {
      const result = await port
        .seamsFor(repo)
        .teamRunner.merge({ task_id: 'task-merge' }, context())
      expect(result.output).not.toContain('Error:')
      await eventually(() => editor.requests.length === 1, 'the merge permission request')
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
    const repo = gitRepo()
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
      const call = async (body: unknown, headers: Record<string, string>) =>
        await fetch(endpoint.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        })
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
})
