// Shapes captured on win11, Ollama 0.35.1; see m98-2j-spike.md.
import { createHash } from 'node:crypto'
import { open, readFile, realpath, type FileHandle } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  LOCAL_JUDGE_DIGEST_HEX_LENGTH,
  LOCAL_JUDGE_MAX_LAYERS,
  LOCAL_JUDGE_MAX_MODELS,
  LOCAL_JUDGE_MAX_RESPONSE_BYTES,
  LOCAL_JUDGE_HASH_CHUNK_BYTES,
} from '../../../shared/constants'
import { handleIdentity, sameFile, statIdentity } from '../../fs/fileIdentity'
import { isSameLocalFileMetadata } from './snapshot'
import { verifyLinuxAnchor, verifyLinuxLocalVolume } from './linuxVolume'

const hex = z
  .string()
  .check(z.minLength(LOCAL_JUDGE_DIGEST_HEX_LENGTH), z.maxLength(LOCAL_JUDGE_DIGEST_HEX_LENGTH))
  .check(z.regex(/^[a-f\d]+$/))
const blobSchema = z.looseObject({
  mediaType: z.string().check(z.minLength(1)),
  digest: z.string().check(z.regex(/^sha256:[a-f\d]{64}$/)),
  size: z.int().check(z.nonnegative()).check(z.maximum(Number.MAX_SAFE_INTEGER)),
})
const manifestSchema = z.looseObject({
  schemaVersion: z.literal(2),
  mediaType: z.literal('application/vnd.docker.distribution.manifest.v2+json'),
  config: blobSchema,
  layers: z.array(blobSchema).check(z.minLength(1)).check(z.maxLength(LOCAL_JUDGE_MAX_LAYERS)),
})
const tagsSchema = z.looseObject({
  models: z
    .array(z.looseObject({ name: z.string().check(z.minLength(1)), digest: hex }))
    .check(z.maxLength(LOCAL_JUDGE_MAX_MODELS)),
})

async function exactPath(root: string, relative: string): Promise<string> {
  const expected = path.resolve(root, relative)
  if ((await realpath(expected)) !== expected) throw new Error('unverified-model-path')
  return expected
}

async function blobDigest(handle: FileHandle, signal: AbortSignal | undefined): Promise<string> {
  const hash = createHash('sha256')
  const stream = handle.createReadStream({
    autoClose: false,
    start: 0,
    highWaterMark: LOCAL_JUDGE_HASH_CHUNK_BYTES,
  })
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    if (!Buffer.isBuffer(chunk)) throw new TypeError('unverified-blob-bytes')
    hash.update(chunk)
  }
  return `sha256:${hash.digest('hex')}`
}

/** Hash actual bytes, including the weights, rather than trusting filenames. */
export async function verifyDiskModel(
  tags: unknown,
  model: string,
  directory: string,
  signal?: AbortSignal,
): Promise<{ digest: string; weightBytes: number }> {
  signal?.throwIfAborted()
  if (!/^[a-z\d][a-z\d._-]*:[a-z\d][a-z\d._-]*$/i.test(model)) {
    throw new Error('unverified-model-name')
  }
  const matching = tagsSchema.parse(tags).models.filter((item) => item.name === model)
  if (matching.length !== 1) throw new Error('unverified-model-digest')
  const served = matching[0]
  if (!served) throw new Error('unverified-model-digest')
  const root = await realpath(directory)
  const volumeSignal = signal ?? new AbortController().signal
  const getUid = process.getuid
  const uid = getUid?.()
  const anchor = async (file: string) => {
    if (process.platform !== 'linux') return
    if (uid === undefined) throw new Error('unverified-platform')
    await verifyLinuxAnchor(file, uid, 'file', volumeSignal, root)
  }
  if (process.platform === 'linux') await verifyLinuxLocalVolume(root, volumeSignal)
  const [name, tag] = model.split(':', 2)
  if (!name || !tag) throw new Error('unverified-model-name')
  const manifestFile = await exactPath(root, `manifests/registry.ollama.ai/library/${name}/${tag}`)
  if (process.platform === 'linux') await verifyLinuxLocalVolume(manifestFile, volumeSignal)
  await anchor(manifestFile)
  const manifestHandle = await open(manifestFile, 'r')
  const opened: FileHandle[] = []
  const held: { handle: FileHandle; file: string; before: BigIntStats; digest: string }[] = []
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
      signal?.throwIfAborted()
      const blobPath = await exactPath(root, `blobs/${blob.digest.replace(':', '-')}`)
      if (process.platform === 'linux') await verifyLinuxLocalVolume(blobPath, volumeSignal)
      await anchor(blobPath)
      const handle = await open(blobPath, 'r')
      opened.push(handle)
      const before = await handleIdentity(handle)
      held.push({ handle, file: blobPath, before, digest: blob.digest })
      if (!before.isFile() || before.size !== BigInt(blob.size))
        throw new Error('unverified-blob-size')
      const digest = await blobDigest(handle, signal)
      const after = await handleIdentity(handle)
      const named = await statIdentity(blobPath)
      if (
        !isSameLocalFileMetadata(before, after) ||
        !isSameLocalFileMetadata(before, named) ||
        digest !== blob.digest
      )
        throw new Error('unverified-blob-digest')
      await exactPath(root, `blobs/${blob.digest.replace(':', '-')}`)
      if (blob.mediaType === 'application/vnd.ollama.image.model') weightBytes += blob.size
    }
    // Every hash belongs to the same overlapping lifetime. An earlier blob
    // must still be the original, unchanged file after the LAST blob is hashed.
    for (const { handle, file, before, digest } of held) {
      // Windows may cache metadata while a reader holds the file open. Rehash
      // from offset zero as well; timestamps alone cannot prove unchanged bytes.
      const actual = await blobDigest(handle, signal)
      const after = await handleIdentity(handle)
      const named = await statIdentity(file)
      if (process.platform === 'linux') await verifyLinuxLocalVolume(file, volumeSignal)
      await anchor(file)
      if (
        actual !== digest ||
        !isSameLocalFileMetadata(before, after) ||
        !isSameLocalFileMetadata(before, named) ||
        before.ctimeNs !== after.ctimeNs ||
        before.ctimeNs !== named.ctimeNs ||
        (await realpath(file)) !== file
      )
        throw new Error('unverified-blob-snapshot')
    }
    if (!weightBytes || !bytes.equals(await readFile(manifestFile)))
      throw new Error('unverified-manifest')
    const final = await handleIdentity(manifestHandle)
    if (process.platform === 'linux') await verifyLinuxLocalVolume(manifestFile, volumeSignal)
    await anchor(manifestFile)
    if (
      !sameFile(initial, final) ||
      initial.size !== final.size ||
      initial.mtimeNs !== final.mtimeNs
    ) {
      throw new Error('unverified-manifest')
    }
    signal?.throwIfAborted()
    return { digest: served.digest, weightBytes }
  } finally {
    try {
      await Promise.all(opened.map((handle) => handle.close()))
    } finally {
      await manifestHandle.close()
    }
  }
}
