// Live enabled-team drill (MUSE_LIVE_E2E=1 only, never CI): one real team
// run through the real `TeamHostService` with a real worker turn on the
// cheapest contributor model (`muse-spark-1.3-contributor`) through the real
// Muse Code CLI, in an empty scratch git workspace.
//
// Expected FIRST: at most 12 billed contributor-model calls (brief cap) —
// one headless exec turn that writes the dictated bytes and hands back the
// charter's fenced report block. Observed 3-4 calls across runs; the worker
// sometimes retries a tool call. `--max-model-steps 12` backstops the turn
// and the record audit below refuses more than 12.
//
// What is product and what is driver: every team surface is the product —
// team creation, admission, dispatch, the charter and prompt builders, the
// museCode worker runner, the fence and native helper, collect and merge.
// The driver only assembles ports: an exec-backed worker session (one
// `muse exec` per worker prompt; lane W's held session and tool mapping do
// not exist yet), the prebuilt native helper binary, and scratch git setup.
// `--disable-reminders` keeps the count to the worker's own turn; the
// record audit names the model line it counts.
//
// Cost: state the cap first (12 model calls on the contributor tier, MUSE_LIVE_E2E=1 opt-in).
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod/mini'
import {
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_MODEL_ID,
  type TeamToolGroup,
} from '../../src/shared/constants'
import type { TeamAgentRef } from '../../src/shared/team'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import { createTeamHostService } from '../../src/core/team/teamHost'
import type {
  TeamHostService,
  TeamTaskSpec,
  TeamWorkerOutcome,
  TeamWorkerPort,
} from '../../src/core/team/teamHostService'
import { builtinRoles } from '../../src/core/team/builtInRoles'
import { buildTeamCharter } from '../../src/core/team/charter'
import { buildWorkerPrompt } from '../../src/core/team/workers/engineWorker'
import { resolveTeamToolset } from '../../src/core/team/toolsets'
import {
  runMuseCodeWorker,
  type MuseWorkerHostPort,
  type MuseWorkerSessionPort,
} from '../../src/core/team/workers/museCodeWorker'
import { WORKER_NATIVE_IO } from '../../src/core/team/workers/workerFence'
import {
  commitTaskBranch,
  publishTaskRef,
  resolveBaseCommit,
  startTeamWorkspace,
} from '../../src/core/team/teamWorkspaces'
import type { TeamGit } from '../../src/core/team/teamGit'
import { createEngineTeamPorts } from '../../src/host/team/teamEnginePorts'
import type { TeamToolContext } from '../../src/core/team/teamSeams'
import { availabilityState } from '../unit/helpers/teamAvailabilityRig'

const isLiveEnabled = process.env['MUSE_LIVE_E2E'] === '1'
const LIVE_MODEL_ID = `${DEFAULT_MODEL_ID}${CONTRIBUTOR_MODEL_SUFFIX}`
const DICTATED_BYTES = 'team-live-drill-ok'
const DRILL_TIMEOUT_MS = 300_000
// A genuinely long operation: one contributor-model turn plus git, the
// native helper and merge, on a shared rig.

const execFileAsync = promisify(execFile)
const git: TeamGit = async (args, cwd, input, env) => {
  const { spawn } = await import('node:child_process')
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', [...args], { cwd, env: env ?? process.env })
    if (input !== undefined) {
      child.stdin.write(input)
      child.stdin.end()
    }
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`git exited ${String(code)}`))
    })
  })
  return new Uint8Array(Buffer.concat(chunks))
}

function context(): TeamToolContext {
  return {
    sessionId: 'live-team-1',
    approvalMode: 'manual',
    signal: new AbortController().signal,
    orchestratorModelId: DEFAULT_MODEL_ID,
  }
}

function note(text: string): void {
  process.stderr.write(`[team-live-drill] ${text}\n`)
}

/** Model-call audit for one exec session: trace inspect first, provider lines second. */
async function countSessionCalls(
  sessionId: string,
): Promise<{ calls: number; sessionLog: string }> {
  const sessionsRoot = path.join(homedir(), '.local', 'share', 'muse', 'sessions')
  const now = new Date()
  const candidates = [
    path.join(
      sessionsRoot,
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      sessionId,
      'session.jsonl',
    ),
  ]
  let sessionLog = ''
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8')
      sessionLog = candidate
      break
    } catch {
      continue
    }
  }
  if (sessionLog === '') throw new Error(`no session record for ${sessionId}`)
  const inspected = await execFileAsync(
    'muse',
    [
      'trace',
      'inspect',
      '--session-log',
      sessionLog,
      '--render-mode',
      'compact',
      '--format',
      'json',
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  )
  const report = JSON.parse(inspected.stdout) as {
    timeline?: readonly { payload_type?: unknown; label?: unknown }[]
    summary?: { usage?: unknown }
  }
  const timeline = report.timeline ?? []
  // Two distinct record families mark one model call each: the created
  // response and the completed model turn. Both must agree.
  const responses = timeline.filter(
    (entry) => entry.payload_type === 'agent.run' && entry.label === 'model response created',
  ).length
  const completed = timeline.filter(
    (entry) => entry.payload_type === 'agent.run' && entry.label === 'model completed',
  ).length
  note(
    `session ${sessionId}: responses ${String(responses)}, completed ${String(completed)}, usage ${JSON.stringify(report.summary?.usage ?? null)}`,
  )
  if (responses !== completed) {
    throw new Error(
      `count mismatch: responses ${String(responses)} vs completed ${String(completed)}`,
    )
  }
  return { calls: responses, sessionLog }
}

const NATIVE_HELPER = path.join(
  process.cwd(),
  'native',
  'linux',
  process.arch === 'x64' ? 'x64' : process.arch,
  'muse-created',
)

function makeService(args: {
  repoRoot: string
  storageRoot: string
  promptFile: string
  sessionIds: string[]
}): { service: TeamHostService; cards: readonly unknown[] } {
  const { repoRoot, storageRoot, promptFile, sessionIds } = args
  const values = new Map<string, unknown>()
  const cards: unknown[] = []
  const paid = {
    allowKeyTasks: (tasks: readonly unknown[]): Promise<boolean> => {
      // The drill staffs no key-billing entry: a key task here is a bug.
      if (tasks.length > 0) throw new Error('live drill must not bill key tasks')
      return Promise.resolve(true)
    },
  }
  const settings = {
    isTeamOn: () => true,
    isTeamWorkersOn: () => true,
    maxWorkers: () => 1,
    isTrusted: () => true,
    maxStopContinuations: () => 0,
  }
  const io = { ...WORKER_NATIVE_IO, workerNativeOperation: runNativeHelper }
  const workers: TeamWorkerPort = {
    canRun: (agent: TeamAgentRef) => agent.kind === 'museCode',
    probe: async (agent: TeamAgentRef) => {
      // Free model-resolution check: no model call, no billing.
      try {
        await execFileAsync('muse', ['model-profile', 'show', agent.model], {
          maxBuffer: 4 * 1024 * 1024,
        })
        return true
      } catch {
        return false
      }
    },
    run: async (spec: TeamTaskSpec, signal: AbortSignal) => {
      const builtin = builtinRoles().find((role) => role.id === spec.role.role)
      if (builtin === undefined) throw new Error(`no builtin role ${spec.role.role}`)
      const baseCommit = await resolveBaseCommit(git, repoRoot)
      const workspace = await startTeamWorkspace(git, storageRoot, process.platform, {
        repositoryRoot: repoRoot,
        role: spec.role.role,
        taskId: spec.taskId,
        mode: 'own-branch',
        baseCommit,
      })
      if (workspace.branch === undefined) {
        throw new Error('own-branch workspace needs a branch')
      }
      const tools = resolveTeamToolset(
        { groups: builtin.tools as readonly TeamToolGroup[] },
        {
          offered: builtin.tools,
          webSearchAllowed: false,
          imagesAllowed: false,
          delegates: [],
        },
      )
      const charter = buildTeamCharter(
        {
          id: builtin.id,
          description: builtin.description,
          workspace: 'own-branch',
          writePaths: builtin.writePaths,
          done: builtin.done,
          report: builtin.report,
          delegates: [],
          body: builtin.body,
        },
        tools,
      )
      const prompt = await buildWorkerPrompt(
        { charter: charter.generated, body: charter.body, rulesAndSkills: '' },
        {
          taskId: spec.taskId,
          roleId: spec.role.role,
          brief: spec.brief,
          branch: workspace.branch,
          folder: workspace.folder,
          files: spec.files,
        },
        io,
        process.platform,
        repoRoot,
      )
      const hosts: {
        teamHost: () => Promise<MuseWorkerHostPort>
        readOnlyHost: () => Promise<never>
      } = {
        teamHost: () =>
          Promise.resolve({
            hostId: 'live-drill-cli',
            kind: 'team' as const,
            startSession: (options: {
              workspaceRoot: string
              modelId: string
            }): Promise<MuseWorkerSessionPort> => {
              const sessionId = randomUUID()
              sessionIds.push(sessionId)
              let child: ChildProcess | undefined
              return Promise.resolve({
                sessionId,
                sendPrompt: async (text: string) => {
                  await writeFile(promptFile, text, 'utf8')
                  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>(
                    (resolve, reject) => {
                      child = spawn(
                        'muse',
                        [
                          'exec',
                          '--model',
                          options.modelId,
                          '--contributor-mode',
                          'on',
                          '--approval-mode',
                          'never',
                          '--disable-reminders',
                          '--max-model-steps',
                          '12',
                          '--session-id',
                          sessionId,
                          '--workspace',
                          options.workspaceRoot,
                          '--prompt-file',
                          promptFile,
                        ],
                        { cwd: options.workspaceRoot },
                      )
                      let stdout = ''
                      let stderr = ''
                      child.stdout!.on('data', (chunk: Buffer) => {
                        stdout += chunk.toString()
                      })
                      child.stderr!.on('data', (chunk: Buffer) => {
                        stderr += chunk.toString()
                      })
                      child.on('error', reject)
                      child.on('close', (code) => {
                        resolve({ code, stdout, stderr })
                      })
                    },
                  )
                  const finished = await done
                  if (finished.code !== 0) {
                    throw new Error(`worker exec failed: ${finished.stderr.slice(-2000)}`)
                  }
                  return { lastMessage: finished.stdout, stopReason: 'end_turn' as const }
                },
                cancel: () => {
                  child?.kill()
                  return Promise.resolve()
                },
                dispose: () => undefined,
              })
            },
          }),
        readOnlyHost: () => Promise.reject(new Error('live drill staffs no read-only worker')),
      }
      const result = await runMuseCodeWorker({
        task: {
          taskId: spec.taskId,
          roleId: spec.role.role,
          brief: spec.brief,
          branch: workspace.branch,
          folder: workspace.folder,
          files: spec.files,
        },
        role: {
          roleId: spec.role.role,
          workspaceMode: 'own-branch',
          toolGroups: tools.groups,
          reportShape: 'summary',
        },
        prompt,
        modelId: spec.entry.agent.model,
        workspaceRoot: repoRoot,
        platform: process.platform,
        io,
        exclusiveUserServers: [],
        isTrusted: true,
        bridgeServers: {},
        hosts,
        signal,
      })
      if (!result.report.ok) {
        throw new Error(`worker report failed: ${result.report.status}: ${result.report.summary}`)
      }
      // The product end-of-task: the extension commits the copy, publishes
      // the agents ref and lists the changed files (teamEnginePorts).
      // `workspace.branch` is narrowed by the own-branch guard after setup.
      const committed = await commitTaskBranch(git, workspace.folder, {
        branch: workspace.branch,
        role: spec.role.role,
        taskId: spec.taskId,
        entryId: spec.entry.id,
      })
      if (committed.committed && workspace.agentsRef !== undefined) {
        await publishTaskRef(
          git,
          repoRoot,
          workspace.folder,
          workspace.branch,
          workspace.agentsRef,
          baseCommit,
        )
      }
      const changed = new TextDecoder()
        .decode(
          await git(
            ['diff', '--name-only', '-z', '--no-renames', baseCommit, committed.head, '--'],
            workspace.folder,
          ),
        )
        .split('\0')
        .filter((name) => name !== '')
      const { calls } = await countSessionCalls(result.sessionId)
      const outcome: TeamWorkerOutcome = {
        report: result.report.report,
        usage: {
          input: 0,
          cachedInput: 0,
          output: 0,
          reasoning: 0,
          modelCalls: calls,
          estimated: true,
        },
        folder: workspace.folder,
        branch: workspace.branch,
        baseCommit,
        head: committed.head,
        changedFiles: changed,
        ...(workspace.agentsRef !== undefined && { agentsRef: workspace.agentsRef }),
      }
      return outcome
    },
  }
  const engine = createEngineTeamPorts({
    repositoryRoot: () => repoRoot,
    storageRoot,
    platform: process.platform,
    isTrusted: () => true,
    listModels: () => Promise.resolve([] as readonly string[]),
    startWorker: () => Promise.reject(new Error('live drill never starts engine workers')),
    now: () => Date.now(),
    log: {
      info: () => undefined,
      warn: (message: string) => {
        note(`warn: ${message}`)
      },
      trace: () => undefined,
      error: (message: string) => {
        note(`error: ${message}`)
      },
    },
    runGit: git,
  })
  // The snapshot reads at construction: seed the stored team first.
  values.set(TEAM_WORKSPACE_KEYS.team, {
    intensity: 'balanced',
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
              kind: 'museCode',
              agentId: 'museCode',
              model: LIVE_MODEL_ID,
              pays: 'subscription',
            },
          },
        ],
      },
    ],
  })
  const service = createTeamHostService({
    hooks: undefined,
    state: availabilityState(values),
    settings,
    orchestrator: {
      modelId: () => DEFAULT_MODEL_ID,
      backend: () => 'modelApi',
      // The tree reads the conversation's live mode here; the drill is manual.
      approvalMode: () => 'manual',
    },
    workers,
    merges: engine.merges,
    paid,
    cards: {
      show: (...args: unknown[]) => {
        cards.push(args)
      },
    },
    newId: (() => {
      let next = 1
      return () => `live-${String(next++)}`
    })(),
    now: () => Date.now(),
    log: {
      info: () => undefined,
      warn: (message: string) => {
        note(`warn: ${message}`)
      },
    },
  })
  return { service, cards }
}

interface LivePorts {
  service: TeamHostService
  repoRoot: string
  storageRoot: string
  promptFile: string
  sessionIds: string[]
  cards: readonly unknown[]
}

async function runNativeHelper(
  proof: {
    root: string
    rootIdentity: string
    ancestor: string
    ancestorIdentity: string
    remaining: string
  },
  op: string,
  id = '',
): Promise<{ identity: string; createdFolders: number }> {
  const { stdout } = await execFileAsync(
    NATIVE_HELPER,
    [
      op,
      proof.root,
      proof.rootIdentity,
      proof.ancestor,
      proof.ancestorIdentity,
      proof.remaining,
      id,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  return z
    .strictObject({ identity: z.string(), createdFolders: z.number() })
    .parse(JSON.parse(stdout))
}

function answerText(result: { output: string }): Record<string, unknown> {
  return JSON.parse(result.output) as Record<string, unknown>
}

describe.skipIf(!isLiveEnabled)('live enabled team on the contributor model', () => {
  // D227: no release latch stands before teams any more.
  let workspace = ''
  let ports: LivePorts | undefined
  let liveSessionId = process.env['TEAM_LIVE_SESSION'] ?? ''

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'team-live-'))
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: workspace })
    await execFileAsync('git', ['config', 'user.email', 'drill@example.invalid'], {
      cwd: workspace,
    })
    await execFileAsync('git', ['config', 'user.name', 'team-live-drill'], { cwd: workspace })
    await writeFile(path.join(workspace, 'README.md'), '# live drill workspace\n', 'utf8')
    await execFileAsync('git', ['add', '.'], { cwd: workspace })
    await execFileAsync('git', ['commit', '-m', 'drill base'], { cwd: workspace })
    const storageRoot = await mkdtemp(path.join(tmpdir(), 'team-live-storage-'))
    const promptFile = path.join(workspace, '..', `team-live-prompt-${process.pid.toString()}.md`)
    const sessionIds: string[] = []
    const { service, cards } = makeService({
      repoRoot: workspace,
      storageRoot,
      promptFile,
      sessionIds,
    })
    // The tree probes entries on open; without it every entry reads unavailable.
    await service.probeEntries()
    ports = { service, repoRoot: workspace, storageRoot, promptFile, sessionIds, cards }
  }, DRILL_TIMEOUT_MS)

  afterAll(async () => {
    if (workspace !== '') await rm(workspace, { recursive: true, force: true })
    if (ports !== undefined && ports.storageRoot !== '') {
      await rm(ports.storageRoot, { recursive: true, force: true })
    }
  })

  it(
    'delegates, collects and merges a worker turn',
    async () => {
      if (ports === undefined) throw new Error('drill ports missing')
      const { service, repoRoot, cards } = ports
      const delegated = answerText(
        await service.teamRunner.delegate(
          {
            tasks: [
              {
                role: 'engineering',
                brief: `Write exactly these bytes (no trailing newline) to hello-team.txt in the working copy root: ${DICTATED_BYTES}. Then hand back your report.`,
                reason: { code: 'parallel', detail: 'live drill single worker' },
                entry: 'e1',
              },
            ],
          },
          context(),
        ),
      )
      note(`delegate answer: ${JSON.stringify(delegated).slice(0, 1000)}`)
      const started = delegated['tasks'] as
        { task_id?: string; refused?: unknown; entry?: string }[] | undefined
      const first = started?.[0]
      if (first === undefined || started?.length !== 1 || first.task_id === undefined) {
        throw new Error(`delegate did not start one task: ${JSON.stringify(delegated)}`)
      }
      const taskId = first.task_id
      note(`delegated ${taskId}`)
      let state = ''
      const deadline = Date.now() + 240_000
      while (Date.now() < deadline) {
        const collected = answerText(
          await service.teamRunner.collect({ task_ids: [taskId], wait_seconds: 60 }, context()),
        )
        const tasks = collected['tasks'] as { state: string }[] | undefined
        state = tasks?.[0]?.state ?? ''
        if (['done', 'failed', 'cancelled'].includes(state)) break
      }
      note(`collect settled: ${state}`)
      expect(state).toBe('done')
      // The tree's Merge path performs the whole merge: the first click
      // starts the flow and stops at the merge card, the second answers it.
      const mergeCards = (): { status: unknown; teamDecision: unknown }[] =>
        cards
          .map((shown) => {
            const item = (shown as readonly unknown[])[1] as
              { kind?: unknown; status?: unknown; teamDecision?: unknown } | undefined
            return item
          })
          .filter((item) => item?.kind === 'teamMerge')
          .map((item) => ({ status: item?.status, teamDecision: item?.teamDecision }))
      await service.decideMerge(taskId, 'merge')
      if (mergeCards().every((card) => card.status !== 'completed')) {
        await service.decideMerge(taskId, 'merge')
      }
      const decided = mergeCards().filter((card) => card.status === 'completed')
      expect(decided).toMatchObject([{ status: 'completed', teamDecision: 'merge' }])
      note(`merged ${taskId}`)
      const bytes = await readFile(path.join(repoRoot, 'hello-team.txt'), 'utf8')
      expect(bytes).toBe(DICTATED_BYTES)
      liveSessionId = ports.sessionIds[0] ?? ''
      note(`worker session ${liveSessionId}`)
      expect(liveSessionId).not.toBe('')
    },
    DRILL_TIMEOUT_MS,
  )

  it(
    'the run cost at most 12 contributor-model calls',
    async () => {
      const sessionId =
        liveSessionId === '' ? (process.env['TEAM_LIVE_SESSION'] ?? '') : liveSessionId
      if (sessionId === '') {
        note('no worker session recorded; run the flow test first')
      } else {
        const { calls, sessionLog } = await countSessionCalls(sessionId)
        note(`session record: ${sessionLog}`)
        expect(calls).toBeGreaterThan(0)
        expect(calls).toBeLessThanOrEqual(12)
      }
    },
    DRILL_TIMEOUT_MS,
  )
})
