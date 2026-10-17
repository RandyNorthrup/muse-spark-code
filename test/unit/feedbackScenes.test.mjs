import { describe, expect, it } from 'vitest'
import { SCENARIOS, SIZED_SCENARIOS } from '../../scripts/lib/harnessServer.mjs'

// RVCM1063 #4: the three narrow feedback scenes exist in the harness, so the
// visual and accessibility suites cover the dialog. The baselines render on
// the reviewer's side (this lane's sandbox has no browser); these checks pin
// the scene registration, the steps, and the end-state readiness gates.
const NARROW_SCENES = ['feedback-narrow', 'feedback-preview-narrow', 'feedback-sent-narrow']
const SCENES = [
  'feedback',
  'feedback-narrow',
  'feedback-preview',
  'feedback-preview-narrow',
  'feedback-sent',
  'feedback-sent-narrow',
]

describe('feedback harness scenes', () => {
  it('registers every feedback scene for the suites', () => {
    for (const scene of SCENES) expect(SCENARIOS).toContain(scene)
  })

  it('sizes the narrow scenes at 320 px on the dialog', () => {
    for (const scene of NARROW_SCENES) {
      expect(SIZED_SCENARIOS[scene]).toEqual({ width: 320, ready: '[role="dialog"]' })
    }
  })
})

// The scenes' steps and end-state readiness gates live in test/harness/ and
// are proven by the production-Chrome suite (feedbackBrowser.test.mjs) and
// the lead's local look: per the owner's 2026-10-17 rule no test asserts on
// harness source text, so the word-search check that stood here is gone.
