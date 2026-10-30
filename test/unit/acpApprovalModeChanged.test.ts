// RLF-ACPHONEST B2 (RLF-HARVEST H6): the ACP editor hears the mode Muse Code
// actually runs. The echo of the client's own set is one info line, never a
// warning; a move the CLI made on its own warns once and the editor is told
// the running mode plus fresh config options.
//
// The real ACP agent talks to a real ACP client over the real SDK transport,
// backed by the real MuseCodeHost over the replay wire (see
// helpers/acpReplayRig.ts). The moved-mode step replays a recorded onRequest
// broadcast the CLI emitted for a set: the bytes are served verbatim and only
// the precondition (the client holds acceptEdits) is the test's, which is
// exactly what a ceiling or managed policy produces.
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable'
import type { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import type { LoggedMessage } from './helpers/collectingLogger'
import type { ReplayWire, WireFrame } from './helpers/museReplay'
import { acpNoteParams, closeAcpReplayRigs, startAcpReplayRig } from './helpers/acpReplayRig'

afterEach(closeAcpReplayRigs)

function releaseNotes(wire: ReplayWire, name: string): void {
  for (const params of acpNoteParams(name)) {
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

function approvalLines(logged: readonly LoggedMessage[]): LoggedMessage[] {
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
    const { host, wire, folder, agent, logged } = startAcpReplayRig()
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
    expect(approvalLines(logged).filter((entry) => entry.level === 'warn')).toEqual([])
    // The start echo and the plan echo; the acceptEdits echo repeats the
    // start's word and stays silent.
    expect(
      approvalLines(logged)
        .filter((entry) => entry.level === 'info')
        .map((entry) => entry.message.replace(/^ACP session [^:]+: /, '')),
    ).toEqual([
      'Muse Code runs approval mode promptUnmatched',
      'Muse Code runs approval mode denyUnmatched',
    ])
  })

  it('tells the editor the mode when the CLI moved on its own', async () => {
    const { wire, folder, agent, logged } = startAcpReplayRig()
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
    const lines = approvalLines(logged)
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
