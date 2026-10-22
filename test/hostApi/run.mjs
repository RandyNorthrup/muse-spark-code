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

/** Validate observations, not a self-reported "passed" bit or process exit alone. */
export function validateReport(host, report) {
  const parsed = reportSchema.parse(report)
  assert.equal(parsed.host, host, 'MHP_CONFORMANCE_WRONG_HOST')
  assert.equal(
    parsed.results.length,
    contract.backends.length * contract.scenarios.length,
    'MHP_CONFORMANCE_COUNT',
  )
  for (const backend of contract.backends) {
    for (const scenario of contract.scenarios) {
      const matches = parsed.results.filter(
        (result) => result.backend === backend && result.scenario === scenario.id,
      )
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

/** Every existing host must run its real native harness with the shared authored scenarios. */
export function runConformance(root, hosts = Object.keys(HOSTS), run = execFileSync) {
  return hosts.map((host) => {
    const found = hostManifest(root, host)
    if ('outcome' in found) return found
    const { command, args } = found.manifest.conformance
    const output = run(command, args, {
      cwd: found.directory,
      env: { ...buildEnvironment(process.env), MUSE_MHP_VERSION: contract.protocol },
      input: JSON.stringify(contract),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 1_200_000,
    })
    validateReport(host, JSON.parse(output))
    return {
      host,
      outcome: 'conformant',
      protocol: contract.protocol,
      scenarios: contract.scenarios.length,
      backends: contract.backends,
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const results = runConformance(process.cwd(), process.argv[2] ? [process.argv[2]] : undefined)
    for (const result of results) console.log(JSON.stringify(result))
  } catch {
    // A native command's failure can embed its captured output and environment.
    console.error('MHP_CONFORMANCE_FAILED: invalid observations or native harness failure')
    process.exitCode = 1
  }
}
