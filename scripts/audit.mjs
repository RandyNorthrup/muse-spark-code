#!/usr/bin/env node
// The dependency audit gate (PLAN.md D4, D29). It keeps the rule of
// `npm audit --audit-level=high` on every build, a release tag included: a
// version is not published while npm reports a high or critical advisory
// against the tree that builds and bundles it. What it adds is a way through
// that does not weaken the gate when an advisory has no fixed version yet
// (an `overrides` pin covers the case where one exists): a reviewed entry in
// .github/audit-exceptions.json, which CODEOWNERS routes to the maintainer.
//
// Exit 1 on: a high or critical advisory with no exception; an exception
// past its expiry, or set more than MAX_EXCEPTION_DAYS ahead; an exception
// whose advisory npm no longer reports (remove it); a malformed list.
//
//   npm run security:audit                           audit this tree
//   node scripts/audit.mjs --report audit.json       judge a saved `npm audit --json`

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const EXCEPTIONS_FILE = '.github/audit-exceptions.json'
const BLOCKING_SEVERITIES = new Set(['high', 'critical'])
const MAX_EXCEPTION_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000
const ADVISORY_ID = /GHSA(-[0-9a-z]{4}){3}$/
const REPORT_FLAG = '--report'

function runAudit() {
  const npmCli = process.env.npm_execpath
  if (npmCli === undefined) {
    throw new Error('run this through "npm run security:audit" (npm_execpath is not set)')
  }
  // npm's own CLI script under this Node: no shell, no npm.cmd.
  const result = spawnSync(process.execPath, [npmCli, 'audit', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error !== undefined) {
    throw result.error
  }
  return result.stdout
}

function loadReport() {
  const flag = process.argv.indexOf(REPORT_FLAG)
  const text = flag === -1 ? runAudit() : readFileSync(process.argv[flag + 1] ?? '', 'utf8')
  const report = JSON.parse(text)
  if (typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error(`npm audit gave no vulnerability list: ${text.slice(0, 400)}`)
  }
  return report
}

/** Every advisory npm reports, by GHSA id, with its severity and package. */
function advisoriesOf(report) {
  const advisories = new Map()
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    const causes = vulnerability.via ?? []
    for (const via of causes) {
      if (typeof via !== 'object' || via === null) {
        continue
      }
      const id = ADVISORY_ID.exec(String(via.url))?.[0] ?? `npm-${String(via.source)}`
      advisories.set(id, { id, severity: via.severity, name: via.name, title: via.title })
    }
  }
  return advisories
}

function loadExceptions() {
  const list = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8'))
  if (!Array.isArray(list)) {
    throw new TypeError(`${EXCEPTIONS_FILE} must be an array`)
  }
  for (const entry of list) {
    const isWellFormed =
      typeof entry?.advisory === 'string' &&
      typeof entry.package === 'string' &&
      typeof entry.reason === 'string' &&
      entry.reason.trim() !== '' &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(entry.expires))
    if (!isWellFormed) {
      throw new TypeError(
        `${EXCEPTIONS_FILE}: every entry needs "advisory", "package", a non-empty "reason" and "expires" (YYYY-MM-DD): ${JSON.stringify(entry)}`,
      )
    }
  }
  return list
}

const report = loadReport()
const advisories = advisoriesOf(report)
const exceptions = loadExceptions()
const today = new Date(new Date().toISOString().slice(0, 10))
const problems = []

for (const advisory of advisories.values()) {
  const isBlocking = BLOCKING_SEVERITIES.has(advisory.severity)
  const exception = exceptions.find((entry) => entry.advisory === advisory.id)
  if (isBlocking && exception === undefined) {
    problems.push(`${advisory.severity} ${advisory.id} in ${advisory.name}: ${advisory.title}`)
  }
  console.log(
    `${isBlocking ? (exception === undefined ? 'FAIL' : 'excp') : 'note'} ${advisory.severity} ${advisory.id} ${advisory.name}`,
  )
}
for (const entry of exceptions) {
  const expires = new Date(entry.expires)
  const days = (expires.getTime() - today.getTime()) / MS_PER_DAY
  if (!advisories.has(entry.advisory)) {
    problems.push(
      `exception ${entry.advisory} (${entry.package}): npm no longer reports it; remove it`,
    )
  } else if (days < 0) {
    problems.push(`exception ${entry.advisory} (${entry.package}) expired on ${entry.expires}`)
  } else if (days > MAX_EXCEPTION_DAYS) {
    problems.push(
      `exception ${entry.advisory} (${entry.package}) runs past ${String(MAX_EXCEPTION_DAYS)} days; review it sooner`,
    )
  }
}

console.log(
  `audit: ${String(advisories.size)} advisories, ${String(exceptions.length)} exceptions (${EXCEPTIONS_FILE})`,
)
if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`  ${problem}`)
  }
  console.error(
    'bump or override the package; with no fixed version, add a reviewed, dated exception (PLAN.md D29)',
  )
  process.exit(1)
}
