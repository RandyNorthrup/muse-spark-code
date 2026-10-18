// What's New's content (M99, PLAN.md D79), made at build time from
// CHANGELOG.md. `npm run build` (scripts/build.mjs) writes dist/whatsNew.json,
// which the What's New bundle reads through its schema
// (src/core/whatsNew/whatsNewContent.ts) the first time it shows a page.
//
// - Only released sections count: `## [x.y.z] - YYYY-MM-DD`. `[Unreleased]`
//   is checked like a release (a bad Try it fails the change that adds it,
//   not the release) and left out, as is anything else under a level-two
//   heading.
// - Each `###` heading starts a section of that release's notes. A
//   `### Highlights` section is the release's curated list (one bullet list,
//   at most MAX_HIGHLIGHTS bullets for the release being made; older
//   releases are taken as written). A Highlight may end with
//   `<!-- try: command <id> -->` or `<!-- try: setting <id> -->`, which the
//   page turns into a button. The id must be a command or a setting the
//   manifest contributes, or the build fails. HTML comments are invisible on
//   GitHub, the Marketplace and VS Code's own changelog tab.
// - The Markdown becomes a tree of text-only parts (paragraphs, lists, code,
//   quotes, emphasis, links). Raw HTML never becomes markup: a comment is
//   dropped, any other tag is kept as its literal text; a picture is its alt
//   text; a relative link points at the repository on GitHub, and a link
//   with any scheme but http or https is kept as its text only.

import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { loadL10n } from './l10nSource.mjs'

const { encodeWhatsNewContent, WHATS_NEW_CONTENT_DECODE_MAX_BYTES } = await loadL10n(process.cwd())

export const HIGHLIGHTS_HEADING = 'Highlights'
export const MAX_HIGHLIGHTS = 5
export const CONTENT_FILE = 'dist/whatsNew.json'
const SCHEMA_VERSION = 1
// The full-notes window: the current release and its immediate
// predecessor. Eight releases measured 177,802 bytes, far beyond the
// content's budget, and since 0.17.0 even two full releases can exceed the
// decoded bound — so `selectWhatsNewReleases` ships the newest in full and
// fits older releases of this window around it (Highlights only, or left
// out), instead of failing the build. Earlier details remain available
// through the page's full-changelog link.
const FULL_NOTES_RELEASES = 2
/**
A released version, prereleases included. The writer classifies the
Markdown parser's own heading nodes with this (never raw lines, so a
fenced example or an indented heading cannot confuse it), and the
packager slices the parsed source ranges instead of matching headings
itself: one parser, never a second heading inventory.
*/
const RELEASE_VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const RELEASE_HEADING = new RegExp(String.raw`^\[(${RELEASE_VERSION})\] - (\d{4}-\d{2}-\d{2})$`)
const UNRELEASED_HEADING = '[Unreleased]'
const PATCH_RELEASE = /^\d+\.\d+\.(\d+)/
const TRY_DIRECTIVE = /^<!--\s*try:\s*(\S+)\s+(\S+)\s*-->$/
const TRY_START = /^<!--\s*try\b/
const COMMENT = /^<!--[\s\S]*-->$/
const WEB_LINK = /^https?:\/\//i
const ANY_SCHEME = /^[a-z][\d+.a-z-]*:/i
const REPOSITORY_SUFFIX = /\.git$/
const BRANCH = 'main'

/** The commands and settings a Highlight's "Try it" may name: what the manifest contributes. */
export function contributedIds(manifest) {
  return {
    commands: new Set(manifest.contributes.commands.map((entry) => entry.command)),
    settings: new Set(Object.keys(manifest.contributes.configuration.properties)),
  }
}

/** The repository's web address, from the manifest's `repository.url`. */
export function repositoryUrl(manifest) {
  return manifest.repository.url.replace(REPOSITORY_SUFFIX, '')
}

function textOf(node) {
  return typeof node.value === 'string'
    ? node.value
    : (node.children ?? []).map((child) => textOf(child)).join('')
}

function resolveHref(url, repository) {
  if (ANY_SCHEME.test(url) && !WEB_LINK.test(url)) {
    return
  }
  let href = url
  if (!WEB_LINK.test(url)) {
    href = url.startsWith('#')
      ? `${repository}/blob/${BRANCH}/CHANGELOG.md${url}`
      : `${repository}/blob/${BRANCH}/${url.replace(/^\.\//, '')}`
  }
  return WEB_LINK.test(href) ? href.replace(WEB_LINK, (scheme) => scheme.toLowerCase()) : undefined
}

/** Generated full-notes links obey the same URL rule as Markdown links. */
export function fullNotesHref(repository) {
  const href = resolveHref('CHANGELOG.md', repository)
  if (href === undefined)
    throw new Error("What's New repository URL must use HTTP or HTTPS (docs/RELEASING.md)")
  return href
}

function inlines(nodes, repository) {
  return nodes.flatMap((node) => inline(node, repository))
}

function inline(node, repository) {
  switch (node.type) {
    case 'text': {
      return [{ t: 'text', v: node.value }]
    }
    case 'inlineCode': {
      return [{ t: 'code', v: node.value }]
    }
    case 'break': {
      return [{ t: 'br' }]
    }
    case 'strong':
    case 'emphasis':
    case 'delete': {
      const t = { strong: 'strong', emphasis: 'em', delete: 'del' }[node.type]
      return [{ t, c: inlines(node.children, repository) }]
    }
    case 'link': {
      const href = resolveHref(node.url, repository)
      const children = inlines(node.children, repository)
      return href === undefined ? children : [{ t: 'link', href, c: children }]
    }
    case 'image':
    case 'imageReference': {
      return node.alt ? [{ t: 'text', v: node.alt }] : []
    }
    case 'html': {
      return COMMENT.test(node.value.trim()) ? [] : [{ t: 'text', v: node.value }]
    }
    default: {
      return node.children === undefined
        ? [{ t: 'text', v: textOf(node) }]
        : inlines(node.children, repository)
    }
  }
}

function blocks(nodes, repository) {
  return nodes.flatMap((node) => block(node, repository))
}

function block(node, repository) {
  switch (node.type) {
    case 'paragraph': {
      const content = inlines(node.children, repository)
      return content.length === 0 ? [] : [{ t: 'p', c: content }]
    }
    case 'heading': {
      return [{ t: 'h', c: inlines(node.children, repository) }]
    }
    case 'code': {
      return [{ t: 'pre', v: node.value }]
    }
    case 'blockquote': {
      return [{ t: 'quote', c: blocks(node.children, repository) }]
    }
    case 'list': {
      const items = node.children.filter((item) => !isHistorical(item))
      if (items.length === 0) return []
      return [
        {
          t: 'list',
          ordered: node.ordered === true,
          start: node.start ?? 1,
          items: items.map((item) => blocks(item.children, repository)),
        },
      ]
    }
    case 'table': {
      // A row per paragraph, its cells joined as Markdown would show them.
      return node.children.map((row) => ({
        t: 'p',
        c: row.children.flatMap((cell, index) => [
          ...(index === 0 ? [] : [{ t: 'text', v: ' | ' }]),
          ...inlines(cell.children, repository),
        ]),
      }))
    }
    case 'html': {
      return COMMENT.test(node.value.trim()) ? [] : [{ t: 'p', c: [{ t: 'text', v: node.value }] }]
    }
    case 'thematicBreak':
    case 'definition':
    case 'footnoteDefinition': {
      return []
    }
    default: {
      throw new Error(`CHANGELOG.md: unsupported Markdown block "${node.type}"`)
    }
  }
}

/** Every HTML node under a node, in order. */
function htmlNodes(node) {
  return node.type === 'html' ? [node] : (node.children ?? []).flatMap((child) => htmlNodes(child))
}

// Dated corrections retain the original release record, but omit its dormant
// claims from the current What's New page. Only explicit list-item markers count.
function isHistorical(item) {
  return htmlNodes(item).some(({ value }) => value.trim() === '<!-- whats-new: historical -->')
}

function triesOf(item, version, allowed) {
  const tries = []
  for (const { value } of htmlNodes(item)) {
    const comment = value.trim()
    if (!TRY_START.test(comment)) {
      continue
    }
    const match = TRY_DIRECTIVE.exec(comment)
    if (match === null) {
      throw new Error(
        `CHANGELOG.md ${version}: "${comment}" is not "<!-- try: command <id> -->" or "<!-- try: setting <id> -->"`,
      )
    }
    const [, kind, id] = match
    const lists = { command: allowed.commands, setting: allowed.settings }
    const known = Object.hasOwn(lists, kind) ? lists[kind] : undefined
    if (known === undefined) {
      throw new Error(`CHANGELOG.md ${version}: a Try it is a command or a setting, not "${kind}"`)
    }
    if (!known.has(id)) {
      throw new Error(
        `CHANGELOG.md ${version}: the Try it ${kind} "${id}" is not one the manifest contributes`,
      )
    }
    tries.push({ kind, id })
  }
  return tries
}

function highlightsOf(nodes, version, repository, allowed) {
  const content = nodes.filter((node) => !(node.type === 'html' && COMMENT.test(node.value.trim())))
  if (content.length !== 1 || content[0].type !== 'list') {
    throw new Error(
      `CHANGELOG.md ${version}: "### ${HIGHLIGHTS_HEADING}" must hold one bullet list`,
    )
  }
  // Validate every original Try it, including archived items, before publication.
  return content[0].children
    .map((item) => ({
      item,
      c: blocks(item.children, repository),
      tries: triesOf(item, version, allowed),
    }))
    .filter(({ item }) => !isHistorical(item))
    .map(({ item: _item, ...highlight }) => highlight)
}

function finishRelease(release, repository, allowed) {
  const sections = []
  let highlights = []
  // CX1R4 F6: the duplicate-heading check records the heading itself, not the
  // post-filter item count, so an archived first list still blocks a second.
  let hasHighlightsHeading = false
  for (const { heading, nodes } of release.parts) {
    if (heading === HIGHLIGHTS_HEADING) {
      if (hasHighlightsHeading) {
        throw new Error(`CHANGELOG.md ${release.version}: two "### ${HIGHLIGHTS_HEADING}" sections`)
      }
      hasHighlightsHeading = true
      highlights = highlightsOf(nodes, release.version, repository, allowed)
      continue
    }
    const content = blocks(nodes, repository)
    if (heading !== '' || content.length > 0) {
      sections.push({ heading, blocks: content })
    }
  }
  return { version: release.version, date: release.date, highlights, sections }
}

/**
The released sections of a CHANGELOG, newest first as written.

Each release carries its source range in a non-enumerable `range`: the
whole `## ` section, its LF/CRLF-terminated heading and its body, plus the `### Highlights`
subsection's offsets (heading line included) when it has one. The
returned array carries the same way a non-enumerable `unreleased`: the
`[Unreleased]` section's Highlights content offsets (bullets only), or
undefined when there is no such section. Both stay out of every JSON
envelope and artifact; the packager slices the parsed text by them
instead of inventorying headings a second time.

@param {string} markdown CHANGELOG.md's text
@param {{ commands: Set<string>, settings: Set<string> }} allowed what a Try it may name
@param {string} repository the repository's web address, for relative links
*/
export function parseChangelog(markdown, allowed, repository) {
  if (/\r(?!\n)/.test(markdown)) {
    throw new Error('CHANGELOG.md: CR-only line endings are not supported; use LF or CRLF')
  }
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  const releases = []
  const seen = new Set()
  let current
  let unreleased
  // The open Highlights span ends where the next `### ` heading (or the
  // section itself) starts.
  const closeHighlights = (end) => {
    if (
      current !== undefined &&
      current.highlightsStart !== undefined &&
      current.highlightsEnd === undefined
    ) {
      current.highlightsEnd = end
    }
  }
  const finish = (end) => {
    if (current === undefined) {
      return
    }
    closeHighlights(end)
    // [Unreleased] is checked but never shown.
    const release = finishRelease(current, repository, allowed)
    if (current.isDraft) {
      if (current.highlightsStart === undefined) {
        unreleased = { highlightsStart: undefined, highlightsEnd: undefined }
      } else {
        unreleased = {
          highlightsStart: current.highlightsContentStart,
          highlightsEnd: current.highlightsEnd,
        }
      }
      return
    }
    Object.defineProperty(release, 'range', {
      value: {
        start: current.start,
        end,
        headingStart: current.start,
        headingEnd: current.headingEnd,
        bodyStart: current.headingEnd,
        bodyEnd: end,
        highlightsStart: current.highlightsStart,
        highlightsEnd: current.highlightsEnd,
      },
      enumerable: false,
    })
    releases.push(release)
  }
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth <= 2) {
      const start = node.position.start.offset
      finish(start)
      current = undefined
      const heading = textOf(node).trim()
      const match = RELEASE_HEADING.exec(heading)
      if (heading === UNRELEASED_HEADING && node.depth === 2) {
        current = {
          version: 'Unreleased',
          date: '',
          isDraft: true,
          parts: [{ heading: '', nodes: [] }],
          start,
          highlightsStart: undefined,
          highlightsContentStart: undefined,
          highlightsEnd: undefined,
        }
      } else if (match !== null && node.depth === 2) {
        const [, version, date] = match
        if (node.position.start.line !== node.position.end.line) {
          throw new Error(
            `CHANGELOG.md ${version}: Setext release headings are not supported; use "## [version] - YYYY-MM-DD"`,
          )
        }
        const end = node.position.end.offset
        let terminator = 0
        if (markdown[end] === '\n') terminator = 1
        else if (markdown.slice(end, end + 2) === '\r\n') terminator = 2
        if (terminator === 0 || markdown.slice(start, end) !== `## ${heading}`) {
          throw new Error(
            `CHANGELOG.md ${version}: release headings must be "## [version] - YYYY-MM-DD" followed by LF or CRLF`,
          )
        }
        if (seen.has(version)) {
          throw new Error(`CHANGELOG.md has two sections for ${version}`)
        }
        seen.add(version)
        current = {
          version,
          date,
          parts: [{ heading: '', nodes: [] }],
          start,
          headingEnd: end + terminator,
          highlightsStart: undefined,
          highlightsContentStart: undefined,
          highlightsEnd: undefined,
        }
      }
      continue
    }
    if (current === undefined) {
      continue
    }
    if (node.type === 'heading' && node.depth === 3) {
      closeHighlights(node.position.start.offset)
      const heading = textOf(node).trim()
      if (heading === HIGHLIGHTS_HEADING) {
        current.highlightsStart = node.position.start.offset
        current.highlightsContentStart = node.position.end.offset
      }
      current.parts.push({ heading, nodes: [] })
      continue
    }
    current.parts.at(-1).nodes.push(node)
  }
  finish(markdown.length)
  Object.defineProperty(releases, 'unreleased', { value: unreleased, enumerable: false })
  return releases
}

/**
The kinds of parts some release notes are made of: everything the page has
a layout for. The screenshots render a fixed fixture, not the real notes
(test/harness/whats-new/CHANGELOG.fixture.md); the fixture must hold every
kind the real notes use, which whatsNewFixture.test.mjs checks with this.

@param {ReturnType<typeof parseChangelog>} releases
@returns {Set<string>}
*/
export function constructKinds(releases) {
  const kinds = new Set()
  const inline = (nodes) => {
    for (const node of nodes) {
      kinds.add(`inline:${node.t}`)
      if (node.c !== undefined) inline(node.c)
    }
  }
  const block = (nodes, listDepth) => {
    for (const node of nodes) {
      if (node.t === 'list') {
        kinds.add(`block:list:${node.ordered ? 'ordered' : 'bullets'}`)
        kinds.add(`block:list:depth:${String(listDepth + 1)}`)
        for (const item of node.items) {
          if (item.length > 1) kinds.add('block:list:item-with-blocks')
          block(item, listDepth + 1)
        }
      } else if (node.t === 'quote') {
        kinds.add('block:quote')
        block(node.c, listDepth)
      } else {
        kinds.add(`block:${node.t}`)
        if (node.c !== undefined) inline(node.c)
      }
    }
  }
  for (const [index, release] of releases.entries()) {
    kinds.add(index === 0 ? 'release' : 'release:further')
    for (const highlight of release.highlights) {
      kinds.add('highlight')
      block(highlight.c, 0)
      for (const { kind } of highlight.tries) kinds.add(`try:${kind}`)
    }
    for (const section of release.sections) {
      kinds.add(section.heading === '' ? 'section:untitled' : 'section')
      block(section.blocks, 0)
    }
  }
  return kinds
}

/**
Why a release cannot ship as written, or undefined (the changelog-version
test, M99): a minor or major release (patch 0) needs a Highlights list,
since it opens What's New, and no release being made has more than
MAX_HIGHLIGHTS of them.
*/
export function highlightsProblem(releases, version) {
  const release = releases.find((entry) => entry.version === version)
  if (release === undefined) {
    return `CHANGELOG.md has no released section for ${version}`
  }
  const count = release.highlights.length
  const isPatch = Number(PATCH_RELEASE.exec(version)?.[1] ?? 0) > 0
  if (count === 0 && !isPatch) {
    return `the ${version} section of CHANGELOG.md needs a "### ${HIGHLIGHTS_HEADING}" list of 1 to ${String(MAX_HIGHLIGHTS)} bullets: a minor or major release opens What's New with it (docs/RELEASING.md)`
  }
  return count > MAX_HIGHLIGHTS
    ? `the ${version} section of CHANGELOG.md has ${String(count)} Highlights; keep at most ${String(MAX_HIGHLIGHTS)}`
    : undefined
}

/** The exact final envelope shared by selection and artifact writing. */
function contentEnvelope(releases, shortened) {
  return JSON.stringify(
    shortened
      ? { schema: SCHEMA_VERSION, releases, shortened: true }
      : { schema: SCHEMA_VERSION, releases },
  )
}

/** A release's Highlights with a link to its full notes in CHANGELOG on GitHub. */
function highlightsOnly(release, href) {
  return {
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
                href,
                c: [{ t: 'text', v: `Full notes for ${release.version}` }],
              },
            ],
          },
        ],
      },
    ],
  }
}

/**
Enumerate complete plans, never provisional admissions (D79).

Preference is lexicographic, newest first: full > Highlights + link >
omitted, then the next release. The newest is always full. The standing
fallback has only Highlights + link and omitted forms, and is needed
only when the retained window has no Highlights. Keeping it alone does
not set `shortened`; reducing a window entry or omitting a needed
fallback does. At most three releases and 27 complete plans.

Every plan is measured with its final flag and the real encoder. All
feasible plans are considered in preference order; the first wins.
No feasible plan means a named refusal, never hiding the newest.

@param {import('../../src/core/whatsNew/whatsNewContent').ReleaseNotes[]} allReleases parsed, newest first
@param {string} repository the repository's web address, for the full-notes links
@param {number} maxDecodeBytes the decoded bound the envelope must stay within
*/
export function selectWhatsNewReleases(
  allReleases,
  repository,
  maxDecodeBytes = WHATS_NEW_CONTENT_DECODE_MAX_BYTES,
) {
  repository = fullNotesHref(repository)
  if (allReleases.length === 0) {
    return { releases: [], shortened: false, plan: [] }
  }
  const [newest] = allReleases
  const predecessors = allReleases.slice(1, FULL_NOTES_RELEASES)
  const fallback = allReleases
    .slice(FULL_NOTES_RELEASES)
    .find((release) => release.highlights.length > 0)
  let best
  const admit = (releases, shortened, plan) => {
    const text = contentEnvelope(releases, shortened)
    if (Buffer.byteLength(text) > maxDecodeBytes) return
    try {
      if (encodeWhatsNewContent(text).kind === 'over-budget') return
    } catch (error) {
      throw new Error(
        `CHANGELOG.md ${releases.map((release) => release.version).join(', ')}: What's New artifact encoding failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    best ??= { releases, shortened, plan }
  }
  const enumerate = (index, releases, shortened, plan) => {
    const release = predecessors[index]
    if (release === undefined) {
      if (fallback !== undefined && releases.every((entry) => entry.highlights.length === 0)) {
        admit([...releases, highlightsOnly(fallback, repository)], shortened, [
          ...plan,
          { version: fallback.version, full: false },
        ])
        admit(releases, true, [...plan, { version: fallback.version, full: false, omitted: true }])
      } else {
        admit(releases, shortened, plan)
      }
      return
    }
    enumerate(index + 1, [...releases, release], shortened, [
      ...plan,
      { version: release.version, full: true },
    ])
    enumerate(index + 1, [...releases, highlightsOnly(release, repository)], true, [
      ...plan,
      { version: release.version, full: false },
    ])
    enumerate(index + 1, releases, true, [
      ...plan,
      { version: release.version, full: false, omitted: true },
    ])
  }
  enumerate(0, [newest], false, [{ version: newest.version, full: true }])
  if (best !== undefined) return best
  const isShortened =
    predecessors.length > 0 || (newest.highlights.length === 0 && fallback !== undefined)
  const newestBytes = Buffer.byteLength(contentEnvelope([newest], false))
  const bytes =
    newestBytes > maxDecodeBytes
      ? newestBytes
      : Buffer.byteLength(contentEnvelope([newest], isShortened))
  throw new Error(
    bytes > maxDecodeBytes
      ? `CHANGELOG.md ${newest.version}: its release notes decode to ${String(bytes)} bytes, over the What's New bound of ${String(maxDecodeBytes)} bytes; trim the notes (docs/RELEASING.md)`
      : `CHANGELOG.md ${newest.version}: its release notes cannot fit the What's New artifact encoding bound; trim the notes (docs/RELEASING.md)`,
  )
}

/** Writes dist/whatsNew.json from CHANGELOG.md and package.json under `root`; returns its size. */
export function writeWhatsNewContent(root = '.') {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  const repository = repositoryUrl(manifest)
  const allReleases = parseChangelog(changelog, contributedIds(manifest), repository)
  const { releases, shortened } = selectWhatsNewReleases(allReleases, repository)
  const encoded = encodeWhatsNewContent(contentEnvelope(releases, shortened))
  if (encoded.kind === 'over-budget')
    throw new Error(
      `CHANGELOG.md ${releases.map((release) => release.version).join(', ')}: What's New artifact is ${String(encoded.bytes)} bytes, over its bound of ${String(encoded.maxBytes)} bytes; trim the notes (docs/RELEASING.md)`,
    )
  const text = encoded.text
  const target = path.join(root, CONTENT_FILE)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, text)
  return { releases: releases.length, bytes: Buffer.byteLength(text) }
}
