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
import { MATRIX_ADMIT_USD, MATRIX_DAILY_BUDGET_USD } from './lib/admission.mjs'
import { USAGE, matchesAny, parseArguments } from './lib/args.mjs'
import { allowance, microUsd, usdText } from './lib/budget.mjs'
import { newRunFolders, productEnvironment, setDailyBudget } from './lib/home.mjs'
import { installArtefact, sha256Of } from './lib/install.mjs'
import { keySource, missingKeys, readKey } from './lib/keys.mjs'
import { heldUnsettled } from './lib/ledger.mjs'
import {
  BARREN_MODELS,
  CELL_TIMEOUT_MS,
  DEFAULT_ORDER,
  EXEC_ADMIT_USD,
  EXIT_FAILED,
  EXIT_USAGE,
  FIRST_TURN,
  MATRIX_SCENARIOS,
  MATRIX_SURFACE,
  UNSENT_IN_A_ROW,
} from './lib/limits.mjs'
import { clearMarker, readMarker, writeMarker } from './lib/marker.mjs'
import { readMatrix } from './lib/matrix.mjs'
import { personFor } from './lib/person.mjs'
import { endAll, runCommand } from './lib/product.mjs'
import {
  clip,
  ensureRecordDir,
  logExcerpt,
  observedText,
  parseUsageOutput,
  scrubber,
  tableRoute,
  totalsOf,
  writeRecord,
} from './lib/record.mjs'
import {
  DIAGNOSTIC_PREFIX,
  ROUTES,
  providerIdOf,
  routeFor,
  routeRefusal,
  takenProviderReason,
} from './lib/routes.mjs'

const parsed = parseArguments(process.argv.slice(2))
if (!parsed.ok) {
  if (parsed.reason !== '') console.error(parsed.reason)
  console.error(USAGE)
  process.exit(EXIT_USAGE)
}
const { options } = parsed

const SCENARIO_FOLDER = path.join(import.meta.dirname, 'scenarios')
// How the product's usage journal marks dollars a provider's own usage
// stands behind; every other mark is something the product booked itself.
const SETTLED = new Set(['reported', 'computed'])

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

const isMatrix = options.matrix !== undefined
const scenarios = await loadScenarios(isMatrix ? MATRIX_SCENARIOS.join(',') : options.scenarios)
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

const stopForUsage = (reason) => {
  console.error(reason)
  process.exit(EXIT_USAGE)
}

// A matrix is run by the terminal agent only.
const surfaces = isMatrix ? [MATRIX_SURFACE] : options.surfaces
const namedModels = (ids) => (ids.length === 1 ? ids[0] : `${String(ids.length)} models`)

/** The cells of one route on one model: each scenario by each surface it has. */
function cellsFor(route) {
  const cells = []
  for (const scenario of scenarios) {
    // A route with a note (an account with no credit) is for the scenarios
    // that ask for it, and for no other.
    const isWanted = scenario.only === undefined ? route.note === undefined : scenario.only(route)
    if (!isWanted) continue
    for (const surface of surfaces) {
      const steps = scenario[surface]
      if (steps !== undefined) cells.push({ scenario, route, surface, steps })
    }
  }
  return cells
}

/**
 * The plan: per route what is set up once (the provider with its models),
 * and per model the cells that run on it. Outside a matrix a route has one
 * model.
 */
const groups = []
if (isMatrix) {
  const matrix = readMatrix(options.matrix)
  if (!matrix.ok) stopForUsage(matrix.reason)
  for (const { routeId, models } of matrix.groups) {
    groups.push({
      // What is set up once stands for all the route's models.
      route: { ...routeFor(routeId), model: namedModels(models.map((model) => model.id)) },
      models: models.map((model) => model.id),
      units: models.map((model) => {
        const route = { ...routeFor(routeId, new Map([[routeId, model.id]])), isFree: model.free }
        return { route, cells: cellsFor(route) }
      }),
    })
  }
} else {
  for (const id of options.routes) {
    const refusal = routeRefusal(id, options.models.get(id))
    if (refusal !== undefined) stopForUsage(refusal)
    const route = routeFor(id, options.models)
    groups.push({
      route,
      models: [route.model],
      units: [{ route, cells: cellsFor(route) }],
    })
  }
}
const keys = keySource(options.keys)
if (keys.kind === 'invalid') stopForUsage(keys.reason)

const plan = groups.flatMap((group) => group.units.flatMap((unit) => unit.cells))
const mostRequests = plan.reduce((sum, cell) => sum + cell.steps.requests, 0)
const budget = allowance(options.maxRequests, options.maxUsd, options.maxUncertainUsd)
const modelsOf = (group) => namedModels(group.models)
// A selection that matches nothing (a misspelled pattern, no route, no
// surface) must not certify the artefact with zero scenario runs: the run
// stops here, before anything is installed, let alone sent.
if (plan.length === 0) {
  const where =
    groups.length === 0
      ? 'no route'
      : groups.map((group) => `${group.route.id} (${modelsOf(group)})`).join(', ')
  const pattern = isMatrix ? MATRIX_SCENARIOS.join(',') : options.scenarios
  stopForUsage(
    `the plan has no scenario runs: no scenario of '${pattern}' on ${where} by ${surfaces.join(', ') || 'no surface'}`,
  )
}
// The record's folder is made before anything is spent: a run that cannot
// write its record stops here, not after paid calls.
if (options.record !== undefined) ensureRecordDir(options.record)
// A requested route with no key stops the run before anything is installed
// or sent: without it every cell of the route is not run, yet the run
// would exit 0 as a successful gate.
const missing = missingKeys(
  groups.flatMap((group) => group.units.map((unit) => unit.route)),
  keys,
)
if (missing.length > 0) {
  stopForUsage(
    `no key for ${missing.map((one) => `the route ${one.id} (${one.reason})`).join(', ')}`,
  )
}
// First of all: what an earlier run that was ended outright may have left.
const noteOfEarlierRun = readMarker()
if (noteOfEarlierRun !== undefined) {
  console.error(
    `AN EARLIER RUN NOTED AT ${noteOfEarlierRun.storedAt} THAT IT STORED A META KEY IN THE CREDENTIAL STORE, AND DID NOT REMOVE IT. This run looks once the product is installed and says what it finds.`,
  )
}
console.log(
  `Real-life run: ${String(plan.length)} scenario runs on ${String(groups.length)} route(s) (${groups.map((group) => `${group.route.id}: ${modelsOf(group)}`).join('; ')}).`,
)
console.log(
  `It may make up to ${String(Math.min(mostRequests, options.maxRequests))} model requests (the plan's most: ${String(mostRequests)}; the cap: ${String(options.maxRequests)}) and starts nothing more once $${usdText(budget.cap.micro)} of reported usage (settled) is spent, or once the product has booked $${usdText(budget.cap.uncertain)} for requests that were sent and came back with no usage.`,
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
// Why the run is being cut short, once it is (a signal, an error nobody caught).
const cut = { why: undefined }
let product

/** A terminal command outside any scenario (set-up, usage). */
const terminal = (args, stdin = '') => runCommand(product, args, { cwd: folders.workspaces, stdin })

/** A command of the clean-up: a run that is cut short ends every other process and lets these finish. */
const cleaner = (args) => runCommand(product, args, { cwd: folders.workspaces, isCleanUp: true })

/**
 * The product's own usage records for this home, or why they cannot be
 * read: an unreadable usage is spend nobody knows, never an empty reading.
 */
async function usageRecords() {
  return parseUsageOutput(await terminal(['usage', '--json']))
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
  if (!surfaces.includes('acp')) return { ok: true, key, state: onPipe }
  const status = await terminal(['auth', 'status'])
  if (status.code === 0) {
    const held = 'a Meta key is already in the credential store, and the run does not replace it'
    return { ok: true, key, noEditor: held, state: `${onPipe}; ${held}` }
  }
  // Noted before it is stored, outside the run's folder, and never the key:
  // a run that is ended outright leaves the note for the next one. And
  // counted as stored before the command runs: a run that is cut short
  // while it runs removes what it may have stored.
  writeMarker({ storedAt: new Date().toISOString(), run: `the run of ${artefact.name}` })
  stores.isMetaStored = true
  const stored = await terminal(['auth', 'set'], `${key}\n`)
  if (stored.code !== 0 && cut.why === undefined) {
    stores.isMetaStored = false
    clearMarker()
    const refused = `auth set did not store the key: ${said(stored)}`
    return { ok: true, key, noEditor: refused, state: `${onPipe}; ${refused}` }
  }
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
async function setUp(route, models) {
  if (route.kind === 'museCode')
    return { ok: true, state: 'uses the Muse Code sign-in of this machine' }
  const read = readKey(keys, route.stored)
  if (read.key === undefined) return { ok: false, state: `not run: ${read.reason}` }
  secrets.set(read.key, '<key>')
  if (route.kind === 'meta') return await setUpMeta(read.key)
  // A name of the run's own that is already in the credential store is not
  // this run's: another run's, a diagnostic's, or the person's. The run
  // never removes or replaces a stored key, so the route stops here,
  // before any call, and names the entry.
  const before = await terminal(['auth', 'status', '--provider', route.provider])
  if (before.code === 0) return { ok: false, state: takenProviderReason(route) }
  const clock = performance.now()
  // Listed for the clean-up before the command runs: a run that is cut short
  // while it runs removes what it may have stored.
  configured.push(route)
  const added = await terminal(
    [
      'providers',
      'add',
      '--preset',
      route.preset,
      '--as',
      route.provider,
      // Every model the run will use is ticked, as a person ticks them.
      ...models.flatMap((model) => ['--model', model]),
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
  uncertainUsd: usdText(0),
  seconds: state.seconds,
})

// What a clean-up could not remove.
const left = []

/**
 * Removes what the run has stored and not yet removed, through the
 * product's own commands, and checks that it is gone. An entry leaves the
 * list only once that check is made, so a clean-up that is itself cut short
 * is taken up again where it stopped.
 */
async function removeStored() {
  for (const route of configured.toReversed()) {
    // `providers remove` takes the provider out of this home and its key out
    // of the store; `auth clear` takes the key out when the provider was
    // never written (an add that was cut short).
    const removed = await cleaner(['providers', 'remove', route.provider])
    const cleared = await cleaner(['auth', 'clear', '--provider', route.provider])
    const after = await cleaner(['auth', 'status', '--provider', route.provider])
    // A nonzero status is also a store error or an unreadable entry, not
    // proof of absence. Require a successful delete before retiring ownership.
    const isRemoved = (removed.code === 0 || cleared.code === 0) && after.code !== 0
    if (isRemoved) {
      configured.splice(configured.indexOf(route), 1)
      const index = left.indexOf(route.provider)
      if (index !== -1) left.splice(index, 1)
    } else if (!left.includes(route.provider)) left.push(route.provider)
  }
  if (!stores.isMetaStored) return
  const cleared = await cleaner(['auth', 'clear'])
  const after = await cleaner(['auth', 'status'])
  const name = 'the Meta Model API key'
  if (cleared.code === 0 && after.code !== 0) {
    clearMarker()
    stores.isMetaStored = false
    const index = left.indexOf(name)
    if (index !== -1) left.splice(index, 1)
  } else if (!left.includes(name)) left.push(name)
}

// One clean-up at a time: the one a cut asks for waits for the one in flight.
const cleaning = { last: Promise.resolve() }

async function removeAfter(earlier) {
  try {
    await earlier
  } catch {
    // What an earlier clean-up could not do is tried again by this one.
  }
  await removeStored()
}

/**
 * The clean-up. It runs after every route, at the end, and when the run is
 * cut short; a second call finds nothing left to do.
 */
function cleanUp() {
  cleaning.last = removeAfter(cleaning.last)
  return cleaning.last
}

/**
 * The run is being ended from outside (a key press, a closing terminal, a
 * signal) or by an error nobody caught: the product's processes are ended
 * and what the run stored is removed before it exits.
 */
async function cutShort(why) {
  if (cut.why !== undefined) return
  cut.why = why
  console.error(`The run is cut short (${why}): removing what it stored.`)
  budget.end(`the run was cut short (${why})`)
  endAll()
  try {
    if (product !== undefined) await cleanUp()
  } finally {
    if (left.length > 0)
      console.error(`STILL OR POSSIBLY IN THE CREDENTIAL STORE: ${left.join(', ')}`)
    process.exit(EXIT_FAILED)
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(signal, () => cutShort(signal))
}
process.on('uncaughtException', (error) => cutShort(`an error nobody caught: ${error.message}`))
process.on('unhandledRejection', (reason) =>
  cutShort(`a failure nobody handled: ${String(reason)}`),
)

/**
 * What the product's usage journal holds of some records: the settled
 * dollars and the rest. An amount it holds that the run cannot read is
 * spend nobody knows, and is kept as the text it was (`unread`).
 */
function journalOf(records) {
  const held = { requests: records.length, micro: 0, uncertain: 0, unread: [] }
  for (const record of records) {
    const printed = record.cost?.usd
    if (printed === undefined || printed === null) continue
    const micro = microUsd(printed)
    if (Number.isNaN(micro)) held.unread.push(`usage record cost: ${String(printed)}`)
    else if (SETTLED.has(record.cost.certainty)) held.micro += micro
    else held.uncertain += micro
  }
  return held
}

/**
 * @param {object} cell one scenario on one route by one surface
 * @param {string | undefined} key the route's key
 */
async function runCell(cell, key) {
  const { scenario, route, surface, steps } = cell
  const workspace = path.join(
    folders.workspaces,
    `${String(cells.length + 1)}-${scenario.id}-${surface}`,
  )
  mkdirSync(workspace)
  const admitUsd = isMatrix ? MATRIX_ADMIT_USD : EXEC_ADMIT_USD
  const person = personFor({ product, route, workspace, admitUsd, key })
  const observed = []
  const see = (what, ok, saw) => {
    observed.push({ what, ok: ok === true, saw: clip(saw) })
  }
  // A matrix turn is a terminal run, counted by its own result: the journal
  // is not read for it (two more commands for each of hundreds of turns).
  const isJournalRead = !isMatrix
  const readBefore = isJournalRead ? await usageRecords() : { ok: true, records: [] }
  if (!readBefore.ok) {
    // The spend so far cannot be read: the cell fails and nothing more starts.
    see('the product usage for this home could be read', false, readBefore.reason)
    budget.end(
      `the product's usage could not be read (${readBefore.reason}): what was spent is unknown`,
    )
    await person.end()
    return {
      scenario: scenario.id,
      title: scenario.title,
      route,
      surface,
      claims: steps.claims,
      outcome: 'failed',
      observed,
      requests: 0,
      usd: usdText(0),
      uncertainUsd: usdText(0),
      seconds: 0,
    }
  }
  const before = new Set(readBefore.records.map((record) => record.id))
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
  for (const note of person.notes) see(note.what, note.ok, note.saw)
  const readAfter = isJournalRead ? await usageRecords() : { ok: true, records: [] }
  if (!readAfter.ok) {
    see('the product usage for this home could be read', false, readAfter.reason)
    budget.end(
      `the product's usage could not be read (${readAfter.reason}): what was spent is unknown`,
    )
  }
  const journal = journalOf(
    (readAfter.ok ? readAfter.records : []).filter((record) => !before.has(record.id)),
  )
  // A terminal run is counted by its own result; an editor session by the
  // usage the product recorded for it.
  const used = surface === 'exec' ? person.made : journal
  budget.spend(used.requests, used.micro, used.uncertain, person.made.turnedAway)
  see(
    'it made no more requests than it said it may',
    used.requests <= steps.requests,
    `${String(used.requests)} of at most ${String(steps.requests)}`,
  )
  // Money the run cannot read is not zero: it is unknown, and the run ends.
  const unread = [...person.made.unread, ...journal.unread]
  if (unread.length > 0) {
    see('every amount the product printed could be read', false, unread.join('; '))
    budget.end(
      `an amount the product printed could not be read (${unread[0]}): what was spent is unknown`,
    )
  }
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
    uncertainUsd: usdText(used.uncertain),
    ...(isJournalRead && {
      recordedByProduct: {
        requests: journal.requests,
        usd: usdText(journal.micro + journal.uncertain),
      },
    }),
    seconds,
    ...(person.skipped.length > 0 && { stepsNotRun: person.skipped }),
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
  uncertainUsd: usdText(0),
  seconds: 0,
})

/** A model's first turn that failed and for which no provider reported any usage. */
const isBarren = (cell, done) =>
  cell.scenario.id === FIRST_TURN && done.outcome === 'failed' && microUsd(done.usd) === 0

// A matrix's plain turns in a row that sent nothing at all: the product has
// stopped sending (its own stop, whatever it calls it), and the run with it.
const unsent = { inARow: 0 }

/**
 * The cells of one model on a route that is set up. A plain turn that fails
 * ends what costs a request on that surface for this model.
 * @returns {Promise<boolean>} whether the model's first turn failed with no usage reported
 */
async function runUnit(unit, state, stopped, say) {
  // The surfaces on which this model could not answer a plain turn.
  const silent = new Set()
  let isUnitBarren = false
  for (const cell of unit.cells) {
    let refusal = state.ok ? stopped : 'the route could not be set up'
    refusal ??= budget.refusal(cell.steps.requests)
    if (refusal === undefined && cell.surface === 'acp' && state.noEditor !== undefined) {
      refusal = state.noEditor
    }
    if (refusal === undefined && cell.steps.requests > 0 && silent.has(cell.surface)) {
      refusal = `the plain turn failed on this ${isMatrix ? 'model' : 'route'}, so nothing else that costs a request was tried`
    }
    const done = refusal === undefined ? await runCell(cell, state.key) : notRun(cell, refusal)
    if (cell.scenario.id === FIRST_TURN && done.outcome === 'failed') silent.add(cell.surface)
    isUnitBarren ||= isBarren(cell, done)
    if (isMatrix && cell.scenario.id === FIRST_TURN && done.outcome !== 'notRun') {
      unsent.inARow = done.requests === 0 ? unsent.inARow + 1 : 0
      if (unsent.inARow === UNSENT_IN_A_ROW) {
        budget.end(
          `${String(UNSENT_IN_A_ROW)} plain turns in a row sent nothing: the product has stopped sending`,
        )
      }
    }
    cells.push(done)
    say(done)
  }
  return isUnitBarren
}

let productUsage = { requests: 0, usd: usdText(0) }
let unsettled = { claims: 0, micro: 0, unread: [] }

/**
 * A run that was ended outright may have left Meta's key in the credential
 * store; it left a note (lib/marker.mjs). This run never removes a key on
 * the strength of that note, since the person may have stored their own
 * since: it says what it found and what it did.
 */
async function earlierRunLeft(note) {
  const status = await terminal(['auth', 'status'])
  if (status.code !== 0) {
    clearMarker()
    return { ...note, stillStored: false, did: 'cleared the note: no Meta key is stored' }
  }
  return {
    ...note,
    stillStored: true,
    did: 'removed nothing: it cannot tell that key from one stored since. If the key is not yours, remove it with the product (`auth clear`); the Meta editor scenarios are not run while it is there',
  }
}
let earlierRun

/**
 * The provider keys in the credential store under a name of the run's own
 * (`rl-<route>`) or of its diagnostic (`rlq-<route>`): what a run or a
 * diagnostic that was ended outright left behind. The product itself is
 * asked, name by name; nothing is removed here.
 */
async function entriesLeft() {
  const names = Object.entries(ROUTES)
    .filter(([, route]) => route.kind === 'provider')
    .flatMap(([id]) => [providerIdOf(id), `${DIAGNOSTIC_PREFIX}${id}`])
  const found = []
  for (const name of names) {
    const status = await terminal(['auth', 'status', '--provider', name])
    if (status.code === 0) found.push(name)
  }
  return found
}
let foundAtStart = []
// What the run set in the product's own settings, in its own new home.
const settings = isMatrix
  ? [
      {
        setting: 'paidDailyBudgetUsd',
        value: MATRIX_DAILY_BUDGET_USD,
        where: "settings.json of the data folder in the run's own new home",
        why: "the product's daily ledger keeps the reservation of every request that ends with no usage; at its default of $5 a day it stops a matrix after a few of them",
      },
    ]
  : []
try {
  const installed = installArtefact(options.artefact, folders.install)
  if (!installed.ok) throw new Error(installed.reason)
  artefact.package = installed.name
  artefact.version = installed.version
  product = { agent: installed.agent, env: productEnvironment(folders.home) }
  console.log(`Installed ${installed.name} ${installed.version} (SHA-256 ${artefact.sha256}).`)
  if (isMatrix) {
    setDailyBudget(folders.home, MATRIX_DAILY_BUDGET_USD)
    console.log(
      `In this run's own new home the product's daily budget is set to $${String(MATRIX_DAILY_BUDGET_USD)} (${settings[0].setting}): ${settings[0].why}.`,
    )
  }
  if (noteOfEarlierRun !== undefined) {
    earlierRun = await earlierRunLeft(noteOfEarlierRun)
    console.error(
      `The run that noted a Meta key at ${earlierRun.storedAt}: a Meta key is ${earlierRun.stillStored ? 'STILL IN THE CREDENTIAL STORE' : 'no longer stored'}. This run ${earlierRun.did}.`,
    )
  }
  foundAtStart = await entriesLeft()
  if (foundAtStart.length > 0) {
    console.error(
      `LEFT IN THE CREDENTIAL STORE BY AN EARLIER RUN OR DIAGNOSTIC: ${foundAtStart.join(', ')}. This run never removes or replaces a stored key: a route whose name is taken is not run; remove it with the product: auth clear --provider <name>.`,
    )
  }
  const say = (done) => {
    const word = { passed: 'PASS', failed: 'FAIL', notRun: 'not run' }[done.outcome]
    const missing = done.observed
      .filter((seen) => !seen.ok)
      .map((seen) => `${seen.what} (${seen.saw})`)
      .join('; ')
    const why = done.outcome === 'failed' ? `: ${missing}` : ''
    const booked =
      microUsd(done.uncertainUsd) > 0 ? ` (+$${done.uncertainUsd} booked with no usage)` : ''
    const model = isMatrix ? ` · ${done.route.model}` : ''
    console.log(
      scrub()(
        `  ${word} ${done.scenario}${model} · ${done.surface} · ${String(done.requests)} req · $${done.usd}${booked} · ${done.seconds.toFixed(1)} s${why}${done.reason ? `: ${done.reason}` : ''}`,
      ),
    )
  }
  for (const group of groups) {
    // A run that is being cut short sets nothing more up.
    if (cut.why !== undefined) break
    const { route } = group
    const state = await setUp(route, group.models)
    // Every requested setup failure fails the run, even when it produced
    // no setup observations and all subsequent cells are not run.
    if (!state.ok) process.exitCode = EXIT_FAILED
    routeStates.push({ id: route.id, wire: route.wire, model: modelsOf(group), state: state.state })
    console.log(`Route ${route.id}: ${scrub()(state.state)}`)
    if (state.seen !== undefined) {
      cells.push(setUpCell(route, state))
      say(cells.at(-1))
    }
    // The models from the first on whose first turn failed with no usage reported.
    let barren = 0
    let stopped
    for (const [index, unit] of group.units.entries()) {
      const isUnitBarren = await runUnit(unit, state, stopped, say)
      if (isUnitBarren && barren === index) barren += 1
      if (isMatrix && barren === BARREN_MODELS && index === BARREN_MODELS - 1) {
        stopped = `the first ${String(BARREN_MODELS)} models of this route failed with no usage reported: an account or a key that does not work, not a model`
      }
    }
    // What this route stored is removed before the next one starts: a run
    // that is ended outright leaves at most one route's entry behind.
    await cleanUp()
  }
  const read = await usageRecords()
  if (read.ok) {
    const held = journalOf(read.records)
    productUsage = { requests: held.requests, usd: usdText(held.micro + held.uncertain) }
  } else {
    const reason = `the product's own usage could not be read (${read.reason}): what it spent is unknown`
    console.error(reason)
    budget.end(reason)
    productUsage = { requests: 0, usd: usdText(0), unread: read.reason }
    process.exitCode = EXIT_FAILED
  }
  unsettled = heldUnsettled(folders.home)
  if (unsettled.unread.length > 0) {
    const reason = `the daily ledger has unread liability: ${unsettled.unread.join('; ')}`
    console.error(reason)
    budget.end(reason)
    process.exitCode = EXIT_FAILED
  }
} catch (error) {
  console.error(
    `The run stopped: ${scrub()(error instanceof Error ? error.message : String(error))}`,
  )
  process.exitCode = EXIT_FAILED
} finally {
  if (product !== undefined) await cleanUp()
  if (!options.shouldKeep) rmSync(folders.root, { recursive: true, force: true, maxRetries: 5 })
}

/** The model of a result: its id, the wire, and that its listed price is zero when it is. */
const modelText = (route) =>
  `${route.model} (${route.wire}${route.isFree === true ? ', listed free' : ''})`

/** A scenario run as the record keeps it: the gate's fields, then what a person reads. */
const resultOf = (cell) => ({
  scenario: cell.scenario,
  claims: cell.claims,
  route: tableRoute(cell.route),
  model: modelText(cell.route),
  surface: cell.surface,
  outcome: cell.outcome === 'passed' ? 'pass' : 'fail',
  observed: observedText(cell.observed),
  requests: cell.requests,
  usd: cell.usd,
  seconds: cell.seconds,
  title: cell.title,
  vendor: cell.route.id,
  uncertainUsd: cell.uncertainUsd,
  seen: cell.observed,
  ...(cell.stepsNotRun !== undefined && { stepsNotRun: cell.stepsNotRun }),
  ...(cell.recordedByProduct !== undefined && { recordedByProduct: cell.recordedByProduct }),
  ...(cell.log !== undefined && { log: cell.log }),
})
const results = cells.filter((cell) => cell.outcome !== 'notRun').map((cell) => resultOf(cell))
const skipped = cells
  .filter((cell) => cell.outcome === 'notRun')
  .map((cell) => ({
    scenario: cell.scenario,
    claims: cell.claims,
    route: tableRoute(cell.route),
    model: modelText(cell.route),
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
  caps: {
    requests: options.maxRequests,
    usd: usdText(budget.cap.micro),
    uncertainUsd: usdText(budget.cap.uncertain),
  },
  settings,
  ...(earlierRun !== undefined && { earlierRun }),
  ...(foundAtStart.length > 0 && { entriesFoundAtStart: foundAtStart }),
  totals: totalsOf(results, skipped, budget.spent, productUsage, unsettled),
  routes: routeStates,
  results,
  notRun: skipped,
  keysLeftInTheCredentialStore: left,
}
const written = writeRecord(options.record, record, scrub())
console.log(
  `Made ${String(budget.spent.requests)} model requests, $${record.totals.usd} of reported usage (settled). Booked by the product for requests that were sent and came back with no usage report: $${record.totals.uncertainUsd}; its daily ledger holds $${record.totals.ledgerUnsettled.usd} with no settlement. The product's own usage for this home: ${String(productUsage.requests)} requests, $${productUsage.usd}.`,
)
console.log(
  `${String(record.totals.passed)} passed, ${String(record.totals.failed)} failed, ${String(record.totals.notRun)} not run. Record: ${written.json} and ${written.text}`,
)
if (left.length > 0) {
  console.error(
    `STILL OR POSSIBLY IN THE CREDENTIAL STORE: ${left.join(', ')} (remove with: auth clear [--provider <name>])`,
  )
  process.exitCode = EXIT_FAILED
}
if (record.totals.failed > 0) process.exitCode = EXIT_FAILED
