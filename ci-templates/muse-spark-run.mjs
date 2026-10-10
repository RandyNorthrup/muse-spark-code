// Muse Spark Code (Unofficial): shared headless runner for CI systems other
// than GitHub Actions (lane CM80CI, PLAN.md M80/D65). GitLab CI, Azure
// Pipelines, Jenkins and Bitbucket Pipelines templates under ci-templates/
// set MUSE_* variables and run `node muse-spark-run.mjs`. Node builtins only,
// so it runs from a vendored copy with no install step.
//
// Contract mirror: action/action.yml inputs (mode, max-budget-usd,
// image-generation, max-requests, timeout-minutes, model, effort,
// allow-contributor-models), action/lib/tools.mjs validation grammar,
// action/lib/run-exec.mjs key handling (takeModelApiKey) and exec argv, and
// docs/ci.md's exit table. Differences from the Action are deliberate and
// documented in docs/ci-other-systems.md: no checkout/gate/comment/push
// phases (each system's template wires its own trigger and fork protection),
// no patch publication, and the prompt arrives via MUSE_PROMPT(_FILE).
//
// The Model API key arrives in MUSE_SPARK_MODEL_API_KEY (mapped from that
// system's secret store by the template). It is validated, deleted from the
// child environment and piped over private stdin to exactly one trusted
// child (`<agent> exec --key-stdin`). It is never printed, never placed on
// argv, and references are dropped in finally.

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'

export const KEY_VARIABLE = 'MUSE_SPARK_MODEL_API_KEY'
// Projection of src/shared/constants.ts MODEL_API_KEY_PATTERN, as in
// action/lib/run-exec.mjs: parity-tested there, structural here.
export const MODEL_API_KEY_PATTERN = /^(?:LLM_[\w-]{16,}|LLM\|\d+\|\S+)$/
const KEY_MAX_BYTES = 4096
const DECIMAL_BUDGET = /^[0-9]+(?:\.[0-9]{1,6})?$/
const INTEGER = /^[0-9]+$/
const MODEL_PATTERN = /^[A-Za-z0-9._-]{1,100}$/
const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const PROMPT_MAX_BYTES = 262_144
const UNTRUSTED_FILES_MAX = 8
const MILLISECONDS_PER_MINUTE = 60_000
const RUNNER_OVERHEAD_MS = 60_000

export const CI_DEFAULTS = {
  mode: 'review',
  imageGeneration: 'false',
  maxRequests: '30',
  timeoutMinutes: '20',
  model: '',
  effort: '',
  allowContributorModels: 'false',
  maxDiffBytes: '262144',
  agentBin: 'muse-spark-code-acp',
  agentVersion: '0.17.0',
  outDir: 'muse-spark-out',
}

export class InputError extends Error {}

/** Forward slashes everywhere, so logs and summaries match on Windows too. */
export function toPosix(value) {
  return value.replaceAll('\\', '/')
}

function exactBoolean(env, name, fallback) {
  const value = env[name] ?? ''
  if (value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new InputError(`${name} must be true or false`)
}

function boundedInteger(env, name, fallback, min, max) {
  const value = env[name] ?? ''
  if (value === '') return fallback
  if (!INTEGER.test(value)) throw new InputError(`${name} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InputError(`${name} must be between ${String(min)} and ${String(max)}`)
  }
  return parsed
}

function budgetString(value) {
  if (typeof value !== 'string' || !DECIMAL_BUDGET.test(value)) {
    throw new InputError('MUSE_MAX_BUDGET_USD must be a plain decimal number of USD')
  }
  const [whole = '', fraction = ''] = value.split('.', 2)
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (units < 1n || units > 20_000_000n) {
    throw new InputError('MUSE_MAX_BUDGET_USD must be more than 0 and at most 20')
  }
  return value
}

/**
 * The key from this step's environment, deleted at once. One trailing LF is
 * stripped; empty, multi-line, oversize or malformed keys are refused
 * (undefined) without echoing anything. Mirrors takeModelApiKey.
 */
export function takeModelApiKey(env) {
  const raw = env[KEY_VARIABLE]
  Reflect.deleteProperty(env, KEY_VARIABLE)
  if (typeof raw !== 'string') return
  const key = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  const isValid =
    key !== '' &&
    !/[\r\n]/.test(key) &&
    Buffer.byteLength(key) <= KEY_MAX_BYTES &&
    MODEL_API_KEY_PATTERN.test(key)
  return isValid ? key : undefined
}

/** Every runner input from the step environment (MUSE_*), validated. */
export function parseRunnerInputs(env) {
  const mode = env.MUSE_MODE ?? CI_DEFAULTS.mode
  if (mode !== 'review' && mode !== 'fix') throw new InputError('MUSE_MODE must be review or fix')
  const imageGeneration = exactBoolean(env, 'MUSE_IMAGE_GENERATION', false)
  if (imageGeneration && mode !== 'fix') {
    throw new InputError('MUSE_IMAGE_GENERATION needs MUSE_MODE=fix')
  }
  const effort = env.MUSE_EFFORT ?? ''
  if (effort !== '' && !EFFORTS.has(effort))
    throw new InputError('MUSE_EFFORT is not a known level')
  const model = env.MUSE_MODEL ?? ''
  if (model !== '' && !MODEL_PATTERN.test(model))
    throw new InputError('MUSE_MODEL is not a model id')
  const prompt = env.MUSE_PROMPT ?? ''
  const promptFile = env.MUSE_PROMPT_FILE ?? ''
  if ((prompt === '') === (promptFile === '')) {
    throw new InputError('set exactly one of MUSE_PROMPT or MUSE_PROMPT_FILE')
  }
  let promptText = prompt
  if (promptFile !== '') {
    try {
      promptText = readFileSync(promptFile, 'utf8')
    } catch {
      throw new InputError('MUSE_PROMPT_FILE is not readable')
    }
  }
  const extra = env.MUSE_EXTRA_INSTRUCTIONS ?? ''
  if (extra.length > 4000) {
    throw new InputError('MUSE_EXTRA_INSTRUCTIONS must be at most 4000 characters')
  }
  const finalPrompt = extra === '' ? promptText : `${promptText}\n\nExtra instructions:\n${extra}`
  if (finalPrompt === '' || Buffer.byteLength(finalPrompt) > PROMPT_MAX_BYTES) {
    throw new InputError('prompt must be nonempty and at most 262144 bytes')
  }
  const untrustedRaw = env.MUSE_UNTRUSTED_FILES ?? ''
  const untrustedFiles = untrustedRaw === '' ? [] : untrustedRaw.split('\n').filter((f) => f !== '')
  if (untrustedFiles.length > UNTRUSTED_FILES_MAX) {
    throw new InputError('MUSE_UNTRUSTED_FILES holds at most 8 files')
  }
  return {
    mode,
    maxBudgetUsd: budgetString(env.MUSE_MAX_BUDGET_USD ?? ''),
    imageGeneration,
    maxRequests: boundedInteger(env, 'MUSE_MAX_REQUESTS', 30, 1, 500),
    timeoutMinutes: boundedInteger(env, 'MUSE_TIMEOUT_MINUTES', 20, 1, 360),
    model,
    effort,
    allowContributorModels: exactBoolean(env, 'MUSE_ALLOW_CONTRIBUTOR_MODELS', false),
    maxDiffBytes: boundedInteger(env, 'MUSE_MAX_DIFF_BYTES', 262_144, 1, 1_048_576),
    promptText: finalPrompt,
    untrustedFiles,
    workspace: env.MUSE_WORKSPACE ?? process.cwd(),
    agentBin: env.MUSE_AGENT_BIN ?? CI_DEFAULTS.agentBin,
    outDir: env.MUSE_OUT_DIR ?? CI_DEFAULTS.outDir,
  }
}

/**
 * exec's arguments: one array, never a shell string. Mirrors execArguments in
 * action/lib/run-exec.mjs, minus the Action's private prompt/diff staging
 * (the template runs inside the checkout, so the prompt and untrusted files
 * travel as argv).
 */
export function execArguments(inputs) {
  return [
    'exec',
    '--key-stdin',
    '--backend',
    'modelApi',
    '--cwd',
    inputs.workspace,
    '--permission-mode',
    inputs.mode === 'fix' ? 'acceptEdits' : 'plan',
    '--output',
    'json',
    '--ephemeral',
    '--max-budget-usd',
    inputs.maxBudgetUsd,
    '--max-requests',
    String(inputs.maxRequests),
    '--timeout',
    String(inputs.timeoutMinutes * 60),
    ...(inputs.model === '' ? [] : ['--model', inputs.model]),
    ...(inputs.effort === '' ? [] : ['--effort', inputs.effort]),
    ...(inputs.allowContributorModels ? ['--allow-contributor-models'] : []),
    ...(inputs.imageGeneration ? ['--image-generation'] : []),
    ...inputs.untrustedFiles.flatMap((file) => ['--untrusted-file', file]),
    inputs.promptText,
  ]
}

/** docs/ci.md's exit table, from the process exit code alone. */
const EXIT_STATUS = new Map([
  [0, 'completed'],
  [2, 'no_result'],
  [3, 'auth_required'],
  [4, 'failed'],
  [5, 'budget_exceeded'],
  [6, 'timeout'],
  [7, 'denied'],
  [8, 'incomplete'],
  [9, 'accounting_unverified'],
  [130, 'cancelled'],
  [143, 'cancelled'],
])
export function statusForExitCode(code) {
  return EXIT_STATUS.get(code) ?? 'internal'
}

/**
 * Run one headless turn: { exitCode, refused?, error?, stdout?, stderr? }.
 * Stdout of exec is returned for the template to archive. The key travels
 * only as the exec child's stdin.
 */
export async function runOnce(env, overrides = {}) {
  const spawnFn = overrides.spawn ?? spawn
  const untrusted = env.MUSE_UNTRUSTED ?? ''
  if (untrusted !== 'false') {
    const reason =
      untrusted === '' ? 'MUSE_UNTRUSTED is not false' : `untrusted source: ${untrusted}`
    return { exitCode: 0, refused: reason }
  }
  let inputs
  try {
    inputs = parseRunnerInputs(env)
  } catch (error) {
    if (error instanceof InputError) return { exitCode: 2, error: error.message }
    throw error
  }
  const key = takeModelApiKey(env)
  if (key === undefined) return { exitCode: 3, error: 'model API key is missing or malformed' }
  const args = execArguments(inputs)
  const [command, prefix] = toExecPair(inputs.agentBin)
  const argv = [...prefix, ...args]
  const childEnv = { ...env }
  Reflect.deleteProperty(childEnv, KEY_VARIABLE)
  const deadlineMs = inputs.timeoutMinutes * MILLISECONDS_PER_MINUTE + RUNNER_OVERHEAD_MS
  const outcome = await new Promise((resolve) => {
    let isSettled = false
    const finish = (result) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawnFn(command, argv, {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdoutChunks = []
    const stderrTail = []
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderrTail.push(chunk)
      while (Buffer.concat(stderrTail).length > 1_048_576) stderrTail.shift()
    })
    child.on('error', () => finish({ exitCode: 1, error: 'agent process failed to start' }))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ exitCode: 6, error: 'runner deadline exceeded' })
    }, deadlineMs)
    timer.unref?.()
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL' && !isSettled) {
        finish({ exitCode: 6, error: 'runner deadline exceeded' })
        return
      }
      const exitCode = typeof code === 'number' ? code : 1
      finish({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrTail).toString('utf8'),
      })
    })
    child.stdin.on('error', () => {
      // A child that exits before reading its stdin; its exit reports it.
    })
    child.stdin.end(`${key}\n`, 'utf8')
  })
  // The key lived only in this closure; takeModelApiKey already deleted it.
  return outcome
}

/**
 * A spawnable [command, prefixArgs] pair for a tool bin. A .js/.mjs/.cjs
 * entry runs under this Node (as the Action runs agentJs through its trusted
 * Node); anything else must be executable itself. Templates run on Linux, so
 * no shell is ever used.
 */
export function toExecPair(bin) {
  return /\.[cm]?js$/.test(bin) ? [process.execPath, [bin]] : [bin, []]
}

const SHA256_HEX = /^[0-9a-f]{64}$/
const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/
const INSTALL_TIMEOUT_MS = 300_000

/**
 * Install the agent before any secret exists (mirrors the Action's install
 * step, which runs before checkout and the run step). Either an exact pinned
 * registry version (MUSE_AGENT_VERSION, immutable like the Action's SHA pin)
 * or a tarball with its digest (MUSE_AGENT_TARBALL plus
 * MUSE_AGENT_TARBALL_SHA256, both or neither, like the Action's
 * agent-package pair). Returns { exitCode, error? }.
 */
export async function installAgent(env, overrides = {}) {
  const spawnFn = overrides.spawn ?? spawn
  const tarball = env.MUSE_AGENT_TARBALL ?? ''
  const digest = env.MUSE_AGENT_TARBALL_SHA256 ?? ''
  if ((tarball === '') !== (digest === '')) {
    return {
      exitCode: 2,
      error: 'MUSE_AGENT_TARBALL and MUSE_AGENT_TARBALL_SHA256 go together',
    }
  }
  let spec
  if (tarball === '') {
    const version = env.MUSE_AGENT_VERSION ?? CI_DEFAULTS.agentVersion
    if (!EXACT_VERSION.test(version)) {
      return { exitCode: 2, error: 'MUSE_AGENT_VERSION must be an exact x.y.z' }
    }
    spec = `muse-spark-code-acp@${version}`
  } else {
    if (!SHA256_HEX.test(digest)) {
      return {
        exitCode: 2,
        error: 'MUSE_AGENT_TARBALL_SHA256 must be 64 lowercase hex digits',
      }
    }
    let bytes
    try {
      bytes = readFileSync(tarball)
    } catch {
      return { exitCode: 2, error: 'MUSE_AGENT_TARBALL is not readable' }
    }
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== digest) {
      return { exitCode: 2, error: 'MUSE_AGENT_TARBALL digest mismatch' }
    }
    spec = toPosix(tarball)
  }
  const npmBin = env.MUSE_NPM_BIN ?? 'npm'
  const [command, prefix] = toExecPair(npmBin)
  const args = [
    ...prefix,
    'install',
    '--global',
    spec,
    '--no-audit',
    '--no-fund',
    '--no-update-notifier',
  ]
  const childEnv = { ...env }
  Reflect.deleteProperty(childEnv, KEY_VARIABLE)
  return new Promise((resolve) => {
    let isSettled = false
    const finish = (result) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      resolve(result)
    }
    const child = spawnFn(command, args, {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.on('error', () => finish({ exitCode: 1, error: 'npm failed to start' }))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ exitCode: 1, error: 'install timed out' })
    }, INSTALL_TIMEOUT_MS)
    timer.unref?.()
    child.on('close', (code) => {
      finish(
        code === 0
          ? { exitCode: 0 }
          : { exitCode: 1, error: `npm install exited ${String(code === null ? 'killed' : code)}` },
      )
    })
  })
}

function writeSummary(outDir, summary) {
  mkdirSync(outDir, { recursive: true })
  const destination = path.join(outDir, 'run-summary.json')
  writeFileSync(destination, `${JSON.stringify(summary)}\n`, 'utf8')
  return toPosix(destination)
}

async function main() {
  const env = { ...process.env }
  if (process.argv.includes('--install-only')) {
    const installed = await installAgent(env)
    if (installed.error === undefined) process.stdout.write('muse-spark: agent installed.\n')
    else process.stderr.write(`muse-spark: ${installed.error}\n`)
    return installed.exitCode
  }
  if (process.argv.includes('--help')) {
    process.stdout.write(
      'Usage: node muse-spark-run.mjs [--install-only]\n\nMUSE_MODE=review|fix MUSE_MAX_BUDGET_USD=<usd> MUSE_PROMPT=<text>|\nMUSE_PROMPT_FILE=<path> MUSE_UNTRUSTED=false MUSE_SPARK_MODEL_API_KEY=<key>\nrun one headless Model API turn; see docs/ci-other-systems.md.\n',
    )
    return 0
  }
  const result = await runOnce(env)
  if (result.refused !== undefined) {
    process.stdout.write(`muse-spark: refused (${result.refused}); nothing ran.\n`)
    writeSummary(env.MUSE_OUT_DIR ?? CI_DEFAULTS.outDir, {
      status: 'refused',
      exitCode: 0,
      reason: result.refused,
    })
    return 0
  }
  if (result.error !== undefined && result.stdout === undefined) {
    process.stderr.write(`muse-spark: ${result.error}\n`)
    writeSummary(env.MUSE_OUT_DIR ?? CI_DEFAULTS.outDir, {
      status: statusForExitCode(result.exitCode),
      exitCode: result.exitCode,
      error: result.error,
    })
    return result.exitCode
  }
  const outDir = env.MUSE_OUT_DIR ?? CI_DEFAULTS.outDir
  mkdirSync(outDir, { recursive: true })
  if (result.stdout !== undefined) {
    writeFileSync(path.join(outDir, 'result.json'), result.stdout, 'utf8')
  }
  if (result.stderr !== undefined && result.stderr !== '') {
    process.stderr.write(result.stderr)
  }
  const summary = { status: statusForExitCode(result.exitCode), exitCode: result.exitCode }
  const summaryPath = writeSummary(outDir, summary)
  process.stdout.write(
    `muse-spark: ${summary.status} (exit ${String(summary.exitCode)}), summary at ${summaryPath}\n`,
  )
  return result.exitCode
}

const invokedAsScript =
  process.argv[1] !== undefined && toPosix(process.argv[1]).endsWith('/muse-spark-run.mjs')
if (invokedAsScript) {
  try {
    process.exitCode = await main()
  } catch (error) {
    process.stderr.write(
      `muse-spark: internal error: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
