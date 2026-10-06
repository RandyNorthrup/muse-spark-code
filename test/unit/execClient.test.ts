import * as acp from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecClient } from '../../src/runtime/exec/execClient'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { createExecSink } from '../../src/runtime/exec/execOutput'
import { UI_TEXT } from '../../src/shared/constants'
import { outputWriter } from './helpers/execContract'

vi.mock('@agentclientprotocol/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof acp>()),
}))

function input() {
  const out = outputWriter()
  const lifecycle = createLifecycle({
    processStartMs: 0,
    timeoutMs: 100,
    now: () => 0,
    setTimer: () => vi.fn(),
    onSignal: () => vi.fn(),
    forceFinish: vi.fn(),
    exit: (): never => {
      throw new Error('unexpected exit')
    },
  })
  const sink = createExecSink({
    format: 'jsonl',
    out,
    now: () => 0,
    literals: () => [],
    summary: vi.fn(),
    onStalled: vi.fn(),
  })
  return {
    out,
    sink,
    lifecycle,
    onDenial: vi.fn(),
    onQuestion: vi.fn(),
    onFilesChanged: vi.fn(),
  }
}

/** Alter only a test instance; neither dependency nor production builder is patched. */
function changeBuilder(builder: unknown): void {
  const original = acp.client
  vi.spyOn(acp, 'client').mockImplementation((options) => {
    const client = original(options)
    Reflect.set(client, 'builder', builder)
    return client
  })
}

describe('exec client: pinned ACP constructor seam with Muse Code SDK 1.4.2', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([null, {}, { handlers: null }, { handlers: [] }, { handlers: [{}, {}] }])(
    'fails closed for changed builder structure %j',
    (builder) => {
      changeBuilder(builder)
      expect(() => createExecClient(input())).toThrow(UI_TEXT.execRequestShape)
    },
  )

  it.each([null, {}, { describe: 'not callable' }, { describe: () => 'another-router' }])(
    'fails closed for changed constructor handler %j',
    (handler) => {
      changeBuilder({ handlers: [handler] })
      expect(() => createExecClient(input())).toThrow(UI_TEXT.execRequestShape)
    },
  )

  it('preserves a future non-tool update through real JSON-RPC and suppresses tool and message bytes', async () => {
    const deps = input()
    const client = createExecClient(deps)
    const incoming = new TransformStream<Uint8Array, Uint8Array>()
    const outgoing = new WritableStream<Uint8Array>()
    const connection = client.connect(acp.ndJsonStream(outgoing, incoming.readable))
    const writer = incoming.writable.getWriter()
    for (const update of [
      { sessionUpdate: 'future_non_tool', extra: { retained: true } },
      { sessionUpdate: 'tool_future_update', rawOutput: 'withheld-tool' },
      { sessionUpdate: 'agent_message_chunk.v2', content: { text: 'withheld-message' } },
      { sessionUpdate: 'agent_thought_chunk', content: { text: 'withheld-thought' } },
    ]) {
      await writer.write(
        new TextEncoder().encode(
          `${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update } })}\n`,
        ),
      )
    }
    await writer.close()
    await connection.closed
    deps.lifecycle.dispose()
    expect(deps.lifecycle.cause).toBeNull()
    expect(deps.out.chunks).toHaveLength(1)
    expect(deps.out.chunks[0]).toContain('future_non_tool')
    expect(deps.out.chunks[0]).toContain('"retained":true')
    expect(deps.out.chunks.join('')).not.toContain('withheld-')
  })
})
