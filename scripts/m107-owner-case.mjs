#!/usr/bin/env node
// M107 acceptance 15 — the owner's case, measured with real checks.
//
// Fifteen heavy checks are started against all cores twice: once with no
// governor (every check spawns at once) and once through the production
// resource governor (dist/resourceGovernor.js) with a person-set CPU
// threshold, after synthetic load trips it to throttle. The harness records
// the held concurrency (one per kind), the host event-loop delay p95 with
// and without the governor, and a second host's activation time.
//
// Each check is a real bundle-verification pass over twelve production
// entries: it fails non-zero when the product is broken (red-drilled in
// docs/certification/rlf-m107.md). The ambient warm-up load is synthetic
// CPU work in real child processes, labelled as such in the receipt.
//
// Usage:
//   node scripts/m107-owner-case.mjs [--phase a|b|all] [--checks N]
//     [--cpu-threshold P] [--burners N] [--engage-timeout-ms MS]
//     [--receipt PATH]
//   node scripts/m107-owner-case.mjs --check  # one heavy check (child mode)
//   node scripts/m107-owner-case.mjs --burn S # synthetic CPU load (child mode)
//   node scripts/m107-owner-case.mjs --probe  # second-host activation (child)

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { clearTimeout as clearTimer } from 'node:timers'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const scriptPath = fileURLToPath(import.meta.url)
const repoRoot = path.dirname(path.dirname(scriptPath))
const governorBundle = path.join(repoRoot, 'dist', 'resourceGovernor.js')

// Twelve production node entries. Each check bundles every one standalone
// (platform node, vscode external, in memory): real build work that fails
// when an entry or anything it reaches is broken.
const CHECK_ENTRIES = [
  'src/extension.ts',
  'src/host/backend/modelApiEntry.ts',
  'src/host/backend/museCodeEntry.ts',
  'src/core/resources/resourceGovernorEntry.ts',
  'src/runtime/exec/runExec.ts',
  'src/acp/agent.ts',
  'src/host/conversation/conversationEntry.ts',
  'src/runtime/reporting/reportsEntry.ts',
  'src/core/team/teamEntry.ts',
  'src/host/backend/providersEntry.ts',
  'src/host/review/reviewEntry.ts',
  'src/runtime/sharing/sharingEntry.ts',
]

// Harness bounds. The product's own windows (5 s samples, a 30 s trip, a
// 60 s dwell) stay fixed in src/shared/constants.ts; these bound the
// harness itself so a stuck child or a rig that never trips ends the run
// with a named failure instead of hanging it.
const CHILD_TIMEOUT_MS = 120_000
const KILL_GRACE_MS = 5000
const TRACE_MS = 1000
const COOLDOWN_CPU_PERCENT = 30
const COOLDOWN_TIMEOUT_MS = 90_000
const BURN_SECONDS = 150
const EVENT_LOOP_RESOLUTION_MS = 10
const NS_PER_MS = 1_000_000

const liveChildren = new Set()

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadGovernorBundle() {
  if (!fs.existsSync(governorBundle)) {
    throw new Error(`missing ${governorBundle}: run npm run build first`)
  }
  return require(governorBundle)
}

// One window's machine settings: the governor on, relocation off (this
// harness wires no relocation route), and exactly one person-set limit —
// the CPU threshold — or none at all for the measure-only host.
function windowSettings(cpuThreshold) {
  return (key) => {
    if (key === 'resourceGovernor') return { globalValue: true }
    if (key === 'resourceCpuMaxPercent') return { globalValue: cpuThreshold }
    return key === 'resourceRelocate' ? { globalValue: 'off' } : {}
  }
}

function terminate(child) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // Already gone; the exit below still reports it.
      }
    }, KILL_GRACE_MS)
    child.once('exit', () => {
      clearTimer(timer)
      resolve()
    })
    // An already-exited child never emits 'exit' again: a late listener
    // would hang until the loop drains (D1 drill, exit 13). The check sits
    // after the listener so a child that exits in between still resolves.
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimer(timer)
      resolve()
      return
    }
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone; the exit handler resolves.
    }
  })
}

function spawnHarnessChild(args) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  })
  liveChildren.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const raw = new Promise((resolve) => {
    const timer = setTimeout(() => {
      void terminate(child).then(() => {
        resolve({ exitCode: null, timedOut: true, stdout, stderr })
      })
    }, CHILD_TIMEOUT_MS)
    timer.unref()
    child.once('exit', (code) => {
      clearTimer(timer)
      resolve({ exitCode: code, timedOut: false, stdout, stderr })
    })
    child.once('error', (error) => {
      clearTimer(timer)
      resolve({ exitCode: null, timedOut: false, stdout, stderr, spawnError: String(error) })
    })
  })
  return { child, done: trackChild(raw, child) }
}

async function trackChild(raw, child) {
  try {
    return await raw
  } finally {
    liveChildren.delete(child)
  }
}

function lastJsonLine(stdout) {
  const lines = stdout.trim().split('\n')
  const last = lines.at(-1)
  if (last === undefined || last === '') return
  try {
    return JSON.parse(last)
  } catch {
    return
  }
}

function nsToMs(ns) {
  return Math.round((ns / NS_PER_MS) * 1000) / 1000
}

function eventLoopSummary(histogram) {
  if (histogram.count === 0) return null
  return {
    // Values include the sampling quantum; phases share it, so the
    // contrast between them is the measurement.
    quantumMs: EVENT_LOOP_RESOLUTION_MS,
    count: histogram.count,
    p50Ms: nsToMs(histogram.percentile(50)),
    p95Ms: nsToMs(histogram.percentile(95)),
    p99Ms: nsToMs(histogram.percentile(99)),
    meanMs: nsToMs(histogram.mean),
    maxMs: nsToMs(histogram.max),
  }
}

// One heavy check: bundle-verify the twelve production entries in memory.
async function modeCheck() {
  const started = Date.now()
  const esbuild = require('esbuild')
  let bytes = 0
  for (const entry of CHECK_ENTRIES) {
    const result = esbuild.buildSync({
      entryPoints: [path.join(repoRoot, entry)],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['vscode'],
      write: false,
      logLevel: 'silent',
    })
    for (const file of result.outputFiles) bytes += file.contents.length
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('empty bundle output')
  console.log(JSON.stringify({ bytes, ms: Date.now() - started }))
}

// Synthetic ambient load: real SHA-256 computation in a real child,
// standing in for other agents' work while the governor trips.
async function modeBurn(seconds) {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('bad burn seconds')
  const deadline = Date.now() + seconds * 1000
  let hashes = 0
  let input = 0
  while (Date.now() < deadline) {
    createHash('sha256').update(String(input++)).digest()
    hashes += 1
  }
  console.log(JSON.stringify({ hashes }))
}

// A second window's activation on this headless rig: a fresh process loads
// the production governor bundle and completes one foreground admission.
// Prints one JSON line; diagnostics stay on stderr.
async function modeProbe() {
  const started = Date.now()
  const { resourceGovernorHost } = loadGovernorBundle()
  const host = resourceGovernorHost({
    inspect: windowSettings(null),
    onError: (error) => {
      throw error instanceof Error ? error : new Error(String(error))
    },
  })
  try {
    const lease = await host.admit('check', undefined, 'foreground', false, undefined, true)
    const level = host.status().level
    lease.complete(true)
    console.log(JSON.stringify({ elapsedMs: Date.now() - started, level }))
  } finally {
    host.dispose()
  }
}

async function runProbeChild() {
  const started = Date.now()
  const { done } = spawnHarnessChild(['--probe'])
  const outcome = await done
  const parsed = lastJsonLine(outcome.stdout)
  return {
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    wallMs: Date.now() - started,
    elapsedMs: typeof parsed?.elapsedMs === 'number' ? parsed.elapsedMs : null,
    level: typeof parsed?.level === 'string' ? parsed.level : null,
    stderrTail: outcome.stderr.trim().split('\n').slice(-3).join('\n'),
  }
}

// One trace row per second: the production sampler's CPU reading and the
// governor's level. Runs until stop.value turns true.
async function traceLoop(host, stop, errors) {
  const rows = []
  const started = Date.now()
  for (;;) {
    if (stop.value) return rows
    try {
      const status = await host.refreshStatus()
      rows.push({
        tMs: Date.now() - started,
        level: status.level,
        cpuPercent: status.sample?.cpuPercent ?? null,
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      return rows
    }
    await sleep(TRACE_MS)
  }
}

function transitionsOf(rows) {
  const transitions = []
  for (const [index, row] of rows.entries()) {
    if (index === 0) continue
    const previous = rows[index - 1]
    if (previous !== undefined && previous.level !== row.level) {
      transitions.push({ tMs: row.tMs, from: previous.level, to: row.level })
    }
  }
  return transitions
}

function peakCpu(rows) {
  let peak = null
  for (const row of rows) {
    if (row.cpuPercent !== null && (peak === null || row.cpuPercent > peak)) peak = row.cpuPercent
  }
  return peak
}

async function waitForLevel(host, level, timeoutMs) {
  const started = Date.now()
  for (;;) {
    const status = await host.refreshStatus()
    if (status.level === level) return { engaged: true, afterMs: Date.now() - started }
    if (Date.now() - started >= timeoutMs) {
      return { engaged: false, afterMs: Date.now() - started, level: status.level }
    }
    await sleep(TRACE_MS)
  }
}

// Phase A: no governor. All checks spawn at once against all cores while a
// measure-only host (no person-set limit) records the load it observes.
async function phaseWithoutGovernor(options, record) {
  const { resourceGovernorHost } = loadGovernorBundle()
  const errors = []
  const host = resourceGovernorHost({
    inspect: windowSettings(null),
    onError: (error) => {
      errors.push(error instanceof Error ? error.message : String(error))
    },
  })
  const stop = { value: false }
  const tracing = traceLoop(host, stop, errors)
  const histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS })
  histogram.enable()
  const started = Date.now()
  let running = 0
  let maxRunning = 0
  let isProbeLaunched = false
  let peakProbe = null
  try {
    const outcomes = await Promise.all(
      Array.from({ length: options.checks }, (_, id) =>
        (async () => {
          const launched = spawnHarnessChild(['--check'])
          running += 1
          if (running > maxRunning) maxRunning = running
          if (!isProbeLaunched && running === options.checks) {
            isProbeLaunched = true
            peakProbe = runProbeChild()
          }
          const outcome = await launched.done
          running -= 1
          const parsed = lastJsonLine(outcome.stdout)
          return {
            id,
            exitCode: outcome.exitCode,
            timedOut: outcome.timedOut,
            bytes: typeof parsed?.bytes === 'number' ? parsed.bytes : null,
            checkMs: typeof parsed?.ms === 'number' ? parsed.ms : null,
            stderrTail: outcome.exitCode === 0 ? '' : outcome.stderr.trim().slice(-500),
          }
        })(),
      ),
    )
    const wallMs = Date.now() - started
    const probe = peakProbe === null || !isProbeLaunched ? null : await peakProbe
    histogram.disable()
    stop.value = true
    const trace = await tracing
    const failed = outcomes.filter((outcome) => outcome.exitCode !== 0)
    record('A-checks-pass', failed.length === 0, { failed: failed.map((row) => row.id) })
    record('A-concurrent', maxRunning === options.checks, { maxRunning, checks: options.checks })
    if (options.cooldown) await cooldown(host)
    const settings = host.status().settings
    return {
      wallMs,
      maxRunning,
      settings,
      checks: outcomes,
      eventLoopMs: eventLoopSummary(histogram),
      cpuTrace: trace,
      peakCpuPercent: peakCpu(trace),
      probeAtPeak: probe,
      hostErrors: errors,
    }
  } finally {
    histogram.disable()
    stop.value = true
    host.dispose()
  }
}

async function cooldown(host) {
  const started = Date.now()
  for (;;) {
    const status = await host.refreshStatus()
    const cpu = status.sample?.cpuPercent
    if (cpu !== null && cpu !== undefined && cpu < COOLDOWN_CPU_PERCENT) return
    if (Date.now() - started >= COOLDOWN_TIMEOUT_MS) return
    await sleep(TRACE_MS * 5)
  }
}

// Phase B: the governor. Synthetic load trips the production governor to
// throttle; then all checks are submitted at once through background 'check'
// admission, and the harness watches the governor hold one per kind.
async function phaseWithGovernor(options, record) {
  const { resourceGovernorHost } = loadGovernorBundle()
  const errors = []
  const host = resourceGovernorHost({
    inspect: windowSettings(options.cpuThreshold),
    onError: (error) => {
      errors.push(error instanceof Error ? error.message : String(error))
    },
  })
  const burners = []
  try {
    for (let index = 0; index < options.burners; index += 1) {
      burners.push(spawnHarnessChild(['--burn', String(BURN_SECONDS)]))
    }
    const trip = await waitForLevel(host, 'throttle', options.engageTimeoutMs)
    record('B-throttle-engaged', trip.engaged, trip)
    if (!trip.engaged) {
      return { engaged: false, trip, settings: host.status().settings, hostErrors: errors }
    }
    const levelAtSubmit = host.status().level
    record('B-submit-at-throttle', levelAtSubmit === 'throttle', { levelAtSubmit })
    for (const burner of burners) await terminate(burner.child)
    const stop = { value: false }
    const tracing = traceLoop(host, stop, errors)
    const histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS })
    histogram.enable()
    const started = Date.now()
    let running = 0
    let maxRunning = 0
    let maxWhileNonNormal = 0
    let grants = 0
    let isProbeLaunched = false
    let midProbe = null
    try {
      const settled = await Promise.allSettled(
        Array.from({ length: options.checks }, (_, id) =>
          (async () => {
            const lease = await host.admit('check', undefined, 'background', true, undefined, true)
            grants += 1
            if (grants === 3 && !isProbeLaunched) {
              isProbeLaunched = true
              midProbe = runProbeChild()
            }
            const levelAtGrant = host.status().level
            const launched = spawnHarnessChild(['--check'])
            if (launched.child.pid !== undefined) lease.register({ pid: launched.child.pid })
            running += 1
            if (running > maxRunning) maxRunning = running
            if (levelAtGrant !== 'normal' && running > maxWhileNonNormal) {
              maxWhileNonNormal = running
            }
            const outcome = await launched.done
            running -= 1
            if (outcome.exitCode !== 0) lease.failed()
            lease.complete(true)
            const parsed = lastJsonLine(outcome.stdout)
            return {
              id,
              exitCode: outcome.exitCode,
              timedOut: outcome.timedOut,
              levelAtGrant,
              bytes: typeof parsed?.bytes === 'number' ? parsed.bytes : null,
              checkMs: typeof parsed?.ms === 'number' ? parsed.ms : null,
              stderrTail: outcome.exitCode === 0 ? '' : outcome.stderr.trim().slice(-500),
            }
          })(),
        ),
      )
      const wallMs = Date.now() - started
      const probe = midProbe === null || !isProbeLaunched ? null : await midProbe
      histogram.disable()
      stop.value = true
      const trace = await tracing
      const transitions = transitionsOf(trace)
      const outcomes = []
      const rejected = []
      for (const entry of settled) {
        if (entry.status === 'fulfilled') outcomes.push(entry.value)
        else
          rejected.push(entry.reason instanceof Error ? entry.reason.message : String(entry.reason))
      }
      const failed = outcomes.filter((outcome) => outcome.exitCode !== 0)
      record('B-checks-pass', failed.length === 0 && rejected.length === 0, {
        failed: failed.map((row) => row.id),
        rejected,
      })
      record('B-one-per-kind', maxWhileNonNormal <= 1, {
        maxWhileNonNormal,
        maxRunning,
        grants,
      })
      record('B-held-throttle', transitions.length === 0, { transitions })
      return {
        engaged: true,
        trip,
        levelAtSubmit,
        wallMs,
        maxRunning,
        maxWhileNonNormal,
        grants,
        settings: host.status().settings,
        checks: outcomes,
        eventLoopMs: eventLoopSummary(histogram),
        cpuTrace: trace,
        peakCpuPercent: peakCpu(trace),
        transitions,
        probeUnderGovernor: probe,
        hostErrors: errors,
      }
    } finally {
      histogram.disable()
      stop.value = true
    }
  } finally {
    for (const burner of burners) await terminate(burner.child)
    host.dispose()
  }
}

async function measureBaselineCpu() {
  const { resourceGovernorHost } = loadGovernorBundle()
  const errors = []
  const host = resourceGovernorHost({
    inspect: windowSettings(null),
    onError: (error) => {
      errors.push(error instanceof Error ? error.message : String(error))
    },
  })
  try {
    await host.refreshStatus()
    await sleep(TRACE_MS * 5 + 500)
    const status = await host.refreshStatus()
    if (errors.length > 0) throw new Error(`baseline sampler error: ${errors[0]}`)
    return status.sample?.cpuPercent ?? null
  } finally {
    host.dispose()
  }
}

function machineFacts() {
  const cpus = os.cpus()
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    model: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    totalMemBytes: os.totalmem(),
    loadavg: os.loadavg(),
    node: process.version,
    uv: process.versions.uv,
  }
}

function printSummary(receipt) {
  console.log(
    `machine: ${receipt.machine.model} x${receipt.machine.cores}, ${(receipt.machine.totalMemBytes / 1024 ** 3).toFixed(1)} GiB, ${receipt.machine.platform}/${receipt.machine.arch} ${receipt.machine.release}, node ${receipt.machine.node} (uv ${receipt.machine.uv})`,
  )
  console.log(
    `baseline cpu: ${receipt.baselineCpuPercent ?? 'unknown'}%, idle probes: ${(receipt.idleProbesMs ?? []).join(', ')} ms`,
  )
  if (receipt.phaseA !== null) {
    const phase = receipt.phaseA
    console.log(
      `phase A (no governor): ${phase.checks.length} checks in ${phase.wallMs} ms, max concurrent ${phase.maxRunning}, peak cpu ${phase.peakCpuPercent ?? '?'}%`,
    )
    console.log(
      `  event loop: p50 ${phase.eventLoopMs?.p50Ms} ms, p95 ${phase.eventLoopMs?.p95Ms} ms, p99 ${phase.eventLoopMs?.p99Ms} ms, max ${phase.eventLoopMs?.maxMs} ms (${phase.eventLoopMs?.count} samples)`,
    )
    console.log(
      `  probe at peak: ${phase.probeAtPeak?.elapsedMs ?? '?'} ms (exit ${phase.probeAtPeak?.exitCode ?? '?'})`,
    )
  }
  if (receipt.phaseB !== null) {
    const phase = receipt.phaseB
    if (phase.engaged) {
      console.log(
        `phase B (governor, cpu ${receipt.settings.cpuThreshold}%): ${phase.checks.length} checks in ${phase.wallMs} ms, max concurrent ${phase.maxRunning} overall and ${phase.maxWhileNonNormal} while throttled, throttle held: ${phase.transitions.length === 0}`,
      )
      console.log(
        `  event loop: p50 ${phase.eventLoopMs?.p50Ms} ms, p95 ${phase.eventLoopMs?.p95Ms} ms, p99 ${phase.eventLoopMs?.p99Ms} ms, max ${phase.eventLoopMs?.maxMs} ms (${phase.eventLoopMs?.count} samples)`,
      )
      console.log(
        `  probe under governor: ${phase.probeUnderGovernor?.elapsedMs ?? '?'} ms (exit ${phase.probeUnderGovernor?.exitCode ?? '?'})`,
      )
    } else {
      console.log(`phase B (governor): throttle never engaged (${JSON.stringify(phase.trip)})`)
    }
  }
  for (const assertion of receipt.assertions) {
    console.log(
      `${assertion.ok ? 'PASS' : 'FAIL'} ${assertion.name} ${assertion.ok ? '' : JSON.stringify(assertion.detail)}`,
    )
  }
  console.log(receipt.pass ? 'OWNER CASE PASS' : 'OWNER CASE FAIL')
}

async function orchestrate(options) {
  const assertions = []
  const record = (name, ok, detail) => {
    assertions.push({ name, ok, detail })
  }
  console.log('measuring baseline cpu...')
  const baselineCpuPercent = await measureBaselineCpu()
  console.log(`baseline cpu: ${baselineCpuPercent ?? 'unknown'}%`)
  const idleProbes = []
  if (options.phase === 'all') {
    for (let index = 0; index < 3; index += 1) {
      const probe = await runProbeChild()
      if (probe.exitCode === 0 && probe.elapsedMs !== null) idleProbes.push(probe.elapsedMs)
    }
    console.log(`idle probes: ${idleProbes.join(', ')} ms`)
  }
  let phaseA = null
  let phaseB = null
  if (options.phase !== 'b') {
    console.log(`phase A: ${options.checks} checks, no governor...`)
    phaseA = await phaseWithoutGovernor({ ...options, cooldown: options.phase === 'all' }, record)
    console.log(
      `phase A done: max concurrent ${phaseA.maxRunning}, p95 ${phaseA.eventLoopMs?.p95Ms} ms`,
    )
  }
  if (options.phase !== 'a') {
    console.log(`phase B: governor at cpu ${options.cpuThreshold}%, ${options.burners} burners...`)
    phaseB = await phaseWithGovernor(options, record)
    console.log(`phase B done: engaged ${phaseB.engaged}`)
  }
  const receipt = {
    lane: 'RLF-M107',
    acceptance: 15,
    at: new Date().toISOString(),
    machine: machineFacts(),
    settings: {
      kind: 'check',
      class: 'background',
      checks: options.checks,
      cpuThreshold: options.cpuThreshold,
      burners: options.burners,
      engageTimeoutMs: options.engageTimeoutMs,
    },
    baselineCpuPercent,
    idleProbesMs: idleProbes,
    phaseA,
    phaseB,
    assertions,
    pass: assertions.every((assertion) => assertion.ok),
  }
  const receiptPath = options.receipt ?? defaultReceiptPath()
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true })
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  console.log(`receipt: ${receiptPath}`)
  printSummary(receipt)
  return receipt.pass ? 0 : 1
}

function defaultReceiptPath() {
  const stamp = new Date().toISOString().replaceAll(':', '-')
  return path.join(repoRoot, 'temp', 'rlf-m107', `owner-case-${stamp}.json`)
}

function checkCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error('bad --checks')
  return value
}

function cpuThreshold(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new Error('bad --cpu-threshold')
  }
  return value
}

function burnerCount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) throw new Error('bad --burners')
  return value
}

function timeoutMs(value) {
  if (!Number.isSafeInteger(value) || value < 1000) throw new Error('bad --engage-timeout-ms')
  return value
}

function phaseName(value) {
  if (value !== 'a' && value !== 'b' && value !== 'all') throw new Error('bad --phase')
  return value
}

const ARG_HANDLERS = {
  '--phase': {
    takesValue: true,
    apply: (options, value) => ({ ...options, phase: phaseName(value) }),
  },
  '--checks': {
    takesValue: true,
    apply: (options, value) => ({ ...options, checks: checkCount(Number(value)) }),
  },
  '--cpu-threshold': {
    takesValue: true,
    apply: (options, value) => ({ ...options, cpuThreshold: cpuThreshold(Number(value)) }),
  },
  '--burners': {
    takesValue: true,
    apply: (options, value) => ({ ...options, burners: burnerCount(Number(value)) }),
  },
  '--engage-timeout-ms': {
    takesValue: true,
    apply: (options, value) => ({ ...options, engageTimeoutMs: timeoutMs(Number(value)) }),
  },
  '--receipt': {
    takesValue: true,
    apply: (options, value) => ({ ...options, receipt: path.resolve(value) }),
  },
  '--help': { takesValue: false, apply: (options) => ({ ...options, help: true }) },
  '-h': { takesValue: false, apply: (options) => ({ ...options, help: true }) },
}

function parseArgs(argv) {
  let options = {
    phase: 'all',
    checks: 15,
    cpuThreshold: 60,
    burners: 10,
    engageTimeoutMs: 240_000,
    receipt: null,
  }
  let index = 0
  while (index < argv.length) {
    const arg = argv[index]
    const [flag, inline] = arg.split('=', 2)
    const handler = ARG_HANDLERS[flag]
    if (flag === undefined || handler === undefined) throw new Error(`unknown argument: ${arg}`)
    index += 1
    if (!handler.takesValue) {
      options = handler.apply(options, '')
      continue
    }
    let value = inline
    if (value === undefined) {
      value = argv[index]
      if (value === undefined) throw new Error(`missing value for ${flag}`)
      index += 1
    }
    options = handler.apply(options, value)
  }
  return options
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv[0] === '--check' && argv.length === 1) {
    await modeCheck()
    return 0
  }
  if (argv[0] === '--burn' && argv.length === 2 && argv[1] !== undefined) {
    await modeBurn(Number(argv[1]))
    return 0
  }
  if (argv[0] === '--probe' && argv.length === 1) {
    await modeProbe()
    return 0
  }
  const options = parseArgs(argv)
  if (options.help === true) {
    console.log(
      'usage: node scripts/m107-owner-case.mjs [--phase a|b|all] [--checks N] [--cpu-threshold P] [--burners N] [--engage-timeout-ms MS] [--receipt PATH]',
    )
    return 0
  }
  return await orchestrate(options)
}

process.on('SIGINT', () => {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
  process.exit(130)
})
process.on('SIGTERM', () => {
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }
  process.exit(143)
})

let exitCode
try {
  exitCode = await main()
} catch (error) {
  console.error(`owner case failed: ${error instanceof Error ? error.message : String(error)}`)
  exitCode = 1
}
for (const child of liveChildren) await terminate(child)
process.exit(exitCode)
