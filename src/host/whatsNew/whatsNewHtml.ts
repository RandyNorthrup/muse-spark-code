// What's New's page (M99, PLAN.md D79), rendered on the host. Pure: no
// `vscode` import, so it is unit-tested directly. Security, as for the panel
// (D4, src/host/html.ts):
//
// - default-src 'none'; the stylesheet from the webview's resource origin;
//   the one script only with the per-load nonce; no inline style, no
//   'unsafe-inline' or 'unsafe-eval', no image or remote origin.
// - Every piece of text is escaped here. The content is a tree of text-only
//   parts (src/core/whatsNew/whatsNewContent.ts) and only the elements below
//   are ever written, so nothing in CHANGELOG.md becomes markup.
// - Links carry their address for keyboards and screen readers, and an
//   index the script sends back: the host opens its own copy through
//   `vscode.env.openExternal`. A Try it is rendered only for a command or
//   setting the extension contributes, and is an index too: the host runs
//   only an entry of the list of buttons this page rendered.
//
// The page's words are the display language's; the release notes stay
// English (D79), marked `lang="en"` for screen readers.

import type {
  Block,
  Highlight,
  Inline,
  ReleaseNotes,
  TryIt,
} from '../../core/whatsNew/whatsNewContent'
import {
  COMMAND_IDS,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  UI_TEXT,
  WHATS_NEW_CHANGELOG_URL,
  WHATS_NEW_README_URL,
  WHATS_NEW_REPOSITORY_URL,
} from '../../shared/constants'
import { BASE_LOCALE, fill, formatDate } from '../../shared/l10n/text'
import {
  WHATS_NEW_LINK_ATTRIBUTE,
  WHATS_NEW_TOGGLE_ID,
  WHATS_NEW_TRY_ATTRIBUTE,
} from '../../shared/whatsNewPage'

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const HTML_UNSAFE = /[&<>"']/g
const WEB_LINK = /^https?:\/\//
const RELEASE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const NOTES_LANGUAGE = 'en'

/** Text safe inside an element or a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replaceAll(HTML_UNSAFE, (character) => HTML_ESCAPES[character] ?? character)
}

const CONTRIBUTED_COMMANDS: ReadonlySet<string> = new Set(Object.values(COMMAND_IDS))
const SETTING_PREFIX = `${SETTINGS_SECTION}.`

/**
 * Whether a Try it names a command the extension registers or a setting it
 * declares (the manifest test keeps both lists equal to package.json's).
 * Anything else is never rendered and never run.
 */
export function isAllowedTry(entry: TryIt): boolean {
  return entry.kind === 'command'
    ? CONTRIBUTED_COMMANDS.has(entry.id)
    : entry.id.startsWith(SETTING_PREFIX) &&
        Object.hasOwn(SETTING_DEFAULTS, entry.id.slice(SETTING_PREFIX.length))
}

export interface WhatsNewPageOptions {
  /** Newest first, as `releasesToShow` picked them. */
  readonly releases: readonly ReleaseNotes[]
  /** The version updated from, when the page follows an upgrade from a known one. */
  readonly from: string | undefined
  readonly current: string
  /** `museSpark.showWhatsNewOnUpdate`: the toggle reads "Don't show on updates", so it is checked when this is off. */
  readonly isShownOnUpdate: boolean
  /** `webview.cspSource`. */
  readonly cspSource: string
  readonly nonce: string
  readonly scriptUri: string
  readonly styleUri: string
  /** The display language's tag, for `<html lang>`. */
  readonly locale: string
}

export interface WhatsNewPage {
  readonly html: string
  /** The page's Try its, by the index its buttons carry. */
  readonly tries: readonly TryIt[]
  /** The page's link addresses, by the index its links carry. */
  readonly links: readonly string[]
}

class PageWriter {
  readonly tries: TryIt[] = []
  readonly links: string[] = []

  link(href: string, inner: string): string {
    if (!WEB_LINK.test(href)) {
      return inner
    }
    const index = this.links.length
    this.links.push(href)
    return `<a href="${escapeHtml(href)}" ${WHATS_NEW_LINK_ATTRIBUTE}="${String(index)}">${inner}</a>`
  }

  inlines(nodes: readonly Inline[]): string {
    return nodes.map((node) => this.inline(node)).join('')
  }

  inline(node: Inline): string {
    switch (node.t) {
      case 'text': {
        return escapeHtml(node.v)
      }
      case 'code': {
        return `<code>${escapeHtml(node.v)}</code>`
      }
      case 'br': {
        return '<br>'
      }
      case 'link': {
        return this.link(node.href, this.inlines(node.c))
      }
      default: {
        return `<${node.t}>${this.inlines(node.c)}</${node.t}>`
      }
    }
  }

  blocks(nodes: readonly Block[]): string {
    return nodes.map((node) => this.block(node)).join('')
  }

  block(node: Block): string {
    switch (node.t) {
      case 'p': {
        return `<p>${this.inlines(node.c)}</p>`
      }
      case 'h': {
        return `<h4>${this.inlines(node.c)}</h4>`
      }
      case 'pre': {
        // Focusable, so a keyboard can scroll a long line into view.
        return `<pre tabindex="0"><code>${escapeHtml(node.v)}</code></pre>`
      }
      case 'quote': {
        return `<blockquote>${this.blocks(node.c)}</blockquote>`
      }
      case 'list': {
        const items = node.items.map((item) => `<li>${this.blocks(item)}</li>`).join('')
        if (!node.ordered) {
          return `<ul>${items}</ul>`
        }
        return node.start === 1
          ? `<ol>${items}</ol>`
          : `<ol start="${String(node.start)}">${items}</ol>`
      }
    }
  }

  tryButton(entry: TryIt, describedBy: string): string {
    const index = this.tries.length
    this.tries.push(entry)
    const label = entry.kind === 'command' ? UI_TEXT.whatsNewTryIt : UI_TEXT.whatsNewOpenSetting
    return `<button type="button" ${WHATS_NEW_TRY_ATTRIBUTE}="${String(index)}" aria-describedby="${describedBy}">${escapeHtml(label)}</button>`
  }

  highlight(entry: Highlight, id: string): string {
    const buttons = entry.tries
      .filter((candidate) => isAllowedTry(candidate))
      .map((candidate) => this.tryButton(candidate, id))
      .join('')
    const actions = buttons === '' ? '' : `<p class="tries">${buttons}</p>`
    return `<li><div id="${id}" lang="${NOTES_LANGUAGE}">${this.blocks(entry.c)}</div>${actions}</li>`
  }

  release(release: ReleaseNotes, releaseIndex: number): string {
    const headingId = `release-${String(releaseIndex)}`
    const parts = [
      `<section class="release" aria-labelledby="${headingId}">`,
      `<h2 id="${headingId}">${escapeHtml(release.version)}</h2>`,
      `<p class="date">${escapeHtml(fill(UI_TEXT.whatsNewReleased, { date: releaseDate(release.date) }))}</p>`,
    ]
    if (release.highlights.length > 0) {
      const items = release.highlights
        .map((entry, index) =>
          this.highlight(entry, `highlight-${String(releaseIndex)}-${String(index)}`),
        )
        .join('')
      parts.push(
        `<h3>${escapeHtml(UI_TEXT.whatsNewHighlights)}</h3>`,
        `<ul class="highlights">${items}</ul>`,
      )
    }
    const notes = release.sections
      .map(
        (section) =>
          (section.heading === '' ? '' : `<h3>${escapeHtml(section.heading)}</h3>`) +
          this.blocks(section.blocks),
      )
      .join('')
    parts.push(`<div class="notes" lang="${NOTES_LANGUAGE}">${notes}</div>`, '</section>')
    return parts.join('')
  }
}

/** A CHANGELOG date (`YYYY-MM-DD`) in the display language, read as a local calendar day. */
function releaseDate(date: string): string {
  const match = RELEASE_DATE.exec(date)
  if (match === null) {
    return date
  }
  const [, year = '', month = '', day = ''] = match
  return formatDate(new Date(Number(year), Number(month) - 1, Number(day)).getTime())
}

/** The whole document, with the lists its script's indexes point into. */
export function renderWhatsNewPage(options: WhatsNewPageOptions): WhatsNewPage {
  const writer = new PageWriter()
  const csp = [
    `default-src 'none'`,
    `style-src ${options.cspSource}`,
    `script-src 'nonce-${options.nonce}'`,
  ].join('; ')
  const lead =
    options.from === undefined
      ? fill(UI_TEXT.whatsNewVersion, { version: options.current })
      : fill(UI_TEXT.whatsNewUpdatedFrom, { from: options.from, to: options.current })
  const languageNote = options.locale.startsWith(BASE_LOCALE)
    ? ''
    : `<p class="note">${escapeHtml(UI_TEXT.whatsNewNotesInEnglish)}</p>`
  const releases =
    options.releases.length === 0
      ? `<p>${escapeHtml(fill(UI_TEXT.whatsNewNoNotes, { version: options.current }))}</p>`
      : options.releases.map((release, index) => writer.release(release, index)).join('')
  const footer = [
    '<footer>',
    `<p>${writer.link(WHATS_NEW_CHANGELOG_URL, escapeHtml(UI_TEXT.whatsNewFullChangelog))}</p>`,
    `<p>${writer.link(WHATS_NEW_README_URL, escapeHtml(UI_TEXT.whatsNewReadme))}</p>`,
    `<p>${writer.link(WHATS_NEW_REPOSITORY_URL, escapeHtml(UI_TEXT.whatsNewStarGithub))}</p>`,
    `<p><label><input type="checkbox" id="${WHATS_NEW_TOGGLE_ID}"${options.isShownOnUpdate ? '' : ' checked'}> ${escapeHtml(UI_TEXT.whatsNewHideOnUpdate)}</label></p>`,
    '</footer>',
  ].join('')
  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(options.locale)}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeHtml(options.styleUri)}">
<title>${escapeHtml(UI_TEXT.whatsNewTitle)}</title>
</head>
<body>
<main aria-labelledby="whats-new-title">
<h1 id="whats-new-title">${escapeHtml(UI_TEXT.whatsNewTitle)}</h1>
<p class="lead">${escapeHtml(lead)}</p>
${languageNote}${releases}${footer}
</main>
<script type="module" nonce="${options.nonce}" src="${escapeHtml(options.scriptUri)}"></script>
</body>
</html>
`
  return { html, tries: writer.tries, links: writer.links }
}
