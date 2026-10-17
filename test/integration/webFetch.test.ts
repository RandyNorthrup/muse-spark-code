// Web fetch through VS Code's own proxy support (M69, PLAN.md D49), inside
// the Extension Development Host, where VS Code has patched Node's `https`
// for extensions. A loopback proxy stands in for the user's: the fetch must
// ask it to tunnel to the PINNED address (never the name), send the page's
// name only inside TLS (SNI), and refuse the proxy's own answer as a page.
// Nothing leaves the machine: the tunnel is never opened to the address.

import * as assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createServer, type Server, type Socket } from 'node:net'
import * as vscode from 'vscode'
import type { PinnedTarget } from '../../src/core/web/webFetch'
import { pinnedHttpsRequest } from '../../src/host/web/pinnedRequest'

// TEST-NET-3: never routed, so a request that skipped the proxy would hang.
const PINNED = '203.0.113.7'
const NAME = 'pinned.example.com'
const TIMEOUT_MS = 8000
const POLL_MS = 50
const CRLF = '\r\n'

/** One tunnel the proxy was asked for, and whether its ClientHello named the page. */
interface Tunnel {
  readonly requestLine: string
  helloHasName: boolean | undefined
}

type ProxySeen = Tunnel[]

/**
 * The tunnels asked for this page, by its address or its name. The proxy is
 * VS Code's setting for the whole window while a test runs, so VS Code's own
 * requests may pass through it too; they are not the fetch's.
 */
function pageTunnels(seen: ProxySeen): readonly Tunnel[] {
  return seen.filter(
    (tunnel) => tunnel.requestLine.includes(PINNED) || tunnel.requestLine.includes(NAME),
  )
}

/** A proxy that records each CONNECT; it answers `status`, and after a 200 reads the ClientHello. */
async function recordingProxy(status: number): Promise<{ server: Server; seen: ProxySeen }> {
  const seen: ProxySeen = []
  const server = createServer((socket: Socket) => {
    socket.once('data', (chunk: Buffer) => {
      const tunnel: Tunnel = {
        requestLine: chunk.toString('latin1').split(CRLF)[0] ?? '',
        helloHasName: undefined,
      }
      seen.push(tunnel)
      if (status !== 200) {
        socket.end(`HTTP/1.1 ${String(status)} Refused${CRLF}Content-Length: 0${CRLF}${CRLF}`)
        return
      }
      socket.write(`HTTP/1.1 200 Connection established${CRLF}${CRLF}`)
      socket.once('data', (hello: Buffer) => {
        tunnel.helloHasName = hello.includes(Buffer.from(NAME, 'latin1'))
        socket.destroy()
      })
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return { server, seen }
}

function portOf(server: Server): number {
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  return address.port
}

/** Sets `http.proxy` for the test profile and waits until the extension host sees it. */
async function useProxy(url: string | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration('http')
    .update('proxy', url, vscode.ConfigurationTarget.Global)
  const deadline = Date.now() + TIMEOUT_MS
  while (vscode.workspace.getConfiguration('http').get<string>('proxy') !== (url ?? '')) {
    assert.ok(Date.now() < deadline, 'http.proxy did not reach the extension host')
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}

/** When the connection is up does not matter here: the proxy never completes TLS. */
function ignoreConnected(): void {
  // Nothing to record.
}

const TARGET: PinnedTarget = {
  url: new URL(`https://${NAME}/page`),
  host: NAME,
  address: PINNED,
  family: 4,
}

/**
 * The pinned request made through a recording proxy that answers CONNECT
 * with `status`; the proxy setting is put back afterwards.
 */
async function throughProxy(
  status: number,
  check: (request: Promise<unknown>, seen: ProxySeen) => Promise<void>,
): Promise<void> {
  const { server, seen } = await recordingProxy(status)
  const previous = vscode.workspace.getConfiguration('http').inspect('proxy')?.globalValue
  await useProxy(`http://127.0.0.1:${String(portOf(server))}`)
  try {
    await check(pinnedHttpsRequest(TARGET, AbortSignal.timeout(TIMEOUT_MS), ignoreConnected), seen)
  } finally {
    await useProxy(typeof previous === 'string' ? previous : undefined)
    server.close()
  }
}

suite("web fetch through VS Code's proxy (M69)", () => {
  test('tunnels to the pinned address, with the name only in TLS', async () => {
    await throughProxy(200, async (request, seen) => {
      await assert.rejects(request)
      assert.deepEqual(pageTunnels(seen), [
        { requestLine: `CONNECT ${PINNED}:443 HTTP/1.1`, helloHasName: true },
      ])
    })
  })

  test("refuses the proxy's own answer to the tunnel, never reading it as the page", async () => {
    await throughProxy(403, async (request, seen) => {
      await assert.rejects(
        request,
        /Proxy response \(403\) instead of a TLS connection to 203\.0\.113\.7/,
      )
      assert.deepEqual(
        pageTunnels(seen).map((tunnel) => tunnel.requestLine),
        [`CONNECT ${PINNED}:443 HTTP/1.1`],
      )
    })
  })
})
