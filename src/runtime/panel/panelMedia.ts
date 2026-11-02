// M105 delivery d (D85): MHP's `attachments/*` on the native panel. One
// dispatch per conversation over E3's adapter: the IDE's file chooser
// (`ui/openFile`) and host-minted path tokens through the established
// sniff, gate, consent and registry pipeline. Recording stays a wired
// refusal: delivery c owns the recorder.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileAccess, PickedFile } from '../../host/conversation/conversationController'
import type { Logger } from '../../host/logger'
import { mediaBundleLoader } from '../../host/media/mediaBundle'
import {
  createMediaAttachDeps,
  createMediaSourceOpen,
  type MediaHostSettings,
} from '../../host/media/mediaProviders'
import { AttachedMedia } from '../../core/media/attachedMedia'
import type { MediaAttachmentPort } from '../../host/media/mediaAttach'
import {
  nativeAttachments,
  NativeAttachmentRefusal,
  type NativeAttachmentPort,
} from '../companion/nativeAttachments'
import { fill } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { MHP_ERROR_CODES, UI_TEXT, type AcpBackendKind } from '../../shared/constants'
import { MhpServiceError } from './connection'
import type { AttachmentsResult } from '../../shared/hostApi/attachments'
import type { MhpParams, MhpResult } from '../../shared/hostApi/methods'
import type { AttachmentSummary } from '../../shared/protocol'

/** One conversation's answer to `attachments/*`, over the MHP wire. */
export type AttachmentDispatch = (request: unknown) => Promise<AttachmentsResult>

/** The host surface the panel's attach flow needs: the chooser and the modal. */
export interface PanelMediaHost {
  request(
    method: 'ui/openFile',
    params: MhpParams<'ui/openFile'>,
    signal?: AbortSignal,
  ): Promise<MhpResult<'ui/openFile'>>
  request(
    method: 'ui/confirm',
    params: MhpParams<'ui/confirm'>,
    signal?: AbortSignal,
  ): Promise<MhpResult<'ui/confirm'>>
}

export interface PanelMediaOptions {
  /** The panel's data root; the recorder's future temp dir lives under it. */
  readonly dataRoot: string
  readonly workspaceRoot: string
  /** The settings store, read live for the media keys it carries. */
  readonly settings: { current(): MediaHostSettings }
  readonly files: Pick<FileAccess, 'canonicalRelativePath' | 'toRelativePath'>
  readonly host: PanelMediaHost
  /** The backend and model prepare gates against, read live per call. */
  readonly model: () => { readonly backend: AcpBackendKind; readonly modelId: string }
  /** The captured session is still this bridge's current binding. */
  readonly isCurrent: () => boolean
  readonly log: Logger
  /** The installed table and locale the media bundle reads with. */
  readonly table: UiText
  readonly locale: string
  /** The folder holding the agent's bundles (`media.js` loads on first attach). */
  readonly distDir: string
  /** The media bundle's loader seam; requireFile outside tests. */
  readonly loadBundle?: (file: string) => unknown
}

/**
A controller's attachment surface for the MHP router. Exactly one live
controller answers: zero or two is `unsupported`, never an arbitrary
peer's conversation (the `browserUi` single-owner rule).
*/
export interface AttachmentOwner {
  readonly sessionId: string
  readonly isReleased: boolean
  readonly attachments: AttachmentDispatch | undefined
}

export function selectAttachmentOwner(
  controllers: Iterable<AttachmentOwner>,
  isHeld: (controller: AttachmentOwner) => boolean,
): (AttachmentOwner & { readonly attachments: AttachmentDispatch }) | undefined {
  let owner: (AttachmentOwner & { readonly attachments: AttachmentDispatch }) | undefined
  for (const controller of controllers) {
    const { sessionId, isReleased, attachments } = controller
    if (isReleased || attachments === undefined || !isHeld(controller)) continue
    if (owner !== undefined) return undefined
    owner = { sessionId, isReleased, attachments }
  }
  return owner
}

/**
The MHP router's `attachments/*` route: the single live owner's dispatch
answers; zero or two owners refuse with `unsupportedCapability`, never an
arbitrary peer's conversation. The dispatch validates the raw frame itself.
*/
export async function routeAttachmentMethod(
  controllers: Iterable<AttachmentOwner>,
  isHeld: (controller: AttachmentOwner) => boolean,
  raw: unknown,
): Promise<AttachmentsResult> {
  const owner = selectAttachmentOwner(controllers, isHeld)
  if (owner === undefined)
    throw new MhpServiceError(MHP_ERROR_CODES.unsupportedCapability, 'MHP_UNSUPPORTED_CAPABILITY')
  return await owner.attachments(raw)
}

export function createPanelMedia(options: PanelMediaOptions): {
  readonly dispatch: AttachmentDispatch
  readonly release: () => void
} {
  const attached = new AttachedMedia()
  const bundlePath = path.join(options.distDir, 'media.js')
  const loadMedia =
    options.loadBundle === undefined
      ? mediaBundleLoader(bundlePath, options.log)
      : mediaBundleLoader(bundlePath, options.log, options.loadBundle)
  const deps = createMediaAttachDeps(
    () => options.settings.current(),
    createMediaSourceOpen({
      canonicalRelativePath: (fsPath) => options.files.canonicalRelativePath(fsPath),
      // No recorder is bound on the native panel, so nothing is produced
      // here yet and nothing skips confinement; delivery c produces here.
      recordingTempRoot: path.join(options.dataRoot, 'recordings'),
    }),
    {
      attached,
      askContributor: async (question) => {
        const labels = {
          send: UI_TEXT.media.send,
          useStandard: UI_TEXT.media.useStandard,
          remove: UI_TEXT.removeAttachment,
        } as const
        const picked = await options.host.request('ui/confirm', {
          title: question.title,
          message: question.detail,
          choices: question.choices.map((choice) => ({ id: choice, title: labels[choice] })),
        })
        return question.choices.find((choice) => choice === picked) ?? 'remove'
      },
    },
  )
  let port: MediaAttachmentPort | undefined
  const attachPort = (): MediaAttachmentPort =>
    (port ??= loadMedia().createMediaAttachments(deps, options.table, options.locale))

  const attachOne = async (file: PickedFile) => {
    const current = options.model()
    const prepared = await attachPort().prepare(
      attachPort().issue(file),
      current.backend,
      current.modelId,
    )
    if (!prepared.ok) throw new NativeAttachmentRefusal(prepared.reason)
    // The canonical bind ignores its summary and returns the prebuilt
    // media part; this one is still exact, so a future bind that reads it
    // behaves. The token is the upload the host forwards to the panel.
    const info = prepared.attachment.info
    const summary: AttachmentSummary = {
      id: deps.newToken(),
      name: prepared.attachment.name,
      mediaType: info.mediaType,
      sizeBytes: info.sizeBytes,
      ...(info.kind === 'video' &&
        info.width !== undefined &&
        info.height !== undefined && { width: info.width, height: info.height }),
    }
    const part = prepared.attachment.store.part(summary, info)
    if (part.type !== 'media') throw new NativeAttachmentRefusal(UI_TEXT.attachmentUnreadable)
    return {
      requestId: deps.newToken(),
      uploadToken: part.token,
      name: prepared.attachment.name,
      info,
    }
  }

  const portCalls: NativeAttachmentPort = {
    pick: async () => {
      const uri = await options.host.request('ui/openFile', { title: UI_TEXT.attachFile })
      if (uri === null) return { attachments: [] }
      let fsPath: string
      try {
        fsPath = fileURLToPath(uri)
      } catch {
        throw new NativeAttachmentRefusal(UI_TEXT.attachmentUnreadable)
      }
      return {
        attachments: [
          await attachOne({
            name: path.basename(fsPath),
            fsPath,
            relativePath: options.files.toRelativePath(uri),
          }),
        ],
      }
    },
    attach: async (pathToken) => {
      const fsPath = path.isAbsolute(pathToken)
        ? pathToken
        : path.resolve(options.workspaceRoot, pathToken)
      const relative = path.isAbsolute(pathToken)
        ? path.relative(options.workspaceRoot, fsPath)
        : pathToken
      return {
        attachments: [
          await attachOne({
            name: path.basename(fsPath),
            fsPath,
            relativePath:
              relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
                ? undefined
                : relative.replaceAll(path.sep, '/'),
          }),
        ],
      }
    },
    remove: (id) => {
      attached.release(id)
      return Promise.resolve({ attachments: [] })
    },
    record: () =>
      Promise.reject(
        new NativeAttachmentRefusal(
          fill(UI_TEXT.media.recordingUnavailable, { reason: UI_TEXT.media.recorderUnavailable }),
        ),
      ),
  }
  return {
    dispatch: nativeAttachments(portCalls, {
      isCurrent: options.isCurrent,
      // Every call arrives over the panel's own bridge, which only the
      // interactive host drives; tools and headless callers have no route
      // here, and recording refuses regardless.
      isInteractiveUser: () => true,
    }),
    release: () => {
      port?.clear()
      port = undefined
      attached.clear()
    },
  }
}
