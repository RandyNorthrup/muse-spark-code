import { readFileSync } from 'node:fs'
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

  it('implements each scene step and its end-state readiness gate', () => {
    const harness = readFileSync('test/harness/index.html', 'utf8')
    for (const scene of SCENES) {
      expect(harness.includes(`'${scene}':`) || harness.includes(`${scene}: () =>`)).toBe(true)
    }
    // The preview scenes wait for the Edit button only the preview brings;
    // the sent scenes wait for a settled status line, so a stuck preview or
    // send fails the gate instead of scanning early.
    expect(harness).toContain('.feedback-fields .button-secondary')
    expect(harness).toContain('[role="dialog"] [role="status"]')
    expect(harness).toContain(`'Send feedback to Muse Code': ['feedbackTitle']`)
    expect(harness).toContain("case 'previewFeedback':")
    expect(harness).toContain("case 'submitFeedback':")
    expect(harness).toContain("outcome: shown('Feedback uploaded.')")
    expect(harness).toContain("'Feedback uploaded.': ['feedbackUploaded']")
  })
})
