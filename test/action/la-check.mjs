// M80 LA (PLAN.md D65): checks the one live Action invocation that
// action-live.yml ran with the real key on the product package. The workflow
// passes the Action's outputs, the mode and the trap folder in LA_* variables;
// this reads the published out/ and the invocation folder and exits 1 naming
// every failed check. It never receives the key: a leak is looked for by the
// key's shape (src/core/redact.ts), which no redacted output may carry, and
// only file names are reported, never the matching text.

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isExecResult, microUsd } from '../../action/lib/result.mjs'

const LA_MODEL = 'muse-spark-1.3-contributor'
const LA_BUDGET_USD = 0.25
// The two Meta Model API key shapes, as src/core/redact.ts matches them.
const KEY_SHAPE = /LLM_[\w-]{16,}|LLM\|\d+\|[\w+./=-]+/
const EXEC_MODE = Object.freeze({ review: 'plan', text: 'acceptEdits' })

const failures = []
function check(isOk, what) {
  if (!isOk) failures.push(what)
}

/** Every regular file under a folder, depth first. */
function filesUnder(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name)
    const stat = statSync(file)
    if (stat.isDirectory()) return filesUnder(file)
    return stat.isFile() ? [file] : []
  })
}

/** No key-shaped string and no sentinel in any file; reports names only. */
function checkNoLeak(files, base, label, sentinel) {
  for (const file of files) {
    const text = readFileSync(file, 'latin1')
    const name = path.relative(base, file)
    check(!KEY_SHAPE.test(text), `${label}/${name} holds a key-shaped string`)
    check(sentinel === '' || !text.includes(sentinel), `${label}/${name} holds the sentinel`)
  }
}

/** The published result: valid, completed, the contributor model, within the cap. */
function checkResult(result, env, mode) {
  check(result !== null && isExecResult(result), 'result.json is missing or invalid')
  if (result === null) return
  check(result.status === 'completed', `result status is ${String(result.status)}`)
  check(result.backend === 'modelApi', `backend is ${String(result.backend)}`)
  check(result.model === LA_MODEL, `model is ${String(result.model)}`)
  check(result.mode === EXEC_MODE[mode], `exec mode is ${String(result.mode)}`)
  check(result.finalMessage?.trim() !== '', 'the final message is empty')
  check(result.limits?.budgetUsd === LA_BUDGET_USD, 'the budget is not $0.25')
  check(result.ledger?.breach === false, 'the ledger reports a breach')
  const cost = result.usage?.costUsd
  const spent = microUsd(cost?.total)
  check(spent !== undefined && spent <= microUsd(LA_BUDGET_USD), 'the cost exceeds the cap')
  check(String(cost?.total) === env.LA_COST, 'cost-usd differs from the result')
  check(result.usage?.requests === Number(env.LA_REQUESTS), 'requests differ from the result')
  check(result.usage?.paid?.imageAttempts === 0, 'a paid image was attempted')
}

/**
 * A review publishes no patch. A text run may propose none or have it
 * withheld; one it publishes is the advertised file and matches its manifest.
 */
function checkPatch(env, out, mode) {
  const patch = path.join(out, 'fix.patch')
  const manifest = path.join(out, 'manifest.json')
  if (mode === 'review') {
    check(env.LA_PATCH_PATH === '', 'a review advertised a patch')
    check(!existsSync(patch) && !existsSync(manifest), 'a review published a patch')
    return
  }
  if (env.LA_PATCH_PATH === '') return
  check(env.LA_PATCH_PATH === patch, 'the advertised patch is not out/fix.patch')
  if (!existsSync(patch) || !existsSync(manifest)) {
    check(false, 'the advertised patch or its manifest is missing')
    return
  }
  const digest = createHash('sha256').update(readFileSync(patch)).digest('hex')
  check(JSON.parse(readFileSync(manifest, 'utf8')).patchSha256 === digest, 'manifest digest')
}

/** No planted BASH_ENV, ENV or NODE_OPTIONS startup trap ran. */
function checkTraps(traps) {
  check(traps !== '' && existsSync(traps), 'the trap folder is missing')
  if (!existsSync(traps)) return
  const fired = readdirSync(traps).filter((name) => name.startsWith('fired-'))
  check(fired.length === 0, `startup traps ran: ${fired.join(', ')}`)
}

function main(env) {
  const mode = env.LA_MODE ?? ''
  if (!Object.hasOwn(EXEC_MODE, mode)) throw new Error('LA_MODE must be review or text')
  const out = env.LA_OUT_DIR ?? ''
  check(path.isAbsolute(out) && existsSync(out), 'out-dir is missing')
  if (failures.length > 0) return
  check(env.LA_STATUS === 'completed', `status is ${String(env.LA_STATUS)}`)
  check(env.LA_EXIT_CODE === '0', `exit-code is ${String(env.LA_EXIT_CODE)}`)
  check(Number(env.LA_REQUESTS) >= 1, `requests is ${String(env.LA_REQUESTS)}`)
  check(env.LA_IMAGES === '0' && env.LA_IMAGE_ATTEMPTS === '0', 'images were generated')
  const resultFile = path.join(out, 'result.json')
  const result = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : null
  checkResult(result, env, mode)
  checkPatch(env, out, mode)
  const sentinel = env.LA_SENTINEL ?? ''
  check(sentinel !== '', 'the sentinel is missing')
  // The tidy step removes work/ (the diff, the prompt, the agent install), so
  // only the published outputs remain beside it.
  check(!existsSync(path.join(path.dirname(out), 'work')), 'the work folder was not tidied')
  checkNoLeak(filesUnder(out), out, 'out', sentinel)
  checkTraps(env.LA_TRAP_DIR ?? '')
}

main(process.env)
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`::error::LA check failed: ${failure}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`LA ${String(process.env.LA_MODE)}: every check passed.\n`)
}
