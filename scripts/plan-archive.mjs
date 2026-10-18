#!/usr/bin/env node
// Move passages of PLAN.md into docs/plan-archive/, byte for byte, and prove
// it (CONTRIBUTING.md, "Archiving closed history from PLAN.md").
//
//   node scripts/plan-archive.mjs status
//   node scripts/plan-archive.mjs move <decisions|gates|milestones>
//        --heading "<heading text>" --lines <A-B>[,<C-D>…]
//        (--summary <file> | --pointer | --linked)
//        [--at <commit>] [--dry-run] [--allow-fact-change]
//   node scripts/plan-archive.mjs move --batch <file.json>
//        [--at <commit>] [--dry-run] [--allow-fact-change]
//
// `status` prints PLAN.md's size against the plan reader's bound and the
// gate's line, and checks every archived block against the SHA-256 in its
// marker.
//
// `move` takes whole top-level blocks of PLAN.md (1-based, inclusive line
// ranges of the file as it stands; never a heading) and puts each in the
// archive file under `## <heading text>`, between hashed markers. In the
// first range's place it leaves
//   --summary <file>  the paragraph in that file, then "Full record: <link>";
//   --pointer         one line that says where the record went;
//   --linked          nothing: the section must already link to the file.
// --batch takes a JSON list of moves, all in the line numbers of the same
// PLAN.md: [{ "to": "milestones", "heading": "…", "lines": "A-B,C-D",
// "summary": "…" | "pointer": true | "linked": true }, …].
//
// Before anything is written the old PLAN.md is rebuilt from the new one plus
// the archive files and compared byte for byte, and what the plan reader
// parses is compared before and after; either difference stops the move.
// --dry-run prints the same report and writes nothing.
//
// A marker names the commit its line numbers refer to: HEAD, or --at for text
// that a merge in progress brought in (the branch's commit). Where the
// PLAN.md being edited differs from that commit's, each passage is looked up
// there and must stand in it exactly once. --root <dir> works on another
// checkout; the tests use it.
import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import {
  addToArchive,
  archiveBlocks,
  archiveProblems,
  byteLength,
  linesOf,
  PLAN_ARCHIVE_AT_PERCENT,
  PLAN_ARCHIVE_FILES,
  putBack,
  renderBlock,
  sectionOf,
  sha256,
  takeOut,
  wrapProse,
} from './lib/planArchive.mjs'

const repository = path.resolve(import.meta.dirname, '..')
const USAGE = `plan-archive status
plan-archive move <decisions|gates|milestones> --heading "<heading text>" --lines <A-B>[,<C-D>...] (--summary <file> | --pointer | --linked) [--at <commit>] [--dry-run] [--allow-fact-change]
plan-archive move --batch <file.json> [--at <commit>] [--dry-run] [--allow-fact-change]`
const EXIT_FAILED = 1
const EXIT_USAGE = 2
const PERCENT = 100
const SWITCHES = new Set(['--dry-run', '--pointer', '--linked', '--allow-fact-change'])
const VALUES = new Set(['--heading', '--lines', '--summary', '--batch', '--root', '--at'])
const COMMIT_OF = '^{commit}'
// Where a fact stands in the file is not a fact about the plan.
const POSITION_KEYS = new Set(['line', 'lines', 'startLine', 'endLine', 'offset'])

class UsageError extends Error {}

function options(argv) {
  const flags = new Map()
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index] ?? ''
    if (!word.startsWith('--')) positional.push(word)
    else if (SWITCHES.has(word)) flags.set(word, '')
    else if (VALUES.has(word)) {
      const value = argv[index + 1]
      if (value === undefined) throw new UsageError(`${word} needs a value`)
      flags.set(word, value)
      index += 1
    } else throw new UsageError(`unknown option ${word}`)
  }
  return { flags, positional }
}

async function planReader() {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export { readPlan } from './src/core/reporting/plan/reader'; export { REPORT_PLAN_MAX_BYTES } from './src/shared/constants'",
      resolveDir: repository,
      loader: 'ts',
      sourcefile: 'plan-archive-entry.ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  )
}

function sizeLines(bytes, bound) {
  const line = Math.floor((bound * PLAN_ARCHIVE_AT_PERCENT) / PERCENT)
  return [
    `PLAN.md: ${String(bytes)} bytes, ${((bytes * PERCENT) / bound).toFixed(1)}% of the plan reader's ${String(bound)}-byte bound`,
    `gate (check:plan): ${String(PLAN_ARCHIVE_AT_PERCENT)}% = ${String(line)} bytes; ${bytes > line ? `OVER by ${String(bytes - line)}` : `${String(line - bytes)} bytes of room`}`,
  ]
}

function factsOf(readPlan, text) {
  const { facts } = readPlan(text)
  return JSON.parse(
    JSON.stringify(facts, (key, value) => (POSITION_KEYS.has(key) ? undefined : value)),
  )
}

/** The fact groups (and, in a list, the entries) that differ between two plans. */
function factChanges(before, after) {
  const changes = []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    const left = before[key]
    const right = after[key]
    if (JSON.stringify(left) === JSON.stringify(right)) continue
    if (!Array.isArray(left) || !Array.isArray(right)) {
      changes.push(key)
      continue
    }
    const name = (entry, index) => String(entry?.id ?? entry?.version ?? index)
    const others = new Map(right.map((entry, index) => [name(entry, index), JSON.stringify(entry)]))
    const differing = left
      .map((entry, index) => [name(entry, index), JSON.stringify(entry)])
      .filter(([id, text]) => others.get(id) !== text)
      .map(([id]) => id)
    changes.push(
      `${key}: ${differing.length > 0 ? differing.join(', ') : `${String(left.length)} -> ${String(right.length)} entries`}`,
    )
  }
  return changes
}

/** The commit the markers name, and PLAN.md as that commit has it. */
function commitPlan(root, flags) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const named = flags.get('--at') ?? 'HEAD'
  try {
    const at = git('rev-parse', '--short=9', '--verify', named + COMMIT_OF).trim()
    return { at, text: git('show', `${at}:PLAN.md`) }
  } catch {
    throw new UsageError(
      `no PLAN.md at commit "${named}" in ${root}: the markers name the commit their line numbers refer to (--at <commit>)`,
    )
  }
}

async function status(root) {
  const { REPORT_PLAN_MAX_BYTES } = await planReader()
  const plan = readFileSync(path.join(root, 'PLAN.md'), 'utf8')
  const sizes = sizeLines(byteLength(plan), REPORT_PLAN_MAX_BYTES)
  for (const line of sizes) console.log(line)
  let hasFailed = false
  const ids = new Set()
  const files = Object.values(PLAN_ARCHIVE_FILES)
  for (const file of files) {
    if (!existsSync(path.join(root, file))) {
      console.log(`${file}: missing`)
      hasFailed = true
      continue
    }
    const text = readFileSync(path.join(root, file), 'utf8')
    const blocks = archiveBlocks(text)
    const problems = archiveProblems(text)
    for (const block of blocks) {
      if (ids.has(block.id)) problems.push(`${block.id}: id also used in another archive file`)
      ids.add(block.id)
    }
    console.log(
      `${file}: ${String(byteLength(text))} bytes, ${String(blocks.length)} hashed blocks, ${problems.length === 0 ? 'all intact' : `${String(problems.length)} PROBLEM(S)`}`,
    )
    for (const problem of problems) console.log(`  ${problem}`)
    hasFailed ||= problems.length > 0
  }
  return hasFailed ? EXIT_FAILED : 0
}

/**
The moves asked for, from the command line or a --batch file.
@returns {{ to: string, heading: string, lines: string, summary?: string, pointer?: boolean, linked?: boolean }[]}
*/
function requests(kind, flags) {
  const batch = flags.get('--batch')
  if (batch !== undefined) {
    if (
      kind !== undefined ||
      ['--heading', '--lines', '--summary', '--pointer', '--linked'].some((flag) => flags.has(flag))
    )
      throw new UsageError(
        '--batch carries the moves: give no kind, --heading, --lines or stub with it',
      )
    let list
    try {
      list = JSON.parse(readFileSync(path.resolve(batch), 'utf8'))
    } catch {
      list = undefined
    }
    if (!Array.isArray(list) || list.length === 0)
      throw new UsageError('--batch: the file holds a JSON list of moves')
    return list.map((request) => ({ ...request }))
  }
  const summary = flags.get('--summary')
  return [
    {
      to: kind ?? '',
      heading: flags.get('--heading') ?? '',
      lines: flags.get('--lines') ?? '',
      ...(summary !== undefined && { summary: readFileSync(path.resolve(summary), 'utf8') }),
      ...(flags.has('--pointer') && { pointer: true }),
      ...(flags.has('--linked') && { linked: true }),
    },
  ]
}

/** One request, checked: its archive file, heading, ranges, and the lines left in the first range's place. */
function checked(request, number) {
  const where = `move ${String(number)}`
  const file = PLAN_ARCHIVE_FILES[request.to]
  if (file === undefined) throw new UsageError(`${where}: "to" is decisions, gates or milestones`)
  if (
    typeof request.heading !== 'string' ||
    request.heading.trim() === '' ||
    /\n/.test(request.heading)
  )
    throw new UsageError(`${where}: a heading (one line) is needed`)
  const stubs = [
    typeof request.summary === 'string',
    request.pointer === true,
    request.linked === true,
  ].filter(Boolean).length
  if (stubs !== 1)
    throw new UsageError(`${where}: give exactly one of --summary <file>, --pointer and --linked`)
  if (typeof request.summary === 'string' && request.summary.trim() === '')
    throw new UsageError(`${where}: the summary is empty`)
  const ranges = String(request.lines ?? '')
    .split(',')
    .map((range) => {
      const match = /^(\d+)-(\d+)$/.exec(range.trim())
      if (match === null) throw new UsageError(`${where}: --lines "${range}" is not <first>-<last>`)
      return { first: Number(match[1]), last: Number(match[2]) }
    })
    .toSorted((left, right) => left.first - right.first)
  const link = `[${file}](${file})`
  let stub = []
  if (typeof request.summary === 'string')
    stub = wrapProse(`${request.summary.trim()} Full record: ${link}.`)
  else if (request.pointer === true)
    stub = [`- **Archived.** The record that stood here is in ${link}.`]
  return {
    kind: request.to,
    file,
    heading: request.heading,
    ranges,
    stub,
    isLinked: request.linked === true,
  }
}

/** A --linked request leaves nothing behind: its section, as the move leaves it, must carry the link. */
function missingLinks(after, moves, owners) {
  const lines = after.split('\n')
  const seen = new Set()
  const problems = []
  for (const moved of moves) {
    const entry = owners[moved.range]
    if (entry === undefined || !entry.isLinked || seen.has(entry)) continue
    seen.add(entry)
    // The line above the place the passage left is the section's own: its heading or what follows it.
    const [first, last] = sectionOf(after, moved.newStart)
    if (
      !lines
        .slice(first - 1, last)
        .join('\n')
        .includes(`](${entry.file})`)
    )
      problems.push(
        `"${entry.heading}": --linked, but nothing left in the section around line ${String(moved.firstLine)} links to ${entry.file}`,
      )
  }
  return problems
}

async function move(root, kind, flags) {
  const entries = requests(kind, flags).map((request, index) => checked(request, index + 1))
  const commit = commitPlan(root, flags)
  const planPath = path.join(root, 'PLAN.md')
  const plan = readFileSync(planPath, 'utf8')
  const taken = takeOut(
    plan,
    entries.flatMap((entry) =>
      entry.ranges.map((range, index) => ({ ...range, stub: index === 0 ? entry.stub : [] })),
    ),
  )
  const owners = entries.flatMap((entry) => entry.ranges.map(() => entry))
  const problems = missingLinks(taken.text, taken.moves, owners)

  // The markers carry the passage's lines at the commit they name.
  const blocks = taken.moves.map((moved) => {
    const entry = owners[moved.range]
    let { firstLine } = moved
    if (commit.text !== plan) {
      const places = linesOf(commit.text, moved.body)
      if (places.length === 1) firstLine = places[0] ?? firstLine
      else
        problems.push(
          `lines ${String(moved.firstLine)}-${String(moved.lastLine)}: the passage stands ${String(places.length)} times in PLAN.md at ${commit.at}; commit PLAN.md first, or name the commit that brought the passage with --at`,
        )
    }
    return {
      entry,
      id: `${entry?.kind ?? ''}-${commit.at}-${String(firstLine)}`,
      firstLine,
      lastLine: firstLine + (moved.lastLine - moved.firstLine),
      at: commit.at,
      body: moved.body,
    }
  })

  const archives = new Map()
  for (const entry of entries) {
    if (!archives.has(entry.file))
      archives.set(entry.file, readFileSync(path.join(root, entry.file), 'utf8'))
    const rendered = blocks
      .filter((block) => block.entry === entry)
      .map((block) => renderBlock(block))
    archives.set(entry.file, addToArchive(archives.get(entry.file), entry.heading, rendered))
  }

  // Proof 1: the archive files as they will be written hold every block intact.
  const written = new Map()
  for (const [file, text] of archives) {
    problems.push(...archiveProblems(text).map((problem) => `${file}: ${problem}`))
    for (const block of archiveBlocks(text)) written.set(block.id, block.body)
  }
  // Proof 2: the old plan comes back, byte for byte, from the new one plus those blocks.
  const rebuilt = putBack(
    taken.text,
    taken.moves,
    blocks.map((block) => written.get(block.id) ?? ''),
  )
  if (rebuilt !== plan) problems.push('reassembly: the old PLAN.md is NOT rebuilt from the result')
  // Proof 3: the plan reader parses the same facts.
  const { readPlan, REPORT_PLAN_MAX_BYTES } = await planReader()
  const changes = factChanges(factsOf(readPlan, plan), factsOf(readPlan, taken.text))
  const drift = readPlan(taken.text).facts.drift.length

  const report = [
    ...sizeLines(byteLength(plan), REPORT_PLAN_MAX_BYTES).map((line) => `before  ${line}`),
    ...sizeLines(byteLength(taken.text), REPORT_PLAN_MAX_BYTES).map((line) => `after   ${line}`),
    ...entries.flatMap((entry) => [
      `archive ${entry.file} under "## ${entry.heading}"`,
      ...blocks
        .filter((block) => block.entry === entry)
        .map(
          (block) =>
            `block   ${block.id}  lines ${String(block.firstLine)}-${String(block.lastLine)} at ${block.at}  ${String(byteLength(block.body))} bytes  sha256 ${sha256(block.body)}`,
        ),
    ]),
    `moved   ${String(blocks.length)} blocks, ${String(blocks.reduce((sum, block) => sum + byteLength(block.body), 0))} bytes`,
    `reassembly: ${rebuilt === plan ? `identical to the old PLAN.md (sha256 ${sha256(plan)})` : 'DIFFERENT'}`,
    `parsed facts: ${changes.length === 0 ? 'identical' : `CHANGED in ${changes.join('; ')}`}; format drift after: ${String(drift)}`,
    ...problems.map((problem) => `PROBLEM ${problem}`),
  ]
  for (const line of report) console.log(line)
  if (problems.length > 0 || drift > 0) {
    console.log('Nothing written.')
    return EXIT_FAILED
  }
  if (changes.length > 0 && !flags.has('--allow-fact-change')) {
    console.log(
      'Nothing written: the move would change what the plan reader parses (a status row, a field, a checklist item or a lane table went with it). Leave those lines in PLAN.md, or pass --allow-fact-change for a closed milestone.',
    )
    return EXIT_FAILED
  }
  if (flags.has('--dry-run')) {
    console.log('dry run: nothing written')
    return 0
  }
  writeFileSync(planPath, taken.text)
  for (const [file, text] of archives) writeFileSync(path.join(root, file), text)
  console.log(
    `written. Now run: npx prettier --check PLAN.md ${[...new Set(entries.map((entry) => entry.file))].join(' ')} && npm run check:plan && npm run roadmap:generate`,
  )
  return 0
}

try {
  const { flags, positional } = options(process.argv.slice(2))
  const root = path.resolve(flags.get('--root') ?? repository)
  if (positional[0] === 'status' && positional.length === 1) process.exitCode = await status(root)
  else if (positional[0] === 'move' && positional.length <= 2)
    process.exitCode = await move(root, positional[1], flags)
  else throw new UsageError(USAGE)
} catch (error) {
  if (error instanceof UsageError) {
    console.error(error.message)
    process.exitCode = EXIT_USAGE
  } else if (error instanceof RangeError) {
    console.error(error.message)
    process.exitCode = EXIT_FAILED
  } else throw error
}
