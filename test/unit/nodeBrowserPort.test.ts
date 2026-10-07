import { describe, expect, it, vi } from 'vitest'
import { nodeHttpsPort, validatedNodePort } from '../../src/webview/bridges/nodePort'
import { NODE_HTTP_BODY_BYTES, NODE_MAX_FILE_BYTES, UI_TEXT } from '../../src/shared/constants'

const signal = () => new AbortController().signal
const file = { workspaceId: 'repo', path: 'hello.txt' }
const result = { path: 'hello.txt', digest: 'a'.repeat(64), text: 'hello' }
function fixture() {
  let bearer: string | undefined = 'b'.repeat(43)
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(result, { headers: { 'Content-Type': 'application/json' } })),
  )
  return {
    fetcher,
    port: nodeHttpsPort({
      origin: 'https://node.local:7443',
      fetch: fetcher,
      bearer: () => bearer,
    }),
    signOut: () => {
      bearer = undefined
    },
  }
}
describe('M110-U1 memory-only node bridge', () => {
  it('H06 uses only the Authorization header with no cookies, persistence, URL token or cache', async () => {
    const { fetcher, port, signOut } = fixture()
    expect(await port.request('node/files/read', file, signal())).toEqual(result)
    const call = fetcher.mock.calls[0]
    expect(call?.[0]).toBeInstanceOf(URL)
    expect(call?.[0] instanceof URL ? call[0].href : undefined).toBe(
      'https://node.local:7443/node/files/read',
    )
    expect(call?.[1]).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      mode: 'same-origin',
      headers: { Authorization: `Bearer ${'b'.repeat(43)}` },
    })
    expect(call?.[1]?.body).toBe(JSON.stringify(file))
    signOut()
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each([
    ['http:', '//node.local'].join(''),
    'https://node.local/path',
    'https://user:password@node.local',
    'https://node.local?token=bad',
  ])('H06 refuses noncanonical origin %s', (origin) => {
    expect(() => nodeHttpsPort({ origin, fetch, bearer: () => 'b'.repeat(43) })).toThrow()
  })
  it('H10 parses params before dispatch and results before use', async () => {
    const transport = { request: vi.fn(() => Promise.resolve({ ...result, extra: 'untrusted' })) }
    const port = validatedNodePort(transport)
    await expect(
      port.request('node/files/read', { ...file, path: '../bad' }, signal()),
    ).rejects.toThrow()
    expect(transport.request).not.toHaveBeenCalled()
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow()
  })
  it('H09 bounds streamed responses before parsing JSON', async () => {
    const { port, fetcher } = fixture()
    const cancelled = vi.fn()
    fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(NODE_HTTP_BODY_BYTES + 1))
          },
          cancel: cancelled,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    )
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow()
    expect(cancelled).toHaveBeenCalledOnce()
  })
  it('H09 refuses serialized request expansion before dispatch', async () => {
    const { port, fetcher } = fixture()
    await expect(
      port.request(
        'node/files/write',
        { ...file, text: '\0'.repeat(NODE_MAX_FILE_BYTES), expectedDigest: null },
        signal(),
      ),
    ).rejects.toThrow(UI_TEXT.nodeErrors.tooLarge)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('refuses an empty JSON response body with a fixed error', async () => {
    const { port, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(
      new Response(null, { headers: { 'Content-Type': 'application/json' } }),
    )
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow(
      UI_TEXT.nodeErrors.invalidRequest,
    )
  })
  it('refuses valid-looking JSON with the wrong response content type', async () => {
    const { port, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(
      Response.json(result, { headers: { 'Content-Type': 'text/plain' } }),
    )
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow(
      UI_TEXT.nodeErrors.invalidRequest,
    )
  })
  it('refuses invalid UTF-8 even when replacement would produce valid JSON', async () => {
    const { port, fetcher } = fixture()
    const bytes = Buffer.from(JSON.stringify({ ...result, text: 'INVALID_UTF8' }))
    bytes[bytes.indexOf('INVALID_UTF8')] = 255
    fetcher.mockResolvedValueOnce(
      new Response(bytes, { headers: { 'Content-Type': 'application/json' } }),
    )
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow()
  })
  it('scrubs server failure text and refuses wrong response type or cancelled result', async () => {
    const { port, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(
      Response.json(
        { code: 'forbidden', text: 'private server detail' },
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow('unavailable')
    fetcher.mockResolvedValueOnce(new Response('not json'))
    await expect(port.request('node/files/read', file, signal())).rejects.toThrow()
    const controller = new AbortController()
    controller.abort()
    await expect(port.request('node/files/read', file, controller.signal)).rejects.toThrow()
  })
  it('refuses a result delivered after cancellation', async () => {
    const controller = new AbortController()
    const request = vi.fn(() => {
      controller.abort()
      return Promise.resolve(result)
    })
    await expect(
      validatedNodePort({ request }).request('node/files/read', file, controller.signal),
    ).rejects.toThrow()
    expect(request).toHaveBeenCalledOnce()
  })
})
