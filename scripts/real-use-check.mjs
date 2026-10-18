#!/usr/bin/env node
// The real-use check: judges one finished run with no key anywhere. It reads
// the launcher's out folder and the steps file, re-validates every step
// result with the Action's own result module, and exits 1 naming every failed
// check: a step that is not PASS, calls or dollars that do not sum or that
// pass the stated inputs, a transcript bound to another commit or package, a
// fired startup trap, or a key-shaped or sentinel string in any published
// file (file names only, never the matching text).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  checkNoLeak,
  checkRealUseRun,
  checkTraps,
  parseFlagArgs,
  parseStepsFile,
  RealUseInputError,
  resolveStepsFile,
  resolveWithin,
} from './lib/real-use.mjs'

const WANTED_FLAGS = [
  '--run-dir',
  '--ref-root',
  '--steps-file',
  '--expected-calls',
  '--max-budget-usd',
  '--ref-commit',
  '--package-sha256',
  '--traps-dir',
]

function usageError(message) {
  process.stderr.write(`real-use-check: ${message}\n`)
  process.exitCode = 2
}

function readOptions(argv) {
  try {
    return parseFlagArgs(argv, WANTED_FLAGS)
  } catch (error) {
    usageError(error instanceof RealUseInputError ? error.message : 'arguments unreadable')
    usageError(
      'real-use-check --run-dir <dir> --ref-root <dir> --steps-file <path> --expected-calls <n> --max-budget-usd <usd> --ref-commit <sha> --package-sha256 <hex> --traps-dir <dir> (sentinel arrives as RU_SENTINEL)',
    )
    return null
  }
}

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name)
    return statSync(file).isDirectory() ? filesUnder(file) : [file]
  })
}

function main() {
  const options = readOptions(process.argv.slice(2))
  if (options === null) return
  const expectedCalls = Number(options.expectedCalls)
  if (!Number.isSafeInteger(expectedCalls) || expectedCalls < 1 || expectedCalls > 500) {
    usageError('expected-calls is an integer 1 to 500')
    return
  }
  let transcript
  let steps
  try {
    const transcriptPath = resolveWithin(options.runDir, 'transcript.json', 'transcript')
    transcript = JSON.parse(readFileSync(transcriptPath, 'utf8'))
    steps = parseStepsFile(
      readFileSync(resolveStepsFile(options.refRoot, options.stepsFile), 'utf8'),
    )
  } catch (error) {
    usageError(
      error instanceof RealUseInputError || error instanceof SyntaxError
        ? error.message
        : 'inputs unreadable',
    )
    return
  }
  const failures = [
    ...checkRealUseRun({
      runDir: options.runDir,
      transcript,
      steps,
      stated: {
        calls: expectedCalls,
        budgetUsd: options.maxBudgetUsd,
        refCommit: options.refCommit,
      },
    }).failures,
  ]
  if (transcript.packageSha256 !== options.packageSha256) {
    failures.push('transcript package is not the verified tarball')
  }
  const sentinel = process.env.RU_SENTINEL ?? ''
  try {
    failures.push(...checkTraps(options.trapsDir))
  } catch {
    failures.push('traps folder unreadable')
  }
  try {
    failures.push(...checkNoLeak(filesUnder(options.runDir), options.runDir, 'out', sentinel))
  } catch {
    failures.push('run folder unreadable')
  }
  if (failures.length === 0) return
  for (const failure of failures) process.stderr.write(`real-use-check: ${failure}\n`)
  process.exitCode = 1
}

main()
