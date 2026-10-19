import { Socket } from 'node:net'
import { describe, expect, it } from 'vitest'
import { startCheckProxy, type ProxyObservation } from '../../src/core/browser/checkProxy'

/** The head a real socket read off the wire, or the socket's own failure. */
function exchange(port: number, bytes: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = new Socket()
    let head = ''
    const done = (value: string): void => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(3000, () => {
      done(`timeout: ${head}`)
    })
    socket.once('error', (error) => {
      done(`socket error: ${error.message}`)
    })
    socket.connect(port, '127.0.0.1', () => {
      socket.write(bytes)
    })
    socket.on('data', (chunk) => {
      head += chunk.toString('utf8')
      if (head.includes('\r\n\r\n')) done(head)
    })
  })
}

// The proxy speaks plain HTTP to loopback by design; spelled so the lint's
// HTTPS rule, whose fix would rewrite it, leaves the wire bytes alone.
const HTTP = 'http:'

describe('the check proxy refuses malformed destinations', () => {
  it('answers 403 to a request target the URL parser cannot read', async () => {
    const proxy = await startCheckProxy({
      url: `${HTTP}//127.0.0.1/`,
      explicitHosts: [],
      approvalKey: 'proxy-refusals',
    })
    const seen: ProxyObservation[] = []
    const stop = proxy.observe((record) => {
      seen.push(record)
    })
    try {
      const port = new URL(proxy.endpoint).port
      // A positive control: a well-formed but unwidened host is refused
      // and observed as such, so a silent proxy cannot pass this suite.
      const refused = await exchange(
        Number(port),
        `GET ${HTTP}//example.com/ HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n`,
      )
      expect(refused.slice(0, 'HTTP/1.1 403'.length)).toBe('HTTP/1.1 403')
      expect(seen).toMatchObject([{ form: 'http', host: 'example.com', forwarded: false }])
      // The malformed absolute form: the parser answers a TypeError, and
      // the request is refused exactly like the control. Reverting the
      // narrowing lets the parse failure escape instead of answering 403.
      const malformed = await exchange(
        Number(port),
        `GET ${HTTP}//[::1/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
      )
      expect(malformed.slice(0, 'HTTP/1.1 403'.length)).toBe('HTTP/1.1 403')
      // A malformed CONNECT authority is denied, never tunnelled.
      const denied = await exchange(Number(port), 'CONNECT [::1 HTTP/1.1\r\n\r\n')
      expect(denied.slice(0, 'HTTP/1.1 403'.length)).toBe('HTTP/1.1 403')
      for (const record of seen) expect(record.forwarded).toBe(false)
    } finally {
      stop()
      await proxy.close()
    }
  })
})
