import { execFile, spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MODEL_API_TOOLS, UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { fakeModelApi } from '../unit/helpers/fakeModelApi'
import type { ScheduleFireRecord } from '../../src/shared/scheduleV2'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'
import { createScheduleStore } from '../../src/core/schedules/store'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { createWorkspaceRegistry } from '../../src/runtime/schedules/registry'
import { agentDataFolder, workspaceKey } from '../../src/runtime/dataFolder'
import { webReadable } from '../../src/runtime/webStreams'
import { buildAcpFixture } from './acpFixture'
import { installFakeMuse, installFakeCredential } from './fakeMuse'

const directory = mkdtempSync(path.join(os.tmpdir(), 'm115-schedule-cli-'))
const agent = path.join(directory, 'dist', 'acp.js')
const delivered = path.join(directory, 'delivered')
const worker = path.join(delivered, 'dist', 'scheduleWorker.js')
const children = new Set<ChildProcessWithoutNullStreams>()
const fake = installFakeMuse()
const config = installFakeCredential()
// Real package builds and fsynced cross-process journals are shared fixture
// work. Individual assertions keep the repository's default test deadline.
const STDIO_PACKAGE_SETUP_TIMEOUT_MS = 240_000
const STDIO_FIXTURE_SETUP_TIMEOUT_MS = 60_000
interface SessionReceipt {
  fire: ScheduleFireRecord | undefined
  permissions: number
  transcript: string
  bodies: readonly Record<string, unknown>[]
}
interface PreparedMuse {
  client: acp.ClientContext
  sessionId: string
  workspace: string
  store: ReturnType<typeof createScheduleStore>
  session: ReturnType<typeof connect>
}
const muse: { prepared?: PreparedMuse; finish?: () => Promise<void> } = {}
beforeAll(async () => {
  await mkdir(path.dirname(agent))
  await build({
    entryPoints: [path.resolve('src/runtime/main.ts')],
    outfile: agent,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ version: '0.0.0-test' }))
  await cp(path.resolve('l10n'), path.join(directory, 'l10n'), { recursive: true })
  await buildAcpFixture(path.resolve('.'), delivered, '0.0.0-test')
  if (process.platform === 'darwin') {
    if (!existsSync(path.resolve('native/darwin/muse-dictate'))) {
      // Clean macOS checkouts build the shipped process-identity helper once;
      // its CLI identity mode does not start dictation or a GUI.
      await promisify(execFile)('bash', [path.resolve('native/darwin/build.sh')], {
        cwd: path.resolve('.'),
        timeout: STDIO_PACKAGE_SETUP_TIMEOUT_MS,
      })
    }
    await mkdir(path.join(delivered, 'native', 'darwin'), { recursive: true })
    await cp(
      path.resolve('native/darwin/muse-dictate'),
      path.join(delivered, 'native', 'darwin', 'muse-dictate'),
    )
  }
  for (const [entry, name] of [
    ['src/runtime/schedules/schedulesBundle.ts', 'schedules.js'],
    ['src/acp/questionDeferralEntry.ts', 'acpQuestions.js'],
    ['src/runtime/questions/questionRegistryEntry.ts', 'runtimeQuestions.js'],
    ['test/e2e/scheduleRuntimeWorker.ts', 'scheduleWorker.js'],
  ]) {
    if (entry === undefined || name === undefined) throw new Error('missing fixture entry')
    const source =
      entry === 'test/e2e/scheduleRuntimeWorker.ts'
        ? fileURLToPath(new URL('scheduleRuntimeWorker.ts', import.meta.url))
        : path.resolve(entry)
    await build({
      entryPoints: [source],
      outfile: path.join(delivered, 'dist', name),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      logLevel: 'silent',
    })
  }
  muse.prepared = await prepareMuse()
}, STDIO_PACKAGE_SETUP_TIMEOUT_MS)
afterAll(async () => {
  await muse.finish?.()
  await Promise.all(Array.from(children, (child) => stop(child)))
  expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()))
  await rm(directory, { recursive: true, force: true })
  await rm(fake.installDir, { recursive: true, force: true })
  await rm(config, { recursive: true, force: true })
})

async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) {
    children.delete(child)
    return
  }
  const exited = once(child, 'exit')
  child.stdin.end()
  child.kill()
  await exited
  children.delete(child)
}

async function prepareMuse(): Promise<PreparedMuse> {
  const workspace = path.join(directory, 'muse-workspace')
  const home = path.join(directory, 'muse-home')
  await mkdir(workspace, { recursive: true })
  const env = {
    SystemRoot: process.env['SystemRoot'],
    PATH: process.env['PATH'],
    MUSE_FAKE_NODE: process.execPath,
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: home,
    XDG_DATA_HOME: home,
    XDG_CONFIG_HOME: config,
    NODE_PATH: path.resolve('node_modules'),
    LANG: 'en_US.UTF-8',
  }
  const child = spawn(
    process.execPath,
    [
      path.join(delivered, 'dist', 'acp.js'),
      '--muse-binary',
      fake.binaryPath,
      '--shell-sandbox',
      'off',
    ],
    { cwd: workspace, env, stdio: 'pipe' },
  )
  const session = connect(child)
  const ready = Promise.withResolvers<PreparedMuse>()
  const finished = Promise.withResolvers<undefined>()
  const running = session.run(async (client) => {
    await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
    const { sessionId } = await client.request('session/new', { cwd: workspace, mcpServers: [] })
    ready.resolve({
      client,
      sessionId,
      workspace,
      session,
      store: createScheduleStore(
        createNodeScheduleFs(
          path.join(
            agentDataFolder({ platform: process.platform, env, homeDir: home }),
            'schedules',
          ),
        ),
      ),
    })
    await finished.promise
  })
  void running.catch(ready.reject)
  muse.finish = async () => {
    finished.resolve(undefined)
    try {
      await running
    } finally {
      await stop(child)
    }
  }
  return await ready.promise
}

function draft(backend: 'museCode' | 'modelApi', sessionId?: string) {
  const template = fakeSchedule()
  const cap = Usd.from(backend === 'modelApi' ? 1 : 0).toAmount()
  const schedule = fakeSchedule({
    target:
      sessionId === undefined
        ? { kind: 'newConversation', backend }
        : { kind: 'conversation', backend, sessionId },
    delivery: sessionId === undefined ? 'newConversation' : 'whenIdle',
    whenClosed: 'open',
    trigger: { kind: 'once', atMs: Date.now() + 86_400_000 },
    paidCapUsd: cap,
    grant: { ...template.grant, paidCapUsd: cap },
  })
  const {
    name,
    action,
    trigger,
    target,
    delivery,
    whenClosed,
    catchUp,
    mode,
    grant,
    paidCapUsd,
    parallel,
    pinned,
    zone,
  } = schedule
  return {
    name,
    action,
    trigger,
    target,
    delivery,
    whenClosed,
    catchUp,
    mode,
    grant,
    paidCapUsd,
    parallel,
    pinned,
    zone,
  }
}

function connect(child: ChildProcessWithoutNullStreams) {
  children.add(child)
  const updates: acp.SessionUpdate[] = []
  let permissions = 0
  const errors: string[] = []
  child.stderr.on('data', (chunk: Buffer) => {
    errors.push(chunk.toString())
  })
  const client = acp
    .client({ name: 'schedule-e2e' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('session/request_permission', () => {
      permissions += 1
      return { outcome: { outcome: 'cancelled' } }
    })
  return {
    updates,
    errors,
    permissions: () => permissions,
    run: async <T>(op: (context: acp.ClientContext) => Promise<T>) => {
      try {
        return await client.connectWith(
          acp.ndJsonStream(Writable.toWeb(child.stdin), webReadable(child.stdout)),
          op,
        )
      } catch (error: unknown) {
        throw new Error(errors.join('\n'), { cause: error })
      }
    },
  }
}

function text(updates: readonly acp.SessionUpdate[]) {
  return updates
    .flatMap((update) =>
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
        ? [update.content.text]
        : [],
    )
    .join('')
}

async function withModelWorker<T>(
  paid: 'on' | 'off',
  runTest: (fixture: {
    child: ChildProcessWithoutNullStreams
    workspace: string
    data: string
    api: ReturnType<typeof fakeModelApi>
    origin: string
  }) => Promise<T>,
) {
  const workspace = await mkdtemp(path.join(directory, `model-${paid}-`))
  const data = path.join(workspace, 'data')
  await mkdir(workspace, { recursive: true })
  const api = fakeModelApi()
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) {
        if (Buffer.isBuffer(chunk)) chunks.push(chunk)
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(name, value)
      }
      const result = await api.fetch(`http://127.0.0.1${request.url ?? '/'}`, {
        method: request.method ?? 'GET',
        headers: Object.fromEntries(headers),
        ...(chunks.length > 0 && { body: Buffer.concat(chunks).toString() }),
      })
      response.writeHead(result.status, Object.fromEntries(result.headers))
      response.end(Buffer.from(await result.arrayBuffer()))
    })().catch(() => {
      response.writeHead(500)
      response.end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing fake API port')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const child = spawn(process.execPath, [worker, 'acp', workspace, data, origin, paid], {
    stdio: 'pipe',
    env: { SystemRoot: process.env['SystemRoot'] },
  })
  children.add(child)
  try {
    return await runTest({ child, workspace, data, api, origin })
  } finally {
    await stop(child)
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error === undefined) resolve()
        else reject(error)
      }),
    )
  }
}
function run(args: readonly string[]) {
  return spawnSync(process.execPath, [agent, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { SystemRoot: process.env['SystemRoot'], LANG: 'en_US.UTF-8', LC_ALL: '' },
  })
}

describe('schedule CLI process boundary', () => {
  it('prints runnable draft and global wake syntax in help', () => {
    const result = run(['--help'])
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(UI_TEXT.scheduleV2.runtime.usage)
    expect(result.stdout).toContain('--draft')
    expect(result.stdout).toContain('run-due')
  })
  it('returns a stable JSON refusal when the real scheduler bundle is absent', () => {
    for (const args of [
      ['schedule', 'list', '--json'],
      ['schedule', 'background', 'off', '--json'],
    ]) {
      const result = run(args)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toEqual({
        kind: 'refused',
        reason: UI_TEXT.scheduleV2.runtime.unavailable,
      })
      expect(result.stdout).not.toContain(directory)
    }
  })
  it('keeps exec scheduling and global workspace overrides refused before starting a backend', () => {
    expect(run(['exec', '--schedule', 'list']).status).toBe(2)
    expect(run(['schedule', 'run-due', '--cwd', directory]).status).toBe(2)
    expect(run(['schedule', 'background', 'off', '--cwd', directory]).status).toBe(2)
  })
  it('preserves a committed accepted id on stdout and reports cleanup separately with exit 3', async () => {
    const bundle = path.join(directory, 'dist', 'schedules.js')
    await writeFile(
      bundle,
      `exports.createRuntimeSchedules = async () => ({
        command: async () => ({ exitCode: 0, output: JSON.stringify({ kind: 'accepted', id: 'fake-accepted' }) }),
        run: async () => 'fake',
        holdWorkspace: async () => async () => {},
        close: async () => { throw new Error('private cleanup detail') }
      })`,
    )
    try {
      const result = run(['schedule', 'add', '--draft', '{}', '--json'])
      expect(result.status).toBe(3)
      expect(JSON.parse(result.stdout)).toEqual({
        kind: 'accepted',
        id: 'fake-accepted',
      })
      expect(result.stderr).toContain(UI_TEXT.scheduleV2.runtime.cleanupFailed)
      expect(result.stdout + result.stderr).not.toContain('private cleanup detail')
      expect(result.stdout).toContain('fake-accepted')
    } finally {
      await rm(bundle)
    }
  })
})

async function schedulePrompt(
  client: acp.ClientContext,
  sessionId: string,
  text: string,
): Promise<void> {
  await client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
}

async function museReceipt(): Promise<SessionReceipt> {
  if (muse.prepared === undefined) throw new Error('missing prepared Muse session')
  const { client, sessionId, store, session, workspace } = muse.prepared
  const job = draft('museCode', sessionId)
  job.action = { kind: 'prompt', prompt: 'tool: npm test' }
  await schedulePrompt(client, sessionId, `/schedule add ${JSON.stringify(job)}`)
  const [schedule] = await store.list(workspaceKey(workspace))
  if (schedule === undefined) throw new Error('missing Muse schedule')
  await schedulePrompt(client, sessionId, `/schedule run-now ${schedule.id}`)
  const [fire] = await store.fires(schedule.workspaceKey)
  await client.request('session/close', { sessionId })
  return { fire, permissions: session.permissions(), transcript: text(session.updates), bodies: [] }
}

async function modelReceipt(paid: 'on' | 'off'): Promise<SessionReceipt> {
  return await withModelWorker(paid, async ({ child, workspace, data, api }) => {
    api.script(
      {
        calls: [
          {
            name: process.platform === 'win32' ? MODEL_API_TOOLS.powershell : MODEL_API_TOOLS.bash,
            arguments: '{"command":"npm test"}',
          },
        ],
      },
      { text: 'refused safely' },
    )
    const session = connect(child)
    return await session.run(async (client) => {
      await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
      const { sessionId } = await client.request('session/new', { cwd: workspace, mcpServers: [] })
      await schedulePrompt(
        client,
        sessionId,
        `/schedule add ${JSON.stringify(draft('modelApi', sessionId))}`,
      )
      const store = createScheduleStore(createNodeScheduleFs(path.join(data, 'schedules')))
      const [schedule] = await store.list(workspaceKey(workspace))
      if (schedule === undefined) throw new Error('missing Model API schedule')
      await schedulePrompt(client, sessionId, `/schedule run-now ${schedule.id}`)
      const [fire] = await store.fires(schedule.workspaceKey)
      await client.request('session/close', { sessionId })
      return {
        fire,
        permissions: session.permissions(),
        transcript: text(session.updates),
        bodies: api.responseBodies(),
      }
    })
  })
}

async function dueReceipt() {
  return await withModelWorker('on', async ({ child, workspace, data, api, origin }) => {
    await stop(child)
    const fs = createNodeScheduleFs(path.join(data, 'schedules'))
    const store = createScheduleStore(fs)
    const schedule = fakeSchedule({
      workspaceKey: workspaceKey(workspace),
      target: { kind: 'newConversation', backend: 'modelApi' },
      delivery: 'newConversation',
      paidCapUsd: Usd.from(1).toAmount(),
      grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(1).toAmount() },
    })
    await createWorkspaceRegistry(fs, 'runtime/workspaces.json').add(
      schedule.workspaceKey,
      workspace,
    )
    await store.create(schedule)
    api.script({ text: 'background delivered' })
    const attempts: {
      code: unknown
      output: unknown
      requests: number
      fires: number
      stderr: string
    }[] = []
    for (const _attempt of [0, 1]) {
      const runDue = spawn(process.execPath, [worker, 'run-due', workspace, data, origin, 'on'], {
        stdio: 'pipe',
        env: { SystemRoot: process.env['SystemRoot'] },
      })
      children.add(runDue)
      const stdout: string[] = []
      const stderr: string[] = []
      runDue.stdout.on('data', (chunk: Buffer) => {
        stdout.push(chunk.toString())
      })
      runDue.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk.toString())
      })
      const [code] = await once(runDue, 'close')
      const fires = await store.fires(schedule.workspaceKey)
      attempts.push({
        code,
        output: JSON.parse(stdout.join('')),
        requests: api.responseBodies().length,
        fires: fires.length,
        stderr: stderr.join(''),
      })
      children.delete(runDue)
    }
    const [fire] = await store.fires(schedule.workspaceKey)
    return { attempts, fire }
  })
}

describe('scheduled prompt delivery across stdio', () => {
  describe('run-due across process restart', () => {
    let receipt: Awaited<ReturnType<typeof dueReceipt>>
    beforeAll(async () => {
      receipt = await dueReceipt()
    }, STDIO_FIXTURE_SETUP_TIMEOUT_MS)
    it('opens and settles a background backend session in its persisted workspace', () => {
      expect(receipt.attempts[0]).toMatchObject({
        code: 0,
        output: { kind: 'accepted' },
        requests: 1,
        fires: 1,
      })
      expect(receipt.attempts[0]?.stderr).toContain('background delivered')
      expect(receipt.fire?.outcome).toBe('ran')
    })
    it('never dispatches the claimed occurrence again after process restart', () => {
      expect(receipt.attempts[1]).toMatchObject({
        code: 0,
        output: { kind: 'accepted' },
        requests: 1,
        fires: 1,
      })
    })
  })
  describe('real ACP runtime route with fake Muse Code CLI', () => {
    let receipt: SessionReceipt
    beforeAll(async () => {
      receipt = await museReceipt()
    }, STDIO_FIXTURE_SETUP_TIMEOUT_MS)
    it('delivers the scheduled prompt and records refused shell actions', () => {
      expect(receipt.fire).toMatchObject({
        outcome: 'ran',
        refusedActions: expect.arrayContaining([expect.objectContaining({ actionClass: 'shell' })]),
      })
    })
    it('emits refusal rows as session updates without an interactive approval', () => {
      expect(receipt.permissions).toBe(0)
      expect(receipt.transcript).toContain('Refused on schedule')
    })
  })
  describe('Model API over loopback with supplied paid policy', () => {
    let receipt: SessionReceipt
    beforeAll(async () => {
      receipt = await modelReceipt('on')
    }, STDIO_FIXTURE_SETUP_TIMEOUT_MS)
    it('settles the run and records denied actions without a permission card', () => {
      expect(receipt.fire).toMatchObject({
        outcome: 'ran',
        refusedActions: expect.arrayContaining([expect.objectContaining({ actionClass: 'shell' })]),
      })
      expect(receipt.permissions).toBe(0)
      expect(receipt.transcript).toContain('Refused on schedule')
    })
    it('sends the scheduled note with the user input over real HTTP', () => {
      expect(receipt.bodies).toHaveLength(2)
      expect(JSON.stringify(receipt.bodies[0]?.['input'])).toContain('Nobody is watching')
    })
  })
  describe('Model API without paid policy', () => {
    let receipt: SessionReceipt
    beforeAll(async () => {
      receipt = await modelReceipt('off')
    }, STDIO_FIXTURE_SETUP_TIMEOUT_MS)
    it('records the fire as refused', () => {
      expect(receipt.fire?.outcome).toBe('refused')
    })
    it('sends no response request and opens no permission card', () => {
      expect(receipt.bodies).toHaveLength(0)
      expect(receipt.permissions).toBe(0)
    })
  })
})
