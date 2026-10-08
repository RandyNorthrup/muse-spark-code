import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { DeviceDiscovery, type DeviceMdnsPort } from '../../src/host/devices/deviceDiscovery'

const instances = new Set<DeviceDiscovery>()
afterEach(() => {
  for (const discovery of instances) discovery.stop()
  instances.clear()
  vi.useRealTimers()
})
function fixture() {
  const state = {
    receive: (_packet: Buffer, _address: string) => {
      /* Installed by fake open. */
    },
  }
  const session = { advertise: vi.fn(), close: vi.fn() }
  const mdns: DeviceMdnsPort = {
    open: vi.fn((_address, receive) => {
      state.receive = receive
      return Promise.resolve(session)
    }),
    decode: vi.fn((packet: Buffer) => {
      const parsed: unknown = JSON.parse(packet.toString())
      return parsed
    }),
  }
  const interfaces = vi.fn(() => ['10.0.0.1'])
  const discovery = new DeviceDiscovery(mdns, interfaces)
  instances.add(discovery)
  const policy = { isEnabled: () => true, isPairedReceiverOffering: () => true }
  return { discovery, mdns, session, state, policy, interfaces }
}
const advertisement = { serviceId: 'a'.repeat(32), port: 4321, version: 1 }
const packet = (value: unknown = advertisement) => Buffer.from(JSON.stringify(value))

describe('optional minimal discovery policy', () => {
  it('does no work with discovery off or without an enabled paired offer', async () => {
    const { discovery, mdns, policy, interfaces } = fixture()
    expect(mdns.open).not.toHaveBeenCalled()
    for (const disabled of [
      { ...policy, isEnabled: () => false },
      { ...policy, isPairedReceiverOffering: () => false },
    ])
      await discovery.start(disabled, '10.0.0.1', 4321)
    expect(mdns.open).not.toHaveBeenCalled()
    expect(interfaces).not.toHaveBeenCalled()
  })
  it('advertises only an opaque rotating id, port and protocol version on the chosen interface', async () => {
    vi.useFakeTimers()
    const { discovery, mdns, session, policy } = fixture()
    await discovery.start(policy, '10.0.0.1', 4321)
    expect(mdns.open).toHaveBeenCalledWith('10.0.0.1', expect.any(Function))
    const first: unknown = session.advertise.mock.calls[0]?.[0]
    expect(first).toEqual({
      serviceId: expect.stringMatching(/^[a-f0-9]{32}$/),
      port: 4321,
      version: 1,
    })
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.idleConnectionMs)
    expect(session.advertise.mock.calls[1]?.[0]).not.toEqual(first)
    await discovery.start(policy, '10.0.0.1', 4321)
    expect(session.advertise.mock.calls[2]?.[0]).not.toEqual(first)
  })
  it('treats spoofed discovery as an address hint only and refuses extra private fields', async () => {
    const { discovery, state, policy } = fixture()
    await discovery.start(policy, '10.0.0.1', 4321)
    state.receive(packet(), '10.0.0.200')
    expect(discovery.hint(advertisement.serviceId)).toEqual({ address: '10.0.0.200', port: 4321 })
    for (const field of [
      'certificate',
      'fingerprint',
      'account',
      'repository',
      'model',
      'name',
      'apiKey',
    ])
      state.receive(
        packet({ ...advertisement, serviceId: 'b'.repeat(32), [field]: 'synthetic-sentinel' }),
        '10.0.0.201',
      )
    expect(discovery.hint('b'.repeat(32))).toBeUndefined()
  })
  it('refuses public/metadata/mapped senders and incompatible/malformed data', async () => {
    const { discovery, state, policy } = fixture()
    await discovery.start(policy, '10.0.0.1', 4321)
    for (const address of ['8.8.8.8', '169.254.169.254', '::ffff:10.0.0.1', 'fd00:ec2::254'])
      state.receive(packet(), address)
    state.receive(packet({ ...advertisement, version: 0 }), '10.0.0.2')
    state.receive(Buffer.from('{broken}'), '10.0.0.2')
    for (const serviceId of ['b'.repeat(31), 'c'.repeat(33), 'D'.repeat(32)]) {
      state.receive(packet({ ...advertisement, serviceId }), '10.0.0.2')
      expect(discovery.hint(serviceId)).toBeUndefined()
    }
    expect(discovery.hint(advertisement.serviceId)).toBeUndefined()
  })
  it('does not decode or retain observations after the local offer is revoked', async () => {
    const { discovery, mdns, state, session, policy } = fixture()
    let isOffering = true
    await discovery.start(
      { ...policy, isPairedReceiverOffering: () => isOffering },
      '10.0.0.1',
      4321,
    )
    isOffering = false
    state.receive(packet(), '10.0.0.2')
    expect(mdns.decode).not.toHaveBeenCalled()
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(discovery.hint(advertisement.serviceId)).toBeUndefined()
  })
  it('keeps a current adapter alive when an older pending open finishes later', async () => {
    const { discovery, mdns, session, policy, state } = fixture()
    const old = { advertise: vi.fn(), close: vi.fn() }
    const pending = Promise.withResolvers<typeof old>()
    let calls = 0
    mdns.open = vi.fn((_address, receive) => {
      calls += 1
      state.receive = receive
      return calls === 1 ? pending.promise : Promise.resolve(session)
    })
    const first = discovery.start(policy, '10.0.0.1', 4321)
    await discovery.start(policy, '10.0.0.1', 4321)
    pending.resolve(old)
    await first
    expect(old.advertise).not.toHaveBeenCalled()
    expect(old.close).toHaveBeenCalledTimes(1)
    expect(session.close).not.toHaveBeenCalled()
    state.receive(packet(), '10.0.0.2')
    expect(discovery.hint(advertisement.serviceId)).toBeDefined()
  })
  it('turns adapter startup errors into fixed blocked/unreachable recovery without leaking text', async () => {
    const { discovery, mdns, policy } = fixture()
    mdns.open = vi.fn(() => Promise.reject(new Error('synthetic-private-path-sentinel')))
    await expect(discovery.start(policy, '10.0.0.1', 4321)).rejects.toThrow(
      'blocked-or-unreachable',
    )
  })
  it('bounds packets and floods before invoking the injected mDNS decoder', async () => {
    const { discovery, mdns, state, policy } = fixture()
    await discovery.start(policy, '10.0.0.1', 4321)
    state.receive(Buffer.alloc(DEVICE_LIMITS.frameBytes + 1), '10.0.0.2')
    state.receive(Buffer.alloc(0), '10.0.0.2')
    expect(mdns.decode).not.toHaveBeenCalled()
    for (let index = 0; index <= DEVICE_LIMITS.queuedFrames; index += 1)
      state.receive(packet(), '10.0.0.2')
    expect(mdns.decode).toHaveBeenCalledTimes(DEVICE_LIMITS.queuedFrames - 2)
  })
  it('bounds retained hints and expires observations without changing any pairing identity', async () => {
    vi.useFakeTimers()
    const { discovery, state, policy } = fixture()
    await discovery.start(policy, '10.0.0.1', 4321)
    for (let index = 0; index <= DEVICE_LIMITS.pairedDevices; index += 1)
      state.receive(
        packet({ ...advertisement, serviceId: index.toString(16).padStart(32, '0') }),
        '10.0.0.2',
      )
    expect(
      discovery.hint(DEVICE_LIMITS.pairedDevices.toString(16).padStart(32, '0')),
    ).toBeUndefined()
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.idleConnectionMs)
    expect(discovery.hint('0'.repeat(32))).toBeUndefined()
  })
  it('withdraws the advertisement and hints when the local offer is revoked', async () => {
    vi.useFakeTimers()
    const { discovery, state, session, policy } = fixture()
    let isOffering = true
    await discovery.start(
      { ...policy, isPairedReceiverOffering: () => isOffering },
      '10.0.0.1',
      4321,
    )
    state.receive(packet(), '10.0.0.2')
    isOffering = false
    await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.idleConnectionMs)
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(session.advertise).toHaveBeenCalledTimes(1)
    expect(discovery.hint(advertisement.serviceId)).toBeUndefined()
  })
  it('does not advertise if revoked while the asynchronous adapter is opening', async () => {
    const { discovery, mdns, session, policy } = fixture()
    const opened = Promise.withResolvers<typeof session>()
    mdns.open = vi.fn(() => opened.promise)
    const start = discovery.start(policy, '10.0.0.1', 4321)
    discovery.stop()
    opened.resolve(session)
    await start
    expect(session.advertise).not.toHaveBeenCalled()
    expect(session.close).toHaveBeenCalledTimes(1)
  })
  it.each(['offer', 'enable'])(
    'settles off when %s drops during open without stop',
    async (flag) => {
      const { discovery, mdns, session } = fixture()
      const opened = Promise.withResolvers<typeof session>()
      mdns.open = vi.fn(() => opened.promise)
      let isAllowed = true
      const start = discovery.start(
        {
          isEnabled: () => flag !== 'enable' || isAllowed,
          isPairedReceiverOffering: () => flag !== 'offer' || isAllowed,
        },
        '10.0.0.1',
        4321,
      )
      expect(discovery.status()).toEqual({ state: 'starting' })
      isAllowed = false
      opened.resolve(session)
      await start
      expect(discovery.status()).toEqual({ state: 'off' })
      expect(session.close).toHaveBeenCalledTimes(1)
      expect(session.advertise).not.toHaveBeenCalled()
    },
  )
  it.each(['offer', 'enable'])(
    'settles off when %s drops in the first announcement',
    async (flag) => {
      const { discovery, session, policy } = fixture()
      let isAllowed = true
      session.advertise.mockImplementation(() => {
        isAllowed = false
      })
      await discovery.start(
        {
          ...policy,
          isEnabled: () => flag !== 'enable' || isAllowed,
          isPairedReceiverOffering: () => flag !== 'offer' || isAllowed,
        },
        '10.0.0.1',
        4321,
      )
      expect(discovery.status()).toEqual({ state: 'off' })
      expect(session.close).toHaveBeenCalledTimes(1)
    },
  )
  it('ignores an old adapter callback without shutting down a new discovery generation', async () => {
    const { discovery, state, session, policy } = fixture()
    await discovery.start(policy, '10.0.0.1', 4321)
    const old = state.receive
    await discovery.start(policy, '10.0.0.1', 4321)
    old(packet(), '10.0.0.2')
    state.receive(packet(), '10.0.0.3')
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(discovery.hint(advertisement.serviceId)?.address).toBe('10.0.0.3')
  })
})
