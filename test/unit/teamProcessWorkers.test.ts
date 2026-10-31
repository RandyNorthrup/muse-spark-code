// Muse Code and external-agent team workers on real parts (RLF-TEAMWORKERS):
// the real `createTeamHostService` and window scheduler, the composite worker
// port over the real engine merge ports and the real process-worker ports,
// real git repositories, the real native process lifetime and its journal, a
// real `muse serve` (Muse Code's own echo provider: the host, its sessions
// and its turns are real, and no model request leaves the machine) and the
// real packaged ACP agent started with no sign-in. Nothing here stands in for
// a host, an agent, a store or git. The first real model turn through either
// worker kind is the lead's live run (docs/certification/rlf-teamworkers.md).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTeamHostService } from '../../src/core/team/teamHost'
import type {
  TeamCardItem,
  TeamHostService,
  TeamWorkerPort,
} from '../../src/core/team/teamHostService'
import { createCompositeTeamWorkerPort } from '../../src/core/team/workers/compositeWorkerPort'
import { ACP_PRESETS, type AcpPreset } from '../../src/core/team/workers/acpWorker'
import { resolveMuseLaunch } from '../../src/core/backends/musecode/launch'
import {
  createProcessTeamPorts,
  type ProcessTeamPorts,
  type TeamMuseServeLaunch,
  type TeamProcessWorkersDeps,
} from '../../src/host/team/teamProcessWorkers'
import { createTeamHost } from '../../src/host/team/teamHostEntry'
import { TEAM_MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { TeamAgentRef, TeamSnapshot } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import { silentCoreLog } from './helpers/memoryLogs'
import {
  fileState,
  initRigFolders,
  isProcessAlive,
  realServiceDeps,
  storedTaskOf,
  toolContext,
} from './helpers/teamRealRig'
import { enginePortsWithoutWorker, realTeamGit } from './helpers/realTeamGit'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'
import { stageAgentBundle } from './helpers/stageAgentBundle'

const ORCHESTRATOR = 'orchestrator-model'
const MUSE_AGENT: TeamAgentRef = {
  kind: 'museCode',
  agentId: 'muse',
  model: 'echo',
  pays: 'subscription',
}
const OWN_AGENT: TeamAgentRef = {
  kind: 'external',
  agentId: 'own',
  model: 'echo',
  pays: 'subscription',
}
/** The report a worker ends with; Muse Code's echo provider hands the prompt back as its answer. */
const ECHOED_REPORT =
  '```muse-team-report\n{"status":"done","summary":"echoed by the real Muse Code host"}\n```'

// A genuinely long operation: a real `muse serve` start, its handshake, a
// session and a turn, then git, on a shared rig.
const WORKER_TEST_TIMEOUT_MS = 60_000

/** The product's own CLI resolution; undefined where Muse Code is not installed. */
function museCommand(): string | undefined {
  const resolution = resolveMuseLaunch({
    platform: process.platform,
    configuredPath: '',
    pathEntries: (process.env['PATH'] ?? '').split(path.delimiter),
    homeDir: homedir(),
    localAppData: process.env['LOCALAPPDATA'],
    fileExists: existsSync,
    readTextFile: (file) => (existsSync(file) ? readFileSync(file, 'utf8') : undefined),
    listDirectory: (directory) => (existsSync(directory) ? readdirSync(directory) : []),
    serveArgs: ['serve'],
    // The test's own workspace is a scratch folder: no PATH entry sits inside it.
    scope: { workspaceRoot: tmpdir(), realpath: realpathSync },
  })
  return resolution.ok ? resolution.launch.command : undefined
}

const MUSE = museCommand()
const roots: string[] = []
const rigs: Rig[] = []
/** Where the packed agent was staged for this file. */
const staged = { directory: '' }

interface Rig {
  readonly service: TeamHostService
  readonly processPorts: ProcessTeamPorts
  readonly workers: TeamWorkerPort
  readonly repo: string
  readonly journal: string
  readonly stateValues: Map<string, unknown>
  readonly cards: TeamCardItem[]
  trusted: boolean
  /** Muse Code and the PATH as the setup probe saw them; a test can take them away after it. */
  hasMuse: boolean
  pathEntries: readonly string[]
}

beforeAll(async () => {
  staged.directory = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-team-agent-')))
  roots.push(staged.directory)
  await stageAgentBundle(staged.directory)
  // The worker environment drops NODE_PATH: the packed agent finds its native
  // keyring module the way an installed one does, from its own folder.
  await symlink(path.resolve('node_modules'), path.join(staged.directory, 'node_modules'), 'dir')
})

afterAll(async () => {
  for (const rig of rigs.splice(0)) {
    await rig.service.dispose()
    await rig.processPorts.dispose()
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function storedTeam(agent: TeamAgentRef): TeamSnapshot {
  const entry = (id: string) => ({ id, concurrent: 2, caps: [], agent })
  return {
    roles: [
      { role: 'engineering', workspace: 'own-branch', pool: [entry('e1')] },
      { role: 'research', workspace: 'read-only', pool: [entry('r1')] },
    ],
    intensity: 'balanced',
  }
}

/** The process ports' deps over a rig's real folders; `resolve` can take Muse Code away after the setup probe. */
function processWorkerDeps(input: {
  readonly repo: string
  readonly storage: string
  readonly journal: string
  readonly env: NodeJS.ProcessEnv
  readonly isTrusted: () => boolean
  readonly resolve: (launch: TeamMuseServeLaunch | undefined) => TeamMuseServeLaunch | undefined
  readonly pathEntries: () => readonly string[]
  readonly presets?: Readonly<Record<'own' | 'claude' | 'codex' | 'gemini' | 'copilot', AcpPreset>>
}): Omit<TeamProcessWorkersDeps, 'runGit'> {
  const museLaunch: TeamMuseServeLaunch | undefined =
    MUSE === undefined
      ? undefined
      : {
          command: MUSE,
          prefixArgs: [],
          // Muse Code's own echo provider: a real host answering without a model request.
          postureArgs: ['--provider', 'echo', '--no-session-log', '--disable-sandbox'],
          env: input.env,
        }
  return {
    repositoryRoot: () => input.repo,
    storageRoot: input.storage,
    journalStorageDirectory: input.journal,
    platform: process.platform,
    isTrusted: input.isTrusted,
    extensionVersion: '0.0.0-test',
    resolveMuseServe: () => input.resolve(museLaunch),
    isContributorMode: () => false,
    baseEnv: () => input.env,
    pathEntries: input.pathEntries,
    ...(input.presets !== undefined && { presets: input.presets }),
    now: () => Date.now(),
    log: silentCoreLog(),
  }
}

async function makeRig(options: {
  readonly agent: TeamAgentRef
  readonly presets?: Readonly<Record<'own' | 'claude' | 'codex' | 'gemini' | 'copilot', AcpPreset>>
  readonly pathEntries?: readonly string[]
  readonly withoutMuse?: boolean
}): Promise<Rig> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-team-process-')))
  roots.push(root)
  const { repo, storage } = await initRigFolders(root)
  const home = path.join(root, 'home')
  await mkdir(home, { recursive: true })
  const stateValues = new Map<string, unknown>([
    [TEAM_WORKSPACE_KEYS.team, storedTeam(options.agent)],
  ])
  const cards: TeamCardItem[] = []
  const env = isolatedRuntimeEnvironment(home, root)
  const state = { hasMuse: options.withoutMuse !== true, pathEntries: options.pathEntries ?? [] }
  const journal = path.join(root, 'journal')
  let isTrusted = true
  const processDeps = processWorkerDeps({
    repo,
    storage,
    journal,
    env,
    isTrusted: () => isTrusted,
    resolve: (launch) => (state.hasMuse ? launch : undefined),
    pathEntries: () => state.pathEntries,
    ...(options.presets !== undefined && { presets: options.presets }),
  })
  const processPorts = createProcessTeamPorts({ ...processDeps, runGit: realTeamGit })
  const engine = enginePortsWithoutWorker({
    repositoryRoot: () => repo,
    storageRoot: storage,
    isTrusted: () => isTrusted,
  })
  const workers = createCompositeTeamWorkerPort([engine.workers, processPorts.workers])
  const service = createTeamHostService({
    ...realServiceDeps({
      orchestrator: ORCHESTRATOR,
      isTrusted: () => isTrusted,
      cards,
      state: fileState(path.join(root, 'state.json'), stateValues),
    }),
    workers,
    merges: engine.merges,
    paid: { allowKeyTasks: () => Promise.resolve(true) },
  })
  const rig: Rig = {
    service,
    processPorts,
    workers,
    repo,
    journal,
    stateValues,
    cards,
    get trusted() {
      return isTrusted
    },
    set trusted(value: boolean) {
      isTrusted = value
    },
    get hasMuse() {
      return state.hasMuse
    },
    set hasMuse(value: boolean) {
      state.hasMuse = value
    },
    get pathEntries() {
      return state.pathEntries
    },
    set pathEntries(value: readonly string[]) {
      state.pathEntries = value
    },
  }
  rigs.push(rig)
  await service.probeEntries()
  return rig
}

async function delegate(rig: Rig, role: string, brief: string): Promise<string> {
  const result = await rig.service.teamRunner.delegate(
    { tasks: [{ role, brief, reason: { code: 'parallel', detail: 'independent work' } }] },
    toolContext(ORCHESTRATOR),
  )
  const answer = JSON.parse(result.output) as { tasks?: { task_id?: string }[] }
  const id = answer.tasks?.[0]?.task_id
  if (id === undefined) throw new Error(`The delegation did not start: ${result.output}`)
  return id
}

function storedTask(rig: Pick<Rig, 'stateValues'>, taskId: string) {
  return storedTaskOf(rig.stateValues, taskId)
}

/** The task's final phase: `done` or `failed` with the person's sentence. */
async function settled(
  rig: Pick<Rig, 'stateValues'>,
  taskId: string,
): Promise<{ phase: string; failure: string }> {
  await expect
    .poll(() => ['done', 'failed'].includes(storedTask(rig, taskId)?.phase ?? ''), {
      timeout: 45_000,
    })
    .toBe(true)
  const task = storedTask(rig, taskId)
  return { phase: task?.phase ?? '', failure: task?.failure ?? '' }
}

/** Every launch record the team's journal holds, as the launcher wrote them. */
function launchRecords(
  rig: Pick<Rig, 'journal'>,
): { taskId: string; pid: number | undefined; command: string }[] {
  const owners = existsSync(path.join(rig.journal, 'team', 'journal'))
    ? readdirSync(path.join(rig.journal, 'team', 'journal'))
    : []
  return owners.flatMap((owner) =>
    readdirSync(path.join(rig.journal, 'team', 'journal', owner))
      .filter((name) => name.startsWith('launch-'))
      .map((name) => {
        const envelope = JSON.parse(
          readFileSync(path.join(rig.journal, 'team', 'journal', owner, name), 'utf8'),
        ) as {
          value: { taskId: string; command: string; confirmation?: { pid: number } }
        }
        return {
          taskId: envelope.value.taskId,
          command: envelope.value.command,
          pid: envelope.value.confirmation?.pid,
        }
      }),
  )
}

function processArguments(pid: number): string {
  return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' })
}

/**
Our own packed agent as the product's `own` preset: Node stands on the PATH
as the command and runs the staged agent, which gets the preset's real
`--no-user-mcp-servers` flag.
*/
function ownOnPackedAgent(agentPath: string): AcpPreset {
  return { ...ACP_PRESETS.own, command: path.basename(process.execPath), defaultArgs: [agentPath] }
}

describe('one worker port over every kind a surface runs', () => {
  it('claims each kind through the first port that runs it, and leaves an unclaimed kind unavailable', async () => {
    const rig = await makeRig({ agent: MUSE_AGENT, withoutMuse: true })
    const kinds = ['engine', 'museCode', 'external'] as const
    const agent = (kind: (typeof kinds)[number]): TeamAgentRef => ({ ...MUSE_AGENT, kind })
    expect(kinds.map((kind) => rig.workers.canRun(agent(kind)))).toEqual([true, true, true])

    const engineOnly = createCompositeTeamWorkerPort([
      enginePortsWithoutWorker({
        repositoryRoot: () => rig.repo,
        storageRoot: path.join(rig.repo, '..', 'storage'),
        isTrusted: () => true,
      }).workers,
    ])
    expect(kinds.map((kind) => engineOnly.canRun(agent(kind)))).toEqual([true, false, false])
    await expect(engineOnly.probe(agent('museCode'))).rejects.toThrow(
      fill(TEAM_MODEL_TEXT.hostKindNotOffered, { kind: 'museCode' }),
    )
  })

  it.skipIf(MUSE === undefined)(
    'runs a Muse Code worker on the team’s own host, reuses that host, and stops it with the team',
    async () => {
      const rig = await makeRig({ agent: MUSE_AGENT })
      expect(await rig.workers.probe(MUSE_AGENT)).toBe(true)
      const first = await delegate(rig, 'engineering', `Say exactly this:\n${ECHOED_REPORT}`)
      const firstEnd = await settled(rig, first)
      expect(firstEnd).toEqual({ phase: 'done', failure: '' })
      const second = await delegate(rig, 'engineering', `Say exactly this:\n${ECHOED_REPORT}`)
      const secondEnd = await settled(rig, second)
      expect(secondEnd.phase).toBe('done')

      // One `muse serve` for the team, however many Muse Code workers ran on it.
      const hosts = launchRecords(rig).filter((record) => record.taskId === 'muse-host-team')
      expect(hosts).toHaveLength(1)
      const pid = hosts[0]?.pid ?? 0
      expect(isProcessAlive(pid)).toBe(true)

      await rig.service.dispose()
      await rig.processPorts.dispose()
      await expect.poll(() => isProcessAlive(pid), { timeout: 10_000 }).toBe(false)
    },
    WORKER_TEST_TIMEOUT_MS,
  )

  it.skipIf(MUSE === undefined || process.platform === 'win32')(
    'runs a read-only role on a second host that Muse Code itself keeps from writing and from the shell',
    async () => {
      const rig = await makeRig({ agent: MUSE_AGENT })
      const research = await delegate(rig, 'research', `Say exactly this:\n${ECHOED_REPORT}`)
      const researchEnd = await settled(rig, research)
      expect(researchEnd.phase).toBe('done')
      const hosts = launchRecords(rig).filter((record) => record.taskId.startsWith('muse-host-'))
      expect(hosts.map((record) => record.taskId)).toEqual(['muse-host-readOnly'])
      const args = processArguments(hosts[0]?.pid ?? 0)
      expect(args).toContain('--disable-write')
      expect(args).toContain('--disable-shell')
    },
    WORKER_TEST_TIMEOUT_MS,
  )

  it.skipIf(MUSE === undefined)(
    'refuses a dispatch to a Muse Code that was installed at setup and is gone, naming it, and starts nothing',
    async () => {
      const rig = await makeRig({ agent: MUSE_AGENT })
      expect(await rig.workers.probe(MUSE_AGENT)).toBe(true)
      rig.hasMuse = false
      const task = await delegate(rig, 'engineering', 'any work')
      const end = await settled(rig, task)
      expect(end.phase).toBe('failed')
      expect(end.failure).toBe(TEAM_MODEL_TEXT.hostMuseNotFound)
      expect(launchRecords(rig)).toEqual([])
    },
  )

  it.skipIf(MUSE === undefined)(
    'loads its process ports on the first Muse Code task through the team host entry and stops them with the service',
    async () => {
      const root = await realpath(await mkdtemp(path.join(tmpdir(), 'muse-team-entry-')))
      roots.push(root)
      const { repo, storage } = await initRigFolders(root)
      const home = path.join(root, 'home')
      await mkdir(home, { recursive: true })
      const journal = path.join(root, 'journal')
      const stateValues = new Map<string, unknown>([
        [TEAM_WORKSPACE_KEYS.team, storedTeam(MUSE_AGENT)],
      ])
      const cards: TeamCardItem[] = []
      const service = await createTeamHost(UI_TEXT, 'en', {
        ...realServiceDeps({
          orchestrator: ORCHESTRATOR,
          isTrusted: () => true,
          cards,
          state: fileState(path.join(root, 'state.json'), stateValues),
        }),
        paid: { allowKeyTasks: () => Promise.resolve(true) },
        engine: {
          repositoryRoot: () => repo,
          storageRoot: storage,
          platform: process.platform,
          isTrusted: () => true,
          listModels: () => Promise.reject(new Error('the engine is not asked here')),
          startWorker: () => Promise.reject(new Error('the engine is not asked here')),
          runGit: realTeamGit,
          now: () => Date.now(),
          log: silentCoreLog(),
        },
        processWorkers: processWorkerDeps({
          repo,
          storage,
          journal,
          env: isolatedRuntimeEnvironment(home, root),
          isTrusted: () => true,
          resolve: (launch) => launch,
          pathEntries: () => [],
        }),
      })
      await service.probeEntries()
      const answer = await service.teamRunner.delegate(
        {
          tasks: [
            {
              role: 'engineering',
              brief: `Say exactly this:\n${ECHOED_REPORT}`,
              reason: { code: 'parallel', detail: 'independent work' },
            },
          ],
        },
        toolContext(ORCHESTRATOR),
      )
      const taskId = (JSON.parse(answer.output) as { tasks: { task_id: string }[] }).tasks[0]
        ?.task_id
      expect(taskId).toBeDefined()
      const end = await settled({ stateValues }, taskId ?? '')
      expect(end).toEqual({ phase: 'done', failure: '' })
      const hosts = launchRecords({ journal }).filter(
        (record) => record.taskId === 'muse-host-team',
      )
      expect(hosts).toHaveLength(1)
      const pid = hosts[0]?.pid ?? 0
      expect(isProcessAlive(pid)).toBe(true)
      await service.dispose()
      await expect.poll(() => isProcessAlive(pid), { timeout: 10_000 }).toBe(false)
    },
    WORKER_TEST_TIMEOUT_MS,
  )

  it('keeps an entry whose Muse Code is not installed out of the roster', async () => {
    const rig = await makeRig({ agent: MUSE_AGENT, withoutMuse: true })
    expect(await rig.workers.probe(MUSE_AGENT)).toBe(false)
    await expect(delegate(rig, 'engineering', 'any work')).rejects.toThrow(
      'every entry of role engineering is at a limit or unavailable',
    )
  })
})

/** A preset with Node standing on the PATH as its command: found, then run or refused by its own switch. */
function nodeAsAgent(agent: TeamAgentRef): Parameters<typeof makeRig>[0] {
  const id = agent.agentId as 'own' | 'codex'
  return {
    agent,
    presets: {
      ...ACP_PRESETS,
      [id]: { ...ACP_PRESETS[id], command: path.basename(process.execPath) },
    },
    pathEntries: [path.dirname(process.execPath)],
  }
}

describe.skipIf(process.platform === 'win32')('external agent workers', () => {
  it('does not start an agent that has no switch for leaving out the person’s MCP servers', async () => {
    const rig = await makeRig(nodeAsAgent({ ...OWN_AGENT, agentId: 'codex' }))
    // Codex has only a per-server switch: the command is found, nothing starts.
    const refused = await delegate(rig, 'engineering', 'any work')
    const refusal = await settled(rig, refused)
    expect(refusal.phase).toBe('failed')
    expect(refusal.failure).toBe(fill(TEAM_MODEL_TEXT.hostExternalNoSwitch, { agent: 'codex' }))
    expect(launchRecords(rig)).toEqual([])
  })

  it('names the command it did not find on the PATH once it is gone', async () => {
    const rig = await makeRig(nodeAsAgent(OWN_AGENT))
    expect(await rig.workers.probe(OWN_AGENT)).toBe(true)
    rig.pathEntries = []
    const task = await delegate(rig, 'engineering', 'any work')
    const end = await settled(rig, task)
    expect(end.phase).toBe('failed')
    expect(end.failure).toBe(
      fill(TEAM_MODEL_TEXT.hostExternalNotFound, { command: path.basename(process.execPath) }),
    )
  })

  it(
    'refuses the real agent’s session in words while the person’s Muse settings turn an MCP server on',
    async () => {
      const agentPath = path.join(staged.directory, 'dist', 'acp.js')
      const rig = await makeRig({
        agent: OWN_AGENT,
        presets: { ...ACP_PRESETS, own: ownOnPackedAgent(agentPath) },
        pathEntries: [path.dirname(process.execPath)],
      })
      // The worker's environment keeps HOME and drops XDG_CONFIG_HOME: the agent reads ~/.config/muse.
      const configured = path.join(path.dirname(rig.repo), 'home', '.config', 'muse')
      await mkdir(configured, { recursive: true })
      await writeFile(
        path.join(configured, 'settings.json'),
        JSON.stringify({ schema_version: 1, mcpServers: { docs: { command: 'node' } } }),
      )
      const task = await delegate(rig, 'engineering', 'any work')
      const end = await settled(rig, task)
      expect(end.phase).toBe('failed')
      // The ACP error's own words reach the person, behind the protocol's fixed prefix.
      expect(end.failure).toContain(UI_TEXT.acpUserMcpServersConfigured)
    },
    WORKER_TEST_TIMEOUT_MS,
  )

  it(
    'tells the person to sign in with the agent’s own CLI when the real agent has no sign-in',
    async () => {
      const agentPath = path.join(staged.directory, 'dist', 'acp.js')
      const rig = await makeRig({
        agent: OWN_AGENT,
        presets: { ...ACP_PRESETS, own: ownOnPackedAgent(agentPath) },
        pathEntries: [path.dirname(process.execPath)],
      })
      const task = await delegate(rig, 'engineering', 'any work')
      const end = await settled(rig, task)
      expect(end).toEqual({ phase: 'failed', failure: TEAM_MODEL_TEXT.hostExternalNotSignedIn })
      // The agent was a real contained child, and it is gone with its task.
      const children = launchRecords(rig).filter((record) => record.taskId === task)
      expect(children).toHaveLength(1)
      await expect
        .poll(() => isProcessAlive(children[0]?.pid ?? 0), { timeout: 10_000 })
        .toBe(false)
    },
    WORKER_TEST_TIMEOUT_MS,
  )
})
