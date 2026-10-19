// Release-only registry publishing. No token in arguments or captured CLI output in logs.
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { targetOfVsix } from './lib/vsixTargets.mjs'

// The declared bin of pinned ovsx 1.2.0, run through Node without a shell shim.
// Static resolution also lets the dependency gate see the actual tool use.
const require = createRequire(import.meta.url)
const OVSX_CLI = require.resolve('ovsx/bin/ovsx')
const BACKOFF_MS = [20_000, 60_000]
// Registry visibility after a successful publish lags (npm took 19 minutes
// for 0.16.0): poll the same fixed endpoints verifyPublished reads, backing
// off, for 30 minutes in total, shared across every artifact of the run.
// The publish jobs' timeout-minutes must cover all publishes plus this poll.
const VISIBILITY_TIMEOUT_MS = 30 * 60_000
const VISIBILITY_BASE_DELAY_MS = 30_000
const VISIBILITY_MAX_DELAY_MS = 120_000
// All registry hostnames are fixed and valid, so ENOTFOUND is transient DNS.
const NETWORK_ERROR =
  /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|ENOTFOUND|E502|E503|E504|TimeoutError)\b|\b(?:HTTP|status(?:\s*code)?)\s*[:=]?\s*(?:502|503|504)\b|Failed request:\s*\((?:502|503|504)\)|socket hang up/i
const EXISTS_ERROR =
  /already (?:published|exists)|already been published|cannot publish over|EPUBLISHCONFLICT|version[^\n]*already/i
const OPEN_VSX = z.object({ files: z.object({ download: z.url() }) })
const INTEGRITY = z.string().regex(/^sha512-[A-Za-z\d+/]+={0,2}$/)
const FETCH_TIMEOUT_MS = 60_000

function diagnostic(error) {
  return error instanceof Error
    ? `${error.name} ${error.message} ${String(error.code ?? '')} ${String(error.cause?.code ?? '')} ${String(error.stdout ?? '')} ${String(error.stderr ?? '')}`
    : ''
}

// A failed publish is reported by one of these fixed labels, never by the
// CLI's own text (which may carry credentials); the first match wins.
const FAILURE_REASONS = [
  [/differs from the release|must use HTTPS/, 'the published artifact does not match the release'],
  [/\bEOTP\b|one-time pass/i, 'npm asks for a one-time password (EOTP): see docs/RELEASING.md'],
  [/\bENEEDAUTH\b|\bE401\b|\b401\b|Unauthorized/i, 'the token was refused (401)'],
  [/\bE403\b|\b403\b|Forbidden/i, 'the token lacks permission (403)'],
  [/\bE404\b|\b404\b/, 'the registry answered not found (404)'],
]

/** The fixed label for why a publish failed. */
export function failureReason(error) {
  const text = diagnostic(error)
  return NETWORK_ERROR.test(text)
    ? 'network attempts exhausted'
    : (FAILURE_REASONS.find(([pattern]) => pattern.test(text))?.[1] ?? 'publication refused')
}

export async function retryNetwork(action, sleep = setTimeout) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action()
    } catch (error) {
      if (attempt >= BACKOFF_MS.length || !NETWORK_ERROR.test(diagnostic(error))) {
        throw error
      }
      await sleep(BACKOFF_MS[attempt])
    }
  }
}

// Fixed repository tools, argument arrays, no shell; secrets stay in their step environment.
function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function response(url, fetcher) {
  const reply = await fetcher(url, { signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!reply.ok) {
    throw new Error(`HTTP ${reply.status} while checking published artifact`)
  }
  return reply
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** npm's registry SRI, or the actual registry VSIX bytes (including gallery gzip). */
export async function verifyPublished(channel, artifact, manifest, deps = {}) {
  const fetcher = deps.fetch ?? fetch
  const execute = deps.run ?? run
  const local = readFileSync(artifact)
  const { publisher, name, version } = manifest
  if (channel === 'npm') {
    const actual = INTEGRITY.parse(
      execute('npm', ['view', `muse-spark-code-acp@${version}`, 'dist.integrity']).trim(),
    )
    const expected = `sha512-${createHash('sha512').update(local).digest('base64')}`
    if (actual !== expected) {
      throw new Error('npm published integrity differs from the release tarball')
    }
    return
  }
  // One package per platform (PLAN.md D123): the registries serve each
  // target under its own download, so a targeted artifact is verified
  // against its own target's bytes. The target travels in vsce's artifact
  // name; an untargeted artifact verifies the universal download as before.
  const target = targetOfVsix(artifact)
  let url
  if (channel === 'marketplace') {
    url = `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${encodeURIComponent(publisher)}/vsextensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}/vspackage`
    if (target !== undefined) url += `?targetPlatform=${encodeURIComponent(target)}`
  } else if (channel === 'openvsx') {
    const segments = [publisher, name]
    if (target !== undefined) segments.push(target)
    segments.push(version)
    const metadata = await response(
      `https://open-vsx.org/api/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`,
      fetcher,
    )
    url = OPEN_VSX.parse(await metadata.json()).files.download
    if (new URL(url).protocol !== 'https:') {
      throw new Error('Open VSX download must use HTTPS')
    }
  } else {
    throw new Error('Unknown registry')
  }
  const download = await response(url, fetcher)
  const wire = Buffer.from(await download.arrayBuffer())
  // fetch already decodes Content-Encoding. Some gallery responses instead carry a gzip file.
  const bytes = wire[0] === 0x1f && wire[1] === 0x8b ? gunzipSync(wire) : wire
  if (sha256(bytes) !== sha256(local)) {
    throw new Error(`${channel} published SHA-256 differs from the release VSIX`)
  }
}

/** Backoff between visibility polls: 30 s, 60 s, then 120 s. */
export function visibilityDelay(attempt) {
  return Math.min(VISIBILITY_BASE_DELAY_MS * 2 ** attempt, VISIBILITY_MAX_DELAY_MS)
}

// Live bytes that are not ours fail at once; anything else (not found, empty,
// transient) is "not yet visible" and polls until the deadline.
const MISMATCH_ERROR = /differs from the release|must use HTTPS/

/**
Poll verify() until the published artifact is visible with matching
integrity. Resolves true when visible, false on timeout; an integrity
mismatch rejects. The clock and sleep are injectable for tests.
*/
export async function pollVisible(verify, deps = {}) {
  const sleep = deps.sleep ?? setTimeout
  const now = deps.now ?? Date.now
  const timeout = deps.timeoutMs ?? VISIBILITY_TIMEOUT_MS
  const deadline = now() + timeout
  // waitedMs backstops a clock that never advances (skew, suspension, fakes):
  // the poll always ends after ~timeout of sleeping, whatever the clock says.
  let waitedMs = 0
  for (let attempt = 0; ; attempt++) {
    try {
      await verify()
      return true
    } catch (error) {
      if (MISMATCH_ERROR.test(error instanceof Error ? error.message : String(error))) {
        throw error
      }
      if (now() >= deadline || waitedMs >= timeout) {
        return false
      }
      const delay = visibilityDelay(attempt)
      await sleep(delay)
      waitedMs += delay
    }
  }
}

/** Report one artifact's visibility to the console and, on Actions, the job summary. Never fails. */
export function reportVisibility(channel, visibility, label = '', environment = process.env) {
  const subject = label === '' ? channel : `${channel} ${label}`
  if (visibility === 'visible') {
    console.log(`${subject}: published and visible`)
    return
  }
  console.log(`::warning::${subject}: published, not yet visible; see docs/RELEASING.md`)
  if (environment.GITHUB_STEP_SUMMARY !== undefined) {
    appendFileSync(
      environment.GITHUB_STEP_SUMMARY,
      `\n${subject}: **published, not yet visible** after the 30-minute registry check. ` +
        `The release stays published; re-check the registry before announcing.\n`,
    )
  }
}

// Fixed repository tools, argument arrays, no shell; secrets stay in their step environment.
function publishCommand(channel, artifact) {
  const commands = {
    marketplace: ['./node_modules/.bin/vsce', ['publish', '--packagePath', artifact]],
    // Debug retains HTTP status on JSON error responses; its output stays in private pipes.
    openvsx: [process.execPath, [OVSX_CLI, '--debug', 'publish', artifact]],
    npm: [
      'npm',
      ['publish', `./${artifact}`, '--access', 'public', '--ignore-scripts', '--provenance'],
    ],
  }
  const command = commands[channel]
  if (command === undefined) {
    throw new Error('Unknown registry')
  }
  return command
}

/**
 * Publish one artifact without waiting for registry visibility. Resolves
 * true when freshly published (visibility still to poll), false when the
 * version already existed and the local artifact verified against it.
 */
export async function publishOnce(channel, artifact, manifest, deps = {}) {
  const execute = deps.run ?? run
  const sleep = deps.sleep ?? setTimeout
  const verify = () => verifyPublished(channel, artifact, manifest, deps)
  const command = publishCommand(channel, artifact)
  if (channel === 'openvsx') {
    await retryNetwork(async () => {
      const reply = await (deps.fetch ?? fetch)(
        `https://open-vsx.org/api/${encodeURIComponent(manifest.publisher)}`,
        { signal: globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      )
      if (reply.status === 404) {
        execute(process.execPath, [OVSX_CLI, '--debug', 'create-namespace', manifest.publisher])
      } else if (!reply.ok) {
        throw new Error(`HTTP ${reply.status} checking Open VSX namespace`)
      }
    }, sleep)
  }
  // An existing version is verified at once; only a fresh publish reports
  // back for the later shared visibility poll.
  let isFreshPublish = false
  await retryNetwork(async () => {
    try {
      execute(...command)
    } catch (error) {
      if (!EXISTS_ERROR.test(diagnostic(error))) {
        throw error
      }
      // Only a matching artifact turns an existing-version refusal into success.
      await verify()
      return
    }
    isFreshPublish = true
  }, sleep)
  return isFreshPublish
}

export async function publishRegistry(channel, artifact, manifest, deps = {}) {
  if (!(await publishOnce(channel, artifact, manifest, deps))) {
    return 'visible'
  }
  // A fresh publish polls until the registry shows it. Resolves 'visible'
  // or 'pending' (timeout warns, never fails).
  const verify = () => verifyPublished(channel, artifact, manifest, deps)
  return (await pollVisible(verify, deps)) ? 'visible' : 'pending'
}

/**
 * Poll every freshly published artifact until each is visible, under one
 * shared deadline (VISIBILITY_TIMEOUT_MS in total, not per artifact). The
 * release publishes every artifact first and only then waits, so a slow
 * registry delays the job once instead of once per artifact, and a
 * cancelled job never leaves only some targets published: re-running the
 * job re-publishes nothing (the existing-version path verifies at once)
 * and re-polls what is still pending. Returns the `visible` and `pending`
 * labels; an integrity mismatch rejects. The clock and sleep are
 * injectable for tests.
 */
export async function pollAllVisible(entries, deps = {}) {
  const sleep = deps.sleep ?? setTimeout
  const now = deps.now ?? Date.now
  const timeout = deps.timeoutMs ?? VISIBILITY_TIMEOUT_MS
  const deadline = now() + timeout
  // waitedMs backstops a clock that never advances (skew, suspension, fakes):
  // the poll always ends after ~timeout of sleeping, whatever the clock says.
  let waitedMs = 0
  const pending = new Map(entries.map(({ label, verify }) => [label, verify]))
  for (let round = 0; pending.size > 0; round++) {
    for (const [label, verify] of pending) {
      try {
        await verify()
        pending.delete(label)
      } catch (error) {
        if (MISMATCH_ERROR.test(error instanceof Error ? error.message : String(error))) {
          throw error
        }
      }
    }
    if (pending.size === 0 || now() >= deadline || waitedMs >= timeout) break
    const delay = visibilityDelay(round)
    await sleep(delay)
    waitedMs += delay
  }
  const done = new Set(entries.map(({ label }) => label).filter((label) => !pending.has(label)))
  return {
    visible: entries.map(({ label }) => label).filter((label) => done.has(label)),
    pending: pending.keys().toArray(),
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [channel, ...artifacts] = process.argv.slice(2)
  try {
    // One package per platform plus the universal fallback (PLAN.md D123):
    // the release publishes every artifact first and only then polls for
    // visibility under one shared deadline, so a cancelled job never leaves
    // only some targets published. npm still takes its single tarball.
    if (artifacts.length === 0) {
      throw new Error('usage: publish-registry.mjs <marketplace|openvsx|npm> <artifact...>')
    }
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const fresh = []
    for (const artifact of artifacts) {
      if (await publishOnce(channel, artifact, manifest)) fresh.push(artifact)
      else reportVisibility(channel, 'visible', artifact)
    }
    const { visible, pending } = await pollAllVisible(
      fresh.map((artifact) => ({
        label: artifact,
        verify: () => verifyPublished(channel, artifact, manifest),
      })),
    )
    for (const label of visible) reportVisibility(channel, 'visible', label)
    for (const label of pending) reportVisibility(channel, 'pending', label)
    // Outside Actions there is no step output to write; the publish still succeeded.
    if (process.env.GITHUB_OUTPUT !== undefined) {
      appendFileSync(process.env.GITHUB_OUTPUT, 'outcome=published\n')
    }
  } catch (error) {
    // CLI diagnostics may contain credentials. Print a fixed label only.
    console.error(`${channel}: ${failureReason(error)}; see docs/RELEASING.md`)
    process.exitCode = 1
  }
}
