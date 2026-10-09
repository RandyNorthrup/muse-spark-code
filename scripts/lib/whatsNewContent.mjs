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
/** A released version, prereleases included: the one pattern the writer and the packager share. */
const RELEASE_VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`
const RELEASE_HEADING = new RegExp(String.raw`^\[(${RELEASE_VERSION})\] - (\d{4}-\d{2}-\d{2})$`)
/**
 * A released `## ` section line in CHANGELOG.md, prereleases included. The
 * packager reads the same pattern the writer parses with, so a plan entry
 * always finds its section; never a second heading inventory.
 */
export const RELEASE_SECTION_LINE = new RegExp(String.raw`^## \[${RELEASE_VERSION}\].*$`, 'gm')
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
  if (WEB_LINK.test(url)) {
    return url
  }
  if (ANY_SCHEME.test(url)) {
    return
  }
  return url.startsWith('#')
    ? `${repository}/blob/${BRANCH}/CHANGELOG.md${url}`
    : `${repository}/blob/${BRANCH}/${url.replace(/^\.\//, '')}`
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
      return [
        {
          t: 'list',
          ordered: node.ordered === true,
          start: node.start ?? 1,
          items: node.children.map((item) => blocks(item.children, repository)),
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
  return content[0].children.map((item) => ({
    c: blocks(item.children, repository),
    tries: triesOf(item, version, allowed),
  }))
}

function finishRelease(release, repository, allowed) {
  const sections = []
  let highlights = []
  for (const { heading, nodes } of release.parts) {
    if (heading === HIGHLIGHTS_HEADING) {
      if (highlights.length > 0) {
        throw new Error(`CHANGELOG.md ${release.version}: two "### ${HIGHLIGHTS_HEADING}" sections`)
      }
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
 * The released sections of a CHANGELOG, newest first as written.
 *
 * @param {string} markdown CHANGELOG.md's text
 * @param {{ commands: Set<string>, settings: Set<string> }} allowed what a Try it may name
 * @param {string} repository the repository's web address, for relative links
 */
export function parseChangelog(markdown, allowed, repository) {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  const releases = []
  const seen = new Set()
  let current
  const finish = () => {
    if (current === undefined) {
      return
    }
    // [Unreleased] is checked but never shown.
    const release = finishRelease(current, repository, allowed)
    if (!current.isDraft) {
      releases.push(release)
    }
  }
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth <= 2) {
      finish()
      current = undefined
      const heading = textOf(node).trim()
      const match = RELEASE_HEADING.exec(heading)
      if (heading === UNRELEASED_HEADING && node.depth === 2) {
        current = {
          version: 'Unreleased',
          date: '',
          isDraft: true,
          parts: [{ heading: '', nodes: [] }],
        }
      } else if (match !== null && node.depth === 2) {
        const [, version, date] = match
        if (seen.has(version)) {
          throw new Error(`CHANGELOG.md has two sections for ${version}`)
        }
        seen.add(version)
        current = { version, date, parts: [{ heading: '', nodes: [] }] }
      }
      continue
    }
    if (current === undefined) {
      continue
    }
    if (node.type === 'heading' && node.depth === 3) {
      current.parts.push({ heading: textOf(node).trim(), nodes: [] })
      continue
    }
    current.parts.at(-1).nodes.push(node)
  }
  finish()
  return releases
}

/**
 * Why a release cannot ship as written, or undefined (the changelog-version
 * test, M99): a minor or major release (patch 0) needs a Highlights list,
 * since it opens What's New, and no release being made has more than
 * MAX_HIGHLIGHTS of them.
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

/**
 * The decoded bytes of a content envelope, exactly as the build writes it:
 * the `shortened` flag is present only when the selection set it.
 */
function envelopeBytes(releases, shortened) {
  return Buffer.byteLength(
    JSON.stringify(
      shortened
        ? { schema: SCHEMA_VERSION, releases, shortened: true }
        : { schema: SCHEMA_VERSION, releases },
    ),
  )
}

/** A release's Highlights with a link to its full notes in CHANGELOG on GitHub. */
function highlightsOnly(release, repository) {
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
                href: `${repository}/blob/${BRANCH}/CHANGELOG.md`,
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
 * The releases the build ships, within the decoded bound (post-0.17.0: two
 * full releases no longer always fit, so the writer is budget-aware).
 *
 * - The newest release always ships in full. Alone over the bound, the
 *   writer refuses, naming the release, its size and the bound, so the
 *   author trims the notes instead of the build hiding them.
 * - Older releases of the full-notes window follow newest first while the
 *   decoded total fits. One that does not fit in full ships as its
 *   Highlights only (plus a link to its full notes); one whose Highlights
 *   do not fit either is left out. Either way the selection is `shortened`.
 * - The standing rule still holds: when nothing shipped has Highlights, the
 *   newest earlier Highlights ship as their Highlights with the full-notes
 *   link and enter the plan like any other shortened release (left out
 *   instead when even they do not fit, and the packaged notes agree either
 *   way). That rule alone never `shortened`.
 *
 * Deterministic: the same CHANGELOG always gives byte-identical output.
 *
 * @param {import('../../src/core/whatsNew/whatsNewContent').ReleaseNotes[]} allReleases parsed, newest first
 * @param {string} repository the repository's web address, for the full-notes links
 * @param {number} maxDecodeBytes the decoded bound the envelope must stay within
 */
export function selectWhatsNewReleases(
  allReleases,
  repository,
  maxDecodeBytes = WHATS_NEW_CONTENT_DECODE_MAX_BYTES,
) {
  if (allReleases.length === 0) {
    return { releases: [], shortened: false, plan: [] }
  }
  const [newest, ...older] = allReleases
  const newestBytes = envelopeBytes([newest], false)
  if (newestBytes > maxDecodeBytes) {
    throw new Error(
      `CHANGELOG.md ${newest.version}: its release notes decode to ${String(newestBytes)} bytes, over the What's New bound of ${String(maxDecodeBytes)} bytes; trim the notes (docs/RELEASING.md)`,
    )
  }
  const releases = [newest]
  const plan = [{ version: newest.version, full: true }]
  let isShortened = false
  const canFit = (candidate, makesShortened) =>
    envelopeBytes([...releases, candidate], isShortened || makesShortened) <= maxDecodeBytes
  const predecessors = older.slice(0, FULL_NOTES_RELEASES - 1)
  for (const candidate of predecessors) {
    if (canFit(candidate, false)) {
      releases.push(candidate)
      plan.push({ version: candidate.version, full: true })
      continue
    }
    const short = highlightsOnly(candidate, repository)
    if (canFit(short, true)) {
      releases.push(short)
      plan.push({ version: candidate.version, full: false })
      isShortened = true
      continue
    }
    plan.push({ version: candidate.version, full: false, omitted: true })
    isShortened = true
  }
  if (releases.every((release) => release.highlights.length === 0)) {
    const latestHighlights = allReleases
      .slice(FULL_NOTES_RELEASES)
      .find((release) => release.highlights.length > 0)
    if (latestHighlights !== undefined) {
      // The standing rule's entry ships as its Highlights with the
      // full-notes link, like any other shortened release, and enters the
      // plan the same way, so the page and the packaged notes agree; only
      // the budget skipping it counts as shortened.
      const short = highlightsOnly(latestHighlights, repository)
      if (canFit(short, true)) {
        releases.push(short)
        plan.push({ version: latestHighlights.version, full: false })
      } else {
        isShortened = true
      }
    }
  }
  // The `shortened` flag is itself bytes in the shipped envelope: leaving a
  // release out sets it without adding a release, so the envelope as shipped
  // is measured here. An exact-fit newest release otherwise ends in the
  // encoder's generic refusal; instead it gets the named one.
  const finalBytes = envelopeBytes(releases, isShortened)
  if (finalBytes > maxDecodeBytes) {
    throw new Error(
      `CHANGELOG.md ${newest.version}: its release notes decode to ${String(finalBytes)} bytes, over the What's New bound of ${String(maxDecodeBytes)} bytes; trim the notes (docs/RELEASING.md)`,
    )
  }
  return { releases, shortened: isShortened, plan }
}

/** Writes dist/whatsNew.json from CHANGELOG.md and package.json under `root`; returns its size. */
export function writeWhatsNewContent(root = '.') {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
  const repository = repositoryUrl(manifest)
  const allReleases = parseChangelog(changelog, contributedIds(manifest), repository)
  const { releases, shortened } = selectWhatsNewReleases(allReleases, repository)
  const text = encodeWhatsNewContent(
    JSON.stringify(
      shortened
        ? { schema: SCHEMA_VERSION, releases, shortened: true }
        : { schema: SCHEMA_VERSION, releases },
    ),
  )
  const target = path.join(root, CONTENT_FILE)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, text)
  return { releases: releases.length, bytes: Buffer.byteLength(text) }
}
