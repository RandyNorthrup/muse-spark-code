#!/usr/bin/env node
// The real-use launcher (lane REALUSECI): the run step's body execs this
// script directly, and it is the sanctioned initial holder of the Model API
// key for that step. It deletes the variable before any child starts and
// holds the key in memory only, sending it over private stdin solely to
// `exec --key-stdin` children of the installed candidate package (one per
// steps-file step, prompts by --prompt-file: a stdin prompt conflicts with
// --key-stdin). Every child runs with the Action's allow-list environment and
// a fresh private home, in one empty workspace, on the contributor model by
// its explicit name. Remaining calls ride as --max-requests and remaining
// dollars as --max-budget-usd, so the product's own ledger enforces the
// stated inputs; the launcher stops before a step that would pass either.
// Counts and dollars in the transcript come from each step's own validated
// result. Stdout/stderr never carry the key; the transcript carries prose,
// counts and dollars only.

import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { isExecResult, microUsd } from '../action/lib/result.mjs'
import { childEnvironment, redactLiterals } from '../action/lib/lifecycle.mjs'
import { maskCommand, takeModelApiKey } from '../action/lib/run-exec.mjs'
import {
  buildExecArgs,
  keepFinalMessage,
  microUsdToString,
  parseFlagArgs,
  parseStepsFile,
  REAL_USE_MODEL,
  REAL_USE_STEP_TIMEOUT_SECONDS,
  RealUseInputError,
  resolveStepsFile,
  verdictForStep,
} from './lib/real-use.mjs'

const RESULT_MAX_BYTES = 16_777_216
const STDERR_MAX_BYTES = 1_048_576
const KILL_AFTER_MS = 7000
const WANTED_FLAGS = [
  '--ref-root',
  '--steps-file',
  '--expected-calls',
  '--max-budget-usd',
  '--agent-js',
  '--work-dir',
  '--out-dir',
  '--ref-commit',
  '--package-sha256',
]

function usageError(message) {
  process.stderr.write(`real-use-run: ${message}\n`)
  process.exitCode = 2
}

function readOptions(argv) {
  try {
    return parseFlagArgs(argv, WANTED_FLAGS)
  } catch (error) {
    usageError(error instanceof RealUseInputError ? error.message : 'arguments unreadable')
    usageError(
      'real-use-run --ref-root <dir> --steps-file <path> --expected-calls <n> --max-budget-usd <usd> --agent-js <file> --work-dir <dir> --out-dir <dir> --ref-commit <sha> --package-sha256 <hex>',
    )
    return null
  }
}

/** The product's stdout as a result object; null when it is not JSON. */
function parseResult(stdout) {
  try {
    return JSON.parse(Buffer.from(stdout).toString('utf8'))
  } catch {
    return null
  }
}

function runChild({ node, args, cwd, env, stdin, stdoutMaxBytes, withinMs }) {
  return new Promise((resolve) => {
    const child = spawn(node, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let outcome = 'exited'
    const timer = setTimeout(() => {
      outcome = 'timeout'
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already gone; the close handler settles the outcome.
        }
      }, KILL_AFTER_MS).unref()
    }, withinMs)
    timer.unref()
    const forward = (signal) => child.kill(signal)
    process.once('SIGINT', () => forward('SIGINT'))
    process.once('SIGTERM', () => forward('SIGTERM'))
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes <= stdoutMaxBytes) stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes <= STDERR_MAX_BYTES) stderr.push(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        code: null,
        signal: null,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        spawnError: String(error?.message ?? error),
      })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        timedOut: outcome === 'timeout',
      })
    })
    child.stdin.on('error', () => {
      // A child that exits before reading its stdin; its exit reports it.
    })
    child.stdin.write(stdin)
    child.stdin.end()
  })
}

async function main() {
  const options = readOptions(process.argv.slice(2))
  if (options === null) return
  const expectedCalls = Number(options.expectedCalls)
  if (!Number.isSafeInteger(expectedCalls) || expectedCalls < 1 || expectedCalls > 500) {
    usageError('expected-calls is an integer 1 to 500')
    return
  }
  const cap = microUsd(options.maxBudgetUsd)
  if (cap === undefined || cap <= 0n || cap > microUsd('20')) {
    usageError('max-budget-usd is unsigned decimal over 0 through 20')
    return
  }
  let steps
  try {
    const stepsPath = resolveStepsFile(options.refRoot, options.stepsFile)
    steps = parseStepsFile(readFileSync(stepsPath, 'utf8'))
  } catch (error) {
    usageError(error instanceof RealUseInputError ? error.message : 'steps file unreadable')
    return
  }
  const held = { key: takeModelApiKey(process.env) }
  if (held.key === undefined) {
    process.stderr.write('::error::model-api-key is missing or not a Meta Model API key\n')
    process.exitCode = 1
    return
  }
  const key = held.key
  process.stdout.write(maskCommand(key))
  const scrub = (text) => redactLiterals(text, [key])
  const report = {
    version: 1,
    ref: options.refCommit,
    packageSha256: options.packageSha256,
    model: REAL_USE_MODEL,
    stated: { calls: expectedCalls, budgetUsd: options.maxBudgetUsd },
    actual: { calls: 0, costUsd: '0' },
    steps: [],
  }
  let calls = 0
  let spent = 0n
  let exitCode = 0
  try {
    const home = path.join(options.workDir, 'home')
    const workspace = path.join(options.workDir, 'workspace')
    mkdirSync(home, { recursive: true })
    mkdirSync(workspace, { recursive: true })
    mkdirSync(options.outDir, { recursive: true })
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Real use\n\n- ref ${options.refCommit} | package ${options.packageSha256}\n- model ${REAL_USE_MODEL} | stated ${String(expectedCalls)} calls, $${options.maxBudgetUsd}\n\n`,
      )
    }
    const baseEnv = childEnvironment({
      platform: process.platform,
      parentEnv: process.env,
      paths: { home, tmp: path.join(options.workDir, 'tmp') },
      nodePath: process.execPath,
      network: {},
    })
    mkdirSync(baseEnv.TMPDIR, { recursive: true })
    for (let position = 0; position < steps.length; position += 1) {
      const step = steps[position]
      const remainingCalls = expectedCalls - calls
      const remainingBudget = cap - spent
      if (remainingCalls <= 0 || remainingBudget <= 0n) {
        report.steps.push({
          id: step.id,
          verdict: 'SKIPPED',
          reason: 'the stated count or cap would be passed',
        })
        continue
      }
      const stepCap =
        step.maxBudgetUsd === undefined
          ? remainingBudget
          : (microUsd(step.maxBudgetUsd) ?? remainingBudget)
      const budget = microUsdToString(Math.min(stepCap, remainingBudget))
      const stepDir = path.join(options.outDir, step.id)
      mkdirSync(stepDir, { recursive: true })
      const promptFile = path.join(stepDir, 'prompt.txt')
      writeFileSync(promptFile, step.prompt)
      const outcome = await runChild({
        node: process.execPath,
        args: buildExecArgs({
          agentJs: options.agentJs,
          workspace,
          mode: step.mode,
          promptFile,
          budgetUsd: budget,
          maxRequests: remainingCalls,
          timeoutSeconds: REAL_USE_STEP_TIMEOUT_SECONDS,
        }),
        cwd: options.workDir,
        env: baseEnv,
        stdin: Buffer.from(`${key}\n`, 'utf8'),
        stdoutMaxBytes: RESULT_MAX_BYTES,
        withinMs: REAL_USE_STEP_TIMEOUT_SECONDS * 1000,
      })
      const result = parseResult(outcome.stdout)
      const code = outcome.timedOut ? 6 : (outcome.code ?? 1)
      const valid = isExecResult(result) && result.exitCode === code
      const entry = {
        id: step.id,
        mode: step.mode,
        verdict: 'FAIL',
        reason: '',
        status: null,
        exitCode: code,
        requests: 0,
        costUsd: '0',
        resultFile: `${step.id}/result.json`,
        expect: step.expect,
        expectStatus: step.expectStatus,
        finalMessage: '',
        finalMessageTruncated: false,
      }
      if (valid) {
        const kept = keepFinalMessage(result.finalMessage)
        const verdict = verdictForStep(step, result, code)
        entry.verdict = verdict.verdict
        entry.reason = verdict.reason
        entry.status = result.status
        entry.requests = result.usage.requests ?? 0
        entry.costUsd = result.usage.costUsd.total
        entry.finalMessage = kept.text
        entry.finalMessageTruncated = kept.truncated
        writeFileSync(path.join(stepDir, 'result.json'), `${JSON.stringify(result)}\n`)
        calls += entry.requests
        spent += microUsd(entry.costUsd) ?? 0n
      } else if (outcome.spawnError !== undefined) {
        entry.reason = 'the product did not start'
      } else if (outcome.timedOut) {
        entry.reason = 'the product passed its deadline'
      } else {
        entry.reason = 'no valid result at the product exit code'
      }
      writeFileSync(
        path.join(stepDir, 'stderr.txt'),
        scrub(Buffer.from(outcome.stderr).toString('utf8')),
      )
      report.steps.push(entry)
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(
          process.env.GITHUB_STEP_SUMMARY,
          `- ${step.id}: ${entry.verdict} (status ${String(entry.status ?? 'none')}, exit ${String(code)}, ${String(entry.requests)} requests, $${entry.costUsd})${entry.reason === '' ? '' : ` — ${entry.reason}`}\n`,
        )
      }
      if (entry.verdict !== 'PASS') {
        exitCode = 1
        const unrun = steps.slice(position + 1)
        for (const rest of unrun) {
          report.steps.push({
            id: rest.id,
            verdict: 'SKIPPED',
            reason: 'an earlier step did not pass',
          })
        }
        break
      }
    }
    report.actual = { calls, costUsd: microUsdToString(spent) }
    writeFileSync(
      path.join(options.outDir, 'transcript.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
  } finally {
    held.key = undefined
  }
  process.exitCode = exitCode
}

await main()
