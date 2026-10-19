// Real-use run shared logic (lane REALUSECI): the steps file a `real-use.yml`
// dispatch names, the fixed `exec` shape every step runs, the per-step
// verdict, and the transcript check. The key-holding launcher
// (scripts/real-use-run.mjs) and the keyless check (scripts/real-use-check.mjs)
// are thin shells over this file, so unit tests drive the real logic without
// ever touching a key or the network. Usage/cost shapes are validated with
// the Action's own result module, never redefined here.

import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { isExecResult, isExecStatus, microUsd } from '../../action/lib/result.mjs'

// One step's wall clock: the live Action's recipe timeout.
export const REAL_USE_STEP_TIMEOUT_SECONDS = 600

export const REAL_USE_MODEL = 'muse-spark-1.3-contributor'
export const REAL_USE_BACKEND = 'modelApi'
// The steps file lives here in the tested ref's tree; prompts from it are
// untrusted data (like the live Action's PR diff), so the path is confined
// and every field validated before anything runs.
export const REAL_USE_STEPS_DIR = path.join('docs', 'real-use')
export const REAL_USE_STEPS_VERSION = 1
const MAX_STEPS = 8
const MAX_PROMPT_CHARS = 4000
const MAX_EXPECT_CHARS = 4000
const STEP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const BUDGET_GRAMMAR = /^[0-9]+(?:\.[0-9]{1,6})?$/
/** The CLI budget range in micro-USD: over 0 through 20. */
export const MAX_BUDGET_MICRO_USD = 20_000_000n

/**
 * The CLI budget grammar to integer micro-USD; undefined outside it. Unlike
 * the canonical-dollar reader, this accepts trailing zeros (`1.00`), exactly
 * as `exec --max-budget-usd` does.
 */
export function parseBudgetUsd(text) {
  if (typeof text !== 'string' || !BUDGET_GRAMMAR.test(text)) {
    return
  }
  const [whole, fraction = ''] = text.split('.', 2)
  return BigInt(whole) * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6))
}
// Kept transcript prose stays readable: the Action's comment cap.
const FINAL_MESSAGE_KEEP_CHARS = 60_000
const STEP_MODES = Object.freeze({ plan: 'plan', acceptEdits: 'acceptEdits' })
// A non-completed step must still exit nonzero; completed must exit 0.
const COMPLETED_STATUS = 'completed'

export class RealUseInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RealUseInputError'
  }
}

/** Unsigned decimal micro-USD back to the CLI budget grammar. */
export function microUsdToString(units) {
  const whole = units / 1_000_000n
  const fraction = units % 1_000_000n
  return fraction === 0n
    ? String(whole)
    : `${String(whole)}.${String(fraction).padStart(6, '0').replace(/0+$/, '')}`
}

/**
 * Resolve `wanted` under `root`, refusing escapes (`..`, absolute paths) and
 * symlink redirections: both sides are canonicalised first, so a symlinked
 * directory inside the root cannot smuggle a path outside it.
 */
export function resolveWithin(root, wanted, label) {
  let base
  let target
  try {
    base = realpathSync(root)
    target = realpathSync(path.resolve(base, wanted))
  } catch {
    throw new RealUseInputError(`${label} is unreadable`)
  }
  const relative = path.relative(base, target)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RealUseInputError(`${label} escapes ${root}`)
  }
  return target
}

/** The steps file path must name a JSON file inside docs/real-use/. */
export function resolveStepsFile(refRoot, stepsFile) {
  const forward = String(stepsFile).replaceAll(path.win32.sep, () => path.posix.sep)
  const confined = path.posix.normalize(forward)
  if (path.posix.isAbsolute(confined) || confined.startsWith('..') || !confined.endsWith('.json')) {
    throw new RealUseInputError(`steps file must be a JSON path under ${REAL_USE_STEPS_DIR}`)
  }
  try {
    const root = realpathSync(refRoot)
    const target = realpathSync(path.resolve(root, confined))
    const prefix = `${realpathSync(path.join(root, REAL_USE_STEPS_DIR))}${path.sep}`
    if (!target.startsWith(prefix)) {
      throw new RealUseInputError(`steps file must be a JSON path under ${REAL_USE_STEPS_DIR}`)
    }
    return target
  } catch (error) {
    if (error instanceof RealUseInputError) throw error
    throw new RealUseInputError('steps file is unreadable')
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * A workspace file the product must report as changed: a relative path with
 * no escape, as the result schema's own path list holds it (forward
 * slashes; a steps file authored on Windows may use backslashes).
 */
function isStepPath(value) {
  return (
    typeof value === 'string' &&
    value !== '' &&
    !value.startsWith('/') &&
    !value.includes(':') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  )
}

/**
 * The validated steps: version 1, 1-8 steps, each one `exec` prompt with a
 * plan/acceptEdits mode, an optional budget no looser than the CLI grammar,
 * an optional expected status (default completed, and always one the result
 * schema names, so a typo fails before any key or money is involved), an
 * optional expected text a person must see in the released final message,
 * optional workspace files the result must list as changed, and an optional
 * no-requests flag for pre-dispatch refusal probes.
 */
export function parseStepsFile(text) {
  let document
  try {
    document = JSON.parse(text)
  } catch {
    throw new RealUseInputError('steps file is not JSON')
  }
  if (!isRecord(document) || document.version !== REAL_USE_STEPS_VERSION) {
    throw new RealUseInputError('steps file must carry version 1')
  }
  if (
    !Array.isArray(document.steps) ||
    document.steps.length === 0 ||
    document.steps.length > MAX_STEPS
  ) {
    throw new RealUseInputError('steps file must name 1 to 8 steps')
  }
  const seen = new Set()
  return document.steps.map((step, index) => {
    const label = `step ${index + 1}`
    if (!isRecord(step) || typeof step.id !== 'string' || !STEP_ID.test(step.id)) {
      throw new RealUseInputError(`${label} needs a slug id`)
    }
    if (seen.has(step.id)) throw new RealUseInputError(`step id ${step.id} repeats`)
    seen.add(step.id)
    if (step.mode !== STEP_MODES.plan && step.mode !== STEP_MODES.acceptEdits) {
      throw new RealUseInputError(`${label} mode is plan or acceptEdits`)
    }
    if (
      typeof step.prompt !== 'string' ||
      step.prompt === '' ||
      step.prompt.length > MAX_PROMPT_CHARS
    ) {
      throw new RealUseInputError(`${label} prompt is 1 to 4000 characters`)
    }
    if (
      step.expect !== undefined &&
      (typeof step.expect !== 'string' ||
        step.expect === '' ||
        step.expect.length > MAX_EXPECT_CHARS)
    ) {
      throw new RealUseInputError(`${label} expect is 1 to 4000 characters`)
    }
    const stepBudget =
      step.maxBudgetUsd === undefined ? undefined : parseBudgetUsd(step.maxBudgetUsd)
    if (
      step.maxBudgetUsd !== undefined &&
      (stepBudget === undefined || stepBudget <= 0n || stepBudget > MAX_BUDGET_MICRO_USD)
    ) {
      throw new RealUseInputError(`${label} maxBudgetUsd is unsigned decimal over 0 through 20`)
    }
    if (step.expectStatus !== undefined && !isExecStatus(step.expectStatus)) {
      throw new RealUseInputError(`${label} expectStatus names an exec status`)
    }
    let expectFiles
    if (step.expectFiles !== undefined) {
      if (
        !Array.isArray(step.expectFiles) ||
        step.expectFiles.length === 0 ||
        step.expectFiles.some((name) => typeof name !== 'string')
      ) {
        throw new RealUseInputError(`${label} expectFiles names workspace files`)
      }
      expectFiles = step.expectFiles.map((name) => name.replaceAll('\\', '/'))
      if (expectFiles.some((name) => !isStepPath(name))) {
        throw new RealUseInputError(`${label} expectFiles names workspace files`)
      }
    }
    if (step.expectNoRequests !== undefined && typeof step.expectNoRequests !== 'boolean') {
      throw new RealUseInputError(`${label} expectNoRequests is a boolean`)
    }
    return {
      id: step.id,
      mode: step.mode,
      prompt: step.prompt,
      expect: step.expect,
      expectStatus: step.expectStatus ?? COMPLETED_STATUS,
      maxBudgetUsd: step.maxBudgetUsd,
      expectFiles,
      expectNoRequests: step.expectNoRequests ?? false,
    }
  })
}

/**
 * The one fixed `exec` shape every step runs: the contributor model by its
 * explicit name, JSON result on stdout, the prompt by file (stdin carries the
 * key), an empty workspace, and the remaining calls/dollars as the product's
 * own caps. Nothing in the steps file reaches argv except the mode.
 */
export function buildExecArgs({
  agentJs,
  workspace,
  mode,
  promptFile,
  budgetUsd,
  maxRequests,
  timeoutSeconds,
}) {
  return [
    agentJs,
    'exec',
    '--key-stdin',
    '--backend',
    REAL_USE_BACKEND,
    '--cwd',
    workspace,
    '--permission-mode',
    mode,
    '--output',
    'json',
    '--ephemeral',
    '--max-budget-usd',
    budgetUsd,
    '--max-requests',
    String(maxRequests),
    '--timeout',
    String(timeoutSeconds),
    '--model',
    REAL_USE_MODEL,
    '--allow-contributor-models',
    '--prompt-file',
    promptFile,
  ]
}

/**
 * PASS is narrow on purpose: the validated result's own status equals the
 * step's expected status, completed means process exit 0 (anything else means
 * nonzero), the expected text, when the step names one, appears in the
 * released final message, every expected file is in the result's changed
 * list, and a no-requests probe sent nothing billable (zero requests and a
 * zero or absent cost). The full prose stays in the transcript so a person
 * can overrule.
 */
export function verdictForStep(step, result, exitCode) {
  if (!isExecResult(result)) return { verdict: 'FAIL', reason: 'no valid result' }
  if (result.status !== step.expectStatus) {
    return { verdict: 'FAIL', reason: `status ${String(result.status)}` }
  }
  if (step.expectStatus === COMPLETED_STATUS ? exitCode !== 0 : exitCode === 0) {
    return { verdict: 'FAIL', reason: `exit ${String(exitCode)}` }
  }
  if (
    step.expectFiles !== undefined &&
    step.expectFiles.some((name) => !result.filesChanged.includes(name))
  ) {
    return { verdict: 'FAIL', reason: 'expected file absent' }
  }
  if (step.expectNoRequests === true) {
    const requests = result.usage.requests ?? 0
    const total = result.usage.costUsd === null ? 0n : microUsd(result.usage.costUsd.total)
    if (requests !== 0 || total !== 0n) {
      return { verdict: 'FAIL', reason: 'expected no requests' }
    }
  }
  return step.expect === undefined || result.finalMessage.includes(step.expect)
    ? { verdict: 'PASS', reason: '' }
    : { verdict: 'FAIL', reason: 'expected text absent' }
}

/** The transcript keeps the first 60,000 characters and says when it cut. */
export function keepFinalMessage(message) {
  return message.length <= FINAL_MESSAGE_KEEP_CHARS
    ? { text: message, truncated: false }
    : { text: message.slice(0, FINAL_MESSAGE_KEEP_CHARS), truncated: true }
}

/**
 * The keyless check over one finished run: every transcript step re-reads its
 * own result file (confined to the run folder), each result is valid and on
 * the contributor model, verdicts are all PASS, the summed requests/dollars
 * equal the transcript's actuals and stay within the stated inputs, the
 * ledger never reports a breach, no trap fired, and no published file holds
 * a key-shaped string or the sentinel. Returns every failure; empty passes.
 */
export function checkRealUseRun({ runDir, transcript, steps, stated }) {
  const failures = []
  const check = (isOk, what) => {
    if (!isOk) failures.push(what)
  }
  const base = realpathSync(runDir)
  check(transcript.version === 1, 'transcript version is not 1')
  check(transcript.model === REAL_USE_MODEL, `transcript model is ${String(transcript.model)}`)
  check(
    Array.isArray(transcript.steps) && transcript.steps.length === steps.length,
    'transcript steps do not match the steps file',
  )
  let calls = 0n
  let spent = 0n
  const entries = (transcript.steps ?? []).map((entry, index) => [index, entry])
  for (const [index, entry] of entries) {
    const step = steps[index]
    const label = step === undefined ? `step ${index + 1}` : step.id
    check(entry?.id === step?.id, `${label} id changed`)
    const result = readStepResult(base, entry, label)
    check(isExecResult(result), `${label} result is missing or invalid`)
    if (!isExecResult(result)) continue
    check(result.model === REAL_USE_MODEL, `${label} model is ${String(result.model)}`)
    check(result.backend === REAL_USE_BACKEND, `${label} backend is ${String(result.backend)}`)
    // A missing ledger is valid for early failures and reports no breach.
    check(
      result.ledger === null || result.ledger.breach === false,
      `${label} ledger reports a breach`,
    )
    const verdict = step === undefined ? undefined : verdictForStep(step, result, entry?.exitCode)
    check(entry?.verdict === 'PASS' && verdict?.verdict === 'PASS', `${label} is not PASS`)
    calls += BigInt(result.usage.requests ?? 0)
    // Early setup failures validly carry no accounting: null spends nothing.
    const total = result.usage.costUsd === null ? undefined : microUsd(result.usage.costUsd.total)
    if (total !== undefined) spent += total
  }
  check(calls === BigInt(transcript.actual?.calls ?? -1), 'transcript calls do not sum')
  check(microUsd(transcript.actual?.costUsd) === spent, 'transcript dollars do not sum')
  check(calls <= BigInt(stated.calls), 'actual calls pass the stated count')
  const cap = parseBudgetUsd(stated.budgetUsd)
  check(cap !== undefined && spent <= cap, 'actual dollars pass the cap')
  check(transcript.ref === stated.refCommit, 'transcript ref is not the tested commit')
  return { failures, calls, spent }
}

/**
 * Strict `--flag value` argv parsing: every entry is a wanted flag with a
 * non-flag value, each wanted flag exactly once. Throws on anything else, so
 * a mistyped invocation fails before any key or child is involved.
 */
export function parseFlagArgs(argv, wanted) {
  const flags = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const arg = argv[index]
    if (arg === '--' || typeof arg !== 'string' || !arg.startsWith('--')) {
      throw new RealUseInputError('arguments are --flag value pairs')
    }
    const value = argv[index + 1]
    if (typeof value !== 'string' || value.startsWith('--')) {
      throw new RealUseInputError(`flag ${arg} needs a value`)
    }
    flags.set(arg, value)
  }
  if (flags.size !== wanted.length || wanted.some((name) => !flags.has(name))) {
    throw new RealUseInputError(`arguments are exactly ${wanted.join(' ')}`)
  }
  return Object.fromEntries(
    wanted.map((name) => [
      name.slice(2).replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      flags.get(name),
    ]),
  )
}

/** One step's result file, confined to the run folder; null on any failure. */
function readStepResult(base, entry, label) {
  try {
    const resultPath = resolveWithin(base, String(entry?.resultFile ?? ''), `${label} result`)
    return JSON.parse(readFileSync(resultPath, 'utf8'))
  } catch {
    return null
  }
}

/** No fired startup trap: a marker file means a child sourced the hook. */
export function checkTraps(trapsDir) {
  const names = readdirSync(trapsDir).filter((name) => name.startsWith('fired-'))
  return names.map((name) => `startup trap fired: ${name}`)
}

/**
 * No key-shaped string and no sentinel in any published file; names only.
 * The shapes are the two Meta Model API key shapes as src/shared/redact.ts
 * matches them: unanchored, so a key inside JSON or prose is caught, not
 * only a file that is exactly the key.
 */
const KEY_SHAPE = /LLM_[\w-]{16,}|LLM\|\d+\|[\w+./=-]+/
export function checkNoLeak(files, base, label, sentinel) {
  const failures = []
  for (const file of files) {
    const text = readFileSync(file, 'latin1')
    const name = path.relative(base, file)
    if (KEY_SHAPE.test(text)) failures.push(`${label}/${name} holds a key-shaped string`)
    if (sentinel !== '' && text.includes(sentinel))
      failures.push(`${label}/${name} holds the sentinel`)
  }
  return failures
}
