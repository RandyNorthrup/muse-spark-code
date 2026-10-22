import { describe, expect, it } from 'vitest'
import { NATIVE_FEEDBACK_READER } from '../../src/core/backends/musecode/feedback'
import { NATIVE_MUSE_CODE_FEATURE_PORTS } from '../../src/core/backends/musecode/MuseCodeHost'

// The ports constant the hosts construct with (C-M106-3R2): the CLI/ACP
// runtime (src/runtime/backends.ts) passes
// `featurePorts: NATIVE_MUSE_CODE_FEATURE_PORTS`, and the VS Code window's
// manager resolves the same constant from the shipped bundle at spawn, so
// neither reader enters the activation bundle. That construction itself
// needs a live host, so it is proven by the real-life run in
// docs/certification/rlm106.md: per the owner's 2026-10-17 rule a test never
// asserts on source text. These tests pin the shared constant's real shape
// through the real modules instead: feedback bound to the note-only reader,
// and no port where Muse Code sends no frame.
describe('Native reader ports both hosts share', () => {
  it('binds feedback to the note-only reader', () => {
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.feedback).toBe(NATIVE_FEEDBACK_READER)
  })

  it('exposes no port where Muse Code sends no frame', () => {
    // The effort catalogue preloads on first spawn outside the ports, and no
    // lifecycle port exists where Muse Code sends no frame.
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.modelEfforts).toBeUndefined()
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.lifecycle).toBeUndefined()
  })
})
