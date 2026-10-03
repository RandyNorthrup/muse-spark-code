// The browser check's canaries (M81 A1, design spec v4 §§6.2, 7): the
// loopback fixture and its counters, each phase's plan (fresh nonce, exact
// exceptions, the probe page's input) and the verdict a phase's records
// give, failure by failure.
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { createSocket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import {
  phasePlan,
  phaseVerdict,
  type ProbeFixture,
  type ProbeReport,
  startProbeFixture,
} from '../../src/core/browser/canaries'
import type { ProxyObservation } from '../../src/core/browser/checkProxy'

const NONCE = 'a'.repeat(32)
const fixtures: ProbeFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.close()
  }
})

async function fixtureFor(own?: string): Promise<ProbeFixture> {
  const fixture = await startProbeFixture(process.platform, () => own)
  fixtures.push(fixture)
  return fixture
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

/** A fake fixture whose counters a test sets. */
function fake(overrides: Partial<ProbeFixture> = {}): ProbeFixture {
  const hits = new Map<string, string[]>()
  return {
    port: 5555,
    loopbackHosts: ['localhost', '127.0.0.1'],
    own: { address: '192.168.1.9', tcpPort: 7001, udpPort: 7002 },
    admit: (nonce) => {
      hits.set(nonce, ['p', 'l/localhost', 'l/127.0.0.1', 'a', 'f'])
    },
    hits: (nonce) => hits.get(nonce) ?? [],
    challenges: () => 2,
    authorizations: 0,
    tcpConnections: 0,
    datagrams: 0,
    close: () => Promise.resolve(),
    ...overrides,
  }
}

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
function allRecords(fixture: ProbeFixture, nonce = NONCE): ProxyObservation[] {
  return [
    seen('http', `c1-${nonce}.invalid`, 80),
    seen('connect', `c2-${nonce}.invalid`, 80),
    seen('connect', `c2s-${nonce}.invalid`, 443),
    seen('connect', `c3-${nonce}.invalid`, 443),
    seen('http', `c8-${nonce}.localhost`, 80),
    seen('http', '169.254.77.77', 8080),
    seen('connect', 'localhost', fixture.port),
    seen('http', 'localhost', fixture.port, true),
    seen('http', '127.0.0.1', fixture.port, true),
    seen('http', 'localhost', fixture.port, true, true),
    seen('http', 'localhost', fixture.port, true, true),
    seen('connect', '192.168.1.9', 7001),
  ]
}

const CLEAN: ProbeReport = {
  sockets: { c2: 'error', c2s: 'error', c5w: 'error' },
  wt: 'rejected',
  candidates: [],
  ice: 'tried',
}

describe('the canaries’ loopback fixture (M81 A1)', () => {
  it('answers only an admitted nonce, records its paths, and challenges its sign-in paths', async () => {
    const fixture = await fixtureFor()
    expect(fixture.loopbackHosts.slice(0, 2)).toEqual(['localhost', '127.0.0.1'])
    expect(await get(fixture.port, `/${NONCE}/p`)).toMatchObject({ status: 404 })
    fixture.admit(NONCE)
    expect(await get(fixture.port, `/${NONCE}/p`)).toMatchObject({ status: 200 })
    expect(await get(fixture.port, `/${NONCE}/l/localhost`)).toMatchObject({ status: 204 })
    const challenge = await get(fixture.port, `/${NONCE}/a`)
    expect(challenge.status).toBe(401)
    // Several fields, in mixed case: the proxy must strip them all.
    const names = challenge.raw.filter((_value, index) => index % 2 === 0)
    expect(names).toEqual(expect.arrayContaining(['WWW-Authenticate', 'www-authenticate']))
    await get(fixture.port, `/${NONCE}/f`)
    expect(fixture.hits(NONCE)).toEqual(['p', 'l/localhost', 'a', 'f'])
    expect(fixture.challenges(NONCE)).toBe(2)
    expect(fixture.authorizations).toBe(0)
  })

  it('counts any request that carries a credential, whatever its path', async () => {
    const fixture = await fixtureFor()
    await get(fixture.port, '/anything', { Authorization: 'Negotiate YII' })
    await get(fixture.port, '/else', { 'Proxy-Authorization': 'Basic eA==' })
    expect(fixture.authorizations).toBe(2)
  })

  it('answers on 127.0.0.2 where the OS has it (not macOS) and on ::1 where it has IPv6', async () => {
    const fixture = await fixtureFor()
    if (process.platform === 'darwin') {
      expect(fixture.loopbackHosts).not.toContain('127.0.0.2')
    } else {
      expect(fixture.loopbackHosts).toContain('127.0.0.2')
    }
  })

  it('counts connections and datagrams on this machine’s own address, and has none without one', async () => {
    const none = await fixtureFor()
    expect(none.own).toBeUndefined()
    const unparsed = await fixtureFor('not-an-address')
    expect(unparsed.own).toBeUndefined()
    const fixture = await fixtureFor('127.0.0.1')
    const own = fixture.own
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
    expect(fixture.tcpConnections).toBe(1)
  })
})

describe('a canary phase’s plan (M81 A1)', () => {
  it('binds the default phase to its routing probes and the probe page to its nonce', () => {
    const fixture = fake()
    const plan = phasePlan('default', NONCE, fixture, [])
    expect(plan.pageUrl).toBe(`http://localhost:5555/${NONCE}/p`)
    expect([...plan.exceptions]).toEqual([
      `http://c1-${NONCE}.invalid/`,
      `https://c3-${NONCE}.invalid/`,
    ])
    expect(plan.isFull).toBe(false)
    const input = JSON.parse(plan.script.slice(plan.script.lastIndexOf(')({') + 2, -1)) as Record<
      string,
      unknown
    >
    expect(input).toMatchObject({
      ws: { c2: `ws://c2-${NONCE}.invalid/`, c2s: `wss://c2s-${NONCE}.invalid/` },
      auth: null,
      ice: null,
      wt: null,
    })
    expect(fixture.hits(NONCE)).toContain('p')
  })

  it('adds the sign-in, alias, link-local, ICE and WebTransport probes in the page and audit phases', () => {
    const plan = phasePlan('page', NONCE, fake(), [])
    expect([...plan.exceptions]).toEqual([
      `http://c1-${NONCE}.invalid/`,
      `https://c3-${NONCE}.invalid/`,
      `http://c8-${NONCE}.localhost/`,
      `http://169.254.77.77:8080/${NONCE}`,
    ])
    const input = JSON.parse(plan.script.slice(plan.script.lastIndexOf(')({') + 2, -1)) as Record<
      string,
      unknown
    >
    expect(input).toMatchObject({
      ws: { c5w: `ws://localhost:5555/${NONCE}/w` },
      auth: `/${NONCE}/a`,
      ice: { address: '192.168.1.9', port: 7001 },
      wt: `https://192.168.1.9:7002/${NONCE}/`,
    })
  })

  it('probes a subdomain of a widened name and a neighbour of a widened address, never the widened host itself', () => {
    const plan = phasePlan('audit', NONCE, fake(), ['staging.example.com', '10.0.0.4'])
    expect(plan.c9Hosts).toEqual([`c9-${NONCE}.staging.example.com`, '10.0.0.5'])
    expect(plan.exceptions).toContain(`http://c9-${NONCE}.staging.example.com/${NONCE}`)
    expect(plan.exceptions).toContain(`http://10.0.0.5/${NONCE}`)
    // A neighbour that is itself widened is not probed.
    expect(phasePlan('page', NONCE, fake(), ['10.0.0.4', '10.0.0.5']).c9Hosts).toEqual([])
  })
})

describe('a canary phase’s verdict (M81 A1)', () => {
  it('holds when every probe arrived where the construction routes it', () => {
    const fixture = fake()
    const plan = phasePlan('page', NONCE, fixture, [])
    expect(phaseVerdict(plan, allRecords(fixture), fixture, CLEAN)).toBeUndefined()
    const defaultPlan = phasePlan('default', NONCE, fixture, [])
    expect(
      phaseVerdict(
        defaultPlan,
        [...allRecords(fixture).slice(0, 4), ...allRecords(fixture).slice(7, 9)],
        fixture,
        CLEAN,
      ),
    ).toBeUndefined()
  })

  it('names each failure by the canary that found it, and the audit’s all auditFailed', () => {
    const all = allRecords(fake())
    const without = (index: number): ProxyObservation[] => all.filter((_record, at) => at !== index)
    const cases: [ProxyObservation[], ProbeReport, Partial<ProbeFixture>, string][] = [
      [without(0), CLEAN, {}, 'routeUnconfirmed'],
      [without(4), CLEAN, {}, 'routeUnconfirmed'],
      [without(6), CLEAN, {}, 'routeUnconfirmed'],
      [without(8), CLEAN, {}, 'routeUnconfirmed'],
      [all, { ...CLEAN, sockets: { c2: 'open' } }, {}, 'routeUnconfirmed'],
      [all, CLEAN, { hits: () => ['l/localhost', 'l/127.0.0.1', 'w'] }, 'routeUnconfirmed'],
      [all, CLEAN, { authorizations: 1 }, 'signIn'],
      [without(9), CLEAN, {}, 'signIn'],
      [all, CLEAN, { challenges: () => 1 }, 'signIn'],
      [all, CLEAN, { own: undefined }, 'unverifiable'],
      [without(11), CLEAN, {}, 'webrtc'],
      [all, { ...CLEAN, ice: 'error' }, {}, 'webrtc'],
      [all, CLEAN, { tcpConnections: 1 }, 'webrtc'],
      [
        all,
        { ...CLEAN, candidates: ['candidate:2 1 tcp 1518 192.168.1.9 9 typ host tcptype passive'] },
        {},
        'webrtc',
      ],
      [all, { ...CLEAN, wt: 'ready' }, {}, 'transport'],
      [all, { ...CLEAN, wt: 'threw' }, {}, 'transport'],
      [all, CLEAN, { datagrams: 1 }, 'transport'],
    ]
    for (const [records, report, overrides, verdict] of cases) {
      const changed = { ...fake(), ...overrides }
      changed.admit(NONCE)
      const changedPlan = phasePlan('page', NONCE, changed, [])
      expect(phaseVerdict(changedPlan, records, changed, report), verdict).toBe(verdict)
      const audit = phasePlan('audit', NONCE, changed, [])
      expect(phaseVerdict(audit, records, changed, report), verdict).toBe('auditFailed')
    }
  })

  it('accepts ICE TCP the proxy tunnelled to this machine’s own address when the user widened it, and nothing more', () => {
    const fixture = fake({ tcpConnections: 1 })
    const plan = phasePlan('page', NONCE, fixture, ['192.168.1.9'])
    const widened = allRecords(fixture).map((record) =>
      record.host === '192.168.1.9' ? { ...record, forwarded: true } : record,
    )
    const neighbour = seen('http', '192.168.1.8', 80)
    expect(phaseVerdict(plan, [...widened, neighbour], fixture, CLEAN)).toBeUndefined()
    // A second connection the proxy did not make: direct.
    const direct = { ...fixture, tcpConnections: 2 }
    expect(phaseVerdict(plan, [...widened, neighbour], direct, CLEAN)).toBe('webrtc')
  })

  it('requires the widened host’s neighbours refused too', () => {
    const fixture = fake()
    const plan = phasePlan('page', NONCE, fixture, ['10.0.0.4'])
    expect(phaseVerdict(plan, allRecords(fixture), fixture, CLEAN)).toBe('routeUnconfirmed')
    expect(
      phaseVerdict(plan, [...allRecords(fixture), seen('http', '10.0.0.5', 80)], fixture, CLEAN),
    ).toBeUndefined()
  })
})
