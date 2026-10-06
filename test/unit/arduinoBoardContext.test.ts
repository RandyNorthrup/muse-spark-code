import { describe, expect, it, vi } from 'vitest'
import { readArduinoSelection, type ArduinoApiSource } from '../../src/host/arduino/boardContext'

// Arduino IDE 2.3.10's bundled toApiPort shape (provider 0.1.2).
const port = {
  address: '/dev/cu.fixture',
  label: 'Fixture board',
  hardwareId: 'fixture',
  protocol: 'serial',
  protocolLabel: 'Serial Port',
  properties: { vid: '2e8a', pid: '000a', serialNumber: 'fixture' },
}
function provider(api: unknown, isActive = true) {
  const activate = vi.fn(() => Promise.resolve(api))
  const extension = { exports: api, isActive, activate }
  const source: ArduinoApiSource = { getExtension: vi.fn(() => extension) }
  return { source, extension, activate }
}

describe('Arduino IDE board selection', () => {
  it('leaves ordinary editors unchanged when the optional provider is absent', async () => {
    const getExtension = vi.fn(() => undefined)
    expect(await readArduinoSelection({ getExtension })).toBeUndefined()
    expect(getExtension).toHaveBeenCalledExactlyOnceWith('dankeboy36.vscode-arduino-api')
  })
  it('activates only an inactive provider and reads its selected board and port', async () => {
    const selection = { sketchPath: '/fixture/sketch', fqbn: 'rp2040:rp2040:rpipico', port }
    const { source, activate } = provider(selection, false)
    expect(await readArduinoSelection(source)).toEqual(selection)
    expect(activate).toHaveBeenCalledOnce()
  })
  it('reads getters afresh and returns a detached snapshot without unrelated fields', async () => {
    const state = { fqbn: 'arduino:avr:uno', port }
    const api = {
      get fqbn() {
        return state.fqbn
      },
      get port() {
        return state.port
      },
      compileSummary: { buildPath: '/unused' },
    }
    const { source, activate } = provider(api)
    const first = await readArduinoSelection(source)
    expect(first).toEqual({ fqbn: 'arduino:avr:uno', port })
    expect(first?.port).not.toBe(port)
    state.fqbn = 'arduino:avr:mega'
    state.port = { ...port, address: '/dev/cu.other' }
    expect(await readArduinoSelection(source)).toEqual(state)
    expect(first?.fqbn).toBe('arduino:avr:uno')
    expect(activate).not.toHaveBeenCalled()
  })
  it('preserves the IDE state with no sketch, board or port selected', async () => {
    expect(
      await readArduinoSelection(
        provider({ sketchPath: undefined, fqbn: undefined, port: undefined }).source,
      ),
    ).toEqual({ sketchPath: undefined, fqbn: undefined, port: undefined })
  })
  it.each([
    undefined,
    null,
    'wrong provider',
    { sketchPath: 1 },
    { fqbn: false },
    { port: { ...port, address: 1 } },
    { port: { ...port, properties: { vid: 1 } } },
    { port: { address: '/dev/cu.partial' } },
  ])('refuses malformed provider data: %j', async (api) => {
    await expect(readArduinoSelection(provider(api).source)).rejects.toThrow()
  })
  it('propagates provider failures rather than returning an empty success', async () => {
    const broken = provider({}, false)
    broken.activate.mockRejectedValueOnce(new Error('provider failed'))
    await expect(readArduinoSelection(broken.source)).rejects.toThrow('provider failed')
  })
})
