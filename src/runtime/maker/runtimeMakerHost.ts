import { realpath } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type { MakerHost, MakerSecrets, MakerSerialProvider } from '../../core/maker/ports'
import {
  makerApprovalRequestSchema,
  makerApprovalAnswerSchema,
  makerHostMessageSchema,
  type ApprovalRequest,
  type MakerHostMessage,
  type MakerMachineSummary,
  type MakerNotice,
  type MakerPreview,
  type MakerTarget,
} from '../../shared/makerProtocol'
import { RUNTIME_MAKER_STATE_KEY, UI_TEXT } from '../../shared/constants'
import { workspaceKey } from '../dataFolder'
import { RuntimeMakerStorage } from './storage'

const grantSchema = z.strictObject({
  enabled: z.boolean(),
  reason: z.string().check(z.minLength(1)),
  time: z.number(),
})
export interface RuntimeMakerHostDeps {
  readonly dataDirectory: string
  readonly workspace: string
  readonly secrets: MakerSecrets
  readonly trusted: () => boolean
  readonly flagged: () => boolean
  readonly interactive: () => boolean
  readonly serialProvider?: MakerSerialProvider
  readonly ask?: (request: ApprovalRequest) => Promise<unknown>
  readonly auditEnable: (reason: string) => Promise<void>
}

export class RuntimeMakerHost implements MakerHost {
  static async create(deps: RuntimeMakerHostDeps): Promise<RuntimeMakerHost> {
    const workspace = await realpath(deps.workspace)
    const root = path.join(deps.dataDirectory, 'maker')
    const machine = await RuntimeMakerStorage.create(root, workspace)
    const local = await RuntimeMakerStorage.create(
      path.join(root, 'workspaces', workspaceKey(workspace)),
      workspace,
    )
    const host = new RuntimeMakerHost(deps, { workspace: local, machine })
    await host.refresh()
    return host
  }
  /** Broken/unavailable grant storage must leave the companion's Stop usable, with authority off. */
  static stopOnly(deps: RuntimeMakerHostDeps): RuntimeMakerHost {
    const unavailable = {
      directory: path.join(deps.dataDirectory, 'maker'),
      get: () => Promise.reject(new Error('maker-authority-unavailable')),
      update: () => Promise.reject(new Error('maker-authority-unavailable')),
      delete: () => Promise.reject(new Error('maker-authority-unavailable')),
    }
    return new RuntimeMakerHost(
      { ...deps, trusted: () => false, flagged: () => false },
      {
        workspace: unavailable,
        machine: unavailable,
      },
    )
  }
  private enabled = false
  private readonly listeners = new Set<(message: MakerHostMessage) => void>()
  private readonly pending = new Map<
    string,
    { request: ApprovalRequest; resolve: (answer: unknown) => void }
  >()
  private machines: readonly MakerMachineSummary[] = []
  private ports: readonly Extract<MakerTarget, { kind: 'serial' }>[] = []
  readonly secrets: MakerSecrets
  readonly serialProvider?: MakerSerialProvider
  private constructor(
    private readonly deps: RuntimeMakerHostDeps,
    readonly storage: MakerHost['storage'],
  ) {
    this.secrets = deps.secrets
    if (deps.serialProvider !== undefined) this.serialProvider = deps.serialProvider
  }
  private emit(raw: unknown): void {
    const message = makerHostMessageSchema.parse(raw)
    for (const listener of this.listeners) listener(message)
  }
  isTrusted(): boolean {
    return this.deps.trusted()
  }
  hardwareEnabled(): boolean {
    return this.enabled && this.deps.flagged()
  }
  isInteractive(): boolean {
    return this.deps.interactive()
  }
  async refresh(): Promise<void> {
    this.enabled = false
    try {
      const raw = await this.storage.workspace.get(RUNTIME_MAKER_STATE_KEY)
      const grant = grantSchema.safeParse(raw)
      this.enabled = grant.success && grant.data.enabled
    } catch {
      // Unreadable authority stays off; it must not prevent independent Stop controls.
    }
    if (!this.hardwareEnabled() || !this.isTrusted() || !this.isInteractive())
      this.cancelApprovals()
  }
  async setHardware(isEnabled: boolean, reason?: string): Promise<void> {
    if (!isEnabled) {
      this.enabled = false
      this.cancelApprovals()
      await this.storage.workspace.delete(RUNTIME_MAKER_STATE_KEY)
      return
    }
    if (!this.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
    if (!this.isInteractive()) throw new Error(UI_TEXT.makerUnattendedDenied)
    if (reason === undefined || reason.trim() === '') throw new Error(UI_TEXT.makerHardwareReason)
    await this.deps.auditEnable(reason.trim())
    await this.storage.workspace.update(RUNTIME_MAKER_STATE_KEY, {
      enabled: isEnabled,
      reason: reason.trim(),
      time: Date.now(),
    })
    this.enabled = true
  }
  subscribe(listener: (message: MakerHostMessage) => void): () => void {
    this.listeners.add(listener)
    for (const { request } of this.pending.values())
      listener({ v: 1, type: 'makerApproval', request })
    listener(
      makerHostMessageSchema.parse({
        v: 1,
        type: 'makerState',
        isTrusted: this.isTrusted(),
        hardwareEnabled: this.hardwareEnabled(),
        isInteractive: this.isInteractive(),
        machines: this.machines,
        ports: this.ports,
      }),
    )
    return () => {
      this.listeners.delete(listener)
    }
  }
  async confirm(raw: ApprovalRequest): Promise<unknown> {
    const request = makerApprovalRequestSchema.parse(raw)
    if (
      !this.isTrusted() ||
      !this.hardwareEnabled() ||
      !this.isInteractive() ||
      Date.now() >= request.expiresAt
    )
      return undefined
    if (this.pending.has(request.id)) return undefined
    const reject = {
      id: request.id,
      digest: request.digest,
      target: request.target,
      decision: 'reject_once',
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const pending = new Promise<unknown>((resolve) => {
        this.pending.set(request.id, { request, resolve })
        timer = setTimeout(
          () => {
            resolve(reject)
          },
          Math.max(0, request.expiresAt - Date.now()),
        )
      })
      this.emit({ v: 1, type: 'makerApproval', request })
      return await Promise.race([
        pending,
        ...(this.deps.ask === undefined ? [] : [this.deps.ask(request)]),
      ])
    } finally {
      clearTimeout(timer)
      this.pending.delete(request.id)
      this.emit({ v: 1, type: 'makerApprovalClosed', id: request.id })
    }
  }
  answer(raw: unknown): boolean {
    const parsed = makerApprovalAnswerSchema.safeParse(raw)
    const correlation = z.object({ id: z.uuid() }).safeParse(raw)
    if (!correlation.success) return false
    const held = this.pending.get(correlation.data.id)
    if (held === undefined) return false
    this.pending.delete(correlation.data.id)
    held.resolve(raw)
    return parsed.success
  }
  cancelApprovals(): void {
    for (const { resolve } of this.pending.values()) resolve(undefined)
    this.pending.clear()
  }
  notify(notice: MakerNotice): void {
    this.emit({ v: 1, type: 'makerNotice', notice })
  }
  stopControls(machines: readonly MakerMachineSummary[]): void {
    this.machines = structuredClone(machines)
    this.emit({
      v: 1,
      type: 'makerState',
      isTrusted: this.isTrusted(),
      hardwareEnabled: this.hardwareEnabled(),
      isInteractive: this.isInteractive(),
      machines,
      ports: this.ports,
    })
  }
  updatePorts(ports: readonly Extract<MakerTarget, { kind: 'serial' }>[]): void {
    this.ports = structuredClone(ports)
  }
  openPreview(preview: MakerPreview): Promise<void> {
    if (this.listeners.size === 0) throw new Error(UI_TEXT.makerPreviewTitle)
    this.emit({ v: 1, type: 'makerPreview', preview })
    return Promise.resolve()
  }
}
