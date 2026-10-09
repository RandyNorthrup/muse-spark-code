#!/usr/bin/env node
// Generates the public ROADMAP.md, or checks that it is current (`--check`).
// Milestone ids and statuses come from PLAN.md through the same pure reader
// as check:plan; release headings come from CHANGELOG.md; the user-facing
// words come from docs/roadmap/entries.json. Nothing here reads the clock,
// Git or the network, so the same tree always gives the same file.
import { Buffer } from 'node:buffer'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'

const root = path.resolve(import.meta.dirname, '..')
const files = {
  plan: path.join(root, 'PLAN.md'),
  changelog: path.join(root, 'CHANGELOG.md'),
  entries: path.join(root, 'docs', 'roadmap', 'entries.json'),
  roadmap: path.join(root, 'ROADMAP.md'),
}
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

const args = process.argv.slice(2)
const isCheck = args.includes('--check')
if (args.some((arg) => arg !== '--check')) {
  console.error('gen-roadmap [--check]')
  process.exit(2)
}

const { outputFiles } = await build({
  stdin: {
    contents:
      "export { readPlan } from './src/core/reporting/plan/reader'; export { findMilestone } from './src/core/reporting/plan/selection'; export { REPORT_EXIT_CODES, REPORT_PLAN_MAX_BYTES } from './src/shared/constants'",
    resolveDir: root,
    loader: 'ts',
    sourcefile: 'gen-roadmap-entry.ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'silent',
})
const { readPlan, findMilestone, REPORT_EXIT_CODES, REPORT_PLAN_MAX_BYTES } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
)

const problems = []
const notes = []

function readPlanFacts() {
  if (statSync(files.plan).size > REPORT_PLAN_MAX_BYTES) {
    problems.push('PLAN.md is larger than the plan reader accepts; run npm run check:plan')
    return null
  }
  const { facts } = readPlan(readFileSync(files.plan, 'utf8'))
  if (facts.drift.length > 0) {
    problems.push(
      `PLAN.md has ${String(facts.drift.length)} format drift(s); run npm run check:plan`,
    )
    return null
  }
  return facts
}

/** Dated `## [x.y.z] - YYYY-MM-DD` headings, newest first as the changelog keeps them. */
function readChangelogReleases() {
  const releases = []
  for (const line of readFileSync(files.changelog, 'utf8').split(/\r?\n/)) {
    const match = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line)
    if (match?.[1] && match[2]) releases.push({ version: match[1], date: match[2] })
  }
  return releases
}

/**
 * The newest changelog version is still being prepared while PLAN §10 has a
 * preparation record for it and no definitive record. Every other version
 * with a changelog heading has shipped.
 */
function pendingVersion(facts, releases) {
  const newest = releases[0]?.version
  if (!newest) return null
  const records = facts.releases.filter(({ version }) => version === newest)
  const preparing = records.some(({ text }) => /^\*\*v?\d+\.\d+\.\d+ preparation \(/.test(text))
  return preparing && records.every(({ text }) => /^\*\*v?\d+\.\d+\.\d+ preparation \(/.test(text))
    ? newest
    : null
}

function readEntries() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(files.entries, 'utf8'))
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

function validText(id, key, value, isRendered = true) {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    problems.push(`${id}: "${key}" must be a non-empty trimmed string`)
    return false
  }
  // Milestone and decision numbers appear only as the generated reference tag.
  if (isRendered && /\b[MD]\d+/.test(value))
    problems.push(`${id}: "${key}" names a milestone or decision id`)
  return true
}

function checkEntry(entry, milestone, versions) {
  const id = entry.id
  const isPublic = entry.public !== false
  if (entry.public !== undefined && typeof entry.public !== 'boolean')
    problems.push(`${id}: "public" must be true or false`)
  const allowed = isPublic ? PUBLIC_KEYS : INTERNAL_KEYS
  for (const key of Object.keys(entry))
    if (!allowed.has(key))
      problems.push(`${id}: "${key}" is not used by ${isPublic ? 'a public' : 'an internal'} entry`)
  if (!isPublic) {
    // Internal notes are never rendered, so they may cite ids.
    validText(id, 'note', entry.note, false)
    return
  }
  if (milestone.status === 'superseded')
    problems.push(`${id}: PLAN marks it superseded; list it as "public": false`)
  validText(id, 'title', entry.title)
  if (validText(id, 'summary', entry.summary)) {
    if (!entry.summary.endsWith('.') || /[.!?]\s+[A-Z]/.test(entry.summary))
      problems.push(`${id}: "summary" must be one sentence ending with a period`)
    if (entry.summary.length > SUMMARY_MAX)
      problems.push(`${id}: "summary" is longer than ${String(SUMMARY_MAX)} characters`)
  }
  if (!AREAS.has(entry.area))
    problems.push(`${id}: "area" must be one of ${AREAS.keys().toArray().join(', ')}`)
  if (entry.release !== undefined && !versions.has(entry.release))
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

/** Where a public entry is listed, from PLAN's status and the entry's release. */
function placement(entry, milestone, pending) {
  const { release } = entry
  if (BUILT.has(milestone.status)) {
    if (release === undefined) return { section: 'progress', note: 'Built; not in a release yet.' }
    return release === pending ? { section: 'next' } : { section: 'shipped', release }
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
    note:
      release === pending
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

function render(placed, pending, releases) {
  const next = placed.filter(({ section }) => section === 'next').toSorted(byAreaThenId)
  const progress = placed.filter(({ section }) => section === 'progress').toSorted(byAreaThenId)
  const planned = placed.filter(({ section }) => section === 'planned').toSorted(byAreaThenId)
  const nextHeading = pending ? `In the next release (${pending})` : null
  const headings = [nextHeading, 'In progress', 'Planned', 'Shipped'].filter(Boolean)
  const lines = [
    '# Roadmap',
    '',
    '<!-- Generated by scripts/gen-roadmap.mjs from PLAN.md, CHANGELOG.md and docs/roadmap/entries.json. Edit those, then run npm run roadmap:generate; npm run check:roadmap fails when this file is stale. -->',
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
  if (nextHeading)
    lines.push(
      `## ${nextHeading}`,
      '',
      `Merged for ${pending} and being prepared for release.`,
      '',
      ...next.map((item) => bullet(item, true)),
      '',
    )
  lines.push(
    '## In progress',
    '',
    'Being built, built but not released, partly shipped, or waiting on a prerequisite.',
    '',
    ...byArea(progress),
    '## Planned',
    '',
    'Designed in the plan and not started yet.',
    '',
    ...byArea(planned),
    '## Shipped',
    '',
    'By release, newest first.',
    '',
  )
  for (const { version, date } of releases) {
    if (version === pending) continue
    const shipped = placed
      .filter(({ section, release }) => section === 'shipped' && release === version)
      .toSorted(byAreaThenId)
    if (shipped.length === 0) continue
    lines.push(`### ${version} (${date})`, '', ...shipped.map((item) => bullet(item, true)), '')
  }
  return lines.join('\n')
}

const facts = readPlanFacts()
const releases = readChangelogReleases()
const entries = readEntries()
if (releases.length === 0) problems.push('CHANGELOG.md has no dated release headings')
let content = ''
if (facts) {
  const versions = new Set(releases.map(({ version }) => version))
  const pending = pendingVersion(facts, releases)
  const seen = new Map()
  const placed = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`entries.json: ${JSON.stringify(entry)} is not an entry object`)
      continue
    }
    const id = typeof entry.id === 'string' ? entry.id : JSON.stringify(entry.id)
    const found = findMilestone(facts, id)
    if (found.exitCode !== REPORT_EXIT_CODES.generated) {
      problems.push(
        `${id}: PLAN.md has no such milestone (nearest: ${found.nearest.join(', ') || 'none'})`,
      )
      continue
    }
    const { milestone } = found
    if (milestone.id !== id) problems.push(`${id}: spell the id as PLAN.md does (${milestone.id})`)
    if (seen.has(milestone.id)) problems.push(`${milestone.id}: listed twice in entries.json`)
    seen.set(milestone.id, entry)
    checkEntry(entry, milestone, versions)
    if (entry.public !== false && milestone.status !== 'superseded')
      placed.push({ entry, ...placement(entry, milestone, pending) })
  }
  for (const milestone of facts.milestones)
    if (!seen.has(milestone.id))
      problems.push(
        `${milestone.id}: PLAN.md milestone has no entry in docs/roadmap/entries.json (add one; internal work uses "public": false)`,
      )
  if (problems.length === 0) {
    const options = (await resolveConfig(files.roadmap)) ?? {}
    content = await format(render(placed, pending, releases), { ...options, parser: 'markdown' })
  }
}

for (const note of notes) console.warn(`roadmap note: ${note}`)
if (problems.length > 0) {
  for (const problem of problems) console.error(`roadmap: ${problem}`)
  console.error(
    `roadmap: ${String(problems.length)} problem(s); ROADMAP.md not ${isCheck ? 'checked' : 'written'}`,
  )
  process.exit(1)
}
if (isCheck) {
  let current
  try {
    current = readFileSync(files.roadmap, 'utf8')
  } catch {
    current = ''
  }
  if (current !== content) {
    const have = current.split('\n')
    const want = content.split('\n')
    const line = want.findIndex((text, index) => text !== have[index])
    console.error(
      `roadmap: ROADMAP.md is stale from line ${String((line === -1 ? want.length : line) + 1)}; run npm run roadmap:generate`,
    )
    process.exit(1)
  }
  console.log(`Roadmap: ${String(entries.length)} entries; ROADMAP.md is current`)
} else {
  writeFileSync(files.roadmap, content)
  console.log(`Roadmap: ${String(entries.length)} entries; ROADMAP.md written`)
}
