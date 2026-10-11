#!/usr/bin/env node
// Generates the public ROADMAP.md, or checks that it is current (`--check`).
// Milestone ids and statuses come from PLAN.md through the same pure reader
// as check:plan; release headings come from CHANGELOG.md; the user-facing
// words come from docs/roadmap/entries.json. The rules live in
// scripts/lib/roadmap.mjs. Nothing here reads the clock, Git or the network,
// so the same tree always gives the same file.
import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'
import { generateRoadmap, staleReason } from './lib/roadmap.mjs'

const root = path.resolve(import.meta.dirname, '..')
const files = {
  plan: path.join(root, 'PLAN.md'),
  changelog: path.join(root, 'CHANGELOG.md'),
  entries: path.join(root, 'docs', 'roadmap', 'entries.json'),
  roadmap: path.join(root, 'ROADMAP.md'),
}

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

function read(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (error) {
    console.error(
      `roadmap: ${path.relative(root, file)} could not be read (${String(error.message)})`,
    )
    return process.exit(1)
  }
}

const options = (await resolveConfig(files.roadmap)) ?? {}
const { content, problems, notes, entryCount } = await generateRoadmap({
  planText: read(files.plan),
  changelogText: read(files.changelog),
  entriesText: read(files.entries),
  plan: {
    readPlan,
    findMilestone,
    generatedCode: REPORT_EXIT_CODES.generated,
    maxBytes: REPORT_PLAN_MAX_BYTES,
  },
  format: (markdown) => format(markdown, { ...options, parser: 'markdown' }),
})

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
  const reason = staleReason(current, content)
  if (reason !== null) {
    console.error(`roadmap: ${reason}`)
    process.exit(1)
  }
  console.log(`Roadmap: ${String(entryCount)} entries; ROADMAP.md is current`)
} else {
  writeFileSync(files.roadmap, content)
  console.log(`Roadmap: ${String(entryCount)} entries; ROADMAP.md written`)
}
