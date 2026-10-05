// Report a problem, lane P (M93, PLAN.md D72): the scrubbed report builder
// in src/core/support/problemReport.ts. Allowlist-only inputs, the second scrub over
// the final draft, the preview/export seal, and the issue-URL fallback bound.

import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildProblemReportDraft,
  formatReportAge,
  hashReportText,
  isSealedDraftCurrent,
  issueLinkForDraft,
  problemReportTitle,
  ReportBuildError,
  scrubFinalDraft,
  sealReportDraft,
  selectProblemReportEvents,
  type ProblemReportFacts,
  type ProblemReportInput,
  type ReportScrubContext,
} from '../../src/core/support/problemReport'
import {
  REDACTED_MARK,
  REPORT_DESCRIPTION_MAX_CHARS,
  REPORT_ISSUE_NEW_URL,
  REPORT_ISSUE_URL_MAX_CHARS,
  REPORT_RECENT_EVENT_COUNT,
} from '../../src/shared/constants'

const SCRUB: ReportScrubContext = {
  workspaceRoots: ['/home/alice/work'],
  homeDir: '/home/alice',
  extraLiterals: ['alice', 'alice-pc'],
}

const FACTS: ProblemReportFacts = {
  extensionVersion: '0.12.1',
  vscodeVersion: '1.99.0',
  nodeVersion: '22.20.4',
  platform: 'linux',
  backend: 'auto',
  sandbox: 'auto',
  cliFound: true,
  cliVersion: '1.4.2',
  cliSignIn: true,
  hasStoredApiKey: false,
  hasEnvironmentApiKey: false,
  settingNames: ['museSpark.backend', 'museSpark.shellSandbox'],
}

const EVENT = {
  kind: 'backendExit',
  code: 'ECONNRESET',
  frames: [{ path: 'dist/extension.js', line: 12, column: 4 }],
  ageMs: 180_000,
}

function input(overrides: Partial<ProblemReportInput> = {}): ProblemReportInput {
  return {
    description: 'The panel went blank after reload.',
    includeFacts: true,
    includeEvents: true,
    facts: FACTS,
    events: [EVENT],
    recordingUnavailable: false,
    nowMs: 1_769_000_000_000,
    scrub: SCRUB,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('allowlist refusal', () => {
  it.each([
    ['a prompt field', { ...FACTS, prompt: 'do evil' }],
    ['model output', { ...FACTS, output: 'code here' }],
    ['a file path', { ...FACTS, filePath: '/home/alice/secret.ts' }],
    ['a URL', { ...FACTS, url: 'https://example.com/?key=x' }],
    ['an account name', { ...FACTS, account: 'alice@example.com' }],
    ['an unknown platform', { ...FACTS, platform: 'freebsd' }],
    ['an unknown backend', { ...FACTS, backend: 'other' }],
    ['an unknown sandbox posture', { ...FACTS, sandbox: 'unsandboxed' }],
    ['a version with a newline', { ...FACTS, extensionVersion: '0.12.1\npassword: x' }],
    ['a version that is a sentence', { ...FACTS, nodeVersion: 'fast and new' }],
    ['a setting value riding along', { ...FACTS, settingNames: ['museSpark.backend=auto'] }],
    ['a path as a setting name', { ...FACTS, settingNames: ['/etc/passwd'] }],
    ['a missing facts object', undefined],
    ['facts of the wrong shape', ['extensionVersion']],
  ])('refuses %s without repeating the value', (_label, facts) => {
    let caught: unknown
    try {
      buildProblemReportDraft(input({ facts }))
    } catch (error: unknown) {
      caught = error
    }
    if (!(caught instanceof ReportBuildError)) {
      throw new TypeError('expected a ReportBuildError')
    }
    const failure = caught
    expect(failure.field.length).toBeGreaterThan(0)
    expect(failure.message).not.toContain('evil')
    expect(failure.message).not.toContain('secret.ts')
  })

  it('leaves out a CLI version that is not a version instead of trusting it', () => {
    const draft = buildProblemReportDraft(
      input({ facts: { ...FACTS, cliVersion: '1.4.2 (owned)' } }),
    )
    expect(draft.text).toContain('cli: found; signed in: yes')
    expect(draft.text).not.toContain('owned')
  })

  it('makes a description cut mid-pair well formed, so the issue link never throws', () => {
    // A lone high surrogate, as a field cut between the two halves of an emoji leaves it.
    const lone = String.fromCodePoint(0xd8_3d)
    const draft = buildProblemReportDraft(
      input({ description: `broken ${lone}`, includeFacts: false, includeEvents: false }),
    )
    expect(draft.text).toContain(`broken ${String.fromCodePoint(0xff_fd)}`)
    expect(draft.text).not.toContain(lone)
    expect(issueLinkForDraft(draft.title, draft.text).kind).toBe('open')
  })

  it('refuses a non-finite clock', () => {
    expect(() => buildProblemReportDraft(input({ nowMs: NaN }))).toThrow(ReportBuildError)
  })

  it('names the offending scalar field', () => {
    try {
      buildProblemReportDraft(input({ facts: { ...FACTS, extensionVersion: 'nope' } }))
      expect.unreachable()
    } catch (error: unknown) {
      if (!(error instanceof ReportBuildError)) {
        throw new TypeError('expected a ReportBuildError', { cause: error })
      }
      expect(error.field).toBe('extensionVersion')
    }
  })
})

describe('stored records, validated again', () => {
  it.each([
    ['an unknown kind', { ...EVENT, kind: 'hearsay' }],
    ['a raw message field', { ...EVENT, message: 'boom' }],
    ['a session id field', { ...EVENT, sessionId: 's1' }],
    ['a traversal frame', { ...EVENT, frames: [{ path: '../outside.ts', line: 1, column: 0 }] }],
    [
      'a source file outside the package',
      { ...EVENT, frames: [{ path: 'src/host/backend/manager.ts', line: 1, column: 0 }] },
    ],
    [
      'a dot segment into the package',
      { ...EVENT, frames: [{ path: 'dist/./extension.js', line: 1, column: 0 }] },
    ],
    ['an absolute frame', { ...EVENT, frames: [{ path: '/etc/secret.ts', line: 1, column: 0 }] }],
    [
      'a Windows-absolute frame',
      { ...EVENT, frames: [{ path: String.raw`C:\x\y.ts`, line: 1, column: 0 }] },
    ],
    ['a URL frame', { ...EVENT, frames: [{ path: 'https://x/y.ts', line: 1, column: 0 }] }],
    [
      'a multiline frame',
      { ...EVENT, frames: [{ path: 'a.ts\npassword: x', line: 1, column: 0 }] },
    ],
    ['an over-long code', { ...EVENT, code: 'x'.repeat(65) }],
    [
      'too many frames',
      {
        ...EVENT,
        frames: Array.from({ length: 17 }, () => ({
          path: 'dist/extension.js',
          line: 1,
          column: 0,
        })),
      },
    ],
    ['a negative age', { ...EVENT, ageMs: -1 }],
    ['an age past retention', { ...EVENT, ageMs: 8 * 24 * 60 * 60 * 1000 }],
  ])('skips a record with %s', (_label, event) => {
    const draft = buildProblemReportDraft(input({ events: [event] }))
    expect(draft.text).toContain('Recent events (0):')
    expect(draft.text).not.toContain('hearsay')
    expect(draft.text).not.toContain('outside.ts')
  })

  it('keeps valid records and turns an off-vocabulary code into the fixed word', () => {
    const draft = buildProblemReportDraft(
      input({
        events: [{ ...EVENT, code: 'what even is this?!' }, { ...EVENT, code: 'exit1' }, EVENT],
      }),
    )
    expect(draft.text).toContain('Recent events (3):')
    expect(draft.text).toContain('backendExit unknown')
    expect(draft.text).not.toContain('what even is this?!')
    expect(draft.text).not.toContain('exit1')
  })

  it('selects the carried records with their input indexes', () => {
    const selected = selectProblemReportEvents([
      { ...EVENT, kind: 'hearsay' },
      EVENT,
      { ...EVENT, ageMs: -1 },
      EVENT,
    ])
    expect(selected.map((entry) => entry.index)).toEqual([1, 3])
    expect(selected[0]?.event).toEqual(EVENT)
    const many = Array.from({ length: REPORT_RECENT_EVENT_COUNT + 2 }, () => EVENT)
    expect(selectProblemReportEvents(many)[0]?.index).toBe(2)
  })

  it('keeps only the last fifty valid records', () => {
    const events = Array.from({ length: REPORT_RECENT_EVENT_COUNT + 5 }, (_, index) => ({
      ...EVENT,
      ageMs: (index + 1) * 1000,
    }))
    const draft = buildProblemReportDraft(input({ events }))
    expect(draft.text).toContain(`Recent events (${String(REPORT_RECENT_EVENT_COUNT)}):`)
  })
})

describe('second scrub over the final draft', () => {
  it('catches every secret-shaped value injected late', () => {
    const late = [
      'key LLM_abcdefghijklmnop here',
      'Authorization: Bearer abcdefghij1234567890',
      'write to alice@example.com or 10.0.0.8 or fe80::1',
      'open /home/alice/work/main.ts then /home/bob/other.ts',
      String.raw`see D:\Users\carol\notes\x.md`,
      'at https://user:hunter2@example.com/docs?a=b#frag',
      'from alice-pc as alice',
      'home is /home/alice after all',
    ].join('\n')
    const scrubbed = scrubFinalDraft(late, SCRUB)
    expect(scrubbed).not.toContain('LLM_abcdefghijklmnop')
    expect(scrubbed).not.toContain('abcdefghij1234567890')
    expect(scrubbed).not.toContain('alice-pc')
    expect(scrubbed).not.toContain('hunter2')
    expect(scrubbed).not.toContain('alice@example.com')
    expect(scrubbed).not.toContain('10.0.0.8')
    expect(scrubbed).not.toContain('fe80::1')
    expect(scrubbed).not.toContain('/home/bob/other.ts')
    expect(scrubbed).not.toContain(String.raw`D:\Users\carol`)
    expect(scrubbed).not.toContain('?a=b')
    expect(scrubbed).not.toContain('#frag')
    expect(scrubbed).toContain('<workspace>')
    expect(scrubbed).toContain('~')
    expect(scrubbed).toContain(REDACTED_MARK)
  })

  it('replaces a workspace root under home before the home replacement', () => {
    const scrubbed = scrubFinalDraft('in /home/alice/work/a.ts', SCRUB)
    expect(scrubbed).toContain('<workspace>/a.ts')
    expect(scrubbed).not.toContain('~/work/a.ts')
  })

  it('leaves clock times and dotted versions alone', () => {
    expect(scrubFinalDraft('at 12:34:56 on 0.12.1', SCRUB)).toBe('at 12:34:56 on 0.12.1')
  })

  it('redacts a secret smuggled in the user description at build time', () => {
    const draft = buildProblemReportDraft(
      input({
        description: 'fails with LLM_abcdefghijklmnop set',
        includeFacts: false,
        includeEvents: false,
      }),
    )
    expect(draft.text).not.toContain('LLM_abcdefghijklmnop')
    expect(draft.text).toContain(REDACTED_MARK)
  })
})

describe('rendering', () => {
  it('renders the golden draft for fixed facts and events', () => {
    const draft = buildProblemReportDraft(input())
    expect(draft.title).toBe('Problem report: Muse Spark 0.12.1 on linux')
    expect(draft.text).toBe(
      [
        'Muse Spark problem report',
        '',
        'What was happening:',
        'The panel went blank after reload.',
        '',
        'Support facts:',
        'extension: 0.12.1',
        'vscode: 1.99.0',
        'node: 22.20.4',
        'platform: linux',
        'backend: auto',
        'cli: found (version 1.4.2); signed in: yes',
        'stored model api key: no; META_API_KEY in environment: no',
        'shell sandbox: auto',
        'settings (names only): museSpark.backend, museSpark.shellSandbox',
        '',
        'Recent events (1):',
        '- 3m ago backendExit ECONNRESET',
        '  dist/extension.js:12:4',
      ].join('\n'),
    )
  })

  it('names no VS Code version for the standalone agent', () => {
    const standalone: ProblemReportFacts = {
      extensionVersion: '0.12.1',
      nodeVersion: '22.20.4',
      platform: 'linux',
      backend: 'auto',
      sandbox: 'auto',
      cliFound: false,
      cliSignIn: false,
      hasStoredApiKey: false,
      hasEnvironmentApiKey: false,
      settingNames: [],
    }
    const draft = buildProblemReportDraft(input({ facts: standalone }))
    expect(draft.text).toContain('vscode: none (standalone agent)')
  })

  it('omits removed sections and empty text', () => {
    const draft = buildProblemReportDraft(
      input({ description: ' '.repeat(3), includeFacts: false, includeEvents: false }),
    )
    expect(draft.text).toBe('Muse Spark problem report')
  })

  it('states when recording was unavailable and when no events remain', () => {
    const unavailable = buildProblemReportDraft(input({ events: [], recordingUnavailable: true }))
    expect(unavailable.text).toContain('event recording was unavailable')
    const empty = buildProblemReportDraft(input({ events: [] }))
    expect(empty.text).toContain('Recent events (0):\nnone')
  })

  it('caps a long description with an ellipsis', () => {
    const draft = buildProblemReportDraft(
      input({ description: ` ${'w'.repeat(REPORT_DESCRIPTION_MAX_CHARS + 10)} ` }),
    )
    expect(draft.text).toContain(`${'w'.repeat(REPORT_DESCRIPTION_MAX_CHARS)}…`)
    expect(draft.text).not.toContain('w'.repeat(REPORT_DESCRIPTION_MAX_CHARS + 1))
  })

  it('formats relative ages across units', () => {
    expect(formatReportAge(0)).toBe('0s ago')
    expect(formatReportAge(45_000)).toBe('45s ago')
    expect(formatReportAge(180_000)).toBe('3m ago')
    expect(formatReportAge(7_200_000)).toBe('2h ago')
    expect(formatReportAge(6 * 24 * 3_600_000)).toBe('6d ago')
  })

  it('titles from allowlisted facts', () => {
    expect(problemReportTitle(FACTS)).toBe('Problem report: Muse Spark 0.12.1 on linux')
  })
})

describe('draft identity', () => {
  it('seals with the SHA-256 over title and text', () => {
    const draft = buildProblemReportDraft(input())
    const expected = createHash('sha256').update(`${draft.title}\n${draft.text}`).digest('hex')
    expect(draft.hash).toBe(expected)
    expect(hashReportText(draft.title, draft.text)).toBe(expected)
    expect(isSealedDraftCurrent(draft)).toBe(true)
  })

  it('invalidates any change after the preview', () => {
    const draft = buildProblemReportDraft(input())
    expect(isSealedDraftCurrent({ ...draft, text: `${draft.text} ` })).toBe(false)
    expect(isSealedDraftCurrent({ ...draft, text: draft.text.slice(0, -1) })).toBe(false)
    expect(isSealedDraftCurrent({ ...draft, title: `${draft.title}!` })).toBe(false)
    expect(isSealedDraftCurrent(sealReportDraft(draft.title, draft.text))).toBe(true)
  })
})

describe('issue link', () => {
  it('opens the prefilled page for a short draft', () => {
    const link = issueLinkForDraft('T', 'short body')
    expect(link).toEqual({
      kind: 'open',
      url: `${REPORT_ISSUE_NEW_URL}?title=T&body=short%20body`,
    })
  })

  it('opens exactly at the cap and falls back one character over', () => {
    const head = `${REPORT_ISSUE_NEW_URL}?title=T&body=`
    const room = REPORT_ISSUE_URL_MAX_CHARS - head.length
    const atCap = issueLinkForDraft('T', 'a'.repeat(room))
    expect(atCap.kind).toBe('open')
    if (atCap.kind === 'open') {
      expect(atCap.url.length).toBe(REPORT_ISSUE_URL_MAX_CHARS)
    }
    expect(issueLinkForDraft('T', 'a'.repeat(room + 1))).toEqual({ kind: 'fallback' })
  })

  it('measures the encoded length, so multibyte text falls back sooner', () => {
    const head = `${REPORT_ISSUE_NEW_URL}?title=T&body=`
    const room = REPORT_ISSUE_URL_MAX_CHARS - head.length
    // Each é encodes to six characters; half the room in é overflows.
    expect(issueLinkForDraft('T', 'é'.repeat(Math.ceil(room / 2))).kind).toBe('fallback')
    expect(issueLinkForDraft('T', 'é'.repeat(Math.floor(room / 8))).kind).toBe('open')
  })
})

describe('no network', () => {
  it('builds, scrubs and links without touching fetch', () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network is forbidden here')))
    vi.stubGlobal('fetch', fetchSpy)
    const draft = buildProblemReportDraft(input())
    scrubFinalDraft(draft.text, SCRUB)
    issueLinkForDraft(draft.title, draft.text)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
