import * as acp from '@agentclientprotocol/sdk'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { type AcpPaidFeature, SECRET_KEYS } from '../../src/shared/constants'
import { memorySecrets } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { removeFolder } from './helpers/temporaryFolders'

// M63 (PLAN.md D61, D62): the agent on the Model API backend, end to end in
// process: the ACP SDK's client, the agent, the runtime's backend with its
// real tool harness and session store on disk, and the fake Model API. The
// stdio suite cannot run this backend, because the agent reads the key only
// from the OS credential store.

// The one key the fake Model API accepts.
const KEY = 'LLM|1|secret'
const POLL_MS = 5
const WAIT_MS = 5000
const folders: string[] = []

function folder(): string {
  const created = mkdtempSync(path.join(tmpdir(), 'acp-model-api-'))
  folders.push(created)
  return created
}

afterAll(async () => {
  await Promise.all(folders.map((created) => removeFolder(created)))
})

async function until(isMet: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_MS
  while (!(await isMet())) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time')
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

function writeCall(file: string, content: string, callId: string) {
  return { name: 'write_file', arguments: JSON.stringify({ path: file, content }), callId }
}

function setup(
  answer: (request: acp.RequestPermissionRequest) => acp.RequestPermissionResponse,
  paidFeatures: readonly AcpPaidFeature[] = [],
) {
  const api = fakeModelApi()
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
  const data = folder()
  const workspace = folder()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const runtime = createRuntimeBackend({
    options: {
      backend: 'modelApi',
      trustWorkspace: false,
      museBinary: '',
      shellSandbox: 'auto',
      canBypass: false,
      allowsContributorModels: false,
      paidFeatures,
      isVerbose: false,
    },
    version: '0.0.0-test',
    distDir: data,
    platform: process.platform,
    env: { XDG_DATA_HOME: data, LOCALAPPDATA: data },
    homeDir: data,
    secrets,
    runGit: () => Promise.reject(new Error('no git')),
    fetch: api.fetch,
    log,
  })
  const agent = createAcpAgent({
    backend: runtime.backend,
    version: '0.0.0-test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'model-api-key',
      name: 'Store a key',
      description: 'Store a key',
      args: ['auth', 'set'],
      command: 'muse-spark-code-acp auth set',
    },
    defaultCwd: workspace,
    paid: runtime.paid,
    log,
  })
  const updates: acp.SessionUpdate[] = []
  const permissions: acp.RequestPermissionRequest[] = []
  const client = acp
    .client({ name: 'test-client' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('session/request_permission', (context) => {
      permissions.push(context.params)
      return answer(context.params)
    })
  return {
    api,
    log,
    workspace,
    runtime,
    updates,
    permissions,
    run: <T>(op: (context: acp.ClientContext) => Promise<T>) => client.connectWith(agent, op),
  }
}

function allowOnce(request: acp.RequestPermissionRequest): acp.RequestPermissionResponse {
  const option = request.options.find((candidate) => candidate.kind === 'allow_once')
  return {
    outcome:
      option === undefined
        ? { outcome: 'cancelled' }
        : { outcome: 'selected', optionId: option.optionId },
  }
}

type MessageChunk = Extract<
  acp.SessionUpdate,
  { sessionUpdate: 'user_message_chunk' | 'agent_message_chunk' }
>

function textOf(
  updates: readonly acp.SessionUpdate[],
  kind: MessageChunk['sessionUpdate'],
): string {
  return updates
    .filter((update): update is MessageChunk => update.sessionUpdate === kind)
    .map((update) => (update.content.type === 'text' ? update.content.text : ''))
    .join('')
}

async function initialize(client: acp.ClientContext): Promise<void> {
  await client.request('initialize', {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  })
}

/** A new session in the folder, asked to write the notes. */
async function promptOnce(client: acp.ClientContext, cwd: string) {
  await initialize(client)
  const created = await client.request('session/new', { cwd, mcpServers: [] })
  const response = await client.request('session/prompt', {
    sessionId: created.sessionId,
    prompt: [{ type: 'text', text: 'write the notes' }],
  })
  return { created, stopReason: response.stopReason }
}

describe('the ACP agent on the Model API backend (M63)', () => {
  it('writes a file the client allowed, streams the reply, and never sends the key to the client', async () => {
    const t = setup(allowOnce)
    t.api.script({ calls: [writeCall('notes.txt', 'hello\n', 'c1')] }, { text: 'Wrote it.' })
    const { created, stopReason } = await t.run((client) => promptOnce(client, t.workspace))
    expect(created.configOptions?.map((option) => option.id)).toEqual(['model', 'effort'])
    expect(stopReason).toBe('end_turn')
    expect(readFileSync(path.join(t.workspace, 'notes.txt'), 'utf8')).toBe('hello\n')
    expect(t.permissions).toHaveLength(1)
    expect(t.permissions[0]?.toolCall.kind).toBe('edit')
    const done = t.updates.find(
      (update) => update.sessionUpdate === 'tool_call_update' && update.status === 'completed',
    )
    expect(done).toBeDefined()
    expect(textOf(t.updates, 'agent_message_chunk')).toBe('Wrote it.')
    // The key went to the Model API as the bearer token, and nowhere near the client.
    expect(t.api.requests.at(-1)?.headers['Authorization']).toBe(`Bearer ${KEY}`)
    expect(JSON.stringify([t.updates, t.permissions])).not.toContain(KEY)
    // Paid features are off without their flags (M63c): no web search or image tools offered.
    const offered = JSON.stringify(t.api.responseBodies()[0]?.['tools'])
    for (const paid of ['web_search', 'generate_image', 'edit_image']) {
      expect(offered).not.toContain(paid)
    }
    expect(offered).toContain('write_file')
    await t.runtime.close()
  })

  it('writes nothing the client cancelled, then lists and loads the session from disk', async () => {
    const t = setup(() => ({ outcome: { outcome: 'cancelled' } }))
    t.api.script({ calls: [writeCall('notes.txt', 'x', 'c1')] }, { text: 'Left it alone.' })
    const { created, stopReason } = await t.run((client) => promptOnce(client, t.workspace))
    const { sessionId } = created
    expect(stopReason).toBe('end_turn')
    expect(existsSync(path.join(t.workspace, 'notes.txt'))).toBe(false)
    const failed = t.updates.find(
      (update) => update.sessionUpdate === 'tool_call_update' && update.status === 'failed',
    )
    expect(failed).toBeDefined()

    t.updates.length = 0
    await t.run(async (client) => {
      await initialize(client)
      await until(async () => {
        const listed = await client.request('session/list', { cwd: t.workspace })
        return listed.sessions.some((session) => session.sessionId === sessionId)
      })
      await client.request('session/load', { sessionId, cwd: t.workspace, mcpServers: [] })
    })
    expect(textOf(t.updates, 'user_message_chunk')).toBe('write the notes')
    expect(textOf(t.updates, 'agent_message_chunk')).toBe('Left it alone.')
    await t.runtime.close()
  })

  it('offers web search once its price is accepted, and tallies each search (M63c)', async () => {
    const t = setup(
      (request) => ({
        outcome: {
          outcome: 'selected',
          optionId: request.options.some((option) => option.optionId === 'paid-accept')
            ? 'paid-accept'
            : 'reject',
        },
      }),
      ['webSearch'],
    )
    t.api.script({ searches: [{ queries: ['acp registry'] }], text: 'Found it.' })
    const { stopReason } = await t.run((client) => promptOnce(client, t.workspace))
    expect(stopReason).toBe('end_turn')
    expect(t.permissions.map((request) => request.toolCall.toolCallId)).toEqual([
      'paid-feature-webSearch',
    ])
    expect(JSON.stringify(t.api.responseBodies()[0]?.['tools'])).toContain('web_search')
    expect(t.log.info).toHaveBeenCalledWith('Paid use of webSearch: 1, 1 since the agent started')
    await t.runtime.close()
  })

  it('offers neither paid tool when their prices are declined (M63c)', async () => {
    const t = setup(
      () => ({ outcome: { outcome: 'selected', optionId: 'paid-decline' } }),
      ['webSearch', 'imageGeneration'],
    )
    t.api.script({ text: 'No search.' })
    await t.run((client) => promptOnce(client, t.workspace))
    expect(t.permissions).toHaveLength(2)
    const offered = JSON.stringify(t.api.responseBodies()[0]?.['tools'])
    for (const paid of ['web_search', 'generate_image', 'edit_image']) {
      expect(offered).not.toContain(paid)
    }
    await t.runtime.close()
  })
})
