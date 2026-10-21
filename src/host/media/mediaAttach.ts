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
import type { MediaContributorConsent } from '../../core/media/contributorConsent'
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
        readonly close: () => Promise<void>
      }
    | undefined
  >
  readonly capabilities: (modelId: string) => MediaModelCapabilities
  readonly limits: () => MediaLimits
  /** Register the approved source and its digest with the host's attached-media
  registry; `release` lets go of it when its chip is discarded. */
  readonly bind: (
    file: PickedFile,
    info: MediaFileInfo,
    sha256: string,
  ) => {
    readonly part: (summary: AttachmentSummary) => TurnPart
    readonly release: () => void
  }
  /** The conversation ends: every registration this port made and no turn holds goes. */
  readonly release?: () => void
  /**
  D85.7: one `MediaContributorConsent` per port over the editor's own
  modal (built by the host, so this bundle stays small). On a contributor
  model, video and audio ask once per conversation; a screen recording
  always asks. Absent there, the attachment is refused rather than sent
  unasked.
  */
  readonly chooseContributor?: MediaContributorConsent['choose']
  /**
  Lane V seam 3B: whether this host transcribes attached sound for the
  model (Muse Voice on, the Model API key's transcription POST). A
  standalone audio file the model does not hear is then admitted, and the
  caller says it will be transcribed; absent, the gate's refusal stands.
  */
  readonly transcribesSound?: (info: MediaFileInfo, modelId: string) => boolean
}

/** The model's own gate, or, for audio it does not hear, Muse Voice's transcription. */
function admission(
  info: MediaFileInfo,
  model: MediaModelCapabilities,
  transcribesSound: MediaAttachDeps['transcribesSound'],
): ReturnType<typeof modalityGate> {
  const gate = modalityGate(info, model)
  return !gate.ok && info.kind === 'audio' && transcribesSound?.(info, model.modelId) === true
    ? {
        ok: true,
        soundtrackWarning: fill(UI_TEXT.media.audioWillTranscribe, { model: model.modelName }),
      }
    : gate
}

/** D85.7's answer for one attachment: proceed, or the reason it was not attached. */
async function contributorChoice(
  choose: MediaAttachDeps['chooseContributor'],
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
  if (choose === undefined)
    return { ok: false, reason: fill(UI_TEXT.media.contributorDeclined, { name: request.name }) }
  const choice = await choose({ ...request, contributor: isContributor })
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
        const gate = admission(sniffed.info, model, deps.transcribesSound)
        if (!gate.ok) return gate
        // The digest the upload ledger dedups by and every reopen must match.
        const sha256 = await sourceDigest(opened.source)
        if (epoch !== generation) return { ok: false, reason: UI_TEXT.attachmentUnreadable }
        const chosen = await contributorChoice(
          deps.chooseContributor,
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
        // D121: the registry holds any number of registrations, so binding
        // cannot refuse for capacity; a duplicate token still throws.
        const bound: ReturnType<MediaAttachDeps['bind']> = deps.bind(file, sniffed.info, sha256)
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
                  ? admission(info, model, deps.transcribesSound)
                  : { ok: false, reason: UI_TEXT.attachmentUnreadable },
              part: (summary, info) => {
                if (info !== sniffed.info) throw new Error('Media source mismatch')
                return bound.part(summary)
              },
              release: bound.release,
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
      deps.release?.()
    },
  }
}
