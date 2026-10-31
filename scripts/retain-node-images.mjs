// Registry retention preserves the complete OCI graph of retained releases,
// including untagged platform/attestation manifests and cosign attachments.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { isEntryPoint } from './lib/entryPoint.mjs'

const POLICY = JSON.parse(
  readFileSync(new URL('../deploy/container/policy.json', import.meta.url), 'utf8'),
)
const Digest = z.string().regex(/^sha256:[a-f\d]{64}$/)
const DockerCommand = z.object({ file: z.string().min(1), args: z.array(z.string()) }).strict()
const Versions = z.array(
  z.array(
    z.object({
      id: z.number().int().positive(),
      name: Digest,
      created_at: z.string().datetime(),
      metadata: z.object({ container: z.object({ tags: z.array(z.string()) }) }),
    }),
  ),
)
const RegistryObject = z.union([
  z.object({
    schemaVersion: z.literal(2),
    manifests: z.array(z.object({ digest: Digest })).nonempty(),
  }),
  z.object({
    schemaVersion: z.literal(2),
    config: z.object({ digest: Digest }),
    layers: z.array(z.object({ digest: Digest })),
    subject: z.object({ digest: Digest }).optional(),
  }),
])

function releaseVersion(tag) {
  const match =
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(
      tag,
    )
  if (!match) throw new Error('Valid SemVer release tag required for channel promotion')
  const [, major, minor, patch, prerelease] = match
  const pre = prerelease?.split('.') ?? []
  if (pre.some((part) => /^0\d+$/.test(part)))
    throw new Error('Valid SemVer prerelease required for channel promotion')
  return { core: [major, minor, patch].map(BigInt), pre }
}

function atLeast(candidate, current) {
  for (const [index, part] of candidate.core.entries()) {
    if (part !== current.core[index]) return part > current.core[index]
  }
  if (candidate.pre.length === 0 || current.pre.length === 0) return candidate.pre.length === 0
  for (const [index, part] of candidate.pre.entries()) {
    const other = current.pre[index]
    if (other === undefined) return true
    if (part === other) continue
    const isNumeric = /^\d+$/.test(part)
    const isOtherNumeric = /^\d+$/.test(other)
    if (isNumeric && isOtherNumeric) return BigInt(part) > BigInt(other)
    return isNumeric === isOtherNumeric ? part > other : isOtherNumeric
  }
  return candidate.pre.length >= current.pre.length
}

export function assertNodeImageTag(tag) {
  releaseVersion(tag)
}

export function nodeImageChannel(tag, pages, dockerCommand, execute = execFileSync) {
  const command = DockerCommand.parse(dockerCommand)
  const candidate = releaseVersion(tag)
  const channel = candidate.pre.length === 0 ? 'stable' : 'preview'
  const current = Versions.parse(pages)
    .flat()
    .filter((entry) => entry.metadata.container.tags.includes(channel))
  if (current.length > 1) throw new Error('Ambiguous current node image channel')
  const versions = (current[0]?.metadata.container.tags ?? [])
    .filter((entry) => /^v\d+\./.test(entry))
    .map((entry) => releaseVersion(entry))
  if (current.length === 1 && versions.length === 0)
    throw new Error('Current node image channel has no release version')
  // Bind the paginated release aliases to the channel's actual registry digest.
  let inspected
  const reference = `${POLICY.image}:${channel}`
  try {
    inspected = z
      .object({ digest: Digest })
      .parse(
        JSON.parse(
          execute(
            command.file,
            [
              ...command.args,
              'buildx',
              'imagetools',
              'inspect',
              '--format',
              '{{json .Manifest}}',
              reference,
            ],
            { encoding: 'utf8', stdio: 'pipe', shell: false },
          ),
        ),
      )
  } catch (error) {
    if (
      current.length === 0 &&
      error.status === 1 &&
      String(error.stderr).trim() === `ERROR: ${reference}: not found`
    )
      return channel
  }
  if (!inspected)
    throw new Error('Current node image channel lookup failed; registry details withheld')
  if (current.length === 0)
    throw new Error('Current node image channel is missing from the release listing')
  if (inspected.digest !== current[0].name)
    throw new Error('Current node image channel changed during publication')
  return versions.every((version) => atLeast(candidate, version)) ? channel : ''
}

export function nodeImageRetention(versions, readManifest) {
  const ordered = versions.toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const releases = ordered.filter((entry) =>
    entry.metadata.container.tags.some((tag) => /^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag)),
  )
  const roots = new Set(releases.slice(0, POLICY.registryKeepVersions).map((entry) => entry.name))
  for (const entry of ordered) {
    if (
      entry.metadata.container.tags.some(
        (tag) =>
          ['stable', 'preview'].includes(tag) ||
          (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag) &&
            !/^build-\d+-\d+-(?:amd64|arm64|index)$/.test(tag) &&
            !/^sha256-[a-f\d]{64}\.(?:sig|att|sbom)$/.test(tag)),
      )
    )
      roots.add(entry.name)
  }
  if (roots.size === 0) throw new Error('No retained release root: refusing registry deletion')
  const retained = new Set()
  const visit = (digest) => {
    if (retained.has(digest)) return
    retained.add(digest)
    const manifest = RegistryObject.parse(readManifest(digest))
    if ('manifests' in manifest)
      for (const descriptor of manifest.manifests) visit(descriptor.digest)
    if ('subject' in manifest && manifest.subject) visit(manifest.subject.digest)
  }
  for (const digest of roots) visit(digest)
  return ordered
    .filter(
      (entry) =>
        !retained.has(entry.name) &&
        !entry.metadata.container.tags.some((tag) => {
          const attachment = /^sha256-([a-f\d]{64})\.(?:sig|att|sbom)$/.exec(tag)
          return attachment
            ? retained.has(`sha256:${attachment[1]}`)
            : !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag) &&
                !/^build-\d+-\d+-(?:amd64|arm64|index)$/.test(tag)
        }),
    )
    .map((entry) => entry.id)
}

if (isEntryPoint(import.meta.url)) {
  try {
    const api = '/users/randynorthrup/packages/container/muse-spark-code-node/versions'
    const versions = Versions.parse(
      JSON.parse(
        execFileSync('gh', ['api', '--paginate', '--slurp', `${api}?per_page=100`], {
          encoding: 'utf8',
          stdio: 'pipe',
        }),
      ),
    ).flat()
    const deletions = nodeImageRetention(versions, (digest) =>
      JSON.parse(
        execFileSync(
          'docker',
          ['buildx', 'imagetools', 'inspect', '--raw', `${POLICY.image}@${digest}`],
          { encoding: 'utf8', stdio: 'pipe' },
        ),
      ),
    )
    for (const id of deletions)
      execFileSync('gh', ['api', '--method', 'DELETE', `${api}/${id}`], { stdio: 'pipe' })
    console.log(`Node registry retention: ${deletions.length} unreachable versions removed`)
  } catch {
    console.error('Node registry retention failed; registry output withheld')
    process.exitCode = 1
  }
}
