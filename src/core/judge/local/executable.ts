import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { LOCAL_JUDGE_HASH_CHUNK_BYTES } from '../../../shared/constants'
import { handleIdentity, sameFile, statIdentity } from '../../fs/fileIdentity'

/** A vetted install digest, never learned from a responding endpoint. */
export async function requireLocalExecutable(
  file: string,
  digest: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if ((await realpath(file)) !== path.resolve(file)) throw new Error('unverified-runtime-path')
  const handle = await open(file, 'r')
  try {
    const before = await handleIdentity(handle)
    if (!before.isFile()) throw new Error('unverified-runtime')
    const hash = createHash('sha256')
    const stream = handle.createReadStream({
      autoClose: false,
      highWaterMark: LOCAL_JUDGE_HASH_CHUNK_BYTES,
    })
    for await (const chunk of stream) {
      signal.throwIfAborted()
      if (!Buffer.isBuffer(chunk)) throw new Error('unverified-runtime-bytes')
      hash.update(chunk)
    }
    const after = await handleIdentity(handle)
    const named = await statIdentity(file)
    signal.throwIfAborted()
    if (
      hash.digest('hex') !== digest ||
      !sameFile(before, after) ||
      !sameFile(before, named) ||
      before.size !== after.size ||
      before.size !== named.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.mtimeNs !== named.mtimeNs
    )
      throw new Error('unverified-runtime')
  } finally {
    await handle.close()
  }
}
