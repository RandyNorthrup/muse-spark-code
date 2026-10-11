import { createHash } from 'node:crypto'
import { expect, vi } from 'vitest'
import {
  UploadLedger,
  type UploadLedgerDeps,
  type UploadLedgerState,
} from '../../../../src/core/media/uploadLedger'
import { ModelApiError } from '../../../../src/core/backends/modelapi/client'
import type { UploadSource } from '../../../../src/core/backends/modelapi/files'
import { replayRig, uploaded, videoMedia } from './replay'

/** Real F ledger with synthetic Files projections, no HTTP or claimed raw captures. */
export function replayLedgerRig() {
  let data = new Uint8Array([1, 2, 3])
  const media = {
    ...videoMedia(),
    sha256: createHash('sha256').update(data).digest('hex'),
    info: { ...videoMedia().info, sizeBytes: data.byteLength },
  }
  let state: UploadLedgerState | undefined
  const accountId = 'b'.repeat(64)
  const missing = new Set<string>()
  let serial = 0
  const read = () => Promise.resolve(data)
  const source: UploadSource = {
    name: media.name,
    mime: media.info.mediaType,
    bytes: media.info.sizeBytes,
    open: async function* (signal) {
      signal.throwIfAborted()
      yield await read()
    },
  }
  const upload = vi.fn(async (input: UploadSource, signal: AbortSignal) => {
    const hash = createHash('sha256')
    for await (const chunk of input.open(signal)) hash.update(chunk)
    expect(hash.digest('hex')).toBe(media.sha256)
    serial += 1
    return { ...uploaded(media, `file-${String(serial)}`), expiresAt: 1 }
  })
  const files: UploadLedgerDeps['files'] = {
    forAccount: (id) => {
      expect(id).toBe(accountId)
      return files
    },
    upload,
    retrieve: (id) =>
      missing.has(id)
        ? Promise.reject(new ModelApiError('missing', 404, undefined, undefined))
        : Promise.resolve({}),
    accountFiles: () => Promise.resolve([]),
    delete: () => Promise.resolve(),
  }
  const ledger = new UploadLedger({
    files,
    accountId,
    provider: 'meta',
    poolBytes: 100_000,
    currentAccountId: () => Promise.resolve(accountId),
    now: () => 10_000,
    storage: {
      read: () => Promise.resolve(structuredClone(state)),
      write: (value) => {
        state = structuredClone(value)
        return Promise.resolve()
      },
      withLock: async (operation) => await operation(),
    },
  })
  const rig = replayRig(media, { ledger: () => ledger, source: () => Promise.resolve(source) })
  return {
    ...rig,
    media,
    ledger,
    source,
    upload,
    missing,
    changeSource: () => {
      data = new Uint8Array([4, 5, 6])
    },
  }
}
