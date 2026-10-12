import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENVIRONMENT_GATED_SUITES, EXPECTED_ENVIRONMENT_SKIPS } from './helpers/environmentSkips'

// Condition fragments that probe an installed tool. A suite gating on one
// must be registered in environmentSkips.ts; env-var, platform and live
// probes are out of scope here (see that file).
const TOOL_TOKENS = [
  'BUN',
  'bunPath(',
  'windowsPowerShell(',
  'findBash(',
  'HAS_PLUGIN_NODE',
  'hasPluginNode(',
]

function testFiles(folder: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(folder)) {
    const file = path.join(folder, entry)
    if (statSync(file).isDirectory()) found.push(...testFiles(file))
    else if (/\.test\.(ts|tsx|mjs)$/.test(entry)) found.push(file)
  }
  return found
}

const byName = (left: string, right: string): number => left.localeCompare(right)

describe('environment-gated suites', () => {
  it('registers every tool-gated suite, so none can start skipping unnoticed', () => {
    const registered = new Set(ENVIRONMENT_GATED_SUITES.map((entry) => entry.file))
    const unregistered: string[] = []
    for (const file of [...testFiles('test/unit'), ...testFiles('test/e2e')]) {
      const relative = path.relative(process.cwd(), file).replaceAll('\\', '/')
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        // Every gating condition in the tree sits on one line; a condition
        // naming a tool detector must be registered, whatever else the file
        // mentions. Platform, opt-in and live probes never match.
        const condition = /\.(?:runIf|skipIf)\((.*)\)/.exec(line)?.[1]
        if (condition === undefined || TOOL_TOKENS.every((token) => !condition.includes(token)))
          continue
        if (!registered.has(relative)) unregistered.push(`${relative}: ${condition.trim()}`)
      }
    }
    expect(unregistered).toEqual([])
    for (const entry of ENVIRONMENT_GATED_SUITES) {
      expect(readFileSync(entry.file, 'utf8').includes(entry.suite)).toBe(true)
    }
  })

  it('skips exactly the registered-and-absent set on this machine', () => {
    const actual = ENVIRONMENT_GATED_SUITES.filter((entry) => !entry.present())
      .map((entry) => entry.suite)
      .toSorted(byName)
    process.stdout.write(`[env-skips] ${process.platform}: ${actual.join('; ') || 'none'}\n`)
    const expected = EXPECTED_ENVIRONMENT_SKIPS[process.platform]
    expect(expected, `no expected skip list for ${process.platform}: add one`).toBeDefined()
    expect(actual).toEqual([...(expected ?? [])].toSorted(byName))
  })
})
