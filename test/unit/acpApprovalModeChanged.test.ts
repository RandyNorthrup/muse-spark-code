// RLF-ACPHONEST B2 (RLF-HARVEST H6): the ACP editor hears the mode Muse Code
// actually runs. The echo of the client's own set is one info line, never a
// warning; a move the CLI made on its own warns once and the editor is told
// the running mode plus fresh config options.
//
// The real ACP agent talks to a real ACP client over the real SDK transport,
// backed by the real MuseCodeHost over the replay wire. Every wire byte is
// recorded live with zero model calls: the 1.4.11 echo capture
// (test/fixtures/acphonest/) for the start, the mode acks and the released
// broadcasts; the 1.4.7 echo capture's model/list (1.4.11 serves the echo
// catalogue empty) for the session setup the agent always runs. The
// moved-mode step replays a recorded onRequest
// broadcast the CLI emitted for a set: the bytes are served verbatim and only
// the precondition (the client holds acceptEdits) is the test's, which is
// exactly what a ceiling or managed policy produces.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { Connection } from '@muse-code/sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpMakerSurface } from '../../src/acp/maker'
import { AcpPaidUse } from '../../src/acp/paid'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { paidGrantFile } from '../../src/runtime/paidGrants'
import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable'
import {
  type Answer,
  recordedResult,
  refuseUnscripted,
  ReplayWire,
  type WireFrame,
} from './helpers/museReplay'
import { levelLogger, type LoggedMessage } from './helpers/collectingLogger'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/acphonest/${name}`, import.meta.url), 'utf8'))
}

function noteParams(name: string): Record<string, unknown>[] {
  return fixture(name) as Record<string, unknown>[]
}

const logged: LoggedMessage[] = []
const log = levelLogger(logged)
const hosts: { host: MuseCodeHost; wire: ReplayWire }[] = []
const folders: string[] = []
afterEach(async () => {
  for (const { host, wire } of hosts.splice(0)) {
    wire.finish()
    await host.close()
  }
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  logged.length = 0
})

/** The real host over the replay wire; answers are recorded frames only. */
function replayHost(): { host: MuseCodeHost; wire: ReplayWire } {
  const wire = new ReplayWire()
  const acks: Readonly<Record<string, unknown>> = {
    onRequest: fixture('mode-ack-onRequest-1.4.11.json'),
    denyUnmatched: fixture('mode-ack-denyUnmatched-1.4.11.json'),
    allowAll: fixture('mode-ack-allowAll-1.4.11.json'),
    promptUnmatched: fixture('mode-ack-promptUnmatched-1.4.11.json'),
  }
  const skills = fixture('skill-list-1.4.11.json')
  wire.answer = (method, params): Answer => {
    switch (method) {
      case 'model/list': {
        return { result: recordedResult(2) }
      }
      case 'session/start': {
        return { result: fixture('session-start-1.4.11.json') }
      }
      case 'session/setReasoningEffort': {
        return { result: fixture('session-setReasoningEffort-1.4.11.json') }
      }
      case 'session/setPermissionProfile': {
        return { result: fixture('session-setPermissionProfile-1.4.11.json') }
      }
      case 'skill/list': {
        return { result: skills }
      }
      case 'session/setApprovalMode': {
        const ack = typeof params['mode'] === 'string' ? acks[params['mode']] : undefined
        return ack === undefined ? refuseUnscripted(method) : { result: ack }
      }
      default: {
        return refuseUnscripted(method)
      }
    }
  }
  const connection = new Connection(wire.transport())
  const host = new MuseCodeHost(
    {
      connection,
      initializeResult: fixture('initialize-1.4.11.json'),
      exited: Promise.withResolvers<{ code: number | null; signal: string | null }>().promise,
      close: async () => {
        wire.finish()
        await connection.close()
      },
    },
    log,
  )
  const live = { host, wire }
  hosts.push(live)
  return live
}

function serveAgent(host: MuseCodeHost, folder: string): ReturnType<typeof createAcpAgent> {
  return createAcpAgent({
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: '0.19.0',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: {
      id: 'login',
      name: 'Muse Code',
      description: 'Muse Code',
      args: [],
      command: 'muse login',
    },
    defaultCwd: folder,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: paidGrantFile({
        file: path.join(folder, 'paid-grants.json'),
        log,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
      log,
    }),
    maker: new AcpMakerSurface({ log }),
    log,
    questions: 'decline',
  })
}

function releaseNotes(wire: ReplayWire, name: string): void {
  for (const params of noteParams(name)) {
    const frame: WireFrame = { jsonrpc: '2.0', method: 'session/approvalModeChanged', params }
    wire.release(frame)
  }
}

/** A released broadcast is answered in order, so a backend round trip after it proves it was handled. */
async function flushBackend(host: MuseCodeHost): Promise<void> {
  await host.listModels()
}

/** The client's mode updates in arrival order. */
function modeUpdates(seen: readonly SessionUpdate[]): readonly string[] {
  return seen
    .filter(
      (update): update is Extract<SessionUpdate, { sessionUpdate: 'current_mode_update' }> =>
        update.sessionUpdate === 'current_mode_update',
    )
    .map((update) => update.currentModeId)
}

function approvalLines(): LoggedMessage[] {
  return logged.filter((entry) => entry.message.includes('approval mode'))
}

/** Wait for the client to show an update, or fail past the bound. */
async function untilModeUpdate(seen: readonly SessionUpdate[], modeId: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (modeUpdates(seen).includes(modeId)) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`the client never showed mode ${modeId}`)
}

/** The refreshed mode option the client was sent, once it arrives. */
async function untilConfigRefresh(seen: readonly SessionUpdate[]): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const refreshed = seen.filter((update) => update.sessionUpdate === 'config_option_update')
    const last = refreshed.at(-1)
    if (
      last?.sessionUpdate === 'config_option_update' &&
      last.configOptions.find((option) => option.id === 'mode')?.currentValue === 'auto'
    )
      return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('the client never showed the refreshed mode option')
}

describe('ACP approvalModeChanged tells the truth', () => {
  it('logs the set echo once at info and never warns it', async () => {
    const { host, wire } = replayHost()
    const folder = mkdtempSync(path.join(tmpdir(), 'acp-mode-echo-'))
    folders.push(folder)
    const agent = serveAgent(host, folder)
    const seen: SessionUpdate[] = []
    await acp
      .client({ name: 'acp-mode-echo' })
      .onNotification('session/update', (context) => {
        seen.push(context.params.update)
      })
      .connectWith(agent, async (editor) => {
        await editor.request('initialize', {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        })
        const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
        const sessionId = created.sessionId
        // The start's own broadcast: the CLI runs what the client set.
        releaseNotes(wire, 'note-approvalModeChanged-initial-1.4.11.json')
        await editor.request('session/set_mode', { sessionId, modeId: 'acceptEdits' })
        // The set's echo: the same wire word the client already runs.
        releaseNotes(wire, 'note-approvalModeChanged-promptUnmatched-1.4.11.json')
        await editor.request('session/set_mode', { sessionId, modeId: 'plan' })
        // The plan set's own echo.
        releaseNotes(wire, 'note-approvalModeChanged-denyUnmatched-1.4.11.json')
        await flushBackend(host)
      })
    // Only the sets' own acknowledgements: no echo ever moved the editor.
    expect(modeUpdates(seen)).toEqual(['acceptEdits', 'plan'])
    expect(approvalLines().filter((entry) => entry.level === 'warn')).toEqual([])
    // The start echo and the plan echo; the acceptEdits echo repeats the
    // start's word and stays silent.
    expect(
      approvalLines()
        .filter((entry) => entry.level === 'info')
        .map((entry) => entry.message.replace(/^ACP session [^:]+: /, '')),
    ).toEqual([
      'Muse Code runs approval mode promptUnmatched',
      'Muse Code runs approval mode denyUnmatched',
    ])
  })

  it('tells the editor the mode when the CLI moved on its own', async () => {
    const { host, wire } = replayHost()
    const folder = mkdtempSync(path.join(tmpdir(), 'acp-mode-moved-'))
    folders.push(folder)
    const agent = serveAgent(host, folder)
    const seen: SessionUpdate[] = []
    await acp
      .client({ name: 'acp-mode-moved' })
      .onNotification('session/update', (context) => {
        seen.push(context.params.update)
      })
      .connectWith(agent, async (editor) => {
        await editor.request('initialize', {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {},
        })
        const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
        const sessionId = created.sessionId
        await editor.request('session/set_mode', { sessionId, modeId: 'acceptEdits' })
        // The CLI moved while the client holds acceptEdits: the recorded
        // onRequest word selects Auto, not the client's mode.
        releaseNotes(wire, 'note-approvalModeChanged-onRequest-1.4.11.json')
        await untilModeUpdate(seen, 'auto')
        await untilConfigRefresh(seen)
      })
    expect(modeUpdates(seen)).toEqual(['acceptEdits', 'auto'])
    const lines = approvalLines()
    expect(lines.filter((entry) => entry.level === 'warn')).toHaveLength(1)
    expect(lines.find((entry) => entry.level === 'warn')?.message).toContain(
      'Muse Code now runs approval mode onRequest',
    )
    const refreshed = seen.filter((update) => update.sessionUpdate === 'config_option_update')
    expect(refreshed.length).toBeGreaterThan(0)
    const last = refreshed.at(-1)
    expect(
      last?.sessionUpdate === 'config_option_update'
        ? last.configOptions.find((option) => option.id === 'mode')?.currentValue
        : undefined,
    ).toBe('auto')
  })
})
