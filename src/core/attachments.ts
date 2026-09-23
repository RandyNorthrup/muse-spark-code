// Images waiting to go out with the next message. The host owns the bytes
// (the webview only shows chips) so a pasted screenshot never round-trips
// through postMessage twice, and the MSP image parts are built here.

import { Buffer } from 'node:buffer'
import { MAX_ATTACHMENTS_PER_MESSAGE, MAX_IMAGE_BYTES, UI_TEXT } from '../shared/constants'
import type { AttachmentSummary } from '../shared/protocol'
import { readImageInfo } from './imageDimensions'
import type { TurnPart } from './agent/agentBackend'

export type AddAttachmentResult =
  | { readonly ok: true; readonly attachment: AttachmentSummary }
  | { readonly ok: false; readonly reason: string }

interface StoredAttachment {
  readonly summary: AttachmentSummary
  readonly bytes: Uint8Array
}

export class AttachmentStore {
  private readonly entries = new Map<string, StoredAttachment>()

  public constructor(private readonly newId: () => string) {}

  public add(name: string, bytes: Uint8Array): AddAttachmentResult {
    if (this.entries.size >= MAX_ATTACHMENTS_PER_MESSAGE) {
      return { ok: false, reason: UI_TEXT.attachmentLimit }
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, reason: UI_TEXT.attachmentTooLarge }
    }
    const info = readImageInfo(bytes)
    if (info === undefined) {
      return { ok: false, reason: UI_TEXT.attachmentUnsupported }
    }
    const summary: AttachmentSummary = {
      id: this.newId(),
      name,
      mediaType: info.mediaType,
      width: info.width,
      height: info.height,
      sizeBytes: bytes.byteLength,
    }
    this.entries.set(summary.id, { summary, bytes })
    return { ok: true, attachment: summary }
  }

  public remove(id: string): boolean {
    return this.entries.delete(id)
  }

  public clear(): void {
    this.entries.clear()
  }

  public get size(): number {
    return this.entries.size
  }

  public list(): readonly AttachmentSummary[] {
    return Array.from(this.entries.values(), (entry) => entry.summary)
  }

  /**
   * Image parts for the given ids (unknown ids are skipped). The images stay
   * until `release`: a message the host refused keeps them for another try.
   */
  public partsFor(ids: readonly string[]): readonly TurnPart[] {
    const parts: TurnPart[] = []
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry === undefined) {
        continue
      }
      parts.push({
        type: 'image',
        base64Data: Buffer.from(entry.bytes).toString('base64'),
        mediaType: entry.summary.mediaType,
        width: entry.summary.width,
        height: entry.summary.height,
      })
    }
    return parts
  }

  /** The message carrying these images was accepted: they are gone from the composer. */
  public release(ids: readonly string[]): void {
    for (const id of ids) {
      this.entries.delete(id)
    }
  }
}
