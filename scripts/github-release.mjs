// Reruns add missing assets; an existing asset is never overwritten.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const RELEASE = z.object({
  isDraft: z.boolean(),
  assets: z.array(z.object({ name: z.string() })),
})

function run(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    timeout: 180_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

export function ensureGithubRelease(tag, notes, artifacts, execute = run) {
  if (artifacts.length === 0) throw new Error('No release assets supplied')
  let existing
  try {
    existing = RELEASE.parse(
      JSON.parse(execute(['release', 'view', tag, '--json', 'assets,isDraft'])),
    )
  } catch (error) {
    // Only a not-found response permits creation; auth/network/schema failures stay failures.
    if (
      !(error instanceof Error) ||
      !/release not found|HTTP 404/i.test(`${error.message} ${String(error.stderr ?? '')}`)
    ) {
      throw error
    }
    execute([
      'release',
      'create',
      tag,
      ...artifacts,
      '--title',
      tag,
      '--notes-file',
      notes,
      '--verify-tag',
    ])
    return
  }
  // Every downloadable asset must belong to this run's checksum set and
  // attestation; a stray asset from a manual upload or partial workflow
  // would otherwise publish uncovered.
  const expected = new Set(artifacts.map((artifact) => path.basename(artifact)))
  for (const { name } of existing.assets) {
    if (!expected.has(name)) throw new Error(`Unexpected release asset: ${name}`)
  }
  const names = new Set(existing.assets.map(({ name }) => name))
  const directory = mkdtempSync(
    path.join(path.dirname(path.resolve(artifacts[0])), '.verify-release-'),
  )
  try {
    // Verify every existing asset before publishing any missing one.
    for (const artifact of artifacts) {
      const name = path.basename(artifact)
      if (!names.has(name)) {
        continue
      }

      execute(['release', 'download', tag, '--pattern', name, '--dir', directory])
      if (digest(path.join(directory, name)) !== digest(artifact)) {
        throw new Error(`Existing release asset differs: ${name}`)
      }
    }
    const missing = artifacts.filter((artifact) => !names.has(path.basename(artifact)))
    if (missing.length > 0) execute(['release', 'upload', tag, ...missing])
    // A `release create` interrupted mid-upload leaves a draft behind; the
    // rerun must publish it once every asset matches.
    if (existing.isDraft) execute(['release', 'edit', tag, '--draft=false'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [tag, notes, ...artifacts] = process.argv.slice(2)
  try {
    if (tag === undefined || notes === undefined) throw new Error('Tag and notes required')
    ensureGithubRelease(tag, notes, artifacts)
  } catch {
    console.error('GitHub Release creation or asset verification failed; see docs/RELEASING.md')
    process.exitCode = 1
  }
}
