// The browser check's canaries (M81 A1, design spec v4 §§6.2, 7): the
// loopback fixture and its counters, each phase's own ports and listeners,
// each phase's plan (fresh nonce, exact exceptions, the probe page's input,
// refusals only of destinations outside the frozen scope), the verdict a
// phase's own records give, failure by failure, and the probes of a plan
// sent through the real proxy at each loopback widening.
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { createSocket } from 'node:dgram'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isLoopbackHost } from '../../src/core/browser/browserPolicy'
import {
  type PhaseFixture,
  type PhasePlan,
  phasePlan,
  phaseVerdict,
  type ProbeFixture,
  type ProbeReport,
  startProbeFixture,
} from '../../src/core/browser/canaries'
import {
  type CheckProxy,
  type ProxyObservation,
  startCheckProxy,
} from '../../src/core/browser/checkProxy'
import { rawExchange } from './helpers/proxyExchange'

const NONCE = 'a'.repeat(32)
const LATER = 'b'.repeat(32)
const PORT = 5555
const fixtures: ProbeFixture[] = []
const proxies: CheckProxy[] = []

afterEach(async () => {
  for (const proxy of proxies.splice(0)) {
    await proxy.close()
  }
  for (const fixture of fixtures.splice(0)) {
    await fixture.close()
  }
})

async function fixtureFor(own?: string): Promise<ProbeFixture> {
  const fixture = await startProbeFixture(process.platform, () => own)
  fixtures.push(fixture)
  return fixture
}

/** A fresh fixture's phase for NONCE. */
async function phaseOf(own?: string): Promise<PhaseFixture> {
  const fixture = await fixtureFor(own)
  return await fixture.open(NONCE)
}

async function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; raw: readonly string[] }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      response.resume()
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, raw: response.rawHeaders })
      })
    })
    request.on('error', reject)
    request.end()
  })
}

/** A fake phase fixture whose counters a test sets. */
function target(overrides: Partial<PhaseFixture> = {}): PhaseFixture {
  return {
    nonce: NONCE,
    port: PORT,
    loopbackHosts: ['localhost', '127.0.0.1'],
    own: { address: '192.168.1.9', tcpPort: 7001, udpPort: 7002 },
    hits: ['p', 'l/localhost', 'l/127.0.0.1', 'a', 'f'],
    challenges: 2,
    tcpConnections: 0,
    ...overrides,
  }
}

const QUIET = { authorizations: 0, datagrams: 0 }

function seen(
  form: ProxyObservation['form'],
  host: string,
  port: number,
  isForwarded = false,
  isChallengeStripped = false,
): ProxyObservation {
  return { form, host, port, forwarded: isForwarded, challengeStripped: isChallengeStripped }
}

/** Every record a full phase's probes leave at the proxy when the construction holds. */
function allRecords(phase: PhaseFixture = target()): ProxyObservation[] {
  const { nonce, port } = phase
  return [
    seen('http', `c1-${nonce}.invalid`, 80),
    seen('connect', `c2-${nonce}.invalid`, 80),
    seen('connect', `c2s-${nonce}.invalid`, 443),
    seen('connect', `c3-${nonce}.invalid`, 443),
    seen('http', `c8-${nonce}.localhost`, 80),
    seen('http', '169.254.77.77', port),
    seen('connect', 'localhost', port),
    seen('http', 'localhost', port, true),
    seen('http', '127.0.0.1', port, true),
    seen('http', 'localhost', port, true, true),
    seen('http', 'localhost', port, true, true),
    seen('connect', '192.168.1.9', 7001),
  ]
}

const CLEAN: ProbeReport = {
  sockets: { c2: 'error', c2s: 'error', c5w: 'error' },
  wt: 'rejected',
  candidates: [],
  ice: 'tried',
}

/** The probe page's input, as its script carries it. */
interface ProbeInput {
  readonly get: readonly string[]
  readonly ws: Readonly<Record<string, string>>
  readonly auth: string | null
  readonly frame: string
  readonly ice: { readonly address: string; readonly port: number } | null
}

/** A page phase's refusals at `explicitHosts`, as `form host`. */
function hostsOf(explicitHosts: readonly string[]): string[] {
  return phasePlan('page', target(), explicitHosts).refused.map(([form, host]) => `${form} ${host}`)
}

function inputOf(plan: PhasePlan): ProbeInput {
  return JSON.parse(plan.script.slice(plan.script.lastIndexOf(')({') + 2, -1)) as ProbeInput
}

/** A CONNECT to `authority`, as the browser tunnels https, ws and wss (a tunnel ended after 100 ms). */
async function tunnel(port: number, authority: string): Promise<string> {
  return await rawExchange(port, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`, 100)
}

/** An absolute-form GET through the proxy, as the browser sends plain http. */
async function fetchVia(port: number, url: string): Promise<string> {
  const { host } = new URL(url)
  return await rawExchange(port, `GET ${url} HTTP/1.1\r\nHost: ${host}\r\n\r\n`, 2000)
}

/**
 * What the browser would make of a plan's probes, sent through the real
 * proxy at `explicitHosts`: every http fetch absolute-form, every https and
 * WebSocket as a CONNECT, the sign-in fetch and frame same-origin to the
 * probe page, the ICE candidate as a CONNECT to this machine's address. The
 * proxy's records, as the phase would read them.
 */
async function throughProxy(
  plan: PhasePlan,
  explicitHosts: readonly string[],
  lookup = vi.fn((_host: string) => Promise.reject(new Error('no lookup here'))),
): Promise<{ records: ProxyObservation[]; lookup: typeof lookup }> {
  const proxy = await startCheckProxy(
    { url: plan.pageUrl, explicitHosts, approvalKey: 'key' },
    lookup,
  )
  proxies.push(proxy)
  const records: ProxyObservation[] = []
  proxy.observe((record) => {
    records.push(record)
  })
  const port = Number(new URL(proxy.endpoint).port)
  const input = inputOf(plan)
  const origin = new URL(plan.pageUrl).origin
  const sent: Promise<string>[] = [fetchVia(port, plan.pageUrl)]
  for (const url of input.get) {
    const parsed = new URL(url)
    sent.push(
      parsed.protocol === 'https:' ? tunnel(port, `${parsed.hostname}:443`) : fetchVia(port, url),
    )
  }
  for (const url of Object.values(input.ws)) {
    const parsed = new URL(url)
    const at = parsed.port === '' ? (parsed.protocol === 'wss:' ? '443' : '80') : parsed.port
    sent.push(tunnel(port, `${parsed.hostname}:${at}`))
  }
  if (input.auth !== null) {
    sent.push(fetchVia(port, `${origin}${input.auth}`), fetchVia(port, `${origin}${input.frame}`))
  }
  if (input.ice !== null) {
    sent.push(tunnel(port, `${input.ice.address}:${String(input.ice.port)}`))
  }
  await Promise.all(sent)
  return { records, lookup }
}

describe('the canaries’ loopback fixture (M81 A1)', () => {
  it('answers only its phase’s nonce, records its paths, and challenges its sign-in paths', async () => {
    const fixture = await fixtureFor()
    const phase = await fixture.open(NONCE)
    expect(phase.loopbackHosts.slice(0, 2)).toEqual(['localhost', '127.0.0.1'])
    expect(await get(phase.port, `/${LATER}/p`)).toMatchObject({ status: 404 })
    expect(await get(phase.port, `/${NONCE}/p`)).toMatchObject({ status: 200 })
    expect(await get(phase.port, `/${NONCE}/l/localhost`)).toMatchObject({ status: 204 })
    const challenge = await get(phase.port, `/${NONCE}/a`)
    expect(challenge.status).toBe(401)
    // Several fields, in mixed case: the proxy must strip them all.
    const names = challenge.raw.filter((_value, index) => index % 2 === 0)
    expect(names).toEqual(expect.arrayContaining(['WWW-Authenticate', 'www-authenticate']))
    await get(phase.port, `/${NONCE}/f`)
    expect(phase.hits).toEqual(['p', 'l/localhost', 'a', 'f'])
    expect(phase.challenges).toBe(2)
    expect(fixture.authorizations).toBe(0)
  })

  it('gives each phase ports and listeners of its own, so no phase answers or counts for another', async () => {
    const fixture = await fixtureFor('127.0.0.1')
    const first = await fixture.open(NONCE)
    const later = await fixture.open(LATER)
    expect(later.port).not.toBe(first.port)
    expect(later.own?.tcpPort).not.toBe(first.own?.tcpPort)
    // The check's one UDP counter.
    expect(later.own?.udpPort).toBe(first.own?.udpPort)
    expect(await get(first.port, `/${LATER}/p`)).toMatchObject({ status: 404 })
    expect(await get(later.port, `/${NONCE}/p`)).toMatchObject({ status: 404 })
    expect(await get(later.port, `/${LATER}/p`)).toMatchObject({ status: 200 })
    expect(first.hits).toEqual([])
    expect(later.hits).toEqual(['p'])
    await new Promise<void>((resolve) => {
      const socket = connect(first.own?.tcpPort ?? 0, '127.0.0.1')
      socket.on('close', () => {
        resolve()
      })
      socket.on('error', () => undefined)
    })
    expect(first.tcpConnections).toBe(1)
    expect(later.tcpConnections).toBe(0)
  })

  it('counts any request that carries a credential, whatever its path or phase', async () => {
    const fixture = await fixtureFor()
    const phase = await fixture.open(NONCE)
    await get(phase.port, '/anything', { Authorization: 'Negotiate YII' })
    await get(phase.port, '/else', { 'Proxy-Authorization': 'Basic eA==' })
    expect(fixture.authorizations).toBe(2)
  })

  it('answers on 127.0.0.2 where the OS has it (not macOS) and on ::1 where it has IPv6', async () => {
    const phase = await phaseOf()
    if (process.platform === 'darwin') {
      expect(phase.loopbackHosts).not.toContain('127.0.0.2')
    } else {
      expect(phase.loopbackHosts).toContain('127.0.0.2')
    }
  })

  it('counts connections and datagrams on this machine’s own address, and has none without one', async () => {
    const none = await phaseOf()
    expect(none.own).toBeUndefined()
    const unparsed = await phaseOf('not-an-address')
    expect(unparsed.own).toBeUndefined()
    const fixture = await fixtureFor('127.0.0.1')
    const phase = await fixture.open(NONCE)
    const own = phase.own
    expect(own).toBeDefined()
    await new Promise<void>((resolve) => {
      const socket = connect(own?.tcpPort ?? 0, '127.0.0.1')
      socket.on('close', () => {
        resolve()
      })
      socket.on('error', () => undefined)
    })
    const udp = createSocket('udp4')
    await new Promise<void>((resolve) => {
      udp.send('quic', own?.udpPort ?? 0, '127.0.0.1', () => {
        resolve()
      })
    })
    udp.close()
    await expect.poll(() => fixture.datagrams).toBe(1)
    expect(phase.tcpConnections).toBe(1)
  })

  it('opens nothing once it has closed', async () => {
    const fixture = await fixtureFor()
    await fixture.close()
    await expect(fixture.open(NONCE)).rejects.toThrow()
  })
})

describe('a canary phase’s plan (M81 A1)', () => {
  it('binds the default phase to its routing probes and the probe page to its nonce and port', () => {
    const plan = phasePlan('default', target(), [])
    expect(plan.pageUrl).toBe(`http://localhost:5555/${NONCE}/p`)
    expect([...plan.exceptions]).toEqual([
      `http://c1-${NONCE}.invalid/`,
      `https://c3-${NONCE}.invalid/`,
    ])
    expect(plan.isFull).toBe(false)
    expect(inputOf(plan)).toMatchObject({
      ws: { c2: `ws://c2-${NONCE}.invalid/`, c2s: `wss://c2s-${NONCE}.invalid/` },
      auth: null,
      ice: null,
      wt: null,
    })
  })

  it('adds the sign-in, alias, link-local, ICE and WebTransport probes in the page and audit phases', () => {
    const plan = phasePlan('page', target(), [])
    expect([...plan.exceptions]).toEqual([
      `http://c1-${NONCE}.invalid/`,
      `https://c3-${NONCE}.invalid/`,
      `http://c8-${NONCE}.localhost/`,
      `http://169.254.77.77:5555/${NONCE}`,
    ])
    expect(inputOf(plan)).toMatchObject({
      ws: { c5w: `ws://localhost:5555/${NONCE}/w` },
      auth: `/${NONCE}/a`,
      ice: { address: '192.168.1.9', port: 7001 },
      wt: `https://192.168.1.9:7002/${NONCE}/`,
    })
  })

  it('probes a subdomain of a widened name and a neighbour of a widened address, never the widened host itself', () => {
    const plan = phasePlan('audit', target(), ['staging.example.com', '10.0.0.4'])
    expect(plan.refused).toEqual(
      expect.arrayContaining([
        ['http', `c9-${NONCE}.staging.example.com`, 80],
        ['http', '10.0.0.5', 5555],
      ]),
    )
    expect(plan.exceptions).toContain(`http://c9-${NONCE}.staging.example.com/${NONCE}`)
    expect(plan.exceptions).toContain(`http://10.0.0.5:5555/${NONCE}`)
    // A neighbour that is itself widened is not probed.
    const both = phasePlan('page', target(), ['10.0.0.4', '10.0.0.5'])
    expect(both.refused.filter(([, host]) => host.startsWith('10.'))).toEqual([])
  })

  it('refuses only destinations outside the frozen scope, whatever loopback the user widened', () => {
    // C5w: a loopback host the user did not widen (CONNECT goes only to a widened one).
    expect(hostsOf(['localhost'])).toContain('connect 127.0.0.1')
    expect(hostsOf(['localhost'])).not.toContain('connect localhost')
    expect(hostsOf(['127.0.0.1'])).toContain('connect localhost')
    expect(hostsOf(['localhost', '127.0.0.1'])).toContain('connect 127.0.0.3')
    // C9ip: no neighbour of a loopback literal (implicitly allowed over http).
    expect(hostsOf(['127.0.0.1']).filter((entry) => entry.startsWith('http 127.'))).toEqual([])
    expect(hostsOf(['[::1]'])).toContain('connect localhost')
    for (const explicitHosts of [
      ['localhost'],
      ['127.0.0.1'],
      ['[::1]'],
      ['app.test', '10.0.0.4'],
    ]) {
      const widened = new Set(explicitHosts)
      for (const [form, host] of phasePlan('page', target(), explicitHosts).refused) {
        // Not widened, and (plain http) not loopback, which http reaches implicitly.
        expect(
          widened.has(host) || (form === 'http' && isLoopbackHost(host)),
          `${form} ${host}`,
        ).toBe(false)
      }
    }
  })

  it('names every refusal it needs by the phase alone: a host with its nonce, or the phase’s own port', () => {
    const plan = phasePlan('page', target(), ['app.test', '10.0.0.4'])
    for (const [form, host, port] of plan.refused) {
      expect(host.includes(NONCE) || port === PORT, `${form} ${host}:${String(port)}`).toBe(true)
    }
  })
})

describe('a canary phase’s verdict (M81 A1)', () => {
  it('holds when every probe arrived where the construction routes it', () => {
    expect(
      phaseVerdict(phasePlan('page', target(), []), allRecords(), QUIET, CLEAN),
    ).toBeUndefined()
    expect(
      phaseVerdict(
        phasePlan('default', target(), []),
        [...allRecords().slice(0, 4), ...allRecords().slice(7, 9)],
        QUIET,
        CLEAN,
      ),
    ).toBeUndefined()
  })

  it('names each failure by the canary that found it, and the audit’s all auditFailed', () => {
    const all = allRecords()
    const without = (index: number): ProxyObservation[] => all.filter((_record, at) => at !== index)
    const cases: [
      ProxyObservation[],
      ProbeReport,
      Partial<PhaseFixture>,
      Partial<typeof QUIET>,
      string,
    ][] = [
      [without(0), CLEAN, {}, {}, 'routeUnconfirmed'],
      [without(4), CLEAN, {}, {}, 'routeUnconfirmed'],
      [without(5), CLEAN, {}, {}, 'routeUnconfirmed'],
      [without(6), CLEAN, {}, {}, 'routeUnconfirmed'],
      [without(8), CLEAN, {}, {}, 'routeUnconfirmed'],
      [all, { ...CLEAN, sockets: { c2: 'open' } }, {}, {}, 'routeUnconfirmed'],
      [all, CLEAN, { hits: ['l/localhost', 'l/127.0.0.1', 'w'] }, {}, 'routeUnconfirmed'],
      [all, CLEAN, {}, { authorizations: 1 }, 'signIn'],
      [without(9), CLEAN, {}, {}, 'signIn'],
      [all, CLEAN, { challenges: 1 }, {}, 'signIn'],
      [all, CLEAN, { own: undefined }, {}, 'unverifiable'],
      [without(11), CLEAN, {}, {}, 'webrtc'],
      [all, { ...CLEAN, ice: 'error' }, {}, {}, 'webrtc'],
      [all, CLEAN, { tcpConnections: 1 }, {}, 'webrtc'],
      [
        all,
        {
          ...CLEAN,
          candidates: ['candidate:2 1 tcp 1518 192.168.1.9 9 typ host tcptype passive'],
        },
        {},
        {},
        'webrtc',
      ],
      [all, { ...CLEAN, wt: 'ready' }, {}, {}, 'transport'],
      [all, { ...CLEAN, wt: 'threw' }, {}, {}, 'transport'],
      [all, CLEAN, {}, { datagrams: 1 }, 'transport'],
    ]
    for (const [records, report, phase, counters, verdict] of cases) {
      const changed = target(phase)
      const fixture = { ...QUIET, ...counters }
      expect(phaseVerdict(phasePlan('page', changed, []), records, fixture, report), verdict).toBe(
        verdict,
      )
      expect(phaseVerdict(phasePlan('audit', changed, []), records, fixture, report), verdict).toBe(
        'auditFailed',
      )
    }
  })

  it('never counts a late answer to an earlier phase’s probes as this phase’s evidence (A1-1)', () => {
    // The page phase held; the audit's own hits and challenges are there, but
    // its own forwarding and stripping records are not: only the page
    // phase's, arriving late (at the page phase's port).
    const audit = target({ nonce: LATER, port: 6666 })
    const plan = phasePlan('audit', audit, [])
    const own = allRecords(audit)
    const late = allRecords(target())
    const unstripped = own.map((record) => ({ ...record, challengeStripped: false }))
    expect(phaseVerdict(plan, [...late, ...unstripped], QUIET, CLEAN)).toBe('auditFailed')
    const unforwarded = own.filter((record) => !(record.form === 'http' && record.forwarded))
    expect(phaseVerdict(plan, [...late, ...unforwarded], QUIET, CLEAN)).toBe('auditFailed')
    // Its own records: it holds.
    expect(phaseVerdict(plan, [...late, ...own], QUIET, CLEAN)).toBeUndefined()
  })

  it('accepts ICE TCP the proxy tunnelled to this machine’s own address when the user widened it, and nothing more', () => {
    const phase = target({ tcpConnections: 1 })
    const plan = phasePlan('page', phase, ['192.168.1.9'])
    const widened = allRecords().map((record) =>
      record.host === '192.168.1.9' ? { ...record, forwarded: true } : record,
    )
    const neighbour = seen('http', '192.168.1.8', PORT)
    expect(phaseVerdict(plan, [...widened, neighbour], QUIET, CLEAN)).toBeUndefined()
    // A second connection the proxy did not make: direct.
    const direct = phasePlan('page', target({ tcpConnections: 2 }), ['192.168.1.9'])
    expect(phaseVerdict(direct, [...widened, neighbour], QUIET, CLEAN)).toBe('webrtc')
  })

  it('requires the widened host’s neighbours refused too', () => {
    const plan = phasePlan('page', target(), ['10.0.0.4'])
    expect(phaseVerdict(plan, allRecords(), QUIET, CLEAN)).toBe('routeUnconfirmed')
    expect(
      phaseVerdict(plan, [...allRecords(), seen('http', '10.0.0.5', PORT)], QUIET, CLEAN),
    ).toBeUndefined()
  })
})

describe('a phase’s probes through the real proxy (M81 A1)', () => {
  it('holds at every loopback widening the setting allows: localhost, 127.0.0.1 and ::1 (A1-3)', async () => {
    for (const explicitHosts of [[], ['localhost'], ['127.0.0.1'], ['[::1]']]) {
      const fixture = await fixtureFor('127.0.0.1')
      const phase = await fixture.open(NONCE)
      const plan = phasePlan('page', phase, explicitHosts)
      const { records } = await throughProxy(plan, explicitHosts)
      expect(phaseVerdict(plan, records, fixture, CLEAN), explicitHosts.join(',')).toBeUndefined()
    }
  }, 30_000)

  it('never reads a CONNECT the proxy admitted as a refusal, even when its lookup fails (A1-2)', async () => {
    const fixture = await fixtureFor()
    const phase = await fixture.open(NONCE)
    const plan = phasePlan('default', phase, [])
    const { records, lookup } = await throughProxy(plan, [])
    expect(phaseVerdict(plan, records, fixture, CLEAN)).toBeUndefined()
    // Refused before any lookup: none was asked for.
    expect(lookup).not.toHaveBeenCalled()
  }, 15_000)
})
