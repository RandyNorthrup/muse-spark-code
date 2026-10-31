import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'
import { buildEnvironment, MHP_VERSION } from '../../scripts/package-hosts/manifest.mjs'

// A hung native harness must die by its parent's hand before the
// orchestrator's 20-minute kill orphans it; execFileSync SIGTERMs here.
export const HARNESS_TIMEOUT_MS = 19 * 60 * 1000

/** A scenario harness the machine cannot run: another OS, toolchain or editor. */
export class PendingNeed extends Error {
  constructor(need) {
    super(`MHP_CONFORMANCE_PENDING: ${need}`)
    this.need = need
  }
}

/** A PATH lookup without a shell; a missing tool is pending, never a crash. */
export function resolveTool(command, env = process.env) {
  if (command.includes('/') || command.includes(path.sep)) {
    const direct = path.resolve(command)
    return isExecutable(direct) ? direct : undefined
  }
  const extensions = process.platform === 'win32' ? (env.PATHEXT ?? '.EXE').split(';') : ['']
  const folders = (env.PATH ?? '').split(path.delimiter)
  for (const folder of folders) {
    if (folder.length === 0) continue
    for (const extension of extensions) {
      const candidate = path.join(folder, `${command}${extension}`)
      if (isExecutable(candidate)) return candidate
      if (process.platform !== 'win32') continue
      const lower = path.join(folder, `${command}${extension.toLowerCase()}`)
      if (isExecutable(lower)) return lower
    }
  }
  return undefined
}

function isExecutable(file) {
  try {
    const info = statSync(file)
    return info.isFile() && (process.platform === 'win32' || (info.mode & 0o111) !== 0)
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(error.code)
    )
      return false
    throw error
  }
}

/**
A JDK home, not a bare `java` stub: macOS ships /usr/bin/java with no
runtime behind it. `root` exists only so tests plant real homes in temp.
*/
export function resolveJdkHome({
  platform = process.platform,
  env = process.env,
  root = '/',
} = {}) {
  const binaryName = platform === 'win32' ? 'java.exe' : 'java'
  const home = env.JAVA_HOME
  if (home !== undefined && home.length > 0)
    return isExecutable(path.join(home, 'bin', binaryName)) ? home : undefined
  let candidates
  if (platform === 'darwin') candidates = [path.join(root, 'Library/Java/JavaVirtualMachines')]
  else if (platform === 'win32')
    candidates = [
      path.join(root, 'Program Files/Java'),
      path.join(root, 'Program Files (x86)/Java'),
    ]
  else candidates = [path.join(root, 'usr/lib/jvm')]
  for (const folder of candidates) {
    let entries
    try {
      entries = readdirSync(folder)
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code !== 'ENOENT' &&
        error.code !== 'ENOTDIR'
      )
        throw error
      continue
    }
    for (const entry of entries) {
      const home =
        platform === 'darwin'
          ? path.join(folder, entry, 'Contents', 'Home')
          : path.join(folder, entry)
      if (isExecutable(path.join(home, 'bin', binaryName))) return home
    }
  }
  return undefined
}

/** The production build tree the host job builds before conformance runs. */
export function resolveRuntime(
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
) {
  const entry = path.join(root, 'dist', 'acp.js')
  const portable = path.join(root, 'dist', 'webview', 'portable', 'main.js')
  for (const file of [entry, portable])
    if (!existsSync(file) || !statSync(file).isFile())
      throw new Error('MHP_CONFORMANCE_NO_RUNTIME: run npm run build first')
  return entry
}

const observationsSchema = z.strictObject({
  observations: z.record(z.string(), z.record(z.string(), z.unknown())),
})

/** The harness writes one JSON file; anything else is its failure, not a report. */
export function readObservationsFile(file) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error('MHP_CONFORMANCE_MALFORMED_OBSERVATIONS', { cause: error })
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR'].includes(error.code)
    )
      throw new Error('MHP_CONFORMANCE_NO_OBSERVATIONS', { cause: error })
    throw error
  }
  return observationsSchema.parse(parsed).observations
}

/** Runnable legs in contract order; a missing or extra leg fails the harness. */
export function resultsFromObservations(loaded, observations, host) {
  const { runnable } = partitionLegs(loaded, host)
  const seen = new Set()
  const results = runnable.map(({ backend, scenario }) => {
    const key = `${backend}/${scenario.id}`
    if (!Object.hasOwn(observations, key))
      throw new Error(`MHP_CONFORMANCE_MISSING_LEG:${backend}:${scenario.id}`)
    seen.add(key)
    return {
      backend,
      scenario: scenario.id,
      observations: observations[key],
      skipped: false,
    }
  })
  for (const key of Object.keys(observations))
    if (!seen.has(key)) throw new Error(`MHP_CONFORMANCE_EXTRA_LEG:${key}`)
  return results
}

export const contractSchema = z.strictObject({
  protocol: z.string().check(z.regex(/^mhp\/\d+\.\d+\.\d+$/u)),
  backends: z.array(z.enum(['musecode', 'modelapi'])).check(z.minLength(1)),
  scenarios: z
    .array(
      z.strictObject({
        id: z.string().check(z.minLength(1)),
        actions: z.array(z.record(z.string(), z.unknown())),
        expected: z.record(z.string(), z.unknown()),
      }),
    )
    .check(z.minLength(1)),
  waiting: z.optional(
    z.array(
      z.strictObject({
        backend: z.string(),
        scenario: z.string(),
        hosts: z.optional(z.array(z.string()).check(z.minLength(1))),
        need: z.string().check(z.minLength(1)),
      }),
    ),
  ),
})

const resultSchema = z.strictObject({
  backend: z.enum(['musecode', 'modelapi']),
  scenario: z.string().check(z.minLength(1)),
  observations: z.record(z.string(), z.unknown()),
  skipped: z.literal(false),
})

/** The orchestrator pipes its contract; a foreign protocol version refuses. */
export async function readContractStdin(stream = process.stdin) {
  const chunks = await Array.fromAsync(stream)
  const loaded = contractSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (loaded.protocol !== MHP_VERSION) throw new Error('MHP_CONFORMANCE_PROTOCOL_SKEW')
  return loaded
}

/** Runnable legs run; waiting legs stay absent from the report. */
export function partitionLegs(loaded, host) {
  const contract = contractSchema.parse(loaded)
  const waiting = (contract.waiting ?? []).filter(
    (leg) => leg.hosts === undefined || leg.hosts.includes(host),
  )
  const waits = new Set(waiting.map((leg) => `${leg.backend}:${leg.scenario}`))
  const runnable = []
  for (const backend of contract.backends)
    for (const scenario of contract.scenarios)
      if (!waits.has(`${backend}:${scenario.id}`)) runnable.push({ backend, scenario })
  return { runnable, waiting }
}

export function buildReport(host, loaded, results) {
  const contract = contractSchema.parse(loaded)
  return {
    protocol: contract.protocol,
    host,
    results: z.array(resultSchema).parse(results),
  }
}

/** Run the host's real headless harness; its logs stay on stderr. */
export function runHarness(command, args, options = {}) {
  return execFileSync(command, args, {
    ...options,
    env: buildEnvironment(process.env),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: HARNESS_TIMEOUT_MS,
  })
}

/**
One host's conformance flow: the orchestrator's contract in, the harness's
observations out as a validated report. `tool: false` names a host with no
scenario harness at all. Runners call this and nothing else.
*/
export async function conformHost({ host, tool, need, args, directory, platforms, jdk }) {
  try {
    const contract = await readContractStdin()
    if (tool === false) throw new PendingNeed(need)
    if (platforms !== undefined && !platforms.includes(process.platform))
      throw new PendingNeed(need)
    const tools = Array.isArray(tool) ? tool : [tool]
    if (tools.some((name) => resolveTool(name) === undefined)) throw new PendingNeed(need)
    if (jdk === true && resolveJdkHome() === undefined) throw new PendingNeed(need)
    const runtime = resolveRuntime()
    const [executable] = tools
    const contractFile = path.join(directory, 'conformance-contract.json')
    const observationsFile = path.join(directory, 'conformance-observations.json')
    rmSync(contractFile, { force: true })
    rmSync(observationsFile, { force: true })
    writeFileSync(contractFile, JSON.stringify(contract))
    process.env.MUSE_CONFORMANCE_CONTRACT = contractFile
    process.env.MUSE_CONFORMANCE_OBSERVATIONS = observationsFile
    process.env.MUSE_CONFORMANCE_RUNTIME = runtime
    runHarness(executable, args, { cwd: directory })
    const observations = readObservationsFile(observationsFile)
    console.log(
      JSON.stringify(
        buildReport(host, contract, resultsFromObservations(contract, observations, host)),
      ),
    )
  } catch (error) {
    if (error instanceof PendingNeed) {
      console.error(error.message)
      process.exitCode = 3
    } else if (error instanceof Error && error.message.startsWith('MHP_')) {
      console.error(error.message)
      process.exitCode = 1
    } else {
      console.error('MHP_CONFORMANCE_HARNESS_FAILED')
      process.exitCode = 1
    }
  }
}
