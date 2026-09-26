// The ACP agent as editors run it (M63, PLAN.md D62): `acp.js` bundled from
// the source as the build bundles it (or, with MUSE_ACP_PACKAGE_DIR, the
// package npm installed, as hosts.yml checks it on each platform), started
// as a real child process, and
// driven over its stdio by the ACP SDK's own client, on the fake Muse Code
// CLI of fake-muse/serve.mjs. A reply streamed, a tool call allowed and one
// denied, a cancel, the session listed, sign-in asked for, and the key never
// on the wire.

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import { EXPECTED_SCHEMA_FINGERPRINT } from '@muse-code/sdk'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { webReadable } from '../../src/runtime/webStreams'
import { removeFolder } from '../unit/helpers/temporaryFolders'
import { installFakeCredential, installFakeMuse } from './fakeMuse'

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
const workspace = mkdtempSync(path.join(tmpdir(), 'acp-e2e-ws-'))
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
  writeFileSync(path.join(PACKAGE, 'package.json'), JSON.stringify({ version: LAID_OUT_VERSION }))
  cpSync(path.join(ROOT, 'l10n'), path.join(PACKAGE, 'l10n'), { recursive: true })
})

afterAll(async () => {
  for (const child of children) {
    child.kill()
  }
  const made = [fake.installDir, signedIn, signedOut, workspace]
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

function startAgent(configHome: string, args: readonly string[] = []): Session {
  const child = spawn(
    process.execPath,
    [AGENT, '--muse-binary', fake.binaryPath, '--shell-sandbox', 'off', ...args],
    { env: agentEnvironment(configHome), cwd: workspace, stdio: 'pipe' },
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
})
