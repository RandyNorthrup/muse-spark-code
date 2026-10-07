// Loaded on the first media attachment. Sources and turn bindings belong to
// the host; no path, bytes, upload or credential is handed to the browser.
import type { TurnPart } from '../../core/agent/agentBackend'
import type { AttachmentMediaPort } from '../../core/attachments'
import {
  checkMediaLimits,
  sniffMedia,
  sniffMediaBytes,
  type MediaFileInfo,
  type MediaLimits,
  type MediaSource,
} from '../../core/media/limits'
import { modalityGate, type MediaModelCapabilities } from '../../core/media/modalityGate'
import { UI_TEXT } from '../../shared/constants'
import { mediaAttachmentRequestSchema } from '../../shared/media'
import type { AttachmentSummary } from '../../shared/protocol'
import type { PickedFile } from '../conversation/conversationController'

export interface PreparedMediaAttachment {
  readonly name: string
  readonly info: MediaFileInfo
  readonly store: AttachmentMediaPort
}

export type PrepareMediaResult =
  | { readonly ok: true; readonly attachment: PreparedMediaAttachment }
  | { readonly ok: false; readonly reason: string }

export interface MediaAttachmentPort {
  /** Only a host-approved picker result or confined URI may mint a token. */
  readonly issue: (file: PickedFile) => string
  readonly prepare: (
    token: string,
    backend: 'museCode' | 'modelApi',
    modelId: string,
  ) => Promise<PrepareMediaResult>
  readonly clear: () => void
}

export interface MediaAttachDeps {
  readonly newToken: () => string
  /** Recheck confinement/approval and file identity on every open. */
  readonly open: (
    file: PickedFile,
  ) => Promise<{ readonly source: MediaSource; readonly close: () => Promise<void> } | undefined>
  readonly capabilities: (modelId: string) => MediaModelCapabilities
  readonly limits: () => MediaLimits
  /** Bind the approved private source to M2, including its digest check. */
  readonly bind: (file: PickedFile, info: MediaFileInfo) => (summary: AttachmentSummary) => TurnPart
}

/** One-use tokens, invalidated with the conversation's attachment generation. */
export function createMediaAttachments(deps: MediaAttachDeps): MediaAttachmentPort {
  const files = new Map<string, PickedFile>()
  let generation = 0
  return {
    issue: (file) => {
      const token = deps.newToken()
      // Validate our token against the same boundary as attachMedia.
      mediaAttachmentRequestSchema.parse({
        type: 'attachMedia',
        requestId: token,
        pathToken: token,
      })
      if (files.has(token)) throw new Error('Duplicate media path token')
      files.set(token, file)
      return token
    },
    prepare: async (token, backend, modelId) => {
      const file = files.get(token)
      files.delete(token)
      if (file === undefined) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
      if (backend !== 'modelApi') return { ok: false, reason: UI_TEXT.media.museCodeRefusal }
      const epoch = generation
      const opened = await deps.open(file)
      if (opened === undefined) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
      try {
        const sniffed = await sniffMedia(opened.source)
        if (epoch !== generation) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
        if (!sniffed.ok) return sniffed
        const limits = checkMediaLimits(sniffed.info, deps.limits())
        if (!limits.ok) return limits
        const model = deps.capabilities(modelId)
        if (model.modelId !== modelId) throw new Error('Media capability model mismatch')
        const gate = modalityGate(sniffed.info, model)
        if (!gate.ok) return gate
        const part = deps.bind(file, sniffed.info)
        return {
          ok: true,
          attachment: {
            name: file.name,
            info: sniffed.info,
            store: {
              sniff: sniffMediaBytes,
              check: (info) =>
                info === sniffed.info
                  ? modalityGate(info, model)
                  : { ok: false, reason: UI_TEXT.attachmentUnreadable },
              part: (summary, info) => {
                if (info !== sniffed.info) throw new Error('Media source mismatch')
                return part(summary)
              },
            },
          },
        }
      } finally {
        await opened.close()
      }
    },
    clear: () => {
      generation += 1
      files.clear()
    },
  }
}
