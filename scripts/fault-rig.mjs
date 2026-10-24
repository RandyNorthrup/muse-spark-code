#!/usr/bin/env node
// M110r Y4: run the fault-injection scenarios. `list` names them, `run
// <name>` runs one, `all` runs every runnable one, `probe` reports the
// namespace requirement. Exits 0 when every run scenario passes, 1 on a
// failed assertion or bad usage, 2 when the environment refuses a needed
// scenario. Scenarios live in test/faults/scenarios/.

import path from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { FAULT_EXIT, FaultAssertion, loadScenario } from './lib/faultRig.mjs'

const SCENARIOS = [
  's1-stream-cut',
  's2-compaction-cut',
  's3-renumber',
  's4-partition',
  's5-redelivery',
]

function usage() {
  return `usage: fault-rig.mjs <list|run <name>|all|probe>\nscenarios: ${SCENARIOS.join(', ')}`
}

async function loadNamedScenario(repoRoot, name) {
  if (!SCENARIOS.includes(name)) throw new FaultAssertion(`unknown scenario: ${name}`)
  return await loadScenario(repoRoot, name)
}

// One scenario's watchdog: five minutes, then failed instead of hung.
async function runBounded(scenario, repoRoot) {
  let timer
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new FaultAssertion(`${scenario.name}: timed out after 5 minutes`))
    }, 300_000)
  })
  try {
    await Promise.race([scenario.run(repoRoot), watchdog])
  } finally {
    clearTimeout(timer)
  }
}

async function main(argv, repoRoot) {
  const [command, name] = argv
  if (command === 'list') {
    for (const scenario of SCENARIOS) process.stdout.write(`${scenario}\n`)
    return FAULT_EXIT.pass
  }
  if (command === 'probe') {
    const { probeNamespaces } = await import('./lib/faultRig.mjs')
    const probe = await probeNamespaces()
    process.stdout.write(
      probe.ok ? 'namespaces: available\n' : `namespaces: refused: ${probe.reason}\n`,
    )
    return FAULT_EXIT.pass
  }
  if (command === 'run') {
    if (name === undefined) {
      process.stderr.write(`${usage()}\n`)
      return FAULT_EXIT.fail
    }
    const scenario = await loadNamedScenario(repoRoot, name)
    await runBounded(scenario, repoRoot)
    process.stdout.write(`${name}: PASS\n`)
    return FAULT_EXIT.pass
  }
  if (command === 'all') {
    let hasFailed = false
    let hasRefused = false
    for (const scenarioName of SCENARIOS) {
      const scenario = await loadNamedScenario(repoRoot, scenarioName)
      try {
        await runBounded(scenario, repoRoot)
        process.stdout.write(`${scenarioName}: PASS\n`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        // Name-based: the bundle carries its own copy of the classes.
        if (error instanceof Error && error.name === 'FaultRefused') {
          hasRefused = true
          process.stdout.write(`${scenarioName}: REFUSED: ${detail}\n`)
        } else {
          hasFailed = true
          process.stdout.write(`${scenarioName}: FAIL: ${detail}\n`)
        }
      }
    }
    if (hasFailed) return FAULT_EXIT.fail
    return hasRefused ? FAULT_EXIT.refused : FAULT_EXIT.pass
  }
  process.stderr.write(`${usage()}\n`)
  return FAULT_EXIT.fail
}

// The module's own folder as a path: a URL's pathname keeps a leading slash
// before a Windows drive (`/C:/…`), which path.resolve doubles to `C:\C:\…`.
const repoRoot = path.resolve(import.meta.dirname, '..')
try {
  process.exitCode = await main(process.argv.slice(2), repoRoot)
} catch (error) {
  // Name-based: the bundle carries its own copy of the classes.
  if (error instanceof Error && error.name === 'FaultRefused') {
    process.stderr.write(`refused: ${error.message}\n`)
    process.exitCode = FAULT_EXIT.refused
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = FAULT_EXIT.fail
  }
}
