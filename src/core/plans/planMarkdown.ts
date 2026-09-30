// A plan read with the panel's own Markdown grammar (M79, PLAN.md D49): its
// top-level heading, its steps, whether it holds raw HTML, and the brief the
// model gets. MarkdownView renders a reply with react-markdown, whose
// remark-parse is `mdast-util-from-markdown`, and the panel's remark-gfm adds
// `micromark-extension-gfm` and `mdast-util-gfm` (no options): the same
// three, at the versions those resolve to, parse the plan here, without
// unified around them (PR #53's second review).
//
// What the model gets is what the user saw, by construction (the third
// review): the panel shows a plan reply through `showPlanParts`
// (shared/planView.ts), which turns every part of the plan into rendered
// text (a link's destination beside its text, a picture's source, a
// definition, a footnote, a code fence's info string), and the brief is that
// same rewritten tree written back as Markdown (`mdast-util-to-markdown`, the
// version remark-gfm's writer resolves to). Only raw HTML stays unrendered,
// and a reply holding it is saved but not started.
//
// The parser is 114 KiB, so this module is not in the activation bundle: it
// is built into dist/planMarkdown.js (host/planMarkdownEntry.ts), loaded on
// the first plan action (host/planMarkdownBundle.ts); the bundle-split gate
// (scripts/check-bundle-split.mjs) keeps it out of dist/extension.js. It
// imports no value of shared/constants (which would bring the English table
// along): it reads, and planDocument.ts cuts and caps what it read.

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfm } from 'micromark-extension-gfm'
import { showPlanParts } from '../../shared/planView'
import type { PlanMarkdown } from './planDocument'

/** The parts of a parsed Markdown node (mdast) this module reads. */
interface MarkdownNode {
  readonly type: string
  readonly value?: string | undefined
  readonly depth?: number | undefined
  readonly ordered?: boolean | null | undefined
  readonly children?: readonly MarkdownNode[] | undefined
}

const WHITESPACE = /\s+/g
// The panel's parser: remark-parse's options once remark-gfm (no options) is in.
const MARKDOWN_OPTIONS = { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }
// The brief's writer: GFM, and the list and rule markers a plan usually has.
const BRIEF_OPTIONS: Parameters<typeof toMarkdown>[1] = {
  extensions: [gfmToMarkdown()],
  bullet: '-',
  rule: '-',
}
const HTML_NODE = 'html'

/** Text on one line, its runs of white space one space. */
function oneLine(text: string): string {
  return text.replaceAll(WHITESPACE, ' ').trim()
}

/** The plan as the panel parses it. */
function parseMarkdown(text: string): ReturnType<typeof fromMarkdown> {
  return fromMarkdown(text, MARKDOWN_OPTIONS)
}

/** The plan as the panel shows a plan reply: every part rendered text. */
function shownTree(text: string): ReturnType<typeof fromMarkdown> {
  const tree = parseMarkdown(text)
  showPlanParts(tree)
  return tree
}

function childrenOf(node: MarkdownNode): readonly MarkdownNode[] {
  return node.children ?? []
}

/** Every node of the tree, depth first. */
function nodesOf(node: MarkdownNode): readonly MarkdownNode[] {
  return [node, ...childrenOf(node).flatMap((child) => nodesOf(child))]
}

/** A node's text: its text and code, markup gone, raw HTML left out, a hard break a space. */
function textOf(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode': {
      return node.value ?? ''
    }
    case 'break': {
      return ' '
    }
    default: {
      return childrenOf(node)
        .map((child) => textOf(child))
        .join('')
    }
  }
}

/** The text of the plan's first top-level heading (`# ` or underlined with `=`), if any. */
export function topHeading(text: string): string | undefined {
  const blocks = childrenOf(shownTree(text))
  for (const node of blocks) {
    const heading = node.type === 'heading' && node.depth === 1 ? oneLine(textOf(node)) : ''
    if (heading !== '') {
      return heading
    }
  }
  return undefined
}

/** Whether the plan holds raw HTML outside code (a comment, a tag), which the panel never renders. */
export function hasRawHtml(text: string): boolean {
  return nodesOf(parseMarkdown(text)).some((node) => node.type === HTML_NODE)
}

/** A list item's first paragraph as shown (no task box, no markup), on one line. */
function itemText(item: MarkdownNode): string {
  const paragraph = childrenOf(item).find((child) => child.type === 'paragraph')
  return oneLine(paragraph === undefined ? '' : textOf(paragraph))
}

/**
 * The items of the plan's top-level numbered lists, or, when it numbers
 * none, of its top-level bulleted lists, as the panel shows them, empty ones
 * left out. Nested items and further paragraphs belong to their item.
 */
export function listItems(body: string): readonly string[] {
  const ordered: string[] = []
  const bullets: string[] = []
  const blocks = childrenOf(shownTree(body))
  for (const list of blocks) {
    if (list.type !== 'list') {
      continue
    }
    for (const item of childrenOf(list)) {
      const text = itemText(item)
      if (text !== '') {
        ;(list.ordered === true ? ordered : bullets).push(text)
      }
    }
  }
  return ordered.length > 0 ? ordered : bullets
}

/**
 * The plan as the model gets it: the tree the panel shows, written back as
 * Markdown. Every text in it is text the panel rendered (raw HTML aside,
 * which the caller refuses in a reply).
 */
export function briefText(text: string): string {
  return toMarkdown(shownTree(text), BRIEF_OPTIONS)
}

/** All four, as dist/planMarkdown.js exports them. */
export const PLAN_MARKDOWN: PlanMarkdown = { topHeading, listItems, hasRawHtml, briefText }
