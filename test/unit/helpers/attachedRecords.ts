// Attach-path test scaffolding: an id-sequenced store and the registry record
// for audio bytes (sniffed kind, name and hash — metadata the registry
// re-verifies, never invented content).
import { createHash } from 'node:crypto'
import { AttachmentStore } from '../../../src/core/attachments'
import { sniffMediaBytes } from '../../../src/core/media/limits'

/** An attachment store handing out att-1, att-2, … ids. */
export function attachmentStore(): AttachmentStore {
  let next = 0
  return new AttachmentStore(() => {
    next += 1
    return `att-${String(next)}`
  })
}

/** The registry record for audio bytes: clip name, sniffed info and hash. */
export function wavRecord(bytes: Uint8Array) {
  const info = sniffMediaBytes(bytes)
  if (info?.kind !== 'audio') throw new Error('fixture must sniff as audio')
  return { name: 'clip.wav', info, sha256: createHash('sha256').update(bytes).digest('hex') }
}
