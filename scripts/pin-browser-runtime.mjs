#!/usr/bin/env node
// Writes the browser check's runtime pin (M81 A1, design spec v4 §4.2),
// src/host/browser/runtime/browserRuntime.json, for one Stable Chrome for
// Testing version: the newest by default, or the one named. Release tooling,
// run when scripts/check-browser-runtime-pin.mjs asks for a new pin
// (docs/RELEASING.md); the new pin ships in an extension release.
//
// - The version, its revision and its date come from the sources the pin
//   check reads, read the same way (scripts/lib/browserRuntimeSources.mjs):
//   Chrome for Testing's last-known-good-versions.json for the newest Stable
//   and its revision (a version named here that is not the newest: its
//   revision from known-good-versions.json), and ChromiumDash's single Stable
//   record for exactly that version on each desktop platform, the earliest
//   being the pin's publishedAtMs.
// - For each platform the current pin names, the headless shell archive is
//   downloaded from the pin's storage path and measured: its length and
//   SHA-256; the end-of-central-directory entry count and the sum of the
//   central directory's uncompressed sizes, the two totals the runtime's ZIP
//   reader compares (readZipEntries); the entries whose archive mode has an
//   execute bit, the ones the extractor creates 0700; and the executable's
//   length and SHA-256 once extracted, as the runtime store compares them.
// - The runtime's own ZIP reader then reads and extracts every archive with
//   those values, checking each entry's length and CRC-32, so a pin the
//   product would refuse is never written. The whole pin is parsed by the
//   product's own schema and cross-checks (parseRuntimeManifest), then
//   written in the file's key order and prettier's formatting.
//
// Why a few lines below read the central directory: readZipEntries takes
// the entry count and the extracted total as the pin's expectations and
// refuses a mismatch instead of reporting the values, and it does not keep
// the entries' mode bits. The walk only collects those facts; every check of
// the archive's shape stays the extractor's.
//
// Downloads and extraction go to a fresh folder under the system temporary
// folder, removed at the end. No model is called.
//
//   node scripts/pin-browser-runtime.mjs [<version>]

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { build } from 'esbuild'
import { format, resolveConfig } from 'prettier'
import {
  CFT_KNOWN_GOOD,
  CFT_LAST_KNOWN_GOOD,
  dashUrl,
  DESKTOP,
  stableRecordTime,
  VERSION_PATTERN,
} from './lib/browserRuntimeSources.mjs'

const { AbortController } = globalThis

const root = path.resolve(import.meta.dirname, '..')
const PIN = path.join(root, 'src', 'host', 'browser', 'runtime', 'browserRuntime.json')
const SHELL = 'chrome-headless-shell'
const HTTP_OK = 200
// The end-of-central-directory record and the central headers (PKWARE
// APPNOTE.TXT §4.3), as zipExtract.ts reads them.
const EOCD_BYTES = 22
const EOCD_SIGNATURE = 0x06_05_4b_50
const EOCD_AT = { count: 10, length: 12, offset: 16 }
const CENTRAL_SIGNATURE = 0x02_01_4b_50
const CENTRAL_BYTES = 46
const CENTRAL_AT = { size: 24, nameLength: 28, extraLength: 30, commentLength: 32, external: 38 }
const SHIFT_UNIX_MODE = 16
const ANY_EXECUTE = 0o111

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && !VERSION_PATTERN.test(args[0]))) {
  console.error('usage: node scripts/pin-browser-runtime.mjs [<version>]')
  process.exit(2)
}

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`)
  }
  return await response.json()
}

/** The version to pin and its Chrome for Testing revision. */
async function versionAndRevision(named) {
  const lastKnownGood = await getJson(CFT_LAST_KNOWN_GOOD)
  const newest = lastKnownGood?.channels?.Stable
  if (typeof newest?.version !== 'string' || !VERSION_PATTERN.test(newest.version)) {
    throw new Error('the newest Stable Chrome for Testing version is unknown')
  }
  const version = named ?? newest.version
  let { revision } = newest
  if (version !== newest.version) {
    const known = await getJson(CFT_KNOWN_GOOD)
    const matches = Array.isArray(known?.versions)
      ? known.versions.filter((entry) => entry?.version === version)
      : []
    if (matches.length !== 1) {
      throw new Error(`Chrome for Testing lists no single ${version}`)
    }
    revision = matches[0].revision
  }
  if (typeof revision !== 'string' || !/^\d+$/.test(revision)) {
    throw new Error(`Chrome for Testing gives no revision for ${version}`)
  }
  return { version, revision }
}

/** ChromiumDash's Stable record time for exactly `version` on each desktop platform. */
async function platformTimesOf(version) {
  const times = {}
  for (const platform of DESKTOP) {
    const releases = await getJson(dashUrl(platform))
    if (!Array.isArray(releases)) {
      throw new TypeError(`ChromiumDash's ${platform} answer is not a list`)
    }
    const time = stableRecordTime(releases, version)
    if (time === undefined) {
      throw new Error(`no single dated ${platform} Stable record for ${version}`)
    }
    times[platform] = time
  }
  return times
}

/** The runtime's own ZIP reader and the manifest parser, from their TypeScript sources. */
async function productModules() {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export { extractZipEntries, readZipEntries } from './src/host/browser/runtime/zipExtract'; export { parseRuntimeManifest } from './src/core/browser/runtime/runtimeManifest'",
      resolveDir: root,
      loader: 'ts',
      sourcefile: 'pin-browser-runtime-entry.ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  return await import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  )
}

/** The archive at `url`, written to `file`: its length and SHA-256. */
async function download(url, file) {
  const response = await fetch(url, {
    redirect: 'error',
    headers: { 'Accept-Encoding': 'identity' },
  })
  if (response.status !== HTTP_OK || response.body === null) {
    throw new Error(`${url} answered ${String(response.status)}`)
  }
  const hash = createHash('sha256')
  let bytes = 0
  const output = await open(file, 'wx')
  try {
    for await (const chunk of response.body) {
      hash.update(chunk)
      bytes += chunk.length
      await output.write(chunk)
    }
  } finally {
    await output.close()
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) !== bytes) {
    throw new Error(`${url} sent ${String(bytes)} of its ${declared} bytes`)
  }
  return { archiveBytes: bytes, archiveSha256: hash.digest('hex') }
}

/** The end record's entry count, and each central entry's name, size and Unix mode. */
async function centralDirectory(file, size) {
  const handle = await open(file, 'r')
  try {
    const end = Buffer.alloc(EOCD_BYTES)
    await handle.read(end, 0, EOCD_BYTES, size - EOCD_BYTES)
    if (end.readUInt32LE(0) !== EOCD_SIGNATURE) {
      throw new Error(`${file} does not end with its end-of-central-directory record`)
    }
    const count = end.readUInt16LE(EOCD_AT.count)
    const directory = Buffer.alloc(end.readUInt32LE(EOCD_AT.length))
    await handle.read(directory, 0, directory.length, end.readUInt32LE(EOCD_AT.offset))
    const entries = []
    let at = 0
    for (let index = 0; index < count; index += 1) {
      if (directory.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
        throw new Error(`${file}: central header ${String(index)} is malformed`)
      }
      const nameStart = at + CENTRAL_BYTES
      const nameEnd = nameStart + directory.readUInt16LE(at + CENTRAL_AT.nameLength)
      entries.push({
        name: directory.toString('latin1', nameStart, nameEnd),
        size: directory.readUInt32LE(at + CENTRAL_AT.size),
        mode: directory.readUInt32LE(at + CENTRAL_AT.external) >>> SHIFT_UNIX_MODE,
      })
      at =
        nameEnd +
        directory.readUInt16LE(at + CENTRAL_AT.extraLength) +
        directory.readUInt16LE(at + CENTRAL_AT.commentLength)
    }
    return { count, entries }
  } finally {
    await handle.close()
  }
}

async function sha256File(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

/** One platform's record, measured from its archive in `folder` (a fresh one). */
async function measure(zip, url, platform, folder) {
  const archive = path.join(folder, `${SHELL}-${platform}.zip`)
  const { archiveBytes, archiveSha256 } = await download(url, archive)
  const { count, entries } = await centralDirectory(archive, archiveBytes)
  const extractedBytes = entries.reduce((total, entry) => total + entry.size, 0)
  const executableEntries = entries
    .filter((entry) => (entry.mode & ANY_EXECUTE) !== 0)
    .map((entry) => entry.name)
  const executable = `${SHELL}-${platform}/${SHELL}${platform === 'win64' ? '.exe' : ''}`
  if (!executableEntries.includes(executable)) {
    throw new Error(`${platform}: ${executable} is not among the archive's executable entries`)
  }
  // The runtime's own reader and extraction, with the values this pin carries.
  const plan = { entryCount: count, extractedBytes, executableEntries: new Set(executableEntries) }
  const handle = await open(archive, 'r')
  let checked
  try {
    checked = await zip.readZipEntries(handle, archiveBytes, plan)
  } finally {
    await handle.close()
  }
  const unpack = path.join(folder, 'unpack')
  await mkdir(unpack)
  await zip.extractZipEntries(archive, checked, unpack, plan, new AbortController().signal)
  const extracted = path.join(unpack, ...executable.split('/'))
  const info = await lstat(extracted)
  return {
    url,
    archiveBytes,
    archiveSha256,
    entryCount: count,
    extractedBytes,
    executable,
    executableBytes: info.size,
    executableSha256: await sha256File(extracted),
    executableEntries,
  }
}

const current = JSON.parse(await readFile(PIN, 'utf8'))
const { version, revision } = await versionAndRevision(args[0])
const platformTimes = await platformTimesOf(version)
const publishedAtMs = Math.min(...Object.values(platformTimes))
const product = await productModules()
const { storage } = current
const platforms = {}
const work = await mkdtemp(path.join(tmpdir(), 'pin-browser-runtime-'))
try {
  for (const platform of Object.keys(current.platforms)) {
    const folder = path.join(work, platform)
    await mkdir(folder)
    const url = `${storage.origin}${storage.pathPrefix}${version}/${platform}/${SHELL}-${platform}.zip`
    const record = await measure(product, url, platform, folder)
    // Each platform's archive and files go before the next one's download.
    await rm(folder, { recursive: true, force: true })
    platforms[platform] = record
    console.log(
      `${platform}: archive ${String(record.archiveBytes)} bytes ${record.archiveSha256}; ${String(record.entryCount)} entries, ${String(record.extractedBytes)} bytes extracted; ${record.executable} ${String(record.executableBytes)} bytes ${record.executableSha256}; ${String(record.executableEntries.length)} executable entries`,
    )
  }
} finally {
  await rm(work, { recursive: true, force: true })
}
const pin = {
  schemaVersion: 1,
  version,
  revision,
  publication: {
    version,
    channel: 'Stable',
    sources: DESKTOP.map((platform) => dashUrl(platform)),
    platformTimes,
    publishedAtMs,
    publishedAt: new Date(publishedAtMs).toISOString(),
  },
  storage: { origin: storage.origin, pathPrefix: storage.pathPrefix },
  platforms,
}
if (product.parseRuntimeManifest(pin) === undefined) {
  throw new Error('the generated pin fails the runtime manifest schema or its cross-checks')
}
const text = await format(JSON.stringify(pin, null, 2), {
  ...(await resolveConfig(PIN)),
  filepath: PIN,
})
await writeFile(PIN, text)
console.log(
  `${path.relative(root, PIN)}: ${version} (r${revision}), published ${pin.publication.publishedAt}`,
)
