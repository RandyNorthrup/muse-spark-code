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
import { MediaContributorConsent } from '../../core/media/contributorConsent'
import { sourceDigest } from '../../core/media/attachedMedia'
import { CONTRIBUTOR_MODEL_SUFFIX, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { mediaAttachmentRequestSchema } from '../../shared/media'
import type { AttachmentSummary } from '../../shared/protocol'
import type { PickedFile } from '../conversation/conversationController'

export interface PreparedMediaAttachment {
  readonly name: string
  readonly info: MediaFileInfo
  readonly store: AttachmentMediaPort
}

export type PrepareMediaResult =
  | {
      readonly ok: true
      readonly attachment: PreparedMediaAttachment
      /** The model hears no soundtrack: the caller says this, the chip only labels sound. */
      readonly soundtrackWarning?: string
    }
  | {
      readonly ok: false
      readonly reason: string
      /** A bound converter can re-offer this file as mp4 (lane V binds the action). */
      readonly convertToMp4?: true
    }

export interface MediaAttachmentPort {
  /** Only a host-approved picker result or confined URI may mint a token. */
  readonly issue: (file: PickedFile) => string
  readonly prepare: (
    token: string,
    backend: 'museCode' | 'modelApi',
    modelId: string,
    options?: { readonly isScreenRecording?: boolean },
  ) => Promise<PrepareMediaResult>
  readonly clear: () => void
}

export interface MediaAttachDeps {
  readonly newToken: () => string
  /** Recheck confinement/approval and file identity on every open. */
  readonly open: (file: PickedFile) => Promise<
    | {
        readonly source: MediaSource
        /** The confined absolute path, for the local converter only. */
        readonly path?: string
        readonly close: () => Promise<void>
      }
    | undefined
  >
  readonly capabilities: (modelId: string) => MediaModelCapabilities
  readonly limits: () => MediaLimits
  /** Register the approved source and its digest with the host's attached-media registry. */
  readonly bind: (
    file: PickedFile,
    info: MediaFileInfo,
    sha256: string,
  ) => (summary: AttachmentSummary) => TurnPart
  /**
   * D85.7: the editor's own modal. On a contributor model, video and audio
   * ask once per conversation; a screen recording always asks. Absent there,
   * the attachment is refused rather than sent unasked.
   */
  readonly askContributor?: ConstructorParameters<typeof MediaContributorConsent>[0]
}

/** D85.7's answer for one attachment: proceed, or the reason it was not attached. */
async function contributorChoice(
  consent: MediaContributorConsent | undefined,
  request: {
    readonly conversationId: string
    readonly name: string
    readonly info: MediaFileInfo
    readonly modelId: string
    readonly isScreenRecording: boolean
  },
  capabilities: MediaAttachDeps['capabilities'],
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  const isContributor = request.modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX)
  if (!isContributor && !request.isScreenRecording) return { ok: true }
  if (consent === undefined)
    return { ok: false, reason: fill(UI_TEXT.media.contributorDeclined, { name: request.name }) }
  const choice = await consent.choose({ ...request, contributor: isContributor })
  if (choice === 'send') return { ok: true }
  if (choice === 'remove')
    return { ok: false, reason: fill(UI_TEXT.media.contributorDeclined, { name: request.name }) }
  // The Standard model is gated as itself: its own refusal, or switch and retry.
  const standard = isContributor
    ? request.modelId.slice(0, -CONTRIBUTOR_MODEL_SUFFIX.length)
    : request.modelId
  const gate = modalityGate(request.info, capabilities(standard))
  return {
    ok: false,
    reason: gate.ok
      ? fill(UI_TEXT.media.useStandardThenAttach, { model: standard, name: request.name })
      : gate.reason,
  }
}

/** One-use tokens, invalidated with the conversation's attachment generation. */
export function createMediaAttachments(deps: MediaAttachDeps): MediaAttachmentPort {
  const files = new Map<string, PickedFile>()
  let generation = 0
  const consent =
    deps.askContributor === undefined ? undefined : new MediaContributorConsent(deps.askContributor)
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
    prepare: async (token, backend, modelId, options) => {
      const file = files.get(token)
      files.delete(token)
      if (file === undefined) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
      if (backend !== 'modelApi') return { ok: false, reason: UI_TEXT.media.museCodeRefusal }
      const epoch = generation
      const opened = await deps.open(file)
      // No handle is a refusal (confinement/approval said no), not a failed
      // read: a throw below stays the read failure. (M105 E1 review.)
      if (opened === undefined) return { ok: false, reason: UI_TEXT.textFilePrivate }
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
        // The digest the upload ledger dedups by and every reopen must match.
        const sha256 = await sourceDigest(opened.source)
        if (epoch !== generation) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
        const chosen = await contributorChoice(
          consent,
          {
            conversationId: String(epoch),
            name: file.name,
            info: sniffed.info,
            modelId,
            isScreenRecording: options?.isScreenRecording === true,
          },
          deps.capabilities,
        )
        if (!chosen.ok) return chosen
        if (epoch !== generation) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
        const part = deps.bind(file, sniffed.info, sha256)
        return {
          ok: true,
          ...(gate.soundtrackWarning !== undefined && {
            soundtrackWarning: gate.soundtrackWarning,
          }),
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
