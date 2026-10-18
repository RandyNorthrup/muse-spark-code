// Whether Muse Voice may record on this editor's network (M56, PLAN.md
// D43): the socket reaches Meta direct, or not at all, when the editor does
// not route it through a configured proxy.
import { describe, expect, it } from 'vitest'
import { voiceNetworkRefusal, type VoiceHttpSupport } from '../../src/core/voice/voiceNetwork'
import { readVoiceNetworkPosture, type HttpSettingsSource } from '../../src/host/networkPosture'

const SUPPORT_ON: VoiceHttpSupport = { proxySupport: 'override', isWebSocketSupportOn: true }

describe('voiceNetworkRefusal', () => {
  it('refuses without a socket, whatever the proxy says', () => {
    expect(voiceNetworkRefusal('absent', false)).toBe('noSocket')
    expect(voiceNetworkRefusal('absent', true)).toBe('noSocket')
  })

  it('refuses an unrouted socket while a proxy is set', () => {
    expect(voiceNetworkRefusal('notRouted', true)).toBe('proxy')
  })

  it('allows a routed socket with a proxy set', () => {
    expect(voiceNetworkRefusal('routed', true)).toBeUndefined()
  })

  it('allows an unrouted socket with no proxy set', () => {
    expect(voiceNetworkRefusal('notRouted', false)).toBeUndefined()
    expect(voiceNetworkRefusal('routed', false)).toBeUndefined()
  })

  // The host rebuilds the setup when `http.proxy` flips while the window
  // is open, so the refusal must follow the current value in both
  // directions, not the one read at activation.
  it('follows a proxy set and then unset while the window is open', () => {
    expect(voiceNetworkRefusal('notRouted', true)).toBe('proxy')
    expect(voiceNetworkRefusal('notRouted', false)).toBeUndefined()
    expect(voiceNetworkRefusal('notRouted', true)).toBe('proxy')
  })

  // The wrapper marker alone still reads `routed` where the live settings
  // leave the socket unrouted: each off setting refuses a set proxy with
  // its own refusal, so the microphone names the setting at fault instead
  // of blaming the VS Code version; `proxySupport` off wins when both are
  // off. A genuinely unrouted socket keeps the version refusal.
  it('refuses a marker-routed socket with the refusal naming the off setting', () => {
    expect(voiceNetworkRefusal('routed', true, SUPPORT_ON)).toBeUndefined()
    expect(
      voiceNetworkRefusal('routed', true, { proxySupport: 'off', isWebSocketSupportOn: true }),
    ).toBe('proxySupportOff')
    expect(
      voiceNetworkRefusal('routed', true, { proxySupport: 'on', isWebSocketSupportOn: false }),
    ).toBe('proxyWebSocketOff')
    expect(
      voiceNetworkRefusal('routed', true, { proxySupport: 'off', isWebSocketSupportOn: false }),
    ).toBe('proxySupportOff')
    expect(voiceNetworkRefusal('notRouted', true, SUPPORT_ON)).toBe('proxy')
    expect(
      voiceNetworkRefusal('routed', false, { proxySupport: 'off', isWebSocketSupportOn: false }),
    ).toBeUndefined()
  })

  // End to end through the posture the host reads live: real `http`
  // settings values in, the refusal naming the off setting out.
  it('names the off setting from the live posture the host reads', () => {
    const off = readVoiceNetworkPosture(
      settingsSource({
        proxy: 'http://proxy:8080',
        proxySupport: 'off',
        webSocketAdditionalSupport: true,
      }),
    )
    expect(voiceNetworkRefusal('routed', off.isProxySet, off.support)).toBe('proxySupportOff')
    const sockets = readVoiceNetworkPosture(
      settingsSource({
        proxy: 'http://proxy:8080',
        proxySupport: 'override',
        webSocketAdditionalSupport: false,
      }),
    )
    expect(voiceNetworkRefusal('routed', sockets.isProxySet, sockets.support)).toBe(
      'proxyWebSocketOff',
    )
  })
})

function settingsSource(values: Record<string, unknown>): HttpSettingsSource {
  return {
    get: (section: string) => values[section],
  }
}

describe('readVoiceNetworkPosture', () => {
  it('reads the proxy and both support flags live', () => {
    expect(
      readVoiceNetworkPosture(
        settingsSource({
          proxy: 'http://proxy:8080',
          proxySupport: 'off',
          webSocketAdditionalSupport: false,
        }),
      ),
    ).toEqual({
      isProxySet: true,
      support: { proxySupport: 'off', isWebSocketSupportOn: false },
    })
  })

  it('falls back to VS Code defaults for missing or malformed settings', () => {
    expect(readVoiceNetworkPosture(settingsSource({}))).toEqual({
      isProxySet: false,
      support: { proxySupport: 'override', isWebSocketSupportOn: true },
    })
    expect(
      readVoiceNetworkPosture(
        settingsSource({ proxy: 7, proxySupport: 'sometimes', webSocketAdditionalSupport: 'yes' }),
      ),
    ).toEqual({
      isProxySet: false,
      support: { proxySupport: 'override', isWebSocketSupportOn: true },
    })
  })
})
