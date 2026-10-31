// RLF-ACPHONEST B3 (RLF-HARVEST H7): the ACP `an update was not sent` warning
// names its cause kind. The real agent serves a real client over real
// newline-delimited streams; the agent-to-client direction is destroyed
// mid-session and the next update fails with the stream's own coded error.
// The warning keeps the machine code (causeForLog), which a bare kind never
// would — that is why the site keeps causeForLog instead of failureForLog.
import { PassThrough, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk/unstable'
import { afterEach, describe, expect, it } from 'vitest'
import { webReadable } from '../../src/runtime/webStreams'
import type { LoggedMessage } from './helpers/collectingLogger'
import { closeAcpReplayRigs, startAcpReplayRig } from './helpers/acpReplayRig'

afterEach(closeAcpReplayRigs)

describe('ACP unsent updates name their cause', () => {
  it('warns the stream failure kind when the client is gone', async () => {
    const { folder, agent, logged } = startAcpReplayRig()
    const toAgent = new PassThrough()
    const toClient = new PassThrough()
    const agentConnection = agent.connect(
      acp.ndJsonStream(Writable.toWeb(toClient), webReadable(toAgent)),
    )
    const editor = acp
      .client({ name: 'acp-update-not-sent' })
      .connect(acp.ndJsonStream(Writable.toWeb(toAgent), webReadable(toClient))).agent
    try {
      await editor.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const created = await editor.request('session/new', { cwd: folder, mcpServers: [] })
      // The editor is gone: everything the agent sends from here fails.
      toClient.destroy()
      const pending = editor.request('session/set_mode', {
        sessionId: created.sessionId,
        modeId: 'plan',
      })
      // The doomed request's rejection is expected and never awaited; the
      // wrapper swallows it so the run reports no unhandled rejection.
      void (async () => {
        try {
          await pending
        } catch {
          // Expected: the editor is gone, so the request never answers.
        }
      })()
      for (let attempt = 0; ; attempt += 1) {
        const warns = logged.filter(
          (entry: LoggedMessage) =>
            entry.level === 'warn' && entry.message.includes('an update was not sent'),
        )
        if (warns.length > 0) {
          // A name and a machine-code word (here `AbortError ABORT_ERR`),
          // never a bare name and never free text: exactly what
          // failureForLog would lose.
          const tail = warns[0]?.message.split('an update was not sent: ', 2)[1] ?? ''
          expect(tail).toMatch(/^[A-Za-z]+ [A-Z][A-Z0-9_]+$/u)
          break
        }
        if (attempt === 199) throw new Error('the unsent update was never warned')
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      agentConnection.close()
      toAgent.destroy()
    }
  })
})
