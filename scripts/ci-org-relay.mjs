#!/usr/bin/env node
// The CI capacity relay (D122), run by the maintainer while the repository
// variable ORG_CI is `on`. For every open same-repository pull request whose
// home run left the Windows and macOS unit shards to the capacity repository
// (its `route` job printed "This run's part: home"), it pushes the pull
// request's merge commit there as ci/head-<head sha>, marks the required
// status `build / org part` pending, and once that run has concluded posts its
// conclusion with a link to the run. It uses the maintainer's own `gh` sign-in
// and changes nothing else.
// Usage: node scripts/ci-org-relay.mjs [--once] [--work <bare repository folder>]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const HOME_REPO = 'RandyNorthrup/muse-spark-code'
const CAPACITY_REPO = 'scnetsolutions/muse-spark-code-ci'
const CONTEXT = 'build / org part'
const HOME_PART_LINE = "This run's part: home"
const POLL_MS = 60_000
const OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024

const arguments_ = process.argv.slice(2)
const isOnce = arguments_.includes('--once')
const workIndex = arguments_.indexOf('--work')
const work = path.resolve(
  workIndex === -1 ? path.join(process.cwd(), '.ci-org-relay.git') : arguments_[workIndex + 1],
)

function run(command, commandArguments) {
  return execFileSync(command, commandArguments, {
    encoding: 'utf8',
    maxBuffer: OUTPUT_LIMIT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}
const api = (route, ...fields) => run('gh', ['api', route, ...fields])
const json = (route) => JSON.parse(api(route))
const git = (...commandArguments) => run('git', ['--git-dir', work, ...commandArguments])
const log = (message) => {
  process.stdout.write(`${new Date().toISOString()} ${message}\n`)
}

function prepare() {
  if (existsSync(work)) return
  mkdirSync(work, { recursive: true })
  run('git', ['init', '--quiet', '--bare', work])
  git('remote', 'add', 'home', `https://github.com/${HOME_REPO}.git`)
  git('remote', 'add', 'capacity', `https://github.com/${CAPACITY_REPO}.git`)
}

/** Whether the latest CI run on this head left the shards to the capacity repository. */
function isHomePart(head) {
  const { workflow_runs: runs } = json(
    `repos/${HOME_REPO}/actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=1`,
  )
  const latest = runs[0]
  if (latest === undefined) return false
  const { jobs } = json(`repos/${HOME_REPO}/actions/runs/${latest.id}/jobs?per_page=100`)
  const route = jobs.find((job) => job.name === 'route')
  return (
    route?.conclusion === 'success' &&
    api(`repos/${HOME_REPO}/actions/jobs/${route.id}/logs`).includes(HOME_PART_LINE)
  )
}

/** The latest state of the org part on this head, or undefined when none was posted. */
function orgPartState(head) {
  const { statuses } = json(`repos/${HOME_REPO}/commits/${head}/status`)
  return statuses.find((status) => status.context === CONTEXT)?.state
}

function post(head, state, targetUrl, description) {
  api(
    `repos/${HOME_REPO}/statuses/${head}`,
    '--method',
    'POST',
    '-f',
    `state=${state}`,
    '-f',
    `context=${CONTEXT}`,
    '-f',
    `target_url=${targetUrl}`,
    '-f',
    `description=${description}`,
  )
}

function dispatch(pull) {
  const head = pull.head.sha
  const branch = `ci/head-${head}`
  git(
    'fetch',
    '--quiet',
    '--no-tags',
    'home',
    `+refs/pull/${pull.number}/merge:refs/relay/pr-${pull.number}`,
  )
  const merge = git('rev-parse', `refs/relay/pr-${pull.number}`).trim()
  // mirror/main carries the base, so each push sends only the new objects.
  git(
    'push',
    '--quiet',
    'capacity',
    `+${pull.base.sha}:refs/heads/mirror/main`,
    `+${merge}:refs/heads/${branch}`,
  )
  post(
    head,
    'pending',
    `https://github.com/${CAPACITY_REPO}/actions?query=branch%3A${encodeURIComponent(branch)}`,
    'Windows and macOS unit shards queued in the capacity repository',
  )
  log(`#${pull.number} ${head.slice(0, 9)}: sent merge ${merge.slice(0, 9)} as ${branch}`)
}

function report(pull) {
  const head = pull.head.sha
  const branch = `ci/head-${head}`
  const { workflow_runs: runs } = json(
    `repos/${CAPACITY_REPO}/actions/runs?branch=${encodeURIComponent(branch)}&event=push&per_page=1`,
  )
  const latest = runs[0]
  if (latest?.status !== 'completed') return
  const state = latest.conclusion === 'success' ? 'success' : 'failure'
  post(head, state, latest.html_url, `Windows and macOS unit shards: ${String(latest.conclusion)}`)
  api(`repos/${CAPACITY_REPO}/git/refs/heads/${branch}`, '--method', 'DELETE')
  log(`#${pull.number} ${head.slice(0, 9)}: ${CONTEXT} = ${state} (${latest.html_url})`)
}

function pass() {
  const pulls = json(`repos/${HOME_REPO}/pulls?state=open&per_page=100`).filter(
    (pull) => pull.head.repo?.full_name === HOME_REPO,
  )
  for (const pull of pulls) {
    try {
      const state = orgPartState(pull.head.sha)
      if (state === 'pending') report(pull)
      else if (state === undefined && isHomePart(pull.head.sha)) dispatch(pull)
    } catch (error) {
      log(`#${pull.number}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

prepare()
for (;;) {
  try {
    pass()
  } catch (error) {
    // GitHub unreachable or the sign-in expired: said every pass, never swallowed.
    log(`pass failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (isOnce) break
  await sleep(POLL_MS)
}
