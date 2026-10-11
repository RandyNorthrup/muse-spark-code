// @vitest-environment jsdom
// What's New's page (M99, PLAN.md D79): a strict CSP with the load's nonce,
// every piece of the notes escaped, Try its only for contributed commands
// and settings, links by index, headings in order, and no axe violation
// (contrast is the harness's job: jsdom computes no colours).

import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import type { ReleaseNotes } from '../../src/core/whatsNew/whatsNewContent'
import {
  escapeHtml,
  isAllowedTry,
  renderWhatsNewPage,
  type WhatsNewPageOptions,
} from '../../src/host/whatsNew/whatsNewHtml'
import {
  UI_TEXT,
  WHATS_NEW_CHANGELOG_URL,
  WHATS_NEW_README_URL,
  WHATS_NEW_REPOSITORY_URL,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

const NONCE = 'n0nce-for-tests'
const CSP_SOURCE = 'vscode-webview://fake'

const RELEASES: readonly ReleaseNotes[] = [
  {
    version: '0.13.0',
    date: '2026-10-05',
    highlights: [
      {
        c: [{ t: 'p', c: [{ t: 'strong', c: [{ t: 'text', v: 'New page.' }] }] }],
        tries: [
          { kind: 'command', id: 'museSpark.showWhatsNew' },
          { kind: 'command', id: 'workbench.action.terminal.sendSequence' },
        ],
      },
      {
        c: [{ t: 'p', c: [{ t: 'text', v: 'A setting.' }] }],
        tries: [
          { kind: 'setting', id: 'museSpark.showWhatsNewOnUpdate' },
          { kind: 'setting', id: 'terminal.integrated.shell' },
        ],
      },
    ],
    sections: [
      {
        heading: 'Added',
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
                    { t: 'text', v: '<img src=x onerror=alert(1)> & "quotes"' },
                    { t: 'code', v: '</code><script>alert(2)</script>' },
                    {
                      t: 'link',
                      href: 'https://example.com/a?b=1&c=2',
                      c: [{ t: 'text', v: 'web' }],
                    },
                    { t: 'br' },
                    { t: 'em', c: [{ t: 'text', v: 'em' }] },
                    { t: 'del', c: [{ t: 'text', v: 'del' }] },
                  ],
                },
              ],
            ],
          },
          {
            t: 'list',
            ordered: true,
            start: 3,
            items: [[{ t: 'p', c: [{ t: 'text', v: 'three' }] }]],
          },
          {
            t: 'list',
            ordered: true,
            start: 1,
            items: [[{ t: 'p', c: [{ t: 'text', v: 'one' }] }]],
          },
          { t: 'pre', v: 'npm run build && <b>' },
          { t: 'quote', c: [{ t: 'p', c: [{ t: 'text', v: 'quoted' }] }] },
          { t: 'h', c: [{ t: 'text', v: 'Sub' }] },
        ],
      },
    ],
  },
  {
    version: '0.12.1',
    date: '2026-10-04',
    highlights: [],
    sections: [{ heading: '', blocks: [{ t: 'p', c: [{ t: 'text', v: 'A fix.' }] }] }],
  },
]

function render(overrides: Partial<WhatsNewPageOptions> = {}) {
  return renderWhatsNewPage({
    releases: RELEASES,
    from: undefined,
    current: '0.13.0',
    isShownOnUpdate: true,
    cspSource: CSP_SOURCE,
    nonce: NONCE,
    scriptUri: 'webview/dist/webview/whatsNew.js',
    styleUri: 'webview/dist/webview/whatsNew.css',
    locale: 'en',
    ...overrides,
  })
}

function documentOf(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

describe('renderWhatsNewPage', () => {
  it('carries a strict CSP: nothing by default, the stylesheet from the webview, the script by nonce', () => {
    const page = documentOf(render().html)
    const csp = page
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content')
    expect(csp).toBe(`default-src 'none'; style-src ${CSP_SOURCE}; script-src 'nonce-${NONCE}'`)
    expect(render().html).not.toContain('unsafe-')
    const scripts = page.querySelectorAll('script')
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.getAttribute('nonce')).toBe(NONCE)
    expect(scripts[0]?.getAttribute('type')).toBe('module')
    expect(scripts[0]?.getAttribute('src')).toBe('webview/dist/webview/whatsNew.js')
    expect(page.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe(
      'webview/dist/webview/whatsNew.css',
    )
    expect(page.querySelectorAll('[style]')).toHaveLength(0)
  })

  it('escapes every piece of the notes, so none of it becomes markup', () => {
    const { html } = render()
    const page = documentOf(html)
    expect(page.querySelectorAll('img')).toHaveLength(0)
    expect(page.querySelectorAll('b')).toHaveLength(0)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;')
    expect(page.querySelector('code')?.textContent).toBe('</code><script>alert(2)</script>')
    expect(page.querySelector('pre')?.textContent).toBe('npm run build && <b>')
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
  })

  it('renders Try its only for contributed commands and settings, and indexes what it rendered', () => {
    const page = render()
    expect(page.tries).toEqual([
      { kind: 'command', id: 'museSpark.showWhatsNew' },
      { kind: 'setting', id: 'museSpark.showWhatsNewOnUpdate' },
    ])
    const buttons = [...documentOf(page.html).querySelectorAll<HTMLElement>('button[data-try]')]
    expect(buttons.map((button) => [button.dataset['try'], button.textContent])).toEqual([
      ['0', UI_TEXT.whatsNewTryIt],
      ['1', UI_TEXT.whatsNewOpenSetting],
    ])
    // Each button is described by its highlight's text.
    const described = buttons[0]?.getAttribute('aria-describedby') ?? ''
    expect(documentOf(page.html).querySelector(`#${described}`)?.textContent).toBe('New page.')
  })

  it('links by index: the notes’ web links, then the full changelog, README and repository', () => {
    const page = render()
    expect(page.links).toEqual([
      'https://example.com/a?b=1&c=2',
      WHATS_NEW_CHANGELOG_URL,
      WHATS_NEW_README_URL,
      WHATS_NEW_REPOSITORY_URL,
    ])
    const anchors = [...documentOf(page.html).querySelectorAll<HTMLElement>('a[data-link]')]
    expect(anchors.map((anchor) => [anchor.dataset['link'], anchor.getAttribute('href')])).toEqual(
      page.links.map((link, index) => [String(index), link]),
    )
    // A link that is not http or https is its text only.
    const odd = renderWhatsNewPage({
      releases: [
        {
          version: '0.13.0',
          date: '2026-10-05',
          highlights: [],
          sections: [
            {
              heading: 'Added',
              blocks: [
                {
                  t: 'p',
                  c: [{ t: 'link', href: 'javascript:alert(1)', c: [{ t: 'text', v: 'bad' }] }],
                },
              ],
            },
          ],
        },
      ],
      from: undefined,
      current: '0.13.0',
      isShownOnUpdate: true,
      cspSource: CSP_SOURCE,
      nonce: NONCE,
      scriptUri: 's',
      styleUri: 'c',
      locale: 'en',
    })
    expect(odd.html).not.toContain('javascript:')
    expect(odd.links).toEqual([
      WHATS_NEW_CHANGELOG_URL,
      WHATS_NEW_README_URL,
      WHATS_NEW_REPOSITORY_URL,
    ])
  })

  it('renders one quiet, indexed star link in the footer', () => {
    const { html, links } = render()
    const anchors = [...documentOf(html).querySelectorAll<HTMLAnchorElement>(':scope footer a')]
    const stars = anchors.filter((anchor) => anchor.href === WHATS_NEW_REPOSITORY_URL)
    expect(stars).toHaveLength(1)
    expect(stars[0]?.textContent).toBe(
      'Enjoying Muse Spark Code? A star on GitHub helps other people find it.',
    )
    expect(stars[0]?.dataset['link']).toBe(String(links.indexOf(WHATS_NEW_REPOSITORY_URL)))
  })

  it('reads the installed star sentence at render time and escapes it', () => {
    const sentence = 'Gefällt Ihnen Muse Spark Code? <img src=x onerror="bad"> & \'GitHub\''
    setUiText({ ...EN, whatsNewStarGithub: sentence }, 'de')
    try {
      const { html } = render({ locale: 'de' })
      const anchor = [
        ...documentOf(html).querySelectorAll<HTMLAnchorElement>(':scope footer a'),
      ].find((candidate) => candidate.href === WHATS_NEW_REPOSITORY_URL)
      expect(anchor?.textContent).toBe(sentence)
      expect(anchor?.querySelector('img')).toBeNull()
      expect(html).toContain('&lt;img src=x onerror=&quot;bad&quot;&gt; &amp; &#39;GitHub&#39;')
    } finally {
      setUiText(EN, BASE_LOCALE)
    }
  })

  it('heads the page, each release and each section in order, the notes marked English', () => {
    const page = documentOf(render().html)
    expect([...page.querySelectorAll('h1, h2, h3, h4')].map((heading) => heading.tagName)).toEqual([
      'H1',
      'H2',
      'H3',
      'H3',
      'H4',
      'H2',
    ])
    expect(page.querySelector('h1')?.textContent).toBe(UI_TEXT.whatsNewTitle)
    expect(page.querySelector('.lead')?.textContent).toBe('You’re on version 0.13.0.')
    expect(page.documentElement.lang).toBe('en')
    expect(page.querySelector('.notes')?.getAttribute('lang')).toBe('en')
    expect(page.querySelector('ol[start="3"]')).not.toBeNull()
    expect(page.querySelectorAll('ol:not([start])')).toHaveLength(1)
    expect(page.querySelector('.date')?.textContent).toContain('2026')
  })

  it('says where an update came from, notes the English in another language, and binds the toggle', () => {
    const updated = documentOf(
      render({ from: '0.12.1', locale: 'de', isShownOnUpdate: false }).html,
    )
    expect(updated.querySelector('.lead')?.textContent).toBe('Updated from 0.12.1 to 0.13.0.')
    expect(updated.querySelector('.note')?.textContent).toBe(UI_TEXT.whatsNewNotesInEnglish)
    expect(updated.documentElement.lang).toBe('de')
    const toggle = updated.querySelector('#hide-on-update')
    expect(toggle instanceof HTMLInputElement && toggle.checked).toBe(true)
    const shown = documentOf(render().html).querySelector('#hide-on-update')
    expect(shown instanceof HTMLInputElement && shown.checked).toBe(false)
    expect(documentOf(render().html).querySelector('.note')).toBeNull()
  })

  it('says so when no notes ship with the version', () => {
    const page = documentOf(render({ releases: [] }).html)
    expect(page.body.querySelector(':scope > main > p:not(.lead)')?.textContent).toBe(
      'No release notes ship with version 0.13.0.',
    )
  })

  it('has no accessibility violation axe can see without colours', async () => {
    const html = render({ from: '0.12.1' }).html
    document.replaceChild(
      document.importNode(documentOf(html).documentElement, true),
      document.documentElement,
    )
    document.documentElement.lang = 'en'
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    })
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})

describe('isAllowedTry', () => {
  it('allows the commands the extension registers and the settings it declares, nothing else', () => {
    expect(isAllowedTry({ kind: 'command', id: 'museSpark.showWhatsNew' })).toBe(true)
    expect(isAllowedTry({ kind: 'command', id: 'museSpark.notACommand' })).toBe(false)
    expect(isAllowedTry({ kind: 'command', id: 'workbench.action.openSettings' })).toBe(false)
    expect(isAllowedTry({ kind: 'setting', id: 'museSpark.showWhatsNewOnUpdate' })).toBe(true)
    expect(isAllowedTry({ kind: 'setting', id: 'museSpark.toString' })).toBe(false)
    expect(isAllowedTry({ kind: 'setting', id: 'showWhatsNewOnUpdate' })).toBe(false)
    expect(isAllowedTry({ kind: 'setting', id: 'editor.fontSize' })).toBe(false)
  })
})
