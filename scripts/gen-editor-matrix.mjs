// M104g's per-editor conformance matrix: `npm run editor-matrix:generate`
// refreshes the evidence it can run on this machine and rewrites the receipt
// records plus `docs/ide-compatibility/matrix.md`; `check:editor-matrix`
// (`--check`) re-renders from the records and refuses any drift, without
// running a harness. A live green/failed outcome overwrites its record; a
// live pending keeps a recorded one (another machine's evidence stands)
// and writes a pending record only when none exists.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { format, resolveConfig } from 'prettier'
import { HARNESS_TIMEOUT_MS, resolveTool } from '../test/hostApi/harness.mjs'
import {
  outcomeFor,
  runConformance,
  validateReport,
  waitingLegs,
  waitsOn,
} from '../test/hostApi/run.mjs'
import {
  MATRIX_PATH,
  VSCODE_OBSERVATIONS_PATH,
  matrixHosts,
  receiptJsonPath,
  receiptMarkdownPath,
  renderMatrix,
} from './lib/editor-matrix.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isCheck = process.argv.includes('--check')

const NATIVE_HOSTS = ['jetbrains', 'visualstudio', 'eclipse', 'xcode']
const VSCODE_COMMAND = 'npx vscode-test --grep M104g (labels stable and minimum)'
const SHIM_REASON =
  'no MHP surface: the shim is excepted from MHP scenarios and qualifies via its own harness'

// Each shim's own harness, as its README runs it from the checkout root.
const SHIM_HARNESSES = {
  neovim: {
    tools: ['nvim'],
    runs: [
      ['nvim', ['--headless', '-i', 'NONE', '-u', 'NONE', '-l', 'hosts/neovim/test/check.lua']],
    ],
    version: ['nvim', ['--version']],
  },
  qtcreator: {
    tools: ['nvim', 'python3'],
    runs: [
      ['nvim', ['--headless', '-i', 'NONE', '-u', 'NONE', '-l', 'hosts/qtcreator/test/check.lua']],
      ['python3', ['-m', 'unittest', 'discover', '-s', 'hosts/qtcreator/test']],
    ],
    version: ['nvim', ['--version']],
  },
  zed: {
    tools: ['python3'],
    runs: [['python3', ['-m', 'unittest', 'discover', '-s', 'hosts/zed/test']]],
    version: ['python3', ['--version']],
  },
  sublime: {
    // The suite ran on a hand-written sublime module double and is deleted
    // (docs/real-life/unproven.md); the plugin qualifies inside Sublime Text.
    tools: [],
    runs: [],
    need: 'MHP_CONFORMANCE_PENDING: a run inside Sublime Text (the offline suite used a module double and is deleted)',
    version: ['subl', ['--version']],
  },
  emacs: {
    tools: ['emacs'],
    runs: [
      [
        'emacs',
        [
          '--batch',
          '-Q',
          '-L',
          'hosts/emacs',
          '-l',
          'hosts/emacs/test/muse-spark-test.el',
          '-f',
          'ert-run-tests-batch-and-exit',
        ],
      ],
    ],
    version: ['emacs', ['--version']],
  },
}

function provenance(command) {
  return {
    observedAt: new Date().toISOString(),
    observedOn: `${hostname()} (${platform()})`,
    command,
  }
}

function readRecord(host) {
  const file = path.join(root, receiptJsonPath(host))
  let record
  if (existsSync(file)) record = JSON.parse(readFileSync(file, 'utf8'))
  return record
}

function lastLine(output) {
  return (
    output
      .split('\n')
      .map((line) => line.trim())
      .findLast((line) => line !== '') ?? ''
  )
}

function summarizeShimOutput(output) {
  // A unittest run's verdict, or a Lua check's pass count; else the last line.
  const tests = output.match(/Ran (\d+) tests? in .*?\n\n(OK|FAILED)/)
  if (tests) return `${tests[1]} tests ${tests[2] === 'OK' ? 'OK' : 'FAILED'}`
  const passes = output.split('\n').filter((line) => line.startsWith('PASS')).length
  if (passes > 0) {
    const failures = output.split('\n').filter((line) => line.startsWith('FAIL')).length
    return `${String(passes)} PASS${failures > 0 ? `, ${String(failures)} FAIL` : ''}`
  }
  return lastLine(output)
}

function shimVersion(harness) {
  try {
    const [command, args] = harness.version
    const output = execFileSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: HARNESS_TIMEOUT_MS,
    })
    return output.split('\n', 1)[0]?.trim() ?? ''
  } catch {
    return ''
  }
}

function shimCommand(harness) {
  return harness.runs.map(([command, args]) => `${command} ${args.join(' ')}`).join(' && ')
}

function runShim(host) {
  const harness = SHIM_HARNESSES[host]
  if (harness.runs.length === 0) {
    return {
      host,
      outcome: 'pending',
      editorVersion: '',
      need: harness.need,
      provenance: provenance(''),
    }
  }
  for (const tool of harness.tools) {
    if (resolveTool(tool) === undefined) {
      return {
        host,
        outcome: 'pending',
        editorVersion: '',
        need: `MHP_CONFORMANCE_PENDING: ${tool} is not on PATH, so the ${host} harness cannot run here`,
        provenance: provenance(shimCommand(harness)),
      }
    }
  }
  const summaries = []
  for (const [command, args] of harness.runs) {
    // Captured, never inherited: a passing harness stays quiet.
    // Verdicts live on stderr (unittest) or mixed streams (nvim -l).
    const ran = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: HARNESS_TIMEOUT_MS,
    })
    if (ran.error !== undefined || ran.status !== 0) {
      const tail = lastLine(`${ran.stdout ?? ''}\n${ran.stderr ?? ''}`)
      if (tail !== '') console.warn(`matrix note: ${host} harness failed: ${tail}`)
      return {
        host,
        outcome: 'failed',
        editorVersion: '',
        error: 'MHP_CONFORMANCE_HARNESS_FAILED',
        provenance: provenance(shimCommand(harness)),
      }
    }
    summaries.push(summarizeShimOutput(`${ran.stdout ?? ''}\n${ran.stderr ?? ''}`))
  }
  return {
    host,
    outcome: 'excepted',
    editorVersion: shimVersion(harness),
    reason: SHIM_REASON,
    harness: {
      command: harness.runs.map(([command, args]) => `${command} ${args.join(' ')}`).join(' && '),
      exitCode: 0,
      summary: summaries.join('; '),
    },
    provenance: provenance(
      harness.runs.map(([command, args]) => `${command} ${args.join(' ')}`).join(' && '),
    ),
  }
}

function recordForNative(outcome, previous) {
  const editorVersion = previous?.editorVersion ?? ''
  const record = { host: outcome.host, outcome: outcome.outcome, editorVersion }
  if (outcome.outcome === 'pending') record.need = outcome.need
  else if (outcome.outcome === 'failed') record.error = outcome.error
  else {
    record.report = outcome.report
    record.waiting = outcome.waiting
  }
  record.provenance = provenance(`node test/hostApi/run.mjs ${outcome.host}`)
  return record
}

function vscodePending(previous, why) {
  if (previous !== undefined) {
    console.warn(`matrix note: vscode observations ${why}; keeping the recorded evidence`)
    return previous
  }
  return {
    host: 'vscode',
    outcome: 'pending',
    editorVersion: '',
    need: `MHP_CONFORMANCE_PENDING: vscode observations ${why}; run the vscode leg first`,
    provenance: provenance(VSCODE_COMMAND),
  }
}

function recordForVscode(previous) {
  const file = path.join(root, VSCODE_OBSERVATIONS_PATH)
  if (!existsSync(file)) return vscodePending(previous, 'are absent')
  let loaded
  try {
    loaded = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return vscodePending(previous, 'are not JSON')
  }
  let parsed
  try {
    parsed = validateReport('vscode', loaded.report)
  } catch (error) {
    const word = error instanceof Error ? (error.message.split('\n', 1)[0] ?? 'invalid') : 'invalid'
    return vscodePending(previous, `are invalid (${word})`)
  }
  const observed = loaded.provenance ?? {}
  const waiting = waitingLegs().filter((leg) => waitsOn(leg, 'vscode'))
  const editorVersion =
    previous !== undefined && previous.editorVersion !== ''
      ? previous.editorVersion
      : (observed?.vscodeVersion ?? '')
  return {
    host: 'vscode',
    outcome: outcomeFor(waiting),
    editorVersion,
    report: parsed,
    waiting,
    provenance: {
      observedAt: observed?.observedAt ?? new Date().toISOString(),
      observedOn: `${hostname()} (${platform()})`,
      command: VSCODE_COMMAND,
    },
  }
}

function keepOrWrite(host, record, previous) {
  // A live pending never clobbers another machine's recorded evidence, and
  // a recorded editor version stands until its receipt is rewritten by hand.
  if (previous !== undefined && record.outcome === 'pending') {
    console.warn(`matrix note: ${host} is pending here; keeping the recorded evidence`)
    return previous
  }
  if ((previous?.editorVersion ?? '') !== '') {
    record.editorVersion = previous.editorVersion
  }
  writeFileSync(path.join(root, receiptJsonPath(host)), `${JSON.stringify(record, null, 2)}\n`)
  return record
}

async function main() {
  const hosts = matrixHosts()
  if (isCheck) {
    const records = {}
    for (const host of hosts) {
      const file = path.join(root, receiptJsonPath(host))
      if (!existsSync(file)) {
        console.error(`matrix: ${receiptJsonPath(host)} is missing; run editor-matrix:generate`)
        process.exit(1)
      }
      if (!existsSync(path.join(root, receiptMarkdownPath(host)))) {
        console.error(`matrix: ${receiptMarkdownPath(host)} is missing; write the receipt`)
        process.exit(1)
      }
      try {
        records[host] = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        console.error(`matrix: ${receiptJsonPath(host)} is not JSON`)
        process.exit(1)
      }
    }
    let content
    try {
      content = renderMatrix(records)
    } catch (error) {
      console.error(`matrix: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    const options = (await resolveConfig(path.join(root, MATRIX_PATH))) ?? {}
    const rendered = await format(content, { ...options, parser: 'markdown' })
    const current = existsSync(path.join(root, MATRIX_PATH))
      ? readFileSync(path.join(root, MATRIX_PATH), 'utf8')
      : ''
    if (current !== rendered) {
      console.error(`matrix: ${MATRIX_PATH} is stale; run editor-matrix:generate`)
      process.exit(1)
    }
    console.log(`Matrix: ${String(hosts.length)} editors; ${MATRIX_PATH} is current`)
    return
  }
  const records = {}
  const natives = runConformance(root, NATIVE_HOSTS)
  for (const outcome of natives) {
    const previous = readRecord(outcome.host)
    records[outcome.host] = keepOrWrite(outcome.host, recordForNative(outcome, previous), previous)
  }
  for (const host of Object.keys(SHIM_HARNESSES)) {
    const previous = readRecord(host)
    records[host] = keepOrWrite(host, runShim(host), previous)
  }
  records.vscode = keepOrWrite(
    'vscode',
    recordForVscode(readRecord('vscode')),
    readRecord('vscode'),
  )
  const options = (await resolveConfig(path.join(root, MATRIX_PATH))) ?? {}
  const rendered = await format(renderMatrix(records), { ...options, parser: 'markdown' })
  writeFileSync(path.join(root, MATRIX_PATH), rendered)
  console.log(`Matrix: ${String(hosts.length)} editors; ${MATRIX_PATH} written`)
}

await main()
