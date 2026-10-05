// Shapes captured on win11, Ollama 0.35.1; see m98-2j-spike.md.
import { createHash } from 'node:crypto'
import { open, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  LOCAL_JUDGE_DIGEST_HEX_LENGTH,
  LOCAL_JUDGE_MAX_LAYERS,
  LOCAL_JUDGE_MAX_MODELS,
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_HASH_CHUNK_BYTES,
} from '../../../shared/constants'
import { handleIdentity, sameFile, statIdentity } from '../../fs/fileIdentity'

const hex = z
  .string()
  .length(LOCAL_JUDGE_DIGEST_HEX_LENGTH)
  .regex(/^[a-f\d]+$/)
const blobSchema = z.looseObject({
  mediaType: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f\d]{64}$/),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
})
const manifestSchema = z.looseObject({
  schemaVersion: z.literal(2),
  mediaType: z.literal('application/vnd.docker.distribution.manifest.v2+json'),
  config: blobSchema,
  layers: z.array(blobSchema).min(1).max(LOCAL_JUDGE_MAX_LAYERS),
})
const tagsSchema = z.looseObject({
  models: z
    .array(z.looseObject({ name: z.string().min(1), digest: hex }))
    .max(LOCAL_JUDGE_MAX_MODELS),
})

async function exactPath(root: string, relative: string): Promise<string> {
  const expected = path.resolve(root, relative)
  if ((await realpath(expected)) !== expected) throw new Error('unverified-model-path')
  return expected
}

/** Hash actual bytes, including the weights, rather than trusting filenames. */
export async function verifyDiskModel(
  tags: unknown,
  model: string,
  directory: string,
): Promise<{ digest: string; weightBytes: number }> {
  if (!/^[a-z\d][a-z\d._-]*:[a-z\d][a-z\d._-]*$/i.test(model)) {
    throw new Error('unverified-model-name')
  }
  const matching = tagsSchema.parse(tags).models.filter((item) => item.name === model)
  if (matching.length !== 1) throw new Error('unverified-model-digest')
  const served = matching[0]
  if (!served) throw new Error('unverified-model-digest')
  const root = await realpath(directory)
  const [name, tag] = model.split(':', 2)
  if (!name || !tag) throw new Error('unverified-model-name')
  const manifestFile = await exactPath(root, `manifests/registry.ollama.ai/library/${name}/${tag}`)
  const manifestHandle = await open(manifestFile, 'r')
  try {
    const initial = await handleIdentity(manifestHandle)
    if (!initial.isFile() || initial.size > BigInt(LOCAL_JUDGE_MAX_RESPONSE_BYTES)) {
      throw new Error('unverified-manifest')
    }
    const bytes = await manifestHandle.readFile()
    if (createHash('sha256').update(bytes).digest('hex') !== served.digest) {
      throw new Error('unverified-model-digest')
    }
    const decoded: unknown = JSON.parse(bytes.toString('utf8'))
    const manifest = manifestSchema.parse(decoded)
    let weightBytes = 0
    for (const blob of [manifest.config, ...manifest.layers]) {
      const blobPath = await exactPath(root, `blobs/${blob.digest.replace(':', '-')}`)
      const handle = await open(blobPath, 'r')
      try {
        const before = await handleIdentity(handle)
        if (!before.isFile() || before.size !== BigInt(blob.size))
          throw new Error('unverified-blob-size')
        const hash = createHash('sha256')
        const stream = handle.createReadStream({
          autoClose: false,
          highWaterMark: LOCAL_JUDGE_HASH_CHUNK_BYTES,
        })
        for await (const chunk of stream) {
          if (!Buffer.isBuffer(chunk)) throw new Error('unverified-blob-bytes')
          hash.update(chunk)
        }
        const after = await handleIdentity(handle)
        const named = await statIdentity(blobPath)
        if (
          !sameFile(before, after) ||
          !sameFile(before, named) ||
          before.mtimeNs !== named.mtimeNs ||
          before.size !== named.size ||
          before.mtimeNs !== after.mtimeNs ||
          before.size !== after.size ||
          `sha256:${hash.digest('hex')}` !== blob.digest
        )
          throw new Error('unverified-blob-digest')
        await exactPath(root, `blobs/${blob.digest.replace(':', '-')}`)
        if (blob.mediaType === 'application/vnd.ollama.image.model') weightBytes += blob.size
      } finally {
        await handle.close()
      }
    }
    if (!weightBytes || !bytes.equals(await readFile(manifestFile)))
      throw new Error('unverified-manifest')
    const final = await handleIdentity(manifestHandle)
    if (
      !sameFile(initial, final) ||
      initial.size !== final.size ||
      initial.mtimeNs !== final.mtimeNs
    ) {
      throw new Error('unverified-manifest')
    }
    return { digest: served.digest, weightBytes }
  } finally {
    await manifestHandle.close()
  }
}
