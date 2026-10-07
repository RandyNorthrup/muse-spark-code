// @vitest-environment jsdom
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DevicesView } from '../../src/webview/models/sections/agents/DevicesView'
import {
  createDeviceService,
  DeviceStore,
  DeviceSecrets,
  AttemptJournal,
  type DeviceServiceDeps,
} from '../../src/host/devices/deviceEntry'
import { DevicePairing } from '../../src/host/devices/devicePairing'
import * as deviceEntry from '../../src/host/devices/deviceEntry'
import { deviceMethods } from '../../src/host/devices/deviceBundle'
import { FakeLogOutputChannel, memorySecrets } from './helpers/fakes'
import { EN } from '../../src/shared/l10n/en'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import type {
  DeviceHostMessage,
  DevicesPanelState,
  DeviceWebviewRequest,
} from '../../src/shared/devicesPanel'
import {
  deviceInvitationSchema,
  type DeviceFrame,
  type DeviceInvitation,
} from '../../src/shared/devices'
import type {
  DeviceExecutionBoundary,
  DeviceLocalAttempt,
} from '../../src/host/devices/deviceReceiver'
import { deviceGrant, deviceLane } from './helpers/deviceFixtures'
import { deferred, executionUsage, signedDispatch } from './helpers/deviceExecutionFixtures'
import { transportHandler, transportPort } from './helpers/deviceTransportFixtures'

type Service = Awaited<ReturnType<typeof createDeviceService>>
const resources: { parent: string; store: DeviceStore; service?: Service }[] = []
afterEach(async () => {
  cleanup()
  for (const resource of resources.splice(0)) {
    resource.service?.dispose()
    await resource.store.close()
    await rm(resource.parent, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

async function host(id: string) {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'm100-i-')))
  const store = await DeviceStore.create(path.join(parent, 'pairing'), id.repeat(32))
  const resource: (typeof resources)[number] = { parent, store }
  resources.push(resource)
  const journalDirectory = path.join(parent, 'attempts')
  const journal = await AttemptJournal.create(journalDirectory, {
    assertOwner: () => Promise.resolve(),
  })
  const location = {
    ui: 'desktop',
    remoteName: undefined,
    execution: 'local',
    secretLocation: 'execution-host',
  } as const
  const secrets = new DeviceSecrets(memorySecrets(), location)
  const retirement = deferred<Awaited<DeviceLocalAttempt['retirement']>>()
  const lease = {
    usage: executionUsage,
    start: vi.fn(async (boundary: DeviceExecutionBoundary) => {
      await boundary.beforeAction()
    }),
    pause: vi.fn(() => Promise.resolve()),
    cancel: vi.fn((): Promise<void> => Promise.resolve()),
    retirement: retirement.promise,
    release: vi.fn(() => Promise.resolve()),
  }
  const source = transportHandler()
  const endpoint = { address: '127.0.0.1', port: await transportPort() }
  const report = vi.fn()
  const deps: DeviceServiceDeps = {
    store,
    secrets,
    host: location,
    journal,
    receiverIncarnationId: '1'.repeat(32),
    now: Date.now,
    setup: () =>
      Promise.resolve({
        endpoint,
        certificateExpiresAt: Date.now() + DEVICE_LIMITS.certificateLifetimeMs,
        listenerApplication: 'node',
        interfaceLabel: 'lo',
      }),
    otherAction: (request) =>
      Promise.resolve({
        viewId: request.viewId,
        requestId: request.requestId,
        failure: 'grant',
      }),
    execution: {
      retain: vi.fn(() => Promise.resolve()),
      admit: vi.fn(() => Promise.resolve(lease)),
    },
    policy: {
      assertAllowed: vi.fn(() => Promise.resolve()),
      approve: vi.fn(() => Promise.resolve(true)),
      paidGate: { isOn: () => false },
      paidConsent: { allows: () => Promise.resolve(false) },
      assertPaidBinding: vi.fn(() => Promise.resolve()),
    },
    source,
    snapshot: vi.fn((): Promise<DevicesPanelState> => Promise.resolve({ enabled: false })),
    publish: vi.fn(),
    report,
  }
  const service = await createDeviceService(deps, EN, 'en')
  resource.service = service
  let serial = 0
  const action = async (action: DeviceWebviewRequest['action']) => {
    serial += 1
    return await service.request({
      type: 'deviceRequest',
      viewId: id.repeat(32),
      requestId: serial.toString(16).padStart(32, '0'),
      revision: 0,
      action,
    })
  }
  return {
    service,
    action,
    store,
    journal,
    journalDirectory,
    deps,
    source,
    endpoint,
    lease,
    retirement,
    report,
  }
}
function invitation(message: DeviceHostMessage): DeviceInvitation {
  if (message.setup?.invitation === undefined) throw new Error('Missing test invitation')
  return message.setup.invitation
}
async function pairedHosts() {
  const a = await host('a')
  const b = await host('b')
  const local = invitation(await a.action({ kind: 'pair' }))
  const peer = invitation(await b.action({ kind: 'pair' }))
  expect(
    invitation(await a.action({ kind: 'importInvitation', text: DevicePairing.publicText(peer) })),
  ).toEqual(peer)
  expect(
    invitation(await b.action({ kind: 'importInvitation', text: DevicePairing.publicText(local) })),
  ).toEqual(local)
  const leftMessage = await a.action({
    kind: 'confirmFingerprint',
    invitationId: peer.invitationId,
    fingerprint: peer.fingerprint,
  })
  const left = leftMessage.setup?.confirmation
  const rightMessage = await b.action({
    kind: 'confirmFingerprint',
    invitationId: local.invitationId,
    fingerprint: local.fingerprint,
  })
  const right = rightMessage.setup?.confirmation
  if (left === undefined || right === undefined) throw new Error('Missing test confirmation')
  for (const [owner, confirmation] of [
    [a, right],
    [b, left],
  ] as const) {
    const reply = await owner.action({ kind: 'importConfirmation', confirmation })
    expect(reply.setup?.failure).toBeUndefined()
  }
  return { a, b, pairId: left.pairId }
}

async function running(payload = 'Bounded fake-only task') {
  const { a, b, pairId } = await pairedHosts()
  const grant = deviceGrant(pairId)
  await a.service.pairing.grant(grant)
  a.service.receiver.resumeQueue()
  await a.service.listen(pairId)
  const channel = await b.service.connect(pairId)
  expect(channel.receiverIncarnationId).toBe(grant.offer.receiverIncarnationId)
  const lane = deviceLane(grant)
  if (lane.kind !== 'lane') throw new Error('Missing test lane')
  const request = signedDispatch({ ...lane, brief: payload })
  if (request.kind !== 'lane') throw new Error('Missing signed test lane')
  const simulated: { running: boolean; payloads: string[]; stops: number } = {
    running: false,
    payloads: [],
    stops: 0,
  }
  a.lease.start.mockImplementation(async (boundary) => {
    await boundary.beforeAction()
    simulated.payloads.push(request.brief)
    simulated.running = true
  })
  a.lease.cancel.mockImplementation(() => {
    simulated.stops += 1
    simulated.running = false
    return Promise.resolve()
  })
  await b.journal.sourceIntent(request, Date.now())
  const frame = (body: DeviceFrame['body']): DeviceFrame => ({
    version: 1,
    pairId,
    receiverIncarnationId: grant.offer.receiverIncarnationId,
    requestId: 'f'.repeat(32),
    body,
  })
  channel.send(frame({ kind: 'dispatch', dispatch: request }))
  await vi.waitFor(() => {
    expect(b.source.receive).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          kind: 'outcome',
          outcome: expect.objectContaining({ state: 'running' }),
        }),
      }),
      expect.anything(),
    )
  })
  expect(a.lease.start).toHaveBeenCalledOnce()
  return { a, b, pairId, channel, request, frame, simulated }
}

describe('joined P/T/E/U method port', () => {
  it('pairs from the actual shared React view through P and the host-owned snapshot port', async () => {
    const a = await host('a')
    const b = await host('b')
    const peer = invitation(await b.action({ kind: 'pair' }))
    const request = vi.spyOn(a.service.panel, 'request')
    const message = await a.service.panel.observe()
    render(
      createElement(DevicesView, {
        message,
        port: a.service.panel,
        explicitSetup: true,
        onState: () => true,
      }),
    )
    expect(request).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: EN.devices.pair }))
    const field = await screen.findByLabelText<HTMLTextAreaElement>(EN.devices.copyInvitation)
    const local = deviceInvitationSchema.parse(JSON.parse(field.value))
    fireEvent.change(screen.getByLabelText(EN.devices.scan), {
      target: { value: DevicePairing.publicText(peer) },
    })
    fireEvent.click(screen.getByRole('button', { name: EN.devices.importInvitation }))
    const confirm = await screen.findByRole('button', { name: EN.devices.confirmFingerprint })
    expect(confirm).toBeDisabled()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { name: EN.devices.peerFingerprint }),
      )
    })
    fireEvent.click(confirm)
    expect(request).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByLabelText(EN.devices.fingerprintMatches))
    fireEvent.click(confirm)
    await screen.findByLabelText(EN.devices.copyConfirmation)
    const state = await a.store.read()
    expect(state.pending[0]?.confirmation).toMatchObject({
      localInvitationId: local.invitationId,
      peerInvitationId: peer.invitationId,
      peerFingerprint: peer.fingerprint,
    })
    expect(state.pairs).toEqual([])
    expect(a.deps.execution.admit).not.toHaveBeenCalled()
    const observed = await a.service.panel.observe()
    expect(observed.revision).toBe(5)
    expect(
      request.mock.calls.every(
        ([envelope, signal]) =>
          envelope.viewId.length === DEVICE_LIMITS.idChars && signal !== undefined,
      ),
    ).toBe(true)
  })
  it('refuses disposed initialization before authorities open and closes a factory that finishes after disposal', async () => {
    const a = await host('a')
    const read = vi.spyOn(a.journal, 'records')
    const preparation = deferred<DeviceServiceDeps>()
    const first = deviceMethods({
      bundlePath: 'devices.js',
      log: new FakeLogOutputChannel(),
      loadBundle: () => deviceEntry,
      dependencies: () => preparation.promise,
    })
    const refused = expect(first.service()).rejects.toThrow('revoked')
    first.dispose()
    preparation.resolve(a.deps)
    await refused
    expect(read).not.toHaveBeenCalled()
    const creation = deferred<Service>()
    const create = vi.fn(() => creation.promise)
    const second = deviceMethods({
      bundlePath: 'devices.js',
      log: new FakeLogOutputChannel(),
      loadBundle: () => ({ ...deviceEntry, createDeviceService: create }),
      dependencies: () => Promise.resolve(a.deps),
    })
    const creating = expect(second.service()).rejects.toThrow('revoked')
    await vi.waitFor(() => {
      expect(create).toHaveBeenCalledOnce()
    })
    const disposed = vi.spyOn(a.service, 'dispose')
    second.dispose()
    creation.resolve(a.service)
    await creating
    expect(disposed).toHaveBeenCalledOnce()
    await expect(a.action({ kind: 'pair' })).rejects.toThrow('invalid-device-message')
    await a.service.observe()
    expect(a.deps.publish).not.toHaveBeenCalled()
  })
  it('pairs through actual UI envelopes with no listener, grant, admission or model startup', async () => {
    const { a, b, pairId } = await pairedHosts()
    const state = await a.store.read()
    expect(state.pairs[0]).toMatchObject({ pairId, paused: true, grants: [] })
    expect(a.deps.execution.admit).not.toHaveBeenCalled()
    expect(a.source.connected).not.toHaveBeenCalled()
    expect(b.source.connected).not.toHaveBeenCalled()
    const observed = await a.service.panel.observe()
    expect(observed.revision).toBeGreaterThan(4)
    expect(a.service.taskContext()).toContain('untrusted input')
  })
  it('uses current P grants over real pinned TLS and journals both sides before one local launch', async () => {
    const { a, b, request } = await running()
    const record = await a.journal.lookup(request.identity)
    expect(record).toMatchObject({ kind: 'receiver-record', outcome: { state: 'running' } })
    expect(await b.journal.lookup(request.identity)).toMatchObject({ kind: 'source-intent' })
    expect(a.deps.policy.approve).toHaveBeenCalledWith(request)
    expect(a.deps.publish).toHaveBeenCalledWith(
      expect.objectContaining({ revision: expect.any(Number) }),
    )
  })
  it('bounds frame-flood snapshot work, keeps Stop independent and publishes the latest state', async () => {
    const { a, b, channel, frame, request } = await running()
    await a.service.observe()
    const snapshot = vi.mocked(a.deps.snapshot)
    snapshot.mockClear()
    const held = deferred<DevicesPanelState>()
    const started = deferred<undefined>()
    const pending = deferred<DevicesPanelState>()
    const pendingStarted = deferred<undefined>()
    const latest: DevicesPanelState = { enabled: true, discoveryEnabled: false, devices: [] }
    snapshot.mockImplementation(() => Promise.resolve(latest))
    snapshot.mockImplementationOnce(() => {
      started.resolve(undefined)
      return held.promise
    })
    snapshot.mockImplementationOnce(() => {
      pendingStarted.resolve(undefined)
      return pending.promise
    })
    vi.mocked(b.source.receive).mockClear()
    const floodSize = DEVICE_LIMITS.queuedFrames * 2
    const controlCompletions = Array.from({ length: floodSize }, () => deferred<undefined>())
    const receive = a.service.receiver.receive.bind(a.service.receiver)
    let controls = 0
    const received = vi.spyOn(a.service.receiver, 'receive').mockImplementation(async (...args) => {
      await receive(...args)
      if (args[0].body.kind !== 'cancel') return
      controlCompletions[controls]?.resolve(undefined)
      controls += 1
    })
    try {
      channel.send(frame({ kind: 'offers', offers: [] }))
      await started.promise
      for (let index = 0; index < floodSize; index += 1)
        channel.send(frame({ kind: 'offers', offers: [] }))
      await vi.waitFor(() => {
        const refusals = vi
          .mocked(b.source.receive)
          .mock.calls.filter(
            ([message]) => message.body.kind === 'failure' && message.body.reason === 'capacity',
          )
        expect(refusals).toHaveLength(floodSize - (DEVICE_LIMITS.queuedFrames - 1))
      })
      // Batches stay below the reserved control cap while data/snapshot work is held.
      for (let index = 0; index < floodSize; index += 1) {
        channel.send(frame({ kind: 'cancel', identity: request.identity }))
        if ((index + 1) % (DEVICE_LIMITS.controlFrames / 2) === 0)
          await controlCompletions[index]?.promise
      }
      await Promise.all(
        received.mock.results.flatMap((result) => (result.type === 'return' ? [result.value] : [])),
      )
      expect(a.lease.cancel).toHaveBeenCalledTimes(floodSize)
      expect(a.lease.release).not.toHaveBeenCalled()
      expect(snapshot).toHaveBeenCalledOnce()
      held.resolve({ enabled: false })
      await pendingStarted.promise
      expect(snapshot).toHaveBeenCalledTimes(2)
      expect(
        received.mock.calls.filter(([message]) => message.body.kind === 'offers'),
      ).toHaveLength(1)
      expect(b.source.receive).toHaveBeenCalledTimes(
        1 + floodSize - (DEVICE_LIMITS.queuedFrames - 1),
      )
      pending.resolve(latest)
      await vi.waitFor(() => {
        expect(b.source.receive).toHaveBeenCalledTimes(floodSize + 1)
      })
      await a.service.observe()
      // One held capture, one coalesced control capture, capped data, explicit read.
      expect(snapshot.mock.calls.length).toBeLessThanOrEqual(DEVICE_LIMITS.queuedFrames + 2)
      expect(a.deps.publish).toHaveBeenLastCalledWith(expect.objectContaining({ state: latest }))
    } finally {
      held.resolve({ enabled: false })
      pending.resolve(latest)
      await Promise.allSettled(
        received.mock.results.flatMap((result) => (result.type === 'return' ? [result.value] : [])),
      )
      await a.service.observe()
    }
  })
  it.each([
    { kind: 'printer', payload: 'G28\nG1 X10 Y10' },
    { kind: 'CNC', payload: 'G0 X0 Y0\nM5' },
    { kind: 'MCU', payload: 'set-output pin=13 value=1' },
  ])(
    'delivers $kind simulator Stop despite a corrupt journal, retaining liability',
    async ({ payload }) => {
      const { a, channel, frame, request, simulated } = await running(payload)
      expect(simulated).toMatchObject({ running: true, payloads: [payload], stops: 0 })
      expect(a.deps.policy.approve).toHaveBeenLastCalledWith(
        expect.objectContaining({ brief: payload }),
      )
      await writeFile(path.join(a.journalDirectory, 'attempts.json'), '{broken')
      channel.send(frame({ kind: 'cancel', identity: request.identity }))
      await vi.waitFor(() => {
        expect(a.lease.cancel).toHaveBeenCalledOnce()
      })
      expect(a.lease.release).not.toHaveBeenCalled()
      expect(simulated).toMatchObject({ running: false, payloads: [payload], stops: 1 })
      expect(a.lease.usage.retainedLiabilityUsd).toBe(1)
      expect(a.service.receiver.blockedReason).toBe('storage')
    },
  )
  it('starts fail-safe reset Stop before reporting, even while cancellation confirmation is held', async () => {
    const { a, channel, request } = await running()
    const confirmation = deferred<undefined>()
    const writing = deferred<undefined>()
    const releaseWrite = deferred<undefined>()
    const advance = a.journal.advance.bind(a.journal)
    let hasWritten = false
    vi.spyOn(a.journal, 'advance').mockImplementationOnce(async (...args) => {
      writing.resolve(undefined)
      await releaseWrite.promise
      const outcome = await advance(...args)
      hasWritten = true
      return outcome
    })
    const cancellations = vi.spyOn(a.service.receiver, 'cancel')
    a.lease.cancel.mockReturnValueOnce(confirmation.promise)
    a.report.mockImplementation((reason: string) => {
      expect(reason).toBe('invalid-frame')
      expect(a.lease.cancel).toHaveBeenCalledOnce()
    })
    a.service.disconnected('invalid-frame', { ...channel, isReceiver: true })
    expect(a.lease.cancel).toHaveBeenCalledOnce()
    expect(a.lease.release).not.toHaveBeenCalled()
    const result = cancellations.mock.results[0]
    if (result?.type !== 'return') throw new Error('Missing test cancellation')
    const cancellation = result.value
    try {
      confirmation.resolve(undefined)
      await a.service.receiver.reconcile([request.identity])
      await writing.promise
      expect(hasWritten).toBe(false)
      releaseWrite.resolve(undefined)
      // Reconciliation can finish before this later uncertainty write is queued.
      await cancellation
      expect(hasWritten).toBe(true)
      expect(await a.journal.lookup(request.identity)).toMatchObject({
        kind: 'receiver-record',
        outcome: { state: 'uncertain' },
      })
    } finally {
      confirmation.resolve(undefined)
      releaseWrite.resolve(undefined)
      // Failed assertions must also settle the writes before fixture removal.
      await cancellation
    }
  })
  it('requires receiver-local approval at every action boundary and denies changed payloads', async () => {
    const { a, request } = await running()
    const boundary = a.lease.start.mock.calls[0]?.[0]
    if (boundary === undefined) throw new Error('Missing test boundary')
    vi.mocked(a.deps.policy.approve).mockResolvedValueOnce(false)
    await expect(boundary.beforeAction()).rejects.toThrow('approval-required')
    expect(a.deps.policy.approve).toHaveBeenLastCalledWith(request)
    const changed = { ...request, brief: 'changed payload' }
    const response = await a.service.receiver.dispatch(changed)
    expect(response.body).toMatchObject({
      kind: 'failure',
      reason: 'payload-changed',
    })
    expect(a.lease.start).toHaveBeenCalledOnce()
  })
  it('refuses headless receiver qualification before reading or retaining any journal', async () => {
    const a = await host('a')
    vi.mocked(a.deps.execution.retain).mockClear()
    const read = vi.spyOn(a.journal, 'records')
    await expect(
      createDeviceService({ ...a.deps, host: { ...a.deps.host, execution: 'headless' } }, EN, 'en'),
    ).rejects.toThrow('unsupported-host')
    expect(read).not.toHaveBeenCalled()
    expect(a.deps.execution.retain).not.toHaveBeenCalled()
  })
})
