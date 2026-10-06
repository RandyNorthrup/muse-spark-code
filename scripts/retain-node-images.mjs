// Registry retention preserves the complete OCI graph of retained releases,
// including untagged platform/attestation manifests and cosign attachments.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const POLICY = JSON.parse(
  readFileSync(new URL('../deploy/container/policy.json', import.meta.url), 'utf8'),
)
const Digest = z.string().regex(/^sha256:[a-f\d]{64}$/)
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
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
