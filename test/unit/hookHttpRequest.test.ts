// M91 lane H: the http hook's POST over the pinned-request path. No sockets:
// the request function is a stand-in with the same shape, so these tests
// run where loopback servers cannot. The production path always requires
// TLS; `isTlsRequired: false` is the tests' alone.

import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import { describe, expect, it, vi } from 'vitest'
import { hookHttpHeaders } from '../../src/core/backends/modelapi/hookHandlers'
import { HOOK_OUTPUT_MAX_BYTES } from '../../src/shared/constants'
import {
  pinnedPostOptions,
  pinnedPostRequest,
  type RequestFunction,
} from '../../src/host/web/pinnedRequest'
import { postHookPayload } from '../../src/host/web/hookHttpRequest'
import type { PinnedTarget } from '../../src/core/web/webFetch'

interface Seen {
  options?: RequestOptions
  body?: unknown
}

/** A request stand-in: records its options and answers the canned reply. */
function canned(
  seen: Seen,
  reply: (options: RequestOptions) => { status: number; body: string } | { error: Error },
): RequestFunction {
  const request = (options: RequestOptions, onResponse: (response: IncomingMessage) => void) => {
    seen.options = options
    const outgoing = Object.assign(new EventEmitter(), {
      end: (chunk?: unknown) => {
        seen.body = chunk
        setImmediate(() => {
          if (options.signal instanceof AbortSignal && options.signal.aborted) {
            outgoing.emit('error', new Error('the request was aborted'))
            return
          }
          const answered = reply(options)
          if ('error' in answered) {
            outgoing.emit('error', answered.error)
            return
          }
          const incoming = Object.assign(Readable.from([answered.body]), {
            statusCode: answered.status,
            headers: { 'content-type': 'application/json' },
            socket: {},
          })
          onResponse(incoming as unknown as IncomingMessage)
        })
      },
      destroy: () => undefined,
    })
    return outgoing as unknown as ClientRequest
  }
  return request
}

function ok(seen: Seen, body = '{"ok":true}'): RequestFunction {
  return canned(seen, () => ({ status: 200, body }))
}

function target(url: string, address = '127.0.0.1'): PinnedTarget {
  const parsed = new URL(url)
  return { url: parsed, host: parsed.hostname.replaceAll(/^\[|\]$/g, ''), address, family: 4 }
}

function plainHttpUrl(): string {
  const url = new URL('https://hooks.example.com/hook')
  url.protocol = 'http:'
  return url.href
}

describe('pinnedPostRequest (M91)', () => {
  it('POSTs to the pinned address with the page name in TLS and the Host header', () => {
    const options = pinnedPostOptions(
      target('https://hooks.example.com/hook?a=1', '93.184.215.14'),
      '{"a":1}',
      hookHttpHeaders(),
      new AbortController().signal,
    )
    expect(options).toMatchObject({
      method: 'POST',
      host: '93.184.215.14',
      family: 4,
      path: '/hook?a=1',
      servername: 'hooks.example.com',
    })
    const headers = options.headers as Record<string, string>
    expect(headers['host']).toBe('hooks.example.com')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['content-length']).toBe(String(Buffer.byteLength('{"a":1}')))
    expect(JSON.stringify(headers)).not.toContain('API_KEY')
  })

  it('sends the body and hands over the first response, following nothing', async () => {
    const seen: Seen = {}
    const connected = vi.fn()
    const response = await pinnedPostRequest(
      target('https://hooks.example.com/hook', '93.184.215.14'),
      '{"hook_event_name":"Stop"}',
      hookHttpHeaders(),
      new AbortController().signal,
      connected,
      ok(seen, 'moved'),
      false,
    )
    expect(response.status).toBe(200)
    response.close()
    expect(seen.options).toMatchObject({ method: 'POST', host: '93.184.215.14' })
    expect(seen.body).toBe('{"hook_event_name":"Stop"}')
  })
})

describe('postHookPayload (M91)', () => {
  it('POSTs the payload and returns the status, headers and body', async () => {
    const seen: Seen = {}
    const result = await postHookPayload(
      'https://hooks.example.com/hook',
      '{"hook_event_name":"Stop"}',
      new AbortController().signal,
      {
        resolve: () => Promise.resolve(['93.184.215.14']),
        request: ok(seen),
        isTlsRequired: false,
      },
    )
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toBe('application/json')
    expect(result.bodyText).toBe('{"ok":true}')
    expect(seen.options).toMatchObject({ method: 'POST', host: '93.184.215.14' })
    expect(seen.body).toBe('{"hook_event_name":"Stop"}')
    const headers = seen.options!.headers as Record<string, string>
    expect(headers['host']).toBe('hooks.example.com')
    expect(headers['content-type']).toBe('application/json')
  })

  it('refuses plain HTTP, unresolvable hosts and aborts', async () => {
    await expect(
      postHookPayload(plainHttpUrl(), '{}', new AbortController().signal, {
        resolve: () => Promise.resolve(['93.184.215.14']),
      }),
    ).rejects.toThrow('HTTPS')
    await expect(
      postHookPayload('https://hooks.example.com/hook', '{}', new AbortController().signal, {
        resolve: () => Promise.resolve([]),
      }),
    ).rejects.toThrow('did not resolve')
    const seen: Seen = {}
    const controller = new AbortController()
    controller.abort()
    await expect(
      postHookPayload('https://hooks.example.com/hook', '{}', controller.signal, {
        resolve: () => Promise.resolve(['93.184.215.14']),
        request: ok(seen),
        isTlsRequired: false,
      }),
    ).rejects.toThrow()
  })

  it('tries the next address when one refuses the connection', async () => {
    const seen: Seen = {}
    const resolve = vi.fn((_host: string): Promise<readonly string[]> =>
      Promise.resolve(['192.0.2.1', '93.184.215.14']),
    )
    const request = canned(seen, (options) =>
      options.host === '192.0.2.1'
        ? { error: new Error('connection refused') }
        : { status: 200, body: '{}' },
    )
    const result = await postHookPayload(
      'https://hooks.example.com/hook',
      '{}',
      new AbortController().signal,
      {
        resolve,
        request,
        isTlsRequired: false,
      },
    )
    expect(result.status).toBe(200)
    expect(seen.options).toMatchObject({ host: '93.184.215.14' })
    expect(resolve).toHaveBeenCalledWith('hooks.example.com')
  })

  it('bounds the answer body', async () => {
    const seen: Seen = {}
    const result = await postHookPayload(
      'https://hooks.example.com/hook',
      '{}',
      new AbortController().signal,
      {
        resolve: () => Promise.resolve(['93.184.215.14']),
        request: ok(seen, `{"pad":"${'x'.repeat(40_000)}"}`),
        isTlsRequired: false,
      },
    )
    expect(result.status).toBe(200)
    expect(Buffer.byteLength(result.bodyText)).toBeLessThanOrEqual(HOOK_OUTPUT_MAX_BYTES)
  })
})
