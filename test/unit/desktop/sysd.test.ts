// Muse Desktop (M111, D91.5) lane ST1: the sysd client contract proves its
// frames. Every request encodes through its method's params schema and
// every response parses through its result schema; unknown fields, wrong
// shapes, id mismatches and error envelopes are all refused.

import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  appearanceOverrideSchema,
  settingsSystemPageIdSchema,
  APPEARANCE_OVERRIDE_DEFAULT,
} from '../../../src/shared/desktop/settings'
import {
  encodeSysdRequest,
  parseSysdResponse,
  SysdError,
  SYSD_ERROR_CODES,
  SYSD_METHOD_NAMES,
  SYSD_PROTOCOL_VERSION,
  type SysdMethod,
  type SysdParams,
  type SysdResult,
} from '../../../src/shared/desktop/sysd'

function roundTrip<M extends SysdMethod>(
  method: M,
  params: SysdParams<M>,
  result: SysdResult<M>,
): SysdResult<M> {
  const request = encodeSysdRequest('req-1', method, params)
  expect(request.method).toBe(method)
  return parseSysdResponse(method, 'req-1', {
    jsonrpc: '2.0',
    id: request.id,
    result,
  })
}

describe('sysd protocol version', () => {
  it('speaks version 1', () => {
    expect(SYSD_PROTOCOL_VERSION).toBe(1)
  })
})

describe('sysd state reads', () => {
  it('round-trips network state', () => {
    const state = roundTrip(
      'network.get',
      {},
      {
        wifiEnabled: true,
        wired: { connected: false },
        wifi: [
          { ssid: 'home', signalPercent: 80, secured: true, connected: true, autoconnect: true },
        ],
        vpn: [{ id: 'vpn-1', name: 'Office', state: 'disconnected' }],
      },
    )
    expect(state.wifi[0]?.ssid).toBe('home')
  })

  it('round-trips bluetooth state', () => {
    const state = roundTrip(
      'bluetooth.get',
      {},
      {
        enabled: true,
        devices: [
          {
            id: 'dev-1',
            name: 'Headphones',
            kind: 'audio',
            paired: true,
            connected: true,
            batteryPercent: 60,
          },
        ],
      },
    )
    expect(state.devices).toHaveLength(1)
  })

  it('round-trips cellular state without a modem', () => {
    const state = roundTrip(
      'cellular.get',
      {},
      {
        present: false,
        enabled: false,
        connected: false,
      },
    )
    expect(state.present).toBe(false)
  })

  it('round-trips sound state', () => {
    const state = roundTrip(
      'sound.get',
      {},
      {
        outputs: [
          { id: 'sink-1', name: 'Speakers', volumePercent: 40, muted: false, isDefault: true },
        ],
        inputs: [],
      },
    )
    expect(state.outputs[0]?.isDefault).toBe(true)
  })

  it('round-trips displays state', () => {
    const state = roundTrip(
      'displays.get',
      {},
      {
        outputs: [
          {
            id: 'out-1',
            name: 'Laptop panel',
            connected: true,
            enabled: true,
            primary: true,
            widthPx: 1920,
            heightPx: 1080,
            refreshMilliHz: 60_000,
            scalePercent: 100,
            brightnessPercent: 70,
            modes: [{ widthPx: 1920, heightPx: 1080, refreshMilliHz: 60_000 }],
          },
        ],
      },
    )
    expect(state.outputs[0]?.modes).toHaveLength(1)
  })

  it('round-trips power state', () => {
    const state = roundTrip(
      'power.get',
      {},
      {
        batteries: [{ percent: 55, state: 'discharging', minutesLeft: 120 }],
        profile: 'balanced',
        displayOffMinutes: 10,
        sleepMinutes: 30,
        onLidClose: 'sleep',
        onPowerButton: 'prompt',
      },
    )
    expect(state.profile).toBe('balanced')
  })

  it('round-trips printers state', () => {
    const state = roundTrip(
      'printers.get',
      {},
      {
        printers: [{ id: 'pr-1', name: 'Office', status: 'idle', isDefault: true }],
      },
    )
    expect(state.printers[0]?.status).toBe('idle')
  })

  it('round-trips storage state', () => {
    const state = roundTrip(
      'storage.get',
      {},
      {
        volumes: [
          {
            id: 'vol-1',
            name: 'System',
            sizeBytes: 512_000_000_000,
            usedBytes: 60_000_000_000,
            mountPoint: '/',
            removable: false,
            ejectable: false,
          },
        ],
      },
    )
    expect(state.volumes[0]?.sizeBytes).toBe(512_000_000_000)
  })

  it('round-trips date and time state', () => {
    const state = roundTrip(
      'datetime.get',
      {},
      {
        automatic: true,
        timezone: 'Europe/Berlin',
        zoneNames: ['Europe/Berlin', 'America/New_York'],
        nowUnixMs: 1_796_064_000_000,
      },
    )
    expect(state.zoneNames).toHaveLength(2)
  })

  it('round-trips locale state with OS-provided names', () => {
    const state = roundTrip(
      'locale.get',
      {},
      {
        language: 'de',
        region: 'de-DE',
        languages: [{ code: 'de', name: 'Deutsch' }],
        regions: [{ code: 'de-DE', name: 'Deutschland' }],
      },
    )
    expect(state.languages[0]?.name).toBe('Deutsch')
  })
})

describe('sysd mutations', () => {
  it('round-trips a wifi connect, a pairing and a printer add', () => {
    expect(
      roundTrip('network.connectWifi', { ssid: 'home', autoconnect: true }, { ok: true }),
    ).toEqual({
      ok: true,
    })
    expect(roundTrip('bluetooth.startPair', { id: 'dev-1' }, { passkey: '482916' }).passkey).toBe(
      '482916',
    )
    expect(roundTrip('printers.add', { uri: 'ipp://printer.local' }, { id: 'pr-2' }).id).toBe(
      'pr-2',
    )
  })

  it('refuses out-of-range params at encode time', () => {
    expect(() =>
      encodeSysdRequest('req-1', 'sound.setVolume', {
        id: 'sink-1',
        direction: 'output',
        volumePercent: 101,
      }),
    ).toThrow()
    expect(() => encodeSysdRequest('req-1', 'bluetooth.startPair', { id: '' })).toThrow()
  })

  it('refuses a passkey that is not six digits', () => {
    expect(() =>
      parseSysdResponse('bluetooth.startPair', 'req-1', {
        jsonrpc: '2.0',
        id: 'req-1',
        result: { passkey: '48291' },
      }),
    ).toThrow()
  })
})

describe('sysd frame strictness', () => {
  it('refuses unknown fields in a result', () => {
    expect(() =>
      parseSysdResponse('cellular.get', 'req-1', {
        jsonrpc: '2.0',
        id: 'req-1',
        result: { present: false, enabled: false, connected: false, imei: '1' },
      }),
    ).toThrow()
  })

  it('refuses another method’s result shape', () => {
    expect(() =>
      parseSysdResponse('network.get', 'req-1', {
        jsonrpc: '2.0',
        id: 'req-1',
        result: { outputs: [], inputs: [] },
      }),
    ).toThrow()
  })

  it('refuses a malformed envelope', () => {
    expect(() => parseSysdResponse('sound.get', 'req-1', { id: 'req-1', result: {} })).toThrow()
  })

  it('carries an error envelope’s code in a SysdError', () => {
    let caught: unknown
    try {
      parseSysdResponse('power.setProfile', 'req-1', {
        jsonrpc: '2.0',
        id: 'req-1',
        error: { code: SYSD_ERROR_CODES.denied, message: 'polkit refused' },
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SysdError)
    expect((caught as SysdError).code).toBe(SYSD_ERROR_CODES.denied)
  })

  it('refuses a response for another request id', () => {
    expect(() =>
      parseSysdResponse('storage.get', 'req-1', {
        jsonrpc: '2.0',
        id: 'req-2',
        result: { volumes: [] },
      }),
    ).toThrow(SysdError)
  })

  it('names every ST1 method', () => {
    expect(SYSD_METHOD_NAMES).toHaveLength(38)
    for (const name of SYSD_METHOD_NAMES) {
      expect(name).toMatch(
        /^(network|bluetooth|cellular|sound|displays|power|printers|storage|datetime|locale)\./,
      )
    }
  })
})

describe('settings page ids and appearance', () => {
  it('accepts the eleven system pages and refuses anything else', () => {
    expect(z.parse(settingsSystemPageIdSchema, 'network')).toBe('network')
    expect(() => z.parse(settingsSystemPageIdSchema, 'toolchains')).toThrow()
  })

  it('accepts the five appearance overrides with system as default', () => {
    expect(APPEARANCE_OVERRIDE_DEFAULT).toBe('system')
    expect(z.parse(appearanceOverrideSchema, 'hc-dark')).toBe('hc-dark')
    expect(() => z.parse(appearanceOverrideSchema, 'hc')).toThrow()
  })
})
