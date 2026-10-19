// What's New's content, made at build time from CHANGELOG.md (M99, PLAN.md
// D79): released sections only, Highlights and their Try its checked
// against what the manifest contributes, Markdown reduced to text-only
// parts, and the file the build writes read back through the extension's
// schema.

import { brotliCompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CONTENT_FILE,
  contributedIds,
  highlightsProblem,
  MAX_HIGHLIGHTS,
  parseChangelog,
  repositoryUrl,
  selectWhatsNewReleases,
  writeWhatsNewContent,
} from '../../scripts/lib/whatsNewContent.mjs'
import {
  encodeWhatsNewContent,
  parseWhatsNewContent,
  type ReleaseNotes,
} from '../../src/core/whatsNew/whatsNewContent'
import { releasesToShow } from '../../src/core/whatsNew/whatsNewVersions'
import { renderWhatsNewPage } from '../../src/host/whatsNew/whatsNewHtml'
import {
  UI_TEXT,
  WHATS_NEW_CHANGELOG_URL,
  WHATS_NEW_CONTENT_DECODE_MAX_BYTES,
  WHATS_NEW_CONTENT_MAX_BYTES,
} from '../../src/shared/constants'
import manifest from '../../package.json'
import { removeFolder } from './helpers/temporaryFolders'

const REPOSITORY = 'https://github.com/example/repo'
const ALLOWED = {
  commands: new Set(['museSpark.showWhatsNew']),
  settings: new Set(['museSpark.showWhatsNewOnUpdate']),
}

/** A one-release CHANGELOG whose one Highlight ends with `directive`. */
function withTry(directive: string): string {
  return `## [1.0.0] - 2026-10-05\n\n### Highlights\n\n- **X.** Y. ${directive}\n`
}

const CHANGELOG = `# Changelog

Intro text.

## [Unreleased]

### Highlights

- **Not yet.** Unreleased work is never shown.

## [0.13.1] - 2026-10-06

### Fixed

- A fix with \`code\`, *emphasis* and ~~strike~~.

## [0.13.0] - 2026-10-05

Text before the first heading.

### Highlights

- **New page.** Opens after updates. <!-- try: command museSpark.showWhatsNew -->
- **A setting.** Turn it off.
  <!-- try: setting museSpark.showWhatsNewOnUpdate -->
- **Plain.** No button. <!-- a comment that is not a directive -->

### Added

- Links: [docs](docs/acp.md), [anchor](#top), [web](https://example.com/x), [mail](mailto:a@b.c).
- Raw <script>alert(1)</script> stays text; ![a picture](media/x.png) is its alt text.
  1. nested ordered

     \`\`\`sh
     npm run build
     \`\`\`

> A quote.

#### A subheading

## [0.12.0] - 2026-10-01

### Changed

- Older.
`

// These cases parse and encode every release of the real CHANGELOG.md; hosted
// macOS with coverage took up to 5.4 s, past the default deadline.
// PLAN.md §8 (2026-10-07).
const REAL_CHANGELOG_TIMEOUT_MS = 30_000

/** The decoded bytes of a content envelope, exactly as the build writes it. */
function envelopeBytes(releases: readonly ReleaseNotes[], isShortened: boolean): number {
  return Buffer.byteLength(
    JSON.stringify(
      isShortened ? { schema: 1, releases, shortened: true } : { schema: 1, releases },
    ),
  )
}

/** Successful fixtures must encode, then be read through the production schema. */
function encodedText(text: string): string {
  const result = encodeWhatsNewContent(text)
  expect(result.kind).toBe('encoded')
  if (result.kind === 'over-budget') throw new Error('expected encodable fixture content')
  return result.text
}

const withFallback = (pad: string) =>
  `## [1.0.4] - 2026-10-05\n\n### Fixed\n\n- Current fix.\n\n` +
  `## [1.0.3] - 2026-10-04\n\n### Fixed\n\n- Previous fix ${pad}.\n\n` +
  '## [1.0.2] - 2026-10-03\n\n### Highlights\n\n- Newest Highlights.\n'

const short = (release: ReleaseNotes): ReleaseNotes => ({
  ...release,
  sections: [
    {
      heading: '',
      blocks: [
        {
          t: 'p',
          c: [
            {
              t: 'link',
              href: `${REPOSITORY}/blob/main/CHANGELOG.md`,
              c: [{ t: 'text', v: `Full notes for ${release.version}` }],
            },
          ],
        },
      ],
    },
  ],
})

describe('parseChangelog', () => {
  const releases = parseChangelog(CHANGELOG, ALLOWED, REPOSITORY)

  it.each(['\n', '\r\n'])(
    'returns exact heading and body spans for %j terminated ATX headings',
    (eol) => {
      const heading = `## [1.0.4] - 2026-10-05${eol}`
      const body = `${eol}### Fixed${eol}${eol}- Current fix.${eol}`
      const text = heading + body
      const release = parseChangelog(text, ALLOWED, REPOSITORY)[0]
      expect(release?.range).toMatchObject({
        headingStart: 0,
        headingEnd: heading.length,
        bodyStart: heading.length,
        bodyEnd: text.length,
      })
      expect(text.slice(release?.range.headingStart, release?.range.headingEnd)).toBe(heading)
      expect(text.slice(release?.range.bodyStart, release?.range.bodyEnd)).toBe(body)
    },
  )

  it('refuses CR-only and mixed lone-CR files with a named line-ending error', () => {
    for (const text of [CHANGELOG.replaceAll('\n', '\r'), CHANGELOG + '\r'])
      expect(() => parseChangelog(text, ALLOWED, REPOSITORY)).toThrow(
        'CHANGELOG.md: CR-only line endings are not supported; use LF or CRLF',
      )
  })

  it('refuses a Setext release heading with a named error', () => {
    expect(() =>
      parseChangelog(
        '[1.0.4] - 2026-10-05\n----------------------\n\n### Fixed\n\n- Fix.\n',
        ALLOWED,
        REPOSITORY,
      ),
    ).toThrow('CHANGELOG.md 1.0.4: Setext release headings are not supported')
  })

  it('refuses unterminated or noncanonical release headings', () => {
    for (const heading of ['## [1.0.4] - 2026-10-05', '## [1.0.4] - 2026-10-05 ##\n'])
      expect(() => parseChangelog(heading, ALLOWED, REPOSITORY)).toThrow(
        'CHANGELOG.md 1.0.4: release headings must be "## [version] - YYYY-MM-DD" followed by LF or CRLF',
      )
  })

  it('accepts one to three leading spaces, while fenced and four-space indented headings stay code', () => {
    for (const indent of [' ', '  ', ' '.repeat(3)]) {
      const text = `${indent}## [1.0.4] - 2026-10-05\n\n### Fixed\n\n- Fix.\n`
      const parsed = parseChangelog(text, ALLOWED, REPOSITORY)
      expect(parsed.map((release) => release.version)).toEqual(['1.0.4'])
      expect(text.slice(parsed[0]?.range.headingStart, parsed[0]?.range.headingEnd)).toBe(
        '## [1.0.4] - 2026-10-05\n',
      )
    }
    const text =
      '## [1.0.4] - 2026-10-05\n\n### Fixed\n\n' +
      '```md\n## [1.0.3] - 2026-10-04\n```\n\n    ## [1.0.2] - 2026-10-03\n'
    const parsed = parseChangelog(text, ALLOWED, REPOSITORY)
    expect(parsed.map((release) => release.version)).toEqual(['1.0.4'])
    expect(JSON.stringify(parsed[0]?.sections)).toContain('1.0.3')
    expect(JSON.stringify(parsed[0]?.sections)).toContain('1.0.2')
  })

  it('keeps the released sections, newest first, and never the Unreleased one', () => {
    expect(releases.map((release) => [release.version, release.date])).toEqual([
      ['0.13.1', '2026-10-06'],
      ['0.13.0', '2026-10-05'],
      ['0.12.0', '2026-10-01'],
    ])
    expect(JSON.stringify(releases)).not.toContain('Not yet')
    expect(JSON.stringify(releases)).not.toContain('Intro text')
  })

  it('splits a release at its ### headings, text before the first one included', () => {
    const release = releases[1]
    expect(release?.sections.map((section) => section.heading)).toEqual(['', 'Added'])
    expect(release?.sections[0]?.blocks).toEqual([
      { t: 'p', c: [{ t: 'text', v: 'Text before the first heading.' }] },
    ])
    expect(releases[0]?.highlights).toEqual([])
  })

  it('reads Highlights with their Try its, and drops other comments', () => {
    const highlights = releases[1]?.highlights ?? []
    expect(highlights.map((entry) => entry.tries)).toEqual([
      [{ kind: 'command', id: 'museSpark.showWhatsNew' }],
      [{ kind: 'setting', id: 'museSpark.showWhatsNewOnUpdate' }],
      [],
    ])
    expect(highlights[0]?.c).toEqual([
      {
        t: 'p',
        c: [
          { t: 'strong', c: [{ t: 'text', v: 'New page.' }] },
          { t: 'text', v: ' Opens after updates. ' },
        ],
      },
    ])
    expect(JSON.stringify(highlights)).not.toContain('<!--')
  })

  it('keeps text-only parts: raw HTML as text, pictures as alt text, web and repository links', () => {
    const added = JSON.stringify(releases[1]?.sections[1]?.blocks)
    expect(added).toContain('{"t":"text","v":"<script>"}')
    expect(added).toContain('{"t":"text","v":"a picture"}')
    expect(added).toContain(`"href":"${REPOSITORY}/blob/main/docs/acp.md"`)
    expect(added).toContain(`"href":"${REPOSITORY}/blob/main/CHANGELOG.md#top"`)
    expect(added).toContain('"href":"https://example.com/x"')
    // Any other scheme is its text only.
    expect(added).not.toContain('mailto:')
    expect(added).toContain('{"t":"text","v":"mail"}')
    expect(added).toContain('{"t":"pre","v":"npm run build"}')
    expect(added).toContain('"t":"list","ordered":true,"start":1')
    expect(added).toContain('"t":"quote"')
    expect(added).toContain('{"t":"h","c":[{"t":"text","v":"A subheading"}]}')
    const fixed = JSON.stringify(releases[0]?.sections[0]?.blocks)
    expect(fixed).toContain('{"t":"code","v":"code"}')
    expect(fixed).toContain('{"t":"em","c":[{"t":"text","v":"emphasis"}]}')
    expect(fixed).toContain('{"t":"del","c":[{"t":"text","v":"strike"}]}')
  })

  it.each([
    ['hTtPs://example.com/CaseSensitive', REPOSITORY, 'https://example.com/CaseSensitive'],
    ['docs/acp.md', 'HTTPS://github.com/example/repo', `${REPOSITORY}/blob/main/docs/acp.md`],
    ['#top', 'HTTPS://github.com/example/repo', `${REPOSITORY}/blob/main/CHANGELOG.md#top`],
    ['FTP://example.com/x', REPOSITORY, undefined],
    ['docs/acp.md', 'ftp://example.com/repo', undefined],
  ] as const)(
    'emits only schema-compatible link schemes for %s via %s',
    (url, repository, expected) => {
      const parsed = parseChangelog(withTry(`[docs](${url})`), ALLOWED, repository)
      const text = JSON.stringify({ schema: 1, releases: parsed })
      if (expected === undefined) expect(text).not.toContain('"href":')
      else expect(text).toContain(JSON.stringify(expected))
      expect(parseWhatsNewContent(text).releases).toEqual(parsed)
    },
  )

  it('fails on a Try it the manifest does not contribute, or a malformed one', () => {
    expect(() =>
      parseChangelog(withTry('<!-- try: command museSpark.notACommand -->'), ALLOWED, REPOSITORY),
    ).toThrow('the Try it command "museSpark.notACommand" is not one the manifest contributes')
    expect(() =>
      parseChangelog(withTry('<!-- try: setting editor.fontSize -->'), ALLOWED, REPOSITORY),
    ).toThrow('the Try it setting "editor.fontSize" is not one the manifest contributes')
    expect(() =>
      parseChangelog(withTry('<!-- try: url https://example.com -->'), ALLOWED, REPOSITORY),
    ).toThrow('a Try it is a command or a setting, not "url"')
    expect(() => parseChangelog(withTry('<!-- try: command -->'), ALLOWED, REPOSITORY)).toThrow(
      'is not "<!-- try: command <id> -->"',
    )
    // [Unreleased] is checked too, so the change that adds a bad Try it fails.
    expect(() =>
      parseChangelog(
        '## [Unreleased]\n\n### Highlights\n\n- **X.** <!-- try: command museSpark.nope -->\n',
        ALLOWED,
        REPOSITORY,
      ),
    ).toThrow('CHANGELOG.md Unreleased: the Try it command "museSpark.nope"')
  })

  it('reports each release’s source range for the packager to slice, never entering the JSON', () => {
    // Ranges are source-map metadata: the shipped content shape is unchanged.
    for (const release of releases) {
      expect(Object.keys(release).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
        'date',
        'highlights',
        'sections',
        'version',
      ])
    }
    expect(JSON.stringify(releases)).not.toContain('range')
    // Whole-section slices tile the released span end to start.
    expect(releases[0]?.range.start).toBe(CHANGELOG.indexOf('## [0.13.1]'))
    expect(CHANGELOG.slice(releases[0]?.range.start, releases[0]?.range.end)).toBe(
      '## [0.13.1] - 2026-10-06\n\n### Fixed\n\n- A fix with `code`, *emphasis* and ~~strike~~.\n\n',
    )
    expect(releases[0]?.range.highlightsStart).toBeUndefined()
    expect(releases[0]?.range.end).toBe(releases[1]?.range.start)
    expect(releases[1]?.range.end).toBe(releases[2]?.range.start)
    expect(releases[2]?.range.end).toBe(CHANGELOG.length)
    // The Highlights subsection slice is the section as written.
    const highlights = releases[1]?.range
    expect(CHANGELOG.slice(highlights?.highlightsStart, highlights?.highlightsEnd).trimEnd()).toBe(
      '### Highlights\n\n- **New page.** Opens after updates. <!-- try: command museSpark.showWhatsNew -->\n- **A setting.** Turn it off.\n  <!-- try: setting museSpark.showWhatsNewOnUpdate -->\n- **Plain.** No button. <!-- a comment that is not a directive -->',
    )
    // The Unreleased Highlights span is the bullets only.
    expect(
      CHANGELOG.slice(
        releases.unreleased?.highlightsStart,
        releases.unreleased?.highlightsEnd,
      ).trim(),
    ).toBe('- **Not yet.** Unreleased work is never shown.')
  })

  it('fails on Highlights that are not one list, on two of them, and on a repeated version', () => {
    expect(() =>
      parseChangelog('## [1.0.0] - 2026-10-05\n\n### Highlights\n\nProse.\n', ALLOWED, REPOSITORY),
    ).toThrow('must hold one bullet list')
    expect(() =>
      parseChangelog(
        '## [1.0.0] - 2026-10-05\n\n### Highlights\n\n- A\n\n### Highlights\n\n- B\n',
        ALLOWED,
        REPOSITORY,
      ),
    ).toThrow('two "### Highlights" sections')
    // CX1R4 F6: an archived first list still counts as seen for the duplicate check.
    expect(() =>
      parseChangelog(
        '## [1.0.0] - 2026-10-05\n\n### Highlights\n\n- A\n  <!-- whats-new: historical -->\n\n### Highlights\n\n- B\n',
        ALLOWED,
        REPOSITORY,
      ),
    ).toThrow('two "### Highlights" sections')
    expect(() =>
      parseChangelog(
        '## [1.0.0] - 2026-10-05\n\n- A\n\n## [1.0.0] - 2026-10-05\n\n- B\n',
        ALLOWED,
        REPOSITORY,
      ),
    ).toThrow('two sections for 1.0.0')
  })
})

describe('highlightsProblem (the changelog guard)', () => {
  const releases = parseChangelog(CHANGELOG, ALLOWED, REPOSITORY)

  it('passes a minor release with Highlights and a patch without them', () => {
    expect(highlightsProblem(releases, '0.13.0')).toBeUndefined()
    expect(highlightsProblem(releases, '0.13.1')).toBeUndefined()
  })

  it('fails a minor release without Highlights, an unknown version and too many Highlights', () => {
    expect(highlightsProblem(releases, '0.12.0')).toContain(
      'the 0.12.0 section of CHANGELOG.md needs a "### Highlights" list',
    )
    expect(highlightsProblem(releases, '0.14.0')).toBe(
      'CHANGELOG.md has no released section for 0.14.0',
    )
    const many = Array.from({ length: MAX_HIGHLIGHTS + 1 }, (_, index) => `- H${String(index)}`)
    const crowded = parseChangelog(
      `## [1.1.0] - 2026-10-05\n\n### Highlights\n\n${many.join('\n')}\n`,
      ALLOWED,
      REPOSITORY,
    )
    expect(highlightsProblem(crowded, '1.1.0')).toBe(
      `the 1.1.0 section of CHANGELOG.md has ${String(MAX_HIGHLIGHTS + 1)} Highlights; keep at most ${String(MAX_HIGHLIGHTS)}`,
    )
  })
})

describe('selectWhatsNewReleases (the budget-aware writer)', () => {
  const fallbackSections = [
    {
      heading: '',
      blocks: [
        {
          t: 'p',
          c: [
            {
              t: 'link',
              href: `${REPOSITORY}/blob/main/CHANGELOG.md`,
              c: [{ t: 'text', v: 'Full notes for 1.0.2' }],
            },
          ],
        },
      ],
    },
  ]
  const filler = 'x'.repeat(2000)
  const budgeted = `## [2.0.0] - 2026-10-09

### Highlights

- **New.** Shiny.

### Added

- Detail ${filler}.

## [1.9.0] - 2026-10-01

### Highlights

- **Old.** Stable.

### Added

- Older detail ${filler}.
`
  const parsed = () => parseChangelog(budgeted, ALLOWED, REPOSITORY)

  it.each(['HTTPS', 'Http'])(
    'resolves %s repository links before trying full or shorter plans',
    (scheme) => {
      const repository = `${scheme}://github.com/Example/Repo?Key=Value#Anchor`
      const normalized = repository.replace(scheme, () => scheme.toLowerCase())
      const releases = parseChangelog(budgeted, ALLOWED, repository)
      for (const bound of [100_000, 3000]) {
        const selection = selectWhatsNewReleases(releases, repository, bound)
        expect(selection).toEqual(selectWhatsNewReleases(releases, normalized, bound))
        expect(selection.plan[1]).toEqual({ version: '1.9.0', full: bound === 100_000 })
        const plain = JSON.stringify({
          schema: 1,
          releases: selection.releases,
          shortened: selection.shortened,
        })
        expect(parseWhatsNewContent(encodedText(plain)).releases).toEqual(selection.releases)
        if (selection.shortened) {
          expect(plain).toContain(`${normalized}/blob/main/CHANGELOG.md`)
        }
      }
      const fallback = selectWhatsNewReleases(
        parseChangelog(withFallback(''), ALLOWED, repository),
        repository,
      )
      expect(fallback.plan).toEqual([
        { version: '1.0.4', full: true },
        { version: '1.0.3', full: true },
        { version: '1.0.2', full: false },
      ])
      expect(fallback.shortened).toBe(false)
      const plain = JSON.stringify({ schema: 1, releases: fallback.releases })
      expect(plain).toContain(`${normalized}/blob/main/CHANGELOG.md`)
      expect(parseWhatsNewContent(encodedText(plain)).releases).toEqual(fallback.releases)
    },
  )

  it.each([
    'git+https://github.com/example/repo',
    'ftp://github.com/example/repo',
    'https:repo',
    'github.com/example/repo',
    '',
  ])('refuses repository %j before reading any candidate', (repository) => {
    const guarded = parsed().map((release) => ({
      ...release,
      get sections(): ReleaseNotes['sections'] {
        throw new Error('candidate read before repository validation')
      },
    }))
    for (const releases of [guarded, guarded.slice(0, 1), []]) {
      expect(() => selectWhatsNewReleases(releases, repository)).toThrow(
        "What's New repository URL must use HTTP or HTTPS",
      )
      expect(() => selectWhatsNewReleases(releases, repository, 0)).toThrow(
        "What's New repository URL must use HTTP or HTTPS",
      )
    }
  })

  it.each([
    ['newest Highlights', 'Shiny.'],
    ['predecessor Highlights', 'Stable.'],
    ['predecessor Added', 'Older detail'],
  ])('normalizes uppercase HTTPS in %s without dropping fitting notes', (_location, original) => {
    const changelog = budgeted.replace(
      original,
      'See [docs](HTTPS://example.com/CaseSensitive?Key=Value#Anchor).',
    )
    const releases = parseChangelog(changelog, ALLOWED, REPOSITORY)
    const selection = selectWhatsNewReleases(releases, REPOSITORY)
    expect(selection.plan).toEqual([
      { version: '2.0.0', full: true },
      { version: '1.9.0', full: true },
    ])
    expect(selection.shortened).toBe(false)
    const plain = JSON.stringify({ schema: 1, releases: selection.releases })
    expect(plain).toContain('https://example.com/CaseSensitive?Key=Value#Anchor')
    expect(parseWhatsNewContent(plain).releases).toEqual(releases)
  })

  it.each([0, 1])(
    'stops on a non-size schema failure in release %i, preserving its cause',
    (index) => {
      const releases = parsed().map((release, position) =>
        position === index ? { ...release, date: 'not-a-date' } : release,
      )
      let failure: unknown
      try {
        selectWhatsNewReleases(releases, REPOSITORY)
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      if (!(failure instanceof Error)) throw new Error('expected a named encoding failure')
      expect(failure.message).toContain(
        "CHANGELOG.md 2.0.0, 1.9.0: What's New artifact encoding failed:",
      )
      expect(failure.message).toContain('"date"')
      expect(failure.message).not.toContain('trim the notes')
      expect(failure.cause).toBeInstanceOf(Error)
    },
  )

  it('ships both releases in full while the decoded total fits', () => {
    const selection = selectWhatsNewReleases(parsed(), REPOSITORY, 100_000)
    expect(selection.releases.map((release) => release.version)).toEqual(['2.0.0', '1.9.0'])
    expect(selection.shortened).toBe(false)
    expect(selection.plan).toEqual([
      { version: '2.0.0', full: true },
      { version: '1.9.0', full: true },
    ])
    expect(selection.releases.every((release) => release.sections.length > 0)).toBe(true)
    expect(envelopeBytes(selection.releases, selection.shortened)).toBeLessThanOrEqual(100_000)
  })

  it('ships the second release as its Highlights only, with a link to its full notes, when just that fits', () => {
    const selection = selectWhatsNewReleases(parsed(), REPOSITORY, 3000)
    expect(selection.releases.map((release) => release.version)).toEqual(['2.0.0', '1.9.0'])
    expect(selection.shortened).toBe(true)
    expect(selection.plan).toEqual([
      { version: '2.0.0', full: true },
      { version: '1.9.0', full: false },
    ])
    expect(selection.releases[0]?.sections.map((section) => section.heading)).toEqual(['Added'])
    expect(selection.releases[1]?.highlights).toHaveLength(1)
    expect(selection.releases[1]?.sections).toEqual([
      {
        heading: '',
        blocks: [
          {
            t: 'p',
            c: [
              {
                t: 'link',
                href: `${REPOSITORY}/blob/main/CHANGELOG.md`,
                c: [{ t: 'text', v: 'Full notes for 1.9.0' }],
              },
            ],
          },
        ],
      },
    ])
    expect(JSON.stringify(selection.releases)).not.toContain('Older detail')
    expect(envelopeBytes(selection.releases, selection.shortened)).toBeLessThanOrEqual(3000)
    expect(
      parseWhatsNewContent(
        JSON.stringify({ schema: 1, releases: selection.releases, shortened: true }),
      ).shortened,
    ).toBe(true)
  })

  it('leaves the second release out when even its Highlights do not fit', () => {
    const selection = selectWhatsNewReleases(parsed(), REPOSITORY, 2400)
    expect(selection.releases.map((release) => release.version)).toEqual(['2.0.0'])
    expect(selection.shortened).toBe(true)
    expect(selection.plan).toEqual([
      { version: '2.0.0', full: true },
      { version: '1.9.0', full: false, omitted: true },
    ])
    expect(envelopeBytes(selection.releases, selection.shortened)).toBeLessThanOrEqual(2400)
  })

  it('refuses when the newest release alone exceeds the bound, naming it', () => {
    expect(() => selectWhatsNewReleases(parsed(), REPOSITORY, 100)).toThrow(
      `CHANGELOG.md 2.0.0: its release notes decode to ${String(envelopeBytes(parsed().slice(0, 1), false))} bytes, over the What's New bound of 100 bytes`,
    )
    const huge =
      '## [3.0.0] - 2026-10-09\n\n### Highlights\n\n- **Big.** Huge.\n\n### Added\n\n' +
      `- ${'z'.repeat(80_000)}\n`
    const releases = parseChangelog(huge, ALLOWED, REPOSITORY)
    const newestBytes = envelopeBytes(releases, false)
    expect(newestBytes).toBeGreaterThan(WHATS_NEW_CONTENT_DECODE_MAX_BYTES)
    expect(() => selectWhatsNewReleases(releases, REPOSITORY)).toThrow(
      `CHANGELOG.md 3.0.0: its release notes decode to ${String(newestBytes)} bytes, over the What's New bound of ${String(WHATS_NEW_CONTENT_DECODE_MAX_BYTES)} bytes; trim the notes (docs/RELEASING.md)`,
    )
  })

  it('still falls back to the newest earlier Highlights, within budget', () => {
    const changelog = `## [1.0.4] - 2026-10-05

### Fixed

- Current fix.

## [1.0.3] - 2026-10-04

### Fixed

- Previous fix.

## [1.0.2] - 2026-10-03

### Highlights

- Newest Highlights. <!-- try: command museSpark.showWhatsNew -->
`
    const parse = () => parseChangelog(changelog, ALLOWED, REPOSITORY)
    const kept = selectWhatsNewReleases(parse(), REPOSITORY, 100_000)
    expect(kept.releases.map((release) => release.version)).toEqual(['1.0.4', '1.0.3', '1.0.2'])
    expect(kept.plan).toEqual([
      { version: '1.0.4', full: true },
      { version: '1.0.3', full: true },
      { version: '1.0.2', full: false },
    ])
    expect(kept.releases[2]?.sections).toEqual(fallbackSections)
    expect(kept.shortened).toBe(false)
    const skipped = selectWhatsNewReleases(parse(), REPOSITORY, 600)
    expect(skipped.releases.map((release) => release.version)).toEqual(['1.0.4', '1.0.3'])
    expect(skipped.shortened).toBe(true)
  })

  it('is deterministic: the same CHANGELOG gives byte-identical output', () => {
    const first = JSON.stringify(selectWhatsNewReleases(parsed(), REPOSITORY, 3000))
    const second = JSON.stringify(selectWhatsNewReleases(parsed(), REPOSITORY, 3000))
    expect(second).toBe(first)
  })

  it('measures the shipped envelope with its shortened flag: an exact-fit newest release gets the named refusal', () => {
    const bound = 3000
    const predecessor = '## [1.9.0] - 2026-10-01\n\n### Fixed\n\n- Older fix.\n'
    const changelogFor = (filler: string) =>
      `## [2.0.0] - 2026-10-09\n\n### Highlights\n\n- **New.** Shiny.\n\n### Added\n\n- Detail ${filler}.\n\n${predecessor}`
    // Size the newest release so its envelope is exactly the bound: the
    // filler is plain text, one byte per character.
    const overhead = envelopeBytes(
      parseChangelog(changelogFor(''), ALLOWED, REPOSITORY).slice(0, 1),
      false,
    )
    const filler = 'x'.repeat(bound - overhead)
    const all = parseChangelog(changelogFor(filler), ALLOWED, REPOSITORY)
    expect(envelopeBytes(all.slice(0, 1), false)).toBe(bound)
    // Alone it fits and ships unshortened; with a predecessor left out, the
    // flag's own bytes no longer fit, so selection refuses by name instead
    // of handing the encoder a selection it can only reject generically.
    const alone = selectWhatsNewReleases(all.slice(0, 1), REPOSITORY, bound)
    expect(alone.shortened).toBe(false)
    expect(envelopeBytes(alone.releases, alone.shortened)).toBe(bound)
    const shipped = envelopeBytes(all.slice(0, 1), true)
    expect(shipped).toBeGreaterThan(bound)
    expect(() => selectWhatsNewReleases(all, REPOSITORY, bound)).toThrow(
      `CHANGELOG.md 2.0.0: its release notes decode to ${String(shipped)} bytes, over the What's New bound of ${String(bound)} bytes; trim the notes (docs/RELEASING.md)`,
    )
    try {
      selectWhatsNewReleases(all, REPOSITORY, bound)
      expect.unreachable()
    } catch (error) {
      expect(String(error)).not.toContain(UI_TEXT.actionFailed)
    }
  })

  it('enters the retained earlier Highlights in the plan, with the full-notes link', () => {
    const changelog = `## [1.0.4] - 2026-10-05

### Fixed

- Current fix.

## [1.0.3] - 2026-10-04

### Fixed

- Previous fix.

## [1.0.2] - 2026-10-03

### Highlights

- Newest Highlights. <!-- try: command museSpark.showWhatsNew -->
`
    const parse = () => parseChangelog(changelog, ALLOWED, REPOSITORY)
    const selection = selectWhatsNewReleases(parse(), REPOSITORY, 100_000)
    expect(selection.plan).toEqual([
      { version: '1.0.4', full: true },
      { version: '1.0.3', full: true },
      { version: '1.0.2', full: false },
    ])
    expect(selection.shortened).toBe(false)
    expect(selection.releases.map((release) => release.version)).toEqual([
      '1.0.4',
      '1.0.3',
      '1.0.2',
    ])
    expect(selection.releases[2]?.highlights).toHaveLength(1)
    expect(selection.releases[2]?.sections).toEqual(fallbackSections)
  })

  it('keeps fitting earlier Highlights at the exact bound instead of reserving the flag', () => {
    const bound = WHATS_NEW_CONTENT_DECODE_MAX_BYTES
    const predecessor = '## [1.0.3] - 2026-10-04\n\n### Fixed\n\n- Previous fix.\n'
    const fallback =
      '## [1.0.2] - 2026-10-03\n\n### Highlights\n\n- Newest Highlights. <!-- try: command museSpark.showWhatsNew -->\n'
    const changelogFor = (filler: string) =>
      `## [1.0.4] - 2026-10-05\n\n### Fixed\n\n- Current fix ${filler}.\n\n${predecessor}\n${fallback}`
    // Size the three selected entries (both fixes in full, the fallback as
    // its Highlights with the full-notes link, the flag absent) to exactly
    // the bound: the filler is plain ASCII text, one byte per character.
    const base = selectWhatsNewReleases(
      parseChangelog(changelogFor(''), ALLOWED, REPOSITORY),
      REPOSITORY,
      100_000,
    )
    expect(base.shortened).toBe(false)
    expect(base.releases.map((release) => release.version)).toEqual(['1.0.4', '1.0.3', '1.0.2'])
    const filler = 'x'.repeat(bound - envelopeBytes(base.releases, base.shortened))
    const all = parseChangelog(changelogFor(filler), ALLOWED, REPOSITORY)
    const selection = selectWhatsNewReleases(all, REPOSITORY, bound)
    expect(selection.releases.map((release) => release.version)).toEqual([
      '1.0.4',
      '1.0.3',
      '1.0.2',
    ])
    expect(selection.shortened).toBe(false)
    expect(selection.plan).toEqual([
      { version: '1.0.4', full: true },
      { version: '1.0.3', full: true },
      { version: '1.0.2', full: false },
    ])
    expect(selection.releases[2]?.highlights).toHaveLength(1)
    expect(envelopeBytes(selection.releases, selection.shortened)).toBe(bound)
  })

  it('reconsiders a full predecessor when omitting the fallback would overflow its exact-bound envelope', () => {
    const bound = WHATS_NEW_CONTENT_DECODE_MAX_BYTES
    const overhead = envelopeBytes(
      parseChangelog(withFallback(''), ALLOWED, REPOSITORY).slice(0, 2),
      false,
    )
    const all = parseChangelog(withFallback('x'.repeat(bound - overhead)), ALLOWED, REPOSITORY)
    expect(envelopeBytes(all.slice(0, 2), false)).toBe(bound)
    const selection = selectWhatsNewReleases(all, REPOSITORY)
    expect(selection.plan).toEqual([
      { version: '1.0.4', full: true },
      { version: '1.0.3', full: false },
      { version: '1.0.2', full: false },
    ])
    expect(selection.shortened).toBe(true)
    const plain = JSON.stringify({ schema: 1, releases: selection.releases, shortened: true })
    expect(Buffer.byteLength(plain)).toBeLessThan(bound)
    expect(parseWhatsNewContent(encodedText(plain)).releases).toEqual(selection.releases)
  })

  it('rejects decoded fits that the real encoder cannot ship, with a named newest-only refusal', () => {
    const detail = Array.from({ length: 1300 }, (_, index) =>
      createHash('sha256').update(String(index)).digest('base64'),
    ).join('')
    const all = parseChangelog(
      '## [1.0.4] - 2026-10-05\n\n### Fixed\n\n- Current fix.\n\n' +
        `## [1.0.3] - 2026-10-04\n\n### Fixed\n\n- ${detail}\n`,
      ALLOWED,
      REPOSITORY,
    )
    const plain = JSON.stringify({ schema: 1, releases: all })
    expect(Buffer.byteLength(plain)).toBeLessThan(WHATS_NEW_CONTENT_DECODE_MAX_BYTES)
    const encoded = encodeWhatsNewContent(plain)
    expect(encoded.kind).toBe('over-budget')
    if (encoded.kind !== 'over-budget') throw new Error('expected encoded-size overflow')
    expect(encoded.bytes).toBeGreaterThan(WHATS_NEW_CONTENT_MAX_BYTES)
    expect(encoded.maxBytes).toBe(WHATS_NEW_CONTENT_MAX_BYTES)
    const selection = selectWhatsNewReleases(all, REPOSITORY)
    expect(selection.plan).toEqual([
      { version: '1.0.4', full: true },
      { version: '1.0.3', full: false },
    ])
    expect(selection.shortened).toBe(true)
    expect(() => selectWhatsNewReleases(all.slice(1), REPOSITORY)).toThrow(
      "CHANGELOG.md 1.0.3: its release notes cannot fit the What's New artifact encoding bound",
    )
  })

  it('chooses the best feasible complete plan against an exhaustive seeded random-size oracle', () => {
    let seed = 79
    const random = (max: number) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed % max
    }
    // Independently list all ranked plans, then filter with the real encoder.
    // The fallback's short form is its standing policy, not a reduction.
    for (let sample = 0; sample < 32; sample++) {
      const all = parseChangelog(
        [0, 1, 2]
          .map(
            (index) =>
              `## [1.0.${String(4 - index)}] - 2026-10-05\n\n` +
              (index === 2 || (sample >> index) % 2 === 1
                ? `### Highlights\n\n- ${'é🚀x'.repeat(random(25) + 1)}\n\n`
                : '') +
              `### Fixed\n\n- ${'x'.repeat(random(700))} End.\n`,
          )
          .join('\n'),
        ALLOWED,
        REPOSITORY,
      )
      const newest = all[0]
      const previous = all[1]
      const fallback = all[2]
      if (newest === undefined || previous === undefined || fallback === undefined)
        throw new Error('oracle fixture requires three releases')
      const ranked = [previous, short(previous), undefined].flatMap((entry, form) => {
        const releases = entry === undefined ? [newest] : [newest, entry]
        const plan = [
          { version: newest.version, full: true },
          { version: previous.version, full: form === 0, ...(form === 2 && { omitted: true }) },
        ]
        if (releases.some((release) => release.highlights.length > 0))
          return { releases, plan, shortened: form !== 0 }
        return [
          {
            releases: [...releases, short(fallback)],
            plan: [...plan, { version: fallback.version, full: false }],
            shortened: form !== 0,
          },
          {
            releases,
            plan: [...plan, { version: fallback.version, full: false, omitted: true }],
            shortened: true,
          },
        ]
      })
      const before = JSON.stringify(all)
      const bounds = new Set([
        random(2500),
        ...ranked.flatMap((candidate) => {
          const bytes = envelopeBytes(candidate.releases, candidate.shortened)
          return [bytes - 1, bytes, bytes + 1]
        }),
      ])
      for (const bound of bounds) {
        const best = ranked.find((candidate) => {
          if (envelopeBytes(candidate.releases, candidate.shortened) > bound) return false
          return (
            encodeWhatsNewContent(
              JSON.stringify(
                candidate.shortened
                  ? { schema: 1, releases: candidate.releases, shortened: true }
                  : { schema: 1, releases: candidate.releases },
              ),
            ).kind === 'encoded'
          )
        })
        if (best === undefined) {
          expect(() => selectWhatsNewReleases(all, REPOSITORY, bound)).toThrow(
            'CHANGELOG.md 1.0.4:',
          )
        } else {
          expect(selectWhatsNewReleases(all, REPOSITORY, bound)).toEqual(best)
        }
      }
      expect(JSON.stringify(all)).toBe(before)
    }
  })
})

describe('writeWhatsNewContent', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-whats-new-')))
  afterAll(() => removeFolder(root))

  it('writes dist/whatsNew.json from CHANGELOG.md and package.json, which the schema reads', () => {
    writeFileSync(path.join(root, 'CHANGELOG.md'), CHANGELOG)
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
    mkdirSync(path.join(root, 'dist'), { recursive: true })
    const written = writeWhatsNewContent(root)
    expect(written.releases).toBe(2)
    const text = readFileSync(path.join(root, CONTENT_FILE), 'utf8')
    expect(written.bytes).toBe(Buffer.byteLength(text))
    const content = parseWhatsNewContent(text)
    expect(content.releases[1]?.highlights[0]?.tries).toEqual([
      { kind: 'command', id: 'museSpark.showWhatsNew' },
    ])
    // Relative links point at the manifest's repository.
    expect(text).toContain(`${repositoryUrl(manifest)}/blob/main/docs/acp.md`)
    expect(text).not.toContain('Older.')
  })

  it('keeps the newest earlier Highlights when the recent notes have none, without older full notes', () => {
    const changelog = `## [1.0.4] - 2026-10-05

### Fixed

- Current fix.

## [1.0.3] - 2026-10-04

### Fixed

- Previous fix.

## [1.0.2] - 2026-10-03

### Highlights

- Newest Highlights. <!-- try: command museSpark.showWhatsNew -->

### Added

- Old detailed notes.

## [1.0.1] - 2026-10-02

### Highlights

- Older Highlights.
`
    writeFileSync(path.join(root, 'CHANGELOG.md'), changelog)
    writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
    expect(writeWhatsNewContent(root).releases).toBe(3)
    const content = parseWhatsNewContent(readFileSync(path.join(root, CONTENT_FILE), 'utf8'))
    expect(content.releases.map((release) => release.version)).toEqual(['1.0.4', '1.0.3', '1.0.2'])
    expect(content.releases.slice(0, 2).every((release) => release.sections.length > 0)).toBe(true)
    expect(content.releases[2]?.sections).toEqual([
      {
        heading: '',
        blocks: [
          {
            t: 'p',
            c: [
              {
                t: 'link',
                href: `${repositoryUrl(manifest)}/blob/main/CHANGELOG.md`,
                c: [{ t: 'text', v: 'Full notes for 1.0.2' }],
              },
            ],
          },
        ],
      },
    ])
    expect(content.releases[2]?.highlights[0]?.tries).toEqual([
      { kind: 'command', id: 'museSpark.showWhatsNew' },
    ])
    expect(JSON.stringify(content)).not.toContain('Old detailed notes.')
    expect(JSON.stringify(content)).not.toContain('Older Highlights.')
    const page = renderWhatsNewPage({
      releases: releasesToShow(content.releases, '0.1.0', '1.0.4'),
      from: '0.1.0',
      current: '1.0.4',
      isShownOnUpdate: true,
      cspSource: 'vscode-webview://fake',
      nonce: 'test-nonce',
      scriptUri: 'webview/whatsNew.js',
      styleUri: 'webview/whatsNew.css',
      locale: 'en',
    })
    expect(page.html).toContain('Newest Highlights.')
    expect(page.html).not.toContain('Old detailed notes.')
    expect(page.links).toContain(WHATS_NEW_CHANGELOG_URL)
    // Retention never skips validation of the releases it leaves out.
    writeFileSync(
      path.join(root, 'CHANGELOG.md'),
      changelog.replace(
        'Older Highlights.',
        'Older Highlights. <!-- try: command museSpark.nope -->',
      ),
    )
    expect(() => writeWhatsNewContent(root)).toThrow('the Try it command "museSpark.nope"')
  })

  it('takes the Try it allow list from the manifest', () => {
    const allowed = contributedIds(manifest)
    expect(allowed.commands.has('museSpark.showWhatsNew')).toBe(true)
    expect(allowed.settings.has('museSpark.showWhatsNewOnUpdate')).toBe(true)
    expect(allowed.commands.has('workbench.action.openSettings')).toBe(false)
  })

  it(
    'parses the real CHANGELOG.md with the real manifest',
    () => {
      const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
      const releases = parseChangelog(changelog, contributedIds(manifest), repositoryUrl(manifest))
      expect(releases.length).toBeGreaterThan(0)
      expect(releases.some((release) => release.version === manifest.version)).toBe(true)
      parseWhatsNewContent(JSON.stringify({ schema: 1, releases }))
    },
    REAL_CHANGELOG_TIMEOUT_MS,
  )
})

describe('bounded lossless What’s New artifact', () => {
  let realReleases: ReturnType<typeof parseChangelog>

  beforeAll(() => {
    const changelog = readFileSync(path.resolve(import.meta.dirname, '../../CHANGELOG.md'), 'utf8')
    realReleases = parseChangelog(changelog, contributedIds(manifest), repositoryUrl(manifest))
  })

  it('reports decoded size overflow as a typed result, including the exact bytes and bound', () => {
    const plain = JSON.stringify({ schema: 1, releases: [] }).padEnd(
      WHATS_NEW_CONTENT_DECODE_MAX_BYTES + 1,
    )
    expect(encodeWhatsNewContent(plain)).toEqual({
      kind: 'over-budget',
      bytes: WHATS_NEW_CONTENT_DECODE_MAX_BYTES + 1,
      maxBytes: WHATS_NEW_CONTENT_DECODE_MAX_BYTES,
    })
  })

  it('returns small content as a typed success and keeps non-size failures as errors', () => {
    const plain = JSON.stringify({ schema: 1, releases: [] })
    expect(encodeWhatsNewContent(plain)).toEqual({ kind: 'encoded', text: plain })
    expect(() => encodeWhatsNewContent('{')).toThrow(SyntaxError)
    expect(() => encodeWhatsNewContent('{"schema":2,"releases":[]}')).toThrow()
  })

  it('ships the same releases as today for the real CHANGELOG', () => {
    const selection = selectWhatsNewReleases(realReleases, repositoryUrl(manifest))
    expect(selection.releases.map((release) => release.version)).toEqual(
      realReleases.slice(0, 2).map((release) => release.version),
    )
    expect(selection.releases.every((release) => release.sections.length > 0)).toBe(true)
    expect(selection.shortened).toBe(false)
    expect(selection.plan).toEqual(
      selection.releases.map((release) => ({ version: release.version, full: true })),
    )
    expect(JSON.stringify(selectWhatsNewReleases(realReleases, repositoryUrl(manifest)))).toBe(
      JSON.stringify(selection),
    )
  })

  it(
    'keeps both complete releases identical after generated artifact encoding',
    () => {
      const releases = realReleases.slice(0, 2)
      const plain = JSON.stringify({ schema: 1, releases })
      const encoded = encodedText(plain)
      expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(40 * 1024)
      // Small notes ship as written; only notes over the cap are packed.
      if (Buffer.byteLength(plain) > 40 * 1024) {
        expect(JSON.parse(encoded)).toHaveProperty('encoding', 'br')
      } else {
        expect(encoded).toBe(plain)
      }
      expect(parseWhatsNewContent(encoded)).toEqual(JSON.parse(plain))
    },
    REAL_CHANGELOG_TIMEOUT_MS,
  )

  it('packs real release notes that exceed the cap and decodes them losslessly', () => {
    const all = realReleases
    // A whole release may jump past the decode limit; try the next contiguous run.
    let plain = ''
    for (let start = 0; start < all.length; start++) {
      let count = 1
      while (
        count < all.length - start &&
        Buffer.byteLength(
          JSON.stringify({ schema: 1, releases: all.slice(start, start + count) }),
        ) <= WHATS_NEW_CONTENT_MAX_BYTES
      ) {
        count += 1
      }
      const candidate = JSON.stringify({ schema: 1, releases: all.slice(start, start + count) })
      if (Buffer.byteLength(candidate) <= WHATS_NEW_CONTENT_DECODE_MAX_BYTES) {
        plain = candidate
        break
      }
    }
    expect(Buffer.byteLength(plain)).toBeGreaterThan(40 * 1024)
    expect(Buffer.byteLength(plain)).toBeLessThanOrEqual(WHATS_NEW_CONTENT_DECODE_MAX_BYTES)
    const encoded = encodedText(plain)
    expect(JSON.parse(encoded)).toHaveProperty('encoding', 'br')
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(40 * 1024)
    expect(parseWhatsNewContent(encoded)).toEqual(JSON.parse(plain))
  })

  it('refuses expansion past the bounded decoded tree', () => {
    const plain = JSON.stringify({ schema: 1, releases: [] }).padEnd(75 * 1024 + 1)
    const encoded = JSON.stringify({
      encoding: 'br',
      data: brotliCompressSync(plain).toString('base64'),
    })
    expect(() => parseWhatsNewContent(encoded)).toThrow()
  })

  it('refuses oversized packed input and malformed envelopes', () => {
    const data = brotliCompressSync(JSON.stringify({ schema: 1, releases: [] })).toString('base64')
    const oversized = JSON.stringify({ encoding: 'br', data }).padEnd(40 * 1024 + 1)
    expect(() => parseWhatsNewContent(oversized)).toThrow()
    expect(() =>
      parseWhatsNewContent(JSON.stringify({ encoding: 'br', data: 'invalid*' })),
    ).toThrow()
  })
})
