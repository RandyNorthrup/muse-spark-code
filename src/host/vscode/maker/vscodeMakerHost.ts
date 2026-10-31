import { createHash } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import type { MakerHost, MakerStorage } from '../../../core/maker/ports'
import {
  MAKER_COMMANDS,
  MAKER_MODAL_MAX_CHARS,
  MAKER_MODAL_MAX_LINES,
  MAKER_STORAGE_PREFIX,
  UI_TEXT,
} from '../../../shared/constants'
import {
  makerApprovalRequestSchema,
  makerHostMessageSchema,
  makerNoticeSchema,
  makerPreviewSchema,
  type ApprovalAnswer,
  type ApprovalRequest,
  type MakerMachineSummary,
  type MakerNotice,
  type MakerPreview,
} from '../../../shared/makerProtocol'
import type { Logger } from '../../logger'
import type { MakerApprovalPreview } from './makerPreviewPanel'

export interface VscodeMakerDeps {
  readonly context: Pick<
    vscode.ExtensionContext,
    'storageUri' | 'globalStorageUri' | 'workspaceState' | 'globalState' | 'secrets'
  >
  readonly log: Logger
  /** Engine-owned hardware latch; never a workspace configuration value. */
  readonly hardwareEnabled: () => boolean
  /** Top-level attended session only: false in Plan, tasks and all workers. */
  readonly isInteractive: () => boolean
  /** The engine's independent Stop, never queued behind an action. */
  readonly stop: (machineId?: string) => Promise<void>
  readonly openPreview: (preview: MakerPreview) => Promise<void>
  /** Resolves only after delivery and the owned page's rendered-byte acknowledgement. */
  readonly openApprovalPreview: (
    request: ApprovalRequest,
    signal: AbortSignal,
  ) => Promise<MakerApprovalPreview | undefined>
}

function storage(memento: vscode.Memento, directory: string): MakerStorage {
  return {
    directory,
    get: (key) => Promise.resolve(memento.get<unknown>(`${MAKER_STORAGE_PREFIX}${key}`)),
    update: async (key, value) => {
      await memento.update(`${MAKER_STORAGE_PREFIX}${key}`, value)
    },
    delete: async (key) => {
      await memento.update(`${MAKER_STORAGE_PREFIX}${key}`, undefined)
    },
  }
}

async function directory(uri: vscode.Uri | undefined): Promise<string> {
  if (uri?.scheme !== 'file') throw new Error(UI_TEXT.makerUnavailable)
  const folder = path.join(uri.fsPath, 'maker')
  await mkdir(folder, { recursive: true })
  const canonical = await realpath(folder)
  const folders = vscode.workspace.workspaceFolders ?? []
  for (const workspace of folders) {
    const root = await realpath(workspace.uri.fsPath)
    const relative = path.relative(root, canonical)
    if (
      relative === '' ||
      (relative !== '..' && !path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`))
    )
      throw new Error(UI_TEXT.makerUnavailable)
  }
  return canonical
}

/** Native approval answers are display data; the engine retains/consumes authority. */
export class VscodeMakerHost implements MakerHost, vscode.Disposable {
  private readonly pending = new Set<AbortController>()
  private item: vscode.StatusBarItem | undefined
  private isDisposed = false

  constructor(
    private readonly deps: VscodeMakerDeps,
    readonly storage: MakerHost['storage'],
  ) {}

  private admitted(): boolean {
    return this.isTrusted() && this.hardwareEnabled() && this.isInteractive()
  }

  get secrets(): MakerHost['secrets'] {
    return {
      get: async (name) => await this.deps.context.secrets.get(name),
      store: async (name, value) => {
        await this.deps.context.secrets.store(name, value)
      },
      delete: async (name) => {
        await this.deps.context.secrets.delete(name)
      },
    }
  }
  isTrusted(): boolean {
    return !this.isDisposed && vscode.workspace.isTrusted
  }
  hardwareEnabled(): boolean {
    return !this.isDisposed && this.deps.hardwareEnabled()
  }
  isInteractive(): boolean {
    return !this.isDisposed && this.deps.isInteractive()
  }

  /** Without the engine's review callback no payload review can succeed, so allow_once refuses. */
  async confirm(
    raw: ApprovalRequest,
    didReview: (raw: unknown) => boolean = () => false,
  ): Promise<ApprovalAnswer | undefined> {
    const request = makerApprovalRequestSchema.parse(raw)
    if (!this.admitted() || Date.now() >= request.expiresAt) return undefined
    const payload = request.kind === 'serial' ? request.payload.value : request.payload
    const shownDigest = createHash('sha256')
      .update(
        request.kind === 'serial' && request.payload.encoding === 'hex'
          ? Buffer.from(payload, 'hex')
          : payload,
      )
      .digest('hex')
    if (shownDigest !== request.digest) return undefined
    const cancellation = new AbortController()
    const cancelled = new Promise<undefined>((resolve) => {
      cancellation.signal.addEventListener(
        'abort',
        () => {
          resolve(undefined)
        },
        { once: true },
      )
    })
    this.pending.add(cancellation)
    const timer = setTimeout(
      () => {
        cancellation.abort()
      },
      Math.max(0, request.expiresAt - Date.now()),
    )
    let preview: MakerApprovalPreview | undefined
    const previewClosed = () => {
      cancellation.abort()
    }
    const isCurrent = () =>
      this.admitted() &&
      Date.now() < request.expiresAt &&
      !cancellation.signal.aborted &&
      (preview === undefined || preview.canSend(request.id, request.digest))
    try {
      const display = async (): Promise<ApprovalAnswer | undefined> => {
        const isLong =
          payload.length > MAKER_MODAL_MAX_CHARS ||
          payload.split('\n').length > MAKER_MODAL_MAX_LINES
        if (isLong) {
          preview = await this.deps.openApprovalPreview(
            structuredClone(request),
            cancellation.signal,
          )
          if (preview?.id !== request.id || !isCurrent()) {
            preview?.dispose()
            return undefined
          }
          preview.signal.addEventListener('abort', previewClosed, { once: true })
        }
        const detail = [
          `${UI_TEXT.makerTargetLabel}: ${JSON.stringify(request.target, null, 2)}`,
          `${request.action}: ${request.digest}`,
          ...(request.kind === 'serial'
            ? [
                UI_TEXT.makerResetWarning,
                JSON.stringify({
                  encoding: request.payload.encoding,
                  baud: request.baud,
                  durationMs: request.durationMs,
                  dtr: request.dtr,
                  rts: request.rts,
                  flashIdentity: request.flashIdentity,
                  projectTarget: request.projectTarget,
                }),
              ]
            : []),
          `${UI_TEXT.makerPayloadLabel}:\n${isLong ? UI_TEXT.makerPreviewTitle : payload}`,
          ...(request.kind === 'machine'
            ? [`${UI_TEXT.makerAnalysisLabel}: ${JSON.stringify(request.analysis, null, 2)}`]
            : []),
          UI_TEXT.makerSoftwareStopWarning,
        ].join('\n\n')
        const send = { title: UI_TEXT.makerSendOnce }
        const reject = { title: UI_TEXT.makerReject, isCloseAffordance: true }
        const chosen = await vscode.window.showWarningMessage(
          UI_TEXT.makerApprovalTitle,
          { modal: true, detail },
          send,
          reject,
        )
        if (!isCurrent() || (preview !== undefined && !preview.decide(request.id, request.digest)))
          return undefined
        const digest = preview?.digest ?? shownDigest
        // The modal (with its rendered preview) is the review: only Send once submits it.
        if (
          chosen === send &&
          !didReview({
            v: 1,
            type: 'makerPayloadReviewed',
            id: request.id,
            digest,
            isComplete: true,
          })
        )
          return undefined
        return {
          id: request.id,
          digest,
          target: request.target,
          decision: chosen === send ? 'allow_once' : 'reject_once',
        }
      }
      return await Promise.race([display(), cancelled])
    } finally {
      clearTimeout(timer)
      this.pending.delete(cancellation)
      cancellation.abort()
      preview?.dispose()
    }
  }

  notify(raw: MakerNotice): Promise<void> {
    const notice = makerNoticeSchema.parse(raw)
    let shown: Thenable<unknown>
    if (typeof notice === 'string') {
      const words = {
        physicalStopRequired: UI_TEXT.makerPhysicalStopRequired,
        startupMotion: UI_TEXT.makerStartupMotion,
        limitsUnavailable: UI_TEXT.makerLimitsUnavailable,
        auditUnrecorded: UI_TEXT.makerAuditUnrecorded,
        sentOutcomeUnknown: UI_TEXT.makerSentOutcomeUnknown,
      }
      shown = vscode.window.showWarningMessage(words[notice])
    } else if (notice.type === 'presetsOffered') {
      shown = vscode.window.showInformationMessage([notice.title, ...notice.notices].join('\n'))
    } else {
      if (notice.level === 'error') shown = vscode.window.showErrorMessage(notice.message)
      else if (notice.level === 'warning') shown = vscode.window.showWarningMessage(notice.message)
      else shown = vscode.window.showInformationMessage(notice.message)
    }
    void Promise.resolve(shown).catch(() => {
      this.deps.log.error('Maker notice failed')
    })
    return Promise.resolve()
  }

  stopControls(machines: readonly MakerMachineSummary[]): void {
    makerHostMessageSchema.parse({
      v: 1,
      type: 'makerState',
      isTrusted: this.isTrusted(),
      hardwareEnabled: this.hardwareEnabled(),
      isInteractive: this.isInteractive(),
      machines,
      ports: [],
    })
    if (this.isDisposed) return
    if (machines.length === 0) {
      this.item?.hide()
      return
    }
    this.item ??= vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
    this.item.name = UI_TEXT.makerStopMachine
    this.item.text = `$(debug-stop) ${UI_TEXT.makerStopMachine}`
    this.item.tooltip = UI_TEXT.makerSoftwareStopWarning
    this.item.command = MAKER_COMMANDS.stopMachine
    this.item.show()
  }
  async stop(machineId?: string): Promise<void> {
    this.cancelApprovals()
    const [attempt] = await Promise.allSettled([
      (async () => {
        await this.deps.stop(machineId)
      })(),
    ])
    if (attempt.status === 'fulfilled') return
    await this.notify('physicalStopRequired')
    throw new Error(UI_TEXT.makerUnavailable)
  }
  cancelApprovals(): void {
    for (const cancellation of this.pending) cancellation.abort()
    this.pending.clear()
  }
  async openPreview(preview: MakerPreview): Promise<void> {
    if (this.isDisposed) throw new Error(UI_TEXT.makerUnavailable)
    await this.deps.openPreview(makerPreviewSchema.parse(preview))
  }
  dispose(): void {
    this.isDisposed = true
    this.cancelApprovals()
    this.item?.dispose()
  }
}

export async function createVscodeMakerHost(deps: VscodeMakerDeps): Promise<VscodeMakerHost> {
  const workspace = await directory(deps.context.storageUri)
  const machine = await directory(deps.context.globalStorageUri)
  return new VscodeMakerHost(deps, {
    workspace: storage(deps.context.workspaceState, workspace),
    machine: storage(deps.context.globalState, machine),
  })
}
