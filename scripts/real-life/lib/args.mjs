// The run's own command line. Nothing here touches the product.
import path from 'node:path'

export const USAGE = `node scripts/real-life/run.mjs --artefact <agent tarball> --routes <list> --max-requests <n> --max-usd <x> --record <file>
    [--scenarios <glob>] [--surfaces exec,acp] [--keys dpapi:<folder>|env]
    [--model <route>=<model>] [--max-uncertain-usd <x>] [--work <folder>] [--keep] [--list]
node scripts/real-life/run.mjs --artefact <agent tarball> --matrix <file> --max-requests <n> --max-usd <x> --record <file>

  --artefact      the packed agent (npm pack's .tgz), installed into a new empty folder
  --routes        which providers to use, by name (--list prints them)
  --matrix        a model matrix instead of --routes: a JSON file of route to model ids;
                  every model gets one plain turn and one tool turn by the terminal agent
  --scenarios     which scenarios, by file name, several separated by commas; * stands
                  for any characters (default: all)
  --surfaces      exec (the terminal agent), acp (the editor protocol), or both (default)
  --max-requests  admission stop: start a scenario only while its declared requests fit;
                  ACP has no per-request cap and can exceed this within a running scenario
  --max-usd       the run starts nothing more once it has spent this much (usage the
                  providers reported; what the product booked with no usage is listed apart)
  --max-uncertain-usd  the run starts nothing more once the product has booked this much
                  for requests that were sent and came back with no usage report: that
                  may be real money (default: 5)
  --record        where the record is written (<file>.json and <file>.txt)
  --keys          where the keys come from (default: env, REAL_LIFE_KEY_<NAME>)
  --model         another model for one route (repeat for more routes)
  --work          where the new folders are made (default: the system's temporary folder)
  --keep          leave the install, the home and the workspaces in place afterwards
  --list          print the routes and the scenarios, and make no request`

const VALUED = new Set([
  'artefact',
  'routes',
  'matrix',
  'scenarios',
  'surfaces',
  'max-requests',
  'max-usd',
  'max-uncertain-usd',
  'record',
  'keys',
  'model',
  'work',
])
const FLAGS = new Set(['keep', 'list', 'help'])
const SURFACES = ['exec', 'acp']
// A request that was sent and came back with no usage report may have been
// charged by its provider: the run stops for good once the product has
// booked this many dollars for such requests, unless the operator says more.
const DEFAULT_MAX_UNCERTAIN_USD = 5

const listOf = (text) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')

/**
@param {readonly string[]} argv
@returns {{ ok: true, options: object } | { ok: false, reason: string }}
*/
export function parseArguments(argv) {
  const given = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? ''
    if (!argument.startsWith('--')) return { ok: false, reason: `not an option: ${argument}` }
    const name = argument.slice(2)
    if (FLAGS.has(name)) {
      given.set(name, [...(given.get(name) ?? []), 'true'])
      continue
    }
    if (!VALUED.has(name)) return { ok: false, reason: `unknown option: ${argument}` }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, reason: `${argument} needs a value` }
    }
    given.set(name, [...(given.get(name) ?? []), value])
    index += 1
  }
  if (given.has('help')) return { ok: false, reason: '' }
  const one = (name) => given.get(name)?.at(-1)
  const isList = given.has('list')
  const maxRequests = Number(one('max-requests'))
  const maxUsd = Number(one('max-usd'))
  const maxUncertainUsd = Number(one('max-uncertain-usd') ?? DEFAULT_MAX_UNCERTAIN_USD)
  if (!isList) {
    for (const name of ['artefact', 'max-requests', 'max-usd', 'record']) {
      if (one(name) === undefined) return { ok: false, reason: `--${name} is required` }
    }
    if ((one('routes') === undefined) === (one('matrix') === undefined)) {
      return { ok: false, reason: 'one of --routes and --matrix is required, and not both' }
    }
    const withRoutesOnly = ['scenarios', 'surfaces', 'model'].find((name) => given.has(name))
    if (withRoutesOnly !== undefined && one('matrix') !== undefined) {
      return { ok: false, reason: `--${withRoutesOnly} does not go with --matrix` }
    }
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
      return { ok: false, reason: '--max-requests takes a whole number of at least 1' }
    }
    if (!Number.isFinite(maxUsd) || maxUsd <= 0) {
      return { ok: false, reason: '--max-usd takes an amount above 0' }
    }
    if (!Number.isFinite(maxUncertainUsd) || maxUncertainUsd <= 0) {
      return { ok: false, reason: '--max-uncertain-usd takes an amount above 0' }
    }
  }
  const surfaces = listOf(one('surfaces') ?? SURFACES.join(','))
  const unknown = surfaces.find((surface) => !SURFACES.includes(surface))
  if (unknown !== undefined) return { ok: false, reason: `--surfaces: not a surface: ${unknown}` }
  const routes = listOf(one('routes') ?? '')
  const models = new Map()
  const pairs = given.get('model') ?? []
  for (const pair of pairs) {
    const at = pair.indexOf('=')
    if (at < 1 || at === pair.length - 1) {
      return { ok: false, reason: `--model takes <route>=<model>, not ${pair}` }
    }
    const route = pair.slice(0, at)
    if (routes.filter((id) => id === route).length !== 1) {
      return {
        ok: false,
        reason: `--model route ${route} must be selected exactly once in --routes`,
      }
    }
    models.set(route, pair.slice(at + 1))
  }
  return {
    ok: true,
    options: {
      isList,
      artefact: one('artefact') === undefined ? undefined : path.resolve(one('artefact')),
      routes,
      matrix: one('matrix') === undefined ? undefined : path.resolve(one('matrix')),
      scenarios: one('scenarios') ?? '*',
      surfaces,
      maxRequests,
      maxUsd,
      maxUncertainUsd,
      record: one('record') === undefined ? undefined : path.resolve(one('record')),
      keys: one('keys') ?? 'env',
      models,
      work: one('work') === undefined ? undefined : path.resolve(one('work')),
      shouldKeep: given.has('keep'),
    },
  }
}

/** Whether a name matches one of several patterns separated by commas. */
export const matchesAny = (patterns, name) =>
  patterns.split(',').some((pattern) => matches(pattern.trim(), name))

/** Whether a name matches a pattern in which `*` stands for any characters. */
export function matches(pattern, name) {
  const parts = pattern.split('*')
  if (parts.length === 1) return pattern === name
  const [first = '', ...rest] = parts
  const last = rest.pop() ?? ''
  if (!name.startsWith(first) || !name.endsWith(last)) return false
  let at = first.length
  for (const part of rest) {
    const found = name.indexOf(part, at)
    if (found === -1) return false
    at = found + part.length
  }
  return at <= name.length - last.length
}
