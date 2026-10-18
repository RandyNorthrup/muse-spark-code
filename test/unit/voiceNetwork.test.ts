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
  // leave the socket unrouted: `proxySupport` off, or
  // `webSocketAdditionalSupport` off, refuses a set proxy all the same.
  it('refuses a marker-routed socket the live settings leave unrouted', () => {
    expect(voiceNetworkRefusal('routed', true, SUPPORT_ON)).toBeUndefined()
    expect(
      voiceNetworkRefusal('routed', true, { proxySupport: 'off', isWebSocketSupportOn: true }),
    ).toBe('proxy')
    expect(
      voiceNetworkRefusal('routed', true, { proxySupport: 'on', isWebSocketSupportOn: false }),
    ).toBe('proxy')
    expect(
      voiceNetworkRefusal('routed', false, { proxySupport: 'off', isWebSocketSupportOn: false }),
    ).toBeUndefined()
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
