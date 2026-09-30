// The ACP agent as editors run it (M63, PLAN.md D62): `acp.js` bundled from
// the source as the build bundles it (or, with MUSE_ACP_PACKAGE_DIR, the
// package npm installed, as hosts.yml checks it on each platform), started
// as a real child process, and
// driven over its stdio by the ACP SDK's own client, on the fake Muse Code
// CLI of fake-muse/serve.mjs. A reply streamed, a tool call allowed and one
// denied, a cancel, the session listed, sign-in asked for, and the key never
// on the wire. The Model API backend, which reads its key only from the OS
// credential store, is loaded from the package's own dist/modelApi.js (M57)
// in this process, and so is Muse Code's readiness, read from the CLI's
// credential file as the panel reads it (D26, PR #49).

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { createRuntimeBackend } from '../../src/runtime/backends'
import { webReadable } from '../../src/runtime/webStreams'
import { SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { DEVICE_LOGIN_FILE, LOGOUT_SHELL } from '../unit/helpers/credentialShapes'
import { memorySecrets } from '../unit/helpers/fakes'
import { fakeModelApi } from '../unit/helpers/fakeModelApi'
import { buildModelApiBundle } from '../unit/helpers/modelApiBundle'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import {
  fakeCredentialFile,
  installFakeCredential,
  installFakeMuse,
  writeFakeCredential,
} from './fakeMuse'

const TEST_TIMEOUT_MS = 30_000
const ROOT = path.resolve(import.meta.dirname, '..', '..')
// An installed package brings its own native keyring binding. One laid out
// here as npm installs it takes the binding from this repository's
// node_modules (NODE_PATH), as an installed package finds its dependency.
const INSTALLED = process.env['MUSE_ACP_PACKAGE_DIR']
const PACKAGE = INSTALLED ?? mkdtempSync(path.join(tmpdir(), 'acp-package-'))
const AGENT = path.join(PACKAGE, 'dist', 'acp.js')
const NODE_PATH = INSTALLED === undefined ? path.join(ROOT, 'node_modules') : ''
const LAID_OUT_VERSION = '0.0.0-e2e'

const fake = installFakeMuse()
const signedIn = installFakeCredential()
const signedOut = mkdtempSync(path.join(tmpdir(), 'fake-muse-none-'))
// What `muse logout` leaves: the file is there, and signed out (PR #49).
const loggedOut = installFakeCredential(LOGOUT_SHELL)
// Captured on macOS (version 2, the Keychain lane); `muse serve` exits with
// it on Windows and Linux (docs/certification/sign-in-detection.md).
const MACOS_POINTER = JSON.stringify({
  schema_version: 2,
  providers: { meta: { storage: 'keychain' } },
})
// Synthetic, as PR #49's own e2e: a `meta` entry in a lane no build was seen
// writing, beside a credential key. Only the CLI can say; the fake answers
// from the key.
const UNPLACEABLE = JSON.stringify({
  schema_version: 1,
  providers: { meta: { storage: 'elsewhere', access_token: '<placeholder>' } },
})
// The same lane with no credential key: the fake CLI answers signed out.
const SIGNED_OUT_UNPLACEABLE = JSON.stringify({
  schema_version: 1,
  providers: { meta: { storage: 'elsewhere' } },
})
const workspace = mkdtempSync(path.join(tmpdir(), 'acp-e2e-ws-'))
const dataHome = mkdtempSync(path.join(tmpdir(), 'acp-e2e-data-'))
const children: ChildProcessWithoutNullStreams[] = []

beforeAll(async () => {
  if (INSTALLED !== undefined) {
    return
  }
  mkdirSync(path.dirname(AGENT), { recursive: true })
  await build({
    entryPoints: [path.join(ROOT, 'src', 'runtime', 'main.ts')],
    outfile: AGENT,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  buildModelApiBundle(path.dirname(AGENT))
  writeFileSync(path.join(PACKAGE, 'package.json'), JSON.stringify({ version: LAID_OUT_VERSION }))
  cpSync(path.join(ROOT, 'l10n'), path.join(PACKAGE, 'l10n'), { recursive: true })
})

afterAll(async () => {
  for (const child of children) {
    child.kill()
  }
  const made = [fake.installDir, signedIn, signedOut, loggedOut, workspace, dataHome]
  await Promise.all(
    [...made, ...(INSTALLED === undefined ? [PACKAGE] : [])].map((folder) => removeFolder(folder)),
  )
})

function agentEnvironment(configHome: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // What the fake CLI needs (fakeMuse.ts), handed through the agent's own environment.
    MUSE_FAKE_NODE: process.execPath,
    MUSE_FAKE_FINGERPRINT: EXPECTED_SCHEMA_FINGERPRINT,
    NODE_PATH,
    XDG_CONFIG_HOME: configHome,
    LANG: 'C',
    LC_ALL: '',
  }
}

interface Session {
  readonly updates: acp.SessionUpdate[]
  readonly wire: string[]
  readonly stderr: string[]
  run<T>(op: (client: acp.ClientContext) => Promise<T>): Promise<T>
}

// The runtime's options in this process: Muse Code, nothing trusted or paid.
const MUSE_CODE_OPTIONS = {
  backend: 'museCode',
  trustWorkspace: false,
  museBinary: '',
  shellSandbox: 'off',
  canBypass: false,
  allowsContributorModels: false,
  paidFeatures: [],
  isVerbose: false,
} as const

function startAgent(
  configHome: string,
  args: readonly string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): Session {
  const child = spawn(
    process.execPath,
    [AGENT, '--muse-binary', fake.binaryPath, '--shell-sandbox', 'off', ...args],
    { env: { ...agentEnvironment(configHome), ...extraEnv }, cwd: workspace, stdio: 'pipe' },
  )
  children.push(child)
  const updates: acp.SessionUpdate[] = []
  const wire: string[] = []
  const stderr: string[] = []
  child.stdout.on('data', (chunk: Buffer) => {
    wire.push(chunk.toString())
  })
  child.stderr.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString())
  })
  const client = acp
    .client({ name: 'e2e' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('session/request_permission', (context) => {
      const { command } = context.params.toolCall.rawInput as { command?: string }
      const optionId = command?.includes('deny') === true ? 'abort' : 'allow_once'
      return { outcome: { outcome: 'selected', optionId } }
    })
  const stream = acp.ndJsonStream(Writable.toWeb(child.stdin), webReadable(child.stdout))
  return { updates, wire, stderr, run: (op) => client.connectWith(stream, op) }
}

async function newSession(client: acp.ClientContext): Promise<string> {
  await client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
  const { sessionId } = await client.request('session/new', { cwd: workspace, mcpServers: [] })
  return sessionId
}

function initialize(client: acp.ClientContext) {
  return client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
}

function text(updates: readonly acp.SessionUpdate[]): string {
  return updates
    .flatMap((update) =>
      update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
        ? [update.content.text]
        : [],
    )
    .join('')
}

describe('the ACP agent over stdio (M63)', { timeout: TEST_TIMEOUT_MS }, () => {
  it('prints its version and help, and refuses an argument it does not know', () => {
    const env = { ...process.env, NODE_PATH, LANG: 'C' }
    const version = spawnSync(process.execPath, [AGENT, '--version'], { encoding: 'utf8', env })
    const expected =
      INSTALLED === undefined
        ? LAID_OUT_VERSION
        : (
            JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')) as {
              version: string
            }
          ).version
    expect(version.stdout.trim()).toBe(expected)
    const help = spawnSync(process.execPath, [AGENT, '--help'], { encoding: 'utf8', env })
    expect(help.stdout).toContain('muse-spark-code-acp auth set|status|clear')
    const wrong = spawnSync(process.execPath, [AGENT, '--colour'], { encoding: 'utf8', env })
    expect(wrong.status).toBe(1)
    expect(wrong.stderr).toContain('--colour')
  })

  it('streams a reply, runs an allowed tool call and skips a denied one, on Muse Code', async () => {
    const agent = startAgent(signedIn)
    const [reply, allowed, denied] = await agent.run(async (client) => {
      const sessionId = await newSession(client)
      const ask = (prompt: string) =>
        client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: prompt }] })
      return [await ask('hello'), await ask('tool: echo allowed'), await ask('tool: echo deny me')]
    })
    expect([reply, allowed, denied]).toEqual([
      { stopReason: 'end_turn' },
      { stopReason: 'end_turn' },
      { stopReason: 'end_turn' },
    ])
    expect(text(agent.updates)).toContain('echo: hello')
    const toolCalls = agent.updates.filter((update) => update.sessionUpdate === 'tool_call')
    expect(toolCalls).toHaveLength(2)
    expect(toolCalls[0]).toMatchObject({
      kind: 'execute',
      title: expect.stringContaining('echo allowed'),
    })
    const finished = agent.updates.filter(
      (update) => update.sessionUpdate === 'tool_call_update' && update.status !== 'in_progress',
    )
    expect(
      finished.map((update) => update.sessionUpdate === 'tool_call_update' && update.status),
    ).toEqual(['completed', 'failed'])
  })

  it('cancels a running turn and lists the session afterwards', async () => {
    const agent = startAgent(signedIn)
    const [stopped, listed] = await agent.run(async (client) => {
      const sessionId = await newSession(client)
      const running = client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: 'slow' }],
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      await client.notify('session/cancel', { sessionId })
      return [await running, await client.request('session/list', { cwd: workspace })]
    })
    expect(stopped).toEqual({ stopReason: 'cancelled' })
    expect(listed.sessions.length).toBeGreaterThan(0)
  })

  it('asks for sign-in when Muse Code is signed out, and for the key on the Model API backend', async () => {
    const museCode = startAgent(signedOut)
    await expect(museCode.run((client) => newSession(client))).rejects.toMatchObject({
      code: -32_000,
    })
    const modelApi = startAgent(signedIn, ['--backend', 'modelApi'])
    // Signed out where the OS has a credential store; unavailable where it
    // has none (a Linux runner without a Secret Service). Never a session.
    const refused = modelApi.run((client) => newSession(client))
    await expect(refused).rejects.toSatisfy(
      (error: { code?: number }) => error.code === -32_000 || error.code === -32_603,
    )
    expect(modelApi.wire.join('')).not.toMatch(/LLM\|/)
  })

  it('says at start that a proxy will not be used by the Model API backend, until Node’s switch is on (Q66)', async () => {
    // A port nothing is asked on: the agent sends no request before a session.
    const proxy = { HTTPS_PROXY: 'http://127.0.0.1:9', NODE_USE_ENV_PROXY: '' }
    const unused = startAgent(signedIn, ['--backend', 'modelApi'], proxy)
    await unused.run(initialize)
    const said = unused.stderr.join('')
    expect(said).toContain('HTTPS_PROXY is set, but')
    expect(said).toContain('go to Meta directly')
    expect(said).not.toContain('127.0.0.1:9')
    const used = startAgent(signedIn, ['--backend', 'modelApi'], {
      ...proxy,
      NODE_USE_ENV_PROXY: '1',
    })
    await used.run(initialize)
    expect(used.stderr.join('')).not.toContain('HTTPS_PROXY is set')
    const museCode = startAgent(signedIn, [], proxy)
    await museCode.run(initialize)
    expect(museCode.stderr.join('')).not.toContain('HTTPS_PROXY is set')
  })

  it('hands META_API_KEY in its own environment to Muse Code only, as the extension does (D1)', async () => {
    const agent = startAgent(signedOut, [], { META_API_KEY: 'LLM|1|placeholder' })
    // Signed out, but the CLI's own key variable is its credential.
    await agent.run((client) => newSession(client))
    const said = agent.stderr.join('')
    expect(said).toContain('META_API_KEY in the environment present')
    expect(said).not.toContain('placeholder')
    expect(agent.wire.join('')).not.toContain('placeholder')
  })

  it('asks for sign-in after `muse logout`, whose file stays behind (PR #49)', async () => {
    const agent = startAgent(loggedOut)
    await expect(agent.run((client) => newSession(client))).rejects.toMatchObject({
      code: -32_000,
    })
  })

  it('reads Muse Code’s readiness from the credential file, and asks the CLI where only it can say (PR #49)', async () => {
    const configHome = mkdtempSync(path.join(tmpdir(), 'acp-readiness-'))
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    // The manager reads the process's own environment, as the agent's does.
    vi.stubEnv('XDG_CONFIG_HOME', configHome)
    vi.stubEnv('MUSE_FAKE_NODE', process.execPath)
    vi.stubEnv('MUSE_FAKE_FINGERPRINT', EXPECTED_SCHEMA_FINGERPRINT)
    vi.stubEnv('META_API_KEY', '')
    // The platform the file is read for; the fake CLI answers on this one.
    const runtimeReadingFor = (platform: NodeJS.Platform) =>
      createRuntimeBackend({
        options: { ...MUSE_CODE_OPTIONS, museBinary: fake.binaryPath },
        version: LAID_OUT_VERSION,
        distDir: path.dirname(AGENT),
        platform,
        env: process.env,
        homeDir: configHome,
        secrets: memorySecrets(),
        runGit: () => Promise.reject(new Error('no git')),
        museCodeCredentials: [],
        fetch: () => Promise.reject(new Error('no network')),
        sleep: () => Promise.resolve(),
        log,
      })
    const runtime = runtimeReadingFor(process.platform)
    const mac = runtimeReadingFor('darwin')
    const asked = () =>
      log.info.mock.calls.filter(([line]) => String(line).includes('confirmed by account/read'))
        .length
    try {
      expect(await runtime.backend.readiness(false)).toMatchObject({ state: 'signedOut' })
      writeFakeCredential(configHome, LOGOUT_SHELL)
      expect(await runtime.backend.readiness(false)).toEqual({
        state: 'signedOut',
        message: UI_TEXT.acpMuseCodeSignedOut,
      })
      // A browser sign-in: settled by the file off macOS; there, the passive
      // estimate until the user checks again.
      writeFakeCredential(configHome, DEVICE_LOGIN_FILE)
      expect(await runtime.backend.readiness(false)).toEqual({ state: 'ready' })
      // A file only the CLI can place: off macOS asked once and remembered;
      // on macOS asked only on authenticate. authenticate always asks afresh.
      writeFakeCredential(configHome, UNPLACEABLE)
      const before = asked()
      const asksPassively = process.platform === 'darwin' ? 0 : 1
      expect(await runtime.backend.readiness(false)).toEqual({ state: 'ready' })
      expect(await runtime.backend.readiness(false)).toEqual({ state: 'ready' })
      expect(asked()).toBe(before + asksPassively)
      expect(await runtime.backend.readiness(true)).toEqual({ state: 'ready' })
      expect(asked()).toBe(before + asksPassively + 1)
      // Read as macOS reads it, on any runner: a session starts no CLI, and
      // authenticate asks it; its answer decides.
      writeFakeCredential(configHome, DEVICE_LOGIN_FILE)
      const beforeMac = asked()
      expect(await mac.backend.readiness(false)).toEqual({ state: 'ready' })
      expect(asked()).toBe(beforeMac)
      expect(await mac.backend.readiness(true)).toEqual({ state: 'ready' })
      expect(asked()).toBe(beforeMac + 1)
      writeFakeCredential(configHome, SIGNED_OUT_UNPLACEABLE)
      expect(await mac.backend.readiness(true)).toMatchObject({ state: 'signedOut' })
      if (process.platform !== 'darwin') {
        writeFakeCredential(configHome, MACOS_POINTER)
        expect(await runtime.backend.readiness(false)).toEqual({
          state: 'unavailable',
          message: fill(UI_TEXT.cliCredentialUnsupported, {
            path: fakeCredentialFile(configHome),
          }),
        })
      }
      // With META_API_KEY in its environment `muse serve` starts whatever the file says.
      writeFakeCredential(configHome, LOGOUT_SHELL)
      vi.stubEnv('META_API_KEY', 'LLM|1|placeholder')
      expect(await runtime.backend.readiness(false)).toEqual({ state: 'ready' })
    } finally {
      vi.unstubAllEnvs()
      await Promise.all([runtime.close(), mac.close()])
      await removeFolder(configHome)
    }
  })

  it('ships the Model API backend beside the agent, where the runtime loads it (M57)', async () => {
    const api = fakeModelApi()
    api.script({ text: 'From the bundle.' })
    const secrets = memorySecrets()
    secrets.values.set(SECRET_KEYS.modelApiKey, 'LLM|1|secret')
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const runtime = createRuntimeBackend({
      options: { ...MUSE_CODE_OPTIONS, backend: 'modelApi' },
      version: LAID_OUT_VERSION,
      distDir: path.dirname(AGENT),
      platform: process.platform,
      env: { XDG_DATA_HOME: dataHome, LOCALAPPDATA: dataHome },
      homeDir: dataHome,
      secrets,
      runGit: () => Promise.reject(new Error('no git')),
      museCodeCredentials: [],
      fetch: api.fetch,
      sleep: () => Promise.resolve(),
      log,
    })
    try {
      const host = await runtime.backend.hostFor(workspace)
      const session = await host.startSession({
        workspaceRoot: workspace,
        modelId: 'muse-spark-1.3',
        approvalMode: 'promptUnmatched',
      })
      const events: AgentEvent[] = []
      session.onEvent((event) => {
        events.push(event)
      })
      await session.sendTurn([{ type: 'text', text: 'hello' }], 'hello')
      await vi.waitFor(() => {
        expect(events.some((event) => event.type === 'turnCompleted')).toBe(true)
      })
      expect(JSON.stringify(events)).toContain('From the bundle.')
      expect(log.error).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
    }
  })
})
