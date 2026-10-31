import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as z from 'zod/mini'
import {
  buildEnvironment,
  HOSTS,
  hostManifest,
  MHP_VERSION,
} from '../../scripts/package-hosts/manifest.mjs'

export const contract = JSON.parse(
  readFileSync(new URL('scenarios/contract.json', import.meta.url), 'utf8'),
)
const reportSchema = z.strictObject({
  protocol: z.literal(MHP_VERSION),
  host: z.string(),
  results: z.array(
    z.strictObject({
      backend: z.enum(['musecode', 'modelapi']),
      scenario: z.string(),
      observations: z.record(z.string(), z.unknown()),
      skipped: z.literal(false),
    }),
  ),
})

const waitingSchema = z.array(
  z.strictObject({
    backend: z.string(),
    scenario: z.string(),
    hosts: z.optional(z.array(z.string()).check(z.minLength(1))),
    need: z.string().check(z.minLength(1)),
  }),
)

/** Waiting legs name a need outside the lane's reach; anything else is a contract defect. */
export function waitingLegs(loaded = contract) {
  const waiting = waitingSchema.parse(loaded.waiting ?? [])
  const seen = new Set()
  for (const leg of waiting) {
    assert.ok(
      loaded.backends.includes(leg.backend),
      `MHP_CONFORMANCE_WAITING_BACKEND:${leg.backend}`,
    )
    assert.ok(
      loaded.scenarios.some((scenario) => scenario.id === leg.scenario),
      `MHP_CONFORMANCE_WAITING_SCENARIO:${leg.scenario}`,
    )
    const names = leg.hosts ?? []
    for (const name of names)
      assert.ok(
        Object.hasOwn(HOSTS, name),
        `MHP_CONFORMANCE_WAITING_HOST:${leg.backend}:${leg.scenario}:${name}`,
      )
    const key = `${leg.backend}:${leg.scenario}:${names.join(',')}`
    assert.ok(!seen.has(key), `MHP_CONFORMANCE_WAITING_DUPLICATE:${key}`)
    seen.add(key)
  }
  return waiting
}

/** A leg waits on a host when it waits everywhere or names that host. */
export function waitsOn(leg, host) {
  return leg.hosts === undefined || leg.hosts.includes(host)
}

export function outcomeFor(waiting) {
  return waiting.length > 0 ? 'waiting' : 'conformant'
}

/** Validate observations, not a self-reported "passed" bit or process exit alone. */
export function validateReport(host, report) {
  const parsed = reportSchema.parse(report)
  assert.equal(parsed.host, host, 'MHP_CONFORMANCE_WRONG_HOST')
  const waiting = waitingLegs().filter((leg) => waitsOn(leg, host))
  const count = contract.backends.length * contract.scenarios.length - waiting.length
  assert.equal(parsed.results.length, count, 'MHP_CONFORMANCE_COUNT')
  const waits = new Set(waiting.map((leg) => `${leg.backend}:${leg.scenario}`))
  for (const backend of contract.backends) {
    for (const scenario of contract.scenarios) {
      const matches = parsed.results.filter(
        (result) => result.backend === backend && result.scenario === scenario.id,
      )
      if (waits.has(`${backend}:${scenario.id}`)) {
        assert.equal(
          matches.length,
          0,
          `MHP_CONFORMANCE_WAITING_HAS_RESULT:${backend}:${scenario.id}`,
        )
        continue
      }
      assert.equal(
        matches.length,
        1,
        `MHP_CONFORMANCE_MISSING_OR_DUPLICATE:${backend}:${scenario.id}`,
      )
      for (const [key, expected] of Object.entries(scenario.expected))
        assert.deepEqual(
          matches[0].observations[key],
          expected,
          `MHP_CONFORMANCE_OBSERVATION:${backend}:${scenario.id}:${key}`,
        )
    }
  }
  return parsed
}

/** Every existing host runs its real native harness; one failure never hides the rest. */
export function runConformance(root, hosts = Object.keys(HOSTS), run = execFileSync) {
  return hosts.map((host) => {
    try {
      const found = hostManifest(root, host)
      if ('outcome' in found) return found
      const { command, args } = found.manifest.conformance
      let output
      try {
        output = run(command, args, {
          cwd: found.directory,
          env: { ...buildEnvironment(process.env), MUSE_MHP_VERSION: contract.protocol },
          input: JSON.stringify(contract),
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          timeout: 1_200_000,
        })
      } catch (error) {
        // Exit 3 is the runner's pending signal: a harness this machine
        // cannot run, with its need on the first stderr line. Anything
        // else is the harness failing.
        if (
          error !== null &&
          typeof error === 'object' &&
          'status' in error &&
          error.status === 3
        ) {
          const stderr = typeof error.stderr === 'string' ? error.stderr : ''
          const [need = ''] = stderr.split('\n', 1)
          return { host, outcome: 'pending', need }
        }
        throw error
      }
      const report = validateReport(host, JSON.parse(output))
      const waiting = waitingLegs().filter((leg) => waitsOn(leg, host))
      return {
        host,
        outcome: outcomeFor(waiting),
        protocol: contract.protocol,
        scenarios: contract.scenarios.length,
        backends: contract.backends,
        waiting,
        report,
      }
    } catch (error) {
      // A failure can embed captured output and environment, so the
      // outcome carries a fixed word; the runner's own lines name it.
      const failure =
        error instanceof Error && error.message.startsWith('MHP_')
          ? error.message.split('\n', 1)[0]
          : 'MHP_CONFORMANCE_HARNESS_FAILED'
      return { host, outcome: 'failed', error: failure }
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = runConformance(process.cwd(), process.argv[2] ? [process.argv[2]] : undefined)
  for (const result of results) console.log(JSON.stringify(result))
  if (results.some((result) => result.outcome === 'failed')) {
    console.error('MHP_CONFORMANCE_FAILED: invalid observations or native harness failure')
    process.exitCode = 1
  }
}
