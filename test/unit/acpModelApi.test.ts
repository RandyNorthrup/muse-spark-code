import * as acp from '@agentclientprotocol/sdk'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { pinnedHttpsRequest } from '../../src/host/web/pinnedRequest'
import { paidGrantsFile } from '../../src/runtime/dataFolder'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import { type AcpPaidFeature, SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { memorySecrets } from './helpers/fakes'
import { fakeModelApi } from './helpers/fakeModelApi'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

// Only the admitted page's transport is controlled; the runtime factory,
// Model API backend bundle and actual page-converter worker remain real.
vi.mock('../../src/host/web/pinnedRequest', { spy: true })

// M63 (PLAN.md D61, D62): the agent on the Model API backend, end to end in
// process: the ACP SDK's client, the agent, the runtime's backend with its
// real tool harness and session store on disk, the backend loaded from a
// built dist/modelApi.js as the package ships it (M57, D6), and the fake
// Model API. The stdio suite cannot run this backend, because the agent
// reads the key only from the OS credential store.

// The one key the fake Model API accepts.
const KEY = 'LLM|1|secret'
const POLL_MS = 5
const WAIT_MS = 5000
const folders: string[] = []
const dist = { folder: '' }

function folder(): string {
  const created = mkdtempSync(path.join(tmpdir(), 'acp-model-api-'))
  folders.push(created)
  return created
}

// The agent's dist/ folder: the Model API backend's own bundle, required by path.
beforeAll(() => {
  dist.folder = folder()
  buildModelApiBundle(dist.folder)
})

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
  isTrusted = false,
  // A later agent on the same computer and folder shares these.
  shared?: { readonly data: string; readonly workspace: string },
  // More of the agent's own environment (a shell tool needs PATH).
  extraEnv: NodeJS.ProcessEnv = {},
) {
  const api = fakeModelApi()
  const secrets = memorySecrets()
  secrets.values.set(SECRET_KEYS.modelApiKey, KEY)
  const { data, workspace } = shared ?? { data: folder(), workspace: folder() }
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const runtime = createRuntimeBackend({
    options: {
      backend: 'modelApi',
      trustWorkspace: isTrusted,
      museBinary: '',
      shellSandbox: 'auto',
      canBypass: false,
      allowsContributorModels: false,
      paidFeatures,
      isVerbose: false,
    },
    version: '0.0.0-test',
    distDir: dist.folder,
    platform: process.platform,
    env: { ...extraEnv, XDG_DATA_HOME: data, LOCALAPPDATA: data },
    homeDir: data,
    secrets,
    runGit: () => Promise.reject(new Error('no git')),
    museCodeCredentials: [],
    fetch: api.fetch,
    sleep: () => Promise.resolve(),
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
    data,
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

/** Answers a paid-use question with `optionId` (M58), and anything else with an unknown option. */
function answerPaid(optionId: string) {
  return (request: acp.RequestPermissionRequest): acp.RequestPermissionResponse => ({
    outcome: {
      outcome: 'selected',
      optionId: request.options.some((option) => option.optionId === optionId)
        ? optionId
        : 'reject',
    },
  })
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

/** A second prompt in the session. */
async function promptAgain(client: acp.ClientContext, sessionId: string) {
  return await client.request('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'and again' }],
  })
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

  it('converts an admitted public page through the portable runtime worker', async () => {
    const t = setup(allowOnce, [], true)
    const pageUrl = 'https://93.184.215.14/guide'
    const close = vi.fn()
    vi.mocked(pinnedHttpsRequest).mockImplementationOnce((_target, _signal, connected) => {
      connected()
      return Promise.resolve({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: Readable.from([
          Buffer.from('<title>Worker page</title><p>Portable page content</p>'),
        ]),
        close,
      })
    })
    t.api.script(
      {
        calls: [{ name: 'web_fetch', arguments: JSON.stringify({ url: pageUrl }), callId: 'page' }],
      },
      { text: 'Read it.' },
    )
    try {
      await t.run((client) => promptOnce(client, t.workspace))
      expect(pinnedHttpsRequest).toHaveBeenCalledWith(
        expect.objectContaining({ address: '93.184.215.14', host: '93.184.215.14' }),
        expect.any(AbortSignal),
        expect.any(Function),
      )
      expect(t.permissions).toHaveLength(1)
      expect(JSON.stringify(t.api.responseBodies())).toContain('Portable page content')
      expect(close).toHaveBeenCalledOnce()
      expect(JSON.stringify([t.updates, t.permissions])).not.toContain(KEY)
    } finally {
      await t.runtime.close()
    }
  })

  it.each([true, false])(
    'offers portable web fetch only with workspace trust (%s), and refuses loopback',
    async (isTrusted) => {
      const t = setup(allowOnce, [], isTrusted)
      t.api.script(
        {
          calls: [
            {
              name: 'web_fetch',
              arguments: JSON.stringify({ url: 'https://127.0.0.1/private' }),
              callId: 'fetch_private',
            },
          ],
        },
        { text: 'Nothing fetched.' },
      )
      try {
        await t.run((client) => promptOnce(client, t.workspace))
        const tools = JSON.stringify(t.api.responseBodies()[0]?.['tools'])
        expect(tools.includes('web_fetch')).toBe(isTrusted)
        expect(t.permissions).toEqual([])
        expect(
          t.updates.some(
            (update) => update.sessionUpdate === 'tool_call_update' && update.status === 'failed',
          ),
        ).toBe(true)
        expect(JSON.stringify([t.updates, t.permissions])).not.toContain(KEY)
      } finally {
        await t.runtime.close()
      }
    },
  )

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

  it('offers Muse Code’s memory tools in a trusted folder, and never paid subagents (M48, M49)', async () => {
    const t = setup(allowOnce, [], true)
    t.api.script({ text: 'Noted.' })
    await t.run((client) => promptOnce(client, t.workspace))
    const offered = JSON.stringify(t.api.responseBodies()[0]?.['tools'])
    for (const memory of ['read_memory', 'add_memory', 'edit_memory']) {
      expect(offered).toContain(memory)
    }
    expect(offered).not.toContain('subagent_spawn')
    await t.runtime.close()
  })

  it('asks before each prompt that may search the web, and tallies each search (M58)', async () => {
    const t = setup(answerPaid('paid-allow-once'), ['webSearch'])
    t.api.script(
      { searches: [{ queries: ['acp registry'] }], text: 'Found it.' },
      { text: 'Nothing to search.' },
    )
    await t.run(async (client) => {
      const { created } = await promptOnce(client, t.workspace)
      await promptAgain(client, created.sessionId)
    })
    expect(t.permissions.map((request) => request.toolCall.title)).toEqual([
      'Let Muse search the web for this prompt?',
      'Let Muse search the web for this prompt?',
    ])
    for (const body of t.api.responseBodies()) {
      expect(JSON.stringify(body['tools'])).toContain('web_search')
    }
    expect(t.log.info).toHaveBeenCalledWith('Paid use of webSearch: 1, 1 since the agent started')
    await t.runtime.close()
  })

  it('sends the prompt without web search when its question is denied (M58)', async () => {
    const t = setup(answerPaid('paid-deny'), ['webSearch'])
    t.api.script({ text: 'No search.' })
    await t.run((client) => promptOnce(client, t.workspace))
    expect(t.permissions).toHaveLength(1)
    expect(JSON.stringify(t.api.responseBodies()[0]?.['tools'])).not.toContain('web_search')
    await t.runtime.close()
  })

  it('says what to set in the agent’s environment when Meta cannot be reached (Q66)', async () => {
    const t = setup(allowOnce)
    t.api.script({ networkError: 'fetch failed', networkErrorCode: 'ECONNREFUSED' })
    let failure = 'the prompt succeeded'
    try {
      await t.run((client) => promptOnce(client, t.workspace))
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error)
    }
    expect(failure).toContain(UI_TEXT.acpNetworkUnreachable)
    expect(failure).toContain('NODE_USE_ENV_PROXY=1')
    expect(failure).not.toContain('http.proxy')
    await t.runtime.close()
  })

  it(
    'runs a shell command with no credential variable in its environment (Codex on a209130)',
    { timeout: 60_000 },
    async () => {
      // Trusted: shell commands run only in a trusted folder.
      const t = setup(allowOnce, [], true, undefined, {
        ...process.env,
        META_API_KEY: 'LLM|1|placeholder',
        EXAMPLE_API_KEY: 'placeholder-too',
      })
      const shell = process.platform === 'win32' ? 'powershell' : 'bash'
      // Only a real run prints the joined word; the command's own text does not hold it.
      const command = `node -e "console.log('keys' + '-' + ([process.env.META_API_KEY, process.env.EXAMPLE_API_KEY].join('') || 'none'))"`
      t.api.script(
        {
          calls: [
            {
              name: shell,
              arguments: JSON.stringify({ command, description: 'keys' }),
              callId: 'k1',
            },
          ],
        },
        { text: 'Checked.' },
      )
      await t.run((client) => promptOnce(client, t.workspace))
      const sent = JSON.stringify(t.api.responseBodies()[1])
      expect(sent).toContain('keys-none')
      expect(sent).not.toContain('placeholder')
      await t.runtime.close()
    },
  )

  it('keeps "Allow always" for a trusted folder until the agent starts without the flag (M58)', async () => {
    const first = setup(answerPaid('paid-allow-always'), ['webSearch'], true)
    first.api.script({ text: 'One.' }, { text: 'Two.' })
    await first.run(async (client) => {
      const { created } = await promptOnce(client, first.workspace)
      await promptAgain(client, created.sessionId)
    })
    expect(first.permissions).toHaveLength(1)
    const file = paidGrantsFile({
      platform: process.platform,
      env: { XDG_DATA_HOME: first.data, LOCALAPPDATA: first.data },
      homeDir: first.data,
    })
    const grants = paidGrantFile({ file, log: first.log, sleep: () => Promise.resolve() })
    expect(grants.read(first.workspace)).toEqual(new Set(['webSearch']))
    await first.runtime.close()

    // Started again with the flag, the folder still asks nothing.
    const again = setup(answerPaid('paid-deny'), ['webSearch'], true, first)
    await again.runtime.forgetUnflaggedGrants()
    again.api.script({ text: 'Three.' })
    await again.run((client) => promptOnce(client, again.workspace))
    expect(again.permissions).toEqual([])
    expect(JSON.stringify(again.api.responseBodies()[0]?.['tools'])).toContain('web_search')
    await again.runtime.close()

    // Started without it, the grant lapses, so with it again the folder asks again.
    const without = setup(answerPaid('paid-deny'), [], true, first)
    await without.runtime.forgetUnflaggedGrants()
    expect(grants.read(first.workspace)).toEqual(new Set())
    await without.runtime.close()
    const flaggedAgain = setup(answerPaid('paid-deny'), ['webSearch'], true, first)
    await flaggedAgain.runtime.forgetUnflaggedGrants()
    flaggedAgain.api.script({ text: 'Four.' })
    await flaggedAgain.run((client) => promptOnce(client, flaggedAgain.workspace))
    expect(flaggedAgain.permissions).toHaveLength(1)
    expect(JSON.stringify(flaggedAgain.api.responseBodies()[0]?.['tools'])).not.toContain(
      'web_search',
    )
    await flaggedAgain.runtime.close()
  })
})
