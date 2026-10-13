#!/usr/bin/env node
// The real-life run: the packed product, installed into a new empty folder
// with a new empty home, used the way a person and an editor use it, against
// real providers on their cheapest models. It is the product's test and the
// gate for a release (docs/testing/real-life.md).
//
//   node scripts/real-life/run.mjs --artefact <agent tarball> --routes anthropic,openai \
//     --max-requests 40 --max-usd 0.50 --record temp/real-life/record
//
// Nothing of the product is imported, replaced or faked: the run starts the
// installed command and reads what it prints, what it writes and how it
// ends. It prints what it may spend before the first request, stops at
// either cap, and prints what it spent afterwards, by the product's own
// count.
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { clearTimeout, setTimeout } from 'node:timers'
import { pathToFileURL } from 'node:url'
import { USAGE, matchesAny, parseArguments } from './lib/args.mjs'
import { allowance, microUsd, usdText } from './lib/budget.mjs'
import { newRunFolders, productEnvironment } from './lib/home.mjs'
import { installArtefact, sha256Of } from './lib/install.mjs'
import { keySource, readKey } from './lib/keys.mjs'
import {
  CELL_TIMEOUT_MS,
  DEFAULT_ORDER,
  EXEC_ADMIT_USD,
  EXIT_FAILED,
  EXIT_USAGE,
  FIRST_TURN,
} from './lib/limits.mjs'
import { personFor } from './lib/person.mjs'
import { runCommand } from './lib/product.mjs'
import {
  clip,
  logExcerpt,
  observedText,
  scrubber,
  tableRoute,
  totalsOf,
  writeRecord,
} from './lib/record.mjs'
import { ROUTES, routeFor } from './lib/routes.mjs'

const parsed = parseArguments(process.argv.slice(2))
if (!parsed.ok) {
  if (parsed.reason !== '') console.error(parsed.reason)
  console.error(USAGE)
  process.exit(EXIT_USAGE)
}
const { options } = parsed

const SCENARIO_FOLDER = path.join(import.meta.dirname, 'scenarios')

async function loadScenarios(pattern) {
  const names = readdirSync(SCENARIO_FOLDER)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => name.slice(0, -'.mjs'.length))
    .filter((name) => matchesAny(pattern, name))
  const loaded = []
  for (const name of names) {
    const module = await import(pathToFileURL(path.join(SCENARIO_FOLDER, `${name}.mjs`)).href)
    loaded.push({ id: name, order: DEFAULT_ORDER, ...module.default })
  }
  // A scenario may say when it runs (the plain turn first: a route that
  // cannot answer at all is not asked for anything dearer); names decide the rest.
  return loaded.toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id, 'en'))
}

const scenarios = await loadScenarios(options.scenarios)
if (options.isList) {
  console.log('Routes:')
  for (const [id, route] of Object.entries(ROUTES)) {
    console.log(`  ${id}: ${route.wire}, ${route.model}${route.note ? ` (${route.note})` : ''}`)
  }
  console.log('Scenarios:')
  for (const scenario of scenarios) {
    const surfaces = ['exec', 'acp'].filter((surface) => scenario[surface] !== undefined)
    const claimed = surfaces.flatMap((surface) => scenario[surface].claims)
    console.log(
      `  ${scenario.id}: ${scenario.title} [${surfaces.join(', ')}] ${claimed.join(', ')}`,
    )
  }
  process.exit(0)
}

const routes = []
for (const id of options.routes) {
  const route = routeFor(id, options.models)
  if (route === undefined) {
    console.error(`not a route: ${id} (--list prints them)`)
    process.exit(EXIT_USAGE)
  }
  routes.push(route)
}
const keys = keySource(options.keys)
if (keys.kind === 'invalid') {
  console.error(keys.reason)
  process.exit(EXIT_USAGE)
}

/** Every cell of the plan: one scenario on one route by one surface. */
const plan = []
for (const route of routes) {
  for (const scenario of scenarios) {
    // A route with a note (an account with no credit) is for the scenarios
    // that ask for it, and for no other.
    const isWanted = scenario.only === undefined ? route.note === undefined : scenario.only(route)
    if (!isWanted) continue
    for (const surface of options.surfaces) {
      const steps = scenario[surface]
      if (steps !== undefined) plan.push({ scenario, route, surface, steps })
    }
  }
}
const mostRequests = plan.reduce((sum, cell) => sum + cell.steps.requests, 0)
const budget = allowance(options.maxRequests, options.maxUsd)
console.log(
  `Real-life run: ${String(plan.length)} scenario runs on ${String(routes.length)} route(s) (${routes.map((route) => `${route.id}: ${route.model}`).join('; ')}).`,
)
console.log(
  `It may make up to ${String(Math.min(mostRequests, options.maxRequests))} model requests (the plan's most: ${String(mostRequests)}; the cap: ${String(options.maxRequests)}) and stops at $${usdText(budget.cap.micro)}.`,
)

const started = new Date()
const folders = newRunFolders(options.work)
const secrets = new Map([
  [folders.root, '<run>'],
  [os.homedir(), '<home>'],
  [os.userInfo().username, '<user>'],
  [os.hostname(), '<machine>'],
])
const scrub = () => scrubber(secrets)
const artefact = {
  name: path.basename(options.artefact),
  sha256: sha256Of(options.artefact),
  package: '',
  version: '',
}
const cells = []
const routeStates = []
const configured = []
const stores = { isMetaStored: false }
let product

/** A terminal command outside any scenario (set-up, usage, clean-up). */
const terminal = (args, stdin = '') => runCommand(product, args, { cwd: folders.workspaces, stdin })

/** The product's own usage records for this home. */
async function usageRecords() {
  const run = await terminal(['usage', '--json'])
  try {
    return JSON.parse(run.stdout).records ?? []
  } catch {
    return []
  }
}

const said = (run) => clip(`${run.stdout} ${run.stderr}`)

/**
 * Meta's key. A terminal command takes it on standard input and stores
 * nothing. An editor session reads it from the credential store only, and
 * that entry is the person's own: the run stores its key there only when
 * no key is stored, and removes it afterwards. While another key is there
 * (the person's, or another run's) the editor scenarios are not run.
 */
async function setUpMeta(key) {
  const onPipe = 'the key goes to each terminal command on standard input'
  if (!options.surfaces.includes('acp')) return { ok: true, key, state: onPipe }
  const status = await terminal(['auth', 'status'])
  if (status.code === 0) {
    const held = 'a Meta key is already in the credential store, and the run does not replace it'
    return { ok: true, key, noEditor: held, state: `${onPipe}; ${held}` }
  }
  const stored = await terminal(['auth', 'set'], `${key}\n`)
  if (stored.code !== 0) {
    const refused = `auth set did not store the key: ${said(stored)}`
    return { ok: true, key, noEditor: refused, state: `${onPipe}; ${refused}` }
  }
  stores.isMetaStored = true
  return {
    ok: true,
    key,
    state: `${onPipe}; stored with auth set for the editor sessions, removed afterwards`,
  }
}

/**
 * Adds a provider under the run's own name with its key on standard input,
 * and checks the key: what a person does first, so it is a scenario of its
 * own in the record (`seen`), with the product's own words.
 */
async function setUp(route) {
  if (route.kind === 'museCode')
    return { ok: true, state: 'uses the Muse Code sign-in of this machine' }
  const read = readKey(keys, route.stored)
  if (read.key === undefined) return { ok: false, state: `not run: ${read.reason}` }
  secrets.set(read.key, '<key>')
  if (route.kind === 'meta') return await setUpMeta(read.key)
  // A name left by a run that was cut short: the run's own, so it removes it.
  const before = await terminal(['auth', 'status', '--provider', route.provider])
  if (before.code === 0) await terminal(['providers', 'remove', route.provider])
  const clock = performance.now()
  const added = await terminal(
    [
      'providers',
      'add',
      '--preset',
      route.preset,
      '--as',
      route.provider,
      '--model',
      route.model,
      '--key-stdin',
    ],
    `${read.key}\n`,
  )
  const seen = [
    {
      what: 'providers add takes the key and ends with exit code 0',
      ok: added.code === 0,
      saw: said(added),
    },
  ]
  if (added.code === 0) {
    configured.push(route)
    const tested = await terminal(['providers', 'test', route.provider])
    seen.push({
      what: 'providers test says the key works',
      ok: tested.code === 0,
      saw: said(tested),
    })
  }
  const isAdded = seen.every((one) => one.ok)
  return {
    ok: isAdded,
    key: read.key,
    seen,
    seconds: (performance.now() - clock) / 1000,
    state: isAdded
      ? `added as ${route.provider}; ${seen.at(-1).saw}`
      : `could not be added: ${seen.at(-1).saw}`,
  }
}

/** The set-up of a route as a line of the record. */
const setUpCell = (route, state) => ({
  scenario: 'add-provider',
  title: 'A provider is added with its key, and the key is checked',
  route,
  surface: 'exec',
  claims: [
    'ref/cli/providersAdd/providers-add---preset-preset---as-id---address-url---model-model---privacy-policy---private-ok---key-stdin',
    'ref/cli/providersTest/providers-test-id',
    'ref/feature/providers',
  ],
  outcome: state.ok ? 'passed' : 'failed',
  observed: state.seen,
  requests: 0,
  usd: usdText(0),
  recordedByProduct: { requests: 0, usd: usdText(0) },
  seconds: state.seconds,
})

/** Removes what the run added, through the product's own command, and checks it is gone. */
async function cleanUp() {
  const left = []
  for (const route of configured) {
    await terminal(['providers', 'remove', route.provider])
    const after = await terminal(['auth', 'status', '--provider', route.provider])
    if (after.code === 0) left.push(route.provider)
  }
  if (stores.isMetaStored) {
    await terminal(['auth', 'clear'])
    const after = await terminal(['auth', 'status'])
    if (after.code === 0) left.push('the Meta Model API key')
  }
  return left
}

async function runCell(cell, key) {
  const { scenario, route, surface, steps } = cell
  const workspace = path.join(
    folders.workspaces,
    `${String(cells.length + 1)}-${scenario.id}-${surface}`,
  )
  mkdirSync(workspace)
  const person = personFor({ product, route, workspace, admitUsd: EXEC_ADMIT_USD, key })
  const observed = []
  const see = (what, ok, saw) => {
    observed.push({ what, ok: ok === true, saw: clip(saw) })
  }
  const earlier = await usageRecords()
  const before = new Set(earlier.map((record) => record.id))
  const clock = performance.now()
  let timer
  try {
    await Promise.race([
      steps.run(person, see),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`not finished in ${String(CELL_TIMEOUT_MS / 1000)} s`))
        }, CELL_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    see(
      'the scenario ran to its end',
      false,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    clearTimeout(timer)
    await person.end()
  }
  const seconds = (performance.now() - clock) / 1000
  const later = await usageRecords()
  const recorded = later.filter((record) => !before.has(record.id))
  const journal = {
    requests: recorded.length,
    micro: recorded.reduce((sum, record) => sum + (microUsd(record.cost?.usd ?? '0') || 0), 0),
  }
  // A terminal run is counted by its own result; an editor session by the
  // usage the product recorded for it.
  const used = surface === 'exec' ? person.made : journal
  budget.spend(used.requests, used.micro)
  see(
    'it made no more requests than it said it may',
    used.requests <= steps.requests,
    `${String(used.requests)} of at most ${String(steps.requests)}`,
  )
  const isPassed = observed.length > 0 && observed.every((seen) => seen.ok)
  return {
    scenario: scenario.id,
    title: scenario.title,
    route,
    surface,
    claims: steps.claims,
    outcome: isPassed ? 'passed' : 'failed',
    observed,
    requests: used.requests,
    usd: usdText(used.micro),
    recordedByProduct: { requests: journal.requests, usd: usdText(journal.micro) },
    seconds,
    ...(!isPassed && { log: logExcerpt(person.logText()) }),
  }
}

const notRun = (cell, reason) => ({
  scenario: cell.scenario.id,
  title: cell.scenario.title,
  route: cell.route,
  surface: cell.surface,
  claims: cell.steps.claims,
  outcome: 'notRun',
  observed: [],
  reason: `not run: ${reason}`,
  requests: 0,
  usd: usdText(0),
  recordedByProduct: { requests: 0, usd: usdText(0) },
  seconds: 0,
})

let left = []
let productUsage = { requests: 0, usd: usdText(0) }
try {
  const installed = installArtefact(options.artefact, folders.install)
  if (!installed.ok) throw new Error(installed.reason)
  artefact.package = installed.name
  artefact.version = installed.version
  product = { agent: installed.agent, env: productEnvironment(folders.home) }
  console.log(`Installed ${installed.name} ${installed.version} (SHA-256 ${artefact.sha256}).`)
  const say = (done) => {
    const word = { passed: 'PASS', failed: 'FAIL', notRun: 'not run' }[done.outcome]
    const missing = done.observed
      .filter((seen) => !seen.ok)
      .map((seen) => `${seen.what} (${seen.saw})`)
      .join('; ')
    const why = done.outcome === 'failed' ? `: ${missing}` : ''
    console.log(
      scrub()(
        `  ${word} ${done.scenario} · ${done.surface} · ${String(done.requests)} req · $${done.usd} · ${done.seconds.toFixed(1)} s${why}${done.reason ? `: ${done.reason}` : ''}`,
      ),
    )
  }
  for (const route of routes) {
    const state = await setUp(route)
    routeStates.push({ id: route.id, wire: route.wire, model: route.model, state: state.state })
    console.log(`Route ${route.id}: ${scrub()(state.state)}`)
    if (state.seen !== undefined) {
      cells.push(setUpCell(route, state))
      say(cells.at(-1))
    }
    // The surfaces on which this route could not answer a plain turn.
    const silent = new Set()
    const ofRoute = plan.filter((one) => one.route === route)
    for (const cell of ofRoute) {
      let refusal = state.ok ? budget.refusal(cell.steps.requests) : 'the route could not be set up'
      if (refusal === undefined && cell.surface === 'acp' && state.noEditor !== undefined) {
        refusal = state.noEditor
      }
      if (refusal === undefined && cell.steps.requests > 0 && silent.has(cell.surface)) {
        refusal =
          'the plain turn failed on this route, so nothing else that costs a request was tried'
      }
      const done = refusal === undefined ? await runCell(cell, state.key) : notRun(cell, refusal)
      if (cell.scenario.id === FIRST_TURN && done.outcome === 'failed') silent.add(cell.surface)
      cells.push(done)
      say(done)
    }
  }
  const records = await usageRecords()
  productUsage = {
    requests: records.length,
    usd: usdText(
      records.reduce((sum, record) => sum + (microUsd(record.cost?.usd ?? '0') || 0), 0),
    ),
  }
} catch (error) {
  console.error(
    `The run stopped: ${scrub()(error instanceof Error ? error.message : String(error))}`,
  )
  process.exitCode = EXIT_FAILED
} finally {
  if (product !== undefined) left = await cleanUp()
  if (!options.shouldKeep) rmSync(folders.root, { recursive: true, force: true, maxRetries: 5 })
}

/** A scenario run as the record keeps it: the gate's fields, then what a person reads. */
const resultOf = (cell) => ({
  scenario: cell.scenario,
  claims: cell.claims,
  route: tableRoute(cell.route),
  model: `${cell.route.model} (${cell.route.wire})`,
  surface: cell.surface,
  outcome: cell.outcome === 'passed' ? 'pass' : 'fail',
  observed: observedText(cell.observed),
  requests: cell.requests,
  usd: cell.usd,
  seconds: cell.seconds,
  title: cell.title,
  vendor: cell.route.id,
  seen: cell.observed,
  recordedByProduct: cell.recordedByProduct,
  ...(cell.log !== undefined && { log: cell.log }),
})
const results = cells.filter((cell) => cell.outcome !== 'notRun').map((cell) => resultOf(cell))
const skipped = cells
  .filter((cell) => cell.outcome === 'notRun')
  .map((cell) => ({
    scenario: cell.scenario,
    claims: cell.claims,
    route: tableRoute(cell.route),
    vendor: cell.route.id,
    surface: cell.surface,
    reason: cell.reason,
  }))
const record = {
  artefact,
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  node: process.version,
  startedAt: started.toISOString(),
  endedAt: new Date().toISOString(),
  caps: { requests: options.maxRequests, usd: usdText(budget.cap.micro) },
  totals: totalsOf(results, skipped, budget.spent, productUsage),
  routes: routeStates,
  results,
  notRun: skipped,
  keysLeftInTheCredentialStore: left,
}
const written = writeRecord(options.record, record, scrub())
console.log(
  `Made ${String(budget.spent.requests)} model requests, $${usdText(budget.spent.micro)} (the product's own usage for this home: ${String(productUsage.requests)} requests, $${productUsage.usd}).`,
)
console.log(
  `${String(record.totals.passed)} passed, ${String(record.totals.failed)} failed, ${String(record.totals.notRun)} not run. Record: ${written.json} and ${written.text}`,
)
if (left.length > 0) {
  console.error(
    `STILL IN THE CREDENTIAL STORE: ${left.join(', ')} (remove with: providers remove <name>)`,
  )
  process.exitCode = EXIT_FAILED
}
if (record.totals.failed > 0) process.exitCode = EXIT_FAILED
