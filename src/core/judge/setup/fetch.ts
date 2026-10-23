// M125 lane H (D107 §8.1 step 3): the model fetcher. Blobs by digest
// from the registry, resumed by size, each checked by SHA-256, one
// retry on a mismatch and then it stops. The pure parts (ranges,
// resume math, hash checks) are unit-covered; the socket run proves
// in real life against the real registry (owner's go).
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { HTTP_STATUS } from '../../../shared/constants'
import { isErrno } from '../../fs/errno'

/** A Range header resuming at the byte offset. */
export function rangeHeader(offsetBytes: number): string {
  return `bytes=${String(offsetBytes)}-`
}

export interface FetchPlan {
  /** Resume at this offset, or fetch whole when 0. */
  readonly offsetBytes: number
}

/**
Where a blob fetch starts. A partial shorter than the blob resumes;
anything else (complete, oversized, unknown size) fetches whole and
the hash decides.
*/
export function planBlobFetch(presentBytes: number, totalBytes: number | undefined): FetchPlan {
  return {
    offsetBytes:
      totalBytes === undefined || presentBytes < 0 || presentBytes >= totalBytes ? 0 : presentBytes,
  }
}

/** SHA-256 over bytes, hex, for the blob check. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Whether the bytes hash to the expected digest. */
export function isBlobDigestMatch(bytes: Uint8Array, expectedDigest: string): boolean {
  return sha256Hex(bytes) === expectedDigest.toLowerCase()
}

export type FetchBlobResult = 'ok' | 'hash-mismatch' | 'failed'

export interface FetchBlobOptions {
  readonly signal?: AbortSignal | undefined
  readonly onProgress?: ((receivedBytes: number) => void) | undefined
}

/**
Fetch one blob to its file, resuming a partial by size and checking
SHA-256 at the end. A mismatch refetches whole once, then stops with
hash-mismatch; nothing retries forever and nothing partial is kept as
done. Throws only when the file cannot be closed (bytes may be lost).
Live-proof deferred: needs the registry and the owner's go.
@unwired M125 model-fetch socket run (wiring: the install path, lanes F2/W)
*/
export async function fetchBlob(
  url: string,
  file: string,
  expectedDigest: string,
  totalBytes: number | undefined,
  options: FetchBlobOptions = {},
): Promise<FetchBlobResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await fetchBlobOnce(url, file, expectedDigest, totalBytes, options, attempt > 0)
    if (outcome !== 'hash-mismatch') return outcome
  }
  return 'hash-mismatch'
}

async function fetchBlobOnce(
  url: string,
  file: string,
  expectedDigest: string,
  totalBytes: number | undefined,
  options: FetchBlobOptions,
  isRetry: boolean,
): Promise<FetchBlobResult> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(file, 'a+')
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    return 'failed'
  }
  try {
    if (isRetry) await handle.truncate(0)
    const existing = await handle.stat()
    let offsetBytes = planBlobFetch(existing.size, totalBytes).offsetBytes
    let response: Response
    try {
      response = await fetch(url, {
        headers: offsetBytes > 0 ? { Range: rangeHeader(offsetBytes) } : {},
        ...(options.signal !== undefined && { signal: options.signal }),
      })
    } catch (error: unknown) {
      // A refused fetch fails the blob, an aborted one too; anything
      // else keeps its kind.
      if (error instanceof TypeError) return 'failed'
      if (!(error instanceof DOMException)) throw error
      return 'failed'
    }
    if (offsetBytes > 0 && response.status === HTTP_STATUS.ok) {
      // The server ignored the range: the body is the whole blob.
      await handle.truncate(0)
      offsetBytes = 0
    }
    if (offsetBytes > 0 && response.status !== HTTP_STATUS.partialContent) return 'failed'
    if (offsetBytes === 0 && !response.ok) return 'failed'
    if (response.body === null) return 'failed'
    const hash = createHash('sha256')
    if (offsetBytes > 0) {
      const kept = await handle.readFile()
      hash.update(kept.subarray(0, offsetBytes))
    }
    let receivedBytes = offsetBytes
    for await (const chunk of response.body) {
      hash.update(chunk)
      await handle.appendFile(chunk)
      receivedBytes += chunk.length
      options.onProgress?.(receivedBytes)
    }
    await handle.sync()
    return hash.digest('hex') === expectedDigest.toLowerCase() ? 'ok' : 'hash-mismatch'
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    return 'failed'
  } finally {
    await handle.close()
  }
}
