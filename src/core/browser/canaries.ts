// The browser check's canaries (M81 A1, design spec v4 §§6.2, 7): before the
// model's page, in the default context and then in the private one, and
// again after it (the audit), a probe page served by the check's own
// loopback fixture tries each way out the construction must route, and the
// check reads where each attempt arrived. Each phase has fresh 128-bit
// nonces, its own probe target, and its own fixture ports: every record its
// verdict reads names its nonce or its ports, so a late answer to an earlier
// phase's probe never counts as this phase's evidence. The Fetch exceptions
// that let its forbidden probes reach the refusing proxy are bound to that
// phase, that frame and those exact URLs, and revoked when the phase ends.
//
// - C1/C2/C2s/C3: HTTP, ws, wss and https to `<nonce>.invalid` arrive at the
//   proxy as a refused request or CONNECT (port 80 or 443), never resolved.
// - C4: loopback HTTP (`localhost`, 127.0.0.1, 127.0.0.2 where the OS
//   answers it, [::1] where it has IPv6) reaches the fixture, forwarded by
//   the proxy.
// - C5: a same-origin credentialed fetch and a frame get the fixture's
//   Negotiate/NTLM/Basic challenge; the proxy strips it, and no
//   Authorization ever reaches the fixture. C5w: a WebSocket to a loopback
//   host the user did not widen is a refused CONNECT.
// - C6: an ICE-TCP candidate towards this machine's own address arrives as a
//   refused CONNECT; no UDP or passive TCP candidate is gathered, and the
//   address's own TCP listener sees nothing.
// - C7: WebTransport to this machine's own address is rejected, and the
//   address's UDP listener sees no datagram.
// - C8: a `.localhost` alias and a link-local address are refused by the
//   proxy, not bypassed. C9/C9ip: a subdomain of a widened name and a
//   neighbour of a widened address beyond loopback are refused. Every
//   refusal a canary needs is of a destination outside the frozen scope.
//
// Canary data never reaches the result, the log or the model.

import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createTcpServer, isIPv4, type Server as TcpServer } from 'node:net'
import {
  BROWSER_CANARY_LINK_LOCAL,
  BROWSER_CANARY_SOCKET_WAIT_MS,
} from '../../shared/browserCheckConstants'
import { isLoopbackHost } from './browserPolicy'
import type { ConfinementFailure } from './browserRun'
import type { ProxyForm, ProxyObservation } from './checkProxy'

export type CanaryPhase = 'default' | 'page' | 'audit'

/** This machine's own non-loopback IPv4 address, if it has one. */
export type OwnAddressFinder = () => string | undefined

interface OwnListeners {
  readonly address: string
  readonly tcpPort: number
  readonly udpPort: number
}

/**
 * One phase's own part of the fixture: a port of its own on every loopback
 * address, and a TCP listener of its own on this machine's address, that
 * answer and count for its nonce only. No earlier phase's probe names them.
 */
export interface PhaseFixture {
  readonly nonce: string
  readonly port: number
  /** The loopback hosts it answers on, as URLs name them (C4). */
  readonly loopbackHosts: readonly string[]
  /** Undefined when this machine has no address to test against (C6/C7 unverifiable). */
  readonly own: OwnListeners | undefined
  /** Paths hit for its nonce (bounded). */
  readonly hits: readonly string[]
  /** Challenges it sent. */
  readonly challenges: number
  /** Connections its own-address TCP listener accepted. */
  readonly tcpConnections: number
}

/** The loopback fixture and the own-address counters of one check. */
export interface ProbeFixture {
  /** A phase's own ports and listeners, for its nonce. */
  open(nonce: string): Promise<PhaseFixture>
  /** Requests that carried Authorization or Proxy-Authorization, in any phase: any is a sign-in. */
  readonly authorizations: number
  /** Datagrams on this machine's own address, in any phase. */
  readonly datagrams: number
  close(): Promise<void>
}

const PROBE_PAGE = '<!doctype html>'
const CHALLENGE_FIELDS = [
  'WWW-Authenticate',
  'Negotiate, NTLM',
  'www-authenticate',
  'Basic realm="p"',
]
const MAX_HITS = 64
const STATUS_OK = 200
const STATUS_NO_CONTENT = 204
const STATUS_UNAUTHORIZED = 401
const STATUS_NOT_FOUND = 404

function ignore(): void {
  // A probe's own failure is read through its counters.
}

/** A server listening on `host` (port 0: one the OS picks); its port. */
export async function listen(
  server: Server | TcpServer,
  port: number,
  host: string,
): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host, exclusive: true }, () => {
      server.off('error', reject)
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })
}

async function closeServer(server: Server | TcpServer): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
}

/** The UDP socket on this machine's own address that only counts datagrams, and its port. */
async function bindUdp(
  socket: UdpSocket,
  address: string,
  onDatagram: () => void,
): Promise<number> {
  socket.on('message', onDatagram)
  socket.on('error', ignore)
  return await new Promise<number>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, address, () => {
      resolve(socket.address().port)
    })
  })
}

/**
 * The check's fixture. For each phase: one HTTP handler for that phase's
 * nonce only, on 127.0.0.1 at a port the OS picks and on the same port at
 * 127.0.0.2 and ::1 where the OS has them, and a TCP listener on this
 * machine's own address that only counts. For the check: a UDP socket on
 * that address that only counts.
 */
export async function startProbeFixture(
  platform: NodeJS.Platform,
  findOwnAddress: OwnAddressFinder,
): Promise<ProbeFixture> {
  const servers: (Server | TcpServer)[] = []
  let isClosed = false
  let authorizations = 0
  let datagrams = 0
  let udp: UdpSocket | undefined
  let ownUdp: { readonly address: string; readonly port: number } | undefined
  const address = findOwnAddress()
  if (address !== undefined && isIPv4(address)) {
    udp = createSocket('udp4')
    try {
      ownUdp = {
        address,
        port: await bindUdp(udp, address, () => {
          datagrams += 1
        }),
      }
    } catch {
      ownUdp = undefined
    }
  }
  // A listener opened after the fixture closed is closed at once, never kept.
  const listenOwned = async (
    server: Server | TcpServer,
    port: number,
    host: string,
  ): Promise<number> => {
    const bound = await listen(server, port, host)
    if (isClosed) {
      await closeServer(server)
      throw new Error('the probe fixture has closed')
    }
    servers.push(server)
    return bound
  }
  const open = async (nonce: string): Promise<PhaseFixture> => {
    const hits: string[] = []
    let challenges = 0
    let tcpConnections = 0
    const handle = (request: IncomingMessage, response: ServerResponse): void => {
      if (
        request.headers.authorization !== undefined ||
        request.headers['proxy-authorization'] !== undefined
      ) {
        authorizations += 1
      }
      const [, asked = '', kind = '', ...rest] = (request.url ?? '').split('/')
      if (asked !== nonce) {
        response.writeHead(STATUS_NOT_FOUND, { 'Content-Length': '0' }).end()
        return
      }
      if (hits.length < MAX_HITS) {
        hits.push([kind, ...rest].join('/'))
      }
      if (kind === 'p') {
        response.writeHead(STATUS_OK, { 'Content-Type': 'text/html' }).end(PROBE_PAGE)
        return
      }
      if (kind === 'a' || kind === 'f') {
        challenges += 1
        response.writeHead(STATUS_UNAUTHORIZED, [...CHALLENGE_FIELDS, 'Content-Length', '0']).end()
        return
      }
      response.writeHead(STATUS_NO_CONTENT).end()
    }
    const port = await listenOwned(createServer(handle), 0, '127.0.0.1')
    const loopbackHosts = ['localhost', '127.0.0.1']
    // macOS answers 127.0.0.1 only; elsewhere 127.0.0.0/8 is all loopback.
    const extra: [string, string][] = platform === 'darwin' ? [] : [['127.0.0.2', '127.0.0.2']]
    extra.push(['::1', '[::1]'])
    for (const [bound, host] of extra) {
      try {
        await listenOwned(createServer(handle), port, bound)
        loopbackHosts.push(host)
      } catch {
        // This machine does not answer that address: not a case here.
      }
    }
    let own: OwnListeners | undefined
    if (ownUdp !== undefined) {
      try {
        const tcp = createTcpServer((socket) => {
          tcpConnections += 1
          socket.destroy()
        })
        const tcpPort = await listenOwned(tcp, 0, ownUdp.address)
        own = { address: ownUdp.address, tcpPort, udpPort: ownUdp.port }
      } catch {
        own = undefined
      }
    }
    return {
      nonce,
      port,
      loopbackHosts,
      own,
      hits,
      get challenges() {
        return challenges
      },
      get tcpConnections() {
        return tcpConnections
      },
    }
  }
  return {
    open,
    get authorizations() {
      return authorizations
    },
    get datagrams() {
      return datagrams
    },
    close: async () => {
      isClosed = true
      udp?.close()
      await Promise.all(
        servers.map(async (server) => {
          await closeServer(server)
        }),
      )
    },
  }
}

/** A record a probe must leave at the proxy: its form, host and port. */
export type ProbeRecord = readonly [ProxyForm, string, number]

/** One phase's probes: its nonce, its probe page, the URLs its exceptions admit. */
export interface PhasePlan {
  readonly phase: CanaryPhase
  readonly nonce: string
  /** The phase's own ports and counters. */
  readonly target: PhaseFixture
  readonly pageUrl: string
  /** Forbidden URLs the Fetch gate lets through from this phase's probe frame only. */
  readonly exceptions: ReadonlySet<string>
  /** The probe page's script (Runtime.evaluate), resolving to its JSON report. */
  readonly script: string
  /** Whether this phase runs the full set (page, audit) or routing only (default). */
  readonly isFull: boolean
  /** What the proxy must have refused, each beyond the frozen scope and named by this phase alone. */
  readonly refused: readonly ProbeRecord[]
}

const HTTP_PORT = 80
const HTTPS_PORT = 443
// The first 127/8 literal past the fixture's own 127.0.0.1 and 127.0.0.2.
const SPARE_LOOPBACK_FIRST = 3
const OCTET_VALUES = 256

/** A neighbour of a widened IPv4 address: the last octet with its low bit flipped. */
function neighbourOf(address: string, widened: ReadonlySet<string>): string | undefined {
  const octets = address.split('.').map(Number)
  const last = octets.pop()
  if (last === undefined) {
    return undefined
  }
  const neighbour = [...octets, last ^ 1].join('.')
  return widened.has(neighbour) ? undefined : neighbour
}

/**
 * A loopback host the user did not widen, for C5w: CONNECT goes only to a
 * widened host, so its refusal is the construction's. The fixture's own
 * hosts first; when the user widened all of them, another 127/8 literal
 * (the widened set is finite, so one is free).
 */
function unwidenedLoopback(hosts: readonly string[], widened: ReadonlySet<string>): string {
  const found = hosts.find((host) => !widened.has(host))
  if (found !== undefined) {
    return found
  }
  for (let index = SPARE_LOOPBACK_FIRST; ; index += 1) {
    const host = `127.0.${String(Math.floor(index / OCTET_VALUES))}.${String(index % OCTET_VALUES)}`
    if (!widened.has(host)) {
      return host
    }
  }
}

/** The probes of one phase, against its own fixture ports and the check's widened hosts. */
export function phasePlan(
  phase: CanaryPhase,
  target: PhaseFixture,
  explicitHosts: readonly string[],
): PhasePlan {
  const { nonce, port } = target
  const isFull = phase !== 'default'
  const widened = new Set(explicitHosts)
  const refused: ProbeRecord[] = [
    ['http', `c1-${nonce}.invalid`, HTTP_PORT],
    ['connect', `c2-${nonce}.invalid`, HTTP_PORT],
    ['connect', `c2s-${nonce}.invalid`, HTTPS_PORT],
    ['connect', `c3-${nonce}.invalid`, HTTPS_PORT],
  ]
  const exceptions = new Set([`http://c1-${nonce}.invalid/`, `https://c3-${nonce}.invalid/`])
  const base = `/${nonce}/`
  const ws: Record<string, string> = {
    // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- canary C2 (design spec v4 §7): a plain ws:// attempt to a reserved .invalid nonce name that must arrive refused at the check's own proxy; nothing is ever sent over it (PLAN.md §8).
    c2: `ws://c2-${nonce}.invalid/`,
    c2s: `wss://c2s-${nonce}.invalid/`,
  }
  if (isFull) {
    refused.push(['http', `c8-${nonce}.localhost`, HTTP_PORT])
    exceptions.add(`http://c8-${nonce}.localhost/`)
    // C8's link-local address, C9, C9ip: a name carries the nonce, an address the phase's port.
    const probes: [string, number][] = [[BROWSER_CANARY_LINK_LOCAL, port]]
    const name = explicitHosts.find((host) => !isIPv4(host) && !host.startsWith('['))
    if (name !== undefined) {
      probes.push([`c9-${nonce}.${name}`, HTTP_PORT])
    }
    // A loopback literal's neighbours are loopback, allowed implicitly: no C9ip for it.
    const literal = explicitHosts.find((host) => isIPv4(host) && !isLoopbackHost(host))
    const neighbour = literal === undefined ? undefined : neighbourOf(literal, widened)
    if (neighbour !== undefined) {
      probes.push([neighbour, port])
    }
    for (const [host, at] of probes) {
      refused.push(['http', host, at])
      exceptions.add(`http://${host}${at === HTTP_PORT ? '' : `:${String(at)}`}/${nonce}`)
    }
    const c5w = unwidenedLoopback(target.loopbackHosts, widened)
    refused.push(['connect', c5w, port])
    // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- canary C5w (design spec v4 §7): a plain ws:// attempt to a loopback host the user did not widen, which must arrive as a refused CONNECT at the check's own proxy; nothing is ever sent over it (PLAN.md §8).
    ws['c5w'] = `ws://${c5w}:${String(port)}${base}w`
  }
  const own = isFull ? target.own : undefined
  const input = JSON.stringify({
    get: [
      ...exceptions,
      ...target.loopbackHosts.map((host) => `http://${host}:${String(port)}${base}l/${host}`),
    ],
    ws,
    auth: isFull ? `${base}a` : null,
    frame: `${base}f`,
    ice: own === undefined ? null : { address: own.address, port: own.tcpPort },
    wt: own === undefined ? null : `https://${own.address}:${String(own.udpPort)}${base}`,
    wait: BROWSER_CANARY_SOCKET_WAIT_MS,
  })
  return {
    phase,
    nonce,
    target,
    pageUrl: `http://localhost:${String(port)}${base}p`,
    exceptions,
    script: `(${PROBE_SCRIPT})(${input})`,
    isFull,
    refused,
  }
}

// The probe page's side, in the page's own words, compact since it ships as
// a string. Every request is fire-and-forget: what counts is where it
// arrives (the proxy's and the fixture's records), not what it answers.
// Sockets, ICE and WebTransport report how they ended; ICE adds a passive
// TCP candidate at this machine's own address, which must arrive as a
// refused CONNECT, and lists its own candidates (none may be UDP or passive).
const PROBE_SCRIPT = String.raw`async o=>{const r={sockets:{},wt:'none',candidates:[],ice:'none'},z=m=>new Promise(s=>setTimeout(s,m)),t=[],g=(u,i)=>t.push(fetch(u,{mode:'no-cors',cache:'no-store',...i}).then(()=>{},()=>{}));for(const u of o.get)g(u);for(const[k,u]of Object.entries(o.ws))t.push(new Promise(d=>{let s;const e=v=>{if(r.sockets[k]===undefined){r.sockets[k]=v;try{s.close()}catch{}d()}};try{s=new WebSocket(u)}catch{e('threw');return}s.onopen=()=>e('open');s.onerror=()=>e('error');setTimeout(()=>e('pending'),o.wait)}));if(o.auth){g(o.auth,{mode:'same-origin',credentials:'include'});const f=document.createElement('iframe');f.src=o.frame;document.body.append(f)}if(o.ice)t.push((async()=>{const a=new RTCPeerConnection({iceServers:[]}),b=new RTCPeerConnection({iceServers:[]});try{a.onicecandidate=e=>{if(e.candidate)r.candidates.push(e.candidate.candidate)};a.createDataChannel('c');const f=await a.createOffer();await a.setLocalDescription(f);await b.setRemoteDescription(f);const w=await b.createAnswer();await b.setLocalDescription(w);await a.setRemoteDescription(w);await a.addIceCandidate({candidate:'candidate:1 1 tcp 1518280447 '+o.ice.address+' '+o.ice.port+' typ host tcptype passive',sdpMid:(f.sdp.match(/a=mid:(\S+)/)||[])[1]||'0',sdpMLineIndex:0});await z(o.wait);r.ice='tried'}catch{r.ice='error'}finally{a.close();b.close()}})());if(o.wt)t.push((async()=>{try{const w=new WebTransport(o.wt);await Promise.race([w.ready.then(()=>{r.wt='ready'},()=>{r.wt='rejected'}),z(o.wait).then(()=>{if(r.wt==='none')r.wt='pending'})]);try{w.close()}catch{}}catch{r.wt='threw'}})());await Promise.all(t);return JSON.stringify(r)}`

/** What the probe page reported (parsed by the run with its schema). */
export interface ProbeReport {
  readonly sockets: Readonly<Partial<Record<'c2' | 'c2s' | 'c5w', string | undefined>>>
  readonly wt: string
  readonly candidates: readonly string[]
  readonly ice: string
}

function seen(
  observations: readonly ProxyObservation[],
  form: ProxyObservation['form'],
  host: string,
  port: number,
  isForwarded: boolean,
): readonly ProxyObservation[] {
  return observations.filter(
    (entry) =>
      entry.form === form &&
      entry.host === host &&
      entry.port === port &&
      entry.forwarded === isForwarded,
  )
}

/**
 * The phase's verdict from its own records at the proxy (only those that
 * arrived while it ran), its own fixture counters, the check's sign-in and
 * datagram counters, and the probe page's report: undefined when every
 * canary held, else the confinement failure it shows (the audit's are all
 * `auditFailed`).
 */
export function phaseVerdict(
  plan: PhasePlan,
  observations: readonly ProxyObservation[],
  fixture: Pick<ProbeFixture, 'authorizations' | 'datagrams'>,
  report: ProbeReport,
): ConfinementFailure | undefined {
  const { target } = plan
  const failure = ((): ConfinementFailure | undefined => {
    if (fixture.authorizations > 0) {
      return 'signIn'
    }
    const { hits } = target
    const isRouted =
      plan.refused.every(
        ([form, host, port]) => seen(observations, form, host, port, false).length > 0,
      ) &&
      target.loopbackHosts.every(
        (host) =>
          hits.includes(`l/${host}`) &&
          seen(observations, 'http', host, target.port, true).length > 0,
      ) &&
      Object.values(report.sockets).every((outcome) => outcome !== 'open') &&
      !hits.includes('w')
    if (!isRouted) {
      return 'routeUnconfirmed'
    }
    if (!plan.isFull) {
      return undefined
    }
    const stripped = seen(observations, 'http', 'localhost', target.port, true).filter(
      (entry) => entry.challengeStripped,
    )
    if (target.challenges < 2 || stripped.length < 2) {
      return 'signIn'
    }
    const own = target.own
    if (own === undefined) {
      return 'unverifiable'
    }
    // ICE TCP goes through the proxy: its CONNECT arrived there, and the
    // listener saw no connection the proxy did not make itself (one it
    // tunnels when the user widened this machine's own address).
    const tunnelled = seen(observations, 'connect', own.address, own.tcpPort, true).length
    const isIceProxied =
      report.ice === 'tried' &&
      target.tcpConnections <= tunnelled &&
      tunnelled + seen(observations, 'connect', own.address, own.tcpPort, false).length > 0 &&
      report.candidates.every((line) => !/ udp | tcptype passive/i.test(line))
    if (!isIceProxied) {
      return 'webrtc'
    }
    return report.wt !== 'rejected' || fixture.datagrams > 0 ? 'transport' : undefined
  })()
  return failure !== undefined && plan.phase === 'audit' ? 'auditFailed' : failure
}
