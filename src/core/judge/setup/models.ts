// M125 lane H (D107 §8.1 step 3): model blobs. The registry manifest
// parses from M98's captured shape; the plan lists what to fetch
// against what is already present; a served model proves itself by
// its digest. Fetching runs through the fetcher (live-proof
// deferred); the manifest, the plan and the digest check prove here.
import * as z from 'zod/mini'

const manifestDigestSchema = z.string().check(z.regex(/^(?:sha256:)?[a-f\d]{64}$/))

const manifestSchema = z.looseObject({
  schemaVersion: z.literal(2),
  config: z.looseObject({ digest: manifestDigestSchema, size: z.int().check(z.positive()) }),
  layers: z
    .array(z.looseObject({ digest: manifestDigestSchema, size: z.int().check(z.positive()) }))
    .check(z.minLength(1)),
})

/** The registry's sha256: form to the bare hex the table keeps. */
function bareDigest(digest: string): string {
  return digest.replace(/^sha256:/, '')
}

export interface ManifestBlob {
  readonly digest: string
  readonly size: number
}

export interface RegistryManifest {
  readonly config: ManifestBlob
  readonly layers: readonly ManifestBlob[]
}

/**
The registry manifest for one tag. Shape from M98's capture
(test/unit/fixtures/localJudgeCapture.json: manifest).
*/
export function parseRegistryManifest(text: string): RegistryManifest | undefined {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  const parsed = manifestSchema.safeParse(input)
  if (!parsed.success) return undefined
  return {
    config: { digest: bareDigest(parsed.data.config.digest), size: parsed.data.config.size },
    layers: parsed.data.layers.map((layer) => ({
      digest: bareDigest(layer.digest),
      size: layer.size,
    })),
  }
}

export interface BlobFetchPlan {
  /** Blobs to fetch with what is already present (resume by size). */
  readonly fetch: readonly (ManifestBlob & { readonly presentBytes: number })[]
  readonly totalBytes: number
  readonly missingBytes: number
}

/** What to fetch for a manifest against present blob sizes. */
export function planModelBlobs(
  manifest: RegistryManifest,
  present: ReadonlyMap<string, number>,
): BlobFetchPlan {
  const blobs: ManifestBlob[] = [manifest.config, ...manifest.layers]
  const fetch = blobs.map((blob) => ({
    ...blob,
    presentBytes: present.get(blob.digest) ?? 0,
  }))
  const totalBytes = blobs.reduce((sum, blob) => sum + blob.size, 0)
  const missingBytes = fetch.reduce(
    (sum, blob) => sum + Math.max(0, blob.size - Math.min(blob.presentBytes, blob.size)),
    0,
  )
  return { fetch, totalBytes, missingBytes }
}

/** Whether the served digest is the table's digest for the model. */
export function isExpectedDigest(servedDigest: string, expectedDigest: string): boolean {
  return servedDigest.toLowerCase() === expectedDigest.toLowerCase()
}
