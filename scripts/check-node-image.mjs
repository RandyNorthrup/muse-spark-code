// M110-C: inspect an OCI archive by digest; scan every original layer, including
// deleted files, and require BuildKit SPDX/SLSA attestations per architecture.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const ROOT = path.resolve(import.meta.dirname, '..')
const POLICY = JSON.parse(readFileSync(path.join(ROOT, 'deploy/container/policy.json'), 'utf8'))
const Descriptor = z.object({
  digest: z.string().regex(/^sha256:[a-f\d]{64}$/),
  size: z.number().int().nonnegative(),
  mediaType: z.string(),
  annotations: z.record(z.string(), z.string()).optional(),
})
const Index = z.object({ schemaVersion: z.literal(2), manifests: z.array(Descriptor).nonempty() })
const Manifest = z.object({
  schemaVersion: z.literal(2),
  config: Descriptor,
  layers: z.array(Descriptor),
})
const Config = z.object({
  architecture: z.enum(['amd64', 'arm64']),
  os: z.literal('linux'),
  config: z.object({
    Entrypoint: z.tuple([z.literal('/usr/local/bin/muse-node-entrypoint')]),
    Cmd: z.tuple([z.literal('serve')]),
    Env: z.array(z.string()),
    Labels: z.record(z.string(), z.string()),
  }),
})
const Statement = z.object({
  _type: z.string().startsWith('https://in-toto.io/Statement/'),
  predicateType: z.string(),
  subject: z.array(z.object({ digest: z.object({ sha256: z.string().regex(/^[a-f\d]{64}$/) }) })),
  predicate: z.record(z.string(), z.unknown()),
})

function unpack(archive, destination) {
  execFileSync('python3', [path.join(ROOT, 'deploy/container/unpack.py'), archive, destination], {
    stdio: 'pipe',
  })
}
function scan(directory) {
  try {
    execFileSync(
      'gitleaks',
      [
        'dir',
        '--config',
        path.join(ROOT, 'deploy/container/gitleaks.toml'),
        '--ignore-gitleaks-allow',
        '--redact',
        '--no-banner',
        '--no-color',
        '--exit-code=1',
        directory,
      ],
      { stdio: 'pipe' },
    )
  } catch {
    throw new Error('Node image secret scan failed (scanner details withheld)')
  }
}

export function inspectNodeArchive(directory, { scanLayer, extractLayer }) {
  const blob = (descriptor) => {
    const file = path.join(directory, 'blobs/sha256', descriptor.digest.slice('sha256:'.length))
    const bytes = readFileSync(file)
    if (
      bytes.length !== descriptor.size ||
      `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== descriptor.digest
    ) {
      throw new Error('OCI blob digest or size mismatch')
    }
    return file
  }
  const json = (descriptor, schema) =>
    schema.parse(JSON.parse(readFileSync(blob(descriptor), 'utf8')))
  const images = []
  const attestations = []
  const visited = new Set()
  const visit = (descriptor) => {
    if (visited.has(descriptor.digest)) return
    visited.add(descriptor.digest)
    if (
      descriptor.mediaType.endsWith('index.v1+json') ||
      descriptor.mediaType.endsWith('manifest.list.v2+json')
    ) {
      for (const child of json(descriptor, Index).manifests) visit(child)
      return
    }
    const manifest = json(descriptor, Manifest)
    blob(manifest.config)
    if (descriptor.annotations?.['vnd.docker.reference.type'] === 'attestation-manifest') {
      for (const layer of manifest.layers) {
        const statement = json(layer, Statement)
        // Captured BuildKit OCI exports defer statement subjects to this
        // manifest annotation. Never accept an unbound empty subject.
        if (statement.subject.length === 0) {
          const binding = z
            .string()
            .regex(/^sha256:[a-f\d]{64}$/)
            .parse(descriptor.annotations['vnd.docker.reference.digest'])
          statement.subject.push({ digest: { sha256: binding.slice('sha256:'.length) } })
        }
        attestations.push(statement)
      }
      return
    }
    const config = json(manifest.config, Config)
    const platform = `${config.os}/${config.architecture}`
    if (images.some((image) => image.platform === platform))
      throw new Error('Duplicate OCI platform')
    const size = manifest.layers.reduce((sum, layer) => sum + layer.size, 0)
    if (size > POLICY.maxCompressedBytes)
      throw new Error('Node image compressed size budget exceeded')
    if (manifest.layers.some((layer) => !layer.mediaType.endsWith('+gzip')))
      throw new Error('Expected compressed OCI layers')
    if (config.config.Env.some((entry) => /^[\w]*(?:API_KEY|TOKEN|PASSWORD|SECRET)=/i.test(entry)))
      throw new Error('Credential variable in image config')
    if (
      config.config.Labels['org.opencontainers.image.title'] !== 'Muse Spark Code Node (Unofficial)'
    )
      throw new Error('Missing unofficial image title')
    const contents = new Map()
    for (const layer of manifest.layers) {
      const files = extractLayer(blob(layer), layer.digest)
      scanLayer(files.directory)
      // Whiteouts affect only lower layers, regardless of archive entry order.
      const names = files.names.map((name) => path.posix.normalize(name).replace(/\/$/, ''))
      for (const normalized of names) {
        const parent = path.posix.dirname(normalized)
        const base = path.posix.basename(normalized)
        if (base === '.wh..wh..opq') {
          for (const existing of contents.keys())
            if (parent === '.' || existing.startsWith(`${parent}/`)) contents.delete(existing)
        } else if (base.startsWith('.wh.')) {
          const removed = path.posix.join(parent, base.slice('.wh.'.length))
          for (const existing of contents.keys())
            if (existing === removed || existing.startsWith(`${removed}/`))
              contents.delete(existing)
        }
      }
      for (const normalized of names) {
        if (normalized !== '.' && !path.posix.basename(normalized).startsWith('.wh.'))
          contents.set(normalized, path.join(files.directory, normalized))
      }
    }
    scanLayer(directory) // Includes config/history, not only rootfs material.
    for (const required of [
      'opt/muse/image-notices/debian-packages.tsv',
      'opt/muse/image-notices/node.txt',
      'opt/muse/native-notices.json',
    ]) {
      if (!contents.has(required)) throw new Error('Missing layer licence notices')
    }
    for (const [installed, source] of [
      ['usr/local/bin/muse-node-entrypoint', 'entrypoint.sh'],
      ['usr/local/bin/muse-spark-code-acp', 'muse-spark-code-acp'],
    ]) {
      const installedFile = contents.get(installed)
      if (
        !installedFile ||
        !readFileSync(installedFile).equals(
          readFileSync(path.join(ROOT, 'deploy/container', source)),
        )
      )
        throw new Error('Unreviewed privilege bootstrap in image')
    }
    images.push({ platform, digest: descriptor.digest, compressedBytes: size })
  }
  const root = Index.parse(JSON.parse(readFileSync(path.join(directory, 'index.json'), 'utf8')))
  if (root.manifests.length !== 1) throw new Error('One image root required')
  visit(root.manifests[0])
  if (images.length === 0) throw new Error('No runnable node image')
  for (const image of images) {
    const attached = attestations.filter((entry) =>
      entry.subject.some((subject) => `sha256:${subject.digest.sha256}` === image.digest),
    )
    const sbom = attached.find((entry) => entry.predicateType === 'https://spdx.dev/Document')
    const provenance = attached.find((entry) =>
      /^https:\/\/slsa.dev\/provenance\/v(?:0\.2|1)$/.test(entry.predicateType),
    )
    if (
      !sbom ||
      !provenance ||
      !Array.isArray(sbom.predicate.packages) ||
      sbom.predicate.packages.length === 0 ||
      !z
        .union([
          z.object({ buildType: z.string().min(1) }),
          z.object({ buildDefinition: z.object({ buildType: z.string().min(1) }) }),
        ])
        .safeParse(provenance.predicate).success
    ) {
      throw new Error('Missing SPDX SBOM or SLSA provenance bound to image digest')
    }
    image.sbom = sbom.predicate
    image.provenance = provenance.predicate
  }
  return { digest: root.manifests[0].digest, images }
}

export function verifyReleaseIdentity(reference, tag, execute = execFileSync) {
  const prefix = `${POLICY.image}@sha256:`
  if (
    !reference.startsWith(prefix) ||
    !/^[a-f\d]{64}$/.test(reference.slice(prefix.length)) ||
    !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)
  )
    throw new Error('Exact release image digest and version tag required')
  execute(
    'cosign',
    [
      'verify',
      '--certificate-identity',
      `${POLICY.releaseIdentity}${tag}`,
      '--certificate-oidc-issuer',
      POLICY.oidcIssuer,
      reference,
    ],
    { stdio: 'pipe' },
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let scratch
  try {
    const [archive, output, reference, tag] = process.argv.slice(2)
    if (!archive || !output || process.argv.length > 6 || Boolean(reference) !== Boolean(tag))
      throw new Error(
        'Usage: check-node-image.mjs <OCI.tar> <receipt.json> [image@sha256:digest vX.Y.Z]',
      )
    if (statSync(archive).size > POLICY.maxExtractedBytes)
      throw new Error('OCI archive size limit exceeded')
    mkdirSync(path.join(ROOT, 'temp'), { recursive: true })
    scratch = mkdtempSync(path.join(ROOT, 'temp/m110-image-check-'))
    const directory = path.join(scratch, 'oci')
    unpack(archive, directory)
    const extractedLayers = new Map()
    const receipt = inspectNodeArchive(directory, {
      scanLayer: scan,
      extractLayer: (file, digest) => {
        if (extractedLayers.has(digest)) return extractedLayers.get(digest)
        const extracted = path.join(scratch, digest.slice('sha256:'.length))
        unpack(file, extracted)
        const names = execFileSync('tar', ['-tf', file], {
          encoding: 'utf8',
          maxBuffer: POLICY.maxExtractedBytes,
        })
          .trim()
          .split('\n')
        const result = { directory: extracted, names }
        extractedLayers.set(digest, result)
        return result
      },
    })
    if (reference) {
      if (
        POLICY.platforms.some((platform) =>
          receipt.images.every((image) => image.platform !== platform),
        )
      )
        throw new Error('Release image must include amd64 and arm64')
      if (!reference.endsWith(`@${receipt.digest}`))
        throw new Error('Release digest differs from checked archive')
      verifyReleaseIdentity(reference, tag)
    }
    writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`)
    console.log('Node image archive checks passed')
  } catch (error) {
    console.error(
      error.status === undefined &&
        !(error instanceof z.ZodError) &&
        !(error instanceof SyntaxError)
        ? error.message
        : 'Node image check failed (untrusted tool output withheld)',
    )
    process.exitCode = 1
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true })
  }
}
