import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ideMakerTools, type IdeMakerToolsDeps } from '../../src/host/ide/makerTools'
import { MAKER_HOST_MODEL_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

function harness() {
  const state = {
    isTrusted: true,
    isHardware: true,
    isInteractive: true,
    canUseTools: true,
    hasMachines: true,
  }
  const result = { v: 1, type: 'makerResult', id: randomUUID(), outcome: 'sent', message: 'sent' }
  const deps: IdeMakerToolsDeps = {
    host: {
      isTrusted: () => state.isTrusted,
      hardwareEnabled: () => state.isHardware,
      isInteractive: () => state.isInteractive,
      notify: vi
        .fn<NonNullable<IdeMakerToolsDeps['host']['notify']>>()
        .mockResolvedValue(undefined),
    },
    canUseTools: () => state.canUseTools,
    hasMachines: () => state.hasMachines,
    action: vi.fn<IdeMakerToolsDeps['action']>().mockResolvedValue(result),
    listDevices: vi.fn<IdeMakerToolsDeps['listDevices']>().mockResolvedValue({
      v: 1,
      type: 'makerState',
      isTrusted: true,
      hardwareEnabled: true,
      isInteractive: true,
      machines: [],
      ports: [],
    }),
    stop: vi.fn<IdeMakerToolsDeps['stop']>().mockResolvedValue(undefined),
  }
  const tools = ideMakerTools(deps)
  const call = async (
    name: string,
    args: Readonly<Record<string, unknown>>,
    signal = new AbortController().signal,
  ) => {
    const tool = tools.find((entry) => entry.name === name)
    if (tool === undefined) throw new Error('missing tool')
    return await tool.call(args, signal)
  }
  return { deps, state, tools, call, result }
}
const serial = {
  target: { kind: 'serial', port: '/dev/ttyACM0', vid: '303a', pid: '1001' },
  baud: 115_200,
  durationMs: 1000,
  dtr: false,
  rts: false,
}

afterEach(() => {
  setUiText(EN, 'en')
})

describe('ide maker tools', () => {
  it('keeps model-facing errors and Stop text English while the host display language changes', async () => {
    setUiText(
      {
        ...EN,
        makerHardwareDisabled: 'Matériel désactivé',
        makerStopMachine: 'Arrêter la machine',
      },
      'fr',
    )
    const { call, state } = harness()
    state.isHardware = false
    await expect(call('machine_send', { machineId: 'printer', payload: 'G1 X1' })).rejects.toThrow(
      MAKER_HOST_MODEL_TEXT.hardwareDisabled,
    )
    const result = await call('machine_stop', {})
    expect(result).toContain(MAKER_HOST_MODEL_TEXT.stopped)
    expect(result).not.toContain('Arrêter la machine')
  })
  it('offers six wrappers by tool capability and hardware state, retaining Stop for registered targets', () => {
    const { deps, state, tools } = harness()
    expect(tools.map((tool) => tool.name)).toEqual([
      'device_list',
      'serial_read',
      'serial_write',
      'machine_status',
      'machine_send',
      'machine_stop',
    ])
    state.isHardware = false
    expect(ideMakerTools(deps).map((tool) => tool.name)).toEqual(['machine_stop'])
    state.hasMachines = false
    expect(ideMakerTools(deps)).toEqual([])
    state.isHardware = true
    state.isTrusted = false
    expect(ideMakerTools(deps)).toEqual([])
    state.isTrusted = true
    state.canUseTools = false
    state.hasMachines = true
    expect(ideMakerTools(deps)).toEqual([])
    for (const tool of tools) expect(tool.inputSchema['additionalProperties']).toBe(false)
    expect(tools.find((tool) => tool.name === 'device_list')?.annotations).toEqual({
      readOnlyHint: true,
    })
    expect(tools.find((tool) => tool.name === 'machine_send')?.annotations).toBeUndefined()
  })
  it('mints fresh action ids and delegates exact bytes to protected operations only', async () => {
    const { deps, call } = harness()
    await call('serial_read', serial)
    await call('serial_write', { ...serial, payloadHex: '0047' })
    await call('machine_send', { machineId: 'printer', payload: 'G1 X1' })
    await call('machine_send', { machineId: 'printer', payload: 'G1 X1' })
    const inputs = vi.mocked(deps.action).mock.calls.map((call) => call[0])
    expect(inputs[0]).toMatchObject({
      ...serial,
      v: 1,
      type: 'makerSerial',
      operation: 'read',
      payloadHex: '',
    })
    expect(inputs[1]).toMatchObject({
      ...serial,
      v: 1,
      type: 'makerSerial',
      operation: 'write',
      payloadHex: '0047',
    })
    expect(inputs[2]).toMatchObject({
      v: 1,
      type: 'makerSend',
      machineId: 'printer',
      payload: 'G1 X1',
    })
    const ids = inputs.filter((input) => input.type !== 'makerStatus').map((input) => input.id)
    expect(new Set(ids).size).toBe(ids.length)
    await call('device_list', {})
    expect(deps.listDevices).toHaveBeenCalledOnce()
  })
  it.each(['confirm', 'token', 'approval', 'id', 'v', 'type', 'key', 'endpoint', 'operation'])(
    'rejects model-supplied %s rather than treating it as authority',
    async (field) => {
      const { deps, call } = harness()
      await expect(
        call('machine_send', { machineId: 'printer', payload: 'G1 X1', [field]: 'model-field' }),
      ).rejects.toThrow()
      expect(deps.action).not.toHaveBeenCalled()
    },
  )
  it.each(['payloadHex', 'id', 'operation', 'confirm'])(
    'rejects extra serial-read %s',
    async (field) => {
      const { deps, call } = harness()
      await expect(call('serial_read', { ...serial, [field]: '0047' })).rejects.toThrow()
      expect(deps.action).not.toHaveBeenCalled()
    },
  )
  it('rejects malformed identity, bounds, bytes, extra device fields and arbitrary Stop payloads', async () => {
    const { deps, call } = harness()
    for (const args of [
      { ...serial, baud: 0, payloadHex: '' },
      { ...serial, durationMs: 0, payloadHex: '' },
      { ...serial, payloadHex: 'oops' },
      { ...serial, target: { ...serial.target, vid: 'not-a-vid' }, payloadHex: '' },
    ])
      await expect(call('serial_write', args)).rejects.toThrow()
    await expect(call('machine_status', { machineId: '' })).rejects.toThrow()
    await expect(call('device_list', { port: 'device' })).rejects.toThrow()
    await expect(
      call('machine_stop', { machineId: 'printer', payload: 'G1 X100' }),
    ).rejects.toThrow()
    expect(deps.action).not.toHaveBeenCalled()
    expect(deps.stop).not.toHaveBeenCalled()
  })
  it.each(['trust', 'hardware', 'interactive', 'capability', 'abort'])(
    'rechecks %s at invocation',
    async (kind) => {
      const { deps, state, call } = harness()
      const controller = new AbortController()
      switch (kind) {
        case 'trust': {
          state.isTrusted = false
          break
        }
        case 'hardware': {
          state.isHardware = false
          break
        }
        case 'interactive': {
          state.isInteractive = false
          break
        }
        case 'capability': {
          state.canUseTools = false
          break
        }
        case 'abort': {
          controller.abort()
          break
        }
      }
      await expect(
        call('machine_send', { machineId: 'printer', payload: 'G1 X1' }, controller.signal),
      ).rejects.toThrow()
      if (kind !== 'interactive')
        await expect(call('device_list', {}, controller.signal)).rejects.toThrow()
      expect(deps.action).not.toHaveBeenCalled()
    },
  )
  it('allows HTTP observation unattended, and Stop through revoked state and an aborted caller signal', async () => {
    const { deps, state, call } = harness()
    state.isInteractive = false
    vi.mocked(deps.action).mockResolvedValue({
      v: 1,
      type: 'makerStatus',
      machineId: 'printer',
      status: {
        identity: 'printer',
        state: 'idle',
        isHomed: true,
        limits: {},
        blockedCommands: [],
        warnings: [],
      },
    })
    expect(await call('machine_status', { machineId: 'printer' })).toContain('idle')
    state.isTrusted = false
    state.isHardware = false
    state.canUseTools = false
    const controller = new AbortController()
    controller.abort()
    expect(await call('machine_stop', { machineId: 'printer' }, controller.signal)).toContain(
      'stopped',
    )
    await call('machine_stop', {})
    expect(deps.stop).toHaveBeenCalledWith('printer')
    expect(deps.stop).toHaveBeenCalledWith(undefined)
    expect(deps.host.notify).not.toHaveBeenCalled()
  })
  it.each(['sentOutcomeUnknown', 'sentWithUnrecordedAudit'])(
    'preserves %s including when the UI fails, without retrying dispatch',
    async (outcome) => {
      const { deps, call, result } = harness()
      vi.mocked(deps.action).mockResolvedValue({ ...result, outcome })
      vi.mocked(deps.host.notify).mockRejectedValue(new Error('UI down'))
      expect(await call('machine_send', { machineId: 'printer', payload: 'G1 X1' })).toContain(
        outcome,
      )
      expect(deps.host.notify).toHaveBeenCalledWith(
        outcome === 'sentOutcomeUnknown' ? 'sentOutcomeUnknown' : 'auditUnrecorded',
      )
      expect(deps.action).toHaveBeenCalledOnce()
    },
  )
  it.each(['sentOutcomeUnknown', 'sentWithUnrecordedAudit'])(
    'delivers %s while its passive notice remains undismissed, even after caller cancellation',
    async (outcome) => {
      const { deps, call, result } = harness()
      const toast = Promise.withResolvers<undefined>()
      vi.mocked(deps.host.notify).mockReturnValue(toast.promise)
      vi.mocked(deps.action).mockResolvedValue({ ...result, outcome })
      const controller = new AbortController()
      const pending = call(
        'machine_send',
        { machineId: 'printer', payload: 'G1 X1' },
        controller.signal,
      )
      const state = { settled: false }
      void pending.then(() => {
        state.settled = true
      })
      try {
        for (let tick = 0; tick < 10; tick += 1) await Promise.resolve()
        controller.abort()
        expect(state.settled).toBe(true)
        expect(await pending).toContain(outcome)
        expect(deps.action).toHaveBeenCalledOnce()
        expect(deps.host.notify).toHaveBeenCalledWith(
          outcome === 'sentOutcomeUnknown' ? 'sentOutcomeUnknown' : 'auditUnrecorded',
        )
      } finally {
        toast.resolve(undefined)
      }
    },
  )
  it('rejects refused, failed, malformed and unexpected engine replies', async () => {
    const { deps, call, result } = harness()
    for (const raw of [
      { ...result, outcome: 'refused', message: 'unsafe' },
      { ...result, outcome: 'failed' },
      { ...result, outcome: 'invented' },
      { ...result, key: randomUUID() },
      { v: 1, type: 'makerPreview', preview: { kind: 'payload', title: 'wrong', content: '' } },
    ]) {
      vi.mocked(deps.action).mockResolvedValue(raw)
      await expect(
        call('machine_send', { machineId: 'printer', payload: 'G1 X1' }),
      ).rejects.toThrow()
    }
  })
})
