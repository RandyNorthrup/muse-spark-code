import { describe, expect, it } from 'vitest'
import * as protocol from '../../src/shared/protocol'
import * as wire from '../../src/shared/wireEntry'

// Every lazy Node bundle that imports protocol.ts resolves it to dist/wire.js
// (scripts/lib/deferredBundles.mjs, sharedWire), so a protocol export that
// wire.js leaves out reads as undefined there: the runtime panel's bundle
// (M104 lane B) failed to load that way, at the MHP panel's raw message
// schemas, until they joined.
describe('dist/wire.js shares protocol.ts by name', () => {
  it('re-exports every protocol export as the same value', () => {
    const shared = new Map<string, unknown>(Object.entries(wire))
    expect(Object.keys(protocol).filter((name) => !shared.has(name))).toEqual([])
    for (const [name, value] of Object.entries(protocol)) expect(shared.get(name), name).toBe(value)
  })

  it('still parses a real webview message through the shared parser', () => {
    expect(wire.parseWebviewToHostMessage({ type: 'ready' })).toEqual(
      protocol.parseWebviewToHostMessage({ type: 'ready' }),
    )
    expect(wire.parseWebviewToHostMessage({ type: 'ready' }).ok).toBe(true)
    expect(wire.parseWebviewToHostMessage({ type: 'not-a-message' }).ok).toBe(false)
  })
})
