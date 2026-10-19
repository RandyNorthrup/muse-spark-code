// The exec transport's refusal rules: malformed addresses, bodies and
// stream frames refuse with the request shape, and a malformed frame still
// settles its ledger ticket. The transport pins the provider origin, so no
// loopback server can reach it: the upstream answer is a real Response
// carrying real bytes through the real stream parser.
import { describe, expect, it } from 'vitest'
import { Usd } from '../../src/shared/usd'
import { MODEL_API_BASE_URL, UI_TEXT } from '../../src/shared/constants'
import { execFetch } from '../../src/runtime/exec/execFetch'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { createRunLedger } from '../../src/runtime/exec/runLedger'
import type { ExecEventBody } from '../../src/runtime/exec/execProtocol'

const MODEL = 'muse-spark-1.3'
const RESPONSES_URL = `${MODEL_API_BASE_URL}/responses`
const BODY = JSON.stringify({ model: MODEL, stream: true, max_output_tokens: 4096 })

/** A listener the test never triggers. */
function ignore(): void {
  // Nothing to observe on this path.
}
function ignoreSignal(): () => void {
  return ignore
}
function malformedUpstream(): Promise<Response> {
  return Promise.resolve(
    new Response('data: {oops\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
  )
}

function pulleys(fetcher: typeof fetch = fetch) {
  const events: ExecEventBody[] = []
  const latched: unknown[] = []
  const lifecycle = createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: 30_000,
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onSignal: ignoreSignal,
    forceFinish: ignore,
    exit: (code): never => {
      throw new Error(`exit ${String(code)}`)
    },
  })
  const ledger = createRunLedger({ capUsd: Usd.from(10).toAmount(), maxRequests: 5 })
  const transport = execFetch({
    fetch: fetcher,
    ledger,
    selectedModel: MODEL,
    imageGeneration: false,
    lifecycle,
    onLatch: (cause, message) => {
      latched.push({ cause, message })
    },
    emit: (event) => {
      events.push(event)
    },
    onResponseStart: ignore,
    onResponseSettled: ignore,
  })
  return { transport, events, latched, lifecycle }
}

describe('execFetch refusal rules', () => {
  it('refuses an address the URL parser cannot take', async () => {
    const { transport, latched, lifecycle } = pulleys((): Promise<Response> => {
      throw new Error('the upstream is never reached')
    })
    try {
      await expect(transport.fetch('::not a url::', {})).rejects.toThrow(UI_TEXT.execRequestShape)
      expect(latched).toHaveLength(1)
    } finally {
      transport.close()
      lifecycle.dispose()
    }
  })

  it('refuses a body no JSON parser can take', async () => {
    const { transport, latched, lifecycle } = pulleys((): Promise<Response> => {
      throw new Error('the upstream is never reached')
    })
    try {
      await expect(
        transport.fetch(RESPONSES_URL, { method: 'POST', body: '{oops' }),
      ).rejects.toThrow(UI_TEXT.execRequestShape)
      expect(latched).toHaveLength(1)
    } finally {
      transport.close()
      lifecycle.dispose()
    }
  })

  it('settles the ticket when a stream frame is malformed', async () => {
    const { transport, events, lifecycle } = pulleys(malformedUpstream)
    try {
      const response = await transport.fetch(RESPONSES_URL, { method: 'POST', body: BODY })
      await expect(response.text()).rejects.toThrow(UI_TEXT.execRequestShape)
      expect(events.some((event) => event.type === 'attempt' && event.phase === 'settled')).toBe(
        true,
      )
      await transport.whenSettled()
    } finally {
      transport.close()
      lifecycle.dispose()
    }
  })
})
