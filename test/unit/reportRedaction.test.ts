import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { REPORT_FORMATS } from '../../src/shared/constants'
import { createReportRenderers } from '../../src/core/reporting/render'
import {
  finalizeReport,
  verifyReport,
  scrubReportOutput,
} from '../../src/core/reporting/render/canonical'
import { reportScrubber, scrubSourceSnapshot } from '../../src/core/reporting/render/redaction'
import {
  buildSourceSnapshot,
  availableSource,
  reportFactSnapshot,
} from './helpers/reporting/snapshot'
import { REPORT_THEME, renderFixture } from './reportRenderFixtures'

const CANARY = `LLM_${'x'.repeat(32)}`
const ACCOUNT = 'private.person@example.invalid'
const DIGEST = 'a'.repeat(64)

/** Saved input hashes are public; compute one without using the redacting finalizer. */
function unsafePasswordReport(password: string) {
  const document = renderFixture()
  document.sections[0]!.rows[0]!.cells['name'] = {
    type: 'text',
    value: JSON.stringify({ password }),
  }
  const { asOf: _asOf, contentHash: _contentHash, ...header } = document.header
  document.header.contentHash = createHash('sha256')
    .update(`${JSON.stringify({ ...document, header }, undefined, 2)}\n`)
    .digest('hex')
  return document
}

describe('report snapshot and output scrub', () => {
  it('scrubs decoded escaped passwords before serialization and rejects independently hashed unsafe saved reports', () => {
    const password = 'fixture-value-8729'
    const document = unsafePasswordReport(password)
    const encoded = JSON.stringify(document)
    const saved: unknown = JSON.parse(encoded)
    expect(() => verifyReport(saved)).toThrow('Report content hash or redaction mismatch')
    const renderers = createReportRenderers({ textForLocale: () => EN })
    for (const format of REPORT_FORMATS) {
      expect(() => renderers[format](document, 'en', REPORT_THEME)).toThrow(
        'Report content hash or redaction mismatch',
      )
      const clean = finalizeReport(document)
      const output = renderers[format](clean, 'en', REPORT_THEME)
      expect(output).not.toContain(password)
      expect(output).toContain('[redacted]')
      expect(output).toContain(clean.header.contentHash)
    }
  })
  it('scrubs a Unicode-escaped password key after decoding saved input', () => {
    const password = 'fixture-unicode-8729'
    const document = unsafePasswordReport(password)
    const encoded = JSON.stringify(document).replaceAll('password', String.raw`pass\u0077ord`)
    expect(encoded).not.toContain('password')
    const saved: unknown = JSON.parse(encoded)
    expect(saved).toEqual(document)
    expect(() => verifyReport(saved)).toThrow('Report content hash or redaction mismatch')
    const clean = finalizeReport(document)
    expect(JSON.stringify(clean)).not.toContain(password)
    expect(clean.sections[0]!.rows[0]!.cells['name']).toEqual({
      type: 'text',
      value: '{"password":"[redacted]"}',
    })
    expect(verifyReport(clean)).toEqual(clean)
  })
  it.each(['password="fixture-value-8729"', 'META_API_KEY=fixture-value-8729'])(
    'keeps already-redacted assignments valid JSON: %s',
    (assignment) => {
      const snapshot = buildSourceSnapshot({
        changelog: availableSource('changelog', {
          sections: [{ version: 'Unreleased', date: null, lines: [assignment] }],
        }),
      })
      const cleanSnapshot = scrubSourceSnapshot(snapshot)
      const line = cleanSnapshot.sources.changelog.data?.sections[0]?.lines[0]
      if (line === undefined) throw new Error('Changelog fixture is unavailable')
      expect(line).not.toContain('fixture-value-8729')
      const document = renderFixture()
      document.sections[0]!.rows[0]!.cells['name'] = { type: 'text', value: line }
      const clean = finalizeReport(document)
      const output = createReportRenderers({ textForLocale: () => EN }).json(
        clean,
        'en',
        REPORT_THEME,
      )
      const saved: unknown = JSON.parse(output)
      expect(verifyReport(saved)).toEqual(clean)
      expect(clean.sections[0]!.rows[0]!.cells['name']).toEqual({ type: 'text', value: line })
    },
  )
  it('preserves complete workspace-relative Windows filenames before scrubbing and hashes equivalent paths identically', () => {
    const options = {
      workspaceRoot: 'C:/Users/Private Person/work',
      homeRoot: 'C:/Users/Private Person',
    }
    const paths = [
      String.raw`c:\users\PRIVATE PERSON\work\src\main.ts`,
      'C:/Users/Private Person/work/src/main.ts',
    ]
    const reports = paths.map((file) => {
      const snapshot = buildSourceSnapshot({
        changelog: availableSource('changelog', {
          sections: [{ version: 'Unreleased', date: null, lines: [file] }],
        }),
      })
      const cleanSnapshot = scrubSourceSnapshot(snapshot, options)
      const line = cleanSnapshot.sources.changelog.data?.sections[0]?.lines[0]
      expect(line).toBe('./src/main.ts')
      if (line === undefined) throw new Error('Changelog fixture is unavailable')
      const document = renderFixture()
      document.header.scope = file
      document.sections[0]!.rows[0]!.cells['name'] = { type: 'text', value: line }
      const clean = finalizeReport(document, options)
      const renderers = createReportRenderers({ textForLocale: () => EN }, options)
      for (const format of REPORT_FORMATS) {
        const output = renderers[format](clean, 'en', REPORT_THEME)
        expect(output).toContain('./src/main.ts')
        expect(output).not.toContain('Private Person')
      }
      expect(verifyReport(clean, options)).toEqual(clean)
      return clean
    })
    expect(reports[0]).toEqual(reports[1])
    const scrub = reportScrubber(options)
    expect(scrub(String.raw`C:\Users\Private Person\other\private.txt`)).not.toContain(
      'private.txt',
    )
    expect(scrub(String.raw`D:\outside\private.txt`)).not.toContain('private.txt')
  })
  it('scrubs the final formatted output boundary', () => {
    const output = scrubReportOutput(`<p>${CANARY} ${ACCOUNT} ${DIGEST}</p>`, {})
    for (const secret of [CANARY, ACCOUNT, DIGEST]) expect(output).not.toContain(secret)
    expect(output).toContain('<p>')
  })
  it('scrubs source dictionary keys and refuses collisions after redaction', () => {
    const snapshot = buildSourceSnapshot()
    Reflect.defineProperty(snapshot.sources, CANARY, {
      value: { nested: ACCOUNT },
      enumerable: true,
      configurable: true,
    })
    expect(JSON.stringify(scrubSourceSnapshot(snapshot))).not.toContain(CANARY)
    Reflect.defineProperty(snapshot.sources, `LLM_${'y'.repeat(32)}`, {
      value: { nested: ACCOUNT },
      enumerable: true,
      configurable: true,
    })
    expect(() => scrubSourceSnapshot(snapshot)).toThrow(
      'Report source keys collide after scrubbing',
    )
  })
  it('does not exempt a source cell named contentHash', () => {
    const document = renderFixture()
    document.sections = [
      {
        id: 'hashes',
        label: 'commits',
        sortKey: 'key',
        columns: [{ key: 'contentHash', label: 'commit' }],
        rows: [
          {
            key: 'source-hash',
            cells: { contentHash: { type: 'text', value: DIGEST } },
            sourceIds: ['git'],
          },
        ],
        omittedRows: 0,
      },
    ]
    const finalized = finalizeReport(document)
    const renderers = createReportRenderers({ textForLocale: () => EN })
    for (const format of REPORT_FORMATS) {
      const output = renderers[format](finalized, 'en', REPORT_THEME)
      expect(output).not.toContain(DIGEST)
      expect(output).toContain(finalized.header.contentHash)
    }
  })
  it('scrubs commit subjects, PR titles, changelog lines and tool output in the snapshot without mutating it', () => {
    const session = reportFactSnapshot().sources.session.data
    if (session === null) throw new Error('Session fixture is unavailable')
    const snapshot = buildSourceSnapshot({
      git: availableSource('git', {
        head: 'abc',
        defaultBranch: 'main',
        commits: [
          {
            sha: 'abc',
            at: '2026-10-06T12:00:00Z',
            subject: `commit ${CANARY} ${DIGEST}`,
            files: [String.raw`C:\Users\Private Person\work\src\main.ts`],
          },
        ],
        tags: [],
        branches: [],
        worktrees: [],
      }),
      changelog: availableSource('changelog', {
        sections: [
          { version: 'Unreleased', date: null, lines: [`changelog ${CANARY} ${ACCOUNT}`] },
        ],
      }),
      github: availableSource('github', {
        pullRequests: [
          {
            number: 1,
            title: `PR ${CANARY}`,
            state: 'open',
            isDraft: true,
            isMerged: false,
            author: { login: 'fixture', id: 1 },
            url: 'https://github.com/example/repo/pull/1',
            headRef: 'feature/test',
            headSha: 'abc',
            headRepository: 'example/repo',
            baseRef: 'main',
            baseRepository: 'example/repo',
          },
        ],
        runs: [],
        releases: [],
      }),
      session: availableSource('session', {
        ...session,
        export: {
          ...session.export,
          transcript: [
            ...session.export.transcript,
            {
              itemId: 'tool',
              kind: 'toolCall',
              status: 'completed',
              visibleOutput: `tool ${CANARY}; password=fixture-secret`,
              args: JSON.stringify({ [CANARY]: ACCOUNT }),
            },
          ],
        },
      }),
    })
    const before = structuredClone(snapshot)
    const clean = scrubSourceSnapshot(snapshot, {
      workspaceRoot: 'C:/Users/Private Person/work',
      homeRoot: 'C:/Users/Private Person',
    })
    const bytes = JSON.stringify(clean)
    for (const secret of [CANARY, ACCOUNT, DIGEST, 'Private Person', 'fixture-secret'])
      expect(bytes).not.toContain(secret)
    expect(bytes).toContain('src')
    expect(snapshot).toEqual(before)
  })
  it.each(REPORT_FORMATS)(
    'scrubs canaries and every untrusted digest in %s while preserving only verified hash metadata',
    (format) => {
      const document = renderFixture('session')
      document.header.scope = `commit ${CANARY}`
      document.sections[0]!.rows[0]!.cells['name'] = {
        type: 'text',
        value: `PR ${CANARY}; changelog ${ACCOUNT}; tool ${DIGEST}; contentHash ${DIGEST}; password=fixture-secret`,
      }
      const clean = finalizeReport(document)
      const renderers = createReportRenderers({ textForLocale: () => EN })
      const output = renderers[format](clean, 'en', REPORT_THEME)
      for (const secret of [CANARY, ACCOUNT, DIGEST, 'fixture-secret'])
        expect(output).not.toContain(secret)
      expect(output).toContain(clean.header.contentHash)
      expect(clean.header.contentHash).not.toBe(document.header.contentHash)
      expect(verifyReport(clean).header.contentHash).toBe(clean.header.contentHash)
    },
  )
  it.each(['md', 'html', 'text'] as const)(
    'scrubs freshly emitted %s output even after the document was finalized',
    (format) => {
      const port = {
        textForLocale: () => ({
          ...EN,
          reportKinds: { ...EN.reportKinds, project: `fresh ${CANARY} ${ACCOUNT} ${DIGEST}` },
        }),
      }
      const output = createReportRenderers(port)[format](renderFixture(), 'en', REPORT_THEME)
      // Credentials with underscores must be caught before Markdown escaping masks their shape.
      expect(output).not.toContain(CANARY)
      expect(output).not.toContain(ACCOUNT)
      expect(output).not.toContain(DIGEST)
      expect(output).not.toContain('x'.repeat(32))
    },
  )
  it('matches Windows roots case-insensitively in both separators and refuses sibling-prefix matches', () => {
    const scrub = reportScrubber({
      workspaceRoot: 'C:/Users/Private Person/work',
      homeRoot: 'C:/Users/Private Person',
    })
    expect(scrub(String.raw`c:\users\PRIVATE PERSON\work\src\main.ts`)).toBe('./src/main.ts')
    expect(scrub('C:/Users/Private Person/work/src/main.ts')).toBe('./src/main.ts')
    expect(scrub('C:/Users/Private Person/work-other/private.txt')).not.toContain('./-other')
    expect(scrub('/srv/unknown/private.txt')).not.toContain('/srv')
    expect(scrub('https://example.invalid/page')).toBe('https://example.invalid/page')
  })
})
