import { describe, expect, it } from 'vitest'
import * as protocol from '../../src/shared/protocol'
import * as wire from '../../src/shared/wireEntry'

// Every lazy Node bundle that imports protocol.ts resolves it to dist/wire.js
// (scripts/lib/deferredBundles.mjs, sharedWire), so a protocol export that
// wire.js leaves out reads as undefined there. Only the MHP panel's raw
// message schemas are left out on purpose (D226): no Node bundle reads them
// yet, and dist/wire.js is over its budget already.
const PANEL_ONLY = ['hostToWebviewMessageSchema', 'webviewToHostMessageSchema']

describe('dist/wire.js shares protocol.ts by name', () => {
  it('re-exports every protocol export as the same value, except the panel-only schemas', () => {
    const shared = new Map<string, unknown>(Object.entries(wire))
    const missing = Object.keys(protocol).filter((name) => !shared.has(name))
    expect(missing.toSorted((a, b) => a.localeCompare(b))).toEqual(PANEL_ONLY)
    for (const [name, value] of Object.entries(protocol)) {
      if (PANEL_ONLY.includes(name)) continue
      expect(shared.get(name), name).toBe(value)
    }
  })

  it('still parses a real webview message through the shared parser', () => {
    expect(wire.parseWebviewToHostMessage({ type: 'ready' })).toEqual(
      protocol.parseWebviewToHostMessage({ type: 'ready' }),
    )
    expect(wire.parseWebviewToHostMessage({ type: 'ready' }).ok).toBe(true)
    expect(wire.parseWebviewToHostMessage({ type: 'not-a-message' }).ok).toBe(false)
  })
})
