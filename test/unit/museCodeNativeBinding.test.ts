import { describe, expect, it } from 'vitest'
import { NATIVE_FEEDBACK_READER } from '../../src/core/backends/musecode/feedback'
import { NATIVE_LIFECYCLE_READER } from '../../src/core/backends/musecode/lifecycle'
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
// lifecycle bound to the started reader, and no port where Muse Code sends
// no frame.
describe('Native reader ports both hosts share', () => {
  it('binds feedback to the note-only reader', () => {
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.feedback).toBe(NATIVE_FEEDBACK_READER)
  })

  it('binds lifecycle to the started reader, with no delete admission parser', () => {
    // `session/started` is served (the 1.4.9 and 1.4.11 captures); the
    // delete frames are not, so the admission parser stays absent and
    // deleteSession keeps refusing without sending.
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.lifecycle).toBe(NATIVE_LIFECYCLE_READER)
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.lifecycle?.parseDeleteAdmission).toBeUndefined()
  })

  it('exposes no port where Muse Code sends no frame', () => {
    // The effort catalogue preloads on first spawn outside the ports.
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.modelEfforts).toBeUndefined()
  })
})
