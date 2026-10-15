#!/usr/bin/env node
// The catch-clause gate (`npm run check:catches`): every `catch` clause and
// `.catch(` handler under src holds a named condition or a failure report.
// `node scripts/catch-inventory.mjs --check` scans the tree and compares the
// SWALLOW and GENERIC sites and per-area counts with scripts/catch-baseline.json:
// replacement sites fail even at equal totals; a fall needs a lowered baseline.
// No newly exposed debt is accepted automatically. `--write-baseline` regenerates
// the baseline after an intentional fix; `--inventory <json> --markdown <md>`
// writes the full listing for the certification record.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  checkBaseline,
  countByArea,
  readBaseline,
  renderMarkdown,
  scanCatches,
} from './lib/catch-inventory.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const BASELINE_PATH = path.join(ROOT, 'scripts', 'catch-baseline.json')
const byName = (left, right) => left.localeCompare(right)

const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const flag = (name) => {
  const index = args.indexOf(name)
  if (index === -1) return
  const value = args[index + 1] ?? ''
  return value.startsWith('--') ? '' : value
}

if (has('--write-baseline')) {
  const entries = scanCatches(ROOT)
  const counts = countByArea(entries)
  const baseline = {
    version: 2,
    counts: {},
    sites: entries
      .filter((entry) => entry.class === 'SWALLOW' || entry.class === 'GENERIC')
      .map(({ file, identity, class: kind }) => ({ file, identity, class: kind })),
  }
  for (const area of Object.keys(counts).toSorted(byName))
    baseline.counts[area] = { SWALLOW: counts[area].SWALLOW, GENERIC: counts[area].GENERIC }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`)
  process.stdout.write(`Wrote ${BASELINE_PATH}\n`)
} else if (has('--check')) {
  let baseline
  try {
    baseline = readBaseline(ROOT)
  } catch {
    // A missing baseline is reported below.
  }
  if (baseline === undefined) {
    process.stderr.write('No scripts/catch-baseline.json; run with --write-baseline first\n')
    process.exitCode = 1
  } else {
    const problems = checkBaseline(scanCatches(ROOT), baseline)
    for (const problem of problems) process.stderr.write(`${problem}\n`)
    if (problems.length > 0) process.exitCode = 1
    else process.stdout.write('All catch sites and counts match the baseline\n')
  }
} else {
  const entries = scanCatches(ROOT)
  const counts = countByArea(entries)
  const inventory = flag('--inventory')
  const markdown = flag('--markdown')
  if (inventory !== undefined && inventory !== '')
    fs.writeFileSync(path.resolve(inventory), `${JSON.stringify(entries, null, 2)}\n`)
  if (markdown !== undefined && markdown !== '')
    fs.writeFileSync(path.resolve(markdown), renderMarkdown(entries, counts))
  if (inventory === undefined && markdown === undefined) {
    for (const area of Object.keys(counts).toSorted(byName)) {
      const { NARROW, REPORTED, SWALLOW, GENERIC, CLEANUP } = counts[area]
      process.stdout.write(
        `${area}: NARROW=${String(NARROW)} REPORTED=${String(REPORTED)} SWALLOW=${String(SWALLOW)} GENERIC=${String(GENERIC)} CLEANUP=${String(CLEANUP)}\n`,
      )
    }
  }
}
