// B0: validate the release pins, stage exact verified bytes, and measure saved layers.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, cp, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/mini'

const { AbortSignal } = globalThis
const SHA256 = /^[a-f\d]{64}$/
const ATOM = /^[\w.+-]+$/
const VERSION = /^[\w.+:~-]+$/
const DIGEST = /^sha256:[a-f\d]{64}$/
const ORIGINAL_ORIGINS = new Set([
  'https://deb.debian.org',
  'https://nodejs.org',
  'https://github.com',
  'https://raw.githubusercontent.com',
])
const REDIRECT_ORIGINS = new Set([
  ...ORIGINAL_ORIGINS,
  'https://release-assets.githubusercontent.com',
  'https://objects.githubusercontent.com',
])
const TRANSFER_MS = 300_000
const MAX_REDIRECTS = 3
const PRIVATE_DIR = 0o700
const PRIVATE_FILE = 0o600
const pinSchema = z.strictObject({
  name: z.string().check(z.regex(ATOM)),
  version: z.string().check(z.regex(VERSION)),
  kind: z.enum(['deb', 'tar', 'license']),
  source: z.string(),
  sha256: z.string().check(z.regex(SHA256)),
  bytes: z.int().check(z.positive()),
  file: z.string().check(z.regex(ATOM)),
  pack: z.enum(['base', 'build']),
})
const architectureSchema = z.strictObject({
  baseDigest: z.string().check(z.regex(DIGEST)),
  baseCompressedBytes: z.int().check(z.positive()),
  artifacts: z.array(pinSchema).check(z.minLength(1)),
})
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.literal('Muse Spark Code Node (Unofficial) base agent toolset'),
  capturedAt: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  baseImage: z
    .string()
    .check(z.regex(/^docker\.io\/library\/debian:trixie-slim@sha256:[a-f\d]{64}$/)),
  tools: z.array(
    z.strictObject({
      name: z.string().check(z.regex(ATOM)),
      package: z.string().check(z.regex(ATOM)),
      pack: z.enum(['base', 'build']),
      command: z.string().check(z.regex(ATOM)),
      args: z.array(z.string()),
    }),
  ),
  architectures: z.strictObject({ amd64: architectureSchema, arm64: architectureSchema }),
})
const REQUIRED_TOOLS = [
  'git',
  'gh',
  'node',
  'python',
  'uv',
  'ripgrep',
  'fd',
  'jq',
  'curl',
  'unzip',
  'build-essential',
  'clang',
  'make',
  'cmake',
  'gitleaks',
]

/** A source URL may never read a credential, local service or an unpinned release. */
function sourceUrl(source, isRedirect = false) {
  const url = new URL(source)
  if (
    !(isRedirect ? REDIRECT_ORIGINS : ORIGINAL_ORIGINS).has(url.origin) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    (!isRedirect && url.search !== '') ||
    /(?:latest|current)/i.test(url.pathname)
  )
    throw new Error('Unpinned toolset source')
  return url
}

export function parseToolset(raw) {
  const manifest = manifestSchema.parse(raw)
  const names = manifest.tools.map((tool) => tool.name)
  if (
    names.length !== REQUIRED_TOOLS.length ||
    REQUIRED_TOOLS.some((name) => !names.includes(name))
  )
    throw new Error('Incomplete toolset')
  for (const architecture of Object.values(manifest.architectures)) {
    const files = new Set()
    const packages = new Set()
    for (const pin of architecture.artifacts) {
      sourceUrl(pin.source)
      if (files.has(pin.file.toLowerCase()) || packages.has(pin.name) || pin.file.endsWith('.'))
        throw new Error('Duplicate or unsafe toolset artifact')
      files.add(pin.file.toLowerCase())
      packages.add(pin.name)
      if (pin.kind === 'tar' && !['node', 'uv', 'gitleaks'].includes(pin.name))
        throw new Error('Unknown toolset archive')
      if (pin.name === 'node' && !pin.version.startsWith('24.')) throw new Error('Node 24 required')
    }
    if (
      manifest.tools.some((tool) =>
        architecture.artifacts.every((pin) => pin.name !== tool.package || pin.pack !== tool.pack),
      )
    )
      throw new Error('Tool missing from its pack')
  }
  return manifest
}

/** Verify bytes on disk before they enter an offline build context. */
export async function verifyArtifact(file, pin) {
  const stats = await stat(file)
  if (stats.size !== pin.bytes) throw new Error('Toolset artifact length mismatch')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== pin.sha256) throw new Error('Toolset artifact SHA-256 mismatch')
}

/** Redirects and streamed length are checked before any archive can be installed. */
export async function downloadArtifact(pin, file, fetcher = fetch) {
  const partial = `${file}.part`
  const signal = AbortSignal.timeout(TRANSFER_MS)
  let handle
  try {
    let url = sourceUrl(pin.source)
    let response
    for (let redirects = 0; ; redirects += 1) {
      response = await fetcher(url.href, {
        redirect: 'manual',
        signal,
        headers: { 'Accept-Encoding': 'identity' },
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      await response.body?.cancel()
      if (redirects >= MAX_REDIRECTS) throw new Error('Toolset redirect limit')
      const location = response.headers.get('Location')
      if (location === null) throw new Error('Toolset redirect missing destination')
      url = sourceUrl(new URL(location, url).href, true)
    }
    if (response.status !== 200 || response.body === null) {
      await response.body?.cancel()
      throw new Error('Toolset download refused')
    }
    const length = response.headers.get('Content-Length')
    if (length !== null && length !== String(pin.bytes)) {
      await response.body.cancel()
      throw new Error(`Toolset download length mismatch: ${pin.name}`)
    }
    handle = await open(partial, 'wx', PRIVATE_FILE)
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > pin.bytes) throw new Error('Toolset download exceeds pin')
      hash.update(chunk)
      await handle.writeFile(chunk)
    }
    if (bytes !== pin.bytes || hash.digest('hex') !== pin.sha256)
      throw new Error('Toolset download integrity mismatch')
    await handle.close()
    handle = undefined
    await rename(partial, file)
  } finally {
    await handle?.close()
    await rm(partial, { force: true })
  }
}

/** Stage one architecture into a NEW directory; no package manager runs on this host. */
export async function stageToolset(manifest, architecture, destination, cache) {
  const record = manifest.architectures[architecture]
  if (record === undefined) throw new Error('Unsupported toolset architecture')
  await mkdir(destination, { mode: PRIVATE_DIR })
  try {
    await mkdir(path.join(destination, 'checksums'), { mode: PRIVATE_DIR })
    for (const pack of ['base', 'build']) {
      const folder = path.join(destination, 'artifacts', pack)
      await mkdir(path.join(folder, 'licenses'), { recursive: true, mode: PRIVATE_DIR })
      await mkdir(path.join(folder, 'debs'), { recursive: true, mode: PRIVATE_DIR })
      const checksums = []
      for (const pin of record.artifacts) {
        if (pin.pack !== pack) continue
        let name = `licenses/${pin.file}`
        if (pin.kind === 'deb') name = `debs/${pin.file}`
        else if (pin.kind === 'tar') name = `${pin.name}.tar.gz`
        const target = path.join(folder, ...name.split('/'))
        if (cache === undefined) await downloadArtifact(pin, target)
        else {
          // Cache is input only; verify a private copy rather than following it at build time.
          const source = path.join(cache, pin.file)
          await copyFile(source, target)
          await verifyArtifact(target, pin)
        }
        checksums.push(`${pin.sha256}  ${name}`)
      }
      const inventory = `${checksums.join('\n')}\n`
      await writeFile(path.join(folder, 'SHA256SUMS'), inventory)
      // The image owns this manifest-derived inventory, separate from the artifact mount.
      await writeFile(path.join(destination, 'checksums', `${pack}.sha256`), inventory)
    }
    await writeFile(path.join(destination, 'base.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    for (const file of ['Containerfile', 'install.sh'])
      await copyFile(path.join('deploy/toolset', file), path.join(destination, file))

    // Release asset gates verify these trees; runtime CLI copies also verify VENDOR hashes.
    for (const folder of ['vendor', 'first-party-skills']) {
      await cp(folder, path.join(destination, 'assets', folder), {
        recursive: true,
        dereference: false,
        errorOnExist: true,
        force: false,
      })
    }
    return record.artifacts.reduce((sum, pin) => sum + pin.bytes, 0)
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

export async function readToolset(file) {
  return parseToolset(JSON.parse(await readFile(file, 'utf8')))
}
