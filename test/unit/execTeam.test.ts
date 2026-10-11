// Real exec/engine/team/merge against captured fake Model API frames and real Git.
import '../../src/host/team/teamHostEntry'
import { createExecTeam } from '../../src/runtime/exec/execTeamEntry'
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { createServer } from 'node:http'
import { EventEmitter, once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { Usd } from '../../src/shared/usd'
import { runExec, type ExecDeps } from '../../src/runtime/exec/runExec'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { validateSchemaEvent, validateSchemaResult } from '../../src/runtime/exec/execOutput'
import { agentDataFolder, workspaceKey } from '../../src/runtime/dataFolder'
import {
  ACP_SESSIONS_SUBFOLDER,
  SECRET_KEYS,
  EXEC_TEAM_STATE_FILE,
  UI_TEXT,
  TEAM_MODEL_TEXT,
} from '../../src/shared/constants'
import { type TeamSnapshot } from '../../src/shared/team'
import {
  fakeModelApi,
  FAKE_MODEL_API_KEY,
  type ScriptedReply,
  type ScriptedCall,
} from './helpers/fakeModelApi'
import { memorySecrets } from './helpers/fakes'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { outputWriter } from './helpers/execContract'
import { cleanupTeamRoots, teamFixtureRepo, teamGitRunner, trackTeamRoot } from './helpers/teamGit'

cleanupTeamRoots()
const git = teamGitRunner()
const built = { dist: '' }
beforeAll(async () => {
  built.dist = await mkdtemp(path.join(tmpdir(), 'm96b-dist-'))
  trackTeamRoot(built.dist)
  await buildModelApiBundle(built.dist)
  await copyFile('vendor/models-dev/snapshot.json', path.join(built.dist, 'providerCatalog.json'))
})
afterAll(() => {
  vi.restoreAllMocks()
})
// Full engine loop clones, commits, verifies, merges and removes real Git copies.
const REAL_GIT_TIMEOUT_MS = 30_000
function noSignalCleanup(): void {
  // The fixture delivers lifecycle causes directly.
}
function ignoreSignals(): () => void {
  return noSignalCleanup
}
const PARENT = 'muse-spark-1.3-contributor'
const WORKER = 'muse-spark-1.3'
const REPORT = '```muse-team-report\n{"status":"done","summary":"Changed tracked file"}\n```'
const team: TeamSnapshot = {
  intensity: 'balanced',
  roles: [
    {
      role: 'engineering',
      exhausted: 'ask',
      pool: [
        {
          id: 'writer',
          concurrent: 2,
          caps: [],
          agent: { kind: 'engine', agentId: 'worker', model: WORKER, pays: 'key' },
        },
      ],
    },
  ],
}
const call = (name: string, args: unknown): ScriptedCall => ({
  name,
  arguments: JSON.stringify(args),
})
const delegation = {
  tasks: [
    {
      role: 'engineering',
      brief: 'Change tracked.txt',
      files: ['tracked.txt'],
      reason: { code: 'different_model', detail: 'Use writer model' },
    },
  ],
}
const bodySchema = z.object({ model: z.string(), input: z.array(z.unknown()) })
const toolOutputSchema = z.object({ type: z.literal('function_call_output'), output: z.string() })
const taskOutputSchema = z.object({
  tasks: z.array(z.object({ task_id: z.string(), state: z.string() })),
})
function lastTask(input: readonly unknown[]) {
  for (const item of input.toReversed()) {
    const output = toolOutputSchema.safeParse(item)
    if (!output.success || !output.data.output.startsWith('{')) continue
    const tasks = taskOutputSchema.safeParse(JSON.parse(output.data.output))
    if (tasks.success && tasks.data.tasks[0] !== undefined) return tasks.data.tasks[0]
  }
  return undefined
}
async function fixture(snapshot: TeamSnapshot | null = team, budget = '2') {
  const { root } = await teamFixtureRepo(git)
  const cwd = await realpath(root)
  const homeDir = await mkdtemp(path.join(tmpdir(), 'm96b-home-'))
  trackTeamRoot(homeDir)
  const parsed = parseCommandLine([
    'exec',
    '--team',
    '--backend',
    'modelApi',
    '--max-budget-usd',
    budget,
    '--permission-mode',
    'acceptEdits',
    '--model',
    PARENT,
    '--allow-contributor-models',
    '--ephemeral',
    '--output',
    'jsonl',
    'task',
  ])
  if (parsed.command !== 'exec') throw new Error(JSON.stringify(parsed))
  const api = fakeModelApi()
  const store = memorySecrets()
  await store.store(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  const out = outputWriter()
  const err = outputWriter()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const clock = {
    now: Date.now,
    setTimer(ms: number, run: () => void) {
      const timer = setTimeout(run, ms)
      return () => {
        clearTimeout(timer)
      }
    },
  }
  const life = createLifecycle({
    ...clock,
    processStartMs: clock.now(),
    timeoutMs: parsed.options.timeoutMs,
    onSignal: ignoreSignals,
    forceFinish: vi.fn(),
    exit: (): never => {
      throw new Error('exit')
    },
  })
  const deps: ExecDeps = {
    options: { ...parsed.options, team: true },
    version: 'test',
    distDir: built.dist,
    platform: process.platform,
    env: {},
    homeDir,
    processCwd: cwd,
    stdin: new PassThrough(),
    stdout: out,
    stderr: err,
    storeSecrets: store,
    runGit: async (args, folder) => new TextDecoder().decode(await git(args, folder)),
    fetch: api.fetch,
    sleep: (ms) => delay(ms),
    isUsageHistoryEnabled: () => false,
    now: () => Date.now(),
    readFile: async (file, maximum) => {
      const bytes = await readFile(file)
      if (bytes.length > maximum) throw new Error('too large')
      return bytes
    },
    randomHex: () => '123456789abcdef0',
    log,
  }
  if (snapshot !== null) {
    const folder = path.join(agentDataFolder(deps), ACP_SESSIONS_SUBFOLDER, workspaceKey(cwd))
    await mkdir(folder, { recursive: true })
    await writeFile(path.join(folder, EXEC_TEAM_STATE_FILE), JSON.stringify(snapshot))
  }
  const run = async () => {
    try {
      const code = await runExec(life, deps)
      const events = out.chunks.flatMap((chunk) =>
        chunk
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => validateSchemaEvent(JSON.parse(line))),
      )
      const result = events.find((event) => event.type === 'result')
      return {
        code,
        result: result?.type === 'result' ? validateSchemaResult(result.result) : undefined,
      }
    } finally {
      life.dispose()
    }
  }
  return { deps, cwd, homeDir, api, out, err, log, life, run }
}

function scriptTeam(
  f: Awaited<ReturnType<typeof fixture>>,
  workerCalls: readonly ScriptedCall[] = [
    call('write_file', { path: 'tracked.txt', content: 'after\n' }),
  ],
  shouldMerge = true,
) {
  let parentCalls = 0
  let workerRequests = 0
  let hasMerged = false
  f.deps.fetch = async (url, init) => {
    if (typeof url === 'string' && url.endsWith('/responses') && typeof init?.body === 'string') {
      const body = bodySchema.parse(JSON.parse(init.body))

      let reply: ScriptedReply
      if (body.model === WORKER) {
        workerRequests += 1
        if (workerRequests === 1) {
          const write = workerCalls[0]
          const file =
            write?.name === 'write_file'
              ? z.object({ path: z.string() }).parse(JSON.parse(write.arguments)).path
              : 'tracked.txt'
          reply = { calls: [call('read_file', { path: file })] }
        } else if (workerRequests === 2) reply = { calls: workerCalls }
        else reply = { text: REPORT }
      } else {
        parentCalls += 1
        const task = lastTask(body.input)
        if (parentCalls === 1) reply = { calls: [call('delegate', delegation)] }
        else if (!hasMerged && task?.state === 'done') {
          hasMerged = true
          reply = shouldMerge
            ? { calls: [call('merge', { task_id: task.task_id })] }
            : { text: 'done' }
        } else if (hasMerged || (task === undefined && parentCalls > 1) || task?.state === 'failed')
          reply = { text: 'done' }
        else reply = { calls: [call('collect', { wait_seconds: 2 })] }
      }
      f.api.script(reply)
    }
    return await f.api.fetch(url, init)
  }
  return { workerRequests: () => workerRequests }
}

describe('M96b headless engine team runner', () => {
  it(
    'merges the worker branch into M80 working tree and records every request',
    async () => {
      const f = await fixture()
      const script = scriptTeam(f)
      const { code, result } = await f.run()
      expect(code, f.err.chunks.join('')).toBe(0)
      expect(
        await readFile(path.join(f.cwd, 'tracked.txt'), 'utf8'),
        f.err.chunks.join('') +
          JSON.stringify(
            f.api
              .responseBodies()
              .map((body) => body['input'])
              .map((input) =>
                z
                  .array(z.unknown())
                  .parse(input)
                  .filter((item) => toolOutputSchema.safeParse(item).success),
              ),
          ),
      ).toBe('after\n')
      expect(result?.filesChanged).toContain('tracked.txt')
      expect(result?.usage.requests).toBe(f.api.responseBodies().length)
      expect(result?.usage.costUsd?.reserved).toBe('0')
      expect(result?.terminal).toBe('completed')
      expect(script.workerRequests()).toBe(3)
      expect(new TextDecoder().decode(await git(['diff', '--', 'tracked.txt'], f.cwd))).toContain(
        '+after',
      )
      expect(new TextDecoder().decode(await git(['for-each-ref', 'refs/agents/'], f.cwd))).toBe('')
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'refuses an unaffordable worker before its request is sent',
    async () => {
      const f = await fixture(team, '0.12')
      const script = scriptTeam(f)
      const { result } = await f.run()
      expect(script.workerRequests()).toBe(0)
      expect(result?.status).toBe('budget_exceeded')
      expect(await readFile(path.join(f.cwd, 'tracked.txt'), 'utf8')).toBe('before\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'denies protected worker writes and never merges them',
    async () => {
      const f = await fixture()
      await mkdir(path.join(f.cwd, '.github', 'workflows'), { recursive: true })
      await writeFile(path.join(f.cwd, '.github', 'workflows', 'check.yml'), 'original\n')
      await git(['add', '.github/workflows/check.yml'], f.cwd)
      await git(['commit', '-m', 'protected fixture'], f.cwd)
      scriptTeam(f, [
        call('write_file', { path: '.github/workflows/check.yml', content: 'danger\n' }),
      ])
      const { code } = await f.run()
      expect(code, f.err.chunks.join('')).toBe(0)
      expect(await readFile(path.join(f.cwd, '.github', 'workflows', 'check.yml'), 'utf8')).toBe(
        'original\n',
      )
      const workerInputs = f.api.responseBodies().filter((body) => body['model'] === WORKER)
      expect(JSON.stringify(workerInputs)).toMatch(/denied|refused|protected/i)
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it('uses the ordinary single-model request without a stored team', async () => {
    const f = await fixture(null)
    f.api.script({ text: 'done' })
    const { code } = await f.run()
    expect(code, f.err.chunks.join('')).toBe(0)
    const request = f.api.responseBodies()[0]
    expect(JSON.stringify(request?.['tools'])).not.toContain('delegate')
    expect(f.api.responseBodies()).toHaveLength(1)
    expect(f.api.requests.filter((request) => request.path === '/models')).toHaveLength(1)
  })
  it('refuses Muse Code workers out loud without starting a child', async () => {
    const snapshot: TeamSnapshot = {
      ...team,
      roles: [
        {
          role: 'engineering',
          pool: [
            {
              id: 'cli',
              concurrent: 1,
              caps: [],
              agent: { kind: 'museCode', agentId: 'muse', model: WORKER, pays: 'subscription' },
            },
          ],
        },
      ],
    }
    const f = await fixture(snapshot)
    f.api.script({ text: 'done' })
    const { code } = await f.run()
    expect(code, f.err.chunks.join('')).toBe(0)
    expect(f.err.chunks.join('')).toContain('museCode')
    expect(f.api.responseBodies()).toHaveLength(1)
  })
  it('reads no team state and sends no team traffic when the flag is off', async () => {
    const f = await fixture()
    f.deps.options = { ...f.deps.options, team: false }
    const read = vi.spyOn(f.deps, 'readFile')
    f.api.script({ text: 'done' })
    const { code } = await f.run()
    expect(code, f.err.chunks.join('')).toBe(0)
    expect(read.mock.calls.some(([file]) => file.endsWith(EXEC_TEAM_STATE_FILE))).toBe(false)
    expect(f.api.responseBodies()).toHaveLength(1)
  })
  it('rejects invalid stored state before dispatch', async () => {
    const f = await fixture()
    const folder = path.join(agentDataFolder(f.deps), ACP_SESSIONS_SUBFOLDER, workspaceKey(f.cwd))
    await writeFile(path.join(folder, EXEC_TEAM_STATE_FILE), '{"roles":"invalid"}')
    const { code } = await f.run()
    expect(code).not.toBe(0)
    expect(f.api.responseBodies()).toHaveLength(0)
    expect(await readdir(folder)).toEqual([EXEC_TEAM_STATE_FILE])
  })
})

// Only payload text/tool arguments change: native shape is the owner's Ollama capture.
it(
  'runs a local engine worker keyless over loopback and counts its zero-cost reservation',
  async () => {
    const nativeParent = 'qwen3:4b-instruct-2507-q4_K_M'
    const nativeWorker = 'qwen3:4b'
    const parent = `ollama/${nativeParent}`
    const worker = `ollama/${nativeWorker}`
    const snapshot: TeamSnapshot = {
      intensity: 'balanced',
      roles: [
        {
          role: 'research',
          pool: [
            {
              id: 'local',
              concurrent: 1,
              caps: [],
              agent: {
                kind: 'engine',
                agentId: 'local',
                provider: 'ollama',
                model: worker,
                pays: 'local',
              },
            },
          ],
        },
      ],
    }
    const f = await fixture(snapshot, '0.000001')
    await f.deps.storeSecrets.delete(SECRET_KEYS.modelApiKey)
    const receipt = z.object({ response: z.object({ body: z.string() }) })
    const capture = async (name: string) =>
      receipt.parse(
        JSON.parse(
          await readFile(path.join('docs/certification/m95-captures/ollama', name), 'utf8'),
        ),
      ).response.body
    const [tags, plain, tools] = await Promise.all([
      capture('02-tags.json'),
      capture('03-plain-stream.json'),
      capture('04-two-tool-stream.json'),
    ])
    const lineSchema = z.looseObject({
      model: z.string(),
      done: z.boolean(),
      message: z.looseObject({
        role: z.string(),
        content: z.string(),
        tool_calls: z.optional(
          z.array(
            z.looseObject({
              id: z.string(),
              function: z.looseObject({
                name: z.string(),
                arguments: z.record(z.string(), z.unknown()),
              }),
            }),
          ),
        ),
      }),
    })
    const nativeReply = (model: string, tool: ScriptedCall | undefined) =>
      (tool === undefined ? plain : tools)
        .trim()
        .split('\n')
        .map((line) => {
          const frame = lineSchema.parse(JSON.parse(line))
          frame.model = model
          frame.message.content = tool === undefined && frame.done ? REPORT : ''
          if (tool !== undefined && frame.message.tool_calls !== undefined) {
            const first = frame.message.tool_calls[0]
            if (first === undefined) throw new Error('capture has no tool')
            frame.message.tool_calls = [
              {
                ...first,
                id: `${first.id}-${String(parentCalls)}`,
                function: {
                  ...first.function,
                  name: tool.name,
                  arguments: z.record(z.string(), z.unknown()).parse(JSON.parse(tool.arguments)),
                },
              },
            ]
          }
          return JSON.stringify(frame)
        })
        .join('\n') + '\n'
    let parentCalls = 0
    let workerCalls = 0
    const auth: string[] = []
    const server = createServer((request, response) => {
      if (request.headers.authorization !== undefined) auth.push(request.headers.authorization)
      if (request.url === '/api/tags') {
        response.end(tags)
        return
      }
      const chunks: Uint8Array[] = []
      request.on('data', (chunk: Uint8Array) => {
        chunks.push(chunk)
      })
      request.on('end', () => {
        const body = z
          .object({ model: z.string() })
          .parse(JSON.parse(Buffer.concat(chunks).toString()))
        if (body.model === nativeWorker) {
          workerCalls += 1
          response.end(nativeReply(nativeWorker, undefined))
          return
        }
        parentCalls += 1
        let action: ScriptedCall | undefined
        if (parentCalls === 1)
          action = call('delegate', {
            tasks: [
              {
                role: 'research',
                brief: 'Read tracked.txt',
                reason: { code: 'specialty', detail: 'Read locally' },
              },
            ],
          })
        else if (workerCalls === 0) action = call('collect', { wait_seconds: 2 })
        response.end(nativeReply(nativeParent, action))
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('no loopback address')
      const configFolder = path.join(f.homeDir, '.config', 'muse-spark-code')
      await mkdir(configFolder, { recursive: true })
      await writeFile(
        path.join(configFolder, 'providers.json'),
        JSON.stringify({
          v: 1,
          providers: [
            {
              id: 'ollama',
              preset: 'ollama',
              address: `http://127.0.0.1:${String(address.port)}`,
              auth: 'none',
              models: [nativeParent, nativeWorker],
              modelCapabilities: {
                [nativeParent]: {
                  tools: { calling: { state: 'yes', value: true, source: { kind: 'user' } } },
                },
                [nativeWorker]: {
                  tools: { calling: { state: 'yes', value: true, source: { kind: 'user' } } },
                },
              },
              numCtx: { [nativeParent]: 65_536, [nativeWorker]: 65_536 },
              modelLimits: {
                [nativeParent]: { contextTokens: 65_536, outputTokens: 32_768 },
                [nativeWorker]: { contextTokens: 65_536, outputTokens: 32_768 },
              },
            },
          ],
          defaultModel: parent,
        }),
      )
      f.deps.options = { ...f.deps.options, provider: 'ollama', model: parent }
      f.deps.fetch = globalThis.fetch
      const { code, result } = await f.run()
      expect(code, f.err.chunks.join('') + JSON.stringify(result)).toBe(0)
      expect(workerCalls, JSON.stringify(result)).toBe(1)
      expect(auth).toEqual([])
      expect(result?.usage.costUsd?.total).toBe('0')
      expect(result?.usage.requests).toBe(parentCalls + workerCalls)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  },
  REAL_GIT_TIMEOUT_MS,
)

it('preserves Solo without team probes or tools', async () => {
  const solo = { ...team, template: 'Solo' }
  const f = await fixture(solo)
  f.api.script({ text: 'done' })
  const { code } = await f.run()
  expect(code, f.err.chunks.join('')).toBe(0)
  expect(f.api.responseBodies()).toHaveLength(1)
  expect(JSON.stringify(f.api.responseBodies()[0]?.['tools'])).not.toContain('delegate')
  expect(f.api.requests.filter((request) => request.path === '/models')).toHaveLength(1)
})
it('denies exhausted-pool questions without waiting for a human', async () => {
  const snapshot: TeamSnapshot = {
    ...team,
    roles: team.roles.map((role) => ({
      ...role,
      pool: role.pool.map((entry) => ({
        ...entry,
        caps: [{ measure: 'tasks', window: 'lifetime', amount: 0 }],
      })),
    })),
  }
  const f = await fixture(snapshot)
  const script = scriptTeam(f)
  const { code } = await f.run()
  expect(code, f.err.chunks.join('')).toBe(0)
  expect(script.workerRequests()).toBe(0)
  expect(JSON.stringify(f.api.responseBodies())).toContain(TEAM_MODEL_TEXT.hostWaitingCancelled)
})
it('refuses repository cap increases before model dispatch', async () => {
  const f = await fixture()
  await mkdir(path.join(f.cwd, '.muse'), { recursive: true })
  await writeFile(
    path.join(f.cwd, '.muse', 'team.json'),
    JSON.stringify({ roles: { engineering: { caps: { concurrent: 3 } } } }),
  )
  const { code } = await f.run()
  expect(code).not.toBe(0)
  expect(f.api.responseBodies()).toHaveLength(0)
  expect(f.err.chunks.join('')).toContain('raises')
})
it(
  'removes an unmerged worker copy and its owned ref when the run ends',
  async () => {
    const f = await fixture()
    const script = scriptTeam(
      f,
      [call('write_file', { path: 'tracked.txt', content: 'after\n' })],
      false,
    )
    const { code } = await f.run()
    expect(code, f.err.chunks.join('')).toBe(0)
    expect(script.workerRequests()).toBe(3)
    expect(await readFile(path.join(f.cwd, 'tracked.txt'), 'utf8')).toBe('before\n')
    expect(new TextDecoder().decode(await git(['for-each-ref', 'refs/agents/'], f.cwd))).toBe('')
  },
  REAL_GIT_TIMEOUT_MS,
)

it('shutdown waits for initialization before removing run storage', async () => {
  const f = await fixture()
  const gate = new EventEmitter()
  const entered = once(gate, 'entered')
  const service = await createExecTeam(
    {
      dataFolder: agentDataFolder(f.deps),
      cwd: f.cwd,
      platform: process.platform,
      provider: undefined,
      defaultPays: 'key',
      budgetUsd: f.deps.options.budgetUsd ?? Usd.from(2).toAmount(),
      signal: f.life.signal,
      now: () => Date.now(),
      log: f.log,
      readFile: f.deps.readFile,
      listModels: async () => {
        const released = once(gate, 'release')
        gate.emit('entered')
        await released
        return [PARENT, WORKER]
      },
      startWorker: () => {
        throw new Error('initialization starts no worker')
      },
      onWritten: () => undefined,
      secretLiterals: () => [],
      lowerWorkerCap: () => undefined,
    },
    UI_TEXT,
    'en',
  )
  try {
    const preparing = service.prepare(PARENT)
    await entered
    let isClosed = false
    const closing = (async () => {
      await service.close()
      isClosed = true
    })()
    await delay(100)
    expect(isClosed).toBe(false)
    gate.emit('release')
    await expect(preparing).rejects.toThrow(UI_TEXT.execIncomplete)
    await closing
    expect(isClosed).toBe(true)
  } finally {
    f.life.dispose()
    await service.close()
  }
})
