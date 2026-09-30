import { once } from 'node:events'
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import {
  describeNetworkFailure,
  networkFailureCodes,
  networkFailureMessage,
} from '../../src/core/networkFailure'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

// What Node 24's fetch threw on 2026-09-25 (docs/certification/m56.md): a
// TLS server with a self-signed certificate, and a proxy that answered the
// CONNECT with 407 or 403 (fetch under NODE_USE_ENV_PROXY=1). The error
// classes are rebuilt with the same names, messages and codes.
function capturedCertificateFailure(): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(
      new Error(
        'self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca',
      ),
      { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
    ),
  })
}

function capturedProxyFailure(status: number): TypeError {
  const aborted = Object.assign(
    new Error(`Proxy response (${String(status)}) !== 200 when HTTP Tunneling`),
    { code: 'UND_ERR_ABORTED' },
  )
  // A DOMException's numeric `code` (0) is not an error code.
  const cancelled = new DOMException('Request was cancelled.')
  Object.defineProperty(cancelled, 'cause', { value: aborted })
  return new TypeError('fetch failed', { cause: cancelled })
}

/** A real refusal: fetch to a port nothing listens on. */
async function refusedFetch(): Promise<unknown> {
  const server = net.createServer()
  const listening = once(server, 'listening')
  server.listen(0, '127.0.0.1')
  await listening
  const address = server.address()
  if (typeof address !== 'object' || address === null) {
    server.close()
    throw new Error('The test needs a TCP listener')
  }
  const port = address.port
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
  try {
    await fetch(`http://127.0.0.1:${String(port)}/`)
    return undefined
  } catch (error: unknown) {
    return error
  }
}

describe('describeNetworkFailure (M56, PLAN.md D43)', () => {
  it('reads a refused connection from a real fetch failure', async () => {
    const error = await refusedFetch()
    const failure = describeNetworkFailure(error)
    expect(failure.kind).toBe('unreachable')
    expect(failure.detail).toMatch(/^fetch failed: connect ECONNREFUSED 127\.0\.0\.1:\d+$/)
    expect(networkFailureMessage(error)).toBe(`${UI_TEXT.networkUnreachable} (${failure.detail})`)
  })

  it('names the certificate store for a chain Node does not trust', () => {
    const error = capturedCertificateFailure()
    expect(describeNetworkFailure(error)).toEqual({
      kind: 'certificate',
      detail:
        'fetch failed: self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca (DEPTH_ZERO_SELF_SIGNED_CERT)',
      proxyStatus: undefined,
    })
    expect(
      networkFailureMessage(error).startsWith(
        `${UI_TEXT.networkUntrustedCertificate} (fetch failed: `,
      ),
    ).toBe(true)
  })

  it('tells a proxy that wants credentials from one that refuses the tunnel', () => {
    const credentials = describeNetworkFailure(capturedProxyFailure(407))
    expect(credentials).toEqual({
      kind: 'proxyCredentials',
      detail:
        'fetch failed: Request was cancelled.: Proxy response (407) !== 200 when HTTP Tunneling (UND_ERR_ABORTED)',
      proxyStatus: 407,
    })
    expect(networkFailureMessage(capturedProxyFailure(407))).toContain(
      UI_TEXT.networkProxyCredentials,
    )
    expect(describeNetworkFailure(capturedProxyFailure(403))).toMatchObject({
      kind: 'proxyRefused',
      proxyStatus: 403,
    })
    expect(networkFailureMessage(capturedProxyFailure(403))).toContain(
      fill(UI_TEXT.networkProxyRefused, { status: '403' }),
    )
  })

  it('names each cause by its code for web fetch, its message only where it has none (M69)', () => {
    expect(networkFailureCodes(capturedCertificateFailure())).toBe(
      'fetch failed: DEPTH_ZERO_SELF_SIGNED_CERT',
    )
    const mismatch = Object.assign(
      new Error("Host: a.example. is not in the cert's altnames: DNS:anything a server chose"),
      { code: 'ERR_TLS_CERT_ALTNAME_INVALID' },
    )
    expect(networkFailureCodes(mismatch)).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
    expect(networkFailureCodes(new Error('connect to https://user:hunter2@proxy.test'))).toBe(
      'connect to https://[redacted]@proxy.test',
    )
  })

  it('keeps an unrecognised failure as it came, and stops on odd or endless causes', () => {
    const odd = new TypeError('fetch failed', { cause: 'socket hang up' })
    expect(networkFailureMessage(odd)).toBe('fetch failed: socket hang up')
    expect(networkFailureMessage('plain text')).toBe('plain text')
    expect(describeNetworkFailure(new Error('x', { cause: { odd: true } })).detail).toBe(
      'x: object',
    )
    const looping = new Error('loop')
    Object.defineProperty(looping, 'cause', { value: looping })
    expect(describeNetworkFailure(looping).detail).toBe('loop: loop: loop: loop: loop')
  })

  it('withholds proxy credentials in a transport error shown to the user', () => {
    const error = new Error('connect to https://user:hunter2@proxy.example.test failed')
    expect(networkFailureMessage(error)).toBe(
      'connect to https://[redacted]@proxy.example.test failed',
    )
    expect(networkFailureMessage(new Error('proxy password="two words" refused'))).toBe(
      'proxy password="[redacted]" refused',
    )
  })
})

describe('the ACP agent’s advice (PLAN.md D62, Q66)', () => {
  it('names the agent’s environment, never VS Code’s settings, for the same failures', async () => {
    const refused = await refusedFetch()
    const cases: readonly [unknown, string, string][] = [
      [capturedCertificateFailure(), UI_TEXT.acpNetworkUntrustedCertificate, 'NODE_EXTRA_CA_CERTS'],
      [capturedProxyFailure(407), UI_TEXT.acpNetworkProxyCredentials, 'HTTPS_PROXY'],
      [refused, UI_TEXT.acpNetworkUnreachable, 'NODE_USE_ENV_PROXY=1'],
    ]
    for (const [error, advice, variable] of cases) {
      const message = networkFailureMessage(error, 'agent')
      expect(message).toBe(`${advice} (${describeNetworkFailure(error).detail})`)
      expect(message).toContain(variable)
      expect(message).not.toMatch(/http\.(proxy|systemCertificates)|VS Code/)
    }
  })

  it('shares the proxy’s refusal, which names no setting, and leaves the extension’s advice as it was', () => {
    expect(networkFailureMessage(capturedProxyFailure(403), 'agent')).toBe(
      networkFailureMessage(capturedProxyFailure(403)),
    )
    expect(networkFailureMessage(capturedCertificateFailure(), 'vscode')).toBe(
      networkFailureMessage(capturedCertificateFailure()),
    )
    expect(networkFailureMessage(capturedProxyFailure(407), 'vscode')).toContain(
      UI_TEXT.networkProxyCredentials,
    )
    expect(networkFailureMessage(new Error('odd'), 'agent')).toBe('odd')
  })
})
