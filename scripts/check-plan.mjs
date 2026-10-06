#!/usr/bin/env node
// Read the same pure parser as reports. No generated baseline or ignored drift.
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
if (args.length > 2 || args.some((arg) => arg.startsWith('--'))) {
  console.error('check:plan [file] [milestone-id]')
  process.exitCode = 2
} else {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export { readPlan } from './src/core/reporting/plan/reader'; export { findMilestone } from './src/core/reporting/plan/selection'; export { UI_TEXT, REPORT_EXIT_CODES } from './src/shared/constants'; export { fill } from './src/shared/l10n/text'; export { redactSecrets } from './src/shared/redact'",
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
  const { readPlan, findMilestone, UI_TEXT, REPORT_EXIT_CODES, fill, redactSecrets } = await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  )
  const file = path.resolve(args[0] ?? path.join(root, 'PLAN.md'))
  try {
    const { facts } = readPlan(redactSecrets(await readFile(file, 'utf8')))
    for (const drift of facts.drift)
      console.error(
        `${path.basename(file)}:${drift.line}: ${fill(UI_TEXT.reportUi.planDrift, { line: String(drift.line), detail: `${drift.code}: ${drift.detail}` })}`,
      )
    if (facts.drift.length > 0) process.exitCode = REPORT_EXIT_CODES.failed
    else if (args[1]) {
      const selected = findMilestone(facts, args[1])
      process.exitCode = selected.exitCode
      if (selected.exitCode === REPORT_EXIT_CODES.notFound)
        console.error(
          redactSecrets(
            fill(UI_TEXT.reportUi.notFound, { id: args[1], nearest: selected.nearest.join(', ') }),
          ),
        )
      else console.log(`${selected.milestone.id}: ${selected.milestone.status}`)
    } else
      console.log(
        `check:plan: ${facts.format}; ${facts.milestones.length} milestones; ${facts.drift.length} drift`,
      )
  } catch {
    console.error(UI_TEXT.reportUi.generationFailed)
    process.exitCode = REPORT_EXIT_CODES.failed
  }
}
