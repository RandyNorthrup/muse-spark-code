// Whether Muse Voice may record on this editor's network (M56, PLAN.md
// D43): the socket reaches Meta direct, or not at all, when the editor does
// not route it through a configured proxy.
import { describe, expect, it } from 'vitest'
import { voiceNetworkRefusal } from '../../src/core/voice/voiceNetwork'

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
})
