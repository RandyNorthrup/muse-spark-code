#!/usr/bin/env node
// AGENTS.md rule 2 at its two doors: "Hosted CI is the gate for a release:
// every job green on the commit that merges, and a red job is read and its
// cause measured, never rerun into green." Until 2026-10-12 nothing
// mechanical held that: GitHub shows a job's latest attempt, and a tag
// published without a look at the other runs on its commit (0.18.2,
// docs/certification/release-0182.md).
//
//   node scripts/rule2-gate.mjs run
//     build.yml's `first-attempt` job, which every other job feeds and the
//     required aggregate needs. Refuses any attempt after the first, whatever
//     the earlier attempt's cause (a runner fault is answered by a new
//     commit, never by starting a job again), and refuses unless every other
//     workflow run on the same head is complete and green on its first
//     attempt. A run still in progress is waited for, and the head is read
//     once more immediately before passing, so a run started after the
//     judged set was read refuses instead of slipping through. One thing is
//     not an attempt: a first-time contributor's run waits for a maintainer's
//     approval as attempt 1 ("action_required", no job) and executes as
//     attempt 2.
//
//   node scripts/rule2-gate.mjs release [--sha <commit>]
//     release.yml's first job. Every workflow run on the tagged commit and on
//     the head of the pull request that merged as it must be complete and
//     green on its first attempt; one still in progress is waited for; a red
//     one stops the release before anything is built or published.
//
// It reads GitHub's API with the job's own token (actions: read, and
// pull-requests: read for the release) and has no dependency, so neither job
// installs anything. Every refusal names the run, its attempt, the job and
// the step that decided it. Proof that both doors fire:
// docs/certification/rule2-gate.md.
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import {
  assertReleaseAttempt,
  duplicateExecutions,
  GateError,
  isRecord,
  isSuccessfulRun,
  missingEvidence,
  pullOf,
  releaseRecheck,
  runOf,
  workflowPath,
} from './lib/rule2Gate.mjs'

const { AbortSignal } = globalThis
const API = process.env['GITHUB_API_URL'] ?? 'https://api.github.com'
const REPOSITORY = process.env['GITHUB_REPOSITORY'] ?? ''
const TOKEN = process.env['GH_TOKEN'] ?? ''
const PAGE_SIZE = 100
const MAX_PAGES = 10
const REQUEST_TIMEOUT_MS = 30_000
const POLL_MS = 60_000
// How long runs still in progress are waited for before the gate refuses.
// Measured 2026-10-12: Hosts takes 4 to 8 minutes after a push to main and 10
// to 25 on a pull request; CI takes 35 to 45.
const WAIT_MS = Number(process.env['RULE2_WAIT_MINUTES'] ?? 60) * 60_000
const GREEN = 'success'
const RULE = 'nothing is started again on the same commit (AGENTS.md rule 2)'
// The runs that count are those of this repository's own workflow files.
// GitHub's own runs on a commit (Dependabot's updates, path `dynamic/...`)
// say nothing about the tree.
const OWN_WORKFLOWS = '.github/workflows/'
// How many jobs that were not green a refusal names before it counts the rest.
const MAX_NAMED_JOBS = 8

/**
 * The decoded answer of one endpoint. Every caller validates what it reads
 * (`runOf`, `pullOf`, the list shape in `list`) and throws instead of passing
 * on a shape it cannot read: this job installs nothing, so the check is
 * written out rather than read through zod.
 */
async function get(endpoint) {
  const reply = await fetch(`${API}${endpoint}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(TOKEN !== '' && { Authorization: `Bearer ${TOKEN}` }),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!reply.ok)
    throw new GateError(
      `GitHub answered ${String(reply.status)} for ${endpoint}: the gate cannot read it, so it does not pass`,
    )
  return reply.json()
}

/** Every page of a list answer: the array itself, or the array under `key`. */
async function list(endpoint, key) {
  const items = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const separator = endpoint.includes('?') ? '&' : '?'
    const body = await get(
      `${endpoint}${separator}per_page=${String(PAGE_SIZE)}&page=${String(page)}`,
    )
    const batch = key !== undefined && isRecord(body) ? body[key] : body
    if (!Array.isArray(batch)) throw new GateError(`unexpected answer for ${endpoint}`)
    items.push(...batch)
    if (batch.length < PAGE_SIZE) return items
  }
  throw new GateError(`${endpoint} has more than ${String(PAGE_SIZE * MAX_PAGES)} entries`)
}

/** Every job of an attempt that was not green, each with its first step that was not; empty when all were. */
async function redJobs(runId, attempt) {
  const jobs = await list(
    `/repos/${REPOSITORY}/actions/runs/${String(runId)}/attempts/${String(attempt)}/jobs`,
    'jobs',
  )
  const named = []
  for (const job of jobs) {
    if (!isRecord(job)) continue
    const conclusion = job['conclusion']
    if (conclusion === GREEN || conclusion === 'skipped') continue
    const steps = Array.isArray(job['steps']) ? job['steps'].filter((step) => isRecord(step)) : []
    const step = steps.find(
      (entry) => entry['conclusion'] !== GREEN && entry['conclusion'] !== 'skipped',
    )
    const where =
      step === undefined
        ? 'no step of it had started'
        : `step ${String(step['number'])} "${String(step['name'])}" (${String(step['conclusion'] ?? step['status'])})`
    named.push(
      `job "${String(job['name'])}" (${String(conclusion ?? job['status'])}, job ${String(job['id'])}), ${where}`,
    )
  }
  const rest = named.length - MAX_NAMED_JOBS
  return [
    ...named.slice(0, MAX_NAMED_JOBS),
    ...(rest > 0 ? [`and ${String(rest)} more`] : []),
  ].join('; ')
}

/** Whether an attempt only waited for a maintainer's approval: it ended "action_required" and ran no job. */
async function onlyWaitedForApproval(runId, attempt) {
  const base = `/repos/${REPOSITORY}/actions/runs/${String(runId)}/attempts/${String(attempt)}`
  const body = await get(base)
  if (!isRecord(body) || body['conclusion'] !== 'action_required') return false
  const jobs = await list(`${base}/jobs`, 'jobs')
  return jobs.length === 0
}

/**
 * Why a run on a later attempt was started again: the rule and what its
 * earliest executed attempt looked like. Undefined when every earlier attempt
 * only waited for approval, so that this attempt is the run's first execution.
 */
async function startedAgain(runId, attempt) {
  for (let earlier = 1; earlier < attempt; earlier += 1) {
    if (await onlyWaitedForApproval(runId, earlier)) continue
    const red = await redJobs(runId, earlier)
    const was =
      red === ''
        ? `every job of attempt ${String(earlier)} was green`
        : `not green in attempt ${String(earlier)}: ${red}`
    return `${RULE}; ${was}`
  }
}

/** `green`, `running`, or the sentence that refuses the run. */
async function verdictOf(run) {
  const label = `${run.name} run ${String(run.id)} (${run.event})`
  if (run.attempt > 1) {
    const again = await startedAgain(run.id, run.attempt)
    if (again !== undefined) return `${label} is on attempt ${String(run.attempt)}: ${again}.`
  }
  if (run.status !== 'completed') return 'running'
  if (isSuccessfulRun(run)) return 'green'
  const red = await redJobs(run.id, run.attempt)
  return `${label} ended ${run.conclusion} on its first execution (attempt ${String(run.attempt)}): ${red === '' ? 'no job of it says why' : red}.`
}

async function runsOn(sha) {
  const runs = await list(`/repos/${REPOSITORY}/actions/runs?head_sha=${sha}`, 'workflow_runs')
  return runs
    .map((run) => runOf(run))
    .filter((run) => run.headSha === sha && run.path.startsWith(OWN_WORKFLOWS))
}

/** Reads the runs `find` returns until none is in progress; the refusals of those that are not green. */
async function settle(find) {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const runs = await find()
    const refusals = duplicateExecutions(runs)
    const running = []
    for (const run of runs) {
      const verdict = await verdictOf(run)
      if (verdict === 'running') running.push(run)
      else if (verdict !== 'green') refusals.push(verdict)
      const result = run.conclusion === '' ? run.status : `${run.status} ${run.conclusion}`
      console.log(
        `  ${run.name} run ${String(run.id)} (${run.event}), attempt ${String(run.attempt)}, ${result}: ${verdict === 'green' || verdict === 'running' ? verdict : 'REFUSED'}`,
      )
    }
    // A red run decides at once; one in progress is waited for.
    if (refusals.length > 0 || running.length === 0) return { runs, refusals }
    if (Date.now() >= deadline)
      return {
        runs,
        refusals: running.map(
          (run) =>
            `${run.name} run ${String(run.id)} is still ${run.status} after ${String(WAIT_MS / 60_000)} minutes of waiting: no result to pass on.`,
        ),
      }
    console.log(`  ${String(running.length)} still in progress: reading again in a minute`)
    await delay(POLL_MS)
  }
}

function required(name) {
  const value = process.env[name] ?? ''
  if (value === '') throw new GateError(`${name} is not set`)
  return value
}

/** The workflow file of the run this process is part of. */
function ownWorkflowPath() {
  const reference = process.env['GITHUB_WORKFLOW_REF'] ?? ''
  return reference.startsWith(`${REPOSITORY}/`) ? workflowPath(reference, REPOSITORY) : ''
}

/** The merge door: this run's own attempt, then every other run on the same head. */
async function gateRun() {
  const runId = Number(required('GITHUB_RUN_ID'))
  const attempt = Number(required('GITHUB_RUN_ATTEMPT'))
  const head = required('RULE2_HEAD_SHA')
  const ownPath = ownWorkflowPath()
  console.log(`rule 2, merge: run ${String(runId)}, attempt ${String(attempt)}, head ${head}`)
  if (attempt !== 1) {
    const again = await startedAgain(runId, attempt)
    if (again !== undefined)
      throw new GateError(
        `This is attempt ${String(attempt)} of run ${String(runId)}: ${again}. A red job is read and its cause measured; a runner fault is answered the same way. Push a new commit that says what happened: its run decides.`,
      )
    console.log(
      "  every earlier attempt only waited for a maintainer's approval and ran no job: this is the run's first execution",
    )
  }
  const find = async () => {
    const runs = await runsOn(head)
    // Include our own execution even if GitHub's list has not exposed it yet.
    const duplicates = duplicateExecutions([{ id: runId, path: ownPath, headSha: head }, ...runs])
    if (duplicates.length > 0) throw new GateError(duplicates.join('\n'))
    return runs.filter((run) => run.id !== runId)
  }
  const { refusals } = await settle(find)
  if (refusals.length > 0) throw new GateError(refusals.join('\n'))
  // The wait above and the merge are minutes apart: a workflow started or
  // started again on this head after the judged set was read must not slip
  // through on the earlier read. Read the head once more, with no further
  // waiting: anything not complete and green now refuses, and the rerun is
  // answered by a new commit, like any other start after the first.
  const fresh = await find()
  const late = []
  for (const run of fresh) {
    const verdict = await verdictOf(run)
    const result = run.conclusion === '' ? run.status : `${run.status} ${run.conclusion}`
    console.log(
      `  recheck: ${run.name} run ${String(run.id)} (${run.event}), attempt ${String(run.attempt)}, ${result}: ${verdict === 'green' ? verdict : 'REFUSED'}`,
    )
    if (verdict === 'green') continue
    late.push(
      verdict === 'running'
        ? `${run.name} run ${String(run.id)} (${run.event}) started after the judged set was read and is still ${run.status}: ${RULE}. Push a new commit: its run decides.`
        : verdict,
    )
  }
  if (late.length > 0) throw new GateError(late.join('\n'))
  console.log(
    'rule 2, merge: first execution, and every other run on this head is green on its own first',
  )
}

/** The heads of the pull requests that merged as `sha`. */
async function mergedHeads(sha) {
  const pulls = await list(`/repos/${REPOSITORY}/commits/${sha}/pulls`)
  const checked = pulls.map((entry) => pullOf(entry))
  const heads = []
  for (const pull of checked) {
    if (pull.mergedAt === null || pull.mergeSha !== sha) continue
    if (pull.headSha === null)
      throw new GateError(
        `pull request ${String(pull.number)} merged as ${sha} but names no head: the gate cannot check it, so it does not pass`,
      )
    heads.push({ number: pull.number, sha: pull.headSha })
  }
  return heads
}

/** The release door: every run on the tagged commit and on the head of the pull request that merged as it. */
async function gateRelease(sha) {
  // A read-only local preflight has no run id; a hosted verify must be first.
  if (process.env['GITHUB_RUN_ID'] !== undefined)
    assertReleaseAttempt(required('GITHUB_RUN_ATTEMPT'))
  const ownId = Number(process.env['GITHUB_RUN_ID'] ?? 0)
  const ownPath = ownWorkflowPath()
  const heads = await mergedHeads(sha)
  console.log(
    `rule 2, release: commit ${sha}${heads.map((head) => `; pull request ${String(head.number)}, head ${head.sha}`).join('')}`,
  )
  const commits = [...new Set([sha, ...heads.map((head) => head.sha)])]
  const find = async () => {
    const found = []
    for (const commit of commits) found.push(...(await runsOn(commit)))
    // Not this workflow's own runs on the tag: this one is in progress by
    // definition, and a recovery (docs/RELEASING.md) publishes the packages
    // an earlier one built after it had passed this door.
    return found.filter((run) => run.id !== ownId && run.path !== ownPath)
  }
  const { runs, refusals } = await settle(find)
  const missing = missingEvidence(sha, heads, runs)
  if ([...missing, ...refusals].length > 0)
    throw new GateError([...missing, ...refusals].join('\n'))
  // As at the merge door, do not publish on the snapshot from the wait.
  // A late start, rerun or deletion must decide from a fresh read of every head.
  const fresh = await find()
  const late = releaseRecheck(sha, heads, fresh)
  for (const run of fresh) {
    const verdict = await verdictOf(run)
    if (verdict !== 'green' && verdict !== 'running') late.push(verdict)
  }
  if (late.length > 0) throw new GateError(late.join('\n'))
  console.log(
    `rule 2, release: ${String(fresh.length)} run(s), every one complete and green on its first execution`,
  )
}

const [mode, ...rest] = process.argv.slice(2)
try {
  if (REPOSITORY === '') throw new GateError('GITHUB_REPOSITORY is not set')
  if (mode === 'run' && rest.length === 0) await gateRun()
  else if (mode === 'release' && rest.length === 0) await gateRelease(required('GITHUB_SHA'))
  else if (mode === 'release' && rest.length === 2 && rest[0] === '--sha')
    await gateRelease(rest[1] ?? '')
  else throw new GateError('usage: rule2-gate.mjs run | release [--sha <commit>]')
} catch (error) {
  if (!(error instanceof GateError)) throw error
  for (const line of error.message.split('\n')) console.error(`::error::${line}`)
  process.exitCode = 1
}
