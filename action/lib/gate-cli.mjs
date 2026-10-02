// Step 3 of the Action (M80, SPEC §6.6): read the captured event, ask the
// API for the pull request, and decide. Only the GitHub token is here; a
// refusal exits 1, so installation, checkout, the run and the post never
// start. The allowed decision's task and metadata are written privately.

import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { decide, eventPrNumber } from './gate.mjs'
import {
  ACTION_EVENT_MAX_BYTES,
  ACTION_GATE_MS,
  createLauncherOwner,
  isEntry,
} from './lifecycle.mjs'
import {
  actionPaths,
  githubJson,
  httpsBase,
  InputError,
  invocationFromEnv,
  readActionInputs,
  writeOutputs,
} from './tools.mjs'

const PRIVATE_FILE = 0o600

/** The event payload, bounded, as parsed JSON. */
export async function readEvent(file, signal) {
  const bytes = await readFile(file, { signal })
  if (bytes.length > ACTION_EVENT_MAX_BYTES) throw new InputError('the event file is too large')
  return JSON.parse(bytes.toString('utf8'))
}

/**
 * The gate under its own bounded owner: one API read of the pull request the
 * event names, then the pure decision. Returns the decision; writes the
 * allowed decision's private task file and every output.
 */
export async function runGate({ env, fetch, owner }) {
  const paths = actionPaths(invocationFromEnv(env), '')
  const inputs = await readActionInputs(paths)
  const repository = env.GITHUB_REPOSITORY ?? ''
  const apiUrl = httpsBase(env.GITHUB_API_URL, 'https://api.github.com', 'GITHUB_API_URL')
  const eventName = env.GITHUB_EVENT_NAME ?? ''
  const token = env.MUSE_GITHUB_TOKEN ?? ''
  return await owner.phase('gate', ACTION_GATE_MS, async (signal) => {
    const event = await readEvent(env.GITHUB_EVENT_PATH ?? '', signal)
    const number = eventPrNumber(eventName, event, inputs.prNumber)
    const pr =
      number === null || eventName === 'pull_request_target'
        ? undefined
        : await githubJson({
            fetch,
            url: `${apiUrl}/repos/${repository}/pulls/${String(number)}`,
            token,
            signal,
            maxBytes: ACTION_EVENT_MAX_BYTES,
          })
    const decision = decide({
      eventName,
      event,
      pr,
      repository,
      isPublic: event?.repository?.private !== true,
      runnerEnvironment: env.RUNNER_ENVIRONMENT ?? '',
      mode: inputs.mode,
      imageGeneration: inputs.imageGeneration,
      triggerPhrase: inputs.triggerPhrase,
      dispatchPrNumber: inputs.prNumber,
    })
    if (!decision.allowed) {
      await writeOutputs(env.GITHUB_OUTPUT, { allowed: 'false' })
      return decision
    }
    await writeFile(
      paths.gate,
      JSON.stringify({
        prNumber: decision.prNumber,
        headSha: decision.headSha,
        baseSha: decision.baseSha,
        headRef: decision.headRef,
        task: decision.task,
        title: decision.title,
        body: decision.body,
      }),
      { flag: 'wx', mode: PRIVATE_FILE },
    )
    await writeOutputs(env.GITHUB_OUTPUT, {
      allowed: 'true',
      'pr-number': decision.prNumber,
      'head-sha': decision.headSha,
      'base-sha': decision.baseSha,
      'head-ref': decision.headRef,
      'task-file': paths.gate,
    })
    return decision
  })
}

async function main() {
  let token = process.env.MUSE_GITHUB_TOKEN
  const owner = createLauncherOwner({
    paths: {},
    dropSecrets: () => {
      token = undefined
    },
    totalMs: ACTION_GATE_MS,
  })
  try {
    const decision = await runGate({
      env: { ...process.env, MUSE_GITHUB_TOKEN: token },
      fetch,
      owner,
    })
    if (decision.allowed) {
      if (decision.warning !== null) process.stdout.write(`::warning::${decision.warning}\n`)
      process.stdout.write(`The gate allowed pull request #${String(decision.prNumber)}.\n`)
    } else {
      process.stderr.write(`::error::The gate refused this run: ${decision.reason}\n`)
      process.exitCode = 1
    }
  } catch (error) {
    const message = error instanceof InputError ? error.message : 'the gate could not decide'
    process.stderr.write(`::error::${message}\n`)
    process.exitCode = 1
  } finally {
    await owner.cleanup()
  }
}

if (isEntry(import.meta.url)) await main()
