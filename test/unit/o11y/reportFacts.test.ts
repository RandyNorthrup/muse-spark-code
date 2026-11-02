import { describe, expect, it } from 'vitest'
import { desktopReportFacts } from '../../../src/core/o11y/reportFacts'
import { buildProblemReportDraft, ReportBuildError } from '../../../src/core/support/problemReport'

const scrub = { workspaceRoots: [], homeDir: '/home/tester', extraLiterals: [] }

function facts(extra: unknown = {}) {
  return {
    extensionVersion: '0.18.2',
    nodeVersion: '24.0.0',
    ...(extra as Record<string, unknown>),
  }
}

function draft(factsInput: unknown) {
  return buildProblemReportDraft({
    description: '',
    includeFacts: true,
    includeEvents: false,
    facts: factsInput,
    events: [],
    recordingUnavailable: false,
    nowMs: Date.now(),
    scrub,
  })
}

describe('desktop report facts', () => {
  it('builds the desktop block from full deps', () => {
    expect(
      desktopReportFacts({
        electronVersion: '33.0.0',
        chromeVersion: '130.0.0',
        ready: false,
        unreadyComponents: ['shell'],
        crashTotal: 2,
        crashKinds: ['signal', 'oom'],
        exportOn: true,
      }),
    ).toEqual({
      desktop: {
        electronVersion: '33.0.0',
        chromeVersion: '130.0.0',
        ready: false,
        unreadyComponents: ['shell'],
        crashTotal: 2,
        crashKinds: ['signal', 'oom'],
        exportOn: true,
      },
    })
  })

  it('omits unread fields and keeps an empty block for a failed desktop read', () => {
    expect(desktopReportFacts({ ready: true })).toEqual({ desktop: { ready: true } })
    expect(desktopReportFacts({})).toEqual({ desktop: {} })
  })

  it('renders the desktop line in the sealed draft', () => {
    const text = draft(
      facts(
        desktopReportFacts({
          electronVersion: '33.0.0',
          chromeVersion: '130.0.0',
          ready: false,
          unreadyComponents: ['shell', 'app'],
          crashTotal: 2,
          crashKinds: ['signal', 'oom'],
          exportOn: false,
        }),
      ),
    ).text
    expect(text).toContain(
      'desktop: electron 33.0.0, chrome 130.0.0; not ready (shell, app); crashes: 2 (signal, oom); otlp export: no',
    )
  })

  it('reads unknown for each unread desktop subfact', () => {
    const text = draft(facts(desktopReportFacts({ ready: true, crashTotal: 0 }))).text
    expect(text).toContain(
      'desktop: electron unknown, chrome unknown; ready; crashes: 0; otlp export: unknown',
    )
  })

  it('renders no desktop line outside the desktop', () => {
    expect(draft(facts()).text).not.toContain('desktop:')
  })

  it('names the reason when the desktop read failed', () => {
    const text = draft({
      ...facts(desktopReportFacts({})),
      factReasons: { desktop: 'TimeoutError' },
    }).text
    expect(text).toContain('desktop: unknown (TimeoutError)')
  })

  it('refuses a desktop version that is not a version', () => {
    let error: unknown
    try {
      draft(facts({ desktop: { electronVersion: 'tomorrow' } }))
    } catch (error_: unknown) {
      error = error_
    }
    expect(error).toBeInstanceOf(ReportBuildError)
    expect((error as ReportBuildError).field).toBe('desktop.electronVersion')
  })

  it('refuses a crash kind and a component outside their vocabularies', () => {
    for (const desktop of [
      { crashTotal: 1, crashKinds: ['meteor'] },
      { ready: false, unreadyComponents: ['toaster'] },
    ]) {
      expect(() => draft(facts({ desktop }))).toThrow(ReportBuildError)
    }
  })
})
