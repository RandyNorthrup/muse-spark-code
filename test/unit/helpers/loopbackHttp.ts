// POST helpers for the loopback JSON-RPC tests (the `ide` server's and the
// team bridge's, M96 lane B): one place for the endpoint shape and the JSON
// body, so the two suites never drift apart.

export interface LoopbackEndpoint {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export async function postLoopback(
  endpoint: LoopbackEndpoint,
  body: string,
  headers?: Record<string, string>,
): Promise<Response> {
  return await fetch(endpoint.url, {
    method: 'POST',
    headers: { ...(headers ?? endpoint.headers), 'content-type': 'application/json' },
    body,
  })
}

export async function postLoopbackJson(
  endpoint: LoopbackEndpoint,
  body: unknown,
): Promise<unknown> {
  const response = await postLoopback(endpoint, JSON.stringify(body))
  return await response.json()
}
