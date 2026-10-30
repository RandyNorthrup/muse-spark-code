#!/usr/bin/env node
// The pack build (M110t TP1, PLAN.md D90.27): deploy/packs/*.json are the
// pins; this script checks they resolve (`check`), downloads and hashes
// everything into a lock with an SBOM (`lock`), assembles the OCI layer
// blobs, smokes them and emits the index (`build`), and reports pin
// drift for the weekly refresh (`refresh`, `--apply` to bump).
//
// Every download hashes as it lands. Publisher hashes verify where the
// publisher publishes them (Node SHASUMS, Go's JSON, Android's XML,
// .NET metadata, Temurin checksums, npm/PyPI/crates digests, Debian's
// Packages); otherwise the measured hash locks into the SBOM and the
// lock. Anything that fails to resolve or verify fails loudly: no lock,
// no layer, no index.
import { Buffer } from 'node:buffer'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout } from 'node:timers/promises'

const REPO_ROOT = path.join(import.meta.dirname, '..')
const PACKS_DIR = path.join(REPO_ROOT, 'deploy', 'packs')
const FETCH_TIMEOUT_MS = 60_000
const FETCH_MAX_BYTES = 256_000_000
const MAX_REDIRECTS = 5
const MS_PER_DAY = 24 * 60 * 60 * 1000
const INDEX_TTL_MS = 90 * MS_PER_DAY

const PACK_BUILD_UA = 'muse-pack-build/1.0 (+https://github.com/RandyNorthrup/muse-spark-code)'

/** A fetched URL: its status, bytes and final URL. */
async function fetchUrl(url, { method = 'GET', headers = {} } = {}) {
  const requestHeaders = { 'User-Agent': PACK_BUILD_UA, ...headers }
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const outcome = await fetchOnce(current, { method, headers: requestHeaders })
    if (
      method === 'GET' &&
      outcome.status >= 300 &&
      outcome.status < 400 &&
      outcome.headers.location !== undefined
    ) {
      current = new URL(outcome.headers.location, current).href
      continue
    }
    return { ...outcome, url: current }
  }
  throw new Error(`too many redirects fetching ${url}`)
}

async function fetchOnce(url, { method, headers }) {
  const { request } = url.startsWith('https:')
    ? await import('node:https')
    : await import('node:http')
  return await new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => {
        chunks.push(chunk)
      })
      res.on('end', () => {
        const bytes = Buffer.concat(chunks)
        if (bytes.byteLength > FETCH_MAX_BYTES) {
          reject(new Error(`refusing to buffer ${url}: metadata past ${FETCH_MAX_BYTES} bytes`))
          return
        }
        resolve({ status: res.statusCode ?? 0, headers: res.headers, bytes })
      })
    })
    req.on('error', reject)
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`fetch timed out: ${url}`))
    })
    req.end()
  })
}

/**
Whether the URL resolves: true on 2xx/3xx, false on a definitive 404/410
(HEAD, then a one-byte GET range for servers that refuse HEAD), and
loud on anything else: a sick server is not a missing pin.
*/
/** HEAD then a ranged GET: resolved, or both statuses for the verdict. */
async function probePair(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const head = await fetchUrl(url, { method: 'HEAD' })
      if (head.status >= 200 && head.status < 400) return { resolved: true }
      const get = await fetchUrl(url, { headers: { Range: 'bytes=0-0' } })
      return get.status >= 200 && get.status < 400
        ? { resolved: true }
        : { resolved: false, head: head.status, get: get.status }
    } catch (error) {
      if (attempt >= 2 || (error instanceof Error && error.message.startsWith('HTTP '))) {
        throw error
      }
      await setTimeout((attempt + 1) * 5000)
    }
  }
}

async function urlResolves(url) {
  // One stalled read must not fail the check; statuses still speak.
  // A double 404 retries once: CDN edges 404-blip fresh uploads.
  for (let round = 0; round < 2; round += 1) {
    const probe = await probePair(url)
    if (probe.resolved === true) return true
    const isGone = probe.get === 404 || probe.get === 410
    const isHeadGone = probe.head === 404 || probe.head === 410
    if (isGone && isHeadGone) {
      if (round === 0) {
        await setTimeout(5000)
        continue
      }
      return false
    }
    throw new Error(`HTTP ${probe.get} resolving ${url}`)
  }
}

/** Download the URL to a file, returning its bytes, sha256 and size. */
/** One streamed GET: redirect/cold statuses report, a 200 writes and hashes. */
async function streamGet(url, file) {
  const { request } = url.startsWith('https:')
    ? await import('node:https')
    : await import('node:http')
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        headers: { 'User-Agent': PACK_BUILD_UA },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          resolve({ status: res.statusCode ?? 0, headers: res.headers })
          return
        }
        mkdirSync(path.dirname(file), { recursive: true })
        const hash = createHash('sha256')
        let sizeBytes = 0
        const out = createWriteStream(file)
        res.on('data', (chunk) => {
          sizeBytes += chunk.byteLength
          hash.update(chunk)
        })
        res.on('error', (error) => {
          out.destroy()
          reject(error)
        })
        out.on('error', reject)
        out.on('finish', () => {
          resolve({ status: 200, headers: res.headers, sha256: hash.digest('hex'), sizeBytes })
        })
        res.pipe(out)
      },
    )
    req.on('error', reject)
    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error(`fetch timed out: ${url}`))
    })
    req.end()
  })
}

async function download(url, file) {
  // Pack CI moves gigabytes; one stalled read must not fail the build.
  // Downloads stream to disk (LLVM passes 1.5 GiB); only metadata
  // buffers in memory.
  let attempt = 0
  while (true) {
    attempt += 1
    try {
      let current = url
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const outcome = await streamGet(current, file)
        if (outcome.status === 200) return { sha256: outcome.sha256, sizeBytes: outcome.sizeBytes }
        const location = outcome.headers.location
        if (location !== undefined && outcome.status >= 300 && outcome.status < 400) {
          current = new URL(location, current).href
          continue
        }
        throw new Error(`HTTP ${outcome.status} fetching ${url}`)
      }
      throw new Error(`too many redirects fetching ${url}`)
    } catch (error) {
      if (attempt >= 3 || (error instanceof Error && error.message.startsWith('HTTP '))) throw error
      await setTimeout(attempt * 5000)
    }
  }
}

/** Run a command, returning stdout; failures carry the command and output. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${String(result.status)}: ${(result.stderr || result.stdout || '').slice(0, 2000)}`,
    )
  }
  return result.stdout
}

/**
Remove a build tree, however read-only its contents: Go's module cache
and Cargo's registry mark files read-only, and a stale staging dir
from an earlier run breaks the next rebuild (EACCES) without this.
Symlinks are unlinked, never followed.
*/
function removeTree(dir) {
  if (!existsSync(dir)) return
  const grant = (entry) => {
    const stat = lstatSync(entry)
    if (stat.isSymbolicLink()) return
    chmodSync(entry, stat.isDirectory() ? 0o755 : 0o644)
    if (!stat.isDirectory()) return
    const children = readdirSync(entry)
    for (const child of children) grant(path.join(entry, child))
  }
  grant(dir)
  rmSync(dir, { recursive: true, force: true })
}

/** Byte-order string comparison (locale-independent file order). */
function compareStrings(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/** The pack build definitions, structurally checked (the schema is the tests'). */
function loadDefinitions() {
  const files = readdirSync(PACKS_DIR)
    .filter((file) => file.endsWith('.json'))
    .toSorted(compareStrings)
  if (files.length === 0) throw new Error(`no pack definitions in ${PACKS_DIR}`)
  return files.map((file) => {
    const raw = readFileSync(path.join(PACKS_DIR, file), 'utf8')
    const definition = JSON.parse(raw)
    for (const field of ['name', 'version', 'license', 'upstream', 'smoke']) {
      if (definition[field] === undefined || definition[field] === null) {
        throw new Error(`${file} is missing ${field}`)
      }
    }
    if (definition.name !== path.basename(file, '.json')) {
      throw new Error(`${file} names ${String(definition.name)}`)
    }
    return { file, definition }
  })
}

/**
`check`: every pin resolves. Upstream URLs answer, registry versions
exist, the apt snapshot carries the packages, the Android XML carries
the revisions, the Rust channels exist. Prints every failure; exits 1
on any. (Whether pins are *current* is `refresh`.)
*/
async function check() {
  const failures = []
  const fail = (where, what) => {
    failures.push(`${where}: ${what}`)
  }
  const definitions = loadDefinitions()
  console.log(`${definitions.length} pack definitions`)
  const androidXml = definitions.some(({ definition }) => definition.name === 'mobile')
    ? await fetchAndroidXml()
    : new Set()
  const aptPackages = {}
  for (const { file, definition } of definitions) {
    for (const upstream of definition.upstream) {
      if (!(await urlResolves(upstream.url))) {
        fail(file, `upstream ${upstream.name} ${upstream.version}: ${upstream.url}`)
      }
    }
    const managed = definition.managed ?? {}
    const npmTools = managed.npm ?? []
    for (const tool of npmTools) {
      if (!(await npmVersionExists(tool.name, tool.version))) {
        fail(file, `npm ${tool.name}@${tool.version} missing`)
      }
    }
    const uvToolEntries = managed.uvTools ?? []
    for (const tool of uvToolEntries) {
      if (!(await pypiVersionExists(tool.name, tool.version))) {
        fail(file, `uv ${tool.name}@${tool.version} missing`)
      }
    }
    const uvPythonEntries = managed.uvPythons ?? []
    for (const tool of uvPythonEntries) {
      if (!(await uvPythonExists(tool.version, definitions))) {
        fail(file, `uv python ${tool.version} missing`)
      }
    }
    const cargoTools = managed.cargo ?? []
    for (const tool of cargoTools) {
      if (!(await cratesVersionExists(tool.name, tool.version))) {
        fail(file, `cargo ${tool.name}@${tool.version} missing`)
      }
    }
    const goTools = managed.go ?? []
    for (const tool of goTools) {
      if (!(await goModuleVersionExists(tool.module, tool.version))) {
        fail(file, `go ${tool.module}@${tool.version} missing`)
      }
    }
    const psGalleryTools = managed.psGallery ?? []
    for (const tool of psGalleryTools) {
      if (!(await psGalleryVersionExists(tool.name, tool.version))) {
        fail(file, `psgallery ${tool.name}@${tool.version} missing`)
      }
    }
    const rustTools = managed.rust ?? []
    for (const tool of rustTools) {
      if (!(await rustChannelExists(tool.version))) {
        fail(file, `rust channel ${tool.version} missing`)
      }
    }
    if (definition.apt !== undefined) {
      const snapshot = definition.apt.snapshot
      aptPackages[snapshot] ??= await fetchAptPackages(snapshot)
      for (const pkg of definition.apt.packages) {
        if (!aptPackages[snapshot].has(pkg.name)) fail(file, `apt ${pkg.name} not in ${snapshot}`)
      }
    }
    if (definition.name === 'mobile') {
      for (const upstream of definition.upstream) {
        const file = upstream.url.split('/').pop()
        const entry = androidXml.find((candidate) => candidate.url === file)
        if (entry === undefined) {
          fail(definition.name, `android ${file} not in repository2-1.xml`)
          continue
        }
        if (!androidRevisionMatches(upstream.name, upstream.version, entry)) {
          fail(
            definition.name,
            `android ${file} is ${entry.path} rev ${entry.major}.${entry.minor}, not ${upstream.version}`,
          )
        }
      }
    }
    console.log(`ok ${file}`)
  }
  if (failures.length === 0) {
    return
  }

  for (const failure of failures) console.error(`pin missing: ${failure}`)
  throw new Error(`${failures.length} pins do not resolve`)
}

async function npmVersionExists(name, version) {
  const response = await fetchUrl(`https://registry.npmjs.org/${name}/${version}`)
  return response.status === 200
}

async function pypiVersionExists(name, version) {
  const response = await fetchUrl(`https://pypi.org/pypi/${name}/${version}/json`)
  return response.status === 200
}

async function cratesVersionExists(name, version) {
  const response = await fetchUrl(`https://crates.io/api/v1/crates/${name}/${version}`)
  return response.status === 200
}

async function goModuleVersionExists(packagePath, version) {
  const marker = '/cmd/'
  const cut = packagePath.lastIndexOf(marker)
  if (cut === -1) throw new Error(`go tool ${packagePath} is not a /cmd/ package`)
  const response = await fetchUrl(
    `https://proxy.golang.org/${packagePath.slice(0, cut)}/@v/${version}.info`,
  )
  if (response.status !== 200) return false
  const info = JSON.parse(response.bytes.toString('utf8'))
  return (
    info.Version === version ||
    info.Version === `${version}+incompatible` ||
    info.Origin?.Ref === `refs/tags/${version}`
  )
}

async function psGalleryVersionExists(name, version) {
  // The version list feed is capped and omits new versions; the
  // download URL (what the lock fetches) is the existence proof.
  return await urlResolves(`https://www.powershellgallery.com/api/v2/package/${name}/${version}`)
}

async function rustChannelExists(channel) {
  if (channel === 'stable' || channel === 'beta' || /^\d+\.\d+\.\d+$/.test(channel)) {
    return await urlResolves(`https://static.rust-lang.org/dist/channel-rust-${channel}.toml`)
  }
  if (channel.startsWith('nightly-')) {
    const date = channel.slice('nightly-'.length)
    return await urlResolves(`https://static.rust-lang.org/dist/${date}/channel-rust-nightly.toml`)
  }
  return false
}

/**
Whether the pinned uv offers this CPython: downloads the pinned uv
itself and asks `uv python list`. The offer depends on the uv version,
so only the pinned uv answers.
*/
/** Scratch space: the lane's TMPDIR when set (never the small /tmp). */
function scratchDir() {
  return process.env.TMPDIR ?? tmpdir()
}

/** The pinned uv itself, downloaded once (only it knows what it offers). */
async function downloadPinnedUv(definitions) {
  const python = definitions.find(({ definition }) => definition.name === 'python')
  const uv = python?.definition.upstream.find((artifact) => artifact.name === 'uv')
  if (uv === undefined) throw new Error('the python pack pins no uv')
  const archFor = { arm64: 'aarch64', x64: 'x86_64' }
  const arch = archFor[process.arch]
  if (arch === undefined) throw new Error(`no uv build for ${process.arch}`)
  const workdir = path.join(scratchDir(), 'pack-check-uv')
  const binary = path.join(workdir, arch, 'uv')
  if (!existsSync(binary)) {
    const url = `https://github.com/astral-sh/uv/releases/download/${uv.version}/uv-${arch}-unknown-linux-gnu.tar.gz`
    const archive = path.join(workdir, `uv-${arch}.tar.gz`)
    await download(url, archive)
    mkdirSync(path.join(workdir, arch), { recursive: true })
    run('tar', ['xzf', archive, '-C', path.join(workdir, arch), '--strip-components=1'])
  }
  return { binary, workdir }
}

async function uvPythonExists(version, definitions) {
  const { binary, workdir } = await downloadPinnedUv(definitions)
  const list = run(binary, ['python', 'list'], {
    env: { ...process.env, UV_CACHE_DIR: path.join(workdir, 'cache') },
  })
  return list.split('\n').some((line) => line.startsWith(`cpython-${version}-`))
}

/**
The Android linux archives: each file with its package path and
revision. Parsed per `<archive>` block (a global regex backtracks over
the whole document).
*/
async function fetchAndroidXml() {
  const response = await fetchUrl('https://dl.google.com/android/repository/repository2-1.xml')
  if (response.status !== 200) throw new Error(`HTTP ${response.status} fetching repository2-1.xml`)
  const text = response.bytes.toString('utf8')
  const entries = []
  const packagePattern = /<remotePackage path="([^"]+)"[^>]*>([\s\S]*?)<\/remotePackage>/g
  for (const packageMatch of text.matchAll(packagePattern)) {
    const [, packagePath, body] = packageMatch
    const revision =
      /<major>(\d+)<\/major>(?:\s*<minor>(\d+)<\/minor>)?(?:\s*<micro>(\d+)<\/micro>)?/.exec(body)
    if (revision === null) continue
    const [, major, minor, micro] = revision
    const archivePattern = /<archive>([\s\S]*?)<\/archive>/g
    for (const archiveMatch of body.matchAll(archivePattern)) {
      const archive = archiveMatch[1]
      const host = /<host-os>([^<]*)<\/host-os>/.exec(archive)?.[1]
      if (host !== undefined && host !== 'linux') continue
      const url = /<url>([^<]+)<\/url>/.exec(archive)?.[1]
      const sha256 = /<sha256>([0-9a-f]+)<\/sha256>/.exec(archive)?.[1]
      const size = /<size>(\d+)<\/size>/.exec(archive)?.[1]
      if (url !== undefined)
        entries.push({ url, path: packagePath, major, minor, micro, sha256, size })
    }
  }
  return entries
}

/** Whether an Android archive's revision matches the pinned version. */
function androidRevisionMatches(name, version, entry) {
  switch (name) {
    case 'android-cmdline-tools': {
      return `${entry.major}.${entry.minor ?? '0'}` === version
    }
    case 'android-build-tools': {
      return `${entry.major}.${entry.minor ?? '0'}.${entry.micro ?? '0'}` === version
    }
    case 'android-platform-tools': {
      return `${entry.major}.${entry.minor}.${entry.micro ?? '0'}` === version
    }
    case 'android-platform': {
      return entry.path === 'platforms;android-36' && entry.major === '2'
    }
    default: {
      return false
    }
  }
}

function parseOptions(args) {
  const options = {}
  const valued = new Set(['--pack', '--arch', '--out', '--tag', '--revision', '--built-by'])
  const flags = new Map([
    ['--apply', 'apply'],
    ['--with-requires', 'withRequires'],
    ['--smoke-container', 'smokeContainer'],
  ])
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (valued.has(arg)) {
      const value = args[index + 1]
      if (value === undefined) throw new Error(`${arg} needs a value`)
      options[arg.slice('--'.length)] = value
      index += 1
      continue
    }
    const flag = flags.get(arg)
    if (flag === undefined) throw new Error(`unknown option ${arg}`)
    options[flag] = true
  }
  return options
}

const command = process.argv[2]
const options = parseOptions(process.argv.slice(3))
switch (command) {
  case 'check': {
    await check()
    console.log('all pins resolve')
    break
  }
  case 'lock': {
    await lock(options)
    console.log('locks written')
    break
  }
  case 'build': {
    await build(options)
    console.log('layers built')
    break
  }
  case 'refresh': {
    await refresh(options)
    break
  }
  case 'index': {
    await emitIndex(options)
    console.log('index written')
    break
  }
  default: {
    console.error(
      `usage: node scripts/build-packs.mjs check|lock|build|refresh|index [--pack <name>] [--arch x64|arm64] [--out <dir>] [--tag <release>] [--revision <n>] [--built-by <id>]`,
    )
    process.exitCode = 1
    break
  }
}

/**
`lock`: download every upstream and managed file, verify publisher
hashes where published, resolve apt versions from the snapshot, and
write per-pack, per-arch locks with SBOMs under `--out` (default
`temp/pack-build`). Options: `--pack <name>`, `--arch x64|arm64`.
*/
/** The arches `--arch` selects, or both; anything else fails. */
function selectArches(options) {
  if (options.arch === undefined) return ['x64', 'arm64']
  if (options.arch !== 'x64' && options.arch !== 'arm64') {
    throw new Error(`unknown arch ${options.arch}`)
  }
  return [options.arch]
}

async function lock(options) {
  const out = options.out ?? path.join(REPO_ROOT, 'temp', 'pack-build')
  const definitions = selectDefinitions(options)
  const arches = selectArches(options)
  const nodeShasums = {}
  const goJson = await fetchGoJson()
  const androidEntries = await fetchAndroidXml()
  const dotnetReleases = {}
  const aptMetadata = {}
  // The interpreter each pack's uv tools run on: its own pin, else its
  // requires' (typescript and makers ride the python pack).
  const byName = new Map(loadDefinitions().map(({ definition }) => [definition.name, definition]))
  const pythonVersions = new Map()
  const pythonFor = (definition, seen = new Set()) => {
    const known = pythonVersions.get(definition.name)
    if (known !== undefined) return known
    const own = definition.managed?.uvPythons?.[0]?.version
    if (own !== undefined) {
      pythonVersions.set(definition.name, own)
      return own
    }
    seen.add(definition.name)
    const requires = definition.requires ?? []
    for (const name of requires) {
      if (seen.has(name)) continue
      const dep = byName.get(name)
      const inherited = dep === undefined ? undefined : pythonFor(dep, seen)
      if (inherited !== undefined) {
        pythonVersions.set(definition.name, inherited)
        return inherited
      }
    }
  }
  for (const definition of definitions) {
    for (const arch of arches) {
      console.log(`lock ${definition.name} ${arch}`)
      const locked = await lockPack(definition, arch, {
        out,
        nodeShasums,
        goJson,
        androidEntries,
        dotnetReleases,
        aptMetadata,
        pythonVersion: pythonFor(definition),
      })
      if (locked === undefined) continue
      const lockDir = path.join(out, 'locks')
      mkdirSync(lockDir, { recursive: true })
      writeFileSync(
        path.join(lockDir, `${definition.name}-${arch}.json`),
        `${JSON.stringify(locked, null, 2)}\n`,
      )
      writeSbom(definition, locked, out)
    }
  }
}

/**
The selected definitions, or every definition without `--pack`.
`--with-requires` pulls the selection's requires closure along, so
one matrix leg builds and smokes standalone.
*/
function selectDefinitions(options) {
  const all = loadDefinitions()
  const selected = all.filter(
    ({ definition }) => options.pack === undefined || definition.name === options.pack,
  )
  if (options.pack !== undefined && selected.length === 0) {
    throw new Error(`no pack named ${options.pack}`)
  }
  if (options.pack === undefined || options.withRequires !== true) {
    return selected.map(({ definition }) => definition)
  }
  const byName = new Map(all.map(({ definition }) => [definition.name, definition]))
  const closure = new Map()
  const pull = (definition) => {
    if (closure.has(definition.name)) return
    closure.set(definition.name, definition)
    const requires = definition.requires ?? []
    for (const name of requires) {
      const dep = byName.get(name)
      if (dep === undefined) throw new Error(`${definition.name} requires unknown pack ${name}`)
      pull(dep)
    }
  }
  for (const { definition } of selected) pull(definition)
  return closure.values().toArray()
}

/**
Definitions in requires-first order; unknown packs and cycles fail.
A requires outside the selection orders nothing: each pack+arch with
content checks its requires' built layers itself, and skipped arches
need nothing.
*/
function topoOrder(definitions) {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]))
  const known = new Set(loadDefinitions().map(({ definition }) => definition.name))
  const ordered = []
  const state = new Map()
  const visit = (definition) => {
    const mark = state.get(definition.name)
    if (mark === 'done') return
    if (mark === 'visiting') throw new Error(`require cycle at ${definition.name}`)
    state.set(definition.name, 'visiting')
    const requires = definition.requires ?? []
    for (const name of requires) {
      if (!known.has(name)) throw new Error(`${definition.name} requires unknown pack ${name}`)
      const dependency = byName.get(name)
      if (dependency !== undefined) visit(dependency)
    }
    state.set(definition.name, 'done')
    ordered.push(definition)
  }
  for (const definition of definitions) visit(definition)
  return ordered
}

/**
`build`: assemble each selected pack+arch layer from its lock (the lock
runs first): re-hash every locked file, extract upstreams, run managed
installs, link bins, write pack.json, run smoke with the `requires`
layers composed (the composition the node installs), tar the
deterministic layer blob, and emit the signed index content. A pack
with nothing for an arch (mobile on arm64) is skipped, not stubbed.
*/
async function build(options) {
  const out = options.out ?? path.join(REPO_ROOT, 'temp', 'pack-build')
  const arches = selectArches(options)
  const ordered = topoOrder(selectDefinitions(options))
  const built = []
  for (const definition of ordered) {
    for (const arch of arches) {
      const layer = await buildPack(definition, arch, out, options)
      if (layer !== undefined) built.push(layer)
    }
  }
  writeIndex(ordered, built, options, out)
}

/** Whether the definition carries anything for the arch. */
function hasArchContent(definition, arch) {
  const managed = definition.managed ?? {}
  const managedKinds = ['npm', 'cargo', 'uvTools', 'uvPythons', 'go', 'psGallery', 'rust']
  const hasManaged = managedKinds.some((kind) => (managed[kind] ?? []).length > 0)
  const hasUpstream = definition.upstream.some(
    (upstream) =>
      upstream.platforms === undefined ||
      upstream.platforms.some((platform) => platform.os === 'linux' && platform.arch === arch),
  )
  return hasUpstream || hasManaged || definition.apt !== undefined
}

/** One layer blob for one pack+arch, or undefined when skipped. */
async function buildPack(definition, arch, out, options) {
  if (!hasArchContent(definition, arch)) {
    console.log(`skip ${definition.name} ${arch} (nothing for this arch)`)
    return
  }
  const lockFile = path.join(out, 'locks', `${definition.name}-${arch}.json`)
  if (!existsSync(lockFile)) {
    throw new Error(`no lock for ${definition.name} ${arch}; run lock first`)
  }
  const locked = JSON.parse(readFileSync(lockFile, 'utf8'))
  const requires = definition.requires ?? []
  for (const name of requires) {
    const manifest = path.join(out, 'layers', `${name}-${arch}`, 'pack.json')
    if (!existsSync(manifest)) {
      throw new Error(`${definition.name} needs the built ${name} ${arch} layer first`)
    }
  }
  console.log(`build ${definition.name} ${arch}`)
  const root = path.join(out, 'layers', `${definition.name}-${arch}`)
  removeTree(root)
  mkdirSync(path.join(root, 'usr', 'local', 'bin'), { recursive: true })
  await verifyLockedFiles(locked, out)
  const links = { from: new Set(), bins: new Map() }
  for (const upstream of locked.upstreams) {
    const declared = definition.upstream.find((entry) => entry.url === upstream.url)
    if (declared === undefined)
      throw new Error(`lock carries ${upstream.url}, the definition does not`)
    installUpstream(declared, upstream, root, out, links)
  }
  installApt(locked, root, out, links)
  const bootstrap = await installManaged(definition, locked, arch, root, out)
  relativizeSymlinks(root, definition)
  const manifest = writeManifest(definition, locked, arch, root, bootstrap, links)
  runSmoke(definition, arch, out, manifest)
  if (options.smokeContainer === true) runContainerSmoke(definition, arch, out, manifest)
  const layerFile = path.join(out, 'layers', `${definition.name}-${arch}.tar.gz`)
  await tarLayer(root, locked.checkedAt, layerFile)
  const hashed = await hashFile(layerFile)
  return {
    definition,
    arch,
    file: path.relative(out, layerFile),
    sha256: hashed.sha256,
    sizeBytes: hashed.sizeBytes,
  }
}

/**
Rewrite every absolute symlink landing inside the layer as a relative
one: installers (uv's tool and python dirs) write absolute links to
the build tree, which dangle wherever the layer is installed or
mounted (the python container smoke caught this: its cpython link
pointed at the build tree, so `python` was missing in the
container). Links out of the layer are kept and named. Anything left
absolute into the layer afterwards fails the build.
*/
function relativizeSymlinks(root, definition) {
  let fixed = 0
  for (const { link, target } of collectAbsoluteLinks(root)) {
    const resolved = path.resolve(path.dirname(link), target)
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      console.log(
        `external link kept in ${definition.name}: ${path.relative(root, link)} -> ${target}`,
      )
      continue
    }
    unlinkSync(link)
    symlinkSync(path.relative(path.dirname(link), resolved), link)
    fixed += 1
  }
  const remaining = collectAbsoluteLinks(root).filter(({ link, target }) => {
    const resolved = path.resolve(path.dirname(link), target)
    return resolved === root || resolved.startsWith(`${root}${path.sep}`)
  })
  if (remaining.length > 0) {
    const names = remaining.map(({ link }) => path.relative(root, link)).join(', ')
    throw new Error(`absolute links left in ${definition.name}: ${names}`)
  }
  if (fixed > 0) console.log(`relativized ${fixed} links in ${definition.name}`)
}

/** Every absolute symlink under dir (real dirs followed, links never). */
function collectAbsoluteLinks(dir) {
  const found = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(full)
      if (path.isAbsolute(target)) found.push({ link: full, target })
    } else if (entry.isDirectory()) {
      found.push(...collectAbsoluteLinks(full))
    }
  }
  return found
}

/** Stream a file's sha256 and size (layers pass 2 GiB; buffers do not). */
async function hashFile(file) {
  const hash = createHash('sha256')
  let sizeBytes = 0
  const input = createReadStream(file)
  await new Promise((resolve, reject) => {
    input.on('data', (chunk) => {
      sizeBytes += chunk.byteLength
      hash.update(chunk)
    })
    input.on('error', reject)
    input.on('end', resolve)
  })
  return { sha256: hash.digest('hex'), sizeBytes }
}

/** Re-hash every locked file: the build trusts no download it did not check. */
async function verifyLockedFiles(locked, out) {
  const files = [
    ...locked.upstreams.map((upstream) => upstream.file),
    ...(locked.managed?.npm ?? []).map((tool) => tool.file),
    ...(locked.managed?.uvTools ?? []).map((tool) => tool.file),
    ...(locked.managed?.psGallery ?? []).map((tool) => tool.file),
    ...(locked.apt ?? []).map((entry) => entry.file),
  ]
  for (const file of files) {
    if (!existsSync(path.join(out, file))) throw new Error(`locked file missing: ${file}`)
  }
  const hashed = new Map()
  const shaOf = async (file) => {
    const known = hashed.get(file)
    if (known !== undefined) return known
    const { sha256 } = await hashFile(path.join(out, file))
    hashed.set(file, sha256)
    return sha256
  }
  const expect = async (file, sha256) => {
    if ((await shaOf(file)) !== sha256) {
      throw new Error(`locked file changed under the build: ${file}`)
    }
  }
  for (const upstream of locked.upstreams) await expect(upstream.file, upstream.sha256)
  const checkTools = async (tools) => {
    for (const tool of tools) await expect(tool.file, tool.sha256)
  }
  await checkTools(locked.managed?.npm ?? [])
  await checkTools(locked.managed?.uvTools ?? [])
  await checkTools(locked.managed?.psGallery ?? [])
  await checkTools(locked.apt ?? [])
}

/** Every file under a directory, as paths relative to it. */
function walkFiles(dir) {
  const found = []
  const walk = (current) => {
    const entries = readdirSync(current).toSorted(compareStrings)
    for (const entry of entries) {
      const full = path.join(current, entry)
      const stat = lstatSync(full)
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        walk(full)
      } else {
        found.push(path.relative(dir, full))
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return found
}

/** Link `target` into the layer's bin dir under `name` (first wins, loudly). */
function linkBin(root, target, name, links) {
  if (links.bins.has(name)) {
    console.log(`bin ${name} already linked, keeping ${links.bins.get(name)}`)
    return
  }
  const binDir = path.join(root, 'usr', 'local', 'bin')
  mkdirSync(binDir, { recursive: true })
  symlinkSync(path.relative(binDir, target), path.join(binDir, name))
  links.bins.set(name, path.relative(root, target))
}

/** Whether the file is an archive the build extracts (otherwise a bare binary). */
function isArchive(file) {
  return ['.tar.gz', '.tgz', '.tar.xz', '.tar.bz2', '.tar.zst', '.tar', '.zip'].some((suffix) =>
    file.endsWith(suffix),
  )
}

/** The archive's member names, rejecting traversal before anything extracts. */
function listMembers(file) {
  const output = file.endsWith('.zip') ? run('unzip', ['-Z1', file]) : run('tar', ['-tf', file])
  const members = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== '.' && line !== './')
  for (const member of members) {
    const segments = member.split('/')
    if (member.startsWith('/') || segments.includes('..')) {
      throw new Error(`archive escapes its tree: ${file} carries ${member}`)
    }
  }
  return members
}

/**
Extract the archive into `dest`, honouring the definition's strip
level, and return the top-level children it placed there. Staging
keeps shared destinations (the Android SDK) safe: siblings the
archive did not bring are never touched, and a collision fails.
*/
function extractArchive(file, dest, strip) {
  const members = listMembers(file)
  const tops = new Set(
    members.map((member) => member.replace(/\/$/, '').split('/', 1)[0] ?? member),
  )
  const singleDir = tops.size === 1 && members.some((member) => member.includes('/'))
  const level = strip ?? (singleDir ? 1 : 0)
  mkdirSync(dest, { recursive: true })
  const stage = `${dest}.stage-${path.basename(file).replaceAll(/[^A-Za-z0-9]+/g, '-')}`
  removeTree(stage)
  mkdirSync(stage, { recursive: true })
  let inner = stage
  if (file.endsWith('.zip')) {
    run('unzip', ['-q', file, '-d', stage])
    // unzip cannot strip: descend one level exactly when asked and able.
    const staged = readdirSync(stage).toSorted(compareStrings)
    if (level === 1 && staged.length === 1) {
      const only = path.join(stage, staged[0])
      if (lstatSync(only).isDirectory()) inner = only
    }
  } else {
    const args = ['-xf', file, '-C', stage]
    if (level === 1) args.push('--strip-components=1')
    run('tar', args)
  }
  const moved = readdirSync(inner).toSorted(compareStrings)
  const placed = []
  for (const entry of moved) {
    const from = path.join(inner, entry)
    const to = path.join(dest, entry)
    if (existsSync(to)) throw new Error(`shared destination collides on ${entry}`)
    run('mv', [from, to])
    placed.push(to)
  }
  removeTree(stage)
  // A hostile archive's symlinks must not escape the layer.
  for (const relative of walkFiles(dest)) {
    const full = path.join(dest, relative)
    if (!lstatSync(full).isSymbolicLink()) continue
    const target = path.resolve(path.dirname(full), readlinkSync(full))
    if (target !== dest && !target.startsWith(`${dest}${path.sep}`)) {
      throw new Error(`archive symlink escapes the layer: ${relative}`)
    }
  }
  return placed
}

/** One `bin` pattern (a basename, one `*` allowed) as a name test. */
function binMatcher(pattern) {
  const star = pattern.indexOf('*')
  if (star !== pattern.lastIndexOf('*')) {
    throw new Error(`bin pattern allows one wildcard: ${pattern}`)
  }
  if (star === -1) return (name) => name === pattern
  const head = pattern.slice(0, star)
  const tail = pattern.slice(star + 1)
  return (name) =>
    name.length >= head.length + tail.length && name.startsWith(head) && name.endsWith(tail)
}

/** A `java -jar` launcher, relocatable with the layer. */
function writeJarWrapper(root, jar, name) {
  const binDir = path.join(root, 'usr', 'local', 'bin')
  mkdirSync(binDir, { recursive: true })
  const wrapper = path.join(binDir, name)
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec java -jar "$(dirname "$0")/${path.relative(binDir, jar)}" "$@"\n`,
  )
  chmodSync(wrapper, 0o755)
}

/** A bare binary installs straight into the layer's bin dir, renamed by `bin`. */
function installBareBinary(declared, upstream, root, out, links) {
  if (declared.dest !== undefined || declared.strip !== undefined) {
    throw new Error(`${upstream.name}: dest/strip are meaningless on a bare binary`)
  }
  if (declared.bin !== undefined && declared.bin.length !== 1) {
    throw new Error(`${upstream.name}: a bare binary takes exactly one bin rename`)
  }
  const file = path.join(out, upstream.file)
  const rename = declared.bin?.[0]
  if (rename !== undefined && !binMatcher(rename.name)(path.basename(file))) {
    throw new Error(`${upstream.name}: ${path.basename(file)} matches no bin pattern`)
  }
  const binDir = path.join(root, 'usr', 'local', 'bin')
  mkdirSync(binDir, { recursive: true })
  const installed = path.join(binDir, rename?.as ?? path.basename(file))
  if (existsSync(installed)) throw new Error(`bin ${path.basename(installed)} installed twice`)
  copyFileSync(file, installed)
  chmodSync(installed, 0o755)
  links.bins.set(path.basename(installed), path.relative(root, installed))
  links.from.add('usr/local/bin')
}

/** Install one locked upstream: place its files, run its command, link its bins. */
function installUpstream(declared, upstream, root, out, links) {
  const file = path.join(out, upstream.file)
  const dest = path.join(root, declared.dest ?? `opt/${upstream.name}`)
  if (!file.endsWith('.jar') && !isArchive(file)) {
    installBareBinary(declared, upstream, root, out, links)
    return
  }
  let placed
  if (file.endsWith('.jar')) {
    removeTree(dest)
    mkdirSync(dest, { recursive: true })
    const jar = path.join(dest, path.basename(file))
    copyFileSync(file, jar)
    placed = [jar]
  } else {
    placed = extractArchive(file, dest, declared.strip)
    if (declared.install !== undefined) {
      const [command, ...rest] = declared.install.map((arg) =>
        arg.replaceAll('{prefix}', () => root),
      )
      run(command, rest, { cwd: dest })
      // The installer copied out what the layer needs; the source
      // tree stays out of the layer (and off LD_LIBRARY_PATH).
      removeTree(dest)
      return
    }
  }
  linkUpstreamBins(declared, upstream, dest, placed, root, links)
}

/** Path segments below the destination (shallower wins a bin search). */
function pathDepth(relative) {
  return relative.split('/').length
}

/** A file the default rule links: a symlink, or anything executable. */
function isLinkable(full) {
  const stat = lstatSync(full)
  return !stat.isDirectory() && (stat.isSymbolicLink() || (stat.mode & 0o111) !== 0)
}

/**
Link an extracted upstream's bins: explicit entries search the whole
destination (shared-safe: names are unique), while the default rule
scopes to the children this archive placed, so a shared destination
never links a sibling's bins.
*/
function linkUpstreamBins(declared, upstream, dest, placed, root, links) {
  if (declared.bin !== undefined && declared.bin.length === 0) return
  if (declared.bin === undefined && declared.install !== undefined) return
  if (declared.bin !== undefined) {
    const entries = declared.bin
    for (const entry of entries) {
      const matches = binMatcher(entry.name)
      const found = walkFiles(dest).filter((relative) => matches(path.basename(relative)))
      if (found.length === 0) throw new Error(`${upstream.name}: bin ${entry.name} matches nothing`)
      // Nested copies (corepack shims) lose to the top-level binary.
      const shallowest = Math.min(...found.map((relative) => pathDepth(relative)))
      const winners = found.filter((relative) => pathDepth(relative) === shallowest)
      if (winners.length !== 1) {
        throw new Error(
          `${upstream.name}: bin ${entry.name} matches ${String(winners.length)} files (${winners.join(', ')})`,
        )
      }
      const target = path.join(dest, winners[0])
      if (target.endsWith('.jar')) {
        writeJarWrapper(root, target, entry.as)
        links.bins.set(entry.as, path.relative(root, target))
      } else {
        chmodSync(target, 0o755)
        linkBin(root, target, entry.as, links)
      }
      links.from.add(path.relative(root, dest))
    }
    return
  }
  if (placed.length === 0) {
    throw new Error(`${upstream.name}: nothing extracted to ${path.relative(root, dest)}`)
  }
  const candidates = []
  for (const child of placed) {
    if (!lstatSync(child).isDirectory()) {
      if (isLinkable(child)) {
        candidates.push(child)
        links.from.add(path.relative(root, dest))
      }
      continue
    }
    const bindir = path.join(child, 'bin')
    const scope =
      lstatSync(bindir, { throwIfNoEntry: false })?.isDirectory() === true ? bindir : child
    const from = candidates.length
    const entries = readdirSync(scope).toSorted(compareStrings)
    for (const entry of entries) {
      const full = path.join(scope, entry)
      if (scope === bindir ? !lstatSync(full).isDirectory() : isLinkable(full)) {
        candidates.push(full)
      }
    }
    if (candidates.length > from) links.from.add(path.relative(root, scope))
  }
  if (candidates.length === 0) {
    const top = placed.map((child) => path.basename(child)).join(', ')
    throw new Error(
      `${upstream.name}: no binaries to link in ${path.relative(root, dest)} (${top})`,
    )
  }
  for (const candidate of candidates) linkBin(root, candidate, path.basename(candidate), links)
}

/**
Extract the locked .debs into the layer. Their bins stay in the deb
bindirs (on the manifest PATH), never linked elsewhere: gcc and
valgrind find their runtimes relative to their own path, and a
symlink into another prefix would break them.
*/
function installApt(locked, root, out, links) {
  const entries = locked.apt ?? []
  if (entries.length === 0) return
  const bindirs = ['usr/bin', 'usr/sbin', 'bin', 'sbin']
  const before = new Set()
  for (const dir of bindirs) {
    const relatives = walkFiles(path.join(root, dir))
    for (const relative of relatives) before.add(`${dir}/${relative}`)
  }
  for (const entry of entries) {
    run('dpkg-deb', ['-x', path.join(out, entry.file), root])
  }
  for (const dir of bindirs) {
    const full = path.join(root, dir)
    const relatives = walkFiles(full)
    const gained = relatives.some((relative) => !before.has(`${dir}/${relative}`))
    if (gained) links.from.add(dir)
  }
}

/** The arch-matching declared upstream for a locked name. */
function declaredEntryFor(definition, name, arch) {
  return definition.upstream.find(
    (entry) =>
      entry.name === name &&
      (entry.platforms === undefined || entry.platforms.some((platform) => platform.arch === arch)),
  )
}

/** Where an upstream's tree lives under the layer root. */
function upstreamDest(declared, name) {
  return declared?.dest ?? `opt/${name}`
}

/** The layer's own binary, or the runner's from PATH (recorded either way). */
function layerOrRunner(root, layerBinary, command) {
  if (layerBinary !== undefined && existsSync(layerBinary)) {
    return { binary: layerBinary, origin: 'layer' }
  }
  const found = run('sh', ['-c', `command -v ${command}`]).trim()
  if (found === '') throw new Error(`no ${command} in the layer or on the runner`)
  return { binary: found, origin: 'runner' }
}

/** Find the `uv` binary the layer carries (every uv pack pins it). */
function layerUv(definition, arch, root) {
  const declared = declaredEntryFor(definition, 'uv', arch)
  if (declared === undefined)
    throw new Error(`${definition.name} manages uv tools without a uv pin`)
  const dest = path.join(root, upstreamDest(declared, 'uv'))
  const matches = walkFiles(dest).filter((relative) => path.basename(relative) === 'uv')
  if (matches.length !== 1) throw new Error(`uv binary not unique in ${path.relative(root, dest)}`)
  return path.join(dest, matches[0])
}

/** The python a layer carries under its uv install dir, if any. */
function layerPython(root) {
  const home = path.join(root, 'opt', 'uv', 'python')
  const installs = existsSync(home) ? readdirSync(home).toSorted(compareStrings) : []
  for (const install of installs) {
    const bindir = path.join(home, install, 'bin')
    if (!existsSync(bindir)) continue
    const pythons = readdirSync(bindir)
      .toSorted(compareStrings)
      .filter((entry) => entry === 'python3' || /^python3\.\d+$/.test(entry))
    if (pythons.length > 0) return path.join(bindir, pythons[0])
  }
}

/**
Install the managed tools: npm and cargo through the layer's own
toolchain when the pack carries one (else the runner's, recorded),
Go the same way, uv through the layer's pinned uv, rustup through
the locked installer, PowerShell modules unzipped into place. The
first managed rust entry is the default toolchain.
*/
async function installManaged(definition, locked, arch, root, out) {
  const bootstrap = {}
  const usrLocal = path.join(root, 'usr', 'local')
  const managed = locked.managed ?? {}
  const npmTools = managed.npm ?? []
  if (npmTools.length > 0) {
    const nodeUpstream = definition.upstream.find(
      (entry) =>
        entry.name.startsWith('node-') &&
        (entry.platforms === undefined ||
          entry.platforms.some((platform) => platform.arch === arch)),
    )
    const layerNode =
      nodeUpstream === undefined
        ? undefined
        : path.join(root, upstreamDest(nodeUpstream, nodeUpstream.name), 'bin', 'node')
    const node = layerOrRunner(root, layerNode, 'node')
    const nodeVersion = run(node.binary, ['--version']).trim()
    bootstrap.node = `${node.origin}:${nodeUpstream?.name ?? node.binary} (${nodeVersion})`
    const npmBin = path.join(path.dirname(node.binary), 'npm')
    for (const tool of npmTools) {
      run(npmBin, ['install', '-g', '--prefix', usrLocal, path.join(out, tool.file)], {
        env: { ...process.env, PATH: `${path.dirname(node.binary)}:${process.env.PATH}` },
      })
    }
  }
  const rustTools = managed.rust ?? []
  if (rustTools.length > 0) {
    const installer = path.join(root, 'usr', 'local', 'bin', 'rustup-init')
    if (!existsSync(installer))
      throw new Error(`${definition.name} manages rust without rustup-init`)
    const rustupHome = path.join(root, 'opt', 'rust', 'rustup')
    const cargoHome = path.join(root, 'opt', 'rust', 'cargo')
    const env = { ...process.env, RUSTUP_HOME: rustupHome, CARGO_HOME: cargoHome }
    const [first, ...rest] = rustTools
    run(
      installer,
      ['--no-modify-path', '--profile', 'minimal', '--default-toolchain', first.version, '-y'],
      { env },
    )
    const rustup = path.join(cargoHome, 'bin', 'rustup')
    for (const tool of rest) run(rustup, ['toolchain', 'install', tool.version], { env })
    bootstrap.rust = `layer:rustup (${run(path.join(cargoHome, 'bin', 'rustc'), ['--version'], { env }).trim()})`
  }
  const cargoTools = managed.cargo ?? []
  if (cargoTools.length > 0) {
    const cargo = layerOrRunner(
      root,
      path.join(root, 'opt', 'rust', 'cargo', 'bin', 'cargo'),
      'cargo',
    )
    const env =
      cargo.origin === 'layer'
        ? {
            ...process.env,
            RUSTUP_HOME: path.join(root, 'opt', 'rust', 'rustup'),
            CARGO_HOME: path.join(root, 'opt', 'rust', 'cargo'),
          }
        : process.env
    for (const tool of cargoTools) {
      run(cargo.binary, ['install', '--root', usrLocal, '--version', tool.version, tool.name], {
        env,
      })
    }
    bootstrap.cargo = `${cargo.origin}:${cargo.binary} (${run(cargo.binary, ['--version'], { env }).trim()})`
  }
  const goTools = managed.go ?? []
  if (goTools.length > 0) {
    const declared = declaredEntryFor(definition, 'go', arch)
    const layerGo =
      declared === undefined
        ? undefined
        : path.join(root, upstreamDest(declared, 'go'), 'bin', 'go')
    const go = layerOrRunner(root, layerGo, 'go')
    const sandbox = path.join(out, 'tmp', `${definition.name}-${arch}-go`)
    removeTree(sandbox)
    mkdirSync(sandbox, { recursive: true })
    const env = {
      ...process.env,
      GOBIN: path.join(usrLocal, 'bin'),
      GOCACHE: path.join(sandbox, 'cache'),
      GOPATH: path.join(sandbox, 'path'),
      GOTOOLCHAIN: 'local',
    }
    if (go.origin === 'layer') env.GOROOT = path.join(root, upstreamDest(declared, 'go'))
    for (const tool of goTools) {
      run(go.binary, ['install', `${tool.module}@${tool.canonical ?? tool.version}`], { env })
    }
    bootstrap.go = `${go.origin}:${go.binary} (${run(go.binary, ['version']).trim()})`
  }
  const uvPythons = managed.uvPythons ?? []
  const uvToolEntries = managed.uvTools ?? []
  if (uvPythons.length > 0 || uvToolEntries.length > 0) {
    const uv = layerUv(definition, arch, root)
    const uvHome = path.join(root, 'opt', 'uv', 'home')
    // A fresh cache per layer: uv hardlinks cache entries into the
    // venv, so one poisoned entry (a semgrep-core without its exec
    // bit, 2026-10-22) breaks every later build that reuses it.
    const uvCache = path.join(out, 'tmp', `${definition.name}-${arch}-uvcache`)
    removeTree(uvCache)
    const env = {
      ...process.env,
      HOME: uvHome,
      UV_CACHE_DIR: uvCache,
      UV_PYTHON_INSTALL_DIR: path.join(root, 'opt', 'uv', 'python'),
      UV_TOOL_DIR: path.join(root, 'opt', 'uv', 'tools'),
      UV_TOOL_BIN_DIR: path.join(usrLocal, 'bin'),
    }
    for (const tool of uvPythons) run(uv, ['python', 'install', tool.version], { env })
    if (uvPythons.length > 0 && layerPython(root) === undefined) {
      throw new Error(`${definition.name} installed python where the build cannot find it`)
    }
    let python = layerPython(root)
    if (python === undefined) {
      const requires = definition.requires ?? []
      for (const name of requires) {
        python = layerPython(path.join(out, 'layers', `${name}-${arch}`))
        if (python !== undefined) break
      }
    }
    if (python === undefined && uvToolEntries.length > 0) {
      throw new Error(`${definition.name} installs uv tools without a python to run them on`)
    }
    if (python !== undefined && uvPythons.length > 0) {
      const binDir = path.join(usrLocal, 'bin')
      for (const name of ['python', 'python3']) {
        if (!existsSync(path.join(binDir, name))) {
          symlinkSync(path.relative(binDir, python), path.join(binDir, name))
        }
      }
    }
    for (const tool of uvToolEntries) {
      run(uv, ['tool', 'install', '--python', python, path.join(out, tool.file)], { env })
    }
    // Whatever the uv version honours (UV_TOOL_BIN_DIR or HOME), the
    // bins end up on the layer PATH.
    const homeBin = path.join(uvHome, '.local', 'bin')
    if (existsSync(homeBin)) {
      const entries = readdirSync(homeBin).toSorted(compareStrings)
      for (const entry of entries) {
        const link = path.join(usrLocal, 'bin', entry)
        if (!existsSync(link)) {
          symlinkSync(path.relative(path.dirname(link), path.join(homeBin, entry)), link)
        }
      }
    }
    bootstrap.uv = `layer:uv (${run(uv, ['--version']).trim()})`
  }
  const psGalleryTools = managed.psGallery ?? []
  if (psGalleryTools.length > 0) {
    const modules = path.join(root, 'opt', 'powershell', 'modules')
    for (const tool of psGalleryTools) {
      const stage = path.join(out, 'tmp', `${definition.name}-${arch}-${tool.name}`)
      removeTree(stage)
      mkdirSync(stage, { recursive: true })
      run('unzip', ['-q', path.join(out, tool.file), '-d', stage])
      const psd1 = walkFiles(stage).filter((relative) => relative.endsWith('.psd1'))
      if (!psd1.includes(`${tool.name}.psd1`)) {
        throw new Error(`${tool.name} nupkg has no top-level module manifest (${psd1.join(', ')})`)
      }
      const dest = path.join(modules, tool.name, tool.version)
      removeTree(dest)
      mkdirSync(dest, { recursive: true })
      const entries = readdirSync(stage).toSorted(compareStrings)
      for (const entry of entries) {
        if (
          entry === '_rels' ||
          entry === 'package' ||
          entry === '[Content_Types].xml' ||
          entry.endsWith('.nuspec')
        ) {
          continue
        }
        run('mv', [path.join(stage, entry), path.join(dest, entry)])
      }
      removeTree(stage)
    }
  }
  return bootstrap
}

/**
Write the layer manifest: the tools, the PATH and library dirs, the
environment the tools need (`${LAYER}` expands to the mount point),
and which toolchain built what. The worker (M110a) and the sandboxes
(M110b) compose it; smoke runs it first.
*/
function writeManifest(definition, locked, arch, root, bootstrap, links) {
  const binDirs = ['usr/local/bin']
  for (const dir of links.from) {
    if (dir !== 'usr/local/bin' && !binDirs.includes(dir)) binDirs.push(dir)
  }
  const manifest = {
    pack: definition.name,
    version: definition.version,
    arch,
    tools: locked.tools,
    // Venv shims bake this prefix; the installer rewrites it on relocate.
    buildRoot: root,
    binDirs,
    libDirs: [],
    env: {},
    envAppend: {},
    bootstrap,
  }
  const opt = path.join(root, 'opt')
  const names = existsSync(opt) ? readdirSync(opt).toSorted(compareStrings) : []
  for (const name of names) {
    for (const lib of ['lib', 'lib64']) {
      if (existsSync(path.join(opt, name, lib))) manifest.libDirs.push(`opt/${name}/${lib}`)
    }
  }
  // The bundled apt closure's libraries (libc excepted: the base owns it).
  const triplet = arch === 'arm64' ? 'aarch64-linux-gnu' : 'x86_64-linux-gnu'
  for (const dir of [`usr/lib/${triplet}`, 'usr/lib']) {
    if (existsSync(path.join(root, dir))) manifest.libDirs.push(dir)
  }
  if (existsSync(path.join(root, 'opt', 'android-sdk'))) {
    manifest.env.ANDROID_HOME = '${LAYER}/opt/android-sdk'
    manifest.env.ANDROID_SDK_ROOT = '${LAYER}/opt/android-sdk'
  }
  if (existsSync(path.join(root, 'opt', 'rust', 'cargo'))) {
    manifest.env.RUSTUP_HOME = '${LAYER}/opt/rust/rustup'
    manifest.env.CARGO_HOME = '${LAYER}/opt/rust/cargo'
    manifest.binDirs.push('opt/rust/cargo/bin')
  }
  if (existsSync(path.join(root, 'opt', 'powershell', 'modules'))) {
    manifest.envAppend.PSModulePath = '${LAYER}/opt/powershell/modules'
  }
  // Debian's valgrind wrapper otherwise searches the host's libexec.
  if (existsSync(path.join(root, 'usr', 'libexec', 'valgrind'))) {
    manifest.env.VALGRIND_LIB = '${LAYER}/usr/libexec/valgrind'
  }
  for (const name of names) {
    if (existsSync(path.join(opt, name, 'bin', 'java')) && manifest.env.JAVA_HOME === undefined) {
      manifest.env.JAVA_HOME = `\${LAYER}/opt/${name}`
    }
  }
  writeFileSync(path.join(root, 'pack.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** The pack and its requires, requires-first (the composition the node installs). */
function smokeClosure(definition, out, arch) {
  const ordered = []
  const seen = new Set()
  const visit = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    const manifest = JSON.parse(
      readFileSync(path.join(out, 'layers', `${name}-${arch}`, 'pack.json'), 'utf8'),
    )
    const defFile = path.join(PACKS_DIR, `${name}.json`)
    const requires = JSON.parse(readFileSync(defFile, 'utf8')).requires ?? []
    for (const dep of requires) visit(dep)
    ordered.push({ name, manifest, root: path.join(out, 'layers', `${name}-${arch}`) })
  }
  const ownRequires = definition.requires ?? []
  for (const dep of ownRequires) visit(dep)
  return ordered
}

/** Run the smoke commands with the closure's bins, libraries and environment. */
/** Expand `${LAYER}` in a manifest value to the layer's root. */
function expandLayer(value, root) {
  return value.replaceAll('${LAYER}', () => root)
}

/**
The smoke environment for the pack and its requires: bins and
libraries first, manifest environment expanded, appends prepended.
`prefix` is the build tree on the host, `/packs` in the container.
*/
function composeSmokeEnv(definition, arch, out, manifest, prefix, baseEnv) {
  const layers = [...smokeClosure(definition, out, arch)]
  const pathDirs = []
  const libDirs = []
  const env = { ...baseEnv }
  const appends = {}
  const ownRoot = path.join(prefix, 'layers', `${definition.name}-${arch}`)
  const all = [
    ...layers.map((layer) => ({
      ...layer,
      root: path.join(prefix, 'layers', `${layer.name}-${arch}`),
    })),
    { name: definition.name, manifest, root: ownRoot },
  ]
  for (const layer of all) {
    const binDirs = layer.manifest.binDirs ?? []
    for (const dir of binDirs) pathDirs.push(path.join(layer.root, dir))
    const libDirList = layer.manifest.libDirs ?? []
    for (const dir of libDirList) libDirs.push(path.join(layer.root, dir))
  }
  for (const layer of all) {
    const sets = Object.entries(layer.manifest.env ?? {})
    for (const [key, value] of sets) {
      env[key] = expandLayer(value, layer.root)
    }
    const appendEntries = Object.entries(layer.manifest.envAppend ?? {})
    for (const [key, value] of appendEntries) {
      const expanded = expandLayer(value, layer.root)
      appends[key] = appends[key] === undefined ? expanded : `${appends[key]}:${expanded}`
    }
  }
  for (const [key, value] of Object.entries(appends)) {
    env[key] = env[key] === undefined ? value : `${value}:${env[key]}`
  }
  env.PATH = `${pathDirs.join(':')}:${baseEnv.PATH}`
  if (libDirs.length > 0) {
    env.LD_LIBRARY_PATH =
      baseEnv.LD_LIBRARY_PATH === undefined
        ? libDirs.join(':')
        : `${libDirs.join(':')}:${baseEnv.LD_LIBRARY_PATH}`
  }
  return env
}

function runSmoke(definition, arch, out, manifest) {
  const env = composeSmokeEnv(definition, arch, out, manifest, out, process.env)
  for (const { command } of definition.smoke) {
    const [binary, ...args] = command
    console.log(`smoke ${definition.name}: ${command.join(' ')}`)
    run(binary, args, { env })
  }
}

/**
Smoke the layer in debian:trixie-slim with the build tree mounted
read-only: whatever the layer needs beyond libc and the base must
ride the layer (a missing library means an apt addition, not a
fatter base). The tree is mounted twice: at `/packs`, where the
smoke's PATH and library dirs prove the manifest stays
prefix-relative, and at its own path, where venv content (whose
absolute paths M110a's installer relocates from `buildRoot`)
resolves. Symlink relocatability is asserted at build, not by the
mount. The host's CA bundle is mounted read-only where present:
D90.4's sandbox base carries ca-certificates, and trixie-slim does
not, so the mount stands in for the base's own trust anchors
(semgrep reads only the system paths). Needs docker;
`--smoke-container` asks for it.
*/
function runContainerSmoke(definition, arch, out, manifest) {
  const image = 'debian:trixie-slim'
  const probe = spawnSync('docker', ['inspect', '--format={{.Id}}', image], {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (probe.status !== 0) run('docker', ['pull', image])
  const digest = run('docker', ['inspect', '--format={{.Id}}', image]).trim()
  console.log(`smoke ${definition.name}: container ${image} ${digest}`)
  const baseEnv = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }
  const env = composeSmokeEnv(definition, arch, out, manifest, '/packs', baseEnv)
  const args = ['run', '--rm', '--volume', `${out}:/packs:ro`, '--volume', `${out}:${out}:ro`]
  if (existsSync('/etc/ssl/certs')) args.push('--volume', '/etc/ssl/certs:/etc/ssl/certs:ro')
  args.push('--workdir', '/tmp', '--env', 'HOME=/tmp')
  const entries = Object.entries(env)
  for (const [key, value] of entries) args.push('--env', `${key}=${value}`)
  for (const { command } of definition.smoke) {
    console.log(`smoke ${definition.name}: [container] ${command.join(' ')}`)
    run('docker', [...args, image, ...command])
  }
}

/** Tar the layer deterministically (sorted, fixed owner and mtime, `gzip -n`). */
async function tarLayer(root, mtime, outFile) {
  await new Promise((resolve, reject) => {
    const tar = spawn(
      'tar',
      [
        '--sort=name',
        `--mtime=${mtime}`,
        '--owner=0',
        '--group=0',
        '--numeric-owner',
        '-cf',
        '-',
        '-C',
        root,
        '.',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const gzip = spawn('gzip', ['-n'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const out = createWriteStream(outFile)
    const stderr = []
    tar.stderr.on('data', (chunk) => {
      stderr.push(chunk)
    })
    gzip.stderr.on('data', (chunk) => {
      stderr.push(chunk)
    })
    let tarCode
    let gzipCode
    tar.on('close', (code) => {
      tarCode = code
    })
    gzip.on('close', (code) => {
      gzipCode = code
    })
    tar.on('error', reject)
    gzip.on('error', reject)
    out.on('error', reject)
    // The stream may finish before the processes report: all three gate.
    let isFinished = false
    const settled = () => {
      if (!isFinished || tarCode === undefined || gzipCode === undefined) return
      if (tarCode !== 0 || gzipCode !== 0) {
        reject(
          new Error(
            `tar layer failed (tar ${String(tarCode)}, gzip ${String(gzipCode)}): ${Buffer.concat(stderr).toString('utf8').slice(0, 2000)}`,
          ),
        )
      } else {
        resolve()
      }
    }
    tar.on('close', settled)
    gzip.on('close', settled)
    out.on('finish', () => {
      isFinished = true
      settled()
    })
    tar.stdout.pipe(gzip.stdin)
    gzip.stdout.pipe(out)
  })
}

/**
`index`: merge already-built layers into the index (the publish job
runs this after downloading every matrix leg's outputs). Each
`<pack>-<arch>` pair needs its lock and its layer blob; the blobs
re-hash here, so the signed digests match the uploaded bytes.
*/
async function emitIndex(options) {
  const out = options.out ?? path.join(REPO_ROOT, 'temp', 'pack-build')
  const arches = selectArches(options)
  const ordered = selectDefinitions(options)
  const built = []
  for (const definition of ordered) {
    for (const arch of arches) {
      const lockFile = path.join(out, 'locks', `${definition.name}-${arch}.json`)
      const layerFile = path.join(out, 'layers', `${definition.name}-${arch}.tar.gz`)
      if (!existsSync(lockFile) || !existsSync(layerFile)) continue
      const hashed = await hashFile(layerFile)
      built.push({
        definition,
        arch,
        file: path.relative(out, layerFile),
        sha256: hashed.sha256,
        sizeBytes: hashed.sizeBytes,
      })
    }
  }
  if (built.length === 0) throw new Error('no built layers to index')
  writeIndex(ordered, built, options, out)
}

/**
Emit the index content the pack CI signs: every selected pack with
its locked layer artifacts, tools and gates. `--tag` stamps the
release asset URLs (predictable, so the signed bytes match the
upload); without it the artifacts point at the local build. Revisions
come from `--revision` (the CI run number, monotonic); the index
expires 90 days after the build.
*/
function writeIndex(ordered, built, options, out) {
  const byPack = Map.groupBy(built, (layer) => layer.definition.name)
  const baseUrl =
    options.tag === undefined
      ? undefined
      : `https://github.com/RandyNorthrup/muse-spark-code/releases/download/${options.tag}`
  if (options.revision !== undefined && !/^\d+$/.test(options.revision)) {
    throw new TypeError(`bad revision ${options.revision}`)
  }
  const revision = options.revision === undefined ? 0 : Number(options.revision)
  if (!Number.isSafeInteger(revision)) throw new TypeError(`bad revision ${options.revision}`)
  const builtAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + INDEX_TTL_MS).toISOString()
  const packs = []
  for (const definition of ordered) {
    const layers = byPack.get(definition.name) ?? []
    if (layers.length === 0) continue
    const artifacts = layers.map((layer) => ({
      name: definition.name,
      version: definition.version,
      url: baseUrl === undefined ? layer.file : `${baseUrl}/${path.basename(layer.file)}`,
      sha256: layer.sha256,
      sizeBytes: layer.sizeBytes,
      platforms: [{ os: 'linux', arch: layer.arch }],
    }))
    const lockFile = path.join(out, 'locks', `${definition.name}-${layers[0].arch}.json`)
    const tools = JSON.parse(readFileSync(lockFile, 'utf8')).tools.map((tool) => ({
      name: tool.name,
      version: tool.version,
    }))
    packs.push({
      name: definition.name,
      version: definition.version,
      description: definition.description,
      license: definition.license,
      languages: definition.languages,
      requires: definition.requires,
      artifacts,
      tools,
      checks: definition.checks,
      constraints: definition.constraints,
      clickThrough: definition.clickThrough,
      checkedAt: definition.checkedAt,
    })
  }
  const index = {
    version: 1,
    builtAt,
    expiresAt,
    builtBy: options['built-by'] ?? 'local',
    revision,
    packs,
  }
  const indexFile = path.join(out, 'index.json')
  writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`)
  console.log(`index ${packs.length} packs, revision ${String(revision)}, expires ${expiresAt}`)
}

/** Compare dotted versions numerically, build suffixes included. */
function comparePinned(left, right) {
  const split = (version) => {
    const [core, build = ''] = version.split('+', 2)
    return { parts: core.split('.').map(Number), build }
  }
  const a = split(left)
  const b = split(right)
  const width = Math.max(a.parts.length, b.parts.length)
  for (let index = 0; index < width; index += 1) {
    const diff = (a.parts[index] ?? 0) - (b.parts[index] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  if (a.build === b.build) return 0
  const isNumeric = /^\d+$/.test(a.build) && /^\d+$/.test(b.build)
  if (isNumeric) return Number(a.build) < Number(b.build) ? -1 : 1
  return a.build < b.build ? -1 : 1
}

/** The latest release tag, via the redirect (no API rate limit). */
async function githubLatestTag(owner, repo) {
  const response = await fetchUrl(`https://github.com/${owner}/${repo}/releases/latest`, {
    method: 'HEAD',
  })
  if (response.status < 200 || response.status >= 400) {
    throw new Error(`HTTP ${response.status} resolving ${owner}/${repo} latest`)
  }
  return response.url.split('/').pop()
}

/** A dotted version out of a release tag (`v4.4.4`, `llvmorg-23.1.4`). */
function versionFromTag(tag) {
  return /(\d+\.\d+(?:\.\d+)?(?:\.\d+)?)/.exec(tag)?.[1]
}

/**
The newest upstream a pinned URL's publisher offers, or undefined
when the publisher has no queryable latest (the pin still locks).
*/
async function latestUpstream(url, sources) {
  if (url.includes('nodejs.org/dist/')) {
    const major = /\/v(\d+)\./.exec(url)?.[1]
    if (sources.nodeIndex === undefined) {
      const response = await fetchUrl('https://nodejs.org/dist/index.json')
      sources.nodeIndex = JSON.parse(response.bytes.toString('utf8'))
    }
    const index = sources.nodeIndex
    const versions = index
      .map((entry) => entry.version.slice(1))
      .filter((version) => version.startsWith(`${major}.`))
      .toSorted(comparePinned)
    return versions.pop()
  }
  if (url.startsWith('https://go.dev/dl/') || url.startsWith('https://golang.org/dl/')) {
    sources.goJson ??= await fetchGoJson()
    return sources.goJson.find((entry) => entry.stable)?.version?.replace(/^go/, '')
  }
  if (url.startsWith('https://dl.google.com/android/repository/')) {
    // Repository XML revisions have no "latest" channel per se; the
    // refresh compares against the newest revision the XML carries.
    sources.androidEntries ??= await fetchAndroidXml()
    const file = url.split('/').pop()
    const stem = file.replace(/_linux\.zip$/, '').replace(/\.zip$/, '')
    const matches = sources.androidEntries.filter((entry) => entry.url.startsWith(stem))
    return matches.length === 0
      ? undefined
      : matches
          .map((entry) => `${String(entry.major)}.${String(entry.minor)}.${String(entry.micro)}`)
          .toSorted(comparePinned)
          .pop()
  }
  if (url.includes('builds.dotnet.microsoft.com/dotnet/')) {
    const major = /\/dotnet\/\w+\/(\d+)\./.exec(url)?.[1]
    if (major === undefined) return
    sources.dotnetReleases[major] ??= await fetchDotnetReleases(major)
    const sdks = sources.dotnetReleases[major]
      .flatMap((release) => release.sdk?.version ?? [])
      .toSorted(comparePinned)
    return sdks.pop()
  }
  const github = /github\.com\/([^/]+)\/([^/]+)\/(?:releases\/download|archive\/refs\/tags)\//.exec(
    url,
  )
  if (github !== null) {
    const tag = await githubLatestTag(github[1], github[2])
    return versionFromTag(tag) ?? tag
  }
  if (url.startsWith('https://get.helm.sh/')) {
    const tag = await githubLatestTag('helm', 'helm')
    return versionFromTag(tag) ?? tag
  }
  if (url.startsWith('https://dl.k8s.io/release/')) {
    // kubectl pins a minor line; each line has its own stable pointer.
    const minor = /\/v(\d+\.\d+)\.\d+\//.exec(url)?.[1]
    if (minor === undefined) return
    const response = await fetchUrl(`https://dl.k8s.io/release/stable-${minor}.txt`)
    return response.status === 200
      ? response.bytes.toString('utf8').trim().replace(/^v/, '')
      : undefined
  }
  if (url.startsWith('https://services.gradle.org/')) {
    const response = await fetchUrl('https://services.gradle.org/versions/current')
    return response.status === 200 ? JSON.parse(response.bytes.toString('utf8')).version : undefined
  }
  if (url.includes('dlcdn.apache.org/maven/')) {
    const response = await fetchUrl(
      'https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/maven-metadata.xml',
    )
    if (response.status !== 200) return
    // Maven's <release> follows milestones; pins track stable only.
    const found = response.bytes.toString('utf8').matchAll(/<version>([^<]+)<\/version>/g)
    const stable = found
      .map((match) => match[1])
      .filter((version) => /^[\d.]+$/.test(version))
      .toArray()
      .toSorted(comparePinned)
    return stable.pop()
  }
  if (url.startsWith('https://static.rust-lang.org/rustup/')) {
    const tag = await githubLatestTag('rust-lang', 'rustup')
    return versionFromTag(tag) ?? tag
  }
  if (url.includes('api.adoptium.net') || url.includes('github.com/adoptium/')) {
    const feature = /OpenJDK(\d+)U/.exec(url)?.[1] ?? /feature\/(\d+)/.exec(url)?.[1]
    if (feature === undefined) return
    sources.temurin ??= {}
    if (sources.temurin[feature] === undefined) {
      const response = await fetchUrl(
        `https://api.adoptium.net/v3/assets/feature_releases/${feature}/ga?architecture=x64&heap_size=normal&image_type=jdk&jvm_impl=hotspot&os=linux&page=0&page_size=1&project=jdk&sort_order=DESC&vendor=eclipse`,
      )
      sources.temurin[feature] = JSON.parse(response.bytes.toString('utf8'))
    }
    const release = sources.temurin[feature][0]
    const version = release?.version_data
    if (version === undefined) return
    return `${version.major}.${version.minor}.${version.security}${version.build === 0 ? '' : `+${String(version.build)}`}`
  }
  return
}

/**
Whether `version` satisfies every clause of a `>=`, `<=`, `>`, `<`,
`=` comma-separated range (the build side of definition.ts).
*/
function satisfiesRange(version, range) {
  const clauses = range
    .split(',')
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '')
  if (clauses.length === 0) return false
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=)?\s*(\d+(\.\d+)*(-[0-9A-Za-z.]+)?(\+[0-9A-Za-z.]+)?)$/.exec(clause)
    if (match === null) return false
    const order = comparePinned(version, match[2])
    switch (match[1] ?? '=') {
      case '=': {
        return order === 0
      }
      case '>': {
        return order > 0
      }
      case '>=': {
        return order >= 0
      }
      case '<': {
        return order < 0
      }
      case '<=': {
        return order <= 0
      }
      default: {
        return false
      }
    }
  })
}

/** The newest registry version for a managed tool. */
async function latestManaged(kind, tool, sources) {
  if (kind === 'npm') {
    const response = await fetchUrl(`https://registry.npmjs.org/${tool.name}/latest`)
    if (response.status !== 200) throw new Error(`npm ${tool.name} missing`)
    return JSON.parse(response.bytes.toString('utf8')).version
  }
  if (kind === 'uvTools') {
    const response = await fetchUrl(`https://pypi.org/pypi/${tool.name}/json`)
    if (response.status !== 200) throw new Error(`pypi ${tool.name} missing`)
    return JSON.parse(response.bytes.toString('utf8')).info.version
  }
  if (kind === 'cargo') {
    const response = await fetchUrl(`https://crates.io/api/v1/crates/${tool.name}`)
    if (response.status !== 200) throw new Error(`crates ${tool.name} missing`)
    return JSON.parse(response.bytes.toString('utf8')).crate.max_version
  }
  if (kind === 'go') {
    const cut = tool.module.lastIndexOf('/cmd/')
    const module = cut === -1 ? tool.module : tool.module.slice(0, cut)
    const response = await fetchUrl(`https://proxy.golang.org/${module}/@latest`)
    if (response.status !== 200) throw new Error(`go ${tool.module} missing`)
    return JSON.parse(response.bytes.toString('utf8')).Version
  }
  if (kind === 'psGallery') {
    const response = await fetchUrl(
      `https://www.powershellgallery.com/api/v2/Packages()?$filter=Id eq '${tool.name}' and IsLatestVersion and IsPrerelease eq false&$select=Version`,
    )
    if (response.status !== 200) throw new Error(`psgallery ${tool.name} missing`)
    const version = /<d:Version>([^<]+)<\/d:Version>/.exec(response.bytes.toString('utf8'))?.[1]
    if (version === undefined) throw new Error(`psgallery ${tool.name} version missing`)
    return version
  }
  if (kind === 'rust') {
    return tool.version.startsWith('nightly-')
      ? `nightly-${new Date().toISOString().slice(0, 10)}`
      : await rustChannelVersion('stable')
  }
  if (kind !== 'uvPythons') return
  sources.uvPythons ??= await availableUvPythons(sources)
  const minor = tool.version.split('.').slice(0, 2).join('.')
  const versions = sources.uvPythons
    .filter((version) => version.startsWith(`${minor}.`))
    .toSorted(comparePinned)
  return versions.pop()
}

/** Every CPython the pinned uv offers, via the pinned uv itself. */
async function availableUvPythons(sources) {
  sources.uvBinary ??= await downloadPinnedUv(sources.definitions)
  const { binary, workdir } = sources.uvBinary
  const output = run(binary, ['python', 'list'], {
    env: { ...process.env, UV_CACHE_DIR: path.join(workdir, 'cache') },
  })
  const found = output.matchAll(
    /^cpython-(\d+\.\d+\.\d+)(?:\+freethreaded)?-linux-\S+\s+<download available>$/gm,
  )
  return [...found].map((match) => match[1])
}

/**
`refresh`: report every pin a newer upstream exists for (the weekly
maintenance loop). Read-only, except `--apply`, which bumps
`checkedAt` on packs with nothing stale. Exits 0 either way: drift
is a report, not a failure.
*/
async function refresh(options) {
  const definitions = loadDefinitions().filter(
    ({ definition }) => options.pack === undefined || definition.name === options.pack,
  )
  const sources = { nodeShasums: {}, dotnetReleases: {}, definitions }
  let stalePacks = 0
  for (const { file, definition } of definitions) {
    let stale = 0
    const seen = new Set()
    for (const upstream of definition.upstream) {
      const key = `${upstream.name}@${upstream.version}`
      if (seen.has(key)) continue
      seen.add(key)
      const latest = await latestUpstream(upstream.url, sources)
      if (latest === undefined) {
        console.log(`${definition.name} ${upstream.name}: unqueryable (${upstream.url})`)
      } else if (comparePinned(upstream.version, latest) < 0) {
        stale += 1
        console.log(`${definition.name} ${upstream.name}: STALE ${upstream.version} -> ${latest}`)
      }
    }
    const managed = definition.managed ?? {}
    const kinds = ['npm', 'cargo', 'uvTools', 'uvPythons', 'go', 'psGallery', 'rust']
    for (const kind of kinds) {
      const tools = managed[kind] ?? []
      for (const tool of tools) {
        const latest = await latestManaged(kind, tool, sources)
        const pinned = tool.version
        const label = tool.name ?? tool.module
        if (latest === undefined) {
          console.log(`${definition.name} ${label}: unqueryable`)
          continue
        }
        const isDrifted =
          kind === 'rust' && pinned.startsWith('nightly-')
            ? pinned !== latest
            : comparePinned(pinned.replace(/^v/, ''), latest.replace(/^v/, '')) < 0
        if (!isDrifted) {
          continue
        }
        const held = (definition.constraints ?? []).find(
          (constraint) =>
            constraint.package === label &&
            !satisfiesRange(latest.replace(/^v/, ''), constraint.range),
        )
        if (held !== undefined) {
          console.log(
            `${definition.name} ${label}: HELD ${pinned} (${latest} outside ${held.range}: ${held.reason})`,
          )
          continue
        }
        stale += 1
        console.log(`${definition.name} ${label}: STALE ${pinned} -> ${latest}`)
      }
    }
    if (definition.apt !== undefined) {
      const ageDays = Math.floor(
        (Date.now() -
          Date.parse(
            definition.apt.snapshot.replace(
              /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,
              '$1-$2-$3T$4:$5:$6Z',
            ),
          )) /
          MS_PER_DAY,
      )
      console.log(
        `${definition.name} apt snapshot ${definition.apt.snapshot}: ${String(ageDays)} days old`,
      )
    }
    if (stale === 0) {
      console.log(`${definition.name}: fresh`)
      if (options.apply === true) {
        const today = new Date().toISOString().slice(0, 10)
        if (definition.checkedAt !== today) {
          const updated = { ...definition, checkedAt: today }
          const defPath = path.join(PACKS_DIR, file)
          const tmp = `${defPath}.tmp`
          writeFileSync(tmp, `${JSON.stringify(updated, null, 2)}\n`)
          renameSync(tmp, defPath)
          console.log(`${definition.name}: checkedAt -> ${today}`)
        }
      }
    } else {
      stalePacks += 1
    }
  }
  console.log(stalePacks === 0 ? 'no drift' : `${String(stalePacks)} packs stale`)
}

/** One locked pack for one arch: tools, files and their hashes. */
async function lockPack(definition, arch, sources) {
  if (!hasArchContent(definition, arch)) {
    console.log(`skip ${definition.name} ${arch} (nothing for this arch)`)
    return
  }
  const managed = definition.managed ?? {}
  const upstreams = []
  for (const upstream of definition.upstream) {
    if (
      upstream.platforms !== undefined &&
      upstream.platforms.every((platform) => !(platform.os === 'linux' && platform.arch === arch))
    ) {
      continue
    }
    const file = path.join(
      sources.out,
      'downloads',
      definition.name,
      arch,
      upstream.url.split('/').pop(),
    )
    const measured = await download(upstream.url, file)
    const published = await publisherHash(upstream.url, upstream.version, sources)
    if (published !== undefined) {
      const actual =
        published.algorithm === 'SHA256'
          ? measured.sha256
          : createHash('sha512').update(readFileSync(file)).digest('hex')
      if (actual !== published.value) {
        throw new Error(
          `hash mismatch for ${upstream.url}: published ${published.algorithm} ${published.value}, measured ${actual}`,
        )
      }
    }
    upstreams.push({
      name: upstream.name,
      version: upstream.version,
      url: upstream.url,
      license: upstream.license,
      sha256: measured.sha256,
      sizeBytes: measured.sizeBytes,
      verified: published === undefined ? 'measured' : 'publisher',
      evidence: published?.evidence,
      file: path.relative(sources.out, file),
    })
  }
  const tools = []
  const toolSeen = new Set()
  const addTool = (name, version, license) => {
    tools.push({ name, version, license })
    toolSeen.add(name)
  }
  for (const upstream of upstreams) {
    if (!toolSeen.has(upstream.name)) addTool(upstream.name, upstream.version, upstream.license)
  }
  const managedLocks = {
    npm: [],
    cargo: [],
    uvTools: [],
    uvPythons: [],
    go: [],
    psGallery: [],
    rust: [],
  }
  const npmTools = managed.npm ?? []
  for (const tool of npmTools) {
    const meta = await npmMetadata(tool.name, tool.version)
    const tarball = path.join(sources.out, 'downloads', definition.name, arch, `${tool.name}.tgz`)
    const measured = await download(meta.tarball, tarball)
    const integrity = /^sha512-([A-Za-z0-9+/=]+)$/.exec(meta.integrity)?.[1]
    if (integrity === undefined) throw new Error(`npm ${tool.name} publishes no sha512 integrity`)
    const actual = createHash('sha512').update(readFileSync(tarball)).digest('hex')
    if (actual !== Buffer.from(integrity, 'base64').toString('hex')) {
      throw new Error(`npm integrity mismatch for ${tool.name}@${tool.version}`)
    }
    managedLocks.npm.push({
      ...tool,
      url: meta.tarball,
      sha256: measured.sha256,
      file: path.relative(sources.out, tarball),
    })
    if (!toolSeen.has(tool.name)) addTool(tool.name, tool.version, tool.license)
  }
  const uvToolEntries = managed.uvTools ?? []
  for (const tool of uvToolEntries) {
    const wheel = await pypiWheel(tool.name, tool.version, arch, sources.pythonVersion)
    const file = path.join(sources.out, 'downloads', definition.name, arch, wheel.filename)
    const measured = await download(wheel.url, file)
    if (measured.sha256 !== wheel.sha256) {
      throw new Error(`hash mismatch for ${wheel.url}`)
    }
    managedLocks.uvTools.push({
      ...tool,
      url: wheel.url,
      sha256: wheel.sha256,
      file: path.relative(sources.out, file),
    })
    if (!toolSeen.has(tool.name)) addTool(tool.name, tool.version, tool.license)
  }
  const uvPythonEntries = managed.uvPythons ?? []
  for (const tool of uvPythonEntries) {
    managedLocks.uvPythons.push({ ...tool })
    if (!toolSeen.has(tool.name)) addTool(tool.name, tool.version, tool.license)
  }
  const cargoTools = managed.cargo ?? []
  for (const tool of cargoTools) {
    const checksum = await cratesChecksum(tool.name, tool.version)
    managedLocks.cargo.push({ ...tool, sha256: checksum })
    if (!toolSeen.has(tool.name)) addTool(tool.name, tool.version, tool.license)
  }
  const goTools = managed.go ?? []
  for (const tool of goTools) {
    const attested = await goZipHash(tool.module, tool.version)
    managedLocks.go.push({ ...tool, ...attested })
    const name = tool.module.split('/').pop()
    const version = tool.version.startsWith('v') ? tool.version.slice(1) : tool.version
    if (!toolSeen.has(name)) addTool(name, version, tool.license)
  }
  const psGalleryTools = managed.psGallery ?? []
  for (const tool of psGalleryTools) {
    const url = `https://www.powershellgallery.com/api/v2/package/${tool.name}/${tool.version}`
    const file = path.join(sources.out, 'downloads', definition.name, arch, `${tool.name}.nupkg`)
    const measured = await download(url, file)
    managedLocks.psGallery.push({
      ...tool,
      url,
      sha256: measured.sha256,
      file: path.relative(sources.out, file),
    })
    if (!toolSeen.has(tool.name)) addTool(tool.name, tool.version, tool.license)
  }
  const rustTools = managed.rust ?? []
  for (const tool of rustTools) {
    const resolved = await rustChannelVersion(tool.version)
    managedLocks.rust.push({ ...tool, resolved })
    if (!toolSeen.has(tool.name)) addTool(tool.name, resolved, tool.license)
  }
  const apt = []
  if (definition.apt !== undefined) {
    const named = definition.apt.packages
    const closure = await resolveAptClosure(
      definition.apt.snapshot,
      named.map((pkg) => pkg.name),
      arch,
      sources,
    )
    for (const { name, auto } of closure) {
      const resolved = await aptResolve(definition.apt.snapshot, name, arch, sources)
      const file = path.join(
        sources.out,
        'downloads',
        definition.name,
        arch,
        resolved.filename.split('/').pop(),
      )
      const measured = await download(resolved.url, file)
      if (measured.sha256 !== resolved.sha256) throw new Error(`hash mismatch for ${resolved.url}`)
      const declared = named.find((pkg) => pkg.name === name)
      apt.push({
        name,
        version: resolved.version,
        license: declared?.license ?? 'NOASSERTION',
        sha256: measured.sha256,
        url: resolved.url,
        auto,
        file: path.relative(sources.out, file),
      })
      if (!auto && declared !== undefined && !toolSeen.has(name)) {
        addTool(name, normalizeDebVersion(resolved.version), declared.license)
      }
    }
  }
  return {
    pack: definition.name,
    version: definition.version,
    arch,
    checkedAt: definition.checkedAt,
    upstreams,
    managed: managedLocks,
    apt,
    tools,
  }
}

/**
The rustc version a Rust channel resolves to, from its channel manifest
(a nightly's date is not its version). A numeric pin must match the
manifest it names.
*/
async function rustChannelVersion(channel) {
  let manifest
  if (channel === 'stable' || channel === 'beta' || /^\d+\.\d+\.\d+$/.test(channel)) {
    manifest = `https://static.rust-lang.org/dist/channel-rust-${channel}.toml`
  } else if (channel.startsWith('nightly-')) {
    const date = channel.slice('nightly-'.length)
    manifest = `https://static.rust-lang.org/dist/${date}/channel-rust-nightly.toml`
  }
  if (manifest === undefined) throw new Error(`unknown rust channel ${channel}`)
  const response = await fetchUrl(manifest)
  if (response.status !== 200) throw new Error(`HTTP ${response.status} fetching ${manifest}`)
  const version = /\[pkg\.rust\][\s\S]*?^version = "([^"]+)"/m.exec(
    response.bytes.toString('utf8'),
  )?.[1]
  if (version === undefined) throw new Error(`no rust version in ${manifest}`)
  const resolved = version.split(' ', 1)[0]
  if (resolved !== channel && /^\d+\.\d+\.\d+$/.test(channel)) {
    throw new Error(`rust ${channel} manifest carries ${resolved}`)
  }
  return resolved
}

/** Normalize a Debian version into the dotted schema shape. */
function normalizeDebVersion(version) {
  const withoutEpoch = version.includes(':') ? version.split(':', 2)[1] : version
  if (/^\d+(\.\d+)*(-[0-9A-Za-z.]+)?(\+[0-9A-Za-z.]+)?$/.test(withoutEpoch)) return withoutEpoch
  const core = /^\d+(\.\d+)*/.exec(withoutEpoch)?.[0] ?? '0'
  const rest = withoutEpoch
    .slice(core.length)
    .replaceAll(/[^0-9A-Za-z]+/g, '.')
    .replaceAll(/^\.+|\.+$/g, '')
  return rest === '' ? core : `${core}+deb.${rest}`
}

/**
A publisher's hash for an upstream URL, where one is published: the
algorithm and the hex digest. Node, Go, Android, .NET and Temurin all
publish theirs; otherwise a `.sha256.txt`/`.sha256` sidecar wins when
the release carries one.
*/
function publishedSha256(value, evidence) {
  return value === undefined
    ? undefined
    : { algorithm: 'SHA256', value: value.toLowerCase(), evidence }
}

async function publisherHash(url, version, sources) {
  if (url.includes('nodejs.org/dist/')) {
    const shasumsUrl = url.slice(0, url.lastIndexOf('/') + 1).concat('SHASUMS256.txt')
    if (sources.nodeShasums[shasumsUrl] === undefined) {
      const shasums = await fetchUrl(shasumsUrl)
      sources.nodeShasums[shasumsUrl] = shasums.bytes.toString('utf8')
    }
    const file = url.split('/').pop()
    const line = sources.nodeShasums[shasumsUrl]
      .split('\n')
      .find((entry) => entry.endsWith(`  ${file}`))
    return publishedSha256(
      line === undefined ? undefined : line.split(' ', 1)[0],
      'nodejs-SHASUMS256.txt',
    )
  }
  if (url.startsWith('https://go.dev/dl/') || url.startsWith('https://golang.org/dl/')) {
    const file = url.split('/').pop()
    return publishedSha256(
      sources.goJson.find((entry) => entry.filename === file)?.sha256,
      'go-dl-json',
    )
  }
  if (url.startsWith('https://dl.google.com/android/repository/')) {
    const file = url.split('/').pop()
    return publishedSha256(
      sources.androidEntries.find((entry) => entry.url === file)?.sha256,
      'android-repository-xml',
    )
  }
  if (url.includes('builds.dotnet.microsoft.com/dotnet/')) {
    const major = /\/dotnet\/\w+\/(\d+)\./.exec(url)?.[1]
    if (major === undefined) return
    sources.dotnetReleases[major] ??= await fetchDotnetReleases(major)
    const releases = sources.dotnetReleases[major]
    for (const release of releases) {
      for (const kind of ['sdk', 'runtime', 'aspnetcore']) {
        const match = release[kind]?.files?.find((entry) => entry.url === url)
        if (match?.hash !== undefined) {
          return {
            algorithm: 'SHA512',
            value: match.hash.toLowerCase(),
            evidence: `dotnet-releases-${major}.0.json`,
          }
        }
      }
    }
    return
  }
  for (const suffix of ['.sha256.txt', '.sha256', '.sha256sum']) {
    const sidecar = await fetchUrl(`${url}${suffix}`)
    if (sidecar.status === 404 || sidecar.status === 410) continue
    if (sidecar.status !== 200) throw new Error(`HTTP ${sidecar.status} fetching ${url}${suffix}`)
    const token = sidecar.bytes.toString('utf8').trim().split(/\s+/, 1)[0]
    if (token !== undefined && /^[0-9a-f]{64}$/i.test(token))
      return publishedSha256(token, `${suffix}-sidecar`)
  }
  return
}

async function fetchGoJson() {
  const response = await fetchUrl('https://go.dev/dl/?mode=json')
  if (response.status !== 200) throw new Error(`HTTP ${response.status} fetching go dl json`)
  return JSON.parse(response.bytes.toString('utf8'))
}

async function fetchDotnetReleases(major) {
  const response = await fetchUrl(
    `https://builds.dotnet.microsoft.com/dotnet/release-metadata/${major}.0/releases.json`,
  )
  if (response.status !== 200) throw new Error(`HTTP ${response.status} fetching dotnet releases`)
  return JSON.parse(response.bytes.toString('utf8')).releases
}

async function npmMetadata(name, version) {
  const response = await fetchUrl(`https://registry.npmjs.org/${name}/${version}`)
  if (response.status !== 200) throw new Error(`npm ${name}@${version} missing`)
  const dist = JSON.parse(response.bytes.toString('utf8')).dist
  return { tarball: dist.tarball, integrity: dist.integrity }
}

/** A Linux wheel (never macOS or Windows). */
function isLinuxWheel(filename) {
  return filename.endsWith('.whl') && !filename.includes('macosx') && !filename.includes('win')
}

/**
The wheel for this arch and interpreter, the universal wheel, or the
sdist, with its PyPI digest. Only Linux wheels qualify; a compiled
wheel must match the layer's Python (or be abi3).
*/
async function pypiWheel(name, version, arch, pythonVersion) {
  const response = await fetchUrl(`https://pypi.org/pypi/${name}/${version}/json`)
  if (response.status !== 200) throw new Error(`pypi ${name}@${version} missing`)
  const files = JSON.parse(response.bytes.toString('utf8')).urls
  const marker = arch === 'arm64' ? 'aarch64' : 'x86_64'
  const tag =
    pythonVersion === undefined ? undefined : `cp${pythonVersion.split('.').slice(0, 2).join('')}`
  const archWheel = (filename) => isLinuxWheel(filename) && filename.includes(marker)
  // A py3-none wheel runs on any interpreter (ruff ships its binary
  // that way); anything else compiled must match or be abi3. A wheel
  // for the wrong interpreter can only fail the install, so it never
  // wins over the sdist. Multi-cp tags join with dots (cp313.cp314).
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the tag is the pack definition's pinned uvPython version (deploy/packs/*.json, e.g. "3.15.1" -> cp315), a fixed linear `cp<digits>[.-]` with no quantifier or alternation to backtrack; filenames only select among sha256-verified downloads (PLAN.md §8)
  const tagMatcher = tag === undefined ? undefined : new RegExp(`${tag.replaceAll('.', '[.]')}[.-]`)
  const candidates = [
    files.find(
      (file) =>
        tagMatcher !== undefined &&
        archWheel(file.filename) &&
        tagMatcher.test(file.filename.split('-', 3)[2] ?? ''),
    ),
    files.find((file) => archWheel(file.filename) && file.filename.includes('-abi3-')),
    files.find((file) => archWheel(file.filename) && file.filename.includes('py3-none-')),
    files.find((file) => file.filename.endsWith('py3-none-any.whl')),
    files.find((file) => file.filename.endsWith('.tar.gz')),
  ]
  const pick = candidates.find((candidate) => candidate !== undefined)
  if (pick === undefined) throw new Error(`no installable file for ${name}@${version}`)
  return { filename: pick.filename, url: pick.url, sha256: pick.digests.sha256 }
}

async function cratesChecksum(name, version) {
  const response = await fetchUrl(`https://crates.io/api/v1/crates/${name}/${version}`)
  if (response.status !== 200) throw new Error(`crates ${name}@${version} missing`)
  return JSON.parse(response.bytes.toString('utf8')).version.checksum
}

async function goZipHash(packagePath, version) {
  const marker = '/cmd/'
  const cut = packagePath.lastIndexOf(marker)
  if (cut === -1) throw new Error(`go tool ${packagePath} is not a /cmd/ package`)
  const module = packagePath.slice(0, cut)
  // .info accepts the tag as pinned; .ziphash needs the canonical version.
  const infoResponse = await fetchUrl(`https://proxy.golang.org/${module}/@v/${version}.info`)
  if (infoResponse.status !== 200)
    throw new Error(`go ${packagePath}@${version} missing from proxy`)
  const canonical = JSON.parse(infoResponse.bytes.toString('utf8')).Version
  if (typeof canonical !== 'string' || canonical.length === 0) {
    throw new Error(`go ${module}@${version} .info carries no version`)
  }
  // The checksum database is the transparency log; the build's `go install`
  // verifies the same note again with the toolchain's baked-in sumdb key.
  const lookup = await fetchUrl(`https://sum.golang.org/lookup/${module}@${canonical}`)
  if (lookup.status !== 200) throw new Error(`go ${packagePath}@${version} missing from sumdb`)
  const entry = lookup.bytes
    .toString('utf8')
    .split('\n')
    .map((line) => /^(\S+) (\S+) (h1:\S+)$/.exec(line))
    .find((match) => match?.[1] === module && match[2] === canonical)
  if (entry === undefined) throw new Error(`go ${packagePath}@${version} sumdb entry malformed`)
  return {
    canonical,
    commit: JSON.parse(infoResponse.bytes.toString('utf8')).Origin?.Hash,
    ziphash: entry[3],
  }
}

/** Resolve an apt package from a snapshot: version, hash and pool URL. */
/**
The first alternative the snapshot carries, honouring arch
qualifiers (`:any` is the same package everywhere; another arch
fails, its library cannot load here).
*/
function chooseAlternative(alternatives, entries, debianArch) {
  for (const alternative of alternatives) {
    const [qualified] = alternative.trim().split(' ', 1)
    const [name, qualifier] = qualified.split(':', 2)
    if (qualifier !== undefined && qualifier !== debianArch && qualifier !== 'any') {
      throw new Error(`apt clause wants ${qualified}`)
    }
    if (entries.has(name)) return name
  }
}

/**
One stanza's Depends and Pre-Depends as chosen package names: each
alternative list takes the first the snapshot carries.
*/
function parseDebDepends(stanza, entries, arch) {
  const debianArch = arch === 'arm64' ? 'arm64' : 'amd64'
  const unfolded = stanza.replaceAll('\n ', '')
  const depends = []
  const lines = unfolded.matchAll(/^(?:Depends|Pre-Depends): (.+)$/gm)
  for (const line of lines) {
    const clauses = line[1].split(',')
    for (const clause of clauses) {
      const alternatives = clause.split('|')
      const chosen = chooseAlternative(alternatives, entries, debianArch)
      if (chosen === undefined) {
        throw new Error(`no snapshot alternative for apt clause ${clause.trim()}`)
      }
      depends.push(chosen)
    }
  }
  return depends
}

async function aptMetadata(snapshot, arch, sources) {
  const key = `${snapshot}/${arch}`
  if (sources.aptMetadata[key] === undefined) {
    const debianArch = arch === 'arm64' ? 'arm64' : 'amd64'
    const response = await fetchUrl(
      `https://snapshot.debian.org/archive/debian/${snapshot}/dists/trixie/main/binary-${debianArch}/Packages.gz`,
    )
    if (response.status !== 200)
      throw new Error(`HTTP ${response.status} fetching ${debianArch} Packages`)
    const { gunzipSync } = await import('node:zlib')
    const entries = new Map()
    const stanzas = gunzipSync(response.bytes).toString('utf8').split('\n\n')
    for (const stanza of stanzas) {
      const packageName = /^Package: (\S+)$/m.exec(stanza)?.[1]
      if (packageName === undefined) continue
      entries.set(packageName, {
        version: /^Version: (\S+)$/m.exec(stanza)?.[1],
        filename: /^Filename: (\S+)$/m.exec(stanza)?.[1],
        sha256: /^SHA256: ([0-9a-f]{64})$/m.exec(stanza)?.[1],
        stanza,
      })
    }
    sources.aptMetadata[key] = entries
  }
  return sources.aptMetadata[key]
}

async function aptResolve(snapshot, name, arch, sources) {
  const metadata = await aptMetadata(snapshot, arch, sources)
  const entry = metadata.get(name)
  if (entry?.version === undefined || entry.filename === undefined || entry.sha256 === undefined) {
    throw new Error(`apt ${name} not fully described in ${snapshot}`)
  }
  return {
    version: entry.version,
    sha256: entry.sha256,
    filename: entry.filename,
    url: `https://snapshot.debian.org/archive/debian/${snapshot}/${entry.filename}`,
  }
}

/**
The named packages plus their recursive Depends closure, in install
order (dependencies first). Alternatives take the first the snapshot
carries; Recommends stay out (smoke names anything truly missing).
libc stays out too: the base owns the loader, and a layer libc would
mix with it. Constraints are the snapshot's own business: an archive
state is self-consistent by construction.
*/
async function resolveAptClosure(snapshot, names, arch, sources) {
  const entries = await aptMetadata(snapshot, arch, sources)
  const baseOwned = new Set(['libc6', 'libc-bin'])
  const ordered = []
  const seen = new Set(baseOwned)
  for (const name of names) {
    if (baseOwned.has(name)) throw new Error(`apt ${name} belongs to the base, not a pack`)
  }
  const visit = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    const entry = entries.get(name)
    if (entry === undefined) throw new Error(`apt ${name} not in ${snapshot}`)
    const depends = parseDebDepends(entry.stanza, entries, arch)
    for (const dep of depends) visit(dep)
    ordered.push(name)
  }
  for (const name of names) visit(name)
  return ordered.map((name) => ({ name, auto: !names.includes(name) }))
}

/** Write the pack's SPDX SBOM beside its lock. */
function writeSbom(definition, locked, out) {
  const namespace = `https://muse-spark-code.invalid/sbom/${definition.name}-${locked.arch}-${locked.version}`
  const packages = []
  const relationships = []
  const addPackage = (id, name, version, license, url, sha256) => {
    packages.push({
      SPDXID: id,
      name,
      versionInfo: version,
      supplier: 'Organization: upstream',
      downloadLocation: url,
      filesAnalyzed: false,
      ...(sha256 !== undefined && { checksums: [{ algorithm: 'SHA256', checksumValue: sha256 }] }),
      licenseConcluded: license,
      licenseDeclared: license,
    })
    relationships.push({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: id,
    })
  }
  for (const upstream of locked.upstreams) {
    addPackage(
      `SPDXRef-upstream-${upstream.name}`,
      upstream.name,
      upstream.version,
      upstream.license,
      upstream.url,
      upstream.sha256,
    )
  }
  const managedKinds = ['npm', 'cargo', 'uvTools', 'uvPythons', 'go', 'psGallery', 'rust']
  for (const kind of managedKinds) {
    const tools = locked.managed[kind]
    for (const tool of tools) {
      addPackage(
        `SPDXRef-${kind}-${tool.name}`,
        tool.name,
        tool.version,
        tool.license,
        tool.url ?? `${kind}:${tool.name}@${tool.version}`,
        tool.sha256,
      )
    }
  }
  for (const pkg of locked.apt) {
    addPackage(`SPDXRef-apt-${pkg.name}`, pkg.name, pkg.version, pkg.license, pkg.url, pkg.sha256)
  }
  const sbomDir = path.join(out, 'sbom')
  mkdirSync(sbomDir, { recursive: true })
  writeFileSync(
    path.join(sbomDir, `${definition.name}-${locked.arch}.spdx.json`),
    `${JSON.stringify(
      {
        spdxVersion: 'SPDX-2.3',
        dataLicense: 'CC0-1.0',
        SPDXID: 'SPDXRef-DOCUMENT',
        name: `${definition.name}-${locked.arch}`,
        documentNamespace: namespace,
        creationInfo: {
          created: new Date().toISOString(),
          creators: ['Tool: muse-pack-build'],
        },
        packages,
        relationships,
      },
      null,
      2,
    )}\n`,
  )
}

/** The Debian package names in a snapshot (amd64 and arm64). */
async function fetchAptPackages(snapshot) {
  const names = new Set()
  for (const arch of ['amd64', 'arm64']) {
    const response = await fetchUrl(
      `https://snapshot.debian.org/archive/debian/${snapshot}/dists/trixie/main/binary-${arch}/Packages.gz`,
    )
    if (response.status !== 200)
      throw new Error(`HTTP ${response.status} fetching ${arch} Packages`)
    const { gunzipSync } = await import('node:zlib')
    const text = gunzipSync(response.bytes).toString('utf8')
    for (const match of text.matchAll(/^Package: (\S+)$/gm)) names.add(match[1])
  }
  return names
}
