// What's New as plain text (M99 in other editors, PLAN.md D79): the same
// shipped content the page renders (src/core/whatsNew/whatsNewContent.ts),
// written for editors with no webview page. ACP's `/whatsnew` answers with
// it, so a Zed, Neovim or Emacs session reads this version's release notes
// with no model turn. Pure: no `vscode` import, so it is unit-tested
// directly. The notes stay English (D79); only the wrapping words are the
// display language's, through the same table keys the page reads, so no new
// translated string is needed. Dates stay the changelog's `YYYY-MM-DD`,
// where the page localizes them. Try its stay out: another editor has no
// channel that runs them.

import type { Block, Highlight, Inline, ReleaseNotes, WhatsNewContent } from './whatsNewContent'
import { releasesToShow } from './whatsNewVersions'
import { UI_TEXT, WHATS_NEW_CHANGELOG_URL } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

export interface WhatsNewTextOptions {
  /** Newest first, as `releasesToShow` picked them. */
  readonly releases: readonly ReleaseNotes[]
  /** The content's `shortened`: an older release was shortened or left out, so the text points at the full changelog. */
  readonly isShortened?: boolean | undefined
  /** The version updated from, when the text follows an upgrade from a known one. */
  readonly from: string | undefined
  readonly current: string
}

function inlines(nodes: readonly Inline[]): string {
  return nodes.map((node) => inline(node)).join('')
}

function inline(node: Inline): string {
  switch (node.t) {
    case 'text': {
      return node.v
    }
    case 'code': {
      return `\`${node.v}\``
    }
    case 'br': {
      return '\n'
    }
    case 'link': {
      const text = inlines(node.c)
      return text === '' || text === node.href ? node.href : `${text} <${node.href}>`
    }
    default: {
      return inlines(node.c)
    }
  }
}

const LIST_MARKER = /^(-|\d+\.)\s/

function blocks(nodes: readonly Block[], indent: string): string[] {
  return nodes.flatMap((node, index) =>
    index === 0 ? block(node, indent) : ['', ...block(node, indent)],
  )
}

function block(node: Block, indent: string): string[] {
  switch (node.t) {
    case 'p':
    case 'h': {
      return [`${indent}${inlines(node.c)}`]
    }
    case 'pre': {
      return node.v.split('\n').map((line) => `${indent}  ${line}`)
    }
    case 'quote': {
      return blocks(node.c, '').map((line) => (line === '' ? '' : `${indent}> ${line}`))
    }
    case 'list': {
      const lines: string[] = []
      for (const [index, item] of node.items.entries()) {
        if (index > 0) lines.push('')
        const marker = node.ordered ? `${String(node.start + index)}. ` : '- '
        const [first, ...rest] = blocks(item, '')
        const inner = (first ?? '').trimStart()
        pushWrapped(
          lines,
          LIST_MARKER.test(inner) ? `${indent}${inner}` : `${indent}${marker}${inner}`,
          rest,
          `${indent}  `,
        )
      }
      return lines
    }
  }
}

/** One logical line, wrapping its hard breaks under the continuation indent. */
function pushWrapped(
  target: string[],
  head: string,
  tail: readonly string[],
  indent: string,
): void {
  const [first, ...rest] = [head, ...tail].flatMap((line) => line.split('\n'))
  target.push(first ?? '')
  for (const part of rest) target.push(part === '' ? '' : `${indent}${part.trimStart()}`)
}

function highlight(entry: Highlight): string[] {
  const [first, ...rest] = blocks(entry.c, '')
  const head = (first ?? '').trimStart()
  if (head === '' && rest.length === 0) return []
  const lines: string[] = []
  pushWrapped(lines, LIST_MARKER.test(head) ? head : `- ${head}`, rest, '  ')
  return [...lines, '']
}

function release(release: ReleaseNotes): string[] {
  const lines = [
    `## ${release.version}`,
    fill(UI_TEXT.whatsNewReleased, { date: release.date }),
    '',
  ]
  if (release.highlights.length > 0) {
    lines.push(`### ${UI_TEXT.whatsNewHighlights}`, '')
    for (const entry of release.highlights) lines.push(...highlight(entry))
  }
  for (const section of release.sections) {
    if (section.heading !== '') lines.push(`### ${section.heading}`, '')
    lines.push(...blocks(section.blocks, ''), '')
  }
  return lines
}

/** The release notes as plain text, newest release first. */
export function formatWhatsNewText(options: WhatsNewTextOptions): string {
  const lines = [
    `# ${UI_TEXT.whatsNewTitle}`,
    options.from === undefined
      ? fill(UI_TEXT.whatsNewVersion, { version: options.current })
      : fill(UI_TEXT.whatsNewUpdatedFrom, { from: options.from, to: options.current }),
    '',
  ]
  if (options.releases.length === 0) {
    lines.push(fill(UI_TEXT.whatsNewNoNotes, { version: options.current }), '')
  }
  for (const releaseNotes of options.releases) lines.push(...release(releaseNotes))
  if (options.isShortened === true) lines.push(UI_TEXT.whatsNewEarlierNotes, '')
  lines.push(`${UI_TEXT.whatsNewFullChangelog}: ${WHATS_NEW_CHANGELOG_URL}`)
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * The shipped content file's text, checked and rendered for the installed
 * version: the same selection the page makes for a manual open
 * (`releasesToShow` with no upgrade-from version), never every release the
 * content file ships.
 */
export function whatsNewTextForContent(content: WhatsNewContent, current: string): string {
  return formatWhatsNewText({
    releases: releasesToShow(content.releases, undefined, current),
    isShortened: content.shortened,
    from: undefined,
    current,
  })
}
