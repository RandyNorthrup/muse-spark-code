import { describe, expect, it } from 'vitest'
import {
  guardNodeRequest,
  nodeAuthenticate,
  NodeListenerAdmission,
} from '../../src/runtime/node/listenerGuard'
import {
  dispatchNodeMethod,
  nodeActionDigest,
  nodeRoute,
} from '../../src/runtime/node/listenerMethods'
import { nodeLanAddressSchema } from '../../src/shared/node'
import {
  NODE_LISTENER_MAX_REQUESTS,
  NODE_PROOF_MAX_ATTEMPTS,
  NODE_PROOF_WINDOW_MS,
  NODE_LISTENER_MAX_SOURCES,
  NODE_LISTENER_SOURCE_CONNECTIONS,
} from '../../src/shared/constants'
import { listenerFixture, listenerRequest } from './helpers/node/listener'
import { nodeBearer, nodeHash, nodeSession } from './helpers/node/records'

describe('M110-N listener guards', () => {
  it.each([
    '0.0.0.0',
    '::',
    '0:0:0:0:0:0:0:0',
    '8.8.8.8',
    '224.1.1.1',
    'ff02::1',
    '169.254.169.254',
    '169.254.170.2',
    'fd00:ec2::254',
    'fd00:0ec2:0:0:0:0:0:254',
    'fd20:ce::254',
    '::ffff:127.0.0.1',
    '::ffff:192.168.1.2',
    '2001:4860:4860::8888',
    '100.64.1.2',
    '127.1',
    'home.local',
    'fe80::1%eth0',
  ])('H01 rejects %s', (address) => {
    expect(nodeLanAddressSchema.safeParse(address).success).toBe(false)
  })
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.2',
    '172.16.0.1',
    '172.31.1.2',
    '169.254.1.2',
    '::1',
    '0:0:0:0:0:0:0:1',
    'fc00::1',
    'fd42::1',
    'fe80::1',
    'febf::1',
  ])('H01 permits explicitly chosen %s', (address) => {
    expect(nodeLanAddressSchema.safeParse(address).success).toBe(true)
  })
  it.each([
    ['Host', 'other.local:7443'],
    ['Host', 'home.local'],
    ['Host', 'HOME.local:7443'],
    ['Origin', 'https://evil.local'],
    ['Origin', 'null'],
    ['Origin', 'https://home.local:7443/'],
    ['Sec-Fetch-Site', 'cross-site'],
    ['Sec-Fetch-Site', 'same-site'],
    ['Sec-Fetch-Site', 'none'],
    ['Sec-Fetch-Mode', 'navigate'],
    ['Sec-Fetch-Mode', 'no-cors'],
    ['Sec-Fetch-Dest', 'document'],
  ])('H07 refuses wrong %s %s', (name, value) => {
    const req = listenerRequest()
    req.rawHeaders[req.rawHeaders.indexOf(name) + 1] = value
    expect(() => {
      guardNodeRequest(req, listenerFixture().options.config, false)
    }).toThrow()
  })
  it.each(['Host', 'Origin', 'Sec-Fetch-Site', 'Sec-Fetch-Mode', 'Sec-Fetch-Dest'])(
    'H07 refuses missing/duplicated %s',
    (name) => {
      const req = listenerRequest()
      const config = listenerFixture().options.config
      const index = req.rawHeaders.indexOf(name)
      const value = req.rawHeaders[index + 1]!
      req.rawHeaders.splice(index, 2)
      expect(() => {
        guardNodeRequest(req, config, false)
      }).toThrow()
      req.rawHeaders.push(name, value, name.toLowerCase(), value)
      expect(() => {
        guardNodeRequest(req, config, false)
      }).toThrow()
    },
  )
  it('H06/H07 accepts same-origin transports and refuses every cookie', () => {
    const { config } = listenerFixture().options
    for (const isWs of [false, true]) {
      const req = listenerRequest(isWs)
      expect(() => {
        guardNodeRequest(req, config, isWs)
      }).not.toThrow()
      req.rawHeaders.push('Cookie', '')
      expect(() => {
        guardNodeRequest(req, config, isWs)
      }).toThrow()
    }
    expect(() => nodeRoute('/node/stop?bearer=synthetic')).toThrow()
    expect(() => nodeRoute('/__proto__')).toThrow()
  })
  it.each([false, true])('H07 uses browser Fetch Metadata for WebSocket=%s', (isWs) => {
    const req = listenerRequest(isWs)
    const config = listenerFixture().options.config
    expect(() => {
      guardNodeRequest(req, config, isWs)
    }).not.toThrow()
    req.rawHeaders[req.rawHeaders.indexOf('Sec-Fetch-Dest') + 1] = isWs ? 'empty' : 'websocket'
    expect(() => {
      guardNodeRequest(req, config, isWs)
    }).toThrow()
  })
  it.each([
    [false, 'Sec-Fetch-Site', 'cross-site'],
    [true, 'Sec-Fetch-Site', 'cross-site'],
    [false, 'Sec-Fetch-Site', 'same-site'],
    [true, 'Sec-Fetch-Site', 'same-site'],
    [false, 'Origin', 'https://evil.local:7443'],
    [true, 'Origin', 'https://evil.local:7443'],
  ])('H07 refuses foreign HTTP/WebSocket=%s %s %s', (isWs, name, value) => {
    const req = listenerRequest(isWs)
    req.rawHeaders[req.rawHeaders.indexOf(name) + 1] = value
    expect(() => {
      guardNodeRequest(req, listenerFixture().options.config, isWs)
    }).toThrow()
  })
  it('H07 a coherent forged Host and Origin still cannot escape the configured names', () => {
    const req = listenerRequest()
    req.rawHeaders[req.rawHeaders.indexOf('Host') + 1] = 'evil.local:7443'
    req.rawHeaders[req.rawHeaders.indexOf('Origin') + 1] = 'https://evil.local:7443'
    expect(() => {
      guardNodeRequest(req, listenerFixture().options.config, false)
    }).toThrow()
  })
  it('H06/H08 unbound verifier, invalid token, rejected session and wrong owner never grant access', async () => {
    const { verifier } = listenerFixture()
    const signal = new AbortController().signal
    await expect(nodeAuthenticate(undefined, nodeBearer, 'owner', signal)).rejects.toThrow()
    await expect(nodeAuthenticate(verifier, '', 'owner', signal)).rejects.toThrow()
    expect(verifier.verifyBearer).not.toHaveBeenCalled()
    await expect(nodeAuthenticate(verifier, nodeBearer, 'other', signal)).rejects.toThrow()
    verifier.verifyBearer.mockRejectedValueOnce(new Error('synthetic account detail'))
    await expect(nodeAuthenticate(verifier, nodeBearer, 'owner', signal)).rejects.toThrow('Sign in')
    expect(await nodeAuthenticate(verifier, nodeBearer, 'owner', signal)).toEqual(nodeSession())
  })
  it('H09 per-source failure and proof-work limits never block another source', () => {
    let time = 0
    const admission = new NodeListenerAdmission(() => time)
    const signin = admission.enter('source-a', true)
    admission.enter('source-b', true)(false)
    signin(true)
    expect(() => admission.enter('source-a', true)).toThrow()
    admission.enter('source-b', true)(false)
    time = 1000
    admission.enter('source-a', true)(false, false)
    admission.enter('source-a', true)(true)
    time = 2999
    expect(() => admission.enter('source-a', true)).toThrow()
    time = 3000
    admission.enter('source-a', true)(false)
    const work = new NodeListenerAdmission(() => time)
    for (let index = 0; index < NODE_PROOF_MAX_ATTEMPTS; index++)
      work.enter('busy-source', true)(false)
    expect(() => work.enter('busy-source', true)).toThrow()
    work.enter('other-source', true)(false)
    time += NODE_PROOF_WINDOW_MS
    work.enter('busy-source', true)(false)
    const held = Array.from({ length: NODE_LISTENER_SOURCE_CONNECTIONS }, () =>
      admission.enter('same', false),
    )
    expect(() => admission.enter('same', false)).toThrow()
    for (const done of held) done(false)
    const total = Array.from({ length: NODE_LISTENER_MAX_REQUESTS }, (_, index) =>
      admission.enter(`r${String(index)}`, false),
    )
    expect(() => admission.enter('over', false)).toThrow()
    for (const done of total) done(false)
    const table = new NodeListenerAdmission(() => time)
    for (let index = 0; index < NODE_LISTENER_MAX_SOURCES; index += 1)
      table.enter(String(index), false)(false)
    expect(() => table.enter('new', false)).toThrow()
    time += 60_001
    table.enter('new', true)(false)
  })
  it('H19 exact payload, action, session, freshness and single use bind each fake physical action; Stop stays ungated', async () => {
    const fixture = listenerFixture()
    const ports = {
      methods: fixture.options.methods,
      verifier: fixture.verifier,
      now: () => 1000,
      source: '127.0.0.1',
    }
    const signal = new AbortController().signal
    const params = {
      deviceId: 'device-1',
      operation: 'actuate',
      payload: '{"angle":1}',
      stepUpId: 'proof-1',
      actionDigest: nodeHash,
    }
    params.actionDigest = nodeActionDigest('node/maker/action', params)
    const proof = {
      id: 'proof-1',
      sessionId: 'session-1',
      action: 'maker.action',
      actionDigest: params.actionDigest,
      verifiedAt: 0,
      expiresAt: 60_000,
    } as const
    const dispatch = (input: unknown) =>
      dispatchNodeMethod('node/maker/action', input, nodeSession(), ports, signal)
    await expect(dispatch({ ...params, payload: '{"angle":2}' })).rejects.toThrow()
    expect(fixture.verifier.consumeStepUp).not.toHaveBeenCalled()
    for (const invalid of [
      { ...proof, action: 'terminal.open' as const },
      { ...proof, sessionId: 'other' },
      { ...proof, actionDigest: nodeHash },
      { ...proof, expiresAt: 1000 },
      { ...proof, verifiedAt: 1001 },
    ]) {
      fixture.verifier.consumeStepUp.mockResolvedValueOnce(invalid)
      await expect(dispatch(params)).rejects.toThrow()
    }
    expect(fixture.request).not.toHaveBeenCalled()
    fixture.verifier.consumeStepUp
      .mockResolvedValueOnce(proof)
      .mockRejectedValue(new Error('consumed'))
    await expect(dispatch(params)).resolves.toEqual({ done: true })
    await expect(dispatch(params)).rejects.toThrow()
    expect(fixture.request).toHaveBeenCalledTimes(1)
    await dispatchNodeMethod('node/stop', {}, nodeSession(), ports, signal)
    await dispatchNodeMethod('node/stop', {}, { ...nodeSession(), id: 'another' }, ports, signal)
    expect(fixture.verifier.consumeStepUp).toHaveBeenCalledTimes(7)
    await expect(
      dispatchNodeMethod('node/stop', {}, nodeSession(), { ...ports, verifier: undefined }, signal),
    ).rejects.toThrow()
    const invalidResult = { done: true } as const
    Object.defineProperty(invalidResult, 'done', { value: false })
    fixture.request.mockResolvedValueOnce(invalidResult)
    await expect(
      dispatchNodeMethod('node/stop', {}, nodeSession(), ports, signal),
    ).rejects.toThrow()
  })
})
