// What's New as plain text (M99 in other editors): the wrapping words, the
// release order, the inline and block shapes, and the installed language,
// through the real renderer with data passed in.

import { describe, expect, it } from 'vitest'
import type { ReleaseNotes, WhatsNewContent } from '../../src/core/whatsNew/whatsNewContent'
import { formatWhatsNewText, whatsNewTextForContent } from '../../src/core/whatsNew/whatsNewText'
import { UI_TEXT, WHATS_NEW_CHANGELOG_URL } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

const RELEASES: readonly ReleaseNotes[] = [
  {
    version: '0.18.2',
    date: '2026-10-12',
    highlights: [
      {
        c: [
          {
            t: 'p',
            c: [
              { t: 'strong', c: [{ t: 'text', v: 'New mark.' }] },
              { t: 'text', v: ' The panel shows it.' },
            ],
          },
        ],
        tries: [],
      },
    ],
    sections: [
      {
        heading: 'Fixed',
        blocks: [
          {
            t: 'list',
            ordered: false,
            start: 1,
            items: [
              [
                {
                  t: 'p',
                  c: [
                    { t: 'text', v: 'A crash on ' },
                    { t: 'code', v: 'oops' },
                    { t: 'text', v: '; see ' },
                    { t: 'link', href: 'https://example.com/note', c: [{ t: 'text', v: 'web' }] },
                    { t: 'text', v: ' and https://example.com/bare' },
                    { t: 'br' },
                    { t: 'em', c: [{ t: 'text', v: 'next line' }] },
                  ],
                },
              ],
              [{ t: 'p', c: [{ t: 'text', v: 'Second fix' }] }],
            ],
          },
        ],
      },
    ],
  },
]

function textOf(): string {
  return formatWhatsNewText({ releases: RELEASES, from: undefined, current: '0.18.2' })
}

describe('formatWhatsNewText', () => {
  it('heads the notes, leads with the installed version, and orders the release', () => {
    expect(textOf()).toBe(
      [
        `# ${UI_TEXT.whatsNewTitle}`,
        'You’re on version 0.18.2.',
        '',
        '## 0.18.2',
        'Released 2026-10-12',
        '',
        '### Highlights',
        '',
        '- New mark. The panel shows it.',
        '',
        '### Fixed',
        '',
        '- A crash on `oops`; see web <https://example.com/note> and https://example.com/bare',
        '  next line',
        '',
        '- Second fix',
        '',
        `${UI_TEXT.whatsNewFullChangelog}: ${WHATS_NEW_CHANGELOG_URL}`,
        '',
      ].join('\n'),
    )
  })

  it('leads with the upgrade range after an update from a known version', () => {
    const text = formatWhatsNewText({ releases: [], from: '0.18.1', current: '0.18.2' })
    expect(text).toContain('Updated from 0.18.1 to 0.18.2.')
  })

  it('says there are no notes when the content ships none', () => {
    expect(formatWhatsNewText({ releases: [], from: undefined, current: '0.18.2' })).toContain(
      'No release notes ship with version 0.18.2.',
    )
  })

  it('points at the full changelog when an older release was shortened', () => {
    const text = formatWhatsNewText({
      releases: RELEASES,
      isShortened: true,
      from: undefined,
      current: '0.18.2',
    })
    expect(text).toContain(UI_TEXT.whatsNewEarlierNotes)
    expect(text).toContain(WHATS_NEW_CHANGELOG_URL)
  })

  it('renders quotes, ordered lists and pre blocks as indented text', () => {
    const text = formatWhatsNewText({
      releases: [
        {
          version: '0.18.1',
          date: '2026-10-12',
          highlights: [],
          sections: [
            {
              heading: '',
              blocks: [
                { t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'quoted' }] }] },
                {
                  t: 'list',
                  ordered: true,
                  start: 3,
                  items: [[{ t: 'p', c: [{ t: 'text', v: 'three' }] }]],
                },
                { t: 'pre', v: 'a\nb' },
              ],
            },
          ],
        },
      ],
      from: undefined,
      current: '0.18.1',
    })
    expect(text).toContain('> quoted')
    expect(text).toContain('3. three')
    expect(text).toContain('  a\n  b')
  })

  it('reads the installed wrapping words at render time', () => {
    setUiText({ ...EN, whatsNewHighlights: 'Höhepunkte' }, 'de')
    try {
      expect(textOf()).toContain('### Höhepunkte')
    } finally {
      setUiText(EN, BASE_LOCALE)
    }
  })

  it('renders checked content for the installed version', () => {
    const content: WhatsNewContent = {
      schema: 1,
      releases: [...RELEASES],
      shortened: undefined,
    }
    expect(whatsNewTextForContent(content, '0.18.2')).toBe(textOf())
  })

  it('shows only the releases the page would show, not every shipped release', () => {
    const older: ReleaseNotes = {
      version: '0.18.1',
      date: '2026-10-10',
      highlights: [{ c: [{ t: 'p', c: [{ t: 'text', v: 'Older highlight.' }] }], tries: [] }],
      sections: [{ heading: 'Fixed', blocks: [{ t: 'p', c: [{ t: 'text', v: 'Older fix.' }] }] }],
    }
    const content: WhatsNewContent = {
      schema: 1,
      releases: [...RELEASES, older],
      shortened: undefined,
    }
    const text = whatsNewTextForContent(content, '0.18.2')
    expect(text).toContain('## 0.18.2')
    expect(text).not.toContain('## 0.18.1')
    expect(text).not.toContain('Older highlight.')
    expect(text).not.toContain('Older fix.')
  })
})
