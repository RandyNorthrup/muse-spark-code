import { describe, expect, it } from 'vitest'
import * as media from '../../src/shared/media'
import * as protocol from '../../src/shared/protocol'
import * as questions from '../../src/shared/questions'
import * as scheduleProtocol from '../../src/shared/scheduleProtocol'
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

// scheduleProtocol, media and questions are shared by name: only what a
// Node bundle reads rides in dist/wire.js. A name added to one of these
// modules fails here until its lane proves the Node reader and shares it,
// or names it below as webview- and contract-test-only.
describe('dist/wire.js shares three modules by name', () => {
  const cases: {
    readonly module: Record<string, unknown>
    readonly dropped: ReadonlySet<string>
  }[] = [
    { module: scheduleProtocol, dropped: new Set(['parseScheduleWebviewMessage']) },
    { module: media, dropped: new Set(['mediaAttachmentUpdateSchema']) },
    {
      module: questions,
      dropped: new Set(['questionReplySchema', 'attentionDockStateSchema']),
    },
  ]
  for (const { module, dropped } of cases) {
    it(`shares ${String(Object.keys(module).length - dropped.size)} names, drops ${String(dropped.size)}`, () => {
      const shared = new Map<string, unknown>(Object.entries(wire))
      for (const [name, value] of Object.entries(module)) {
        if (dropped.has(name)) {
          expect(shared.has(name), name).toBe(false)
        } else {
          expect(shared.get(name), name).toBe(value)
        }
      }
    })
  }
})
