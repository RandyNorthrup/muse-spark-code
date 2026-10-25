import { describe, expect, it } from 'vitest'
import { buildProblemReportDraft } from '../../src/core/support/problemReport'

const scrub = { workspaceRoots: [], homeDir: '/home/tester', extraLiterals: [] }

function facts() {
  return {
    extensionVersion: '0.18.2',
    nodeVersion: '24.0.0',
    platform: 'linux',
    backend: 'auto',
    sandbox: 'auto',
    cliFound: true,
    cliVersion: '1.4.6-R6000.1',
    cliSignIn: true,
    hasStoredApiKey: false,
    hasEnvironmentApiKey: false,
    settingNames: [],
  }
}

describe('problem report price facts', () => {
  it('names the CLI version and contributor mode', () => {
    const draft = buildProblemReportDraft({
      description: '',
      includeFacts: true,
      includeEvents: false,
      facts: { ...facts(), contributorMode: false },
      events: [],
      recordingUnavailable: false,
      nowMs: Date.now(),
      scrub,
    })
    expect(draft.text).toContain('version 1.4.6-R6000.1')
    expect(draft.text).toContain('contributor mode: off')
  })

  it('says unknown when contributor mode was not observed', () => {
    const draft = buildProblemReportDraft({
      description: '',
      includeFacts: true,
      includeEvents: false,
      facts: facts(),
      events: [],
      recordingUnavailable: false,
      nowMs: Date.now(),
      scrub,
    })
    expect(draft.text).toContain('contributor mode: unknown')
  })

  it('does not call valid records past the recent-events cap skipped', () => {
    const valid = { kind: 'backendExit', code: 'ECONNRESET', frames: [], ageMs: 1 }
    const draft = buildProblemReportDraft({
      description: '',
      includeFacts: false,
      includeEvents: true,
      facts: facts(),
      events: Array.from({ length: 51 }, () => ({ ...valid })),
      recordingUnavailable: false,
      nowMs: Date.now(),
      scrub,
    })
    expect(draft.text).toContain('Recent events (50)')
    expect(draft.text).not.toMatch(/skipped/i)
  })

  it('carries drop counts the caller counted before selection', () => {
    const draft = buildProblemReportDraft({
      description: '',
      includeFacts: false,
      includeEvents: true,
      facts: facts(),
      events: [{ kind: 'backendExit', code: 'ECONNRESET', frames: [], ageMs: 1 }],
      droppedEvents: { invalid: 2, tooOld: 0, overCap: 0 },
      recordingUnavailable: false,
      nowMs: Date.now(),
      scrub,
    })
    expect(draft.text).toContain('Recent events (1)')
    expect(draft.text).toContain('Dropped events: 2 invalid')
  })

  it('says when stored records could not be carried', () => {
    const draft = buildProblemReportDraft({
      description: '',
      includeFacts: false,
      includeEvents: true,
      facts: facts(),
      events: [
        { kind: 'errorNotice', code: '', frames: [], ageMs: 1 },
        { kind: 'nope', code: 'x', frames: [], ageMs: -5 },
      ],
      recordingUnavailable: false,
      nowMs: Date.now(),
      scrub,
    })
    expect(draft.text).toContain('Recent events (0)')
    expect(draft.text).toContain('Dropped events: 2 invalid')
  })
})
