// What's New's content, made at build time from CHANGELOG.md (M99, PLAN.md
// D79): released sections only, Highlights and their Try its checked
// against what the manifest contributes, Markdown reduced to text-only
// parts, and the file the build writes read back through the extension's
// schema.

import { brotliCompressSync } from 'node:zlib'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  CONTENT_FILE,
  contributedIds,
  highlightsProblem,
  MAX_HIGHLIGHTS,
  parseChangelog,
  repositoryUrl,
  writeWhatsNewContent,
} from '../../scripts/lib/whatsNewContent.mjs'
import {
  encodeWhatsNewContent,
  parseWhatsNewContent,
} from '../../src/core/whatsNew/whatsNewContent'
import { releasesToShow } from '../../src/core/whatsNew/whatsNewVersions'
import { renderWhatsNewPage } from '../../src/host/whatsNew/whatsNewHtml'
import {
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

describe('parseChangelog', () => {
  const releases = parseChangelog(CHANGELOG, ALLOWED, REPOSITORY)

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
    expect(content.releases[2]?.sections).toEqual([])
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

  it('parses the real CHANGELOG.md with the real manifest', () => {
    const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
    const releases = parseChangelog(changelog, contributedIds(manifest), repositoryUrl(manifest))
    expect(releases.length).toBeGreaterThan(0)
    expect(releases.some((release) => release.version === manifest.version)).toBe(true)
    parseWhatsNewContent(JSON.stringify({ schema: 1, releases }))
  })
})

describe('bounded lossless What’s New artifact', () => {
  it('keeps both complete releases identical after generated artifact encoding', () => {
    const changelog = readFileSync(path.resolve(import.meta.dirname, '../../CHANGELOG.md'), 'utf8')
    const releases = parseChangelog(
      changelog,
      contributedIds(manifest),
      repositoryUrl(manifest),
    ).slice(0, 2)
    const plain = JSON.stringify({ schema: 1, releases })
    const encoded = encodeWhatsNewContent(plain)
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(40 * 1024)
    // Small notes ship as written; only notes over the cap are packed.
    if (Buffer.byteLength(plain) > 40 * 1024) {
      expect(JSON.parse(encoded)).toHaveProperty('encoding', 'br')
    } else {
      expect(encoded).toBe(plain)
    }
    expect(parseWhatsNewContent(encoded)).toEqual(JSON.parse(plain))
  })

  it('packs real release notes that exceed the cap and decodes them losslessly', () => {
    const changelog = readFileSync(path.resolve(import.meta.dirname, '../../CHANGELOG.md'), 'utf8')
    const all = parseChangelog(changelog, contributedIds(manifest), repositoryUrl(manifest))
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
    const encoded = encodeWhatsNewContent(plain)
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
