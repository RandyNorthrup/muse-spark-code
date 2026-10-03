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

// The declared bin of pinned ovsx 1.2.0, run through Node without a shell shim.
// Static resolution also lets the dependency gate see the actual tool use.
const require = createRequire(import.meta.url)
const OVSX_CLI = require.resolve('ovsx/bin/ovsx')
const BACKOFF_MS = [20_000, 60_000]
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
  let url
  if (channel === 'marketplace') {
    url = `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${encodeURIComponent(publisher)}/vsextensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}/vspackage`
  } else if (channel === 'openvsx') {
    const metadata = await response(
      `https://open-vsx.org/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
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

export async function publishRegistry(channel, artifact, manifest, deps = {}) {
  const execute = deps.run ?? run
  const sleep = deps.sleep ?? setTimeout
  const verify = () => verifyPublished(channel, artifact, manifest, deps)
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
  await retryNetwork(async () => {
    try {
      execute(...command)
    } catch (error) {
      if (!EXISTS_ERROR.test(diagnostic(error))) {
        throw error
      }
      // Only a matching artifact turns an existing-version refusal into success.
      await verify()
    }
  }, sleep)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [channel, artifact, ...extra] = process.argv.slice(2)
  try {
    if (artifact === undefined || extra.length > 0) {
      throw new Error('usage: publish-registry.mjs <marketplace|openvsx|npm> <one artifact>')
    }
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    await publishRegistry(channel, artifact, manifest)
    // Outside Actions there is no step output to write; the publish still succeeded.
    if (process.env.GITHUB_OUTPUT !== undefined) {
      appendFileSync(process.env.GITHUB_OUTPUT, 'outcome=published\n')
    }
    console.log(`${channel}: published (existing versions require matching integrity)`)
  } catch (error) {
    // CLI diagnostics may contain credentials. Print a fixed label only.
    console.error(`${channel}: ${failureReason(error)}; see docs/RELEASING.md`)
    process.exitCode = 1
  }
}
