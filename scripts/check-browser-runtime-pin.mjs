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
// on). A fresh pin needs an extension release; this job only says so.
//
//   node scripts/check-browser-runtime-pin.mjs

import { readFileSync } from 'node:fs'
import process from 'node:process'

const { AbortSignal } = globalThis

const PIN = 'src/host/browser/runtime/browserRuntime.json'
const VERSIONS =
  'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json'
const DASH = 'https://chromiumdash.appspot.com/fetch_releases?channel=Stable&num=200&platform='
const DESKTOP = ['Windows', 'Linux', 'Mac']
const DAY_MS = 86_400_000
const EXPIRY_DAYS = 45
const LAG_DAYS = 14
const TIMEOUT_MS = 30_000

function fail(message) {
  console.error(`::error::browser check runtime pin: ${message}`)
  process.exit(1)
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    fail(`${url} answered ${String(response.status)}`)
  }
  return await response.json()
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
    const releases = await getJson(`${DASH}${platform}`)
    if (!Array.isArray(releases)) {
      fail(`ChromiumDash's ${platform} answer is not a list`)
    }
    const matches = releases.filter(
      (release) => release?.version === version && release?.channel === 'Stable',
    )
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].time) || matches[0].time <= 0) {
      fail(`no single dated ${platform} Stable record for ${version}`)
    }
    times.push(matches[0].time)
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
const known = await getJson(VERSIONS)
const newest = known?.channels?.Stable?.version
if (typeof newest !== 'string' || !/^\d+\.\d+\.\d+\.\d+$/.test(newest)) {
  fail('the newest Stable Chrome for Testing version is unknown')
}
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
