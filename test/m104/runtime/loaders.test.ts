import { expect, it, vi } from 'vitest'
import {
  engineLoader,
  backendLoader,
  contextLoader,
  presentationLoader,
} from '../../../src/runtime/panel/panelLoader'

for (const [name, loader] of [
  ['engines', engineLoader],
  ['backend', backendLoader],
  ['context', contextLoader],
  ['presentation', presentationLoader],
] as const) {
  it(`${name}: rejects a corrupt installed module and retries a rejected load`, () => {
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const loadBundle = vi.fn(() => ({}))
    const load = loader({ bundlePath: '/unused-test-bundle.js', loadBundle, log })
    expect(() => load()).toThrow()
    expect(() => load()).toThrow()
    expect(loadBundle).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledTimes(2)
  })
}
