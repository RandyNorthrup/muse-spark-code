// ACP lifecycle regressions use the real MuseCodeHost and MuseSession over
// the SDK's in-memory transport, so retention and late wire answers are real.

import { MuseCodeHost } from '../../../src/core/backends/musecode/MuseCodeHost'
import { FakeLogOutputChannel } from './fakes'
import { fakeMspHost, type FakeMspServer } from './fakeMsp'

const COMMAND_TIMEOUT_MS = 2000
const SESSION_ID = 'old-1'

function ack(params: Record<string, unknown>) {
  return { commandId: params['commandId'] }
}

/** M6's captured resume envelope, trimmed to the fields this regression needs. */
export function acpResumeEnvelope() {
  return {
    session: {
      sessionId: SESSION_ID,
      status: 'idle',
      activeTurnId: null,
      createdAt: '2026-09-22T10:00:00Z',
      updatedAt: '2026-09-22T11:00:00Z',
      workspaceRoot: '/ws',
      turnCount: 1,
    },
    history: { mode: 'inline', items: [], snapshot: null },
    pendingRequests: [],
    viewCursor: 'v:old:3',
  }
}

/** Answers an intentionally held MSP request through the actual wire. */
export function answerMsp(
  server: FakeMspServer,
  method: string,
  index: number,
  result: Readonly<Record<string, unknown>>,
): void {
  const request = server.requestsFor(method)[index]
  if (request?.id === undefined) {
    throw new Error(`no request ${method} at ${String(index)}`)
  }
  server.incoming.push(
    `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { commandId: request.params?.['commandId'], ...result } })}\n`,
  )
}

export function acpMspHost() {
  const handle = fakeMspHost()
  const host = new MuseCodeHost(handle.host, new FakeLogOutputChannel(), {
    normalMs: COMMAND_TIMEOUT_MS,
    longMs: COMMAND_TIMEOUT_MS,
  })
  const { server } = handle
  server.handle('model/list', () => ({
    models: [
      {
        modelId: 'muse-spark-1.3',
        displayLabel: 'Muse Spark 1.3',
        contextLimit: null,
        isDefault: true,
        isActive: true,
      },
    ],
  }))
  server.handle('session/resume', acpResumeEnvelope)
  server.handle('view/page', () => ({ events: [], nextCursor: null }))
  server.handle('session/setApprovalMode', ack)
  server.handle('session/setReasoningEffort', ack)
  server.handle('skill/list', () => ({ skills: [] }))
  server.handle('turn/cancel', ack)
  server.handle('task/stopAll', ack)
  return { ...handle, host }
}
