// D90.5's egress proxy (M110b W1): a CONNECT-only HTTP proxy that stands
// between sandboxes and the internet. Each connection: the sandbox's IP
// names its workspace policy (unknown sources refused); the CONNECT
// host meets the allowlist; every DNS answer meets the metadata check
// and D74's address checks NAT64-aware, any failure refusing the
// connection whole; new connections pace to the person's rate; then
// the dial, pinned to the checked answers (the name is never looked up
// again), and the ClientHello's SNI must match the CONNECT host —
// mismatch or TLS-looking garbage drops the tunnel. Plain HTTP passes
// through unexamined past the CONNECT checks. Every verdict is
// audited; errors carry codes, never messages. Proven by drill against
// real names, real DNS and real upstreams — never a fake server — with
// the pure policy beside it unit-tested.
import { lookup, resolve6 } from 'node:dns/promises'
import { createServer, Socket, type Server } from 'node:net'
import { ADDRESS_FAMILIES, EGRESS_CONNECT_HEAD_MAX_BYTES } from '../../../shared/constants'
import { addressFamily, nat64PrefixesOf } from '../../../core/web/publicAddress'
import {
  checkRate,
  initialRate,
  isNameAllowed,
  parseConnectTarget,
  selectUsableAnswers,
  type EgressNat64,
  type EgressPolicy,
  type RateState,
} from './policy'
import { parseClientHelloSni } from './sni'

/** What one connection cost, for the per-workspace DNS log and audits. */
export type EgressVerdict =
  | 'allow'
  | 'deny-policy'
  | 'deny-metadata'
  | 'deny-private'
  | 'deny-nat64'
  | 'deny-rate'
  | 'unresolved'
  | 'dial-failed'
  | 'sni-mismatch'
  | 'sni-malformed'
  | 'unknown-source'

export type EgressAudit =
  | {
      readonly kind: 'connect'
      readonly source: string
      readonly host: string
      readonly port: number
      readonly answers: readonly string[]
      readonly verdict: EgressVerdict
      /** Codes only (errno, the LDH-safe SNI); never messages. */
      readonly detail?: string
    }
  | { readonly kind: 'nat64'; readonly isKnown: boolean; readonly prefixCount: number }
  | { readonly kind: 'server'; readonly code: string }

export interface EgressServerOptions {
  /** Gateway addresses to bind, one per workspace network; never 0.0.0.0. */
  readonly addrs: readonly [string, ...string[]]
  /** The listen port; 0 asks the OS. */
  readonly port?: number
  /** The workspace policy behind a sandbox address; unknown addresses refused. */
  readonly policies: (sourceIp: string) => EgressPolicy | undefined
  /** Every verdict, and proxy infrastructure, go here. */
  readonly audit: (event: EgressAudit) => void
}

export interface EgressServer {
  /** The bound addresses and ports, for the sandbox environments. */
  readonly bound: readonly { readonly addr: string; readonly port: number }[]
  readonly close: () => Promise<void>
}

const HEAD_SEPARATOR = '\r\n\r\n'
/** CONNECT, authority, version: anything shorter is not a request line. */
const REQUEST_PART_COUNT = 3

function respond(socket: Socket, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nProxy-Connection: close\r\n\r\n`)
}

function destroy(socket: Socket | undefined): void {
  if (socket !== undefined && !socket.destroyed) socket.destroy()
}

function errorCode(error: unknown): string {
  return error instanceof Error && 'code' in error ? String(error.code) : 'error'
}

async function dialAnswer(
  answer: string,
  port: number,
): Promise<{ socket: Socket } | { code: string }> {
  return await new Promise((resolve) => {
    const socket = new Socket()
    // Stays attached past success: the first error destroys a tunnel
    // whose own handler may not be attached yet, and resolve is inert.
    socket.once('error', (error: unknown) => {
      destroy(socket)
      resolve({ code: errorCode(error) })
    })
    socket.connect(port, answer, () => {
      resolve({ socket })
    })
  })
}

export async function startEgressServer(options: EgressServerOptions): Promise<EgressServer> {
  const rates = new Map<string, RateState>()
  let nat64: EgressNat64 | undefined
  const discoverNat64 = async (): Promise<EgressNat64> => {
    if (nat64 !== undefined) return nat64
    let found: EgressNat64
    try {
      const answers = await resolve6('ipv4only.arpa')
      found = { isKnown: true, prefixes: nat64PrefixesOf(answers) }
    } catch (error: unknown) {
      const code = errorCode(error)
      found = { isKnown: code === 'ENOTFOUND' || code === 'ENODATA' ? true : false, prefixes: [] }
    }
    options.audit({ kind: 'nat64', isKnown: found.isKnown, prefixCount: found.prefixes.length })
    if (found.isKnown) nat64 = found
    return found
  }
  const sniffThenPipe = async (
    client: Socket,
    upstream: Socket,
    first: Buffer,
    host: string,
    done: (verdict: EgressVerdict, detail?: string) => void,
  ): Promise<void> => {
    let buffered = first
    for (;;) {
      const parsed = parseClientHelloSni(buffered)
      if (parsed.kind === 'truncated') {
        const more = await new Promise<Buffer | undefined>((resolve) => {
          const onData = (chunk: Buffer): void => {
            cleanup()
            resolve(chunk)
          }
          const onEnd = (): void => {
            cleanup()
            resolve(undefined)
          }
          const cleanup = (): void => {
            client.removeListener('data', onData)
            client.removeListener('close', onEnd)
            client.removeListener('error', onEnd)
          }
          client.on('data', onData)
          client.on('close', onEnd)
          client.on('error', onEnd)
          client.resume()
        })
        if (more === undefined) {
          destroy(client)
          destroy(upstream)
          return
        }
        buffered = Buffer.concat([buffered, more])
        continue
      }
      if (parsed.kind === 'malformed') {
        done('sni-malformed')
        return
      }
      if (parsed.kind === 'sni' && parsed.serverName.toLowerCase() !== host.toLowerCase()) {
        done('sni-mismatch', parsed.serverName)
        return
      }
      done('allow')
      if (!upstream.destroyed) upstream.write(buffered)
      client.pipe(upstream)
      upstream.pipe(client)
      return
    }
  }
  const handle = (client: Socket): void => {
    let upstream: Socket | undefined
    let head = Buffer.alloc(0)
    let isSettled = false
    const refuse = (
      verdict: EgressVerdict,
      host: string,
      port: number,
      answers: readonly string[],
      detail?: string,
    ): void => {
      if (isSettled) return
      isSettled = true
      options.audit({
        kind: 'connect',
        source: client.remoteAddress ?? 'unknown',
        host,
        port,
        answers,
        verdict,
        ...(detail !== undefined && { detail }),
      })
      respond(
        client,
        verdict === 'unresolved' || verdict === 'dial-failed' ? '502 Bad Gateway' : '403 Forbidden',
      )
      destroy(upstream)
    }
    const fail = (status: string): void => {
      if (isSettled) return
      isSettled = true
      respond(client, status)
      destroy(upstream)
    }
    client.on('error', () => {
      destroy(client)
      destroy(upstream)
    })
    client.on('data', (chunk: Buffer) => {
      if (isSettled) return
      head = Buffer.concat([head, chunk])
      if (head.length > EGRESS_CONNECT_HEAD_MAX_BYTES) {
        fail('431 Request Header Fields Too Large')
        return
      }
      const end = head.indexOf(HEAD_SEPARATOR)
      if (end === -1) return
      client.removeAllListeners('data')
      client.pause()
      const text = head.subarray(0, end).toString('utf8')
      const rest = head.subarray(end + HEAD_SEPARATOR.length)
      void serve(text, rest).catch(() => {
        // Any surprise (a bug above, a failing audit sink) lands here:
        // the connection is already refused. Fail closed, tear down.
        destroy(client)
        destroy(upstream)
      })
    })
    const serve = async (headText: string, rest: Buffer): Promise<void> => {
      const line = headText.split('\r\n', 1)[0] ?? ''
      const parts = line.split(' ')
      if (parts.length < REQUEST_PART_COUNT) {
        fail('400 Bad Request')
        return
      }
      const [method, authority = ''] = parts
      if (method !== 'CONNECT') {
        fail('405 Method Not Allowed')
        return
      }
      const target = parseConnectTarget(authority)
      if (target === undefined) {
        fail('400 Bad Request')
        return
      }
      const source = client.remoteAddress ?? 'unknown'
      const policy = options.policies(source)
      if (policy === undefined) {
        refuse('unknown-source', target.host, target.port, [])
        return
      }
      if (!isNameAllowed(policy, target.host)) {
        refuse('deny-policy', target.host, target.port, [])
        return
      }
      let resolved: readonly string[]
      try {
        const entries = await lookup(target.host, { all: true, verbatim: true })
        resolved = entries.map((entry) => entry.address)
      } catch (error: unknown) {
        refuse('unresolved', target.host, target.port, [], errorCode(error))
        return
      }
      const [first, ...restAnswers] = resolved
      if (first === undefined) {
        refuse('unresolved', target.host, target.port, [], 'no-answers')
        return
      }
      const answers: readonly [string, ...string[]] = [first, ...restAnswers]
      const hasIpv6 = answers.some((answer) => addressFamily(answer) === ADDRESS_FAMILIES.ipv6)
      const prefixes = hasIpv6 ? await discoverNat64() : { isKnown: true, prefixes: [] }
      const usable = selectUsableAnswers(answers, prefixes)
      if (!usable.ok) {
        const verdicts = {
          metadata: 'deny-metadata',
          'private-address': 'deny-private',
          'nat64-unknown': 'deny-nat64',
        } as const
        refuse(verdicts[usable.reason], target.host, target.port, answers, usable.address)
        return
      }
      const before =
        rates.get(source) ?? initialRate(policy.maxNewPerSecond ?? 0, performance.now())
      const paced = checkRate(policy.maxNewPerSecond, before, performance.now())
      rates.set(source, paced.state)
      if (!paced.ok) {
        refuse('deny-rate', target.host, target.port, answers)
        return
      }
      let connected: Socket | undefined
      let dialCode = 'dial-error'
      for (const answer of usable.usable) {
        const dialled = await dialAnswer(answer, target.port)
        if ('socket' in dialled) {
          connected = dialled.socket
          break
        }
        dialCode = dialled.code
      }
      if (connected === undefined) {
        refuse('dial-failed', target.host, target.port, usable.usable, dialCode)
        return
      }
      upstream = connected
      upstream.on('error', () => {
        destroy(client)
        destroy(upstream)
      })
      client.write('HTTP/1.1 200 Connection established\r\n\r\n')
      await sniffThenPipe(client, upstream, rest, target.host, (verdict, detail) => {
        options.audit({
          kind: 'connect',
          source,
          host: target.host,
          port: target.port,
          answers: usable.usable,
          verdict,
          ...(detail !== undefined && { detail }),
        })
        if (verdict === 'allow') {
          return
        }

        isSettled = true
        destroy(client)
        destroy(upstream)
      })
    }
  }
  const servers: Server[] = []
  const bound: { addr: string; port: number }[] = []
  for (const addr of options.addrs) {
    const server = createServer(handle)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 0, addr, () => {
        server.removeListener('error', reject)
        const at = server.address()
        if (typeof at === 'object' && at !== null) bound.push({ addr: at.address, port: at.port })
        resolve()
      })
    })
    server.on('error', (error: unknown) => {
      options.audit({ kind: 'server', code: errorCode(error) })
    })
    servers.push(server)
  }
  return {
    bound,
    close: async () => {
      for (const server of servers) {
        server.close()
        await new Promise<void>((resolve) =>
          server.once('close', () => {
            resolve()
          }),
        )
      }
    },
  }
}
