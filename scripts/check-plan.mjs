#!/usr/bin/env node
// Read the same pure parser as reports. No generated baseline or ignored drift.
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
// Our own hygiene bound for PLAN.md, in bytes: 85% of the former 4 MiB
// product reader bound. It stays exactly here so it is never raised, and it
// no longer depends on a product bound: reports read the whole plan however
// large unless the person sets their own byte limit (D121). Past it the gate
// fails and names the procedure below.
const PLAN_ARCHIVE_AT_BYTES = 3_565_158
const PLAN_ARCHIVE_AT_PERCENT = 85
const PLAN_ARCHIVE_PROCEDURE =
  'Move closed history to docs/plan-archive/ before adding more: CONTRIBUTING.md, "Archiving closed history from PLAN.md".'
const args = process.argv.slice(2)
if (args.length > 2 || args.some((arg) => arg.startsWith('--'))) {
  console.error('check:plan [file] [milestone-id]')
  process.exitCode = 2
} else {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export { readPlan } from './src/core/reporting/plan/reader'; export { findMilestone } from './src/core/reporting/plan/selection'; export { UI_TEXT, REPORT_EXIT_CODES } from './src/shared/constants'; export { fill } from './src/shared/l10n/text'; export { scrubPlanText } from './src/core/reporting/plan/grammar'",
      resolveDir: root,
      loader: 'ts',
      sourcefile: 'check-plan-entry.ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  const { readPlan, findMilestone, UI_TEXT, REPORT_EXIT_CODES, fill, scrubPlanText } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  )
  const file = path.resolve(args[0] ?? path.join(root, 'PLAN.md'))
  try {
    const text = await readFile(file, 'utf8')
    const bytesUsed = Buffer.byteLength(text)
    const { facts } = readPlan(text)
    for (const drift of facts.drift)
      console.error(
        scrubPlanText(
          `${path.basename(file)}:${drift.line}: ${fill(UI_TEXT.reportUi.planDrift, { line: String(drift.line), detail: `${drift.code}: ${drift.detail}` })}`,
        ),
      )
    if (facts.drift.length > 0) process.exitCode = REPORT_EXIT_CODES.failed
    else if (bytesUsed > PLAN_ARCHIVE_AT_BYTES) {
      console.error(
        `${path.basename(file)} is ${String(bytesUsed)} bytes, over ${String(PLAN_ARCHIVE_AT_PERCENT)}% (${String(PLAN_ARCHIVE_AT_BYTES)} bytes) of the archived-plan budget. ${PLAN_ARCHIVE_PROCEDURE}`,
      )
      process.exitCode = REPORT_EXIT_CODES.failed
    } else if (args[1]) {
      const selected = findMilestone(facts, args[1])
      process.exitCode = selected.exitCode
      if (selected.exitCode === REPORT_EXIT_CODES.notFound)
        console.error(
          scrubPlanText(
            fill(UI_TEXT.reportUi.notFound, { id: args[1], nearest: selected.nearest.join(', ') }),
          ),
        )
      else console.log(scrubPlanText(`${selected.milestone.id}: ${selected.milestone.status}`))
    } else
      console.log(
        `check:plan: ${facts.format}; ${facts.milestones.length} milestones; ${facts.drift.length} drift`,
      )
  } catch {
    console.error(scrubPlanText(UI_TEXT.reportUi.generationFailed))
    process.exitCode = REPORT_EXIT_CODES.failed
  }
}
