#!/usr/bin/env node
// The browser check's runtime pin, on release and weekly (M81 A1, design
// spec v4 §4.2; .github/workflows/release.yml and browser-runtime-pin.yml).
// Read-only GETs; it publishes and changes nothing.
//
// - The pin (src/host/browser/runtime/browserRuntime.json) must not be
//   expired, nor dated in the future: a release whose checks would refuse
//   at once fails.
// - The newest Stable Chrome for Testing version comes from its own
//   metadata (last-known-good-versions.json). When it is newer than the pin,
//   its ChromiumDash Stable records for that exact version (Windows, Linux,
//   Mac; field `time`, epoch ms) give its date, the earliest desktop one;
//   more than 14 days newer than the pin's own date fails. Exactly 14 days
//   passes; one millisecond more fails.
// - Unknown or ambiguous data fails: a version or date it cannot establish
//   never passes.
//
// The pin's own date is its immutable release record, never fetched again
// (spec §4.2: a republish keeps it, even when ChromiumDash's window has moved
// on). A fresh pin needs an extension release; this job only says so, and
// scripts/pin-browser-runtime.mjs writes one from the same sources
// (scripts/lib/browserRuntimeSources.mjs).
//
//   node scripts/check-browser-runtime-pin.mjs

import { readFileSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'
import {
  CFT_LAST_KNOWN_GOOD,
  DASH_RELEASES,
  dashUrl,
  DESKTOP,
  LAST_KNOWN_GOOD,
  stableRecordTime,
} from './lib/browserRuntimeSources.mjs'

const { AbortSignal } = globalThis

const PIN = 'src/host/browser/runtime/browserRuntime.json'
const DAY_MS = 86_400_000
const EXPIRY_DAYS = 45
const LAG_DAYS = 14
const TIMEOUT_MS = 30_000

function fail(message) {
  console.error(`::error::browser check runtime pin: ${message}`)
  process.exit(1)
}

/** The answer at `url`, parsed with `schema` before any of it is used. */
async function getJson(url, schema) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    fail(`${url} answered ${String(response.status)}`)
  }
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) {
    fail(`${url} answered in an unexpected shape: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/** Compares dotted version numbers: negative, zero or positive. */
function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) {
      return difference
    }
  }
  return 0
}

/** The earliest Stable desktop record's `time` for exactly `version`, or failure. */
async function publishedAt(version) {
  const times = []
  for (const platform of DESKTOP) {
    const releases = await getJson(dashUrl(platform), DASH_RELEASES)
    const time = stableRecordTime(releases, version)
    if (time === undefined) {
      fail(`no single dated ${platform} Stable record for ${version}`)
    }
    times.push(time)
  }
  return Math.min(...times)
}

const pin = JSON.parse(readFileSync(PIN, 'utf8'))
const pinned = pin?.publication?.publishedAtMs
if (!Number.isSafeInteger(pinned) || typeof pin.version !== 'string') {
  fail('the pin has no valid version or publication date')
}
const now = Date.now()
if (pinned > now) {
  fail(`the pin's publication date ${new Date(pinned).toISOString()} is in the future`)
}
if (now >= pinned + EXPIRY_DAYS * DAY_MS) {
  fail(`${pin.version} expired on ${new Date(pinned + EXPIRY_DAYS * DAY_MS).toISOString()}`)
}
const known = await getJson(CFT_LAST_KNOWN_GOOD, LAST_KNOWN_GOOD)
const newest = known.channels.Stable.version
if (compareVersions(newest, pin.version) <= 0) {
  console.log(
    `ok   ${pin.version} is the newest Stable (${newest}); expires ${new Date(pinned + EXPIRY_DAYS * DAY_MS).toISOString()}`,
  )
  process.exit(0)
}
const newestAt = await publishedAt(newest)
const lag = newestAt - pinned
if (lag > LAG_DAYS * DAY_MS) {
  fail(
    `${newest} was published ${(lag / DAY_MS).toFixed(3)} days after the pinned ${pin.version}: pin it in a release`,
  )
}
console.log(
  `ok   ${newest} is ${(lag / DAY_MS).toFixed(3)} days newer than the pinned ${pin.version} (at most ${String(LAG_DAYS)})`,
)
