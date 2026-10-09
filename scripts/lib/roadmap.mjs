// The rules of the public ROADMAP.md (M122), as a pure function of the texts
// of PLAN.md, CHANGELOG.md and docs/roadmap/entries.json. The PLAN reader and
// the formatter are passed in: scripts/gen-roadmap.mjs bundles the reader from
// TypeScript, and the tests import it directly with in-memory fixtures.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

const AREAS = new Map([
  ['chat', 'Chat'],
  ['agents', 'Agents'],
  ['editors', 'Editors'],
  ['models-providers', 'Models and providers'],
  ['usage-billing', 'Usage and billing'],
  ['security', 'Security'],
  ['voice-media', 'Voice and media'],
  ['devices', 'Devices'],
  ['platform', 'Platform'],
])
// Each label, and what the intro says it means when an entry uses it.
const LABELS = new Map([
  ['experimental', 'may change or be removed'],
  ['untested', 'built from published documentation, not yet checked against the real service'],
  ['preview', 'usable, with documented limits'],
  ['not available yet', 'a part of it is not usable in a release yet'],
])
const PUBLIC_KEYS = new Set(['id', 'public', 'title', 'summary', 'area', 'release', 'labels'])
const INTERNAL_KEYS = new Set(['id', 'public', 'note'])
// Statuses whose work exists; a named release then decides where it is listed.
const BUILT = new Set(['complete', 'merged', 'released', 'certified', 'built'])
const SUMMARY_MAX = 260
const PREPARATION = /^\*\*v?\d+\.\d+\.\d+ preparation \(/
const FINGERPRINT_PREFIX = '<!-- Source fingerprint: '
const REGENERATE = 'run npm run roadmap:generate'

/** Dated `## [x.y.z] - YYYY-MM-DD` headings, newest first as the changelog keeps them. */
function readChangelogReleases(text) {
  const releases = []
  for (const line of text.split(/\r?\n/)) {
    const match = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line)
    if (match?.[1] && match[2]) releases.push({ version: match[1], date: match[2] })
  }
  return releases
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * Every version PLAN §10 has a preparation record for and no other record
 * (such as `X.Y.Z released (…)`) is still being prepared, oldest first. A
 * changelog version without any §10 record has shipped.
 */
function pendingVersions(facts, versions, problems) {
  const kinds = new Map()
  for (const { version, text } of facts.releases)
    kinds.set(version, [...(kinds.get(version) ?? []), PREPARATION.test(text)])
  const pending = [...kinds]
    .filter(([, preparations]) => preparations.every(Boolean))
    .map(([version]) => version)
    .toSorted(compareVersions)
  for (const version of pending)
    if (!versions.has(version))
      problems.push(
        `PLAN.md §10 prepares ${version}, but CHANGELOG.md has no dated ${version} heading`,
      )
  return pending
}

function readEntries(text, problems) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    problems.push(`docs/roadmap/entries.json is not readable JSON (${String(error.message)})`)
    return []
  }
  if (!Array.isArray(parsed?.entries)) {
    problems.push('docs/roadmap/entries.json needs an "entries" array')
    return []
  }
  for (const key of Object.keys(parsed))
    if (key !== 'about' && key !== 'entries')
      problems.push(`docs/roadmap/entries.json: unknown top-level key "${key}"`)
  return parsed.entries
}

/**
 * One case-insensitive pattern for every milestone and working id PLAN.md
 * and entries.json know (M19, m19, SECWINPATH, M26-follow-up), matched as a
 * whole word, as milestone selection matches ids.
 */
function knownIdPattern(ids) {
  if (ids.size === 0) return null
  const alternatives = [...ids]
    .toSorted((left, right) => right.length - left.length)
    .map((id) => id.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`))
  const word = String.raw`[\p{L}\p{N}]`
  return new RegExp(`(?<!${word})(?:${alternatives.join('|')})(?!${word})`, 'iu')
}

/**
 * A digest of every fact the roadmap is built from, so `--check` fails when
 * one changes even where the listing would read the same: each milestone's
 * id, heading (with its date) and current status and date, each §10 record's
 * version, date and kind, each changelog heading and every entry.
 */
function fingerprint(facts, releases, entries) {
  const sources = {
    milestones: facts.milestones.map(({ id, title, status, date }) => [id, title, status, date]),
    records: facts.releases.map(({ version, date, text }) => [
      version,
      date,
      PREPARATION.test(text) ? 'preparation' : 'record',
    ]),
    changelog: releases.map(({ version, date }) => [version, date]),
    entries,
  }
  return createHash('sha256').update(JSON.stringify(sources)).digest('hex')
}

/** Where a public entry is listed, from PLAN's status and the entry's release. */
function placement(entry, milestone, pending, notes) {
  const { release } = entry
  if (BUILT.has(milestone.status)) {
    if (release === undefined) return { section: 'progress', note: 'Built; not in a release yet.' }
    return { section: pending.includes(release) ? 'next' : 'shipped', release }
  }
  if (release === undefined) {
    if (milestone.status === 'waiting')
      return { section: 'progress', note: 'Waiting on a prerequisite.' }
    return { section: milestone.status === 'building' ? 'progress' : 'planned' }
  }
  if (milestone.status === 'planned')
    notes.push(`${milestone.id}: PLAN status is planned, but parts are in ${release}`)
  return {
    section: 'progress',
    note: pending.includes(release)
      ? `First parts are in the next release (${release}).`
      : `First parts shipped in ${release}.`,
  }
}

function orderKey(id) {
  const match = /^M(\d+)/.exec(id)
  return match?.[1] ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function byAreaThenId(left, right) {
  const areas = AREAS.keys().toArray()
  return (
    areas.indexOf(left.entry.area) - areas.indexOf(right.entry.area) ||
    orderKey(left.entry.id) - orderKey(right.entry.id) ||
    left.entry.id.localeCompare(right.entry.id, 'en')
  )
}

function capitalized(text) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function bullet({ entry, note }, withArea) {
  const labels = entry.labels ? ` _(${capitalized(entry.labels.join(', '))})_` : ''
  const area = withArea ? `${AREAS.get(entry.area)}: ` : ''
  const extra = note ? ` _${note}_` : ''
  // Only plan milestone numbers become reference tags; working ids stay internal.
  const tag = /^M\d/.test(entry.id) ? ` <sub>${entry.id}</sub>` : ''
  return `- ${area}**${entry.title}**${labels} — ${entry.summary}${extra}${tag}`
}

function labelIntro(placed) {
  const used = new Set(placed.flatMap(({ entry }) => entry.labels ?? []))
  const meanings = [...LABELS]
    .filter(([label]) => used.has(label))
    .map(([label, meaning]) => `_${capitalized(label)}_ means ${meaning}`)
  return meanings.length === 0 ? '' : `Labels come from the project plan: ${meanings.join('; ')}. `
}

function byArea(items) {
  const lines = []
  for (const [key, name] of AREAS) {
    const group = items.filter(({ entry }) => entry.area === key)
    if (group.length > 0) lines.push(`### ${name}`, '', ...group.map((item) => bullet(item)), '')
  }
  return lines
}

function anchor(heading) {
  return `#${heading
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N} -]/gu, '')
    .replaceAll(' ', '-')}`
}

function render(placed, pending, releases, sources) {
  const inSection = (name) =>
    placed.filter(({ section }) => section === name).toSorted(byAreaThenId)
  const nextHeadings = pending.map((version) => `In the next release (${version})`)
  const headings = [...nextHeadings, 'In progress', 'Planned', 'Shipped']
  const lines = [
    '# Roadmap',
    '',
    '<!-- Generated by scripts/gen-roadmap.mjs from PLAN.md, CHANGELOG.md and docs/roadmap/entries.json. Edit those, then run npm run roadmap:generate; npm run check:roadmap fails when this file is stale. -->',
    '',
    `${FINGERPRINT_PREFIX}${sources} -->`,
    '',
    'What Muse Spark Code has shipped, what is in the next release, what is being built and what is planned. Plans change: an item can move, shrink or be dropped, and no date is promised. Versions stay below 1.0; there is no 1.0 promise or date.',
    '',
    'Features land for every supported editor: VS Code and VS Code-based editors, and editors that use the Agent Client Protocol (ACP), with native plugins for more editors on the way. Where an editor still waits for its part, the work is listed under [In progress](#in-progress).',
    '',
    `${labelIntro(placed)}The [changelog](CHANGELOG.md) has the detail of every release, and the small tags (such as <sub>M40</sub>) are milestone ids in the project plan.`,
    '',
    `**Contents:** ${headings.map((heading) => `[${heading}](${anchor(heading)})`).join(' · ')}`,
    '',
  ]
  const next = inSection('next')
  for (const [index, version] of pending.entries())
    lines.push(
      `## ${nextHeadings[index]}`,
      '',
      `Merged for ${version} and being prepared for release.`,
      '',
      ...next.filter(({ release }) => release === version).map((item) => bullet(item, true)),
      '',
    )
  lines.push(
    '## In progress',
    '',
    'Being built, built but not released, partly shipped, or waiting on a prerequisite.',
    '',
    ...byArea(inSection('progress')),
    '## Planned',
    '',
    'Designed in the plan and not started yet.',
    '',
    ...byArea(inSection('planned')),
    '## Shipped',
    '',
    'By release, newest first.',
    '',
  )
  const shipped = inSection('shipped')
  for (const { version, date } of releases) {
    if (pending.includes(version)) continue
    const items = shipped.filter(({ release }) => release === version)
    if (items.length > 0)
      lines.push(`### ${version} (${date})`, '', ...items.map((item) => bullet(item, true)), '')
  }
  return lines.join('\n')
}

class EntryChecker {
  constructor(versions, idPattern, problems) {
    this.versions = versions
    this.idPattern = idPattern
    this.problems = problems
  }

  text(id, key, value, isRendered = true) {
    if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
      this.problems.push(`${id}: "${key}" must be a non-empty trimmed string`)
      return false
    }
    // Milestone, decision and working ids appear only as the generated tag.
    if (!isRendered) return true
    const known = this.idPattern?.exec(value)?.[0]
    if (known !== undefined)
      this.problems.push(`${id}: "${key}" names the milestone or working id ${known}`)
    else if (/\b[MD]\d+/.test(value))
      this.problems.push(`${id}: "${key}" names a milestone or decision id`)
    return true
  }

  check(entry, milestone) {
    const { id } = entry
    const { problems } = this
    const isPublic = entry.public !== false
    if (entry.public !== undefined && typeof entry.public !== 'boolean')
      problems.push(`${id}: "public" must be true or false`)
    const allowed = isPublic ? PUBLIC_KEYS : INTERNAL_KEYS
    for (const key of Object.keys(entry))
      if (!allowed.has(key))
        problems.push(
          `${id}: "${key}" is not used by ${isPublic ? 'a public' : 'an internal'} entry`,
        )
    if (!isPublic) {
      // Internal notes are never rendered, so they may cite ids.
      this.text(id, 'note', entry.note, false)
      return
    }
    if (milestone.status === 'superseded')
      problems.push(`${id}: PLAN marks it superseded; list it as "public": false`)
    this.text(id, 'title', entry.title)
    if (this.text(id, 'summary', entry.summary)) {
      if (!entry.summary.endsWith('.') || /[.!?]\s+[A-Z]/.test(entry.summary))
        problems.push(`${id}: "summary" must be one sentence ending with a period`)
      if (entry.summary.length > SUMMARY_MAX)
        problems.push(`${id}: "summary" is longer than ${String(SUMMARY_MAX)} characters`)
    }
    if (!AREAS.has(entry.area))
      problems.push(`${id}: "area" must be one of ${AREAS.keys().toArray().join(', ')}`)
    if (entry.release !== undefined && !this.versions.has(entry.release))
      problems.push(`${id}: release ${String(entry.release)} has no CHANGELOG.md heading`)
    if (entry.release === undefined && milestone.status === 'released')
      problems.push(`${id}: PLAN says released; name its "release"`)
    if (entry.labels === undefined) return
    const labels = Array.isArray(entry.labels) ? entry.labels : [null]
    if (labels.length === 0 || new Set(labels).size !== labels.length)
      problems.push(`${id}: "labels" must be a non-empty list without repeats`)
    for (const label of labels)
      if (!LABELS.has(label))
        problems.push(
          `${id}: label ${String(label)} is not one of ${LABELS.keys().toArray().join(', ')}`,
        )
  }
}

function isEntryObject(entry) {
  return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
}

function hasValidId(entry) {
  return typeof entry.id === 'string' && entry.id.trim() !== '' && entry.id === entry.id.trim()
}

/** Validates the entries against PLAN and places each public one. */
function placeEntries(facts, entries, versions, pending, plan, problems, notes) {
  const ids = new Set(facts.milestones.map(({ id }) => id.toLowerCase()))
  for (const entry of entries)
    if (isEntryObject(entry) && hasValidId(entry)) ids.add(entry.id.toLowerCase())
  const checker = new EntryChecker(versions, knownIdPattern(ids), problems)
  const seen = new Set()
  const placed = []
  for (const [index, entry] of entries.entries()) {
    if (!isEntryObject(entry)) {
      problems.push(`entries.json: ${JSON.stringify(entry)} is not an entry object`)
      continue
    }
    if (!hasValidId(entry)) {
      problems.push(
        `entries.json entry ${String(index + 1)}: "id" must be a non-empty trimmed string naming a PLAN.md milestone`,
      )
      continue
    }
    const { id } = entry
    const found = plan.findMilestone(facts, id)
    if (found.exitCode !== plan.generatedCode) {
      problems.push(
        `${id}: PLAN.md has no such milestone (nearest: ${found.nearest.join(', ') || 'none'})`,
      )
      continue
    }
    const { milestone } = found
    if (milestone.id !== id) problems.push(`${id}: spell the id as PLAN.md does (${milestone.id})`)
    if (seen.has(milestone.id)) problems.push(`${milestone.id}: listed twice in entries.json`)
    seen.add(milestone.id)
    checker.check(entry, milestone)
    if (entry.public !== false && milestone.status !== 'superseded')
      placed.push({ entry, ...placement(entry, milestone, pending, notes) })
  }
  for (const milestone of facts.milestones)
    if (!seen.has(milestone.id))
      problems.push(
        `${milestone.id}: PLAN.md milestone has no entry in docs/roadmap/entries.json (add one; internal work uses "public": false)`,
      )
  return placed
}

/**
 * ROADMAP.md's text from its three inputs. `plan` carries the PLAN reader
 * (`readPlan`, `findMilestone`, the `generatedCode` exit code and the
 * reader's `maxBytes`); `format` turns the Markdown into the committed form.
 * `content` is empty whenever `problems` is not.
 */
export async function generateRoadmap({ planText, changelogText, entriesText, plan, format }) {
  const problems = []
  const notes = []
  const releases = readChangelogReleases(changelogText)
  const entries = readEntries(entriesText, problems)
  if (releases.length === 0) problems.push('CHANGELOG.md has no dated release headings')
  const result = (content = '') => ({ content, problems, notes, entryCount: entries.length })
  if (Buffer.byteLength(planText) > plan.maxBytes) {
    problems.push('PLAN.md is larger than the plan reader accepts; run npm run check:plan')
    return result()
  }
  const { facts } = plan.readPlan(planText)
  if (facts.drift.length > 0) {
    problems.push(
      `PLAN.md has ${String(facts.drift.length)} format drift(s); run npm run check:plan`,
    )
    return result()
  }
  const versions = new Set(releases.map(({ version }) => version))
  const pending = pendingVersions(facts, versions, problems)
  const placed = placeEntries(facts, entries, versions, pending, plan, problems, notes)
  if (problems.length > 0) return result()
  const sources = fingerprint(facts, releases, entries)
  return result(await format(render(placed, pending, releases, sources)))
}

/** Why `current` is not the generated `content`, or null when it is. */
export function staleReason(current, content) {
  if (current === content) return null
  const have = current.split('\n')
  const want = content.split('\n')
  const line = want.findIndex((text, index) => text !== have[index])
  if (
    have.length === want.length &&
    want[line]?.startsWith(FINGERPRINT_PREFIX) &&
    want.every((text, index) => index === line || text === have[index])
  )
    return `ROADMAP.md was generated from other PLAN.md, CHANGELOG.md or docs/roadmap/entries.json facts (its source fingerprint differs); ${REGENERATE}`
  return `ROADMAP.md is stale from line ${String((line === -1 ? want.length : line) + 1)}; ${REGENERATE}`
}
