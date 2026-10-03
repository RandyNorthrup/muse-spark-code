// M80 W (SPEC §7.5): checks one Action invocation that ran on the fake-only
// test package. The workflow passes the Action's outputs and the scenario in
// W_* variables; this reads the published out/, the launcher's reports beside
// the invocation's work/, the checkout and the startup-trap folder, and exits
// 1 naming every failed check. Only the fabricated key and sentinel exist here.

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isExecResult } from '../../action/lib/result.mjs'

// Projections of test/action/execTestTransport.ts (the launcher's own constants).
const W_FIXTURE_KEY = 'LLM|1|m80-w-fabricated'
const W_SENTINEL = 'M80W-SENTINEL-fabricated-token'
const W_TEXT_FILE = 'test/action/w-text-fix.txt'
const W_IMAGE_FILE = 'generated/m80.png'
const W_TEXT_LINE = 'W text fix: one ordinary new line.'
const CONTRIBUTOR_MINIMUM_DIGITS = '108135'
const NOT_IGNORED = 1

const EXPECTED = Object.freeze({
  review: { status: 'completed', exitCode: '0', requests: 2, cost: '0.000004', exec: 'review' },
  text: { status: 'completed', exitCode: '0', requests: 2, cost: '0.000004', exec: 'text' },
  image: { status: 'completed', exitCode: '0', requests: 3, cost: '0.010004', exec: 'image' },
  'low-budget': {
    status: 'budget_exceeded',
    exitCode: '5',
    requests: 0,
    cost: '0',
    exec: 'review',
  },
})

const failures = []
function check(isOk, what) {
  if (!isOk) failures.push(what)
}

function reportsIn(invocation, command) {
  return readdirSync(invocation)
    .filter((name) => name.startsWith(`w-report-${command}-`) && name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(invocation, name), 'utf8')))
}

function checkReport(report, label) {
  for (const flag of [
    'keyInArgv',
    'keyInEnv',
    'keyInBodies',
    'sentinelInArgv',
    'sentinelInEnv',
    'sentinelInBodies',
  ]) {
    check(report[flag] === false, `${label}: ${flag} is ${String(report[flag])}`)
  }
  check(report.countRequests === 0, `${label}: a counting request was made`)
  check(report.passedThrough === 0, `${label}: a request left the scripted transport`)
  if (report.initialEnviron === 'inspected') {
    check(report.keyInInitialEnviron === false, `${label}: the key is in its initial environment`)
    check(report.sentinelInInitialEnviron === false, `${label}: the sentinel is in its environment`)
  }
  if (process.platform !== 'linux') return
  check(report.initialEnviron === 'inspected', `${label}: /proc environ was not inspected`)
  check(
    report.parentHoldsKeyVariable === true,
    `${label}: the parent is not the launcher holding the key variable`,
  )
}

function checkNoLiteral(directory, label) {
  const names = existsSync(directory) ? readdirSync(directory) : []
  for (const name of names) {
    const file = path.join(directory, name)
    if (!statSync(file).isFile()) continue
    const text = readFileSync(file, 'latin1')
    check(!text.includes(W_FIXTURE_KEY), `${label}/${name} holds the key`)
    check(!text.includes(W_SENTINEL), `${label}/${name} holds the sentinel`)
  }
}

function main(env) {
  const scenario = env.W_SCENARIO ?? ''
  const expected = EXPECTED[scenario]
  if (expected === undefined)
    throw new Error('W_SCENARIO must be review, text, image or low-budget')
  const out = env.W_OUT_DIR ?? ''
  check(path.isAbsolute(out) && existsSync(out), 'out-dir is missing')
  if (failures.length > 0) return
  const invocation = path.dirname(out)
  check(env.W_STATUS === expected.status, `status is ${String(env.W_STATUS)}`)
  check(env.W_EXIT_CODE === expected.exitCode, `exit-code is ${String(env.W_EXIT_CODE)}`)
  check(env.W_REQUESTS === String(expected.requests), `requests is ${String(env.W_REQUESTS)}`)
  check(env.W_COST === expected.cost, `cost-usd is ${String(env.W_COST)}`)
  const resultFile = path.join(out, 'result.json')
  const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null
  check(result !== null && isExecResult(result), 'result.json is missing or invalid')
  const execReports = reportsIn(invocation, 'exec')
  check(execReports.length === 1, `${String(execReports.length)} exec reports`)
  const exec = execReports[0]
  if (exec !== undefined) {
    checkReport(exec, 'exec')
    check(exec.scenario === expected.exec, `exec ran scenario ${String(exec.scenario)}`)
    check(exec.billableRequests === expected.requests, 'billable requests differ from the outputs')
    check(
      result?.usage?.requests === exec.billableRequests,
      'the ledger differs from the fake receipts',
    )
    if (scenario !== 'low-budget') check(exec.sawKey === true, 'exec sent no key')
  }
  const scans = reportsIn(invocation, 'scan-secrets')
  for (const scan of scans) checkReport(scan, 'scanner')
  const patch = path.join(out, 'fix.patch')
  const manifest = path.join(out, 'manifest.json')
  if (scenario === 'text') {
    check(env.W_PATCH_PATH === patch && existsSync(patch), 'no published patch')
    check(env.W_PATCH_WITHHELD === '', `patch withheld: ${String(env.W_PATCH_WITHHELD)}`)
    check(scans.length === 1, `${String(scans.length)} scanner reports`)
    if (existsSync(patch) && existsSync(manifest)) {
      const bytes = readFileSync(patch)
      const text = bytes.toString('utf8')
      check(text.includes(W_TEXT_FILE) && text.includes(W_TEXT_LINE), 'the patch misses the fix')
      const digest = createHash('sha256').update(bytes).digest('hex')
      check(JSON.parse(readFileSync(manifest, 'utf8')).patchSha256 === digest, 'manifest digest')
    } else check(false, 'no published manifest')
  } else {
    check(env.W_PATCH_PATH === '', 'a patch path was advertised')
    check(!existsSync(patch) && !existsSync(manifest), 'a patch or manifest was published')
  }
  if (scenario === 'image') checkImage(env, scans)
  else if (scenario === 'low-budget') {
    check(result?.error?.message?.includes(CONTRIBUTOR_MINIMUM_DIGITS) === true, 'no named minimum')
  }
  checkNoLiteral(out, 'out')
  checkNoLiteral(invocation, 'invocation')
  checkTraps(env.W_TRAP_DIR ?? '')
}

/** W-image: a paid tally, the whole binary patch withheld unscanned, the PNG unignored. */
function checkImage(env, scans) {
  check(env.W_PATCH_WITHHELD === 'binary', `patch withheld: ${String(env.W_PATCH_WITHHELD)}`)
  check(env.W_IMAGES === '1' && env.W_IMAGE_ATTEMPTS === '1', 'the paid image tally is wrong')
  check(scans.length === 0, 'the binary patch was scanned instead of withheld')
  const checkout = env.W_CHECKOUT ?? ''
  check(existsSync(path.join(checkout, W_IMAGE_FILE)), 'the generated PNG is missing')
  const ignored = spawnSync('git', ['-C', checkout, 'check-ignore', '-q', W_IMAGE_FILE])
  check(ignored.status === NOT_IGNORED, 'the generated PNG path is ignored or unchecked')
}

/** No planted BASH_ENV, ENV or NODE_OPTIONS startup trap ran. */
function checkTraps(traps) {
  if (traps === '') return
  const fired = readdirSync(traps).filter((name) => name.startsWith('fired-'))
  check(fired.length === 0, `startup traps ran: ${fired.join(', ')}`)
}

main(process.env)
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`::error::W check failed: ${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`W ${String(process.env.W_SCENARIO)}: every check passed.\n`)
}
