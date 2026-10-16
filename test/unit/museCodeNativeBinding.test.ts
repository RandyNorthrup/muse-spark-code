import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NATIVE_MUSE_CODE_FEATURE_PORTS } from '../../src/core/backends/musecode/MuseCodeHost'
import { NATIVE_FEEDBACK_READER } from '../../src/core/backends/musecode/feedback'

// The production constructions bind these readers (C-M106-3R2): the VS Code
// window in src/extension.ts and the CLI/ACP runtime in
// src/runtime/backends.ts. These tests read the production wiring itself,
// not a copy of it: deleting `featurePorts` from either construction fails
// them (RVCM1063 #7). Live dispatch through a `muse serve` connection is
// proven by the real-life run in docs/certification/msm106.md, not here.
describe('Native reader binding: VS Code backend manager', () => {
  it('binds the native ports the window constructs with', () => {
    const windowSource = readFileSync('src/extension.ts', 'utf8')
    expect(windowSource).toMatch(/featurePorts:\s*NATIVE_MUSE_CODE_FEATURE_PORTS/)
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.feedback).toBe(NATIVE_FEEDBACK_READER)
    // The effort catalogue preloads on first spawn outside the ports, and no
    // lifecycle port exists where Muse Code sends no frame.
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.modelEfforts).toBeUndefined()
    expect(NATIVE_MUSE_CODE_FEATURE_PORTS.lifecycle).toBeUndefined()
  })
})

describe('Native reader binding: CLI/ACP runtime', () => {
  it('binds the same captured-frame readers as the VS Code window', () => {
    const runtimeSource = readFileSync('src/runtime/backends.ts', 'utf8')
    expect(runtimeSource).toMatch(/featurePorts:\s*NATIVE_MUSE_CODE_FEATURE_PORTS/)
  })
})
