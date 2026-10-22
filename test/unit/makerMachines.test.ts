import type {
  MakerSecrets,
  MachineApprovalRequest as MachineApproval,
} from '../../src/core/maker/ports'
async function captureFailure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work
  } catch (error) {
    return error
  }
  return undefined
}
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGrblMachine, parseGrblReport } from '../../src/core/maker/machines/grbl'
import { MachineHttp } from '../../src/core/maker/machines/http'
import { type MachineDeps } from '../../src/core/maker/machines/machine'
import { createMarlinMachine, marlinFeedLimit } from '../../src/core/maker/machines/marlin'
import { createMoonrakerMachine } from '../../src/core/maker/machines/moonraker'
import {
  createOctoprintMachine,
  type PrinterTelemetry,
} from '../../src/core/maker/machines/octoprint'
import { createPrusalinkMachine } from '../../src/core/maker/machines/prusalink'
import type { DeviceLogPort } from '../../src/core/maker/deviceLog'
import type { SerialMachinePort } from '../../src/core/maker/machines/serial'
import {
  machineTarget,
  type MakerLanPolicy,
  type MachineRecord,
} from '../../src/core/maker/registry'
import moonrakerCapture from '../fixtures/maker/moonraker-status.json'
import octoprintCapture from '../fixtures/maker/octoprint-virtual.json'
import grblCapture from '../fixtures/maker/grbl-sim.json'
import { fakeMachineServer, makerLimits as limits } from './helpers/fakeMakerMachine'

function record(endpoint: string, kind: MachineRecord['kind'] = 'moonraker'): MachineRecord {
  return {
    registrationId: '11111111-1111-4111-8111-111111111111',
    id: 'virtual',
    name: 'Simulator',
    endpoint,
    kind,
    category: 'printer',
    allowPlainHttp: true,
    limits,
  }
}
function answer(request: MachineApproval) {
  return {
    id: request.id,
    digest: request.digest,
    target: request.target,
    decision: 'allow_once',
  }
}
function dependencies() {
  const confirm = vi.fn<(request: MachineApproval) => Promise<unknown>>((request) =>
    Promise.resolve(answer(request)),
  )
  const append = vi.fn<DeviceLogPort['append']>(() => Promise.resolve())
  const notify = vi.fn(() => Promise.resolve())
  const deps: MachineDeps = {
    isLeaseHeld: () => true,
    host: {
      isTrusted: () => true,
      hardwareEnabled: () => true,
      isInteractive: () => true,
      confirm: (request, review) => {
        review({
          v: 1,
          type: 'makerPayloadReviewed',
          id: request.id,
          digest: request.digest,
          isComplete: true,
        })
        return confirm(request)
      },
      notify,
    },
    policy: {
      gcode: { maxBytes: 4096, maxLines: 30, mmPerInch: 25.4 },
      approvalTtlMs: 1000,
      stopDeadlineMs: 200,
      requestDeadlineMs: 1000,
      maxStateChanges: 2,
      now: () => Date.now(),
    },
    log: { append },
  }
  return { deps, confirm, append, notify }
}
// Only the local fake transport maps loopback to the private lane. Production
// must supply the shared classifier. Separate tests prove all other verdicts deny.
const localFakeLan: MakerLanPolicy = {
  classify: () => 'private',
  resolve: () => Promise.resolve(['127.0.0.1']),
}
function http(
  target: MachineRecord,
  lan = localFakeLan,
  beforeGuardedDispatch?: () => Promise<void>,
) {
  const secrets: MakerSecrets = {
    get: () => Promise.resolve(randomUUID()),
    store: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  }
  return new MachineHttp(target, lan, secrets, {
    timeoutMs: 1000,
    maxResponseBytes: 16_000,
    ...(beforeGuardedDispatch !== undefined && { beforeGuardedDispatch }),
  })
}
function watchRequests(transport: MachineHttp, observe: (path: string) => void): void {
  const request = transport.request.bind(transport)
  vi.spyOn(transport, 'request').mockImplementation((method, path, body, signal, beforeWrite) => {
    observe(path)
    return request(method, path, body, signal, beforeWrite)
  })
}
const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})
async function moonrakerTest() {
  const server = await fakeMachineServer()
  closers.push(server.close)
  const context = dependencies()
  const target = record(server.endpoint)
  const machine = createMoonrakerMachine(target, http(target), context.deps)
  return { ...context, machine, server, target }
}

describe('maker printer status and guarded send', () => {
  it('refreshes runtime admission after preparation; fixed Stop bypasses that hook', async () => {
    const { target, deps, server } = await moonrakerTest()
    let isEnabled = true
    const refresh = vi.fn<() => Promise<void>>(() => {
      isEnabled = false
      return Promise.resolve()
    })
    const machine = createMoonrakerMachine(target, http(target, localFakeLan, refresh), {
      ...deps,
      host: { ...deps.host, hardwareEnabled: () => isEnabled },
    })
    await expect(machine.send('G1 X20')).rejects.toThrow()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
    await machine.stop()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(server.requests.some((request) => request.path === '/printer/emergency_stop')).toBe(true)
  })
  it('looks up the immutable registration credential and refuses a mismatched registration', async () => {
    const { target, deps, server } = await moonrakerTest()
    const get = vi.fn((name: string) =>
      Promise.resolve(name === `maker.machine.${target.registrationId}` ? randomUUID() : undefined),
    )
    const transport = new MachineHttp(
      target,
      localFakeLan,
      {
        get,
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      { timeoutMs: 1000, maxResponseBytes: 16_000 },
    )
    const machine = createMoonrakerMachine(target, transport, deps)
    await machine.status()
    expect(get).toHaveBeenCalledWith(`maker.machine.${target.registrationId}`)
    expect(server.requests.every((request) => request.hasKey)).toBe(true)
    expect(() =>
      createMoonrakerMachine({ ...target, registrationId: randomUUID() }, transport, deps),
    ).toThrow('machineTargetMismatch')
  })
  it('reports acknowledged actuation with unrecorded audit and retries accounting without resending', async () => {
    const { machine, server, append, confirm, notify } = await moonrakerTest()
    const accepted: string[] = []
    let isWritable = false
    append.mockImplementation((entry) => {
      if (!isWritable && entry.action === 'actuate' && entry.outcome === 'sent')
        return Promise.reject(new Error('diskFull'))
      if (entry.action === 'actuate') accepted.push(entry.outcome)
      return Promise.resolve()
    })
    notify.mockRejectedValueOnce(new Error('surfaceClosed'))
    const result = await machine.send('G91\nG1 X1 F600\nG90')
    expect(result).toMatchObject({ outcome: 'sentWithUnrecordedAudit', logRecorded: false })
    expect(accepted).toEqual(['attempt'])
    expect(append.mock.calls.filter(([entry]) => entry.outcome === 'sent')).toHaveLength(2)
    expect(notify).toHaveBeenCalledWith('auditUnrecorded')
    expect(await result.retryAudit()).toBe(false)
    isWritable = true
    expect(await Promise.all([result.retryAudit(), result.retryAudit()])).toEqual([true, true])
    expect(await result.retryAudit()).toBe(true)
    expect(accepted).toEqual(['attempt', 'sent'])
    expect(
      server.requests.filter((request) => request.path === '/printer/gcode/script'),
    ).toHaveLength(1)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('recovers a transient final audit failure without marking the send failed', async () => {
    const { machine, server, append, notify } = await moonrakerTest()
    let isFailed = false
    append.mockImplementation((entry) => {
      if (!isFailed && entry.outcome === 'sent') {
        isFailed = true
        return Promise.reject(new Error('diskFull'))
      }
      return Promise.resolve()
    })
    const result = await machine.send('G1 X20')
    expect(result).toMatchObject({ outcome: 'sent', logRecorded: true })
    expect(append.mock.calls.some(([entry]) => entry.outcome === 'failed')).toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(
      server.requests.filter((request) => request.path === '/printer/gcode/script'),
    ).toHaveLength(1)
  })
  it('reports a consumed relative move with a lost reply as sent outcome unknown and blocks replay', async () => {
    const { machine, server, append, confirm, notify } = await moonrakerTest()
    const payload = 'G91\nG1 X1 F600\nG90'
    server.loseSendReply()
    const result = await machine.send(payload)
    expect(result).toMatchObject({ outcome: 'sentOutcomeUnknown', logRecorded: true })
    expect(machine.requiresStatusRead).toBe(true)
    expect(notify).toHaveBeenCalledWith('sentOutcomeUnknown')
    expect(server.moonraker.result.status.toolhead.position[0]).toBe(11)
    expect(
      append.mock.calls
        .filter(([entry]) => entry.action === 'actuate')
        .map(([entry]) => entry.outcome),
    ).toEqual(['attempt', 'sentOutcomeUnknown'])
    await expect(machine.send(payload)).rejects.toThrow('machineStatusRequired')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(
      server.requests.filter((request) => request.path === '/printer/gcode/script'),
    ).toHaveLength(1)
    server.reply({ status: 500, body: '{}' })
    await expect(machine.status()).rejects.toThrow('machineHttpStatus')
    expect(machine.requiresStatusRead).toBe(true)
    server.reply(undefined)
    const status = await machine.status()
    expect(status.gcode?.position.x).toBe(11)
    expect(machine.requiresStatusRead).toBe(false)
    server.loseSendReply(false)
    await expect(machine.send(payload)).resolves.toMatchObject({
      outcome: 'sent',
      logRecorded: true,
    })
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[1]?.[0].analysis.bounds?.min.x).toBe(11)
  })
  it('does not clear uncertainty with a status read started before response loss', async () => {
    const { target, deps, server } = await moonrakerTest()
    const transport = http(target)
    const json = transport.json.bind(transport)
    const snapshotReady = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    let queries = 0
    vi.spyOn(transport, 'json').mockImplementation(
      async (method, path, body, signal, beforeWrite) => {
        const reply = await json(method, path, body, signal, beforeWrite)
        if (path === '/printer/objects/query') {
          queries += 1
          if (queries === 3) {
            snapshotReady.resolve(undefined)
            await released.promise
          }
        }
        return reply
      },
    )
    const machine = createMoonrakerMachine(target, transport, deps)
    server.holdSend()
    const sending = machine.send('G1 X20')
    await vi.waitFor(() => {
      expect(server.requests.at(-1)?.path).toBe('/printer/gcode/script')
    })
    const staleRead = machine.status()
    await snapshotReady.promise
    server.dropHeldReply()
    await expect(sending).resolves.toMatchObject({ outcome: 'sentOutcomeUnknown' })
    released.resolve(undefined)
    await staleRead
    expect(machine.requiresStatusRead).toBe(true)
    await expect(machine.send('G1 X20')).rejects.toThrow('machineStatusRequired')
    await machine.status()
    expect(machine.requiresStatusRead).toBe(false)
  })
  it('preserves unknown dispatch through missing audit and notification and retries accounting only', async () => {
    const { machine, server, append, notify, confirm } = await moonrakerTest()
    server.loseSendReply()
    let isWritable = false
    append.mockImplementation((entry) => {
      return !isWritable && entry.outcome === 'sentOutcomeUnknown'
        ? Promise.reject(new Error('diskFull'))
        : Promise.resolve()
    })
    notify.mockRejectedValue(new Error('surfaceClosed'))
    const result = await machine.send('G91\nG1 X1 F600\nG90')
    expect(result).toMatchObject({ outcome: 'sentOutcomeUnknown', logRecorded: false })
    expect(notify).toHaveBeenCalledWith('auditUnrecorded')
    expect(notify).toHaveBeenCalledWith('sentOutcomeUnknown')
    expect(
      append.mock.calls.some(([entry]) => entry.outcome === 'failed' || entry.outcome === 'sent'),
    ).toBe(false)
    expect(await result.retryAudit()).toBe(false)
    isWritable = true
    expect(await Promise.all([result.retryAudit(), result.retryAudit()])).toEqual([true, true])
    expect(machine.requiresStatusRead).toBe(true)
    expect(server.moonraker.result.status.toolhead.position[0]).toBe(11)
    expect(
      server.requests.filter((request) => request.path === '/printer/gcode/script'),
    ).toHaveLength(1)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('marks a timed-out dispatched send unknown and keeps Stop available', async () => {
    const { target, deps, server, append, notify } = await moonrakerTest()
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      policy: { ...deps.policy, requestDeadlineMs: 50 },
    })
    server.holdSend()
    await expect(machine.send('G1 X20')).resolves.toMatchObject({
      outcome: 'sentOutcomeUnknown',
      logRecorded: true,
    })
    expect(machine.requiresStatusRead).toBe(true)
    expect(notify).toHaveBeenCalledWith('sentOutcomeUnknown')
    expect(append.mock.calls.some(([entry]) => entry.outcome === 'failed')).toBe(false)
    await machine.stop()
    expect(machine.requiresStatusRead).toBe(true)
    expect(server.requests.at(-1)?.path).toBe('/printer/emergency_stop')
  })
  it('keeps a prewrite preparation failure failed without marking dispatch unknown', async () => {
    const { target, deps, append, server, notify } = await moonrakerTest()
    const transport = http(target)
    watchRequests(transport, (path) => {
      if (path === '/printer/gcode/script') throw new Error('preparationFailed')
    })
    const machine = createMoonrakerMachine(target, transport, deps)
    await expect(machine.send('G1 X20')).rejects.toThrow('preparationFailed')
    expect(machine.requiresStatusRead).toBe(false)
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
    expect(append).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'actuate', outcome: 'failed' }),
    )
    expect(notify).not.toHaveBeenCalled()
  })
  it('reads status without confirmation and sends exact approved bytes once', async () => {
    const { machine, confirm, server, append } = await moonrakerTest()

    const captured0 = await machine.status()
    expect(captured0.limits.feedMmMin).toBe(6000)
    expect(confirm).not.toHaveBeenCalled()
    const payload = 'G91\nG1 X1 F600\nG90'
    await machine.send('g091\nG01x+01 F0600 ; exact bytes\nG090')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm.mock.calls[0]?.[0]).toMatchObject({
      payload,
      target: { id: 'virtual', name: 'Simulator' },
    })
    expect(
      server.requests.filter((request) => request.path === '/printer/gcode/script'),
    ).toMatchObject([{ body: { script: payload }, hasKey: true }])
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ payload, outcome: 'sent' }))
  })
  it.each(['G01', 'g0001', 'M0104', 'm00104'])(
    'refuses canonical macro override %s before approval',
    async (command) => {
      const { machine, confirm, server } = await moonrakerTest()
      Object.assign(server.moonraker.result.status.configfile.settings, {
        [`gcode_macro ${command}`]: { rename_existing: `${command}.1` },
      })
      const parameter = command.toUpperCase().startsWith('G') ? 'X20' : 'S200'
      const payload = `${command.toUpperCase().startsWith('G') ? 'G1' : 'M104'} ${parameter}`
      await expect(machine.send(payload)).rejects.toThrow('unknownEffects')
      await expect(machine.send(`${command} ${parameter}`)).rejects.toThrow('unknownEffects')
      expect(confirm).not.toHaveBeenCalled()
      expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(
        false,
      )
    },
  )
  it.each(['G2', 'G3'])(
    'refuses %s that can exceed the Z cap in an unreported arc plane before approval',
    async (command) => {
      const { target, deps, server, confirm } = await moonrakerTest()
      const capped = {
        ...target,
        limits: {
          ...target.limits,
          travel: { ...limits.travel, max: { ...limits.travel.max, z: 12 } },
        },
      }
      const machine = createMoonrakerMachine(capped, http(capped), deps)
      await expect(machine.send(`${command} X10 Y10 I5 F600`)).rejects.toThrow('travelLimit')
      expect(confirm).not.toHaveBeenCalled()
      expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(
        false,
      )
    },
  )
  it('uses the active extruder cap and refuses unknown heater selection', async () => {
    const { machine, confirm, server } = await moonrakerTest()
    Object.assign(server.moonraker.result.status.configfile.settings, {
      extruder1: { max_temp: 180 },
    })
    Object.assign(server.moonraker.result.status.toolhead, { extruder: 'extruder1' })
    const active = await machine.status()
    expect(active.limits.extruder).toBe(179)
    await expect(machine.send('M104 S200')).rejects.toThrow('temperatureLimit')
    Object.assign(server.moonraker.result.status.toolhead, { extruder: 'unknown' })
    await expect(machine.send('M104 S150')).rejects.toThrow('unknownState')
    Object.assign(server.moonraker.result.status.toolhead, { extruder: undefined })
    await expect(machine.send('G1 X20')).rejects.toThrow()
    expect(confirm).not.toHaveBeenCalled()
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('bounds canonical and framed dispatch bytes before approval', async () => {
    const { target, server, deps, confirm } = await moonrakerTest()
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      policy: { ...deps.policy, gcode: { ...deps.policy.gcode, maxBytes: 8 } },
    })
    await expect(machine.send('G1X20F60')).rejects.toThrow('payloadSize')
    expect(confirm).not.toHaveBeenCalled()
    expect(server.requests).toEqual([])
  })
  it.each(['bytes', 'lines'])(
    'bounds the Marlin terminator against %s before approval',
    async (bound) => {
      const { deps, confirm } = dependencies(),
        { port, request } = grblPort()
      const machine = createMarlinMachine(record('/dev/test', 'marlin'), port, {
        ...deps,
        policy: {
          ...deps.policy,
          gcode: {
            ...deps.policy.gcode,
            ...(bound === 'bytes' ? { maxBytes: 4 } : { maxLines: 1 }),
          },
        },
      })
      await expect(machine.send('M105')).rejects.toThrow('payloadSize')
      expect(confirm).not.toHaveBeenCalled()
      expect(request).not.toHaveBeenCalled()
    },
  )
  it('asks again when equal-cap active extruders change during approval', async () => {
    const { machine, confirm, server } = await moonrakerTest()
    Object.assign(server.moonraker.result.status.configfile.settings, {
      extruder1: { max_temp: 250 },
    })
    confirm.mockImplementation((request) => {
      Object.assign(server.moonraker.result.status.toolhead, { extruder: 'extruder1' })
      return Promise.resolve(answer(request))
    })
    await machine.send('M104 S150')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[0]?.[0].id).not.toBe(confirm.mock.calls[1]?.[0].id)
  })
  it('refuses the newly selected lower-cap heater after approval without dispatch', async () => {
    const { machine, confirm, server } = await moonrakerTest()
    Object.assign(server.moonraker.result.status.configfile.settings, {
      extruder1: { max_temp: 180 },
    })
    confirm.mockImplementation((request) => {
      server.moonraker.result.status.toolhead.extruder = 'extruder1'
      return Promise.resolve(answer(request))
    })
    await expect(machine.send('M104 S200')).rejects.toThrow('temperatureLimit')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it.each(['expiry', 'elapsed', 'hardware', 'trust', 'lease', 'interactive', 'printing', 'stop'])(
    'rechecks %s after final secret lookup before dispatch',
    async (condition) => {
      const { target, deps, server, confirm } = await moonrakerTest()
      let now = 0
      let isEnabled = true,
        isTrusted = true,
        isHeld = true,
        isInteractive = true
      let isActuationLookup = false
      const secrets: MakerSecrets = {
        async get() {
          if (isActuationLookup) {
            isActuationLookup = false
            if (condition === 'elapsed') {
              await new Promise((resolve) => {
                setTimeout(resolve, 120)
              })
            } else if (condition === 'expiry') now = 1000
            isEnabled = condition !== 'hardware'
            isTrusted = condition !== 'trust'
            isHeld = condition !== 'lease'
            isInteractive = condition !== 'interactive'
            if (condition === 'printing')
              server.moonraker.result.status.print_stats.state = 'printing'
            else if (condition === 'stop') await machine.stop()
          }
          return undefined
        },
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      }
      const transport = new MachineHttp(target, localFakeLan, secrets, {
        timeoutMs: 1000,
        maxResponseBytes: 16_000,
      })
      watchRequests(transport, (path) => {
        isActuationLookup = path === '/printer/gcode/script'
      })
      const machine = createMoonrakerMachine(target, transport, {
        ...deps,
        isLeaseHeld: () => isHeld,
        policy: {
          ...deps.policy,
          now: () => now,
          approvalTtlMs: condition === 'elapsed' ? 100 : 1000,
        },
        host: {
          ...deps.host,
          hardwareEnabled: () => isEnabled,
          isTrusted: () => isTrusted,
          isInteractive: () => isInteractive,
        },
      })
      await expect(machine.send('M104 S200')).rejects.toThrow()
      expect(confirm).toHaveBeenCalledTimes(1)
      expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(
        false,
      )
    },
  )
  it('reads changed machine state after actuation DNS resolution and asks again', async () => {
    const { target, deps, server, confirm } = await moonrakerTest()
    const named = { ...target, endpoint: server.endpoint.replace('127.0.0.1', 'printer.local') }
    let isActuationLookup = false,
      didChange = false
    const lan: MakerLanPolicy = {
      classify: () => 'private',
      async resolve() {
        if (isActuationLookup && !didChange) {
          didChange = true
          server.moonraker.result.status.toolhead.position[0] = 11
          server.moonraker.result.status.gcode_move.position[0] = 11
          server.moonraker.result.status.gcode_move.gcode_position[0] = 11
          await Promise.resolve()
        }
        return ['127.0.0.1']
      },
    }
    const transport = http(named, lan)
    watchRequests(transport, (path) => {
      isActuationLookup = path === '/printer/gcode/script'
    })
    await createMoonrakerMachine(named, transport, deps).send('G1 X20')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(
      server.requests.filter((request) => request.path === '/printer/gcode/script'),
    ).toHaveLength(1)
  })
  it('reads final machine state after observation-log persistence settles', async () => {
    const { machine, server, append, confirm } = await moonrakerTest()
    let observations = 0
    append.mockImplementation(async (entry) => {
      if (entry.action !== 'observe') return
      observations += 1
      if (observations !== 2) return
      await Promise.resolve()
      server.moonraker.result.status.print_stats.state = 'printing'
    })
    await expect(machine.send('M104 S200')).rejects.toThrow('machineBusy')
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it.each([
    'G1 X201',
    'G1 F1201',
    'M104 S241',
    'M500',
    'M502',
    'M997',
    'PAUSE',
    'CANCEL_PRINT',
    'CUSTOM X=1',
    'G1 E1',
  ])('refuses before the modal: %s', async (payload) => {
    const { machine, confirm, server } = await moonrakerTest()
    await expect(machine.send(payload)).rejects.toThrow()
    expect(confirm).not.toHaveBeenCalled()
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('refuses unhomed motion, ongoing prints and transformed coordinates', async () => {
    const { machine, server, confirm } = await moonrakerTest()
    server.moonraker.result.status.toolhead.homed_axes = ''
    await expect(machine.send('G1 X20')).rejects.toThrow('unhomed')
    server.moonraker.result.status.toolhead.homed_axes = 'xyz'
    server.moonraker.result.status.print_stats.state = 'printing'
    await expect(machine.send('G1 X20')).rejects.toThrow('machineBusy')
    server.moonraker.result.status.print_stats.state = 'standby'
    server.moonraker.result.status.gcode_move.homing_origin[0] = 10
    await expect(machine.send('G1 X20')).rejects.toThrow('unknownState')
    expect(confirm).not.toHaveBeenCalled()
  })
  it('converts inherited Klipper speeds from mm/s and never invents missing travel bounds', async () => {
    const { machine, server, confirm } = await moonrakerTest()
    server.moonraker.result.status.gcode_move.speed = 40
    await expect(machine.send('G1 X20')).rejects.toThrow('feedLimit')
    const settings = server.moonraker.result.status.configfile.settings
    Object.assign(settings, { stepper_x: { position_max: 200 } })
    await expect(machine.status()).rejects.toThrow()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('bounds repeatedly changing state and refuses concurrent sends', async () => {
    const { machine, confirm, server } = await moonrakerTest()
    let count = 0
    confirm.mockImplementation((request) => {
      Object.assign(server.moonraker.result.status.configfile.settings, { sequence: ++count })
      return Promise.resolve(answer(request))
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('machineStateChanged')
    expect(confirm).toHaveBeenCalledTimes(3)
    const modal = Promise.withResolvers<unknown>()
    confirm.mockReturnValue(modal.promise)
    const first = captureFailure(machine.send('G1 X20'))
    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(4)
    })
    const second = captureFailure(machine.send('G1 X20'))
    modal.resolve({ decision: 'reject' })
    expect(await second).toMatchObject({ code: 'machineBusy' })
    expect(await first).toBeInstanceOf(Error)
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('refuses unknown machine limits and unknown user limits', async () => {
    const { server, deps, confirm, target } = await moonrakerTest()
    const noLimits = { ...target, limits: {} }
    await expect(
      createMoonrakerMachine(noLimits, http(noLimits), deps).send('G1 X20'),
    ).rejects.toThrow('unknownLimits')
    server.reply({ status: 200, body: '{"result":{"status":{}}}' })
    await expect(
      createMoonrakerMachine(target, http(target), deps).send('G1 X20'),
    ).rejects.toThrow()
    expect(confirm).not.toHaveBeenCalled()
  })
  it.each(['untrusted', 'disabled', 'unattended', 'cnc', 'laser', 'robot'])(
    'refuses %s before any device access',
    async (condition) => {
      const { target, server, deps, confirm } = await moonrakerTest()
      const host = {
        ...deps.host,
        isTrusted: () => condition !== 'untrusted',
        hardwareEnabled: () => condition !== 'disabled',
        isInteractive: () => condition !== 'unattended',
      }
      const categories: Readonly<Record<string, MachineRecord['category']>> = {
        cnc: 'cnc',
        laser: 'laser',
        robot: 'robot',
      }
      const category = categories[condition] ?? 'printer'
      await expect(
        createMoonrakerMachine({ ...target, category }, http(target), { ...deps, host }).send(
          'G1 X20',
        ),
      ).rejects.toThrow()
      expect(server.requests).toEqual([])
      expect(confirm).not.toHaveBeenCalled()
    },
  )
  it.each(['id', 'digest', 'identity', 'decision', 'reject', 'token', 'confirm'])(
    'refuses forged %s approval',
    async (field) => {
      const { machine, confirm, server } = await moonrakerTest()
      confirm.mockImplementation((request) => {
        const fields: Record<string, unknown> = {
          id: 'old',
          digest: 'wrong',
          identity: 'different',
          decision: 'always',
          reject: 'reject',
          token: true,
          confirm: true,
        }
        const keys: Readonly<Record<string, string>> = {
          identity: 'target',
          reject: 'decision',
        }
        const key = keys[field] ?? field
        return Promise.resolve({ ...answer(request), [key]: fields[field] })
      })
      await expect(machine.send('G1 X20')).rejects.toThrow('approvalRejected')
      expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(
        false,
      )
    },
  )
  it('expires a modal, including one that never answers', async () => {
    const { target, deps, server, confirm } = await moonrakerTest()
    let now = 0
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      policy: { ...deps.policy, now: () => now, approvalTtlMs: 20 },
    })
    confirm.mockImplementation((request) => {
      now = request.expiresAt
      return Promise.resolve(answer(request))
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('approvalRejected')
    confirm.mockImplementation(() => new Promise(() => undefined))
    await expect(machine.send('G1 X20')).rejects.toThrow('machineDeadline')
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('asks again when identity or machine state changes and never reuses a grant', async () => {
    const { machine, confirm, server } = await moonrakerTest()
    confirm.mockImplementation((request) => {
      server.changeIdentity()
      return Promise.resolve(answer(request))
    })
    await machine.send('G1 X20')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm.mock.calls[0]?.[0].id).not.toBe(confirm.mock.calls[1]?.[0].id)
    expect(
      server.requests.filter((request) => request.path === '/printer/gcode/script'),
    ).toHaveLength(1)
    const first = answer(confirm.mock.calls[0]![0])
    confirm.mockImplementation(() => Promise.resolve(first))
    await expect(machine.send('G1 X20')).rejects.toThrow('approvalRejected')
  })
  it('rechecks machine state after persisting the approval and guards macro overrides', async () => {
    const { machine, server, append, confirm } = await moonrakerTest()
    append.mockImplementation((entry) => {
      if (entry.action === 'actuate' && entry.outcome === 'attempt') server.changeIdentity()
      return Promise.resolve()
    })
    await machine.send('G1 X20')
    expect(confirm).toHaveBeenCalledTimes(2)
    Object.assign(server.moonraker.result.status.configfile.settings, {
      'gcode_macro G1': { rename_existing: 'G1.1' },
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('unknownEffects')
    expect(confirm).toHaveBeenCalledTimes(2)
  })
  it('revocation and expiry during audit persistence prevent dispatch', async () => {
    const { server, target, deps, append } = await moonrakerTest()
    let isEnabled = true
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      host: { ...deps.host, hardwareEnabled: () => isEnabled },
    })
    append.mockImplementation((entry) => {
      if (entry.action === 'actuate' && entry.outcome === 'attempt') isEnabled = false
      return Promise.resolve()
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('hardwareDisabled')
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('expires approval using elapsed time even when the wall clock does not advance', async () => {
    const { target, deps, server, append } = await moonrakerTest()
    append.mockImplementation(async (entry) => {
      if (entry.action === 'actuate' && entry.outcome === 'attempt')
        await new Promise((resolve) => {
          setTimeout(resolve, 30)
        })
    })
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      policy: { ...deps.policy, now: () => 0, approvalTtlMs: 20 },
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('approvalRejected')
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('refuses send without the cross-editor machine lease and stops without it', async () => {
    const { target, deps, confirm, server } = await moonrakerTest()
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      isLeaseHeld: () => false,
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('machineBusy')
    expect(confirm).not.toHaveBeenCalled()
    await machine.stop()
    expect(server.requests.at(-1)?.path).toBe('/printer/emergency_stop')
  })
  it('does not retarget a frozen transport or accept an adapter/transport mismatch', async () => {
    const { target, server, deps } = await moonrakerTest()
    const transport = http(target)
    const original = structuredClone(target)
    target.endpoint = 'http://8.8.8.8'
    expect(() => createMoonrakerMachine(target, transport, deps)).toThrow('machineTargetMismatch')
    const machine = createMoonrakerMachine(original, transport, deps)
    await machine.status()
    expect(server.requests).toHaveLength(2)
  })
  it('keeps registration snapshots immutable and rechecks the lease after approval', async () => {
    const { target, deps, server, confirm } = await moonrakerTest()
    let isHeld = true
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      isLeaseHeld: () => isHeld,
    })
    target.limits.feedMmMin = 10_000
    const snapshot = machine.record
    snapshot.category = 'cnc'
    snapshot.limits.feedMmMin = 10_000
    expect(machine.record.category).toBe('printer')
    expect(machine.record.limits.feedMmMin).toBe(1200)
    confirm.mockImplementation((request) => {
      isHeld = false
      return Promise.resolve(answer(request))
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('machineBusy')
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('fails closed when the audit log cannot persist the intent', async () => {
    const { machine, server, append } = await moonrakerTest()
    append.mockImplementation((entry) =>
      entry.action === 'actuate' && entry.outcome === 'attempt'
        ? Promise.reject(new Error('diskFull'))
        : Promise.resolve(),
    )
    await expect(machine.send('G1 X20')).rejects.toThrow('diskFull')
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('does not let a surface mutate the payload/identity being checked', async () => {
    const { machine, confirm, server } = await moonrakerTest()
    confirm.mockImplementation((request) => {
      Object.assign(request.target, { identity: 'forged' })
      return Promise.resolve(answer(request))
    })
    await expect(machine.send('G1 X20')).rejects.toThrow('approvalRejected')
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
})

describe('maker fixed Stop paths', () => {
  it('blocks pending-removal machine use while keeping the fixed Stop available', async () => {
    const { target, deps, server, confirm } = await moonrakerTest()
    const pending = { ...target, credentialPendingRemoval: true } as const
    const machine = createMoonrakerMachine(pending, http(pending), deps)
    await expect(machine.status()).rejects.toThrow('credentialPendingRemoval')
    await expect(machine.send('M104 S200')).rejects.toThrow('credentialPendingRemoval')
    expect(server.requests).toEqual([])
    await machine.stop()
    expect(server.requests.at(-1)?.path).toBe('/printer/emergency_stop')
    expect(confirm).not.toHaveBeenCalled()
  })
  it('stops a queued Moonraker send out of band, without consent or hardware enablement', async () => {
    const { target, deps, server, confirm } = await moonrakerTest()
    const host = { ...deps.host, hardwareEnabled: vi.fn(() => true) }
    const machine = createMoonrakerMachine(target, http(target), { ...deps, host })
    server.holdSend()
    const sending = machine.send('G1 X20')
    await vi.waitFor(() => {
      expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(true)
    })
    host.hardwareEnabled.mockReturnValue(false)
    const before = Date.now()
    const stopped = await machine.stop()
    expect(Date.now() - before).toBeLessThan(deps.policy.stopDeadlineMs)
    expect(stopped.logRecorded).toBe(true)
    expect(server.requests.at(-1)).toMatchObject({
      path: '/printer/emergency_stop',
      method: 'POST',
      body: null,
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    const captured1 = await sending
    expect(captured1).toMatchObject({ outcome: 'sentOutcomeUnknown', logRecorded: true })
    expect(machine.requiresStatusRead).toBe(true)
  })
  it('records a failed Stop and bounds hung post-dispatch logging', async () => {
    const { target, deps, server, append } = await moonrakerTest()
    const machine = createMoonrakerMachine(target, http(target), {
      ...deps,
      policy: { ...deps.policy, requestDeadlineMs: 20 },
    })
    server.reply({ status: 500, body: '{}' })
    await expect(machine.stop()).rejects.toThrow('machineHttpStatus')
    expect(append).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'stop', outcome: 'failed' }),
    )
    server.reply(undefined)
    append.mockImplementation(() => new Promise(() => undefined))
    const stopped = await machine.stop()
    expect(stopped.logRecorded).toBe(false)
    expect(server.requests.at(-1)?.path).toBe('/printer/emergency_stop')
  })
  it('invalidates an unanswered approval even when its log is healthy', async () => {
    const { machine, server, confirm } = await moonrakerTest()
    const modal = Promise.withResolvers<unknown>()
    confirm.mockReturnValue(modal.promise)
    const sending = captureFailure(machine.send('G1 X20'))
    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(1)
    })
    await machine.stop()
    modal.resolve(answer(confirm.mock.calls[0]![0]))
    const error = await sending
    expect(error).toMatchObject({ code: 'machineStopped' })
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
  it('still stops when logging fails, and invalidates an unanswered approval', async () => {
    const { machine, server, confirm, append } = await moonrakerTest()
    const approval = Promise.withResolvers<unknown>()
    confirm.mockReturnValue(approval.promise)
    const sending = captureFailure(machine.send('G1 X20'))
    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(1)
    })
    append.mockRejectedValue(new Error('diskFull'))

    const captured2 = await machine.stop()
    expect(captured2.logRecorded).toBe(false)
    approval.resolve(answer(confirm.mock.calls[0]![0]))
    const captured3 = await sending
    expect(captured3).toBeInstanceOf(Error)
    expect(server.requests.some((request) => request.path === '/printer/gcode/script')).toBe(false)
  })
})

function grblPort() {
  const request = vi.fn((command: string) => {
    const replies: Record<string, string> = {
      '?': '<Idle|MPos:-10,-20,-5|FS:0,0>',
      $$: '$20=1\n$22=1\n$110=1000\n$111=1000\n$112=500\n$130=200\n$131=200\n$132=100',
      $I: '[VER:1.1h]',
    }
    return Promise.resolve(replies[command] ?? '$N0=G1X10\n$N1=')
  })
  const realtime = vi.fn(() => Promise.resolve())
  const send = vi.fn<SerialMachinePort['send']>(async (_bytes, signal, beforeWrite) => {
    const check = await beforeWrite()
    signal.throwIfAborted()
    check()
  })
  const port: SerialMachinePort = {
    request,
    realtime,
    send,
    cancel: vi.fn(),
  }
  return { port, request, realtime, send }
}

describe('maker other firmware adapters', () => {
  const telemetry: PrinterTelemetry = {
    read: () =>
      Promise.resolve({
        identity: 'firmware',
        state: 'ready',
        isHomed: true,
        limits,
        gcode: { position: { x: 10, y: 10, z: 10 }, absolute: true, unit: 'mm', feedMmMin: 600 },
      }),
  }
  it('preserves serial dispatch uncertainty after a write loses its acknowledgement', async () => {
    const { port, request, send } = grblPort()
    const { deps, append, notify } = dependencies()
    request.mockImplementation((command) =>
      Promise.resolve(command === 'M115' ? 'FIRMWARE_NAME:Marlin' : 'echo: M203 X100 Y100 Z10'),
    )
    send.mockImplementation(async (_bytes, _signal, beforeWrite) => {
      const check = await beforeWrite()
      check()
      throw new Error('ackLost')
    })
    const machine = createMarlinMachine(record('/dev/test', 'marlin'), port, deps, telemetry)
    await expect(machine.send('G91\nG1 X1 F600\nG90')).resolves.toMatchObject({
      outcome: 'sentOutcomeUnknown',
    })
    expect(machine.requiresStatusRead).toBe(true)
    await expect(machine.send('G1 X20')).rejects.toThrow('machineStatusRequired')
    expect(send).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('sentOutcomeUnknown')
    expect(append).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: 'sentOutcomeUnknown' }),
    )
  })
  it('prevents a timed-out Marlin queue from writing later even when the port ignores abort', async () => {
    const { port, request, send } = grblPort(),
      { deps } = dependencies()
    request.mockImplementation((command) =>
      Promise.resolve(command === 'M115' ? 'FIRMWARE_NAME:Marlin' : 'echo: M203 X100 Y100 Z10'),
    )
    const finished = Promise.withResolvers<undefined>()
    let didWrite = false
    send.mockImplementation(async (_bytes, _signal, beforeWrite) => {
      try {
        await new Promise((resolve) => {
          setTimeout(resolve, 80)
        })
        const check = await beforeWrite()
        check()
        didWrite = true
      } finally {
        finished.resolve(undefined)
      }
    })
    const machine = createMarlinMachine(
      record('/dev/test', 'marlin'),
      port,
      {
        ...deps,
        policy: { ...deps.policy, requestDeadlineMs: 40 },
      },
      telemetry,
    )
    await expect(machine.send('M104 S200')).rejects.toThrow('machineDeadline')
    await finished.promise
    expect(didWrite).toBe(false)
  })
  it.each(['hardware', 'lease', 'expiry', 'printing'])(
    'Marlin rechecks %s after the serial queue and before writing',
    async (condition) => {
      const { port, request, send } = grblPort(),
        { deps } = dependencies()
      request.mockImplementation((command) =>
        Promise.resolve(command === 'M115' ? 'FIRMWARE_NAME:Marlin' : 'echo: M203 X100 Y100 Z10'),
      )
      let isEnabled = true,
        isHeld = true,
        now = 0
      let state = 'ready'
      let didWrite = false
      send.mockImplementation(async (_bytes, _signal, beforeWrite) => {
        await Promise.resolve()
        isEnabled = condition !== 'hardware'
        isHeld = condition !== 'lease'
        now = condition === 'expiry' ? 1000 : 0
        state = condition === 'printing' ? 'printing' : 'ready'
        const check = await beforeWrite()
        check()
        didWrite = true
      })
      const machine = createMarlinMachine(
        record('/dev/test', 'marlin'),
        port,
        {
          ...deps,
          isLeaseHeld: () => isHeld,
          host: { ...deps.host, hardwareEnabled: () => isEnabled },
          policy: { ...deps.policy, now: () => now },
        },
        {
          read: async (signal) => {
            const current = await telemetry.read(signal)
            return { ...current, state }
          },
        },
      )
      const codes: Readonly<Record<string, string>> = {
        hardware: 'hardwareDisabled',
        lease: 'machineBusy',
        expiry: 'approvalRejected',
        printing: 'machineBusy',
      }
      await expect(machine.send('M104 S200')).rejects.toThrow(codes[condition])
      expect(didWrite).toBe(false)
    },
  )
  it('OctoPrint rechecks hardware after its actuation credential lookup', async () => {
    const server = await fakeMachineServer()
    closers.push(server.close)
    const target = record(server.endpoint, 'octoprint'),
      { deps } = dependencies()
    let isEnabled = true,
      isActuationLookup = false
    const transport = new MachineHttp(
      target,
      localFakeLan,
      {
        get: () => {
          if (isActuationLookup) isEnabled = false
          return Promise.resolve(undefined)
        },
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      },
      { timeoutMs: 1000, maxResponseBytes: 16_000 },
    )
    watchRequests(transport, (path) => {
      isActuationLookup = path === '/api/printer/command'
    })
    const machine = createOctoprintMachine(
      target,
      transport,
      { ...deps, host: { ...deps.host, hardwareEnabled: () => isEnabled } },
      telemetry,
    )
    await expect(machine.send('M104 S200')).rejects.toThrow('hardwareDisabled')
    expect(server.requests.some((request) => request.path === '/api/printer/command')).toBe(false)
  })
  it('parses actual Moonraker and OctoPrint Virtual Printer captures without fabricating limits', async () => {
    const { server, machine } = await moonrakerTest()
    Object.assign(server.moonraker, moonrakerCapture)
    const status = await machine.status()
    expect(status.isHomed).toBe(false)
    expect(status.state).toBe(moonrakerCapture.result.status.webhooks.state)
    expect(marlinFeedLimit(octoprintCapture.M503)).toEqual({ feedMmMin: 300 })
    const { port, request } = grblPort(),
      { deps } = dependencies()
    request.mockImplementation((command) =>
      Promise.resolve(command === 'M115' ? octoprintCapture.M115 : octoprintCapture.M503),
    )
    const virtual = createMarlinMachine(record('/dev/test', 'marlin'), port, deps)
    const printer = await virtual.status()
    expect(printer.warnings).toEqual([])
    expect(printer.limits).toEqual({ feedMmMin: 300 })
    await expect(virtual.send('G1 X1')).rejects.toThrow('machineBusy')
    await virtual.stop()
  })
  it('OctoPrint refuses firmware busy state even when REST says operational', async () => {
    const server = await fakeMachineServer()
    closers.push(server.close)
    const target = record(server.endpoint, 'octoprint'),
      { deps, confirm } = dependencies()
    const busy: PrinterTelemetry = {
      read: async (signal) => ({ ...(await telemetry.read(signal)), state: 'printing' }),
    }
    const machine = createOctoprintMachine(target, http(target), deps, busy)
    await expect(machine.send('G1 X20')).rejects.toThrow('machineBusy')
    expect(confirm).not.toHaveBeenCalled()
  })
  it('OctoPrint needs firmware telemetry, sends after approval and uses emergency M112', async () => {
    const server = await fakeMachineServer()
    closers.push(server.close)
    const target = record(server.endpoint, 'octoprint'),
      { deps, confirm } = dependencies()
    const readOnly = createOctoprintMachine(target, http(target), deps)

    const captured4 = await readOnly.status()
    expect(captured4.isHomed).toBe(false)
    await expect(readOnly.send('G1 X20')).rejects.toThrow('unknownState')
    expect(confirm).not.toHaveBeenCalled()
    const machine = createOctoprintMachine(target, http(target), deps, telemetry)
    await machine.send('G1 X20\nM105')
    await machine.stop()
    expect(
      server.requests
        .filter((request) => request.path === '/api/printer/command')
        .map((request) => request.body),
    ).toEqual([{ commands: ['G1 X20', 'M105'] }, { commands: ['M112'] }])
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('parses actual GRBL simulator check-mode captures and keeps disabled limits unhomed', async () => {
    const { port, request, realtime } = grblPort(),
      { deps } = dependencies()
    const frames: Readonly<Record<string, string>> = {
      '?': grblCapture.status,
      $$: grblCapture.settings,
      $I: grblCapture.identity,
      $N: grblCapture.startupLines,
    }
    request.mockImplementation((command) => Promise.resolve(frames[command] ?? ''))
    const machine = createGrblMachine(
      { ...record('/dev/test', 'grbl'), category: 'cnc' },
      port,
      deps,
    )
    const status = await machine.status()
    expect(status.state).toBe('Idle')
    expect(status.isHomed).toBe(false)
    expect(status.warnings).toEqual([])
    expect(status.limits.feedMmMin).toBe(500)
    expect(grblCapture.checkMode).toContain('[MSG:Enabled]')
    expect(grblCapture.checkMove.trim()).toBe('ok')
    await machine.stop()
    expect(realtime).toHaveBeenCalledWith(Buffer.from([0x21, 0x85, 0x18]), expect.any(AbortSignal))
    expect(grblCapture.stop).toContain('Grbl 1.1h')
  })
  it('GRBL parses status/settings, warns on startup motion and sends ordered stop bytes', async () => {
    const { port, realtime } = grblPort(),
      { deps, confirm } = dependencies()
    const machine = createGrblMachine(
      { ...record('/dev/test', 'grbl'), category: 'cnc' },
      port,
      deps,
    )
    const status = await machine.status()
    expect(status).toMatchObject({
      isHomed: true,
      limits: { feedMmMin: 500 },
      warnings: ['startupMotion'],
    })
    await expect(machine.send('G1 X1')).rejects.toThrow('readOnlyMachine')
    await machine.stop()
    expect(realtime).toHaveBeenCalledWith(Buffer.from([0x21, 0x85, 0x18]), expect.any(AbortSignal))
    expect(confirm).not.toHaveBeenCalled()
    expect(() => parseGrblReport('<Idle|MPos:bad,0,0>', '')).toThrow('grblStatus')
    expect(() => parseGrblReport('<Idle|MPos:.,0,0>', '')).toThrow('grblStatus')
    expect(() => parseGrblReport('<Idle|MPos:0,0,0>', '$20=' + '1'.repeat(400))).toThrow(
      'grblSettings',
    )
    expect(() => parseGrblReport('<Idle|MPos:0,0,0>', '$20=1\n$20=0')).toThrow('grblSettings')
  })
  it('headless serial status cannot open or read a port', async () => {
    const { port, request } = grblPort(),
      { deps } = dependencies()
    const machine = createGrblMachine({ ...record('/dev/test', 'grbl'), category: 'cnc' }, port, {
      ...deps,
      host: { ...deps.host, isInteractive: () => false },
    })
    await expect(machine.status()).rejects.toThrow('unattendedHardware')
    expect(request).not.toHaveBeenCalled()
  })
  it('FluidNC without soft limits and GRBL in alarm never report homed', async () => {
    const { port, request } = grblPort(),
      { deps } = dependencies()
    request.mockImplementation((command) =>
      Promise.resolve(command === '?' ? '<Alarm|MPos:0,0,0>' : '$20=1\n$22=1'),
    )

    const captured5 = await createGrblMachine(
      { ...record('/dev/test', 'grbl'), category: 'cnc' },
      port,
      deps,
    ).status()
    expect(captured5.isHomed).toBe(false)
    const axis = { max_travel_mm: 200, max_rate_mm_per_min: 1000, soft_limits: false }
    const machine = createGrblMachine(
      { ...record('/dev/test', 'fluidnc'), category: 'laser' },
      port,
      deps,
      { read: () => Promise.resolve({ axes: { x: axis, y: axis, z: axis } }) },
    )

    const captured6 = await machine.status()
    expect(captured6.isHomed).toBe(false)
    await expect(machine.send('M3 S1000')).rejects.toThrow('readOnlyMachine')
  })
  it('Stop survives a broken stream cancellation and warns on unknown startup lines', async () => {
    const { port, realtime } = grblPort(),
      { deps, notify } = dependencies()
    port.cancel = () => {
      throw new Error('brokenCancel')
    }
    const machine = createGrblMachine(
      { ...record('/dev/test', 'grbl'), category: 'cnc' },
      port,
      deps,
    )
    await machine.stop()
    expect(realtime).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('startupMotion')
  })
  it('bounds an unresponsive serial Stop and records failure after sending the fixed bytes', async () => {
    const { port, realtime } = grblPort(),
      { deps, append } = dependencies()
    realtime.mockImplementation(() => new Promise(() => undefined))
    const machine = createGrblMachine({ ...record('/dev/test', 'grbl'), category: 'cnc' }, port, {
      ...deps,
      policy: { ...deps.policy, stopDeadlineMs: 20 },
    })
    await expect(machine.stop()).rejects.toThrow('machineDeadline')
    expect(realtime).toHaveBeenCalledWith(Buffer.from([0x21, 0x85, 0x18]), expect.any(AbortSignal))
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'stop', outcome: 'failed' }),
    )
  })
  it('Marlin warns without EMERGENCY_PARSER and sends M112 without asking', async () => {
    const { port, request, realtime } = grblPort(),
      { deps, notify, confirm } = dependencies()
    request.mockImplementation((command) =>
      Promise.resolve(
        command === 'M115'
          ? 'FIRMWARE_NAME:Marlin\nCap:EMERGENCY_PARSER:0'
          : 'echo: M203 X100 Y100 Z10 E25',
      ),
    )
    const machine = createMarlinMachine(record('/dev/test', 'marlin'), port, deps, telemetry)

    const captured7 = await machine.status()
    expect(captured7.warnings).toContain('physicalStopRequired')
    expect(marlinFeedLimit('echo: M203 X100 Y100 Z10 E25')).toEqual({ feedMmMin: 600 })
    await machine.send('M105')
    await machine.stop()
    expect(notify).toHaveBeenCalledWith('physicalStopRequired')
    expect(realtime).toHaveBeenCalledWith(Buffer.from('M112\n'), expect.any(AbortSignal))
    expect(confirm).toHaveBeenCalledTimes(1)
  })
  it('PrusaLink reports status and explicitly refuses unavailable controls', async () => {
    const { deps, confirm } = dependencies()
    const machine = createPrusalinkMachine(
      record('https://printer.local', 'prusalink'),
      {
        get: (path) =>
          Promise.resolve(
            path.endsWith('info')
              ? { name: 'virtual', serial: 'fake' }
              : { printer: { state: 'IDLE' } },
          ),
      },
      deps,
    )

    const captured8 = await machine.status()
    expect(captured8.state).toBe('IDLE')
    await expect(machine.send('M105')).rejects.toThrow('readOnlyMachine')
    await expect(machine.stop()).rejects.toThrow('physicalStopRequired')
    expect(confirm).not.toHaveBeenCalled()
  })
})

describe('maker LAN and HTTP boundaries', () => {
  it.each(['public', 'loopback', 'linkLocal', 'metadata', 'reserved'] as const)(
    'refuses a %s address and mixed DNS answers',
    async (classification) => {
      const lan: MakerLanPolicy = {
        classify: (address) => (address === '192.168.1.1' ? 'private' : classification),
        resolve: () => Promise.resolve(['192.168.1.1', '203.0.113.1']),
      }
      await expect(machineTarget(record('https://printer.local'), lan)).rejects.toThrow(
        'machineAddress',
      )
    },
  )
  it('rechecks DNS on every request and never follows redirects', async () => {
    const { server, target, deps } = await moonrakerTest()
    const resolve = vi.fn(() => Promise.resolve(['127.0.0.1']))
    const lan: MakerLanPolicy = {
      resolve,
      classify: (address) => (address === '127.0.0.1' ? 'private' : 'public'),
    }
    const named = { ...target, endpoint: server.endpoint.replace('127.0.0.1', 'printer.local') }
    const machine = createMoonrakerMachine(named, http(named, lan), deps)
    await machine.status()
    resolve.mockResolvedValue(['8.8.8.8'])
    await expect(machine.status()).rejects.toThrow('machineAddress')
    server.reply({ status: 302, body: '', headers: { location: 'http://8.8.8.8/' } })
    await expect(http(target).request('GET', '/printer/info')).rejects.toThrow('machineHttpStatus')
  })
  it('refuses a private DNS retarget before reading or sending to another machine', async () => {
    const { target, server, deps } = await moonrakerTest()
    const resolve = vi.fn(() => Promise.resolve(['127.0.0.1']))
    const named = { ...target, endpoint: server.endpoint.replace('127.0.0.1', 'printer.local') }
    const transport = http(named, { classify: () => 'private', resolve })
    const machine = createMoonrakerMachine(named, transport, deps)
    await machine.status()
    resolve.mockResolvedValue(['10.0.0.2'])
    await expect(machine.status()).rejects.toThrow('machineAddressChanged')
    expect(server.requests).toHaveLength(2)
  })
  it('refuses nonlocal HTTP paths before any request', async () => {
    const { target, server } = await moonrakerTest()
    for (const remote of [
      'https://8.8.8.8',
      '//8.8.8.8',
      '/printer/info#fragment',
      '/x\r\nHost: example',
    ])
      await expect(http(target).request('GET', remote)).rejects.toThrow('machinePath')
    expect(server.requests).toEqual([])
  })
  it('validates HTTP object/no-content envelopes before returning a reply', async () => {
    const { target, server } = await moonrakerTest()
    for (const body of ['[]', '"ok"', '1']) {
      server.reply({ status: 200, body })
      await expect(http(target).request('GET', '/printer/info')).rejects.toThrow('machineResponse')
    }
  })
  it('requires the registered HTTP warning, rejects URL credentials and bounds response bodies', async () => {
    const { target, server } = await moonrakerTest()
    await expect(machineTarget({ ...target, allowPlainHttp: false }, localFakeLan)).rejects.toThrow(
      'plainHttpWarningRequired',
    )
    await expect(
      machineTarget({ ...target, endpoint: 'https://user:password@printer.local' }, localFakeLan),
    ).rejects.toThrow('machineEndpoint')
    server.reply({ status: 200, body: JSON.stringify({ value: 'x'.repeat(17_000) }) })
    await expect(http(target).request('GET', '/printer/info')).rejects.toThrow('machineTransport')
    server.reply({ status: 200, body: '{"result":' })
    await expect(http(target).request('GET', '/printer/info')).rejects.toThrow('machineResponse')
  })
})
