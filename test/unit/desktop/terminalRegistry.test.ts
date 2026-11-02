// The persistent terminals' registry
// (src/webview/desktop/panel/terminalRegistry.ts): the startup chunk's
// only handle on the lazy terminal engines — registration, disposal of
// closed tabs, and silent unknown ids.
import { describe, expect, it } from 'vitest'
import {
  registerPersistentTerminal,
  releasePersistentTerminal,
  unregisterPersistentTerminal,
} from '../../../src/webview/desktop/panel/terminalRegistry'

describe('M111 lane BP terminal registry', () => {
  it('releases a registered tab; the engine unregisters itself on release', () => {
    let released = 0
    registerPersistentTerminal('tab-1', {
      release: () => {
        released += 1
        unregisterPersistentTerminal('tab-1')
      },
    })
    releasePersistentTerminal('tab-1')
    releasePersistentTerminal('tab-1')
    expect(released).toBe(1)
  })

  it('leaves unknown and unregistered tabs alone', () => {
    expect(() => {
      releasePersistentTerminal('never-there')
    }).not.toThrow()
    let released = 0
    registerPersistentTerminal('tab-2', {
      release: () => {
        released += 1
      },
    })
    unregisterPersistentTerminal('tab-2')
    releasePersistentTerminal('tab-2')
    expect(released).toBe(0)
  })
})
